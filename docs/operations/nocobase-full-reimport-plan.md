# NocoBase 全量重导技术方案（A 路线）

日期：2026-11-25　数据源：`nocobase_ip-2026-11-17_22-09.sql.gz`

## 一、目标与范围

| 项 | 约定 |
| --- | --- |
| 导入范围 | **只导旧库有值的字段**；旧库没有的（法官姓名、销售额、附件本体等）一律不补 |
| 清空范围 | 2,442 条历史导入案件及其线索/公证/事实/收据/审计；保留系统原生 26 条 |
| 业务号 | 用本系统规则重新生成（客户业务号 + 日期 + 序号），旧 id 存入 `business_number_aliases`，可按旧号反查 |
| 附件 | 本阶段不导（旧库只有元数据、无归属字段） |
| 验收 | 灰度 20 条链路完整 + 全量后金额/阶段/条数与旧库对齐 |

## 二、整体架构（离线 ETL，三段）

```
dump.sql ──①抽取──> staging/*.jsonl ──②装载──> dev_cor（迁移通道）──③校验──> 通过/回滚
 (MySQL 37MB)      (每表一个文件)      (Node 迁移器 + 专用事务)     (守卫 + 对账)
```

| 段 | 产出 | 说明 |
| --- | --- | --- |
| ① 抽取 | `staging/{customer,main,case,lawyer,court,cost,payment}.jsonl` | Python 解析 dump，只保留有值字段，日期归一成 ISO |
| ② 装载 | 各业务表 + `audit_events` + `*_receipts` + 版本链 + alias | 逐条独立事务，旧 id 幂等 |
| ③ 校验 | 每条跑守卫函数 + 详情接口 200 + 金额对账 | 不通过则回滚整批 |

## 三、清空与回滚

### 3.1 备份（必做）

```bash
pg_dump "$DATABASE_URL" -Fc -f /var/backups/ip-bp-uat/pre-import-$(date +%Y%m%d%H%M).dump
```

### 3.2 清空（按依赖倒序）

只删 `cases → leads → notary_matters` 这条导入链，条件统一为「来源是历史回填」：

```sql
SET session_replication_role = replica;   -- 仅本事务，绕开守卫触发器
DELETE FROM case_external_entries WHERE case_id IN (...导入案件...);
DELETE FROM cases            WHERE id IN (...);
DELETE FROM notary_matters   WHERE id IN (...);
DELETE FROM leads            WHERE id IN (...);
DELETE FROM audit_events     WHERE resource_id IN (...);
RESET session_replication_role;
```

> 原生 26 条案件（无 external entry）不在删除条件内。

### 3.3 回滚

任一阶段失败 → 恢复 3.1 的备份（全库恢复，约 2 分钟）。

## 四、业务号方案

本系统已有规则（`business-numbering.service.ts`）：

```
业务号 = 客户业务号(3位) + yyyyMMdd + 当日序号(≥3位)
例：008 + 20261124 + 1599 → 008202611241599
```

- 导入时调用同一函数 `allocateCustomerDailyNumber()` 生成**新号**，保证与现有案件同一体系
- 旧 nocobase id 写入 `business_number_aliases(entity_type='CASE', entity_id=新id, old_number=旧id)`
- 同一线索多案沿用 `-02` 后缀规则（`sourceLeadOrdinal`）

## 五、字段映射（只导有值）

### 5.1 主数据（已完成，直接复用）

| 旧 | 新 | 状态 |
| --- | --- | --- |
| `ip_customer`(59) | `customers`(65) | ✅ |
| `ip_customer_main`(78) | `rights_holders`(67) | ⚠️ 差 11 条，装载前对账 |
| `ip_lawyer`(7613) | `lawyer_profiles`(7616) | ✅ |
| `ip_court`(3621) | `filing_courts`(3604) | ✅ |

### 5.2 案件主链（本轮新增装载）

| 旧字段 | 新表.字段 | 转换 |
| --- | --- | --- |
| `id` | `business_number_aliases.old_number` | 原样 |
| `customer_id` | `leads.customerId` / `cases.customerId` | id 映射表 |
| `main_id` | `cases.rightsHolderId` | id 映射表 |
| `case_progress` | `cases`/`leads` 阶段 | 16 值字典 |
| `case_type` | `leads.caseType` | 1民事/2刑事/3行政/4公证 |
| `clue_platform` | `leads.platform` | 1–14/99 字典 |
| `clue_type` | `leads.infringements[].type` | 1–11/99 字典 |
| `clue_account` | `leads.shopName` | 原样 |
| `clue_entity` | `cases.defendants[0].name` | 原样 |
| `clue_push_date` | `leads.pushedAt` | 日期 |
| `clue_discovery_date` | `leads.foundAt` | 日期 |
| `clue_notes` + `clue_check_opinion` | `leads.remark` | 拼接，截断 2000 |
| `notarization_number` | `notary_matters` 证书号 | 原样 |
| `forensics_open_date` / `forensics_approve_date` | `notary_matter_opening` | 构造开箱记录 |
| `sender_name` / `sender_phone` / `sender_address` | `notary_matter_opening` 寄件人 | 原样 |
| `cost_notarization` / `cost_disclosure` / `cost_shopping` | `notary_matters.fee_records` | 三笔费用 |
| `submit_register_date` | `case_filing_submissions.submittedOn` | 日期 |
| `official_register_date` | `case_acceptances.acceptedOn` | 日期 |
| `case_court_number` | `cases.courtCaseNo` | 原样 |
| `cost_legal_prepay` / `cost_legal_paid` / `cost_legal_refund` | `case_fee_records` | 三笔费用 |
| `judgement_date` / `judgement_amount` | `case_judgment_facts` | 日期/金额 |
| `execution_date` / `execution_number` | `case_execution_finishes` | 执行立案日期/案号 |
| `completed_date` / `completed_amount` | `case_closures` | 结案日期/额 |
| `payment_type` | `case_closures.paymentType` | 1一次性/2分期 |
| `case_archive_notes` | `case_closures.note` | 原样 |

### 5.3 明确不导（旧库无对应或新系统无字段）

`case_judge`（法官姓名）、`disclosure_sales`、`customer_sales/operations/expense`、`disclosure_*` 联系信息、`sender_tracking`（物流单号，暂不建）、`record_date/record_cost`。

**`case_archive_type` 改为保留**（业务确认）：新增 `case_closure_versions.close_outcome varchar(32)`，取值字典：

| 旧码 | 值 | 含义 |
| --- | --- | --- |
| 1 | `LINK_REMOVED` | 链接已下架 |
| 2 | `NO_INFRINGEMENT` | 无侵权信息 |
| 3 | `NO_EVIDENCE` | 不取证 |
| 4 | `NOT_SHIPPED_REFUND_ONLY` | 不发货-仅退款 |
| 5 | `RECEIVED_NO_RETURN` | 收到货-不退货 |
| 6 | `RECEIVED_RETURN_REFUND` | 收到货-退货退款 |
| 7 | `NOT_RECEIVED_REFUND_ONLY` | 未收到货-仅退款 |
| 8 | `CASE_VOID` | 案件作废 |
| 9 | `MEDIATION` | 调解结案 |
| 10 | `JUDGMENT_PERFORMED` | 判决履行 |
| 11 | `EXECUTION_TERMINATED` | 执行终本 |
| 12 | `EXECUTION_RECOVERED` | 执行已回款 |
| 20 | `NOTARY_ONLY` | 只公证 |

实测分布：`20`(150)、`3`(178)、`9`(153)、`5`(68)、`8`(48)、`10`(45)、`6`(23)、`1`(17)、`4`(14)、`12`(12)、`11`(7)、`7`(6)、`2`(3)。

## 五·补、实测数据与分层装载规则（`extract.py` 已跑通）

| 表 | 行数 | 列数 | 有值列 | 说明 |
| --- | --- | --- | --- | --- |
| `ip_case` | 2,759 | 99 | **98** | 仅 `clue_check` 全空 → 上次只导 9 列，等于丢了 89 列 |
| `ip_customer` | 59 | 15 | 15 | 已导 |
| `ip_customer_main` | 78 | 14 | 14 | 新系统 67，差 11 |
| `ip_lawyer` | 7,613 | 14 | 14 | 已导 |
| `ip_court` | 3,621 | 8 | 8 | 已导 |
| `ip_cost_case` | 26 | 19 | 11 | 8 列全空 |
| `ip_payment_case` | 527 | 4 | 4 | 收款记录 |

### 阶段分布（旧 `case_progress` → 新模型分层）

| 旧阶段 | 条数 | 新系统落点 |
| --- | --- | --- |
| 101 待推送 | 238 | **Lead**（`WAITING_PUSH`），不建案件 |
| 111/121 线索审核/确认 | 59 | **Lead** |
| 131 待取证 | 80 | Lead + **NotaryMatter** |
| 141–161 开箱系列 | 113 | NotaryMatter |
| 171 待出证 | 21 | NotaryMatter |
| 181 待退货 | 0 | — |
| 191 待分配起 | 61 | **Case**（`PENDING_MATCH`） |
| 201–221 诉状系列 | 93 | Case |
| 231 待提交立案 | 200 | Case |
| 241/251 立案/受理 | 55 | Case |
| 261 待开庭 | 42 | Case |
| 271 待判决 | 72 | Case |
| 281 待申请执行 | 56 | Case |
| 291 执行中 | 135 | Case |
| 301 待归档 | 201 | Case |
| 999 已归档 | 876 | Case |
| NULL | 28 | **不导入**（客户/主体/案号/店铺全空，仅 7 个审计字段有值，判定为空壳/测试数据） |

**结论**：2,759 条里只有约 **2,220 条**应成为案件；297 条是纯线索、242 条在公证阶段。上次导入把全部 2,442 条都建成了案件，这也是「字段丢失感」的一部分——阶段被压平。

> 灰度必须覆盖三类：纯线索、公证中、案件各阶段。

## 六、迁移器实现要点

### 6.1 目录结构

```
scripts/legacy-import/
  extract.py         # ① 解析 dump → jsonl
  mapping.ts         # 字典与 id 映射（阶段/平台/案由/客户/主体/法院）
  load-case.mjs      # ② 单案装载（事务）
  run.mjs            # 批量驱动 + 断点续传（记录已处理旧 id）
  verify.mjs         # ③ 守卫 + 对账
```

### 6.2 单案事务骨架

```js
await db.$transaction(async (tx) => {
  await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
  // 1) lead + 被告 + 案由
  // 2) notary_matter + 开箱 + 出证 + 费用
  // 3) case + 立案/受理 + 判决 + 执行 + 结案（写版本链 + audit + receipt）
  // 4) business_number_aliases(旧 id → 新 id)
  await tx.$executeRawUnsafe(`RESET session_replication_role`);
});
```

> **为什么必须 replica 模式**：`cases` / `leads` / `case_closures` / `audit_events` 上有 50+ 个守卫触发器（源事实不可变、父子关系、审计封印）。裸 INSERT 会被拦，且拦了之后数据处于半写状态。
> 关闭触发器后，**必须**在事务内自行写齐 `audit_events` + `*_receipts` + 版本链，否则后续任何业务操作都会被守卫拒绝。

### 6.3 幂等与断点

- 每条以 `business_number_aliases.old_number` 判重，已存在则跳过
- `run.mjs` 每 50 条落一次进度文件，中断可续

## 七、灰度与验收

### 7.1 灰度 20 条

选样（业务确认：挑「最新 + 信息最全」）：

| 旧 id | 阶段 | 关键数据 | 字段填充 |
| --- | --- | --- | --- |
| `634` | 已归档 | 公证号（2024）皖池九公证字第1152号、案号（2024）沪0105民初33064号、判决 145,000、执行 (2025)沪0105执6291号、结案 118,503、归档类型 12 执行已回款 | 80/99 |
| `631` | 已归档 | 公证号 …1137号、案号 （2024）沪0105民初32739号、判决 32,000、结案 32,000、归档类型 10 判决履行 | 80/99 |
| `421` | 已归档 | 公证号 (2024)鄂尚信证字第4751号、案号（2025）沪0105民初2356号、判决 19,000、执行（2026）沪0105执3176号、结案 1,172.32、归档类型 11 执行终本 | 78/99 |

三条均为已归档（链路最完整），客户 25 / 主体 12 / 拼多多平台，含诉讼费预缴-实缴-退费三段，能覆盖全部主要事实。

每条验收：

| 检查 | 方法 | 期望 |
| --- | --- | --- |
| 详情可读 | `GET /api/v1/cases/:id` | 200，字段完整 |
| 守卫通过 | 对该案执行一次空更新（如改备注再改回） | 不报错 |
| 金额对齐 | 案件费用合计 vs 旧库 `cost_*` 之和 | 相等 |
| 旧号可查 | 按旧 id 搜 alias | 命中新案 |

### 7.2 全量后对账

```sql
-- 条数
SELECT count(*) FROM cases;                                  -- 期望 ≈ 26 + 2,442
SELECT stage::text, count(*) FROM cases GROUP BY 1 ORDER BY 2 DESC;
-- 金额
SELECT sum(amount) FROM case_fee_records;                    -- 对比旧库 cost_* 合计
-- 别名
SELECT count(*) FROM business_number_aliases;                -- 期望 2,442
```

## 八、时间表

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| 1 | 抽取脚本 + 字典 + 对账脚本 | 0.5 天 |
| 2 | 装载器（单案事务）+ 灰度 20 条 | 1 天 |
| 3 | 灰度修复 + 全量 2,442 条 | 0.5 天 |
| 4 | 全量校验 + 收口文档 | 0.5 天 |

Window：全量装载期间（约 30–40 分钟）导入案件不可用，原生 26 条不受影响。

## 九、风险

| 风险 | 应对 |
| --- | --- |
| 守卫被绕过导致后续操作报错 | 每条事务自建审计/收据；全量后跑 `verify.mjs` 全表扫描 |
| 客户/主体/法院 id 映射缺失 | 装载前先跑映射完整性检查，缺的直接进异常清单不导 |
| 阶段推断与业务不符 | 阶段用字典精确映射（非推断），灰度时业务抽查 20 条 |
| 金额口径不一致 | 灰度阶段逐笔核对三类费用 |
| 中途失败 | 备份恢复 + 断点续传，不清空重来 |

## 十、需要业务一次性确认

1. `case_archive_type` 12 种归档结果是否要保留（保留则新增枚举，否则写备注前缀）
2. 客户主体 78 → 67 的 11 条差异是否认可（不认可则先补主体）
3. 灰度 20 条的选样由谁指定
