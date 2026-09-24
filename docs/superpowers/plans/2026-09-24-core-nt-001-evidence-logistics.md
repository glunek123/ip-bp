# CORE-NT-001 取证与物流登记实施计划

> **实施依据：** 已获确认的[核心主线设计](../specs/2026-09-21-core-business-mainline-roadmap-design.md)、[字段与动作契约](../specs/2026-09-21-core-flow-field-material-contract.md)、[公证模块 Spec](../../spec/v0.1/modules/notary.md)及 SD-14／26／37。本文只细化本 Slice，不维护动态完成台账。

**目标：** 有权运营对已移交、仍待取证的公证事项一次性登记真实取证日期、样品费状态及至少一条逐字段明确的物流事实，原子推进 `PENDING_EVIDENCE → WAITING_UNBOX`。刷新后详情可见，不产生虚假单号。

**边界：** 只支持 `ONLINE_PURCHASE`。不做线下调查、草稿保存、开箱材料、自动物流匹配、物流更正、退货、出证或外部公证处账号。`NONE` 是明确无，不作为可匹配字符串；金额 `PENDING` 时不写 `0`。旧事项可前向升级，原线索和来源快照不改写。

## 文件和接口落点

- `backend/prisma/schema.prisma`及一份新迁移：扩充阶段；单独新增事项一对一、提交后不可修改的取证事实（日期、样品费状态／金额、服务端确认人／时间）及有稳定行身份、顺序和公司／单号各自状态和值的物流行，避免放宽已有事项来源不可变触发器。复用 `AuditEvent` 并为事项 Command 建最小幂等回执，不新建并行事件表。
- `backend/src/modules/leads/lead-notary.*` 或同模块内聚焦的 evidence service／DTO：`POST /api/v1/notary-matters/:id/evidence`，请求 `evidenceAt: YYYY-MM-DD`、`sampleFeeState: KNOWN | PENDING`、条件 `sampleFeeAmount`、`logistics[1..n]`（每行 `companyState/value?`、`trackingState/value?`）、`expectedVersion`，并携带 `Idempotency-Key`。服务端重查内部账号、当前 Grant／部门范围、事项阶段与版本；事务内保存事实、阶段、版本、成功审计及回执。`GET /notary-matters/:id` 扩充当前事实和可操作能力，不能以按钮可见性代替授权。
- 权限目录、Prisma Action 枚举映射、前端解码器和人员／角色契约同步增加单一动作 `NOTARY_EVIDENCE_RECORD`；读范围沿用事项来源线索的受限范围，不让客户账号进入内部权限路径。
- `frontend/src/api/notary.ts`、`frontend/src/modules/leads/NotaryMatterDetailPage.vue`及直接测试：待取证时展示简洁登记表，日期与金额条件必填有明确标记，公司和单号分别选“有／无”，有时才填真实值；提交前说明推进后待开箱，处理加载、成功与稳定错误。完成后只读显示取证记录与物流行。
- `tests/e2e/core-leads.spec.ts`及现有数据库测试支撑：从真实登录和 LD-006 移交继续执行本动作、刷新读取；负向用独立测试库验证。

## 实施与验证顺序

1. **测试先行与迁移。** 为服务端合法／非法日期、金额和物流状态写失败测试并确认红灯；建立前向迁移和模型，生成 Prisma 客户端后让聚焦测试转绿。空库及上一支持 Schema 分别执行迁移验证；仅用 `backend/.env.test` 独立库。
2. **高风险 Command。** 先补失败测试覆盖无权限／跨部门、错误阶段、过期版本、同键重放与异参、并发竞争、审计或回执失败整体回滚、权限撤销后立即失效，再实现事务、幂等、审计和详情投影。高风险实现由独立 Sol Review，通过后才集成。
3. **接口与页面。** 先给前端解码器和页面写失败测试，再实现真实表单与结果页；同一个请求键只在安全重试时复用，用户改变字段则换键。运行直接相关的 Jest／Vitest、`pnpm check:fast`，普通 UI Task 自审即可。
4. **稳定候选。** 集成后独立 Sol Final Review；修复后固定候选，运行 `pnpm verify`、适用迁移专项和独立 PostgreSQL＋Chromium 浏览器验收。正式门禁前不标完成；证据落在 `docs/spec/v0.1/VALIDATION.md`，最后仅在全部通过后推进路线图 Current／Next 与状态快照。

**浏览器主链：** 有权运营真实登录 → 已移交线索打开待取证事项 → 填取证日期、样品费“已知／待定”及一条真实物流或明确无 → 确认提交 → 显示待开箱和操作记录 → 刷新／重登录仍可读；无权运营和其他部门不能执行或读取。
