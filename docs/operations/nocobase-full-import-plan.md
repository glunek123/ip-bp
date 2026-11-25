# NocoBase 全量导入方案（2026-11-25）

数据源：`nocobase_ip-2026-11-17_22-09.sql.gz`（MySQL 8.0，131 张表，库 `nocobase_ip`）。

## 一、结论先行

1. **必须做映射**，但不是「加几个字段」的映射：旧库 `ip_case` 是 99 列宽表，新系统是阶段化模型，**一列可能拆到多张表，多列合并成一个事实**。
2. 上次导入**只落了 15 个字段**（入口 `known` 的 9 个 + 阶段 + 客户/主体/案号），其余约 80 列没进来 —— 这就是「丢失很多字段」的原因，不是导入失败，而是通道本身只收这些。
3. 再次导入有两条路：**清空重导（推荐）** 与 **原地补齐（受限）**，见第五节。

## 二、上次为什么丢字段

导入走的是 `case_external_entries`（历史回填入口），它能保存的字段被 DTO 固定：

| 已保存 | 未保存 |
| --- | --- |
| `courtId` `courtCaseNo` `acceptedOn` `secondInstanceAcceptedOn` `caseType` `platform` `shopName` `shopExternalId` `infringementTypes` + `initialStage` | 公证号/取证日期/开箱/出证、各项费用（公证费/披露费/购物费/诉讼费）、判决日期与金额、执行日期与案号、结案日期与类型、结算进度、寄件人信息、物流单号、备案信息等 |

且 `known` 上有不可变触发器（`reject_case_external_entry_mutation`），**已经导进去的记录无法原地改**。

## 三、可以确定的对齐

### A. 主数据（已导入，可复用）

| 旧 | 新 | 状态 |
| --- | --- | --- |
| `ip_customer.*`（59） | `customers`（65） | ✅ 已导草稿并准入 |
| `ip_customer_main.*`（78） | `rights_holders`（67） | ⚠️ 差 11 条，需核对是否去重/跳行 |
| `ip_lawyer.*`（7613） | `lawyer_profiles`（7616） | ✅ 已导 |
| `ip_court.*`（3621） | `filing_courts`（3604） | ✅ 已导（去重 17） |

### B. 案件骨架

| 旧字段 | 新落点 | 判定 |
| --- | --- | --- |
| `case_progress` | `cases.stage` | ✅ 字典已解（101→999 共 16 个取值） |
| `case_type` | `cases`/`leads.caseType` | ✅ 字典 1/2/3/4 |
| `customer_id` | `cases.customerId` | ✅ 需 id 映射表 |
| `main_id` | `cases.rightsHolderId` | ✅ 需 id 映射表 |
| `case_court_id` / `court_id` | `filing_courts.id` | ✅ 需 id 映射表 |
| `case_court_number` | `cases.courtCaseNo` | ✅ |
| `official_register_date` | `case_acceptances.acceptedOn` | ✅ |
| `submit_register_date` | `case_filing_submissions.submittedOn` | ✅ |
| `created_by_id` | `cases.responsibleUserId` | ⚠️ 需账号映射 |
| `id` | 业务号/`externalSourceRef` | ⚠️ 规则待定（建议保留原 id 到扩展字段） |

### C. 线索

| 旧字段 | 新落点 | 判定 |
| --- | --- | --- |
| `clue_platform` | `leads.platform` | ✅ 字典 1–14/99 |
| `clue_account` | `leads.shopName` | ✅ |
| `clue_entity` | `cases.defendants[0].name` | ✅ |
| `clue_type` | `leads.infringements[].type` | ✅ 字典 1–11/99 |
| `clue_source` | `leads.source` | ⚠️ 旧值为编码，需字典（`ip_fields` 里未找到该字段定义） |
| `clue_notes` / `clue_check_opinion` | `leads.remark` | ⚠️ 两列合并，超长需截断 |
| `clue_discovery_date` / `clue_push_date` / `clue_confirm_date` / `clue_approve_date` | `leads.foundAt` / `pushedAt` + 审核决策 | ⚠️ 四个节点新系统是决策链，不建审批就只保留首尾 |
| `clue_purchase_date` | 公证事项取证日期（前置） | ⚠️ 语义是「购买样品日」，新系统没有独立字段 |

### D. 公证（`ip_case` → `notary_matters`）

| 旧字段 | 新落点 | 判定 |
| --- | --- | --- |
| `notarization_number` | `notary_matters` 证书号 | ✅ |
| `notarization_office` | `notary_offices` | ⚠️ 需先建公证处字典 |
| `notarization_type` | 取证方式 | ⚠️ 编码含义待确认 |
| `notarization_upload_date` | 出证/上传日期 | ⚠️ 与 `orensics_issue_date`（拼写错的出证日期）关系待确认 |
| `forensics_open_date` / `forensics_confirm_date` / `forensics_approve_date` | `notary_matter_opening`（开箱） | ✅ 可构造 |
| `sender_name` / `sender_phone` / `sender_address` | `notary_matter_opening` 寄件人 | ✅ |
| `sender_tracking` | 物流单号 | ⚠️ 新系统物流在 `notary_matter_evidence.logistics`，需建数组元素 |
| `cost_notarization` / `cost_disclosure` / `cost_shopping` | `notary_matters.fee_records` | ✅ 三种费用类型 |
| `cost_shipping` | 运费 | ⚠️ 新系统无独立运费项，建议并入「购物费」备注 |
| `disclosure_*`（名称/证号/地址/电话/法人/紧急联系人） | `case_disclosure`？ | ❓ 新系统披露信息挂在案件证书段，字段不完全对应 |

### E. 诉讼与判决

| 旧字段 | 新落点 | 判定 |
| --- | --- | --- |
| `case_amount` | `cases`/判决标的额 | ⚠️ 语义是「诉请金额」还是「标的额」待确认 |
| `case_judge` | — | ❌ 新系统无「法官姓名」字段（可放 `case_acceptances` 备注） |
| `case_prepay_date` / `cost_legal_prepay` | `fee_records`（预缴诉讼费） | ✅ |
| `cost_legal_paid` / `cost_legal_refund` | `fee_records`（实缴/退费） | ✅ |
| `judgement_date` / `judgement_amount` | `case_judgment_facts` | ✅ |
| `cost_court_date` | 诉讼费结算日 | ⚠️ 需确认含义 |

### F. 执行与结案

| 旧字段 | 新落点 | 判定 |
| --- | --- | --- |
| `execution_date` / `execution_number` | `case_execution_finishes`（执行正式立案日期/案号） | ✅ |
| `completed_date` / `completed_amount` | `case_closures`（结案日期/结案额） | ✅ |
| `case_archive_date` | `case_closures.closeAt` 或归档日期 | ⚠️ 与 `completed_date` 谁作结案日期待定 |
| `case_archive_type` | — | ❌ 12 种归档结果（链接下架/调解/执行终本…）新系统无枚举 → 建议新增 `closure_outcome` 或写 `closure.note` |
| `case_archive_notes` | `case_closures.note` | ✅ |
| `payment_type` | `case_closures.paymentType` | ✅ 字典 1 一次性 / 2 分期 |
| `customer_settlement_progress` / `_remarks` | 客户结算 | ⚠️ 旧值像是文本进度，新系统是金额+状态 → 需业务定 |
| `lawyer_settlement_progress` / `_remarks` | 律师结算 | ⚠️ 同上 |
| `record_date` / `record_cost` | — | ❓ 语义不明（备案？）需业务解释 |
| `disclosure_sales` | — | ❌ 新系统销售额概念（客户侧 `customer_sales` 也一样） |

## 四、确定不了、需要业务给规则的 7 项

| # | 问题 | 影响 | 建议解决办法 |
| --- | --- | --- | --- |
| 1 | `case_archive_type` 12 种归档结果 | 结案原因无法保留 | 新增 `closure_outcome` 枚举（12 值），或在 `closure.note` 前缀 `[归档类型]` |
| 2 | `clue_source` 编码 | 线索来源全部为空 | 从旧系统前端配置表（`ip_fields` 未收录）导出字典 |
| 3 | `notarization_type` 编码 | 取证方式错填 | 同上 |
| 4 | `case_amount` 语义（诉请/标的） | 金额展示口径 | 业务确认后落到对应字段 |
| 5 | `case_archive_date` vs `completed_date` | 结案日期取值 | 业务确认以哪个为准 |
| 6 | 客户主体差 11 条（78→67） | 部分案件主体为空 | 先跑一致性核对，确认是去重还是漏导 |
| 7 | 旧 id 是否保留为业务号 | 后续对账 | 建议保留到 `externalSourceRef`，业务号按新规则生成 |

## 五、两条路线

### 路线 A：清空重导（推荐）

1. 清空 2,442 条导入案件（入口/被告/收据/审计一并删，脚本已有）
2. 按全字段重建：案件骨架 + 公证事项 + 判决事实 + 执行事实 + 结案事实 + 费用
3. 小批量（20 案）试跑 → 校验守卫 → 全量
4. 优点：一次到位；缺点：2–3 天，期间导入案件不可用

### 路线 B：原地补齐（受限）

- `known` 不可变 → 只能补写阶段事实（判决/执行/结案/费用），入口字段补不了
- 需要按旧 id 逐案定位，缺失的案件（314 条）另外补
- 优点：不清空；缺点：口径不统一、校验成本高、易出现「同一案件两条事实」

**建议 A**，并用小批量灰度先验证一条完整链路（线索 → 公证 → 立案 → 判决 → 执行 → 结案）。

## 六、附件（单独议题）

- 35,134 条元数据，其中 35,096 个 URL 指向旧阿里云 OSS，实测可访问
- `ip_attachments` **无归属字段**，关联关系在业务表 JSON 里，需逐表解析
- 建议第二阶段处理：先定位归属 → 批量下载 → 按案件上传建 `material_references`
