# CORE-NT-003 Task 2 交接

- Task：单一开箱审核 Command、运营/客户薄写入口、DTO、模块注入及直接验证。
- Model：gpt-6-sol。
- Commit：`72ba708`（代码与测试；本报告单独提交）。未 push。
- Changed files：`backend/src/modules/leads/notary-opening-review.service.ts`、`.spec.ts`、`notary-opening-review.controller.spec.ts`、`lead-notary.dto.ts`、`lead-notary.controller.ts`、`client-lead.controller.ts`、`lead.module.ts`、`tests/e2e/core-leads.spec.ts`、`tests/support/core-lead-database.mjs`、`.d.mts`。

## 结果与契约

同一 Command 接收 `result`、条件 `reason`、必需 `expectedVersion` 和 `Idempotency-Key`。运营 `POST /api/v1/notary-matters/:id/opening-review` 与客户 `POST /api/v1/client/notary-matters/:id/opening-review` 共用该 Command。事务内锁事项，重验内部账号及独立 `notary.opening.review` 范围，或重验客户账号、绑定、客户准入和来源线索推送事实；授权之后才检查回执。审核要求 `UNBOX_REVIEW`、开箱事实、精确归属且关联开箱登记审计的冻结照片及匹配版本。侵权进入 `ISSUANCE_DECISION`；不侵权记录修剪后的原因、归档时间并进入 `ARCHIVED`。决定、专用成功审计、回执和事项推进一次提交；仅序列化冲突有限重试。

无 schema 或 Task 1 审计契约变更。客户端读取、照片字节授权、UI 和 NT-007 未纳入本任务。

## RED / GREEN 与实际验证

- RED：先新增 Command 测试并运行；因 `notary-opening-review.service` 尚不存在，Jest 以 TS2307 失败。
- GREEN：Command/Controller 聚焦 Jest 2 suites、11 tests 通过；OpenAPI 双路径、必需回执键与响应 schema 已检查。
- 后端 build、类型检查与 `pnpm check:fast` 通过。第一次 `check:fast` 指出 E2E 支持模块 `.d.mts` 缺少新导出；补齐声明后重跑通过。
- 隔离 `backend/.env.test` 的 PostgreSQL 测试库确认迁移无待应用；`pnpm test:e2e:core-ld --grep "notary opening|opening review"` 5/5 通过，其中 3 条新用例覆盖双身份、跨部门/企业、无 Action/越范围、无冻结照片、旧版本、重放/异参、跨身份并发唯一胜出、决定/专用审计/回执各自注入失败后的数据库整事务回滚。两条既有 NT-002 开箱测试也通过，确认夹具清理顺序未破坏旧流程。

## 自审、已知风险与 Sol 关注点

自审检查了授权早于回执、客户不借内部 Grant、专用成功审计唯一关联决定、回滚及 E2E 夹具按回执→审计→决定清理。测试故障注入产生的预期 500 日志已由对应回滚断言覆盖。

本任务尚未经独立高风险 Review，也未运行全量 Level 3 门禁或完整双端浏览器主链。请 Sol Review 重点复查事务内身份重验、冻结照片与开箱审计关联、序列化冲突重试和回执快照校验；发现问题后在后续集成阶段修复。Task 5 负责完整浏览器主链。
