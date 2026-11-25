# 旧库全量导入结果（2026-11-25）

## 一、结果

| 项 | 数值 |
| --- | --- |
| 导入案件 | 2,220 |
| 系统案件总数 | 2,243（含原生 23） |
| 客户 | 78（旧库 59 全对齐 + 原生 19） |
| 客户号 | **沿用旧 `ip_customer.id`**（如 25 → 025） |
| 案件号 | **沿用旧 `case_number`**（如 30202405313） |
| 法院案号 | 540 条写入 `cases.court_case_no`（旧库 539） |
| 受理 / 判决 / 结案 / 归档 | 407 / 263 / 1,084 / 877 |
| 费用记录 | 1,780 |
| 被告（涉及案件） | 2,225 |
| 旧号别名 | 2,274（`business_number_aliases`，按 `nocobase:<旧id>` 可反查） |

## 二、阶段分布（与旧库 1:1）

| 旧 `case_progress` | 条数 | 新 `stage` | 条数 |
| --- | --- | --- | --- |
| 999 | 876 | ARCHIVED | 876 |
| 241+251 | 484 | WAITING_FORMAL_ACCEPTANCE | 484 |
| 301 | 201 | WAITING_ARCHIVE | 201 |
| 231 | 200 | WAITING_FILING | 200 |
| 291 | 135 | EXECUTING | 135 |
| 271 | 72 | WAITING_JUDGMENT | 72 |
| 191 | 61 | PENDING_MATCH | 61 |
| 281 | 56 | WAITING_EXECUTION_FILING | 56 |
| 201 | 54 | WAITING_COMPLAINT | 54 |
| 261 | 42 | WAITING_HEARING | 42 |
| 221 | 38 | WAITING_COMPLAINT_STAMP | 38 |
| 211 | 1 | WAITING_COMPLAINT_CONFIRMATION | 1 |

## 三、字段还原

| 旧字段 | 新落点 | 状态 |
| --- | --- | --- |
| `case_number` | `cases.business_no` | ✅ 原值保留 |
| `customer_id` | `customers.business_id` | ✅ 旧 id 补零 |
| `case_court_number` | `cases.court_case_no` + 受理记录 | ✅ |
| `official_register_date` | 受理事实 | ✅ |
| `judgement_date/amount` | 判决事实 | ✅（日期缺失用受理日兜底） |
| `execution_date/number` | 执行立案 + 执行结束 | ✅ |
| `completed_date/amount` | 结案记录 + `close_outcome` | ✅ |
| `case_archive_date` | 归档记录 | ✅（缺失用结案日兜底） |
| `case_archive_type` | `close_outcome`（13 值）+ 归档类型（6 值） | ✅ |
| `cost_notarization/disclosure/shopping/legal_*` | `fee_records` 六类 | ✅ |
| `clue_entity` | 被告（经营主体） | ✅ |
| `clue_platform` | 入口 `known.platform` | ✅ |
| `clue_account` | 入口 `known.shopName` | ✅ |

## 四、已知差异

| 项 | 说明 |
| --- | --- |
| 执行立案 1,109 条 | 旧库仅 26 条有执行日期，但结案必须挂在执行立案之后，对「有结案无执行信息」的案件用结案日兜底，导致节点被补全（数据不假，只是中间节点补齐） |
| 525 条线索/公证中案件 | 未导入（旧 101/111/121/131/141/151/161/171 阶段），需另建 Lead/公证事项 |
| 28 条空阶段 | 判定空壳，不导 |
| 附件 35,134 条 | 不导（旧库无归属字段） |

## 五、验证

- 抽样 12 条随机导入案件，`GET /api/v1/cases/:id` 全部 200
- 旧号可查：`30202405313`、`2520240110529` 均能在案件列表按业务号搜到
- 每条案件含 1 条历史回填入口（`known.legacyId` 保留旧 id）

## 六、脚本

| 文件 | 用途 |
| --- | --- |
| `scripts/legacy-import/extract.py` | 解析 dump → jsonl |
| `scripts/legacy-import/generate_full.py` | 生成分批 SQL（5 事实压缩 + 旧号保留） |
| `scripts/legacy-import/generate.py` | 单案灰度生成（早期版本） |
