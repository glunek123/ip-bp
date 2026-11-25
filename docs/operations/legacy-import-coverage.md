# 旧库导入覆盖核对（2026-11-25 实测）

数据源：`nocobase_ip-2026-11-17_22-09.sql.gz`（旧库存量 2,759 条案件）
比对对象：UAT 现库 2,468 条案件 + 2,445 条历史回填入口

## 一、结论

**条数覆盖 88.6%，字段覆盖约 9%，过程事实几乎为零。**

上次导入只完成了「案件骨架 + 9 个入口字段」，其余 89 列与全部流程事实都没有落库。这就是「大部分数据还是没导入」的实际含义。

## 二、条数覆盖

| 项 | 数量 | 说明 |
| --- | --- | --- |
| 旧库案件总数 | 2,759 | |
| 旧库**有案号** | 539 | 只有这部分能按案号精确核对 |
| 旧库无案号 | 2,220 | 旧系统本身未填案号，无法按案号核对 |
| 系统案件总数 | 2,468 | 含原生 26 + 导入 2,442 + 灰度 3 − 删除 3 |
| 系统有案号的案件 | 481 | 案号只写入入口 `known`，**没有写进 `cases.court_case_no`** |
| **按案号匹配成功** | **485** | 旧库 539 条中匹配上 485 |
| **旧库有案号但系统缺失** | **54** | 明细见下节 |

> 2,220 条无案号的旧案件，系统里对应 1,962 条导入记录，但缺少唯一键，只能按「客户 + 店铺 + 阶段 + 金额」人工确认，机器无法逐条对齐。

## 三、字段覆盖（这是丢数据的主体）

历史回填入口 `case_external_entries.known` 只允许保存 9 个字段：

| 已保存字段 | 非空数 |
| --- | --- |
| `courtId` | 483 |
| `courtCaseNo` | 483 |
| `acceptedOn` | 356 |
| `caseType` | 2,445 |
| `platform` | 2,444 |
| `shopName` | 2,427 |
| `shopExternalId` | 少量 |
| `infringementTypes` | 2,445 |
| `secondInstanceAcceptedOn` | 少量 |

**未导入的 89 列（按业务分组）**：

| 组 | 未导入字段 |
| --- | --- |
| 公证 | `notarization_number`、`notarization_office`、`notarization_type`、`notarization_upload_date`、`forensics_open_date`、`forensics_confirm_date`、`forensics_approve_date`、`orensics_issue_date` |
| 取证费用 | `cost_notarization`、`cost_disclosure`、`cost_shopping`、`cost_shipping` |
| 寄件/物流 | `sender_name`、`sender_phone`、`sender_address`、`sender_tracking` |
| 披露 | `disclosure_date`、`disclosure_license`、`disclosure_type`、`disclosure_name`、`disclosure_id`、`disclosure_address`、`disclosure_info`、`disclosure_legal`、`disclosure_phone`、`disclosure_emergency`、`disclosure_sales` |
| 线索 | `clue_source`、`clue_account`、`clue_entity`、`clue_type`、`clue_notes`、`clue_check`、`clue_discovery_date`、`clue_push_date`、`clue_confirm_date`、`clue_approve_date`、`clue_purchase_date` |
| 立案诉讼 | `submit_register_date`、`official_register_date`、`case_amount`、`case_court_province`、`case_court_id`、`case_judge`、`case_prepay_date`、`cost_legal_prepay`、`cost_court_date`、`judgement_date`、`judgement_amount`、`cost_legal_paid`、`cost_legal_refund` |
| 执行结案 | `execution_date`、`execution_number`、`completed_date`、`completed_amount`、`payment_type`、`case_archive_date`、`case_archive_type`、`case_archive_notes` |
| 结算 | `customer_settlement_progress`、`customer_settlement_remarks`、`lawyer_settlement_progress`、`lawyer_settlement_remarks` |
| 其他 | `record_date`、`record_cost`、`case_lawyer_*`（6 个）、`forensics_check_*`（4 个） |

## 四、过程事实覆盖（已导入案件中）

对匹配上的 485 条抽查：

| 事实 | 有数据的条数 |
| --- | --- |
| 受理记录 | **3** |
| 判决事实 | **5** |
| 结案记录 | **17** |
| 费用记录 | **4** |

即 99% 的导入案件**没有任何过程事实**——没有立案日期、没有判决金额、没有执行案号、没有结案。列表里能看到的只有「阶段 + 客户 + 店铺」。

（3/5/17/4 这几条来自原生案件与本次灰度，不是上次导入的。）

## 五、缺失的 54 条（旧库有案号、系统没有）

样例：

| 旧 id | 案号 | 旧阶段 | 店铺 |
| --- | --- | --- | --- |
| 253 | （2024）晋0623民初12号 | 待判决 | — |
| 304 | (2026)沪0104民初8075号 | 待归档 | 310890258 |
| 347 | (2026)沪0104民初8073号 | 待归档 | 486705987 |
| 506 | （2024）沪0105民初36733号 | 已归档 | 356537888 |
| 516 | （2024）沪0105民初36728号 | 已归档 | 971219878 |

完整清单：`.local/legacy/coverage-missing.csv`（2,274 行，含 54 条有案号 + 2,220 条无案号）

上次导入失败的已知原因：被告列错位 40 条、必填缺失 4 条、权利主体不唯一 1 条、客户未匹配 270 条。

## 六、下一步

按已确认的 A 路线全量重导：

1. 清空 2,442 条导入记录（备份先做）
2. 2,220 条案件按「5 事实压缩」模型重导（含案号、费用、判决、执行、结案、归档结果）
3. 511 条线索/公证中的案件另建 Lead/公证事项
4. 54 条缺失案件单独补
5. 全量后复跑本核对脚本，出具对比报告
