# CORE-NT-007 公证处身份与开箱入口实施计划

> 本计划执行已由 SD-41 和用户确认的切片；以 [小粒度设计](../specs/2026-09-28-core-nt-007-notary-account-opening-design.md)为业务边界。各任务先写聚焦失败测试，再写最小实现、跑通聚焦测试并自审。高风险任务先独立 Sol Review，集成后再独立 Final Review 和 Level 3 门禁。

**Goal:** 管理员正式创建绑定账号，公证处以真实账号只对本公证处获分派事项完成 NT-002 开箱，刷新后事实与照片仍在。

**Architecture:** 复用现有 `UserAccount`／密码会话、`NotaryOpeningService` 与私有材料；新增独立公证处绑定、限定外部读取及外部操作者外键路径。运营和公证处共用一次开箱事务，不共用运营数据范围或详情 DTO。

**Tech Stack:** NestJS、Prisma、PostgreSQL、Vue 3、Vitest／Jest、Playwright。

## Global Constraints

- 只使用 `backend/.env.test` 对应的隔离测试库；不重置开发／生产库、持久化卷。
- 只做 `WAITING_UNBOX → UNBOX_REVIEW` 的公证处真实入口；NT-004／005 保持未实现。
- 不创建公证处内部 `DepartmentMembership` 或 `RoleAssignment`；绑定固定到一个部门／公证处，撤权后下一请求失效。
- Command 继续要求 `expectedVersion`、`Idempotency-Key`、真实照片、原子审计和回执；外部账号仅可处理明确分派事项。
- 不删除测试、放宽断言或用 Mock／手工改库代替正式账号与数据库／浏览器主链。

## Task 1：账号模型、迁移与认证（高风险 Sol）

**Files:** `backend/prisma/schema.prisma`；新建 `backend/prisma/migrations/20260928030000_add_notary_accounts_and_opening_actor/migration.sql`；`backend/src/auth/auth.service.ts`、`backend/src/auth/auth-response.dto.ts`、`backend/src/access-control/actor-context.ts`；`backend/src/modules/leads/notary-office-account.service.ts`及相邻 DTO／Controller／Module；直接 Jest 与迁移测试。

**Interfaces:** `ActorContext.notaryOfficeId?: string`；会话 `principalType: 'INTERNAL' | 'CLIENT' | 'NOTARY'`、`notaryOffice: {id,name} | null`；管理员 `GET/POST /notary-offices/:id/accounts`、`PATCH /notary-offices/:id/accounts/:userId/status`，响应只含账号 ID、姓名、用户名、账号／绑定状态及版本。

- [ ] 写失败测试：无绑定、跨部门或停用公证处不能建／登录；有效绑定可密码登录，且不携带内部成员或客户权限；停用账号／绑定或公证处后旧会话下一请求失效；创建、状态变更失败不留半写入。
- [ ] 用仓库已确认的 `pnpm --filter @dev-cor/backend test <测试文件>` 跑红，确认失败原因是缺少行为。
- [ ] 前向迁移增加 `NOTARY`、不可改绑的 `NotaryOfficeAccountBinding`；将现有上传草稿、开箱事实、通用审计及开箱回执扩展为内部成员或公证处绑定的互斥操作者路径，保留旧记录与内部外键约束。账号服务只接受当前内部 `notary.office.manage` 部门权限，凭据和绑定同事务创建并审计，状态变更撤销会话。
- [ ] 跑聚焦 Jest、Prisma 生成／类型检查；隔离测试库验证空库及上一支持 schema 前向升级，再做独立 Sol Review。

## Task 2：公证处范围、材料与开箱事务（高风险 Sol）

**Files:** `backend/src/modules/leads/notary-portal.service.ts`及 Controller／DTO／Module；`backend/src/modules/leads/notary-opening.service.ts`；`backend/src/modules/materials/material.service.ts`；直接 Jest 与数据库测试。

**Interfaces:** `GET /notary-portal/matters` 返回本公证处待开箱分页列表；`GET /notary-portal/matters/:id` 返回最小开箱详情；`POST /notary-portal/matters/:id/opening` 调用既有 `NotaryOpeningService.record`。材料继续走现有草稿、上传、列表和版本下载入口。

- [ ] 写失败测试：其他公证处／部门事项、无绑定、停用账号、公证处或被撤权账号不得读、上传、下载或提交；未提交照片只对上传者可见；不泄露客户、费用、内部备注；直接调内部入口不扩大读取。
- [ ] 写失败测试：合法提交、同键重放与异参冲突、旧版本和错误阶段、运营／公证处竞争、审计／回执／冻结失败整事务回滚。
- [ ] 跑聚焦测试确认红；在事务内按账号类型分派两条身份授权路径，共用状态机与照片校验，按 Task 1 的外部操作者路径保存真实身份和审计。严格限定材料读取／字节下载与删除／恢复，重放前重新鉴权。
- [ ] 跑聚焦 Jest、隔离 PostgreSQL 集成和必要类型检查，再做独立 Sol Review。

## Task 3：正式页面与请求契约（普通 Luna）

**Files:** `frontend/src/api/auth.ts`、`frontend/src/api/notary-portal.ts`、`frontend/src/api/notary-office-accounts.ts`、`frontend/src/app/router.ts`、`frontend/src/app/AppShell.vue`、`frontend/src/modules/auth/LoginPage.vue`、`frontend/src/modules/leads/NotaryOfficesPage.vue`；新建 `frontend/src/modules/notary/` 的待办及详情页和直接测试。

- [ ] 写失败测试：第三类会话严格解码并落到独立公证端；管理员可建、停用／启用账号；公证端只显示本公证处待办、详情及真实上传／提交反馈，刷新后显示已保存事实。
- [ ] 跑前端聚焦测试确认红；复用共享壳层和组件，给必填项标记及提交后果说明，不挂未实现出证／审核入口。
- [ ] 跑前端聚焦测试、类型检查、格式检查；自审并报告契约变更与风险，不默认独立 Task Reviewer。

## Task 4：集成验收与收口（主 Agent）

- [ ] 将任务 1～3 的实际改动和测试结果按契约集成；补真实数据库与受控 Chromium 主链：管理员建绑定→运营创建待开箱事项→公证处登录→上传／提交→刷新／重登读取；验证其他公证处和撤权的负例。
- [ ] 集成后跑 `pnpm check:fast` 和受影响回归；固定候选，独立 Sol Final Review，修复后补审。
- [ ] 稳定候选运行 `pnpm verify`、适用完整隔离数据库／Chromium E2E、迁移空库与上一支持 schema 验证；以实际结果记录 `VALIDATION.md`，通过后才更新路线图 Current／Next 和项目状态。
- [ ] 核对最终 diff、上下文漂移，标准 `pnpm context:record` 与 `pnpm context:check:strict`；提交本切片，默认不推送／合并／部署。
