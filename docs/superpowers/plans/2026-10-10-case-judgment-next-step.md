# CORE-CA-009 判决后续选择实施计划

> 执行采用项目多Agent协作路由：高风险实现、独立Task Review和最终集成Review使用6 Sol；接口已确定的UI／测试执行使用6 Luna。2026-10-10用户已确认Q1～Q3全部推荐方案，按SD-49实施，不逐Task再次征求用户确认。

**Goal:** 从已登记一审判决的待判决案件，真实办理“二审抉择”，进入二审或待写执行材料，同时交付最小误选纠错。

**Architecture:** 复用cases Command、事务、同案锁／CAS、现有授权和真实律师绑定、共享审计及幂等回执。以不可变选择／撤销事实和当前指针保留历史，不新建通用状态机、审批流或审理轮次平台。

**Tech Stack:** NestJS／Prisma／PostgreSQL、Vue／Element Plus、Jest／Vitest／Playwright；无新增依赖。

## 前提与范围

- 分支`codex/core-ca-009-judgment-next-step`；基线main`6ae39ac1a688f2d553bc5b439e0fbc208e131151`，对应本地及实时远端main；开工上下文无漂移，未修改业务代码。
- 唯一详细业务规则为[案件Spec的CA-009段](../../spec/v0.1/modules/cases.md#ca-009判决后续选择)。Q1～Q3已确认，先将该段及[字段契约](../specs/2026-09-21-core-flow-field-material-contract.md#7-core-ca字段与动作契约)落定，按需更新B13／Decision；不关闭CA-010以后未决项，不伪写已验收。
- 风险Level 3：必须窄化扩展共享律师审计身份分派函数，并升级既有判决阶段／版本不变量以允许合法后续链；保持其他身份和材料路径约束。独立高风险Task Review后方可交接集成，最终稳定候选执行完整verify。
- 每个Task只收到Goal、Allowed files、确定接口、验收条件、定向测试及禁止项；一个checkout同时仅一个写入者。普通Luna Task完成自审、聚焦测试和报告，主Agent不重复完整读取／测试。共享测试库迁移、清理、并发／故障注入及浏览器不盲目并行。
- 只使用`backend/.env.test`独立数据库；不打印凭据，不修改既有迁移、开发／生产库或持久卷。每次新PowerShell执行Node／pnpm前加载`Use-ProjectRuntime.ps1`，核对Node及pnpm锁定版本。
- CA-010二审结果、CA-011执行材料、费用、外部补录和客户经理字段均不实施。目标阶段显示真实记录及后续能力限制，不创建假办理入口。本轮不自动推送、合并或部署。

## 固定接口契约

Q1～Q3已确认；下列DTO由Sol固定后交接UI，不让Luna自行裁决公共契约。

```ts
type ChooseJudgmentNextStepInput = {
  expectedVersion: number;
  idempotencyKey: string;
  judgmentId: string;
} & (
  | {
      next: 'EXECUTION';
      executionReadinessConfirmed: true;
    }
  | {
      next: 'APPEAL';
      plaintiffAppeals: boolean;
      defendantIds: string[];
    }
);
type RevokeJudgmentNextStepInput = {
  expectedVersion: number;
  idempotencyKey: string;
  choiceId: string;
  reason: string;
};
type JudgmentNextStepResult = {
  id: string;
  stage: 'SECOND_INSTANCE' | 'WAITING_EXECUTION_DOCUMENTS';
  version: number;
  choiceId: string;
  judgmentId: string;
  recordedAt: string;
};
```

- 新阶段编码固定`SECOND_INSTANCE`／`WAITING_EXECUTION_DOCUMENTS`；展示名固定为“二审”／“待写执行材料”，后者属于“准备执行文书”节点，不把节点组名写为阶段。
- 选择：`POST /api/v1/cases/:id/judgment-next-step`与`POST /api/v1/lawyer/cases/:id/judgment-next-step`，调用同一`CaseJudgmentNextStepService.choose`。正常内部Action建议`CASE_JUDGMENT_NEXT_STEP / case.judgment.next_step`。
- 撤销：仅内部`POST /api/v1/cases/:id/judgment-next-step-revoke`，调用`.revoke`；响应阶段固定`WAITING_JUDGMENT`并返回原`choiceId`、`revocationId`、当前`judgmentId`、新version及录入时间。内部Action固定`CASE_JUDGMENT_NEXT_STEP_REVOKE / case.judgment.next_step.revoke`；不开放律师撤销路由。
- 详情增加`canChooseJudgmentNextStep`、`canRevokeJudgmentNextStep`及当前路径／选择历史；撤销后当前路径为空，历史仍在。律师仅获必要历史，不含内部原因／人员账号ID；客户只扩充阶段枚举，不增加详情事实。

## Task 1：固定业务规则、后端与前向迁移（6 Sol）

执行边界：Task 3的真实PG、迁移及SQL安全helper并入本高风险Task，由同一Sol实现并独立审查；正常API／真实账号浏览器接线并入接口固定后的Task 2，避免重复理解数据库不变量。业务范围和验收要求不变。

**Allowed files:**

- Modify: `backend/prisma/schema.prisma`、`scripts/prisma-model-owners.mjs`及新增前向`backend/prisma/migrations/*/migration.sql`。
- Create: `backend/src/modules/cases/case-judgment-next-step.dto.ts`、`case-judgment-next-step.service.ts`及服务直接spec。
- Modify: `backend/src/modules/cases/case.module.ts`、`case-read.controller.ts`、`lawyer-case.controller.ts`、`case-read.dto.ts`、`case-read.service.ts`、`client-case.service.ts`、`client-case.response.dto.ts`和直接spec；`case-judgment.service.ts`及直接spec，必要的开庭纠错直接spec。
- Modify: `backend/src/access-control/permission-catalog.ts`及直接契约spec；其他access-control文件仅限新Action的既有映射，不改变权限计算。
- Modify: `docs/spec/v0.1/modules/cases.md`、`docs/spec/v0.1/GAPS.md`、`docs/spec/v0.1/DECISIONS.md`及核心字段契约，仅落实本片确认事项。

**Forbidden:** 不放宽跨企业／部门或律师范围，不改旧回执响应，不删除审计／判决／材料历史，不新增任意阶段切换；不顺带实现下一节点。

- [ ] 1. 按用户答复落实Q1～Q3，固定DTO、动作、投影和Grant初始化规则；本片外能力不得实现。核对原告身份锚是否确为案件既有权利主体，无法对应则升级主Agent，不按名称猜测。
- [ ] 2. 先在新服务spec取得有效行为RED：无判决拒绝、执行核实缺失拒绝、空／外案上诉人拒绝、同键异参及旧判决拒绝。运行`pnpm --filter @dev-cor/backend test src/modules/cases/case-judgment-next-step.service.spec.ts`；不能把缺文件／编译失败冒充业务RED。
- [ ] 3. 枚举所有case阶段／版本CHECK和延迟触发器（含旧判决、更正链及开庭历史），用新增迁移拆开枚举提交与依赖新值的约束。新增不可变选择、上诉人关联、撤销和回执，以及当前选择组合指针。旧记录原样保留，不用历史重写填充假选择。
- [ ] 4. 升级判决链守卫：旧判决的toVersion不再机械等于已合法推进案件的version；必须存在可核对的选择／撤销链。撤销后更正时，校验前一判决确为当前链头，允许期间合法选择／撤销造成的版本间隔；不删除原冻结、来源部门、唯一根、审计及回执约束。共享律师审计分派只新增本次正常选择动作，不增加异常权限。
- [ ] 5. 实现身份重验→授权／范围→同案锁→回执裁决→当前状态／版本／判决→写事实／审计→CAS→回执。撤销与后续事实创建使用同锁策略；有效选择阻断判决更正，同案竞争只有合法一方成功。失败原子回滚。
- [ ] 6. 接入内部／律师路由和同快照详情、列表／计数、新阶段筛选。新Action从确认的既有Grant逐Grant同范围复制并失效授权修订；同步严格后端权限目录，客户只同步阶段投影。
- [ ] 7. 运行服务及受影响`case-judgment.service.spec.ts`、`case-read.service.spec.ts`、`case-read.controller.spec.ts`、`client-case.service.spec.ts`、权限契约测试。保留未知结果及安全拒绝测试，不全仓跑两遍相同单测。
- [ ] 8. 交独立6 Sol高风险Task Review。审查迁移、旧链／回执兼容、身份隔离、原告锚、幂等／并发／回滚及未来后续事实阻断；finding关闭后交接Task 2，报告精确公共接口、文件、commit和实际测试结果。

## Task 2：共享页面与前端契约（6 Luna）

**Allowed files:** `frontend/src/api/cases.ts`、`client-cases.ts`、`organization.ts`及直接spec；`frontend/src/modules/cases/CaseDetailPage.vue`、`LawyerCaseDetailPage.vue`、`CaseJudgmentPanel.vue`和相关spec；新建`CaseJudgmentNextStepPanel.vue`及直接spec；`frontend/src/app/AppShell.vue`及直接spec；Task 3定义的浏览器spec与必要的正常API／真实账号helper。权限类型／解码器复用现有`organization.ts`，不另建平行目录；不修改SQL、schema或安全规则。

同步新阶段还包括案件／律师列表及其直接spec、客户端案件列表／详情的阶段展示映射，以及直接受影响的类型fixture。客户端仍只读原企业投影，不增加内部事实；不借类型同步扩展业务行为。

**Acceptance:** 按Task 1固定的capability展示，保留现有判决登记／更正；无分支默认猜测、必填星号、操作前说明影响，未知结果原键恢复，冲突不偷换版本。侧栏只新增已可到达节点，页内不重复阶段筛选条；客户不增加内部数据。

- [ ] 1. 先补严格解码／能力及组件RED；包含非法组合、双方／多被告（按批准规则）、只读／律师、取消无请求、未知POST及重试、过时版本、切案迟到响应。
- [ ] 2. 实现共享面板、必要的两入口请求函数和详情历史。未知结果保留原body／键；成功后重读真实详情，撤权清敏感投影；撤销按钮仅内部获权者且提前说明影响。
- [ ] 3. 同步内部／律师／客户阶段类型、侧栏计数及“准备执行文书”的首个子阶段入口，禁止伪造其他未实现子阶段计数。
- [ ] 4. 运行`pnpm --filter @dev-cor/frontend test src/api/cases.spec.ts src/api/client-cases.spec.ts src/modules/cases/CaseJudgmentNextStepPanel.spec.ts src/modules/cases/CasePages.spec.ts src/modules/cases/LawyerCaseDetailPage.spec.ts src/app/AppShell.spec.ts`，必要时加入权限／判决组件直接spec；完成自审和交接报告，不另开普通Task Reviewer。
- [ ] 5. 若发现需改Task 1契约、schema、权限或业务语义，立即停止扩大修改并升级Sol，不自行架构重构。

## Task 3：真实数据库、迁移和浏览器验收（Sol判断，Luna执行明确用例）

本节保留统一验收清单，不另派重复实现Task：数据库与迁移项由Task 1交付并审查，接口已确定的浏览器项由Task 2执行。完整撤销后判决更正必须包含真实冻结文件及HTTP办理，不以合成事实链探针替代。

**Allowed files:** 新建`tests/e2e/case-judgment-next-step.spec.ts`、`case-judgment-next-step-database.spec.ts`、`case-judgment-next-step-migration.spec.ts`；对应`tests/support/case-judgment-next-step-database.mjs`／`.d.mts`、`case-judgment-next-step-migration.mjs`／`.d.mts`。仅按必要性扩展既有真实账号fixture及清理helper；不改变测试门禁、超时、重试或断言质量。

- [ ] 1. 用现有正常来源链与真实账号／cookie准备待判决且已登记判决的案件；不得预置新阶段记录冒充推进。覆盖运营及当前律师两条选择路径、真实字节下载、刷新／退出重登、客户本企业阶段读取及其他企业隔离。
- [ ] 2. 真实PG验证授权撤销／停用／承办失效即时拒绝和原键重放；同键原样回执／异参冲突、旧version／judgment、两个操作者及选择／判决更正竞争。事实、上诉人关联、审计和回执各故障整体回滚；撤销的竞争、重放、更正／重选及后续事实阻断均执行。
- [ ] 3. 迁移覆盖空库与上一支持112条schema的旧判决、更正、开庭及回执；验明旧回执原样重放、冻结字节未改、直接SQL不能伪造身份／链／跨案指针／任意阶段。不得以不存在未来表的空断言声称已验证未来业务；后续模型接入列为CA-010／011明确集成条件。
- [ ] 4. 先运行`pnpm test:e2e tests/e2e/case-judgment-next-step-database.spec.ts tests/e2e/case-judgment-next-step-migration.spec.ts tests/e2e/case-judgment-next-step.spec.ts --workers=1`；按影响加入既有判决及开庭数据库回归。共享库测试串行，不同时另开迁移或故障注入进程。
- [ ] 5. 测试新增helper涉及SQL安全、隔离或故障注入时由Sol审查；Luna只执行已固定验收清单并收集真实退出码／报告，不裁决不变量。每Task报告Task／Model／Commit、changed files、tests、contract changes、self-review、known risks、Requires Sol attention。

## Task 4：集成终审、稳定候选与收口（6 Sol总控）

- [ ] 1. 完成阶段集成定向测试及`pnpm check:fast`；同步已实现最终业务契约。独立6 Sol Final Review检查跨Task真实累计diff、范围和旧链兼容，修复后围绕finding补审；不得提前标完成。
- [ ] 2. 解释所有Git／快照差异，再执行标准`pnpm context:record`及`pnpm context:check:strict`，固定干净候选commit/tree。正式验证期间不并行改代码、测试或状态文档。
- [ ] 3. 在稳定候选执行`pnpm verify`及上述隔离数据库／Chromium验收、受影响判决／开庭回归与迁移专项；必要时扩大验证，按影响裁决，不因使用新枚举就机械重复全库E2E。保留完整日志、真实退出状态、失败原因；不删除／弱化权限、隔离、并发或冻结校验。
- [ ] 4. `docs/spec/v0.1/VALIDATION.md`记实际候选、环境、Review、结果及证据位置；路线图仅在通过后完成CA-009并推进CA-010／011，状态摘要引用。不把门禁期间草案或旧候选说成已验收。
- [ ] 5. 核对业务候选至拟收口HEAD的累计diff，纯状态／证据且满足现行例外时仅执行受影响格式、`pnpm spec:check`、标准上下文记录／严格检查；实质变化补审复验。最终报告候选与收口边界、剩余阻塞及Git状态，等待明确推送／合并授权。
