# 2026-11-17 执行更新「不推进阶段」：改造回退与守卫缺陷修复

## 结论

需求「执行更新只更新字段、由结案推进阶段」**未落地**，已回退到「提交即推进到待归档」。
但过程中发现并修复了一个真实缺陷：**带 0 凭证邮寄的案件无法完成执行更新**（见下）。

## 为什么回退

`cases` 表上有一条互相咬合的「阶段—版本」守卫链，7 个延迟约束触发器都假设
「`case_execution_finishes` 一旦存在，案件必须已离开 `EXECUTING`」。要让执行更新停在
`EXECUTING`，必须同时放宽：

| 函数                                      | 假设                                      |
| ----------------------------------------- | ----------------------------------------- |
| `check_case_execution_finish_final`       | 有立案记录 ⇒ 阶段为待归档                 |
| `check_case_execution_finish_receipt`     | 收据快照 stage = WAITING_ARCHIVE          |
| `check_case_execution_confirmation_final` | EXECUTING ⇒ 立案记录必须不存在            |
| `check_case_execution_submission_final`   | 同上                                      |
| `check_case_execution_filing_final`       | EXECUTING ⇒ version = 立案记录 to_version |
| `check_case_execution_mailing_final`      | 无待归档分支                              |
| `check_case_judgment_final`               | 阶段与版本对应                            |

实际改造时逐个试错：每修好一处，真实提交就推进到下一处（finish → receipt → confirmation →
filing → mailing → judgment），共 6 次迭代仍未收敛。继续逐个打补丁会留下「约束被削弱但
无人完整理解」的证据链，风险高于收益，故回退。

迁移 `20261117200000`～`20261117212000`、`20261117220000`（恢复原始）仅作为这次尝试的记录保留，
其中 `20261117220000_restore_execution_guards` 已将 7 个函数恢复为原始定义。

## 顺带修复的真实缺陷

`check_case_execution_mailing_final` 缺少「待归档」分支：任何已登记邮寄的案件，在提交执行
立案（`case_execution_finishes`）后都会因该守卫报 `execution mailing chain/audit/receipt mismatch`，
**流程无法前进**。UAT 首次出现于案件 `00120261026016`。

修复：迁移 `20261117232000_mailing_guard_archive_branch`，补齐
`stage IN ('WAITING_ARCHIVE','ARCHIVED')` 且存在对应 filing/finish 的分支。

修复后实测：`00120261026016` 由 `EXECUTING/15` 正常推进到 `WAITING_ARCHIVE/16`。

## 同批保留的守卫修正

| 迁移                                       | 内容                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `20261117230000_filing_guard_allow_finish` | 立案守卫允许「已存在立案记录」的状态（原条件使流程无法前进） |
| `20261117231000`（未生成）                 | —                                                            |
| `20261117170000` / `20261117180000`        | 邮寄凭证 1–10 放宽为 0–10（配合「凭证改备注」）              |

## 后续建议

「执行更新不推进阶段」需要一次**专项重构**，而不是逐个放宽守卫：

1. 定义统一的版本语义：`cases.version` 由「最后一条执行事实记录」推进，与阶段解耦
2. 一次性重写 7 个守卫为「按事实链校验、按阶段校验」两段，阶段流转只由 closure 触发
3. 全链路回归：邮寄 → 立案 → 执行更新 → 结案 → 归档，含历史数据回放
4. 在 UAT 用带历史数据的案件验证后再上线

## 当前线上状态

- 执行更新卡片：字段为「执行正式立案日期 / 执行案号 / 执行文书」，按钮「提交」
- 提交后案件进入「待归档」，结案入口按下标正常出现
- 未提交的案件仍停在「强制执行中」

---

## 2026-11-18 第二次尝试（同样回退）

按「统一版本语义、一次性重写 7 个守卫」的方案重做，进展比第一次深，但仍卡在结案链。

### 已完成并保留

| 项 | 状态 |
| --- | --- |
| 字段「执行正式立案日期 / 执行案号 / 执行文书」 | 保留 |
| 名称「执行更新」 | 保留 |
| 执行更新保存后版本递增、阶段不变 | 已在 UAT 验证（`EXECUTING` 15→16） |
| `check_case_execution_mailing_final` 缺待归档分支 | 修复（`20261117232000`） |
| 7 个执行链守卫的放宽 | 迁移已入库（`20261118090000`），宽松超集 |

### 未完成

结案从「强制执行中」提交时被 `check_case_closure_final` 拦下（`closure terminal mismatch`）：
`case_closure_terminal_version` 在「立案记录存在、结案刚插入」的事务里算出的期望版本比实际少 1。
该值由 `case_closure_source_terminal_version` / `case_archive_terminal_version` 逐级累加得出，
属于结案与归档共用的审计核心，不能在短时间内安全改动。

### 当前线上状态（已回退到可用）

- 执行更新：提交后推进到待归档（原行为）
- 结案入口：仅待归档阶段可见
- 案件 `00120261026016` 已修正为 `WAITING_ARCHIVE/16`，与立案记录一致

### 结论

「执行更新只改字段、结案推进阶段」必须与 **closure/archive 的版本累加**一起设计，
不能只改执行链。建议单独排期，一次覆盖：

1. `case_closure_source_terminal_version` 与 `case_archive_terminal_version` 的版本起点定义
2. `check_case_closure_final` / `check_case_closure_actor` / `check_case_closure_receipt` 的阶段与版本条件
3. 执行更新（不推进）→ 结案（推进）→ 归档（再推进）的完整回放
4. 历史已归档案件的重放校验（现有 5 条 finish 记录、4 条归档作为基线）

---

## 2026-11-18 第三次：完成（`b79d7286`）

### 根因

不是版本算法，是**结案更新漏写阶段**：`case_closure.service.ts` 更新 `cases` 时只写了
`version: { increment: 1 }`，`stage` 没写入，于是案件变成 `EXECUTING/17`——
版本加了、阶段没动，`check_case_closure_final` 用 `WAITING_ARCHIVE/17` 校验自然不通过。

诊断证据（临时探针，已移除）：
`closure terminal mismatch table=case_closures stage=EXECUTING version=17 base=16 terminal=17`

### 最终改动

| 层 | 内容 |
| --- | --- |
| 后端 | 执行更新只 increment version，不写 stage（停留在 `EXECUTING`） |
| 后端 | 结案更新补回 `stage: 'WAITING_ARCHIVE'`（这是唯一的阶段推进点） |
| 后端 | 结案前置与 `canRecordClosure` 允许 `EXECUTING` |
| 前端 | 执行更新按钮「保存」，说明标注「不推进阶段」 |
| 前端 | 列表/详情在 `EXECUTING` 下暴露「结案更新」 |
| 前端 | 响应校验与投影接受 `EXECUTING` 回执 |
| 数据库 | 7 个执行链守卫、结案操作人、结案收据允许 `EXECUTING`（`20261118090000` 起） |

### UAT 实测（`00120261026016`）

| 步骤 | 结果 |
| --- | --- |
| 执行更新保存 | `EXECUTING` 15 → 16，阶段不变 |
| 结案提交 | `EXECUTING/16` → `WAITING_ARCHIVE/17` |
| 结案后入口 | 显示「结案更新」，归档入口需结案额确定后才出现（原有条件） |

### 迁移清单（本需求）

`20261118090000`（7 个执行链守卫）、`20261118110000`（结案操作人）、
`20261118120000`（结案收据）、`20261118150000`（恢复报错文案）。

### 附带修复：执行立案截图无法上传（`8884c974`）

**现象**：执行立案面板选图片后提示「凭证上传失败，已选 0 份」，请求未发出。

**根因**：`frontend/src/api/materials.ts` 的上传前置校验把 `EXECUTION_FILING_PROOF`
归到「起诉材料」分支，该分支只允许 `pdf/doc/docx`，PNG 直接被前端拦下；
后端 `material.service.ts` 的 `EXECUTION_FILING_PROOF` 实际允许 `pdf/jpeg/png`，
面板文案也写「PDF、JPG 或 PNG」——三处不一致，前端最严。

**修复**：让 `EXECUTION_FILING_PROOF` 与 `FILING_EVIDENCE` 共用支持图片的类型集合。

**验证**（`00120261026015` 全链路，7/7）：

| 步骤 | 结果 |
| --- | --- |
| 上传立案截图 | 已选 1 份 |
| 提交执行立案 | `WAITING_EXECUTION_FILING/14` → `EXECUTING/15` |
| 执行更新保存 | `EXECUTING/15` → `EXECUTING/16`（阶段不变） |
| 结案 | `EXECUTING/16` → `WAITING_ARCHIVE/17` |
