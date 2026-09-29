# CORE-NT-006 Return Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让有权运营人员一次原子办理 `WAITING_RETURN → ARCHIVED`，分别留存退货归档及退款／运费事实，并完成双端只读和真实数据库／浏览器验收。

**Architecture:** 复用公证事项内部 Command 的锁、授权、审计、幂等回执及现有详情页。新增一条归档主事实和零至两条独立金额事实；归档后读取按来源区分不侵权、出证与不出证退货，不创建案件或付款指令。

**Tech Stack:** NestJS 11、Prisma 7、PostgreSQL、Vue 3、Jest、Vitest、Playwright。

## Global Constraints

- 仅用 `backend/.env.test` 的独立测试库；不重置开发／生产库，不改已执行迁移。
- 每个新 PowerShell 进程执行 Node／pnpm 前先运行 `. .\Use-ProjectRuntime.ps1`，核对 Node `24.21.0` 与 pnpm `11.27.0`。
- 原样品支出与退款不同身份；`KNOWN` 非负且必填金额，`PENDING` 不存假 `0`；已知正退款累计不得超过已知原支出。
- 后端核验身份、Grant、部门／来源范围、阶段、版本、幂等和并发；客户端只见本企业最小归档结论，不见内部费用。
- 不开发付款、结算、待定金额更正、重开、批量退货或凭证必传；CORE-CA-001 不提前领取。

---

### Task 1: 前向数据模型与迁移

**Files:** `backend/prisma/schema.prisma`；新建 `backend/prisma/migrations/20260929010000_add_notary_return_archive/migration.sql`、`backend/src/modules/leads/core-nt-006-migration-probe.mjs`、`backend/src/modules/leads/core-nt-006-migration.spec.ts`。

**Interfaces:** 产生 `NotaryReturnArchive`、`NotaryReturnAmount`、`NotaryReturnChoice`、`NotaryReturnAmountKind`、`NotaryReturnPartyKind` 及 `NOTARY_RETURN_ARCHIVE`。金额行以 `(archiveId, kind)` 为稳定身份；退款行引用 `NotaryMatterEvidence.matterId`，原样品金额不改写。

- [ ] **Step 1 — RED:** 增加迁移专项断言：空库迁移后能插入合法 `RETURN` 归档及两条金额；数据库拒绝负数、`PENDING` 携金额、`KNOWN` 缺金额、无原支出退款、跨事项原支出及改写已确认记录。先运行 `pnpm --filter @dev-cor/backend test src/modules/leads/core-nt-006-migration.spec.ts`，预期因新结构不存在而失败。
- [ ] **Step 2 — GREEN:** 为归档与费用建立分表、复合来源外键、选择／金额状态 CHECK、不可变触发器；增加授权 Action 的枚举值，旧记录保持原样。运行 Prisma 生成与格式检查，运行上述聚焦测试，应 PASS。
- [ ] **Step 3 — migration probe:** 在随机临时 schema 运行完整空库链与上一支持 schema 的合成旧数据升级；记录试运行和目标独立测试库迁移结果，不修改旧迁移。提交仅本 Task 文件。

### Task 2: 运营 Command、权限与 API

**Files:** 新建 `backend/src/modules/leads/notary-return-archive.service.ts`、`notary-return-archive.dto.ts`、`notary-return-archive.service.spec.ts`；修改 `lead-notary.controller.ts`、`lead.module.ts`、`backend/src/access-control/{access-control.service.ts,permission-catalog.ts,prisma-access-control.store.ts}` 及直接契约测试。

**Interfaces:** `POST /api/v1/notary-matters/:id/return-archive`，头 `Idempotency-Key`；请求为 `{ returnChoice, refund?, freight?, archiveReason, expectedVersion }`，金额对象为 `{ state, amount?, partyKind?, partyName? }`；返回 `{ id, stage:'ARCHIVED', version, returnArchive }`。KEEP 禁止金额对象，REFUND_ONLY 只允许退款，RETURN 要求退款与运费。

- [ ] **Step 1 — RED:** 服务测试先表达合法三分支、已知／待定和零金额、越权／跨部门／撤权、错误状态／NO_ISSUE 前置、超额退款、旧版本、同键重放／异参、双请求竞争，以及归档／费用／审计／回执任一失败的整体回滚。运行 `pnpm --filter @dev-cor/backend test src/modules/leads/notary-return-archive.service.spec.ts`，预期因 Command 未实现失败。
- [ ] **Step 2 — GREEN:** 参照 `NotaryIssuanceDecisionService.decide` 的事务模板：先锁本事项，再于事务内读取当前账号和授权、回执、前置事实及原样品金额；规范化输入并计算指纹；校验已知退款与既有同源退款总额；写归档、金额、阶段／版本、成功审计与回执。只对序列化竞争作有界重试，未提交不得返回成功。聚焦测试应 PASS。
- [ ] **Step 3 — contract:** 同步权限目录、内部 Grant 映射、OpenAPI DTO 与 Controller 测试，校验旧角色／人员页面的严格权限解码器仍可工作；运行后端直接测试和 `pnpm check:fast`，提交本 Task 文件。高风险模型／Command 交独立 Sol Reviewer 审查通过后再接读模型。

### Task 3: 三类归档读模型与前端操作

**Files:** 修改 `backend/src/modules/leads/{lead-notary.service.ts,client-notary.service.ts,client-notary-response.dto.ts,lead-notary.dto.ts}` 及直接测试；修改 `frontend/src/api/{notary.ts,organization.ts}`、`frontend/src/modules/leads/NotaryMatterDetailPage.vue`、`frontend/src/modules/client/ClientNotaryDetailPage.vue` 及直接组件／API 测试。

**Interfaces:** 内部详情新增 `capabilities.archiveReturn` 与可空 `returnArchive`；客户详情仅新增 `{ returnChoice, archiveReason, archivedAt }` 的只读摘要。内部页在 `WAITING_RETURN` 显示条件字段、必填标识、不可逆影响、加载与稳定错误；归档后显示服务端事实。

- [ ] **Step 1 — RED:** 后端读测试先要求 `ARCHIVED` 可分别识别不侵权、证书和退货，不把后两者当不侵权；客户读取断言企业隔离、无内部金额／收付方。前端 API 与页面测试先要求条件表单、提交、刷新后记录、无权不可见和错误反馈。运行直接 Jest／Vitest，预期因新读字段和动作缺失失败。
- [ ] **Step 2 — GREEN:** 仅扩展现有查询与解码器，不建平行客户端；服务端重新校验来源归档事实，客户只投影最小字段。实现表单并复用现有请求层与 Demo 对齐组件。再次运行直接 Jest／Vitest 与 `pnpm check:fast`，应 PASS；提交本 Task 文件。

### Task 4: 数据库型端到端、契约和文档

**Files:** 扩展 `tests/support/core-lead-database.mjs` 与 `tests/e2e/core-leads.spec.ts` 的 NT-006 场景；更新 `docs/spec/v0.1/{DECISIONS.md,GAPS.md,modules/notary.md,VALIDATION.md}`、`docs/feature-roadmap.md`、`docs/project-status.md` 中实际受影响段落。

- [ ] **Step 1 — RED:** 先增加真实 PostgreSQL／Chromium 场景：运营密码登录→不出证→办理退货→刷新／重登回看，客户只读本企业结论，其他企业拒绝；API 负向覆盖超额与并发、审计／回执回滚、撤权下一请求。运行已核实入口 `node scripts/run-e2e.mjs tests/e2e/core-leads.spec.ts --grep "return archive"`，必须观察新场景因功能缺失失败。
- [ ] **Step 2 — GREEN:** 用前面 Task 的实际 API／页面和最小 fixture 完成场景；运行匹配的新 E2E，确认持久化、隔离与回滚 PASS。修复发现的问题后，补受影响契约及迁移专项；不改断言或用重试掩盖失败。
- [ ] **Step 3 — candidate:** 必要独立 Final Review 在所有 Task 集成后进行，finding 修复并补审；同步最终业务契约但不提前标完成，固定代码候选并运行完整 `pnpm verify`、空库／上一 schema 迁移专项、隔离数据库／Chromium 全量 E2E。完整证据写入既有 VALIDATION，只有全通过才推进 roadmap 为 CORE-CA-001 Current、下一 CA Slice Next。收口差异单独检查后执行 `context:record` 与 `context:check:strict`，按已核实规则判断是否复用候选证据。

## Plan self-review

已覆盖角色、状态、版本、权限、金额、幂等、并发、审计、读隔离、页面、迁移和真实浏览器；不把待定金额冒充支付完成。新业务语义必须先回到设计确认。
