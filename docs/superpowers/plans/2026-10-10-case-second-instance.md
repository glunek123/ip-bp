# CORE-CA-010 二审办理与结果实施计划

> **For agentic workers:** Use `subagent-driven-development` 按下列可独立验收任务执行。高风险实现、Task Reviewer及最终Reviewer使用6 Sol，方向已定的UI／类型同步和测试执行使用6 Luna；具体交接和审查范围以项目现行协作路由为准，不给普通Task逐一增设Reviewer。

**Goal:** 真实办理二审进展及三种结果，保留同案重审历史，并在尚无正式后续事实时受控纠错，不留下发回重审后不能继续办理的断点。

**Architecture:** 复用cases、真实身份、当前承办、同案锁／CAS、审计、幂等和真实冻结文件。在既有案件内补最小审理轮次及二审不可变事实，窄化适配CA-006～009和原SQL守卫，不建立通用工作流或另一套案件模块。

**Tech Stack:** NestJS／Prisma／PostgreSQL、Vue／Element Plus、Jest／Vitest／Playwright；无新增依赖。

## Global Constraints

- 基线main`a1d99fc446b0753957fb1a268a297ab5f19913de`、tree`4b677d7943f848df58a0d64f61ea837f541327fb`；规则推送后远端已核实，当前分支`codex/core-ca-010-appeal`。
- 业务契约与集中确认边界在[案件Spec](../../spec/v0.1/modules/cases.md#ca-010二审办理与结果)及SD-50。Q1～Q3已按推荐方案确认，独立高风险设计审查后连续实施，不逐Task再次请求确认。
- Level 3：审理轮次改变历史关系及核心阶段／版本SQL守卫；高风险Task独立审查通过后集成，全部Task集成后独立Final Review并关闭全部finding，稳定候选完整`pnpm verify`及适用真实PG／Chromium／迁移专项。不以聚焦scope替代完整门禁。
- 业务办理日期使用`YYYY-MM-DD`／SQL date，操作时间服务端UTC；业务时区`Asia/Shanghai`。金额为非负人民币Decimal字符串、精确到分；待定不填假0。
- 只使用`backend/.env.test`的独立测试库，不打印凭据。前向迁移，不修改117条已支持迁移；随机临时schema先验证迁移链，再部署测试public。不能重置开发／生产库、人工测试环境或持久卷。
- 每个新PowerShell执行Node／pnpm前点加载根`Use-ProjectRuntime.ps1`，核对Node v24.21.0／pnpm11.27.0。一个checkout一个写入者，数据库迁移／清理／故障注入和浏览器不盲目并行。
- 不开发执行材料／执行申请、支付或退费办理、法院撤回上诉／终止、外部历史案件录入、OCR、日历模块或生产存储。客户不新增内部二审资料读取；不自动推进二审、不提供任意状态切换。

## Task 0：确认并冻结业务边界（主Agent／Sol）

- [x] 用户已集中确认Spec Q1～Q3推荐方案；按SD-50实施，不重复询问已确定的角色、身份和Demo节点。
- [ ] 在既有`DECISIONS.md`登记实际批准内容，更新`GAPS.md`中B13的CA-010子范围、`DOMAIN.md` CA08与字段材料契约；不关闭主办／协办、执行结束及其他无关未决项。
- [ ] 自查草案与已批准规则、字段、正常动作和纠错路径一致，确定下列公共接口及新文件的允许写集。高风险轮次／守卫设计需独立Sol审查后再交接实现，不让Luna裁决。

## 接口交接契约

下列名字是本片拟新增契约，不冒称当前源码已存在；Sol经高风险设计审查后统一冻结，禁止Worker各自扩张。

```ts
type SecondInstanceProgressInput = {
  hearingAt: string | null;
  hearingPlace: string | null;
  judgeName: string | null;
  documentContentVersionIds: string[];
  serviceContentVersionIds: string[];
};
type SecondInstanceAnchor = {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  choiceId: string;
  expectedProgressId: string | null;
};
type SaveSecondInstanceInput = SecondInstanceAnchor & {
  progress: SecondInstanceProgressInput;
};
type KnownMoney =
  { state: 'KNOWN'; amount: string } | { state: 'PENDING'; amount: null };
type RegisterSecondInstanceResultInput = SecondInstanceAnchor & {
  progress: SecondInstanceProgressInput;
  resultReceivedAt: string;
  judgmentContentVersionIds: string[];
  paidLitigationFee: KnownMoney;
} & (
    | { result: 'REMAND' | 'AFFIRM' }
    | { result: 'CHANGE'; judgmentAmount: KnownMoney }
  );
type RevokeSecondInstanceResultInput = {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  resultId: string;
  reason: string;
};
```

正常保存追加进展版本并仍为SECOND_INSTANCE。登记结果可同时提交尚未保存的进展，原子冻结实际使用版本和结果，不强制用户先点一次保存。AFFIRM从本轮一审判决冻结金额；REMAND无判决金额，不接收judgmentAmount；三种结果均记录实缴诉讼费KNOWN／PENDING事实，待定不要求金额，不构成已缴费门槛。返回案件ID、stage、总version、currentTrialRoundId、progressId、resultId／revocationId及服务端recordedAt；旧键重放原响应，不按当前阶段重新拼结果。新详情字段由同一后端聚合快照返回，律师去掉内部人员ID／异常原因，客户不增加这些字段。

## Task 1：最小轮次、前向升级及旧链兼容（6 Sol，高风险）

**Files:** 修改`backend/prisma/schema.prisma`；新增本片前向migration；当前轮次解析复用Prisma关系及既有Service，不另建无调用的`case-trial-round.ts`；定向修改`case-acceptance.service.ts`、`case-hearing.service.ts`、`case-hearing-scheduler.service.ts`、`case-judgment.service.ts`、`case-judgment-next-step.service.ts`、`case-read.service.ts`、`case-read.dto.ts`及对应直接测试；迁移测试新增`tests/support/case-second-instance-migration.mjs`／`.d.mts`和`tests/e2e/case-second-instance-migration.spec.ts`。

**Interfaces:** 产生当前轮次解析／建初始轮次能力，Case当前受理指针及分轮事实关系；消费既有案件事务及版本，不改变现有正式接口成功回执。

- [ ] 先写RED：已有旧受理／判决的案发回后不能覆盖原事实，新轮次可再次受理；旧轮次调度信号不能推进当前案；同轮只一个REGISTER根、跨轮文件／事实不能冒用。
- [ ] 定向实现最小轮次关系、当前受理指针及旧受理／开庭／判决／选择回填；未受理案允许首次正式受理时建初始轮次。旧事实时间、身份、审计、回执JSON、冻结内容均不改写，不捏造迁移业务时间。
- [ ] 按轮次升级一审唯一性／链头约束；保留历史冻结、租户组合外键及版本单调性。旧守卫用新前向迁移替换，不能简单删掉阶段／版本校验。新合法后续版本必须由可验证事实链证明。
- [ ] 修改CA-006～009只处理当前轮次；重审仍复用原正式受理、开庭、判决、后续选择入口，接口展示当前轮次而旧事实从历史读取。旧案旧键返回原结果，不能把旧成功当成新轮次受理完成。
- [ ] 冻结轮次切换接口不变量：REMAND新轮无受理／开庭／推进／判决／后续选择，原子清空Case对应全局当前指针及当前案号；旧事实不动。撤销REMAND仅允许结果锚定的精确未办理子轮，原子恢复来源轮受理／开庭安排与推进／一审判决／APPEAL选择及案号，空子轮留存为已撤销且不能再激活，再发回必须新建轮次。新增当前受理指针与现有四个全局指针一并受组合外键／SQL守卫约束，不能仅改currentTrialRoundId。
- [ ] 在独立测试库临时schema验证空链、117条上一支持schema、旧正常／更正／撤销链、直接SQL负例、故障原子及重试，再按规则升级测试public。
- [ ] 运行聚焦Jest及迁移专项，独立Sol Task Review确认后交接Task 2；有schema／核心链修复由原Reviewer补审。

## Task 2：二审Command、真实材料和后续阻断（6 Sol，高风险）

**Files:** 新增`backend/src/modules/cases/case-second-instance.dto.ts`、`case-second-instance.service.ts`、`case-second-instance.service.spec.ts`；修改`case.module.ts`、`case-read.controller.ts`、`lawyer-case.controller.ts`及对应测试；定向修改`backend/src/access-control/{permission-catalog,access-control.service}.ts`及直接测试、`backend/src/modules/materials/{material.service,material.dto}.ts`及直接测试、`backend/src/core-ld-openapi.spec.ts`。新增二审事实／守卫／Grant前向迁移，沿用Task 1轮次契约；在新迁移中窄化扩展律师审计身份函数`enforce_case_client_mailing_actor_path`，不得修改已执行的`20261010033000_allow_lawyer_judgment_next_step_audit`迁移。

**Interfaces:** `CaseSecondInstanceService.save`、`registerResult`、`revokeResult`；内部及律师前缀沿既有Controller，不给律师注册异常撤销路由。正式详情提供current progress/result、分轮历史、获准文件和服务端capabilities。

- [ ] 写RED覆盖真实授权后裁决回执、旧轮次／旧选择／旧进展锚点拒绝、保存不推进、三种结果目标，以及结果撤销和后续事实互斥。
- [ ] 增加保存、结果、撤销不可变事实及回执；正常权限从判决登记逐Grant复制，异常从判决更正复制。同步后端目录、前端解码／人员／角色契约，不扩大既有范围。
- [ ] 新二审材料类别分别区分普通文书、送达文书和裁判文书；复用真实上传、精确版本、下载及冻结规则，不把文件名当文件，不重建存储链。原判和历次二审冻结附件仍可授权下载、不可删除。
- [ ] 同案锁内重读身份／授权／承办、轮次、APPEAL选择、状态和版本；CAS、事实、冻结、审计、回执及REMAND新轮次同一事务。未知提交用原body/key，不自动生成新请求。
- [ ] 二审进展／结果阻断CA-009撤销及原判更正；REMAND结果撤销与重审受理单胜，AFFIRM／CHANGE撤销为后续执行正式事实预留显式阻断点，并在CA-011接入时追加真实事实检查。不能以当前没有执行表认定未来无需守卫。
- [ ] 结果引用的trialRoundId始终为来源轮次，REMAND撤销另核验Case当前轮为该结果创建的精确空子轮；恢复指针只取该来源轮，不用全案最新值猜测。测试REMAND→撤销→重新登记、反复发回新轮唯一、撤销子轮不得复活以及REMAND→新受理→再次上诉，证明恢复与后续推进均不绕过旧事实。
- [ ] 集中运行Controller／OpenAPI、权限目录、材料及Command聚焦测试，正常运营／律师正式读取分别验证必要字段与敏感字段缺席；独立Sol Task Review关闭finding后交接UI。

## Task 3：共享真实页面与严格契约（6 Luna，边界冻结后执行）

**Files:** 修改`frontend/src/api/{cases,materials}.ts`及直接测试，运营／律师沿用同一`cases.ts`的`audience`分派；修改`frontend/src/modules/cases/{CaseDetailPage,LawyerCaseDetailPage}.vue`及直接测试；新增`CaseSecondInstancePanel.vue`／`.spec.ts`；按实际新增Action同步`frontend/src/api/organization.ts`及人员／角色页面直接测试。名单／侧栏不新增平行阶段，必要时仅同步当前数据。

**Interfaces:** 只消费Task 2确定DTO／响应、服务端capabilities和既有材料API，不自行改schema、权限、轮次或金额语义。

- [ ] 组件RED证明“保存仍二审”和“登记结果说明目标”；覆盖必填、未发生可空、真实文件选择、金额待定／0及维持原判只读引用。
- [ ] 接入正常保存、三个结果及有权运营撤销；按轮次显示当前与历史，旧轮次不能被误当当前办理输入，重审可以从同一详情继续正式受理。
- [ ] 覆盖原body/key未知恢复、同案version变化清普通草稿、切案／身份迟到结果、403清敏感内容、409刷新持续反馈。不得只靠隐藏按钮做授权。
- [ ] 自审、相关Vitest、前端typecheck及受影响格式通过后按简报交接；遇到公共契约／权限／轮次冲突立即升级Sol，不自行扩围。普通Task不另建独立Reviewer。

## Task 4：真实闭环与最终候选（主Agent／Sol裁决，Luna执行明确测试）

**Files:** 新增`tests/e2e/case-second-instance.spec.ts`、`case-second-instance-database.spec.ts`及`tests/support/case-second-instance-database.mjs`／`.d.mts`；复用Task 1迁移专项及既有真实账号／材料／cases helper。复杂数据库断言、并发和故障注入由Sol确定，Luna只执行已明确的范围与日志分析。

- [ ] 从正常来源链生成真实待二审案件，运营和律师分别登录办理；保存进展、三结果、刷新／重登、精确文件下载。REMAND必须走到新受理、新开庭、新判决及再次选择，旧历史仍可查，不预置结果状态冒充闭环。
- [ ] 真实PG覆盖只读／跨部门企业／错律师／停用／撤权及重放、同键异参、旧version／round／choice、并发单胜、结果撤销与重审受理、旧轮调度，以及事实／材料／审计／回执故障整笔回滚。不能删除断言、改重试或延长超时掩盖失败。
- [ ] 阶段集成按影响运行聚焦测试与`pnpm check:fast`；正式候选前完成业务契约、AC、必要说明、标准context记录，固定干净commit/tree和环境。独立6 Sol Final Review核对完整组合diff，修复由原Reviewer补审关闭。
- [ ] 在最终稳定候选运行完整`pnpm verify`及下列适用PG／Chromium组；共享数据库串行。若代码、测试或环境改变重新判断失效证据，不能复用旧候选通过结果。
- [ ] 原始日志、真实退出／耗时、候选／环境、HTML／trace和审查报告进入ignored `.local/case-second-instance/`。通过后才补真实VALIDATION证据及路线图完成态，核对累计收口diff后按现行条件专项检查，不把旧业务证据说成收口HEAD实跑。

## 已核实入口与拟执行范围

以下workspace脚本来自实际package.json；新增测试文件由上述Task创建后使用，不新增平行验证入口，不声称这些检查已经运行。

```powershell
. .\Use-ProjectRuntime.ps1
node --version
pnpm --version
pnpm --filter @dev-cor/backend test src/modules/cases/case-second-instance.service.spec.ts src/modules/cases/case-acceptance.service.spec.ts src/modules/cases/case-hearing.service.spec.ts src/modules/cases/case-hearing-scheduler.service.spec.ts src/modules/cases/case-judgment.service.spec.ts src/modules/cases/case-judgment-next-step.service.spec.ts
pnpm --filter @dev-cor/frontend exec vitest run src/api/cases.spec.ts src/modules/cases/CaseSecondInstancePanel.spec.ts src/modules/cases/CasePages.spec.ts src/modules/cases/LawyerCaseDetailPage.spec.ts
pnpm check:fast
pnpm verify
pnpm test:e2e tests/e2e/case-second-instance.spec.ts tests/e2e/case-second-instance-database.spec.ts tests/e2e/case-second-instance-migration.spec.ts tests/e2e/case-acceptance.spec.ts tests/e2e/case-acceptance-database.spec.ts tests/e2e/case-acceptance-migration.spec.ts tests/e2e/case-hearing.spec.ts tests/e2e/case-hearing-database.spec.ts tests/e2e/case-hearing-migration.spec.ts tests/e2e/case-judgment.spec.ts tests/e2e/case-judgment-database.spec.ts tests/e2e/case-judgment-migration.spec.ts tests/e2e/case-judgment-next-step.spec.ts tests/e2e/case-judgment-next-step-database.spec.ts tests/e2e/case-judgment-next-step-migration.spec.ts tests/e2e/case-lawyer.spec.ts tests/e2e/case-lawyer-database.spec.ts tests/e2e/cases.spec.ts tests/e2e/core-leads.spec.ts --workers=1
```

实现改动触及源链、公证转案或其他共享路径时，Sol必须补相应范围；不能把本清单当固定上限，也不为增加覆盖盲目跑无关全库E2E。稳定候选不在所属正式门禁前机械重复其已包含检查；不伪造affected依赖图。

## 当前设计检查与恢复点

2026-10-10实施前已核对Demo字段／三结果、CA-009与SD-49、CA-006一案一受理约束、判决全案单REGISTER根及精确版本守卫、律师与客户投影、材料类别及直接测试、正式workspace命令。用户已集中确认Q1～Q3并登记SD-50；此段只记录设计基线，不表示当前实现状态或验收结果。业务完成态由路线图维护，恢复点见开发状态，实际候选及结果见VALIDATION，本计划不复制动态验收台账。
