# CORE-NT-003 Task 3 交接报告

- Task: 高风险客户端公证读取、冻结照片字节隔离、运营详情审核事实投影。
- Model: GPT-6 Sol。
- Commit: `a90070d`（实现与测试）；本报告单独提交。
- Changed files: `backend/src/modules/leads/client-notary.service.ts`、`.spec.ts`、`client-notary.controller.ts`、`client-notary-response.dto.ts`、`lead-notary.service.ts`、`.spec.ts`、`lead.module.ts`、`backend/src/modules/materials/material.service.ts`、`.spec.ts`、`backend/src/core-ld-openapi.spec.ts`、`tests/e2e/core-leads.spec.ts`。

## Result / contracts

- 新增 `GET /api/v1/client/notary-matters`：仅列当前真实客户账号、活跃绑定、准入企业与同部门来源的 `UNBOX_REVIEW` 且有开箱事实的事项；稳定排序与分页。`GET /api/v1/client/notary-matters/:id` 返回本事项所选商品、精确冻结照片引用、审核结论与最小 capability，支持审核后刷新读取。每次请求重新检查账号、绑定和企业准入；`ActorContextGuard` 检查当前会话。
- 客户材料读取仅对源企业同部门公证事项的 `NOTARY_OPENING_PHOTO` 开放；字节下载还要求精确材料 ID、内容版本、事项资源引用、已提交开箱 `actionEvent`，且材料为活跃的对应事项照片。非冻结照片和其他批次不因材料 ID 可知而放行。内部旧读取分支保留。
- 运营原 `GET /api/v1/notary-matters/:id` 在 `lead.read` 范围内返回持久化审核决定／归档事实及独立 `reviewOpening` capability；后者另用 `notary.opening.review` 检查，不以读取权代替审核权。两端 DTO 均不返回内部操作者 ID、团队、物流、寄件信息、样品费或完整 `sourceSnapshot`。
- 未改上传、审核 Command、schema、内部权限、UI 或 NT-007。

## RED / GREEN / tests

- RED：新增材料聚焦用例先因客户公证 owner 分支 `ForbiddenException` 失败；客户端服务用例先因目标服务尚不存在失败；OpenAPI 新路由用例先因缺少响应 schema 失败。运营详情用例在增加决定投影前出现 TypeScript `reviewDecision` 缺失。
- GREEN：材料／客户端／运营详情 Jest 3 suites、94 tests；OpenAPI／材料控制器／审核控制器 3 suites、23 tests；`pnpm check:fast` 通过（架构、前后端类型、Lint）；`git diff --check` 通过。
- 真实 `backend/.env.test` PostgreSQL／Chromium 聚焦 E2E 4/4 通过：两种真实账号审核、并发与回滚，及本任务新增跨企业、同一线索双批次、未提交照片 404、撤销绑定后下一请求 401、实际 JPEG 字节一致。一次 E2E 失败是测试先提交开箱再尝试上传第二张未提交照片，违反现有阶段约束；将上传移到提交前后通过。未执行完整 `pnpm verify`，留给 Level 3 集成固定候选。

## Self-review / risks / Sol attention

- 自审核对所有客户端查询均使用真实绑定、企业、部门和推送事实；照片详情与材料字节各自验证开箱审计事件与精确引用；运营 capability 独立授权。`GET` 投影显式枚举输出字段，未散播原始 Prisma 记录或 JSON 快照。
- 待独立高风险 Sol Review：重点核对客户跨部门／跨企业、真实会话撤权、精确照片引用及字节下载、运营详情决定和 capability 语义。现有 E2E 用未提交照片和错误材料／版本组合验证拒绝；若 Reviewer 要求伪造跨事项引用或更多数据库畸形数据专项，应在集成前补测。
- Task 4 可以调用上述两个客户端 GET 和原运营详情 GET；列表只含待审核，详情允许 `UNBOX_REVIEW`、`ISSUANCE_DECISION`、`ARCHIVED` 用于提交后重读。
