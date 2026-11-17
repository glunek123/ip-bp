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
