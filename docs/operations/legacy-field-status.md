# 旧库字段导入现状（2026-11-26 实测）

导入范围：案件 2,220 条（旧 191 起阶段）、线索 511 条、公证 214 条。

## 一、结论

**没有全部导入。** 案件段 92 个业务列中，已映射 **35 列**，未映射 **57 列**（均含非空值）。

## 二、已映射（35 列）

| 组 | 字段 |
| --- | --- |
| 主键/归属 | `case_number`、`customer_id`、`main_id`、`case_progress` |
| 类型/案由 | `case_type`、`clue_type` |
| 法院/案号 | `case_court_number` |
| 受理/判决 | `official_register_date`、`judgement_date`、`judgement_amount`、`case_amount` |
| 执行/结案 | `execution_date`、`execution_number`、`completed_date`、`completed_amount`、`payment_type` |
| 归档 | `case_archive_date`、`case_archive_type`、`case_archive_notes` |
| 费用 | `cost_notarization`、`cost_disclosure`、`cost_shopping`、`cost_legal_prepay`、`cost_legal_paid`、`cost_legal_refund`、`cost_shipping`、`cost_refund` |
| 被告/店铺 | `clue_entity`、`clue_platform`、`clue_account` |
| 律师 | `case_lawyer_name`、`case_lawyer_office`、`match_lawyer_date` |
| 其他 | `case_judge`、`pleadings_lawyer_date` |

## 三、未映射（57 列，含非空数）

| 组 | 列（非空数） | 建议 |
| --- | --- | --- |
| **披露信息**（11） | `disclosure_license` 1930、`disclosure_name` 1161、`disclosure_address` 1065、`disclosure_type` 1006、`disclosure_id` 977、`disclosure_legal` 881、`disclosure_phone` 622、`disclosure_info` 299、`disclosure_sales` 129、`disclosure_date` 33、`disclosure_emergency` 16 | 新系统无实体 → 加 `case_disclosures` 表或存被告备注 |
| **线索节点**（8） | `clue_source` 2200、`clue_discovery_date` 2164、`clue_confirm_date` 1188、`clue_push_date` 910、`clue_purchase_date` 892、`clue_approve_date` 889、`clue_check_opinion` 975、`clue_check_note` 221 | 线索表已有 status/时间 → 补字段 |
| **公证过程**（9） | `notarization_type` 926、`notarization_platform` 834、`notarization_number` 862、`notarization_upload_date` 497、`forensics_open_date` 728、`forensics_confirm_date` 532、`forensics_approve_date` 474、`orensics_issue_date` 214、`notarization_office` 69 | 公证事项加字段或存 `source_snapshot` |
| **寄件物流**（4） | `sender_tracking` 927、`sender_address` 623、`sender_phone` 621、`sender_name` 621 | 公证事项加字段 |
| **律师明细**（4） | `case_lawyer_phone` 1193、`case_lawyer_number` 1189、`case_lawyer_office_number` 1187、`case_lawyer_address` 1032 | `lawyer_profiles` 已有 phone → 补其他 |
| **诉状节点**（2） | `pleadings_approve_date` 556、`pleadings_confirm_date` 365 | 诉状确认记录 |
| **法院**（3） | `case_court_name` 970、`case_court_province` 970、`case_court_id` 385 | 法院已有 province 列 → 补写 |
| **费用日期**（2） | `case_prepay_date` 320、`cost_court_date` 367 | 费用记录日期 |
| **结算进度**（4） | `customer_settlement_progress` 294、`lawyer_settlement_progress` 257、`customer_settlement_remarks` 189、`lawyer_settlement_remarks` 5 | 新系统无字段 |
| **其他** | `users_id` 2220、`clue_notes` 237、`forensics_check_opinion` 604、`forensics_check_note` 331、`forensics_check_result` 176、`forensics_check_info` 59、`record_date` 16、`record_cost` 52、`lawyer_id` 1201 | 部分可忽略 |

## 四、前端可用性

| 能力 | 状态 |
| --- | --- |
| 查（列表 + 详情） | ✅ 案件 2,220 / 线索 511 / 公证 214 全部可打开 |
| 改 | ✅ 已验证案件 `routine-profile` 保存 200；线索/公证有编辑入口 |
| 删 | ⚠️ 页面有删除按钮，**未做端到端验证** |

## 五、要达标还需

1. 披露信息（11 列，最大缺口）—— 需要新实体
2. 线索/公证过程字段（17 列）—— 加字段
3. 律师明细（4 列）—— 补 lawyer_profiles
4. 法院名/省份（2 列）—— 已加列，补写即可
5. 费用日期（2 列）
6. 结算进度（4 列）—— 需要新字段
