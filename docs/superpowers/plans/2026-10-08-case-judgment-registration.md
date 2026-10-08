# CORE-CA-008 一审判决登记与受控更正实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. Task模型、自审／独立审查及Final Review按项目协作路由，不重复确认已批准的业务范围。

**Goal:** 运营或当前承办律师登记真实一审判决，有权运营留痕纠正误录；保留待判决阶段，并阻断已有判决后的开庭纠错回退。

**Architecture:** 复用cases Command、案锁／CAS、当前授权、冻结材料、成功审计及不可变幂等回执。新增不可变判决事实链及当前指针，每个事实关联精确文件版本；登记与开庭纠错在同案锁下互斥。详情沿用RepeatableRead聚合，共享运营／律师组件只消费服务端能力。

**Tech Stack:** 既有NestJS／Prisma／PostgreSQL、Vue／Element Plus、Jest／Vitest／Playwright，不新增依赖。

## Global Constraints

- 分支`codex/core-ca-008-judgment-registration`，基线main`4bfeab7ae73a6c0b5455c39da326dba57d5ee4e7`；CA-007已推送并快进集成，原业务候选证据保留。
- 2026-10-08用户确认受控更正纳入本切片；判决金额和实缴诉讼费只记录已知／待定事实，退费明细及办理状态后置财务，不改原标的、不发起支付。
- 唯一业务契约为[案件Spec的CA-008](../../spec/v0.1/modules/cases.md#ca-008一审判决登记与受控更正)及[字段材料契约§7](../specs/2026-09-21-core-flow-field-material-contract.md#7-core-ca字段与动作契约)。本计划不重复动态验收台账。
- 风险暂定Level 2：普通非破坏前向迁移、独立增量Action，复用已有授权／事务／审计／同案锁，不修改其计算机制。schema／核心Command仍由Sol实施并独立Sol审查；改变共享安全／审计机制或历史数据重写则升级Level 3。集成后必须独立Sol Final Review；真实PG隔离／并发／回滚及迁移、真实Chromium操作／刷新不可省略。
- 日期`YYYY-MM-DD`，业务时区`Asia/Shanghai`；金额十进制字符串，KNOWN非负可为0，PENDING必须null，不用JS浮点累计，不把系统时间当收到日期。
- 登记／更正均保持`WAITING_JUDGMENT`；不实现CA-009、二审、执行、财务指令或任意阶段编辑。客户／公证处原可见范围不扩展；律师无异常更正权。
- 新前向迁移，不改82份已执行迁移。先在独立测试库随机临时schema验证空链及82份支持schema升级，再部署测试public；禁止reset、开发／生产迁移、卷清理和凭据输出。
- 每个PowerShell进程先加载`Use-ProjectRuntime.ps1`并核对Node v24.21.0／pnpm11.27.0。一个checkout一个写入者；共享DB、迁移、清理及故障注入串行。
- 本切片开发不自动推送、合并或部署；CA-007推送授权不被扩大为尚未验收的CA-008集成。

## 接口和事实契约

```ts
type RegisterCaseJudgmentInput = {
  expectedVersion: number;
  idempotencyKey: string;
  judgmentReceivedAt: string;
  judgmentAmountState: 'KNOWN' | 'PENDING';
  judgmentAmount: string | null;
  paidLitigationFeeState: 'KNOWN' | 'PENDING';
  paidLitigationFee: string | null;
  judgmentContentVersionIds: string[]; // 1～10，去重后按稳定顺序指纹
};
type CorrectCaseJudgmentInput = RegisterCaseJudgmentInput & { reason: string };
type CaseJudgmentCommandResult = {
  id: string;
  stage: 'WAITING_JUDGMENT';
  version: number;
  judgmentId: string; // 本次不可变事实，不把后来当前值拼进旧回执
  recordedAt: string;
};
```

内部路由`POST /api/v1/cases/:id/judgment-register`、`/judgment-correct`；律师仅`POST /api/v1/lawyer/cases/:id/judgment-register`。共享`CaseJudgmentService.register(actor,id,input)`及`.correct(actor,id,input)`返回以上回执。详情增加`canRegisterJudgment`、`canCorrectJudgment`及`judgment={current,history,availableFiles}`，无事实时current=null、history=[]；事实含日期、两组金额、精确文件、业务Case版本、录入时间、种类REGISTER／CORRECT及前一事实ID。内部更正原因只在内部获权投影，律师去除内部原因和人员身份；客户DTO不增加字段。

数据新增`CaseJudgmentFact`（不可变链，REGISTER根唯一，CORRECT前驱唯一、同案同部门、原因必填）、`CaseJudgmentVersion`（事实到精确内容版本组合关联）、`CaseJudgmentReceipt`（用户／Command／键、指纹及成功快照）及Case当前判决指针。原审计模型不另建平行表；数据库保持当前指针指向本案最新事实、阶段及冻结引用约束，真人审计路径保留既有身份限制。后续Slice引入上诉／执行事实时须补判决更正阻断与竞争测试，不预建空后续模型。

## Task 1: 后端判决事实、材料与同案互斥（Sol）

**Goal:** 独立完成API、真实PG事实及读取，证明登记后不可开庭回退；通过独立审查才交接页面。

**Files:**

- Create: `backend/src/modules/cases/case-judgment.dto.ts`、`case-judgment.service.ts`及其spec；`backend/prisma/migrations/20261008*_case_judgment*/migration.sql`（时间编号保持新建且递增）。
- Modify: `backend/prisma/schema.prisma`、`backend/src/modules/cases/{case.module,case-read.controller,case-read.dto,case-read.service,lawyer-case.controller,case-hearing.service}.ts`及直接spec。
- Modify: `backend/src/access-control/{permission-catalog,access-control.service,prisma-access-control.store,organization.service.spec}.ts`中本动作必要接线，不改共享权限计算。
- Modify: `backend/src/modules/materials/{material.dto,material.service}.ts`及直接spec、`backend/src/core-ld-openapi.spec.ts`、`scripts/prisma-model-owners.mjs`。
- Create: `tests/support/case-judgment-{database,migration}.{mjs,d.mts}`、`tests/e2e/case-judgment-{database,migration}.spec.ts`。
- 既有测试helper只因新增Action／category或支持schema边界实际失配时最小修复，不改旧断言／超时／重试。

**Interfaces:** Consumes已有授权、案锁、材料验证／冻结与RepeatableRead；produces上节DTO、`CaseJudgmentService`、两内部及一律师路由、详情能力／事实和测试helper。新`CASE_JUDGMENT_REGISTER`从受理登记逐Grant复制，`CASE_JUDGMENT_CORRECT`从开庭纠错逐Grant复制；外部客户／公证处无本Slice权限。

**Acceptance / tests:** Spec的CA-008增量全覆盖，特别是授权前重放、真实冻结字节、撤权、旧版本、并发单胜、登记／更正／开庭纠错互斥、失败原子与直接SQL约束。判决归属Case，不允许内部人员拿外案材料、律师拿其他承办案草稿或未获准旧版本；类别`JUDGMENT`／purpose同名，真实MIME及大小沿用材料契约。已有判决一律阻断开庭纠错并撤去详情纠错能力。

- [ ] **Step 1:** 用实际服务及既有认证夹具写登记、金额状态、材料和纠错互斥RED；迁移用随机临时schema，保留82份旧开庭样本。关键断言：

```ts
expect(result.stage).toBe('WAITING_JUDGMENT');
expect(snapshot.judgmentFacts).toHaveLength(1);
expect(snapshot.hearingAdvances).toHaveLength(1);
expect(snapshot.currentJudgmentId).toBe(result.judgmentId);
// 接着真实同账号开庭纠错，必须409且判决／历史不减少。
```

- [ ] **Step 2:** 运行`pnpm --filter @dev-cor/backend test src/modules/cases/case-judgment.service.spec.ts src/modules/cases/case-hearing.service.spec.ts`，保存RED真实失败原因；不以缺依赖／语法错误充当行为RED。
- [ ] **Step 3:** 实现DTO严格输入、服务统一锁顺序、事务新事实／冻结／审计／回执及CASE版本；只新增前向迁移和必要授权目录／材料接线。日期不早于acceptedAt、不晚于北京时间今天，状态值错配、负数及非法格式拒绝，金额规范化复用既有逻辑。
- [ ] **Step 4:** 先运行临时schema迁移专项`pnpm test:e2e tests/e2e/case-judgment-migration.spec.ts --workers=1`，成功再运行`pnpm db:test:migrate:deploy`及数据库专项`pnpm test:e2e tests/e2e/case-judgment-database.spec.ts tests/e2e/case-hearing-database.spec.ts --workers=1`；保留故障注入退出和正常结果，不并行共享状态。
- [ ] **Step 5:** 聚焦后端`pnpm --filter @dev-cor/backend test src/modules/cases src/modules/materials src/access-control src/core-ld-openapi.spec.ts`及后端typecheck、受影响格式／Lint；自审、提交本Task文件，报告接口实况和RED/GREEN／PG证据到`.local/case-judgment/task-1-report.md`。不得修改状态Spec或提前标完成。
- [ ] **Step 6:** Root固定Task累计diff，由独立Sol审查权限、事实链、移植约束、材料生命周期及锁竞争；修复后原主体补审，C／I／M均0、ACCEPTED后才集成Task 2。

## Task 2: 共享页面、契约同步与真实账号验收（Luna）

**Goal:** 运营／律师真实登录、上传、判决登记及内部更正，刷新／重登后读原字节和完整事实；不新增客户端权限。

**Files:**

- Create: `frontend/src/modules/cases/CaseJudgmentPanel.vue`及其spec、`tests/e2e/case-judgment.spec.ts`。
- Modify: `frontend/src/api/{cases,materials,organization}.ts`及直接spec；`frontend/src/modules/cases/{CaseDetailPage,LawyerCaseDetailPage}.vue`及CasePages／相关spec。
- 必要修复组织Action严格解码器与人员／角色页现有契约数量、材料类别和既有Case详情夹具；不改后端schema／公共接口／权限计算。

**Interfaces:** ConsumesTask 1已审查DTO／路由／能力／材料；produces`registerCaseJudgment`、`correctCaseJudgment`接口接线及共享面板。调用模式沿用`CaseHearingPanel`的上下文保护、未知结果保留、错误处理及真实材料上传／下载。

**Acceptance / tests:** 运营与律师正常登记仅按服务端能力显示，更正仅有权运营；日期和文件必填显示、金额显式KNOWN/PENDING（不预填0），提交前展示影响。真实文件集合可核对并下载；登记后不假称进入执行，当前及历史精确事实分别展示。网络／代理5xx保留原Command／body／key，403明确拒绝、409刷新，切案／身份变化迟到响应无效，GET不替代POST裁决。

- [ ] **Step 1:** API解码器及面板行为先RED；至少覆盖待定null、KNOWN0、登记／更正、无更正权、代理502／异码503、同key同body重试、旧版本刷新、切案迟到响应。组织／人员权限目录新增两Action兼容性尽早检查。
- [ ] **Step 2:** 只接线Task 1契约，用共享视觉和现有材料控件实现表单及可折叠历史；用户看“收到判决日期、判决金额、实缴诉讼费、判决书”，不要求理解事实链或UUID。遇公共契约／安全／DB疑点升级Root，不自行扩围。
- [ ] **Step 3:** 运行`pnpm --filter @dev-cor/frontend test src/api/cases.spec.ts src/api/materials.spec.ts src/api/organization.spec.ts src/modules/cases src/modules/organization`及前端typecheck、目标格式。自审后简报，无风险普通Task不单独创建Sol Reviewer。
- [ ] **Step 4:** 运行`pnpm test:e2e tests/e2e/case-judgment.spec.ts --workers=1`；真实管理员角色页授予权限→运营正常来源案件上传／登记→下载原字节→留原因更正→原历史仍可下载→刷新／重登→承办律师登记第二案→客户仍仅原企业允许投影，外人及跨案材料不可见。不得以预置判决事实／测试Bearer／改库代替本次业务动作。
- [ ] **Step 5:** 提交Task 2相关文件，完整报告到`.local/case-judgment/task-2-report.md`，包含Task、实际Model、Commit、files、真实命令／退出／RED-GREEN、contract changes、self-review、known risks、Requires Sol attention。

## 稳定候选与收口（Root）

- [ ] 检查报告／累计diff及真实已实现契约，独立Sol Final Review；补审关闭全部finding，再核对漂移、标准`pnpm context:record`、固定干净commit／tree。
- [ ] 本Slice暂无正式scope；Level 2按真实package入口逐项运行后端cases／materials／access-control／OpenAPI、前端cases／materials／organization／案件壳层相关聚焦集成测试、`pnpm check:fast`、受影响格式、`pnpm spec:check`／`context:check:strict`、双端构建。
- [ ] 固定候选串行运行新判决迁移／数据库／浏览器三文件，加已有开庭数据库／浏览器、律师和材料生命周期受影响回归。根据实际影响补充明确文件选择器，记录实际集合；无法证明影响范围或出现共享机制修改时回退完整`pnpm verify`与适用全量数据库／Chromium，不伪造scope。
- [ ] 同tree／输入／环境的可信聚焦结果可复用，不为收口重复Worker测试；发现实质变化则补审与复验。正式期间禁止代码／测试／文档写入，不提前标通过。
- [ ] 原始退出／时长／非秘密环境证据保存在`.local/case-judgment/`；确认UI／API／PG／权限隔离／迁移／真实浏览器和Review全部齐备后，才在roadmap／VALIDATION及必要恢复摘要补实际完成事实，检查累计收口diff并走现有文档专项。
- [ ] 本轮不领取CA-009，不擅自推送或合并CA-008。MVP余量维持路线图既有口径，外部补录、B13/B15、外围范围及生产条件不被默许删除。
