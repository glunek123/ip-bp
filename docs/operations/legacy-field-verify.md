# 旧库 vs 系统字段全量核对（2026-11-26 18:10）

比对口径：旧库导入范围 = 案件 2,220 条 + 线索 511 条 + 公证 214 条；系统侧按字段非空数对比。

## 一、结论

**无遗漏，无差异。** 所有旧库有值的业务列均已落到系统数据库，非空数量一一对应。

## 二、案件（2,220 → cases 2,243，含 23 条系统原生）

| 旧库列 | 旧库有值 | 系统字段 | 系统有值 | 判定 |
| --- | --- | --- | --- | --- |
| `case_number` | 2,220 | `cases.business_no` | 2,243 | ✅ |
| `case_court_number` | 539 | `court_case_no` | 553 | ✅（含原生） |
| `case_judge` | 35 | `judge_name` | 35 | ✅ |
| `case_prepay_date` | 320 | `legacy_prepay_on` | 320 | ✅ |
| `cost_court_date` | 367 | `legacy_court_fee_on` | 367 | ✅ |
| `customer_settlement_progress` | 294 | `legacy_customer_settlement` | 294 | ✅ |
| `submit_register_date` | 708 | `legacy_submit_register_on` | 708 | ✅ |
| `pleadings_approve_date` | 556 | `legacy_pleadings_approve_on` | 556 | ✅ |
| `case_court_name` | 970 | `case_external_entries.known.courtId` | 970 | ✅ |
| `users_id` | 2,220 | `legacy_operator_id` | 2,220 | ✅ |

## 三、线索（511 → leads 571，含 60 条系统原生）

| 旧库列 | 旧库有值 | 系统字段 | 系统有值 | 判定 |
| --- | --- | --- | --- | --- |
| `clue_source` | 510 | `legacy_clue_source` | 510 | ✅ |
| `clue_push_date` | 169 | `pushed_at` | 211 | ✅（169 + 原生 42） |
| `clue_confirm_date` | 158 | `legacy_confirmed_on` | 158 | ✅ |
| `clue_approve_date` | 162 | `legacy_approved_on` | 162 | ✅ |
| `clue_purchase_date` | 111 | `legacy_purchased_on` | 111 | ✅ |
| `clue_check_opinion` | 155 | `legacy_review_opinion` | 155 | ✅ |
| `users_id` | 511 | `legacy_operator_id` | 511 | ✅ |

## 四、披露与公证

| 项 | 旧库 | 系统 | 判定 |
| --- | --- | --- | --- |
| 披露（11 列至少一列有值） | 2,100 | `case_disclosures` 2,100 | ✅ |
| 公证号 `notarization_number` | 53 | `legacy_notarization_number` 53 | ✅ |
| 寄件单号 `sender_tracking` | 103 | `legacy_sender_tracking` 103 | ✅ |

## 五、已知的口径差异（非遗漏）

| 项 | 说明 |
| --- | --- |
| 案件 2,243 vs 旧库 2,220 | 系统原有 23 条原生案件 |
| 线索 571 vs 511 | 系统原有 60 条原生线索 |
| 公证 246 vs 214 | 系统原有 32 条原生公证 |
| 律师 7,615 vs 89 | 系统律师库是全量池，旧库只涉及 89 人；89 人中 82 人回填了联系方式（7 人律所名为空无法匹配） |

## 六、刻意未导的列

| 列 | 原因 |
| --- | --- |
| `users_id` / `lawyer_id` / `court_id` / `case_court_id` | 内部主键，已用姓名/名称匹配到系统实体 |
| `record_date` / `record_cost` | 用户明确不迁 |
| `clue_discovery_date` | 已由 `leads.found_at` 承接 |
