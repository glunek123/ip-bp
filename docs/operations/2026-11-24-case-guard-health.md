# 2026-11-24 未指派案件的守卫健康体检（UAT 164ae904）

## 为什么做

本次上线的「补指派」会递增 `cases.version`。案件主表上有一批延迟约束触发器（归档、结案、执行终态），历史迁移数据若缺对应快照，提交时会抛 SQLSTATE 23514，接口返回 500。运营看到的只是「服务内部错误」，无法自己判断哪个案件能补指派。这份体检给出一份可直接执行的清单。

## 方法

脚本 `backend/scripts/check-case-guards.mjs`（已在 `35e8b29c` 上线）：

```bash
cd /srv/ip-bp-uat/current/backend
set -a; . /etc/ip-bp-uat/backend.env; set +a
node scripts/check-case-guards.mjs --limit=3000 --out=/tmp/guards-all.csv
```

逐案在事务内执行 `UPDATE cases SET version = version + 1` → `SET CONSTRAINTS ALL IMMEDIATE` → `ROLLBACK`，**不提交任何数据**，只回答「这个案件现在能不能改版本」。加 `--stage=WAITING_ARCHIVE,ARCHIVED` 可只看某几个阶段。

## 结果（2026-11-24，全部未指派律师案件 1977 个）

**可通过 1208（61%）、受阻 769（39%）**，耗时约 1 分 50 秒。

| 阶段 | 可通过 | 受阻 | 通过率 |
| --- | --- | --- | --- |
| 待正式受理 `WAITING_FORMAL_ACCEPTANCE` | 378 | 0 | 100% |
| 待匹配 `PENDING_MATCH` | 316 | 1 | 100% |
| 待写诉状 `WAITING_COMPLAINT` | 247 | 0 | 100% |
| 待立案 `WAITING_FILING` | 192 | 0 | 100% |
| 待开庭 `WAITING_HEARING` | 37 | 0 | 100% |
| 待确认诉状 `WAITING_COMPLAINT_STAMP` | 27 | 0 | 100% |
| 待判决 `WAITING_JUDGMENT` | 10 | 0 | 100% |
| 待确认诉状 `WAITING_COMPLAINT_CONFIRMATION` | 1 | 0 | 100% |
| 待归档 `WAITING_ARCHIVE` | 0 | 33 | 0% |
| 强制执行中 `EXECUTING` | 0 | 53 | 0% |
| 待执行文书 `WAITING_EXECUTION_DOCUMENTS` | 0 | 16 | 0% |
| 已归档 `ARCHIVED` | 0 | 666 | 0% |

受阻原因分布：

| 原因 | 数量 | 含义 |
| --- | --- | --- |
| `archived case without archive` | 666 | 阶段已是已归档，但没有归档事实行 |
| `execution external terminal mismatch` | 85 | 执行终态与执行外部事实不一致 |
| `current round has no judgment for stage` | 16 | 当前审级缺判决事实 |
| `closure terminal mismatch` | 1 | 结案终态与阶段不一致 |
| `merged child cannot progress independently` | 1 | 合并子案不能独立推进 |

## 运营口径

1. **诉讼阶段补指派可以放心用**：待受理、待匹配、待写诉状、待立案、待开庭、待确认诉状、待判决这 1208 个案件全部健康。
2. **待归档、执行中、待执行文书、已归档一律不要补指派**：会 500。这四类共 768 个案件需要先修数据（补归档快照 / 对齐执行终态），修数据不是本轮范围。
3. **结算不受此限制**：结算发起不改 `cases.version`。上面 33 个待归档案件里如果已经有承办律师，律师结算可以正常录（已在 `00920261118139` 实测 100.00 成功）。

## 一个需要产品决策的死结

律师结算只在「待归档」阶段允许发起，而待归档的未指派案件 **33 个全部守卫不健康**，意味着：

> 现在没有任何合法路径给「待归档 + 无律师」的案件补律师并录结算：补指派 500，结算又要求先有律师。

可选解法（未实施，等拍板）：

- **A. 修数据**：为这 33 个案件补齐归档所需的源事实，让补指派恢复可用。工作量取决于缺失快照的形态。
- **B. 放宽结算前置**：允许无律师案件先录律师结算金额（线下交付），指派后置。改动小，但要重新定义结算归属校验。
- **C. 运营兜底**：这 33 个案件线下结算，系统内只在指派完成后补录。

## 重跑与留存

明细 CSV（含业务号、阶段、案件 ID、结果、原因）在服务器 `/tmp/guards-all.csv`，本地副本 `.local/qa/guards-all-20261124.csv`（不入库）。数据修复后重跑同一命令即可对比前后。
