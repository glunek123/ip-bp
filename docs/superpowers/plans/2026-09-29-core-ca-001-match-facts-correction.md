# CA-001 匹配事实口径修正 Implementation Plan

> **For agentic workers:** Implement task by task with failing focused tests first; preserve the current CA-001 permission, transaction and idempotency contract.

**Goal:** 主办律师姓名必填、律所选填；运营可填写实际匹配日期，系统匹配及审计时间独立留存。

**Architecture:** `Case.matchedOn`使用PostgreSQL `DATE`保存实际业务日期，`Case.matchedAt`继续保存服务端时间点。旧记录`matchedOn=NULL`代表未知，不回填猜测；`LawyerProfile.lawFirm`可空。匹配Command把日期纳入校验、指纹、事务、审计和回执；详情API与页面分别展示业务日期和系统时间。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Vue/Vitest、Jest、Playwright。

## Global Constraints

- 只添加前向迁移，不改既有迁移或历史记录；只用`backend/.env.test`独立测试库。
- 不变更`case.match`授权、案件范围、乐观版本、幂等及失败原子性。
- 业务日期传`YYYY-MM-DD`、存`DATE`；时间点由服务端生成，传带时区ISO 8601。
- 先定向红绿测试，再Review，稳定候选按仓库规则完成迁移专项和门禁。

---

### Task 1: 数据约束与迁移

**Files:** `backend/prisma/schema.prisma`、`backend/prisma/migrations/20260929022000_correct_case_match_facts/migration.sql`、`backend/src/modules/cases/case-match-migration.spec.ts`、`backend/src/modules/cases/core-ca-001-migration-probe.mjs`。

**Interfaces:** `Case.matchedOn: DateTime? @db.Date`；`LawyerProfile.lawFirm: String?`。

- [x] 测试先断言新迁移新增`matched_on DATE`、律所可空、已知非空律所约束仍生效；旧案日期保持NULL。
- [x] 运行聚焦迁移测试确认RED，再新增迁移：`ALTER TABLE "cases" ADD COLUMN "matched_on" DATE; ALTER TABLE "lawyer_profiles" ALTER COLUMN "law_firm" DROP NOT NULL;`，用`law_firm IS NULL OR (...)`约束非空值。
- [x] 更新Prisma schema，生成Client；用隔离临时schema验证空库和上一支持schema升级、失败回滚、旧值保留与NULL绕过DTO负例。

### Task 2: 匹配Command与详情契约

**Files:** `backend/src/modules/cases/case-match.dto.ts`、`backend/src/modules/cases/case-match.service.ts`、`backend/src/modules/cases/case-match.service.spec.ts`、`backend/src/modules/cases/case-read.dto.ts`、`backend/src/modules/cases/case-read.service.ts`、`backend/src/modules/cases/case-read.service.spec.ts`。

**Interfaces:** 新匹配请求必须包含`matchedOn: YYYY-MM-DD`，`lawyer.lawFirm?: string`；仅升级前已成功旧回执的同键同请求原样重放可不含日期，返回`matchedOn: null`且不产生新写入；回执和详情包含`matchedOn`（旧案为null），`matchedAt`仍是服务端ISO时间点。

- [x] 测试先覆盖过去日期+未知律所成功、空白／非法／未来日期拒绝、同键变更日期冲突、旧案读出日期NULL、旧成功回执兼容原样重放、审计和回执同时保留日期；运行聚焦测试确认RED。
- [x] 实现日期严格校验、上海业务日上限、可空律所规范化；日期纳入原有指纹、事务写入、审计、回执和详情投影，系统时间不接收客户端值。
- [x] 运行后端聚焦Jest和类型检查确认GREEN；不改变权限、锁及事务结构。

### Task 3: 页面、API与浏览器闭环

**Files:** `frontend/src/api/cases.ts`、`frontend/src/api/cases.spec.ts`、`frontend/src/modules/cases/CaseDetailPage.vue`、`frontend/src/modules/cases/CasePages.spec.ts`、`tests/e2e/cases.spec.ts`。

**Interfaces:** 页面日期默认上海当天且可选真实过去日期；律所和电话留空时不发假值；详情旧案显示“未记录”。

- [x] 前端测试先断言默认日期、手改日期、留空律所提交、旧案未知日期显示、非法响应拒绝；运行聚焦Vitest确认RED。
- [x] 修改API类型／严格解码、表单和详情，保持状态反馈与幂等键复用；运行聚焦Vitest确认GREEN。
- [x] 增加真实PostgreSQL／Chromium用例：页面补录过去日期和未知律所→推进→刷新、重登仍读到；非法日期、同键异日期、失败回滚与既有权限/并发路径继续验证。

### Task 4: 收口

**Files:** 本计划涉及的Spec、`docs/spec/v0.1/VALIDATION.md`、必要上下文快照。

- [x] 独立Review迁移、日期语义及Command影响；关闭finding。
- [x] 固定候选。
- [x] 运行`pnpm spec:check`、`pnpm check:fast`、受影响格式、迁移专项、完整`pnpm verify`和隔离数据库／Chromium E2E；记录真实候选与结果，不预写通过。
- [x] 核对diff、解释上下文漂移并记录快照；仅提交本任务文件，不推送／合并。
