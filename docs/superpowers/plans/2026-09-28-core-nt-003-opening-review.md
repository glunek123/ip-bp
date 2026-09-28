# CORE-NT-003 开箱侵权审核 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 运营或来源客户企业的真实账号审核同一件已完成开箱的公证事项，侵权进入开箱待确认，不侵权留下原因并归档；两端只见各自授权数据，刷新后仍可读取。

**Architecture:** 保留现有 `NotaryMatter` 主状态、`NotaryMatterOpening` 及冻结材料引用。两个 HTTP 入口使用同一个审核 Command；事务内锁事项、重验身份和范围、版本、状态、冻结照片，写不可变决定、状态、审计和专用幂等回执。客户端单独提供最小读取 DTO 和精确照片授权；不复用内部 `lead.read` 范围。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Vue 3、Vitest/Jest、Playwright；沿用现有会话、请求层和私有材料存储。

## Global Constraints

- 基于已确认的 [NT-003 设计](../specs/2026-09-28-core-nt-003-opening-review-design.md)、公证 Living Spec 与 SD-41。`CORE-NT-007` 才补公证处外部账号和开箱入口；本任务不提前实现 NT-004/005/006。
- 仅前向迁移，不改已执行迁移；数据库操作仅指向 `backend/.env.test` 独立测试库，不能打印连接凭据或重置其他库。
- 当前分支已合入公证列表／侧栏修复，保留其代码与验证；两个新状态须进入已有列表筛选、计数和严格解码器。
- 高风险模型／Command／授权／材料隔离先做聚焦测试与独立 6 Sol Review，再集成；普通界面任务由 6 Luna 自审与聚焦测试交接。最终候选再做一次独立 6 Sol Review，Level 3 完整门禁与真实数据库浏览器验收。不在稳定候选形成前标完成。

## Task 1 — 前向模型与权限契约（高风险）

- [ ] 先在 `backend/src/modules/leads/notary-opening-review.service.spec.ts` 或专门迁移测试中写失败用例：两个结论的状态、不同身份的回执关联、不可变决定，以及旧 schema 升级。
- [ ] 在 `backend/prisma/schema.prisma` 和新建 `backend/prisma/migrations/<timestamp>_add_notary_opening_review/migration.sql` 增加 `ISSUANCE_DECISION`、`ARCHIVED`、审核决定与专用回执。审核者内部成员或客户企业绑定必须恰有其一；用数据库 FK、CHECK、唯一与不可变约束保护。旧 NT-001/002 事实不迁移或改写。
- [ ] 增加最小 `NOTARY_OPENING_REVIEW` 权限目录映射：`backend/src/access-control/permission-catalog.ts`、`prisma-access-control.store.ts`、`access-control.service.ts`、前端 `frontend/src/api/organization.ts` 及已有严格契约测试。仅有效内部授权覆盖来源线索；客户不获得内部角色。
- [ ] 运行 Prisma generate、后端权限目录／前端解码器聚焦测试、迁移空库与上一支持 schema 专项；记录真实结果与失败。模型和约束经独立高风险 Review 后才进入下一任务。

## Task 2 — 单一审核 Command 与事务（高风险）

- [ ] 用 `backend/src/modules/leads/notary-opening-review.service.spec.ts` 先覆盖：运营和客户正常审核、另一企业／部门拒绝、停用／撤绑下一请求拒绝、无 Action／超范围拒绝、错误状态／无冻结照片拒绝、旧版本拒绝、相同键重放、异参冲突、跨身份并发仅一胜、决定／审计／回执故障回滚。
- [ ] 新建 `backend/src/modules/leads/notary-opening-review.service.ts`：请求规范化与指纹；事务内按部门锁事项，先实时重验操作者身份及独立范围，再查本动作回执，再校验状态和版本；写决定、归档事实或待确认状态、审计、回执；仅序列化冲突有限重试，重放不重复审计。
- [ ] 在 `backend/src/modules/leads/lead-notary.dto.ts`、`lead-notary.controller.ts`、`client-lead.controller.ts`、`lead.module.ts` 增加两个薄 POST 入口，同一 DTO/Command，必须 `expectedVersion`、`idempotencyKey`，不复制状态机。同步受影响 OpenAPI 测试。
- [ ] 运行 Command／Controller 聚焦测试与真实 PostgreSQL 权限、幂等、并发、回滚用例；独立高风险 Review 关闭发现后集成。

## Task 3 — 客户读取与照片字节隔离（高风险）

- [ ] 先补 `backend/src/modules/leads/client-notary.service.spec.ts`、`backend/src/modules/materials/material.service.spec.ts` 的负向用例：其他客户、未绑定／停用、其他部门、未冻结或其他批次照片、未推送线索，以及不得返回内部物流／费用／团队。
- [ ] 新建 `backend/src/modules/leads/client-notary.service.ts` 与 `client-notary.controller.ts`，只返回本企业公证事项的最小列表／详情、所选商品与本事项冻结的照片引用。用现有客户绑定与会话规则逐请求校验，不采用内部 SELF／TEAM／DEPARTMENT 范围。
- [ ] 在 `backend/src/modules/materials/material.service.ts` 的读取授权中为客户端增加精确 `NOTARY_MATTER` 分支：必须绑定源企业、同部门、`NOTARY_OPENING_PHOTO` 所有者及对应已提交冻结引用；其他材料沿用旧规则。下载在授权后读取私有字节，不扩大上传或内部范围。
- [ ] 运行读取／材料聚焦测试和真实数据库跨企业、跨批次、撤权后的下一请求验证；独立高风险 Review 关闭发现后集成。

## Task 4 — 双端请求与界面（普通执行）

- [ ] 先在 `frontend/src/api/notary.spec.ts`、运营详情与新增客户端页面组件测试中写失败用例：严格新状态／结论解码、无默认结论、原因必填、提交锁定、成功重读、稳定错误、无权限只读、附件下载。
- [ ] 更新 `frontend/src/api/notary.ts`、`frontend/src/modules/leads/NotaryMatterDetailPage.vue`：运营仅在可审核时显示两个结果与后果说明、提交状态和记录；保留原开箱功能。
- [ ] 新增最小 `frontend/src/api/client-notary.ts` 与 `frontend/src/modules/client/ClientNotaryListPage.vue`、`ClientNotaryDetailPage.vue`；在 `frontend/src/app/router.ts`、`AppShell.vue` 及既有客户端线索上下文加入可发现入口，使用同一视觉语言、不显示内部字段。
- [ ] 更新 `frontend/src/modules/leads/NotaryMatterListPage.vue`、`AppShell.vue` 的新增阶段及计数，保留未交付后续动作不可点击。运行相关 Vitest、类型和 `pnpm check:fast`；普通任务 self-review 后交接，不重复完整 Review。

## Task 5 — 数据库与浏览器主链、集成收口（高风险）

- [ ] 扩展 `tests/support/core-lead-database.mjs`、`tests/e2e/core-leads.spec.ts`，用真实管理员／运营／客户账号：准备不同企业与真实开箱照片，运营审核侵权和客户审核不侵权，另一企业不可见／不可下载，刷新与重登录后持久化。覆盖该 slice 必要的撤权、并发与错误路径，禁止预置结论冒充 UI 链路。
- [ ] 核对从空库和上一支持 schema 的迁移；先独立测试库的临时 schema 预检，再按项目正式受控入口验证，不触碰开发／生产库。聚焦 E2E 与 `pnpm check:fast` 是开发反馈；稳定候选进行独立 6 Sol Final Review，修复并补审。
- [ ] 在最终业务契约与代码稳定后固定 commit/tree；运行 `pnpm verify`、适用完整数据库浏览器门禁及迁移专项，不重复紧邻已被门禁包含的检查。保持候选不变，记录真实成功／失败与证据。
- [ ] 只有完整页面、API、数据库、身份／材料隔离、迁移与浏览器验收全通过，才更新 `docs/feature-roadmap.md`、`docs/project-status.md`、`VALIDATION.md`：NT-003 Done，NT-007 Current，NT-004 Next。解释漂移后执行标准 `context:record` 与 `context:check:strict`，核对收口差异。仅本地提交，不 push／merge。
