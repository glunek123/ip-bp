# CORE-LD-001 Task 3 实施报告

## 状态

DONE_WITH_CONCERNS（客户正式准入 Command、HTTP 边界、客户响应能力/历史及聚焦回归已实现；未运行完整 `pnpm verify`、数据库 E2E 或浏览器 E2E，生产材料存储仍受既有 E02 限制。）

## 实现

- 新增 `POST /customers/:id/admission`，`Idempotency-Key` 从请求头读取、trim 后限制为 1～128 字符；DTO 使用白名单全局管道严格拒绝未知字段，客户/证件/有效期模式只接受稳定 Code。
- 导出并复用唯一客户类型—证件类型兼容矩阵，覆盖企业、个体工商户、自然人、事业单位、社会组织和其他组织的全部批准组合；服务层再次拒绝未知 Code，避免非 HTTP 调用绕过。
- 校验联系人姓名及电话/邮箱至少一项；`FIXED` 要求结束日且不早于开始日，`LONG_TERM/NOT_STATED` 不允许结束日；业务日期按 `YYYY-MM-DD` 写入 Prisma `Date` 字段。
- `NATIONAL_ID` 只接受一份 `IDENTITY_FULL` PDF，或一份 `IDENTITY_FRONT` 图片加一份 `IDENTITY_BACK` 图片；其他证件只接受 `IDENTITY_FULL`。
- 准入在单个 Serializable 事务内执行：加载当前 `customer.admit` 范围快照、确认可见、`FOR UPDATE` 锁客户、处理既有回执、检查版本/DRAFT、归一化和部门内证件唯一、调用 `MaterialService.assertAvailableVersions()`、调用 `freezeReferences()`、更新 ADMITTED/version/admittedAt、写 `customer.admitted` 审计、写 `CustomerAdmissionReceipt`。
- 材料 owner/部门/状态/版本授权完全由 Task 2 的事务绑定接口处理；Task 3 不复制材料表查询或范围逻辑。新增 `materials/index.ts` 作为跨模块公共入口以满足架构门禁。
- 幂等指纹只保存 SHA-256；同操作者/部门/Key 的相同请求从原回执恢复版本结果，不同指纹返回 `IDEMPOTENCY_KEY_REUSED`。并发身份唯一约束失败不会伪装成功。
- 客户列表/详情/编辑响应现统一暴露 `profileStatus: draft|admitted`、证件有效期、`admittedAt`；详情增加基于 `customer.admit` 的 `capabilities.admit`，共享历史直接映射 `customer.admitted`。
- 普通编辑不写 `profileStatus`、`admittedAt` 或材料引用；已准入客户的日常字段编辑保持 ADMITTED，冻结证件引用不被替换。
- 审计 details 仅含版本、稳定类型 Code、有效期模式和材料数量，不记录完整证件号、联系人或文件元数据。

## 文件

### 新增

- `backend/src/modules/customers/customer-admission.dto.ts`
- `backend/src/modules/customers/customer-admission.service.ts`
- `backend/src/modules/customers/customer-admission.service.spec.ts`
- `backend/src/modules/materials/index.ts`
- `.superpowers/sdd/task-3-report.md`

### 修改

- `backend/src/modules/customers/customer.controller.ts`
- `backend/src/modules/customers/customer.controller.spec.ts`
- `backend/src/modules/customers/customer.service.ts`
- `backend/src/modules/customers/customer.service.spec.ts`
- `backend/src/modules/customers/customer.module.ts`

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
- 目标 Prettier check：PASS，范围为 `backend/src/modules/customers`、`backend/src/modules/materials/index.ts` 和本报告。
- `git diff --check`：PASS。
- 未运行完整 `pnpm verify`、数据库 E2E、浏览器 E2E或生产联调；本 Task 无 schema/迁移改动。

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
