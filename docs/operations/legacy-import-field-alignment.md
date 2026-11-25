# 旧库字段对齐矩阵（2026-11-25 实测）

旧库 `ip_case` 共 99 列（业务 95 列 + 4 个审计列）。

## 一、结论

**没有全部对齐。** 已映射 **26 列**，未映射 **69 列**。

主流程（阶段、案号、受理、判决、执行、结案、归档结果、六类费用、被告、平台、店铺）已对齐；未对齐的是过程细节与实体化信息。

## 二、已映射（26 列）

| 旧字段 | 非空 | 落点 |
| --- | --- | --- |
| `id` | 2,759 | `business_number_aliases.old_number` |
| `customer_id` | 2,731 | `customers.business_id`（旧号保留） |
| `main_id` | 2,731 | `cases.rights_holder_id` |
| `case_progress` | 2,731 | `cases.stage` |
| `case_number` | 2,731 | `cases.business_no`（原值） |
| `case_court_number` | 539 | `cases.court_case_no` + 受理记录 |
| `official_register_date` | 394 | 受理事实 |
| `judgement_date` / `judgement_amount` | 216 / 251 | 判决事实 |
| `execution_date` / `execution_number` | 26 / 31 | 执行立案 / 执行结束 |
| `completed_date` / `completed_amount` | 397 / 416 | 结案事实 |
| `case_archive_date` | 638 | 归档事实 |
| `case_archive_type` | 724 | `close_outcome`（13 值）+ 归档类型 |
| `case_archive_notes` | 225 | 归档原因 |
| `cost_notarization` / `cost_disclosure` / `cost_shopping` | 239 / 264 / 113 | 费用（公证/披露/样品） |
| `cost_legal_prepay` / `cost_legal_paid` / `cost_legal_refund` | 481 / 340 / 325 | 费用（诉讼/退费） |
| `clue_entity` | 2,709 | 被告 |
| `clue_platform` | 2,688 | 入口 `known.platform` |
| `clue_account` | 1,407 | 入口 `known.shopName` |
| `created_at` | 2,759 | `cases.created_at` |

## 三、未映射（69 列，按可补程度分组）

### A. 已补（2026-11-25 晚，实测分布如下）

| 组 | 列 | 非空合计 |
| --- | --- | --- |
| 案件类型 / 案由 | `case_type`、`clue_type` | 5,518 |
| 法院 | `case_court_name`、`case_court_province`、`court_id`、`case_court_id` | 3,623 |
| 律师 | `case_lawyer_name/office/phone/address/number/office_number`、`lawyer_id`、`match_lawyer_date` | 9,511 |
| 金额与日期 | `case_amount`、`case_prepay_date`、`cost_court_date`、`submit_register_date`、`payment_type`、`cost_refund`、`cost_shipping`、`record_date`、`record_cost`、`case_judge`、`pleadings_*` 3 列 | 4,556 |

**实际落点与结果**：

| 旧字段 | 落点 | 实测 |
| --- | --- | --- |
| `case_type` | `known.caseType` | 民事 2,113 / 公证 95 / 刑事 10 / 行政 2 |
| `clue_type` | `known.infringementTypes` | 商标 1,217 / 美术 632 / 文字 105 / 肖像 95 / 其他 72 … |
| `case_amount` | `cases.complaint_amount` | 1,127 条有值 |
| `payment_type` | `case_closure_versions.payment_type` | 一次性 330 / 分期 37 |
| `cost_shipping` | `fee_records`（退货运费） | 30 条 |
| `cost_refund` | `fee_records`（其他/收入） | 32 条 |
| `case_court_name` | `known.courtId`（按名称匹配） | 已匹配 1,250+，970 条旧法院名不在 `filing_courts` |

**律师指派（本轮完成）**：`case_lawyer_name` + `case_lawyer_office` 匹配 `lawyer_profiles`，建 `case_lawyer_assignments`（role=PRIMARY，started_at 取 `match_lawyer_date`）—— 1,193 条成功，18 条因「技术测试/律所」或律所为空未匹配。列表「律师」列已显示（如 `692025110612` → 曾植韫）。

**未落地的 A 组字段**（新系统无字段）：`case_court_province`、`case_judge`、`pleadings_lawyer_date/approve_date/confirm_date`、`record_date`、`record_cost`、`case_court_id`、`court_id`（旧值是「立案号」不是 id）。律师指派（`case_lawyer_name` 等 6 列）需建 `case_lawyer_assignments`，留待下一轮。

### B. 随「线索 + 公证」段一起补（17 列）

| 组 | 列 | 非空合计 |
| --- | --- | --- |
| 公证过程 | `notarization_number/type/platform/office/upload_date`、`forensics_open/confirm/approve_date`、`orensics_issue_date`、`forensics_check_*` 4 列 | 6,801 |
| 寄件物流 | `sender_name/phone/address`、`sender_tracking` | 3,017 |
| 线索细节 | `clue_source`、`clue_discovery/confirm/push/approve/purchase_date`、`clue_check_opinion/note`、`clue_notes`、`users_id` | 14,381 |

### C. 新系统无对应实体（15 列）

| 组 | 列 | 非空合计 | 建议 |
| --- | --- | --- | --- |
| 披露信息 | `disclosure_license/name/address/type/id/legal/phone/emergency/info/sales/date` | 9,564 | 加披露实体或存被告备注 |
| 结算进度 | `customer_settlement_progress/remarks`、`lawyer_settlement_progress/remarks` | 745 | 文本存备注，或加字段 |
| 其他 | `case_judge`、`disclosure_sales` | 164 | 存备注 |

## 四、查看与修改（已验证）

| 项 | 结果 |
| --- | --- |
| 全量详情接口 | 2,220 / 2,220 = 200 |
| 页面渲染 | 5/5 正常（无「无法读取」，有「编辑资料」） |
| 模拟修改并保存 | `PATCH /cases/:id/routine-profile` 200，revision 0→1，回读确认 |
| 阶段分布 | 12 类与旧库一致 |
| 版本链 | 不一致 0 条 |

## 五、建议顺序

1. 补 A 组 28 列（约 1 小时，纯映射，不动流程）
2. 导线索/公证段（297 + 214 条），同时补 B 组 17 列（约 1.5 小时）
3. 决定 C 组 15 列的处理方式（加实体 / 存备注 / 不导）
