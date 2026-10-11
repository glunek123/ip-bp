# CORE-CA-011 上传执行材料实施计划

> **For agentic workers:** Use `subagent-driven-development` 或 `executing-plans` 按任务边界实施；主Agent、schema／核心Command及独立Reviewer使用6 Sol，已定UI／类型同步、测试执行使用6 Luna。普通Task自审和聚焦验证交接，不逐Task增设Reviewer。

**Goal:** 运营和当前承办律师真实提交执行申请材料，原子进入执行材料待确认，并保护上游已生效历史。

**Architecture:** 复用cases、当前承办授权、同案锁／CAS、审计、真实材料精确版本与幂等回执；只追加本动作不可变提交和当前指针，不扩建通用工作流。按SD-51同时交付确认前留原因同阶段重提，旧提交和冻结材料全部保留。

**Tech Stack:** NestJS／Prisma／PostgreSQL、Vue／Element Plus、Jest／Vitest／Playwright；无新依赖。

## Global Constraints

- 基线main `caba39d264d68da11577519d4dc87852571240a4`，tree `c6cd66ea2348ac4919bc872bcb71c3841218e29a`；CA-010及最新前置反馈规则已推送集成。分支`codex/core-ca-011-execution-materials`，Current为CA-011实施中、Next为CA-012未领取。
- 唯一业务设计见[案件Spec](../../spec/v0.1/modules/cases.md#ca-011上传执行材料)；SD-51已批准本片重提。业务问题已明确，按计划连续实施，不新增重复设计文档，不重复确认已有角色／材料门槛。
- Level 3：本动作接入核心阶段／版本SQL守卫及上游撤销竞争；高风险Task独立Sol Review通过后集成，集成后独立Final Review，关闭finding后固定候选并运行完整verify和适用真实PG／Chromium／迁移专项。
- 首次仅推进`WAITING_EXECUTION_DOCUMENTS → WAITING_EXECUTION_CONFIRMATION`。不实现CA-012确认、盖章邮寄、法院申请执行、财务、批量、识别、外部历史入口或生产存储。
- 单份PDF／DOC／DOCX ≤50MB；1～10份真实`EXECUTION_APPLICATION`精确版本。UTC记录时间、Asia/Shanghai显示；不新增必填日期或金额。
- 每个新PowerShell先点加载`Use-ProjectRuntime.ps1`，核对Node v24.21.0／pnpm11.27.0。只用`backend/.env.test`独立测试库；随机临时schema先验迁移再部署测试public，不打印凭据，不改130条旧迁移。
- 一个checkout一个写入者；共享PG迁移／清理／故障注入／浏览器串行。Worker只跑本Task聚焦验证；Root不重复普通Worker已通过测试。

## 最小接口例子（拟新增，不冒称现有代码）

```ts
interface SubmitExecutionRequest {
  expectedVersion: number;
  idempotencyKey: string;
  trialRoundId: string;
  judgmentNextStepId: string;
  secondInstanceResultId: string | null;
  expectedSubmissionId: string | null;
  executionApplicationContentVersionIds: string[];
  changeReason?: string;
}
interface SubmitExecutionResult {
  id: string;
  submissionId: string;
  stage: 'WAITING_EXECUTION_CONFIRMATION';
  version: number;
  submittedAt: string;
}
```

直接转执行：当前选择next=EXECUTION，secondInstanceResultId=null；二审转执行：当前选择next=APPEAL，指定当前有效CHANGE／AFFIRM结果ID。首次expectedSubmissionId=null且不填changeReason；重提必须为当前精确ID且changeReason去首尾空白后1～500字符。首次成功和重提均准确+1；同键重放返回原version／时间，不增加历史。UI随后正常读取最新详情，不把旧回执当当前快照。

案件列表增加可选`stageGroup=EXECUTION_PREPARATION`，与单一`stage`互斥，混传400；内部／律师列表分别在原读取／承办范围内按本片已存在的两个执行准备阶段过滤。侧栏“准备执行文书”直接链接此组、计数为同范围原子阶段之和，不再列重复子阶段；未来CA-012接入第三阶段时增量扩展，不预造可办理的盖章阶段。

## Task 1：提交事实、迁移与Command（6 Sol）

**Allowed files:** `backend/prisma/schema.prisma`、新增`backend/prisma/migrations/*/migration.sql`、`scripts/prisma-model-owners.mjs`；新增`backend/src/modules/cases/case-execution-submission.dto.ts`／`.service.ts`／`.service.spec.ts`；现有case module／read controller／read DTO／read service及直接测试、lawyer controller；`backend/src/modules/cases/client-case.service.ts`／`.spec.ts`、`client-case.response.dto.ts`及client controller直接测试，仅兼容阶段；`case-judgment-next-step.service.*`、`case-second-instance.service.*`及其来源SQL守卫的前向增量；access-control目录中本片Action／能力映射和直接契约测试；materials服务／DTO及直接测试。禁止改共享授权算法或无关模块。

- [ ] 写DTO／Controller RED：缺null来源锚、非UUID／重复／空版本、未知字段拒绝；内部和律师响应精确解码，错误使用既有统一结构。
- [ ] 写Command RED：直接／二审合法来源、首次+1、原键重放、异参冲突、过期版本／轮次／结果、无权限／当前律师失效；逐个模拟事实／冻结／审计／回执失败。先跑`pnpm --filter @dev-cor/backend test src/modules/cases/case-execution-submission.service.spec.ts`取得RED，不用假成功fixture替代业务断言。
- [ ] 追加提交／附件／回执模型和Case当前指针、最小枚举Action及受限审计／材料身份分支；按现有复合外键和不可改删模式约束来源链，迁移随机临时schema先验证，不修改旧SQL。仅从真实已有Grant同范围复制，不写死职位授权。
- [ ] 实现上述严格接口；正常动作共用同一事务，来源选择、结果、执行提交及上游撤销同案锁内重新检查。上游按对应来源的正式执行提交事实阻断，而非仅靠阶段；草稿上传不阻断。
- [ ] 按SD-51追加同阶段重提新事实／必填原因／精确前版链，无变化重提拒绝；不创建任意回退或删除历史。CA-012正式确认接入时必须补新后续事实阻断及竞争验收，本片不伪造不存在的确认表已受验证。
- [ ] 实现同快照内部／律师当前提交和历史投影／capability及上述执行准备组查询／单阶段互斥校验；不改变原读取或承办范围。客户端已处理列表白名单、详情DTO和阶段类型兼容新阶段，客户不返回新增内部字段和未确认材料。上传、完成、枚举、下载和重放均重新校验当前身份。直接测试覆盖客户端提交后仍可列出／读取正确阶段且敏感字段缺席。
- [ ] 先跑直接Command／Controller／read／materials和现有权限目录契约；Sol编写高风险真实PG断言和迁移helper（新增`tests/support/case-execution-submission-database.mjs`／`.d.mts`、`case-execution-submission-migration.mjs`／`.d.mts`及对应`tests/e2e/*-database.spec.ts`／`*-migration.spec.ts`），覆盖并发、上游撤销竞争、SQL负例、逐写点回滚及迁移专项。Luna可按明确命令执行测试，不自行裁定不变量；把实际兼容点／命令／退出状态交接独立6 Sol Reviewer，ACCEPTED且C/I/M0才集成。

## Task 2：共享正式页面与类型接线（6 Luna，依赖Task 1已审契约）

**Allowed files:** `frontend/src/api/cases.*`、`materials.*`、`organization.*`及直接测试；`frontend/src/api/client-cases.ts`／`.spec.ts`、`frontend/src/modules/client/ClientCaseListPage.vue`、`ClientCaseDetailPage.vue`与现有`ClientCasePages.spec.ts`仅阶段兼容；新增`frontend/src/modules/cases/CaseExecutionSubmissionPanel.vue`／`.spec.ts`及本片恢复helper／spec；现有`CaseDetailPage.vue`、`LawyerCaseDetailPage.vue`、`CaseListPage.vue`、`LawyerCaseListPage.vue`及直接测试、`CasePages.spec.ts`、`frontend/src/app/AppShell.vue`／`.spec.ts`和直接阶段配置。禁止变更公共业务契约、权限算法或数据库。

- [ ] 先写严格解码RED：必填null锚、空提交历史、真实非空文件、+1回执、内部／律师字段差异、客户列表／详情的新阶段与拒收敏感字段；直接运行API／组件目标测试，不等浏览器才发现响应形状。
- [ ] 实现共享上传／明确选件／提交／历史下载面板；只有一个合法选项自动选择。显式说明上传不推进、确认提交后进入待确认并限制上游撤销，必填星号、加载、稳定错误和成功后重新读服务端事实齐备。
- [ ] 未知结果保留原body／key在当前页面生命周期内核对重试；403清敏感资料、409刷新后保留明确冲突提示，切案／切身份的迟到响应不得覆盖。不得声称整页刷新会保留未完成请求，或自动重传未知上传。
- [ ] 实现留原因确认前重提，旧提交／文件只读保留；不提前做CA-012确认按钮。侧栏准备执行文书直接进入上述组查询，两个已存在阶段计数／筛选一致，不再展开重复子阶段，也不在正文重复节点导航；不顺手重构起诉文书导航。客户端列表／详情明确显示新阶段，但不增加提交按钮、未确认执行材料或内部原因。
- [ ] 自审，运行本Task API／组件测试、前端类型和受影响格式；简报列changed files、兼容点、真实结果及未验证边界，风险升级Sol，不另开普通Task Reviewer。

## Task 3：真实纵向验收与迁移证据（6 Luna执行；高风险断言由Sol裁定）

**Allowed files:** Luna只新增`tests/e2e/case-execution-submission.spec.ts`真实浏览器纵向用例及其不涉及数据库规则的页面交互辅助。`tests/support/case-execution-submission-database.mjs`／`.d.mts`、migration helper、`*-database.spec.ts`／`*-migration.spec.ts`及旧清理／历史迁移支持边界由Task 1 Sol独占编写；本Task只按已定命令执行并回报，不自行修改数据库不变量或SQL。发现相关缺口升级Sol，不改Playwright配置、超时、重试或旧迁移断言。

- [ ] 复用现有真实密码账号及正常来源链，经CA-009直接转执行先走一条运营上传→提交→待确认→下载→刷新／重登录；fixture不得预置本片目标成功状态。低成本契约通过后尽早跑该单例，不等最终整组。
- [ ] 再验证当前律师正常办理、同部门只读组员下载但写拒绝、其他律师／跨部门／外部身份拒绝；提交后同企业真实客户账号在已处理列表仍看到本案，详情／刷新／重登录识别新阶段且不泄漏执行草稿／历史／内部原因；另一企业不可读。内部两种view和律师侧栏组计数／过滤一致。二审CHANGE／AFFIRM及重审轮后转执行保留准确来源，不重复承担全系统盘点。
- [ ] 实库验证同键重放／异参、旧锚／版本、运营律师竞争、提交与两类上游撤销竞争、撤权下一请求和逐写点失败原子回滚；覆盖重提旧文件留存、原因必填、旧提交锚拒绝、两人重提单胜。未来CA-012确认竞争须随该事实接入后再实测，不提前声称已验证。
- [ ] 新迁移先在独立测试库随机临时schema跑空库全部链和130条旧schema合成数据升级，保留旧分轮／结果／回执／文件引用；验证直接SQL负例、失败原子及向前重试，再正式部署测试public。检查受影响旧fixture清理顺序，不盲改历史总数。
- [ ] 通过受控`pnpm test:e2e`入口按实际新文件和名称选择器运行，--workers=1；没有0匹配成功。监听先于动作、核对对象ID／version、精确选文件，授权变更重登；失败先分类，不因一例失败无证据复跑整组。

## Task 4：集成Final Review与正式收口（主Agent／独立6 Sol）

- [ ] 集成已审高风险Task和普通Task报告，Root运行阶段集成及`pnpm check:fast`；同步最终获准Spec／必要Decision与字段契约，不在Spec写动态“待门禁／已通过”。
- [ ] 固定候选后独立Final Review覆盖全部累计diff及真实风险证据；由原Reviewer确认finding修复，必要补审后再固定稳定候选，不并行改候选和正式验证。
- [ ] 完整`pnpm verify`，以及按真实影响分析确定的执行提交／上游判决选择／二审／材料／权限／迁移PG与Chromium组。门禁前保存候选commit/tree和环境指纹，结束再次核对；完整日志保存在现有ignored `.local/`报告，只汇报关键失败与真实退出。
- [ ] 成功后只补路线图完成态、VALIDATION证据及project-status恢复摘要；核对实际验证候选至收口的累计diff，解释漂移再标准context:record／strict和文档检查。实质修改仍补审复验，不把旧候选结果称为最终HEAD实跑；未通过不标完成，不默认推送新片或自动领取CA-012。
