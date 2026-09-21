# CORE-LD-001 Task 3 实施报告

## 状态

DONE_WITH_CONCERNS（客户正式准入 Command、HTTP 边界、客户响应能力/历史和审查加固均已实现；已用隔离的随机端口 PostgreSQL 17 验证迁移部署与历史回执 backfill，未运行固定测试库 E2E、浏览器 E2E 或完整 `pnpm verify`，生产材料存储仍受既有 E02 限制。）

## 实现

- 新增 `POST /customers/:id/admission`，`Idempotency-Key` 从请求头读取、trim 后限制为 1～128 字符；DTO 使用白名单全局管道严格拒绝未知字段，客户/证件/有效期模式只接受稳定 Code。
- 导出并复用唯一客户类型—证件类型兼容矩阵，覆盖企业、个体工商户、自然人、事业单位、社会组织和其他组织的全部批准组合；服务层再次拒绝未知 Code，避免非 HTTP 调用绕过。
- 校验联系人姓名及电话/邮箱至少一项；`FIXED` 要求结束日且不早于开始日，`LONG_TERM/NOT_STATED` 不允许结束日；业务日期按 `YYYY-MM-DD` 写入 Prisma `Date` 字段。
- `NATIONAL_ID` 只接受一份 `IDENTITY_FULL` PDF，或一份 `IDENTITY_FRONT` 图片加一份 `IDENTITY_BACK` 图片；其他证件只接受 `IDENTITY_FULL`。
- 准入在单个 Serializable 事务内执行：加载当前 `customer.admit` 范围快照、确认可见、`FOR UPDATE` 锁客户、处理既有回执、检查版本/DRAFT、归一化和部门内证件唯一、调用 `MaterialService.assertAvailableVersions()`、调用 `freezeReferences()`、更新 ADMITTED/version/admittedAt、写 `customer.admitted` 审计、写 `CustomerAdmissionReceipt`。
- 材料 owner/部门/状态/版本授权完全由 Task 2 的事务绑定接口处理；Task 3 不复制材料表查询或范围逻辑。新增 `materials/index.ts` 作为跨模块公共入口以满足架构门禁。
- 幂等指纹只保存 SHA-256；同操作者/部门/Key 的相同请求直接解析并返回首次成功写入的完整响应快照，不再从可变 Customer 当前态拼接旧版本；不同指纹统一返回 `IDEMPOTENCY_CONFLICT`。并发身份唯一约束失败不会伪装成功。
- 客户列表/详情/编辑响应现统一暴露 `profileStatus: draft|admitted`、证件有效期、`admittedAt`；详情增加基于 `customer.admit` 的 `capabilities.admit`，共享历史直接映射 `customer.admitted`。
- 普通编辑不写 `profileStatus`、`admittedAt` 或材料引用；已准入客户的 `name/customerType/identityType/identityNumber` 不可改变或清空，同义重复输入保持原展示值，category 等日常字段仍可编辑并保持 ADMITTED/冻结引用。
- 审计 details 仅含版本、稳定类型 Code、有效期模式和材料数量，不记录完整证件号、联系人或文件元数据。

## 文件

### 新增

- `backend/src/modules/customers/customer-admission.dto.ts`
- `backend/src/modules/customers/customer-admission.service.ts`
- `backend/src/modules/customers/customer-admission.service.spec.ts`
- `backend/src/modules/materials/index.ts`
- `.superpowers/sdd/task-3-report.md`
- `backend/src/modules/customers/customer-identity.ts`
- `backend/src/modules/customers/customer-identity.spec.ts`
- `backend/prisma/migrations/20260921015000_add_admission_receipt_snapshot/migration.sql`

### 修改

- `backend/src/modules/customers/customer.controller.ts`
- `backend/src/modules/customers/customer.controller.spec.ts`
- `backend/src/modules/customers/customer.service.ts`
- `backend/src/modules/customers/customer.service.spec.ts`
- `backend/src/modules/customers/customer.module.ts`
- `backend/src/modules/customers/customer.dto.ts`
- `backend/src/modules/customers/rights-holder.service.ts`
- `backend/src/modules/customers/rights-holder.service.spec.ts`
- `backend/src/modules/leads/core-ld-migration.spec.ts`
- `backend/prisma/schema.prisma`
- `tests/e2e/customers.spec.ts`
- `docs/spec/v0.1/TECHNICAL-DESIGN.md`
- `docs/superpowers/plans/2026-09-21-core-ld-001-waiting-push-lead.md`
- `docs/superpowers/specs/2026-09-21-core-flow-field-material-contract.md`

## TDD 证据

### 初始 RED

命令：

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/customers/customer-admission.service.spec.ts src/modules/customers/customer.controller.spec.ts
```

结果：2 suites failed、0 tests；TypeScript 精确报告找不到 `customer-admission.dto` 和 `customer-admission.service`。先修正测试参数表自身的类型展开问题后重跑，仍只剩上述缺失功能 RED。

### 服务边界 RED→GREEN

- 未知 `customerType`：首次得到 `TypeError: Cannot read properties of undefined (reading 'includes')`；加入受控 Code 服务层防御后通过。
- 未知 `identityValidityMode` 且无结束日：首次错误地完成准入；加入有效期模式受控 Code 防御后通过。

### 最终 GREEN

命令：

```powershell
. .\Use-ProjectRuntime.ps1
pnpm --filter @dev-cor/backend test src/modules/customers/customer-admission.service.spec.ts src/modules/customers/customer.controller.spec.ts src/modules/customers/customer.service.spec.ts
```

结果：3 suites、81 tests 全通过；覆盖兼容矩阵、三种有效期、联系人、NATIONAL_ID 两种材料组合、其他证件 FULL、材料失败代理、权限/部门、版本、重复身份、幂等重放/冲突、审计失败和原子成功。

额外客户模块回归曾运行 `pnpm --filter @dev-cor/backend test src/modules/customers`：5 suites、110 tests 全通过；之后仅新增未知有效期 Code 的准入服务回归并做最终聚焦验证。

## 门禁

- `pnpm check:fast`：PASS；Architecture check 为 6 modules / 25 Prisma models，Prisma generate、backend/frontend/root TypeScript 与 ESLint 均通过。
- 目标 Prettier check：PASS，范围为受影响客户/迁移测试、合同/计划和本报告。
- `git diff --check`：PASS。
- 未运行完整 `pnpm verify`、固定测试库 E2E、浏览器 E2E或生产联调；审查修复新增的 schema/迁移已通过 Prisma 校验与隔离 PostgreSQL 17 探针。

## 自审

- `customer.admit` 范围和授权快照在 caller Serializable 事务内读取；目标查找保持不泄漏，跨部门返回相同不可见语义。
- 客户行锁、版本/DRAFT CAS、证件唯一、材料断言/冻结、客户状态、审计和回执都在同一事务；审计失败向上传播，事务不产生部分准入。
- 准入服务只接收 Task 2 返回的事务绑定 facts，purpose/MIME 组合校验后原样交给 `freezeReferences()`；未构造或伪造材料 facts。
- 指纹包含客户 ID、全部归一化准入字段、日期和精确内容版本 ID；不在审计或响应中泄漏指纹输入的敏感原文。
- 响应映射对 DRAFT 旧数据返回明确 null，对 ADMITTED 返回 date-only 有效期和 ISO `admittedAt`；普通编辑不降级状态。

## 担忧与限制

- Task 3 使用 mock transaction 单元测试证明所有写入共享同一个 callback 和失败传播；本轮未增加真实 PostgreSQL 故障注入测试，因此数据库级回滚仍依赖 Prisma/PostgreSQL 事务语义及既有 schema 约束。
- 生产对象存储、病毒扫描、备份恢复和生产加密仍属既有 E02；本 Task 只消费 Task 2 已批准的本地/测试材料事务接口，不改变该限制。
- 未运行完整仓库 `pnpm verify` 或浏览器 E2E；Task 3 尚无前端准入页面范围。

## 审查修复（2026-09-21）

### 实现

- 新增唯一共享 `normalizeCustomerIdentityNumber()`：NFKC、trim/合并展示空白、拉丁字母大写，并且仅从判重值移除批准的空白与连字符；准入、重复查询和草稿/普通编辑统一复用。无关字段编辑直接保留既有 `normalizedIdentityNumber`，不会重算。
- ADMITTED 客户的主体与证件四字段成为日常编辑不变量；空串、主体类型改变、证件类型或号码改变稳定返回 `INVALID_STATE`，category-only 和同义身份重复提交仍允许且不会改写证件展示值、状态或冻结引用。
- `CustomerAdmissionReceipt.resultSnapshot` 通过新前向迁移落为 `JSONB NOT NULL`；首次准入把实际响应、审计和回执置于同一 Serializable 事务，重放严格校验 ID/部门/版本/DTO 形状并只返回白名单快照字段，损坏快照返回 `INTERNAL_ERROR`。
- 整个准入事务对 Prisma `P2034` 最多尝试三次，每次从授权、客户行和回执重新读取；同键可从已出现的回执恢复，不同命令获胜后落为 `CUSTOMER_VERSION_CONFLICT`，连续冲突耗尽也稳定映射为该错误。
- 全仓正式实现、单元测试、E2E 断言与当前技术设计中的旧幂等冲突码统一为 `IDEMPOTENCY_CONFLICT`；历史审查快照文件不作为运行合同修改。

### TDD RED→GREEN

- 共享归一化 helper：首次运行 `customer-identity.spec.ts` 得到 TS2307（模块不存在）的纯 RED；新增 helper 后 1 suite / 3 tests GREEN。
- ADMITTED 不变量、号码唯一与快照/P2034：先追加客户、准入及迁移测试；实现初跑暴露回执 Prisma client 尚无 `resultSnapshot`（TS2345/TS2353）以及旧客户夹具缺失 canonical null 的 `VALIDATION_ERROR`，生成新 client 并修正保留语义后聚焦 3 suites / 76 tests GREEN。
- 统一旧主体关联幂等码：先把既有测试改为 `IDEMPOTENCY_CONFLICT`，得到 2 个明确失败（实际仍为 `IDEMPOTENCY_KEY_REUSED`）；修改实现后 1 suite / 22 tests GREEN。
- 最终客户模块回归：6 suites / 125 tests GREEN；包含 category-only 与同义身份输入、`AB-123`/`AB123` 判重、原始响应逐字段重放、损坏快照、P2034 恢复/版本变化/三次耗尽。

### 迁移与门禁

- 新鲜随机端口 `postgres:17.11-alpine` 空库执行 `prisma migrate deploy`：发现并成功应用 21/21 migrations。
- 同一临时 PostgreSQL 实例的独立 backfill 库先执行前 20 个迁移，再插入理论历史 ADMITTED 客户/回执并执行 15000 迁移：`result_snapshot` 为 `NOT NULL`，快照保留 receipt version=2 和当前可确认字段，历史号码 `ab - 123` 统一为 `AB123`。容器已停止并自动删除，未触碰固定测试库。
- 最终候选聚焦复跑 5 suites / 101 tests、完整 customers 6 suites / 125 tests 均 PASS；`prisma validate`、`pnpm check:fast`、`pnpm spec:check`、受影响文件 Prettier check 与 `git diff --check` 全部 PASS。

### 剩余担忧

- P2034 的三种分支由完整单元测试覆盖；本 Task 没有在真实 PostgreSQL 上人为制造并发 serialization 冲突，留给 Task 7 的数据库并发 E2E。迁移本身已在隔离 PG17 上执行真实空库和历史 backfill 探针。

## 第二次审查修复（2026-09-21）

### 实现与顺序

- 15000 迁移在任何号码或 schema 写入前检查全部 legacy receipt：Customer 必须以相同 `id/department_id` 存在，且当前 `customer.version` 必须精确等于 `receipt.result_customer_version`。不匹配时抛出不含客户/证件值的运维错误并由外层 `BEGIN/COMMIT` 原子回滚；只对版本可证明相等的数据构造快照。
- 准入服务拆分为无拒绝的 `canonicalizeForFingerprint()` 与事务内 `validateAndNormalizeDomain()`。前者只做稳定 trim/NFKC/号码 canonicalization 和 SHA-256 输入构造；权限、可见性、行锁、既有回执、版本/DRAFT 判断完成后，才执行兼容矩阵、联系人、日期和材料领域校验。
- 因而无权限/隐藏客户不会被领域错误侧漏，旧版本稳定返回 `CUSTOMER_VERSION_CONFLICT`；已有 Key 配上不兼容的新请求先按指纹返回 `IDEMPOTENCY_CONFLICT`，同键同指纹仍可直接重放快照。
- 合同与实施计划明确：该能力尚未正式部署，正常升级不预期 legacy receipt；若异常存在且版本/关联不符，必须依据审计证据人工恢复或清理，迁移不得自动猜测历史响应。

### TDD RED→GREEN

- 在准入服务增加无权限、隐藏客户、旧版本、同 Key 不兼容异指纹四种错误优先级回归；在迁移测试增加版本/关联 guard 必须先于 `result_snapshot` schema 写入的顺序断言。
- 首次运行 2 suites / 56 tests 得到 6 个预期失败：四种优先级均被 `CUSTOMER_ADMISSION_INCOMPLETE` 抢先，迁移 guard 缺失；另一个既有 not-found 用例因前置 normalize 未消费授权 mock 而串扰失败。实现拆分与 guard 后相同命令 2 suites / 56 tests 全部 GREEN。

### PostgreSQL 17 探针

- 随机端口全新 `postgres:17.11-alpine` 空库通过 21/21 `prisma migrate deploy`。
- matching 库先执行前 20 个迁移并插入 `customer.version=2 / receipt.version=2`：15000 成功，`result_snapshot NOT NULL`、号码 `AB123`、快照 version=2 与可确认字段正确。
- mismatch 库插入 `customer.version=3 / receipt.version=2`：15000 以预期无敏感值错误失败；事后 `result_snapshot` 列计数仍为 0、旧 normalized 值仍为 `legacy`，证明无半迁移。所有临时容器均已停止并自动删除，未触碰固定测试库。

### 最终门禁

- 最终候选聚焦准入/客户/迁移 5 suites / 105 tests、完整 customers 6 suites / 129 tests 均 PASS。
- `prisma validate`、`pnpm check:fast`（architecture、Prisma generate、backend/frontend/root TypeScript、ESLint）、`pnpm spec:check`、受影响文件 Prettier check 与 `git diff --check` 全部 PASS。
- 未运行固定测试库 E2E、浏览器 E2E 或完整 `pnpm verify`；随机端口 PG17 的空库/matching/mismatch 三路径已覆盖本次迁移风险。
