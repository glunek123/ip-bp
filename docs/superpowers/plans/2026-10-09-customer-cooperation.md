# CORE-CU-005 负责运营与合作状态实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 项目AGENTS.md风险路由优先：普通任务自审，高风险Task与最终集成Review分别执行。

**Goal:** 增加唯一负责运营的受控转派及合作暂停、终止、恢复；只阻止新业务，保留存量。

**Architecture:** Customer仍是稳定身份、数据范围与版本锚。复用AccessControl当前Grant、OrganizationService公开部门锁、既有审计与事务；新增客户局部事实与回执。Lead创建单独检查合作状态，更新与现有案件办理沿用旧规则。

**Tech Stack:** 现有NestJS、Prisma7.10.0、PostgreSQL17、Vue3、Element Plus、Jest/Vitest/Playwright，无新增依赖。

## 实施基线与依据

本计划从CU004本地验收收口`7258c8970b98a59f5c2b8210bc4081e74fca1f07`、tree`fc3a7797d669b18678712c991623cdbd23e25124`开始，支持前态为100条迁移。CU004实际通过候选和文档收口例外见[验证记录](../../spec/v0.1/VALIDATION.md)，不把本计划混入004非执行性收口。需求以[客户Spec](../../spec/v0.1/modules/customers.md)、SD-12/48及用户已确认的客户切片规则为依据；没有客户经理。

## Global Constraints

- 仅负责运营responsibleUserId；不增加客户经理，不改客户teamId、子业务负责人、企业账号或角色Grant。
- 100条现有迁移不可改写；仅新增前向迁移，先随机测试schema验证再部署测试public。
- 人工5181/3201/15434保留旧构建及91条schema；测试仅15433/5174/3101，统一E2E互斥，不reset/drop public或人工库。
- 新PowerShell先点加载Use-ProjectRuntime，Node24.21.0/pnpm11.27.0；检查context漂移，只解释本任务改动后再记录。
- 一处工作区一个writer，先Backend Sol及独立Reviewer，再Luna UI，最终Sol集成Review；无推送/合并/部署。
- 结果未知保留原body/key与原actor/customer绑定；403/404不证明未提交；已确认成功只读刷新当前状态。
- 计划范围按Level2：新增业务Action及普通增量迁移，复用既有共享机制；若改权限计算/隔离/共享锁或事务基础设施，立即升级Level3。

## 已核实的代码契约

- `backend/prisma/schema.prisma` 的 Customer 已有 `everAdmitted`、`deletedAt`、`deletedByUserId`、`deletionReason`、`version`、`responsibleUserId`、`teamId`；CU004 的事实/回执是 `CustomerDraftLifecycleFact/Receipt`，与 CU005 转派/合作事件不同。CU004 SQL 删除守卫查 admission/rights-holder receipt、主体关系、账号、资产、lead、case、客户 owner 材料/上传；**客户维护或生命周期历史不在业务关联清单中**。CU005 事实/审计也不得加入删除资格阻断；从未准入、无业务关联 DRAFT 改过运营或暂停/恢复后仍可软删除，历史随稳定客户 ID 保留。
- `backend/src/modules/customers/customer-lifecycle.service.ts` 当前先 `SELECT customers ... FOR UPDATE`，再在同一事务读 `customer.read` 与 delete/restore Grant、检查 version/状态/业务关联、写版本/审计/事实/回执。CU005 合作 Command 应同客户行锁及 CAS；CU004 删除与其只允许一个满足版本与状态的结果。CU004 回执目前保存 `resultSnapshot`，CU005 因转派会使源 SELF 失读，应单独保存最小不可变结果，`canReadAfter` 每次以**当前** Customer facts/Grant 计算，不冻结在历史 receipt。
- `backend/src/access-control/organization.service.ts` 的公开 `lockDepartment(tx, departmentId)` 使用 `organization:${departmentId}` advisory key；组织写先取该锁。CU004 删除及普通编辑先锁客户，再由审计外键读取 actor；CU005 若复用 `loadCurrentActorGrants` 的 actor `FOR UPDATE`，真实并发会与前述路径产生 40P01 死锁。CU005 局部 Command 固定 **组织部门锁 → actor/target账号、成员及源授权依赖行 `FOR SHARE NOWAIT` → 现有 AccessControl 当前Grant/范围判断 → 客户 `FOR UPDATE` → CAS/事实**。多账号及相关行按稳定ID顺序取锁；跨部门共享账号撞锁时整笔回滚、有界退避并以原正文/键重验，耗尽返回可重试 `CUSTOMER_MAINTENANCE_BUSY` 409，不暴露SQL/500。目标同部门 INTERNAL、active account、active membership；目标若有 team，该 team active，但不要求 target team 等于 customer.teamId。客户 teamId 不变。只复用公开部门锁和现有权限计算，不改共享组织实现。
- `backend/src/modules/leads/lead.service.ts` 的 create 与 update 共用 `assertCustomerAndHolder`；后者当前检查 ADMITTED、`deletedAt:null`、`customer.read`、同部门主体 link，并 `FOR SHARE OF customer, link`。合作门槛仅加 create 专用检查；update/editContext、既有公证转案和案件办理不加合作过滤。`formContext` 是新建线索客户选项（当前 ADMITTED 且未删除），只在此额外筛 `COOPERATING`。`LEAD_DRAFT` owner 无 customerId，上传准备保留，不新增绑定；真正 newLead create 强制检查。CU004 `customer_lead_parent_guard` 同时触发 INSERT/UPDATE，只管 deleted；CU005 新 SQL guard 仅触发 **BEFORE INSERT leads**，按 `NEW.customer_id/department_id` 锁父客户 `FOR SHARE` 并要求 ADMITTED、未删除、COOPERATING。不得在 UPDATE 触发合作守卫。
- `backend/src/modules/customers/customer.service.ts` 的 `list/get/toCustomerSummary` 是客户公共投影，前端 `frontend/src/api/customers.ts` 严格解码。`CustomerDetailPage.vue` 已有 CU004 删除未知结果冻结流程，不能被 CU005 的四类 Command 共用错误地清除。`frontend/src/api/organization.ts` 的 `permissionActionValues` 和 `isPermissionCatalog` 必须与后端目录同时更新；角色/人员页面会消费新动作。

## 业务与接口定稿

只保留负责运营 `responsibleUserId`，不加 manager。`Customer.cooperationStatus` 三态 `COOPERATING/PAUSED/TERMINATED`，增量默认 COOPERATING，绝不生成协议日期；DRAFT 与 ADMITTED 均可按 Grant 维护，已删除不可普通操作。可转移 `COOPERATING→PAUSED/TERMINATED`、`PAUSED→COOPERATING/TERMINATED`、`TERMINATED→COOPERATING`；resume 仅影响后续新业务。pause/terminate 原因 trim 后必填 1–500 字符，resume 可省略、若提供则 trim 后 1–500；转派原因必填（`TECHNICAL-DESIGN.md` 85、451）。同态及转派给当前负责人报 409，无版本/事实/审计。无关联且从未准入的草稿保持 CU004 删除资格。

新增四个可配置 Action：`customer.responsible.transfer`、`customer.cooperation.pause/terminate/resume`，SELF/TEAM/DEPARTMENT 沿用现有 `buildCustomerScope/authorizeCustomer`，不改 `scopeCovers`、Grant 合成或角色名特判。命令均需当前 `customer.read` 加对应动作 Grant 覆盖变更前客户。目标资格独立于目标 Grant：转派完成后其读取权取决于自己当前 SELF/TEAM/DEPARTMENT Grant。GET 候选分页按现有page=1/pageSize=20、上限100和稳定displayName/id排序；每项仅返回id/displayName/teamName，不要求user.read。

HTTP 采用 `GET /customers/:id/eligible-operators?page=1&pageSize=20`、`POST /customers/:id/responsible-transfer`（`expectedVersion,targetUserId,reason`）、`POST /customers/:id/cooperation`（`expectedVersion,action,reason?`）和 `Idempotency-Key`。拒绝未知 DTO 字段。成功最小结果严格为 `{customerId,action,resultVersion,occurredAt,canReadAfter}`，不含完整客户投影。首个成功响应在写后计算当前可读性；旧 key replay 先重验当前会话、原动作授权及 customer.read，结果事实不重做，而 `canReadAfter` 按当下 Customer facts/Grant 重算。原 actor 若 SELF 失读，未知结果的 403/404 不证明原提交失败；前端保留原 key/body，仅在有权时主动重试，不自动反向转派。`CUSTOMER_MAINTENANCE_BUSY` 409 也发生在 receipt 查阅前，不能证明历史未知请求未提交；前端继续保留原正文/键并仅按原请求重试，不能走普通版本冲突的换键流程。新旧不同 body 同 key 409。权限撤回后的 replay 不从 receipt 取回原数据。

非删除客户的 summary/detail 显示 `cooperationStatus`；detail新增cooperationCapabilities:{transfer,pause,terminate,resume}；各布尔值同时满足当前Grant和状态。原capabilities的editRoutine/admit/deleteDraft保持原契约。客户读取、详情、目标查询遵守原部门/SELF/TEAM 隔离。暂停/终止阻断 newLead（及未来真实新主业务入口），但已有 lead 更新/审核、公证→case 和 case 办理继续；恢复不绕过 ADMITTED 门槛，不复活账号或历史。`LEAD_DRAFT` 准备上传不阻断，create 失败后旧草稿依原清理规则保留。

## Backend/schema/contracts Task（Sol，一个独立高风险 Task）

允许文件：`backend/prisma/schema.prisma`、新增 CU005 前向迁移目录、`backend/src/access-control/access-control.service.ts`（只追加 action union）、`permission-catalog.ts`、`prisma-access-control.store.ts`；`backend/src/modules/customers/customer-cooperation.dto.ts`、`customer-cooperation.service.ts` 及新直接 spec，`customer.controller.ts`、`customer.module.ts`、`customer.service.ts` 及直接 spec；`backend/src/modules/leads/lead.service.ts` 及 spec；`backend/src/core-ld-openapi.spec.ts`；`tests/support/customer-cooperation-migration.mjs`、`tests/e2e/customer-cooperation.spec.ts`，必要时现有客户/Lead数据库 helper。`organization.service.ts` 不作为默认修改文件：只调用已公开的 `lockDepartment`；若必须改其共享锁基础设施先升级 root。`material.service.ts` 和 upload DTO 不改。

Schema 新增三态 enum/Customer 字段、action enum；独立不可变 cooperation event、responsible transfer fact、receipt（如选择统一事实表，必须 action-specific 约束），全部 customer/department/actor 外键、版本链、同 actor+key 唯一、审计引用与 immutable guard 同事务。迁移可对 100 条后的数据安全前向升级，不修改 98–100 已执行 SQL。事实表是客户维护历史，SQL 删除 guard 的业务关联清单不加它们。迁移从空链、100 条 supported 前态合成历史、坏 DDL 回滚/重试和直接 SQL 负例验证。

Command 在事务中先取公开组织部门锁，以局部 `FOR SHARE NOWAIT` 锁当前 actor、转派目标及源授权依赖账号/成员/Role/Grant/Team 行，再由现有 AccessControl 事务 reader 重验 actor Grant 与范围；不调用其 `FOR UPDATE` 的 `OrganizationService.loadCurrentActorGrants`。已有 receipt 不重验目标资格；首次转派读取当前目标身份/membership/team。之后锁 customer，核对非删除、expectedVersion、当前状态/负责人和源动作范围，`updateMany` 精确 CAS，审计、不可变事实、receipt 同事务；失败原子回滚。合作状态与转派仅增加 customer.version，不改 profile/team/子对象。`canReadAfter` 用结果 customer facts 与当前 Grant 独立算，不从 receipt snapshot 取。55P03/40001/40P01 在事务外有界退避后用原正文/键重验；耗尽统一为 `CUSTOMER_MAINTENANCE_BUSY` 409，不能当普通版本冲突。新 lead `assertCustomerAndHolder` 可接 `createOnly` 参数或在 create 调用后单独核对，避免 update 被新状态过滤；新增 INSERT-only SQL guard 配合父行 `FOR SHARE` 与 cooperation `FOR UPDATE` 竞争。CU004 删除触发器继续保护 UPDATE 的 deleted 条件。

直接验收：SELF 源转派失读但 HTTP 成功、目标获读仅因实际 Grant；不同团队有效运营可接收但 Customer.teamId 不变；inactive account/membership/team、外部/跨部门/UUID 猜测拒绝；当前权限撤回后新命令与 replay 均拒绝；pause/terminate/resume 合法/非法转换、原因、同态；DRAFT 无业务关联经过转派/暂停/恢复仍能按 CU004 删除，deleted 永不能命令；CAS 单胜与故障注入全回滚；newLead pause 后拒绝、resume 后通过、原 lead update 保持；公证/案件原流程回归。数据库实测组织停用/转组/Grant 撤回 ↔ transfer、CU004 delete ↔ transfer/cooperation/lead、cooperation ↔ lead create 与直写 SQL insert，监测等待/死锁及 409/业务码；旧 lead UPDATE 不被合作 guard 阻断。Backend Task 聚焦测试后由另一 Sol 独立 Review 一次，关闭 finding 后交 root。

## UI/API Task（Luna，Backend 契约稳定后）

允许文件：`frontend/src/api/customers.ts`、`customers.spec.ts`、`frontend/src/api/organization.ts`、`organization.spec.ts`；`frontend/src/modules/customers/CustomerDetailPage.vue/.spec.ts`，必要时新增客户合作/转派 panel 与 spec、独立 pending-command helper 与 spec；`frontend/src/modules/leads/LeadNewPage.vue/.spec.ts`、`LeadForm.vue/.spec.ts` 仅在新建候选/UI 语义需要时改。`CustomerListPage` 若展示合作状态才修改。同步严格 decoder 和 role action 清单；列表/详情对新增字段拒绝非法值。展示负责运营、合作状态及显式动作/原因；并发状态和 409 刷新提示清楚。保留原 key/body 的未知结果可恢复，但与 CU004 delete pending 身份/存储键分开；已收到成功且 `canReadAfter=false` 显示转派成功、返回列表，不再 GET 详情误报失败。新建 lead 选项按 Backend formContext 缩小；既有 lead 编辑 context 不缩小。Luna 自审及聚焦单元，不重复独立 Task Review。

## 实施与正式验证命令

每个新 PowerShell 进程在仓库根先 `. .\Use-ProjectRuntime.ps1`，对照 `.node-version` 和 `docs/environment-lock.json` 核验 `node --version`、`pnpm --version`，随后 `pnpm context:check` 并结合 `git status`/diff；版本不符停止相关命令。开发期 Backend：`pnpm --filter @dev-cor/backend test src/modules/customers/customer-cooperation.service.spec.ts src/modules/customers/customer.controller.spec.ts src/modules/customers/customer.service.spec.ts src/modules/leads/lead.service.spec.ts src/core-ld-openapi.spec.ts`；权限目录另跑 `pnpm --filter @dev-cor/backend test src/access-control/prisma-access-control.store.spec.ts src/access-control/organization.service.spec.ts`。UI：`pnpm --filter @dev-cor/frontend test src/api/customers.spec.ts src/api/organization.spec.ts src/modules/customers/CustomerDetailPage.spec.ts src/modules/leads/LeadNewPage.spec.ts src/modules/leads/LeadForm.spec.ts`，新增 panel/pending helper 的 spec 一并显式列入。组合候选跑 `pnpm check:fast`、`pnpm spec:check`、受影响格式按本计划任务文件的实际改动清单逐文件检查，不包含无 Prettier parser 的 schema.prisma。

数据库与浏览器在隔离测试库：`node tests/support/customer-cooperation-migration.mjs`（必须使用现有 test environment 解析和共享 E2E 资源锁）；`pnpm test:e2e tests/e2e/customer-cooperation.spec.ts tests/e2e/customer-lifecycle.spec.ts tests/e2e/core-leads.spec.ts`，可先 `--grep` 聚焦再在稳定候选跑完整列出的相关测试。浏览器主链真实 `/auth/login` 用户名/密码、cookie 和 CSRF、显式赋权、转派失读后刷新/重登、目标依据真实 Grant 读、pause 拒绝新 lead、存量更新/转案/案件继续、resume 后新建；不能把 `page.route` fixture Bearer 当主链证据。检查匹配 0 项必须失败。

风险分级按最终实际 diff 判定。若只新增四个 action 的目录/类型/映射，复用既有 Grant 范围计算、部门隔离、共享审计/事务与公开 `OrganizationService.lockDepartment`，加普通安全前向迁移，则按三级规则是 **Level 2**；仍按协作路由做 Backend/schema/contracts 高风险 Task 独立 Sol Review、多 Agent 最终集成 Review 和上述真实数据库/E2E/迁移专项。总计划005风险调整为Level2，依据是仅新增客户局部动作、状态、事实及非破坏迁移，共享授权、范围、锁和事务机制保持既有契约。高风险Task审查及真实数据库验证继续执行。若实际需要修改 `scopeCovers`、Grant 合成、租户/部门隔离、共享锁/事务基础设施，或迁移破坏/重写历史，立即升级 **Level 3**：最终稳定候选运行完整 `pnpm verify` 与适用数据库/浏览器/迁移专项。Level 2 若无覆盖 005 的现成 scope，固定候选逐项运行相应门禁并在 `VALIDATION.md` 绑定 commit/tree、命令和结果；不可把仅客户 `verify:slice:customer` 冒充跨 Lead/Organization 全覆盖。

收口时同步 `docs/spec/v0.1/modules/customers.md` 的状态机、授权及 AC、必要 `DECISIONS.md`/技术设计和 master Task 5、路标唯一 Current/Next、真实 `VALIDATION.md` 证据与状态；只记录实际通过结果，不预写。实施只从完成CU004正式验收与文档收口后的干净候选开始。

## 任务交付顺序和明确契约

### Task A：Backend核心实现与可独立验证的API（Sol）

补充允许文件：`scripts/prisma-model-owners.mjs`仅声明新增模型主责，不改架构门禁逻辑；`customer-cooperation-response.dto.ts`声明真实OpenAPI响应；`customer-cooperation.controller.ts`独立Controller及直接spec，优先避免增大CustomerController依赖。独立controller需在CustomerModule注册，并在OpenAPI测试RootTestModule登记controller与service桩。

Produces：以下API契约。数据库enum名与Prisma模型可沿用当前仓库命名，公共字符串保持一致。接口返回负责运营姓名时，仅当前客户可读投影中提供`responsibleOperator: {id,displayName}`，目标选择器最多附团队名；禁止返回email、username、roles或不可读客户信息。

```ts
export type CooperationStatus = 'COOPERATING' | 'PAUSED' | 'TERMINATED';
export type CooperationAction = 'pause' | 'terminate' | 'resume';
export type CooperationCommandInput = {
  expectedVersion: number;
  action: CooperationAction;
  reason?: string;
};
export type ResponsibleTransferInput = {
  expectedVersion: number;
  targetUserId: string;
  reason: string;
};
export type CustomerMaintenanceResult = {
  customerId: string;
  action: CooperationAction | 'responsible-transfer';
  resultVersion: number;
  occurredAt: string;
  canReadAfter: boolean;
};
export type EligibleOperator = {
  id: string;
  displayName: string;
  teamName: string | null;
};
export type CustomerCooperationCapabilities = {
  transfer: boolean;
  pause: boolean;
  terminate: boolean;
  resume: boolean;
};
```

Service公开签名：`eligibleOperators(actor,customerId,page,pageSize):Promise<{items:EligibleOperator[],total:number,page:number,pageSize:number}>`；`transferResponsible(actor,customerId,key,input):Promise<CustomerMaintenanceResult>`；`changeCooperation(actor,customerId,key,input):Promise<CustomerMaintenanceResult>`。结果事实持久化部分不含canReadAfter；回放仍先查当前read+动作授权后返回原事实，canReadAfter重新计算。权限失效不靠receipt放行。

- [ ] 先扩直接测试并记录失败。采用已有真实Customer fixture，明确expectedVersion和目标ID，不编造生产数据。
- [ ] 新迁移增加COOPERATING默认字段、四Action、局部不可变事实/receipt、组合FK和INSERT-only lead合作父守卫；检查SQL删除既有守卫兼容、普通维护历史不计业务关联。
- [ ] 在服务中按`await organization.lockDepartment(tx, actor.departmentId)`→组织状态行→customer FOR UPDATE顺序执行当前授权/CAS/事实/审计/receipt；明确的事务失败整体回滚。现有lockDepartment公开接口不变。
- [ ] create lead在锁定customer/link后检查COOPERATING；update不加此条件。formContext新建候选只保留COOPERATING，editContext保留原客户。
- [ ] 随机schema专项通过后仅部署testpublic，构建backend供聚焦E2E；普通失败只跑被修改输入影响的检查。
- [ ] 同步客户Living Spec和真实HTTP契约，在新增Action时立即运行backend目录及组织/OpenAPI测试，避免将缺桩/目录旧数量留到最终门禁。
- [ ] self-review后提交干净Backend候选及task-5-backend-report.md；另一名Sol读固定U10包，审查SQL/CAS/身份边界/组织锁/当前鉴权和真实测试，关闭全部finding再交UI。

具体DTO与独立测试代码如下；数据库业务测试另用仓库已有真实factory。

```ts
// backend/src/modules/customers/customer-cooperation.dto.ts
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CustomerCooperationDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(['pause', 'terminate', 'resume'])
  action!: 'pause' | 'terminate' | 'resume';

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @ValidateIf(
    (input: CustomerCooperationDto) =>
      input.action !== 'resume' || input.reason !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason?: string;
}

export class CustomerResponsibleTransferDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsUUID()
  targetUserId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
```

```ts
// backend/src/modules/customers/customer-cooperation.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerCooperationDto } from './customer-cooperation.dto';

describe('customer cooperation reasons', () => {
  it('accepts omitted resume reason and rejects blank provided resume reason', async () => {
    expect(
      await validate(
        plainToInstance(CustomerCooperationDto, {
          expectedVersion: 1,
          action: 'resume',
        }),
      ),
    ).toEqual([]);
    const errors = await validate(
      plainToInstance(CustomerCooperationDto, {
        expectedVersion: 1,
        action: 'resume',
        reason: '   ',
      }),
    );
    expect(errors.map((error) => error.property)).toContain('reason');
  });

  it.each(['pause', 'terminate'])('requires %s reason', async (action) => {
    const errors = await validate(
      plainToInstance(CustomerCooperationDto, {
        expectedVersion: 1,
        action,
      }),
    );
    expect(errors.map((error) => error.property)).toContain('reason');
  });
});
```

该DTO测试文件属于Task A允许文件，定向Jest命令另显式纳入。完整服务测试还必须独立证明非法状态409、版本/事实/审计不变，而不能仅用DTO测试代替真实写路径。权限目录新增Action后保留严格数量与具体条目断言。

### Task B：API与前端页面接线（Luna）

Consumes Task A契约，新增`frontend/src/modules/customers/CustomerCooperationPanel.vue/.spec.ts`及`customer-maintenance-pending.ts/.spec.ts`，不把新命令写进删除pending结构。新增`frontend/src/api/customer-cooperation.ts/.spec.ts`实现严格unknown解码和显式写请求；客户summary/detail新增cooperationStatus；detail另增responsibleOperator和cooperationCapabilities，按真实返回解码，无宽泛any或默认假状态。

- [ ] 先写页面测试：无capability不出现动作；PAUSED有恢复；转派最小成功且canReadAfter=false显示成功并回列表；成功后GET失败只提示刷新，不误报写失败。
- [ ] 待提交命令存sessionStorage，命名空间绑定userId/departmentId/customerId/action，持久化原expectedVersion/body/key；relogin恢复仅同actor，不同客户迟到响应丢弃，撤权清可见数据但不清未知请求。
- [ ] 输入原因/运营选项由独立表单收集；unknown阶段冻结其他业务维护和本命令输入，只允许原键原体主动重试；普通版本冲突409可保留表单并显式刷新，不自动换版本重提；`CUSTOMER_MAINTENANCE_BUSY` 409 保留pending原键/原体并提示原请求重试，不清未知结果。
- [ ] 同步前端Action union/严格目录/organization.spec静态完整样例，以及人物角色配置页面直接测试；现有客户/Lead fixture新增真实状态字段，不在decoder降级默认。
- [ ] 聚焦Vitest、全前端类型、改动文件Lint/Prettier，普通任务自审并提交task-5-ui-report.md；无额外逐UI Reviewer。

### Task C：集成真实流程与本切片正式验收（Root + Sol Final Reviewer）

- [ ] 新浏览器`customer-cooperation.spec.ts`核心场景使用真实密码cookie/CSRF，不替换/auth/session、不用Bearer代替主链；低层SQL场景可保留fixture身份，报告分开标明。
- [ ] 证明SELF源转派响应成功后失读、目标重登按真实Grant读取；不同团队目标不改customer.teamId；暂停阻止新lead而旧lead更新/转案/案件继续，恢复仍需ADMITTED。
- [ ] 覆盖实际组织撤权/停用/转组竞争与transfer，Customer delete↔maintenance、lead insert↔pause/terminate，正向结果与守卫拒绝均来自合法初态；不把FK fixture失败算守卫命中。
- [ ] 全部Task组合固定候选，由独立Sol Final Review；所有C/I/M关闭后按Level2冻结候选，执行显式backend/frontend定向、check:fast、spec:check、受影响格式、backend构建、客户生命周期/合作/core-leads及触发的notary/cases回归、空库/100升级迁移专项。若共享机制被改，改按Level3完整verify。
- [ ] 日志绑定实际HEAD/tree/环境HMAC和前后稳定性；只记录真实结果，最后doc-closeout明确累计diff并执行文档格式/spec/strictcontext。

具体新增聚焦命令：

```powershell
. .\Use-ProjectRuntime.ps1
node --version
pnpm --version
pnpm --filter @dev-cor/backend test src/modules/customers/customer-cooperation.service.spec.ts src/modules/customers/customer-cooperation.controller.spec.ts src/modules/customers/customer.service.spec.ts src/modules/leads/lead.service.spec.ts src/access-control/organization.service.spec.ts src/access-control/prisma-access-control.store.spec.ts src/core-ld-openapi.spec.ts
pnpm --filter @dev-cor/frontend test src/api/customers.spec.ts src/api/customer-cooperation.spec.ts src/api/organization.spec.ts src/modules/customers/CustomerCooperationPanel.spec.ts src/modules/customers/customer-maintenance-pending.spec.ts src/modules/customers/CustomerDetailPage.spec.ts src/modules/leads/LeadNewPage.spec.ts src/modules/leads/LeadForm.spec.ts
pnpm test:e2e tests/e2e/customer-cooperation.spec.ts tests/e2e/customer-lifecycle.spec.ts tests/e2e/core-leads.spec.ts --workers=1
node tests/support/customer-cooperation-migration.mjs
```

期望各命令退出0且匹配测试非0；迁移helper必须自行统一env解析/互斥，随机schema空链及100→最新保留原客户/线索/案件/审计，并包含错误DDL失败全回滚重试、tombstone及非合作SQL父守卫反例。命令不同阶段执行，非一条流水连续盲跑。

## 旧回执兼容（只改投影，不重写历史）

Task A额外允许`backend/src/modules/customers/customer-lifecycle.service.ts/.spec.ts`及`customer-admission.service.ts/.spec.ts`。cooperationStatus新增为CustomerSummary必需字段后，旧CU004 resultSnapshot直接cast及准入rebuildReceiptResult手写列表会漏字段。迁移前隐含合作状态COOPERATING，因此旧receipt缺字段时回放历史投影补COOPERATING；新receipt显式保存真实状态。旧请求指纹、receipt正文/版本/时间全部不更新。当前read和动作Grant仍先于回放，历史resultVersion/状态不能覆盖当前GET；最终UI收到写成功后只刷新当前GET。新增旧receipt反例单测证明严格decoder可读及重放不重复审计/版本，撤权仍拒绝；不在前端decode统一默认以掩盖所有未来字段遗漏。

后续新增局部事实/回执都要同步现有`tests/support/customer-database.mjs`与`tests/support/core-lead-database.mjs`的拥有者范围清理：依赖顺序先receipt后fact再audit/customer，在既有NODE_ENV/testURL/currentDB及固定测试部门保护下，事务内临时禁用本表USER触发器后恢复，失败整笔rollback。只用于合成测试样例，禁止放宽生产不可变守卫。先跑对应新表记录存在时的旧业务fixture重建，避免用空测试库冒充组合可恢复。

前端兼容范围再核对`CustomerDetailPage.onAdmitted`：准入回执是历史结果，不能因回放把当前cooperationStatus、responsibleOperator或cooperationCapabilities替换成当时值。先确认原写已成功，然后通过当前GET刷新；GET失败保留成功提示并提示只读重试，旧版本不能用来自动提交下一维护命令。新维护命令成功同理，尤其回放后不采用历史resultVersion自动重建当前customer版本。旧CU004删除/恢复响应也保持历史语义，不将旧COOPERATING当成当前合作状态。

回放次序进一步固定：先重验当前actor/read/原动作Grant及当前客户范围，再查同键/指纹回执。命中后直接返回不可变旧事实及当前canReadAfter；不重新执行expectedVersion、合作同态或目标运营当前资格门槛（目标后来停用不能否认当时成功）。这些门槛只在没有回执的新写分支检查。组织/父行锁仍按统一顺序取得，避免回放绕过当前授权。
