# 技术债：执行更新卡片复用「执行结束」表的列（2026-11-17 记录）

状态：**保留风险，暂不清库**。记录人：用户确认（2026-11-17 17:07 后明确「先保留风险」）。

## 现状

「执行更新」卡片（原「执行结束」）的字段语义已改为执行正式立案信息，但数据库列仍沿用旧名：

| 列                                  | 现在的含义                 | 原含义       |
| ----------------------------------- | -------------------------- | ------------ |
| `case_execution_finish.finished_at` | 执行正式立案日期           | 实际结束日期 |
| `case_execution_finish.reason`      | 执行案号                   | 结束原因     |
| `case_execution_finish.basis_note`  | 提交时写入执行案号（兜底） | 依据说明     |
| `case_execution_finish_versions`    | 执行文书                   | 真实依据附件 |

代码侧对应：`CaseExecutionFinishPanel.vue`、`case-execution-finish.service.ts`、`case-execution-finish.dto.ts`、`case-execution-read-model`。

## 为什么当时没有改列名

`case_execution_finish` 与 `case_execution_finish_versions` 上挂了**不可变与审计链触发器**，`backend/prisma/migrations/20261012031000_guard_execution_mailing_filing/migration.sql` 及后续 10 处迁移均有硬编码引用：

- `check_case_execution_finish_*`（插入/一致性/审计链校验）
- `case_execution_finish_fact_guard`（延迟约束，回溯 cases 阶段与审计 details）
- 参考表 `case_execution_finish_record_corrections` 的投影校验

改列名意味着重建这些函数并保证历史数据仍能通过校验；在 2026-11-17 连续多轮 UI 改造的窗口里做这件事，风险高于收益。

## 已知副作用

1. **语义与列名错位**：读库、导出、排查问题时容易误判 `reason` 是结束原因。
2. **数据重复**：`basis_note` 与 `reason` 内容相同（都是案号）。原因：后端要求「依据说明或附件至少一项」，而依据说明已从界面移除，只能用案号兜底。
3. **报表口径**：若将来按 `finished_at` 统计「执行结束时间」，会得到立案日期。

上述三点在 UAT 均不阻塞业务使用。

## 清理方案（待排期）

1. 新增迁移：`finished_at → filed_at`、`reason → execution_case_no`、`basis_note` 置空后删除或改名 `legacy_note`。
2. 用 `CREATE OR REPLACE FUNCTION` 重建全部 finish 相关触发器函数，把字段引用改到新名；保持校验强度不变。
3. 同步 Prisma schema、DTO、service、read 投影、前端类型与变更记录（`recordEdits` 投影字段名）。
4. 处理历史数据：`basis_note` 与 `reason` 相同时清空 `basis_note`；`reason` 为空的历史行需要业务确认。
5. 回归：finish 事实链、审计详情、记录更正、归档前置、导出与报表。
6. 同步更新 `docs/operations/uat-2026-11-17-execution-update-card.md` 的映射表。

## 触发条件

满足任一条即安排：

- 需要按执行立案/结束时间做报表或筛选（当前 `finished_at` 会被误用为结束时间）
- 需要对外开放接口或导出给第三方
- 发生一次与 finish 相关的数据排查被列名误导
- 有完整窗口可做触发器重建与全链路回归

## 相关记录

- `docs/operations/uat-2026-11-17-execution-update-card.md`（本次改造的字段映射与验收）
- `docs/operations/uat-2026-11-17-mailing-remark.md`（同期邮寄字段的同类改动）
