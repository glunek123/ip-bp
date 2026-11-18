# 旧系统（NocoBase）数据迁移评估

备份：`nocobase_ip-2026-11-17_22-09.sql.gz`（6.9 MB，MySQL 8.0 dump，库名 `nocobase_ip`，131 张表）

## 一、旧系统数据概况

| 表 | 行数 | 说明 |
| --- | --- | --- |
| `ip_case` | 2,759 | **99 列的全流程宽表**：线索→取证→公证→立案→判决→执行→结案→结算 |
| `ip_case_tort` | 3,389 | 案件-案由关联 |
| `ip_customer` | 59 | 客户（名称/内容/型号/起止/费用/地址/销售额/运营） |
| `ip_customer_main` | 78 | 客户主体（名称/编码/税号/银行/账号/联系人/地址） |
| `ip_lawyer` | 7,613 | 律师（姓名/电话/所/执业证号/省/邮箱） |
| `ip_court` | 3,621 | 法院 |
| `ip_cost_case` | 26 | 案件费用与退款（19 列） |
| `ip_payment_case` | 527 | 收款记录 |
| `ip_attachments` | 35,134 | 附件**元数据**（文件本体不在备份里） |
| `ip_executions` | 1,530 | NocoBase 工作流执行记录（非业务数据） |
| `ip_t_*` | 约 30 张 | 动态集合，多为临时/测试集合（如「王海-图标」），业务价值低 |

样例数据是真实业务（客户：北京金洪恩、深圳万普拉斯、上海新创华；含公证号、法院、案号、金额）。

## 二、模型差异（迁移的主要难点）

| 维度 | 旧（NocoBase） | 新（dev_cor） |
| --- | --- | --- |
| 案件 | 一张 99 列宽表，流程字段平铺 | 阶段化：`Lead` / `NotaryMatter` / `Case` + 每步事实表 |
| 阶段 | `case_progress` 数字编码（999/241/301…） | `CaseStage` 枚举（14 个阶段） |
| 版本 | `updated_at` 时间戳 | 每步 `from_version`/`to_version` 链 |
| 审计 | NocoBase `created_by_id` | `audit_events` + 每步 `*_receipts` + 不可变触发器 |
| 关系 | 外键 id 直连 | 部门隔离 + 客户/权利主体/负责人三向绑定 |

新系统的业务表**全部挂在审计链触发器上**，裸 `INSERT` 会被拒（和本次执行更新改造遇到的是同一套约束）。历史数据迁移必须走专用通道。

## 三、实体映射

| 旧表.字段 | 新表.字段 | 可行性 |
| --- | --- | --- |
| `ip_customer.customer_name` | `Customer.name` | ✅ 直接 |
| `ip_customer.customer_model` | `Customer.category` | ⚠️ 需解码（值是 `["1"]` 这类 JSON） |
| `ip_customer.customer_address` | `Customer.region` | ⚠️ 字段语义不同（地址 vs 区域） |
| `ip_customer_main.*` | `CustomerRightsHolder` / `CustomerMaintenance` | ⚠️ 需拆分实体 |
| `ip_lawyer.*` | `LawyerProfile` | ✅ 基本对齐 |
| `ip_court.*` | `FilingCourt` | ✅ 基本对齐 |
| `ip_case.id` | `Case.businessNo` | ⚠️ 新系统有业务号规则（首案无后缀，第二案 -02） |
| `ip_case.customer_id` / `main_id` | `Case.customerId` / `rightsHolderId` | ✅ 需先导主数据 |
| `ip_case.case_progress` | `Case.stage` | ❌ **缺字典，无法映射** |
| `ip_case.created_by_id` | `Case.responsibleUserId` | ⚠️ 需用户映射表 |
| （无） | `Case.departmentId` | ❌ 需指定默认部门 |
| `ip_cost_case.*` | `FeeRecord` | ⚠️ 支付/退款结构与新模型不同 |
| `ip_case_tort` | 案由（`Case` 关联） | ⚠️ 需案由字典 |
| `ip_attachments.*` | `Material` / `ContentVersion` | ❌ 文件本体缺失 |

## 四、必须由业务方提供的信息

1. **阶段字典**：`case_progress` 的取值含义（999、241、301、291、231、131、271、191…）。没有它，案件只能全部落到「待匹配」或统一某个阶段。
2. **负责人映射**：旧 `created_by_id`（1、4 等）对应新系统的哪些账号。
3. **归属部门**：历史案件统一挂到哪个部门（或按客户/地区拆分）。
4. **业务号规则**：是否沿用旧 id，还是按新系统规则重新生成（推荐后者，保留旧 id 到备注或扩展字段）。
5. **附件文件**：35,134 条元数据的文件本体在哪里（本地磁盘/OSS）；是否能拿到。

## 五、建议方案（分三步，可按需裁剪）

### 第一步：主数据（1 天内可完成）

客户 59 + 主体 78 + 律师 7,613 + 法院 3,621。

- 走 API 批量导入（`POST /customers` 等），保留旧 id 到备注
- 律师/法院是参考数据，可直接 `INSERT`（无审计链）
- 产出：可用的客户与参考数据，供业务先试运行

### 第二步：案件骨架（2-3 天）

2,759 案件，只导「业务号 + 客户 + 主体 + 案由 + 当前阶段 + 关键金额/日期」，不导过程审批。

- 需要第一步完成 + 阶段字典
- 走**迁移专用 SQL 通道**：临时禁用该表的审计触发器 → 插入 → 补齐最小 `audit_events` 与 receipt → 重新启用
- 逐案校验：插入后跑一遍现有守卫函数，确保不违反约束

### 第三步：流程事实与附件（3-5 天，可选）

线索、公证、立案、判决、执行、结案等历史节点，按需迁移：

- 若业务只需要「能查到历史阶段与结果」→ 第二步够用
- 若需要「历史审批链路可追溯」→ 必须逐条构造 `audit_events` + 版本链，工作量大且要业务确认哪些字段必须保留
- 附件 35,134 条：文件本体到位后可批量上传并建立 `material_references`

## 六、风险

| 风险 | 说明 |
| --- | --- |
| 审计链破坏 | 迁移专用通道绕过了触发器，必须迁移后跑一次全量守卫校验，否则后续任何操作都可能被拦 |
| 阶段信息丢失 | 缺字典时只能统一落一个阶段，历史进度不可见 |
| 业务号冲突 | 旧 id 与新规则不一致，需明确是否保留原号 |
| 附件缺失 | 只有元数据时，案件详情中的历史材料会显示为空 |
| 数据量 | 2,759 案件 + 35,134 附件，迁移窗口需要预留停机或灰度时间 |

## 七、结论

**可以导入，但建议分层**：主数据（客户/主体/律师/法院）几乎无阻碍；案件骨架需要阶段字典与负责人映射；流程事实与附件按业务需要取舍。

不建议一次性全量裸导——新系统的审计链会让「导入成功但后续操作全报错」成为一个很难排查的状态。

---

## 实施进度（2026-11-18）

| 对象 | 旧数据 | 结果 | 说明 |
| --- | --- | --- | --- |
| 法院 | 3,621 | ✅ 3,604 入库 | 去重后导入 `filing_courts`，挂运营部 |
| 律师 | 7,613 | ✅ 7,613 入库 | 全量导入 `lawyer_profiles`（姓名+律所去重，无重复） |
| 客户 | 59 | ✅ 59 建为草稿 | `profile_status=DRAFT`，已填名称/统一社会信用代码/地址/型号 |
| 客户准入 | 59 | ⏸ 待业务补证件 | 系统要求准入至少 1 份证件材料，旧备份无证件扫描件 |
| 案件 | 2,759 | ⏸ 阻塞 | CSV 导入只接受 `ADMITTED` 客户，需先完成准入 |

### 客户草稿的字段来源

| 新字段 | 旧字段 | 备注 |
| --- | --- | --- |
| `name` | `ip_customer.customer_name` | 原始保留 |
| `identityType` / `identityNumber` | `ip_customer_main.main_code` | 统一社会信用代码 |
| `region` | `ip_customer.customer_address` | ⚠️ 语义不同（地址→区域），截断 100 字 |
| `category` | `ip_customer.customer_model` | ⚠️ 旧值是 `["1"]`/`["2"]` 编码，已解成 `1`/`2`，含义待业务确认 |
| `customerType` | 固定 `COMPANY` | 旧客户均为企业 |

### 下一步

1. 业务在客户列表逐户补证件并准入（59 户）
2. 准入完成后，用 `POST /cases/csv-import/preview` → `commit` 导入案件骨架
   - 阶段按旧字段推断（`clue_*` → 早期阶段；`forensics_*`/`notarization_*` → 待立案；`case_court_number` → 立案后；`judgement_*` → 待判决/二审；`execution_*` → 执行；`completed_*` → 待归档）
   - 每案附带 1 条被告（取自 `clue_entity` / `disclosure_name`）与法院、案号、受理日期

---

## 案件导入结果（2026-11-18）

| 项 | 数值 |
| --- | --- |
| 旧案件总数 | 2,759 |
| 生成 CSV 行数 | 2,489（270 行客户未匹配，跳过） |
| 已导入案件 | 2,911（**含约 422 条重复**） |
| 未导入 | 45 行（被告列错位 40、必填缺 4、主体不唯一 1） |

### 阶段分布（推断）

待匹配 1,014 → 待写诉状 63、已归档 586、待提交立案 424、待归档 185、待开庭 131、待判决 74、强制执行中 12。

### 重复的来源

`POST /cases/csv-import/commit` 的幂等基于「CSV 指纹 + 行号」。我在导入过程中两次重新生成 CSV
（修正待匹配阶段、清洗换行），指纹变化后服务端不再识别为同一行，导致同一旧案件被再次创建。

**当前影响**：同一案件可能存在 2 条记录，业务层面可搜索到重复。

**清理方案**（待确认后执行）：
按 `case_external_entries` 的 `recorded_at` 分批，第二批中与第一批「客户 + 阶段 + 到达日期 +
法院案号 + 被告姓名」完全一致者，保留最早一条，其余连同 external entry / receipts 一并删除。

### 已知限制

- 旧 `case_progress` 编码未解码，阶段按字段推断（`clue_*`/`forensics_*`/`notarization_*`/`case_court_number`/`judgement_*`/`execution_*`/`completed_*`/`case_archive_*`）
- 旧 `clue_platform` 编码未知，平台统一填「其他」
- 权证材料（附件 35,134 条）只有元数据，未迁移
- 客户证件为占位 PDF（`migration-placeholder.pdf`），业务后续替换
