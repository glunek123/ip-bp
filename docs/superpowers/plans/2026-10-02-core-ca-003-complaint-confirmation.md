# CORE-CA-003 确认诉状 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to execute this plan; project Sol／Luna routing overrides per-task generic Reviewer defaults.

**Goal:** 运营用真实账号确认本案诉状版本与金额，原子进入诉状待盖章，刷新仍可读，保留原提交事实。

**Architecture:** 在cases模块新增单案Command／不可变确认事实和回执，复用现有Case授权、材料可用性与冻结、Serializable事务、审计、错误和请求层。只按Case当前阶段路由材料写Action，不改变共享权限计算或读取范围。

**Tech Stack:** NestJS、Prisma／PostgreSQL、Vue 3／TypeScript、Jest／Vitest、现有受控Playwright入口。

## Global Constraints

- 权威业务契约：[案件Spec](../../spec/v0.1/modules/cases.md#core-ca-003-确认诉状契约)。一次主要推进仅为`WAITING_COMPLAINT_CONFIRMATION → WAITING_COMPLAINT_STAMP`；不实现邮寄、批量确认、ZIP或后段状态。
- 原提交版本／金额／回执不覆盖；本次确认精确诉状版本、金额状态与条件说明另存。更换版本或金额事实须`changeNote`；`confirmDisclose`只是需要下载的选择，不宣称已下载。
- 后端当前内部身份、部门、独立写Action、阶段、版本、材料重新校验。SELF不得借DEPARTMENT读取提权；外部账号不得确认。撤权／转派后下一请求包括重放立即失效。
- 同一事务完成阶段、事实、审计、冻结、回执；同键重放原结果、异请求冲突、并发只一份，任何失败整体回滚。
- 仅前向迁移，仅`backend/.env.test`独立测试库及随机临时schema；不输出凭据，不操作开发／生产库或持久化卷，不降断言／删测试／掩盖失败。
- 同一共享目录只有一名实现Writer；共享数据库测试串行。每次新PowerShell执行Node／pnpm前加载并核对项目运行时。日志保存在`.local/logs/`并保留真实退出状态。
- 本切片按Level 2：既有机制上的普通业务Action及非破坏增量迁移；若必须改共享身份／隔离／权限计算则升级主Agent裁决，不自行扩大。高风险Task仍Sol执行和独立Sol Review，全部集成后一次Final Review。

### Task 1: 后端、前向迁移与真实数据库风险验证（Sol）

**Goal:** 实现Spec中确认接口、读能力和不可变事实，交付可独立验证的API闭环。

**Allowed files:** `backend/prisma/schema.prisma`；新迁移`20261002020000_add_case_complaint_confirmation`（枚举）、`20261002020500_add_case_complaint_confirmation_facts`（事实及约束）、`20261002021000_add_case_complaint_confirmation_grants`（Grant）；`backend/src/modules/cases/`中的新`case-complaint-confirmation.{dto,service}.ts`、直接spec、migration probe及既有read DTO／service／controller／module／index与直接spec；`backend/src/access-control/{access-control.service,permission-catalog,prisma-access-control.store}.ts`及直接spec；`backend/src/modules/materials/material.service.ts`及直接spec；`backend/src/core-ld-openapi.spec.ts`；`scripts/prisma-model-owners.mjs`；`tests/support/core-lead-database.{mjs,d.mts}`和最小新增`case-complaint-confirmation-{database,migration}.{mjs,d.mts}`；`tests/e2e/case-complaint-confirmation-{database,migration}.spec.ts`。仅必要兼容调整既有`tests/e2e/cases.spec.ts`清理／断言，不重构全套夹具。

**Relevant interfaces:** 参考`CaseComplaintService.submit`与`CaseReadController`现有`complaint-submit`路由；请求新路由`complaint-confirm`，字段和返回严格按Spec。Action目录新增`CASE_COMPLAINT_CONFIRM`映射`case.complaint.confirm`，授权仍用既有`authorizeCase`。新事实建议`CaseComplaintConfirmation`，新回执`CaseComplaintConfirmationReceipt`，均归cases模块；确认事实保存原始提交对比所需字段和独立审计关联、部门组合约束，精确材料引用由MaterialsService执行。读DTO增加`canConfirmComplaint`、`complaintConfirmation`及第四阶段计数。固定确认文件通过材料模块返回，不由cases跨模块直接操作材料表。

**Acceptance / required tests:** AC-CA-011全部API／PG风险；权限目录与人员角色兼容、新增阶段计数／只读能力；原提交和冻结保留；审计、冻结、事实和回执故障回滚；幂等、并发、撤权重放；外部门／外企业／外部身份拒绝；本案有效材料选择、修订上传仅COMPLAINT、无权／其他阶段不得上传；空库全部迁移、上一schema合成旧提交及回执升级、负向SQL、失败原子／重试。新Grant保持旧scope，仅实际变动模板／有效成员授权版本失效。

- [ ] RED：先补失败的确认Command、材料阶段权限及迁移契约测试，保留预期失败输出。
- [ ] GREEN：实现最小前向迁移和独立确认事实；严格归一化／指纹／锁／CAS／回执、审计／冻结，保留所有旧事实。
- [ ] PostgreSQL新枚举使用必须跨提交：枚举、业务结构及Grant分别用独立迁移事务，验证各自失败原子性和前向续跑；不得将文件内前段已提交、后段回滚称作整份迁移原子回滚。本切片尚未发布、仅独立本地测试schema执行的新迁移草稿可在合入前修订并完整复验；共享环境已执行的迁移保持不变。原证据输入改变即失效，先临时schema专项，再以已核对的受控测试库入口同步，不掩盖checksum漂移。
- [ ] 运行`pnpm --filter @dev-cor/backend test src/modules/cases src/modules/materials/material.service.spec.ts src/access-control src/core-ld-openapi.spec.ts`及必要类型／构建；先完成临时schema迁移专项，再部署独立测试schema，串行运行`pnpm test:e2e tests/e2e/case-complaint-confirmation-migration.spec.ts tests/e2e/case-complaint-confirmation-database.spec.ts`。验证实际匹配非0项。
- [ ] 自审、只提交Allowed文件，完整报告写`.local/ca003/task-1-report.md`，含RED／GREEN、命令／结果／证据、changed files、公共契约、风险及Requires Sol attention；对话返回简报。主Agent生成base..head完整Review包，独立Sol Task Review通过才交给Task 2。

**Forbidden changes:** 前端、通用授权／身份／存储Provider架构、旧迁移、删除／改写历史、后续slice、流程门禁或Current／Next。遇到必须越界先报告。

### Task 2: 正式运营页面与真实浏览器闭环（Luna）

**Goal:** 基于已审查API实现快速上手的单案确认、原提交／确认记录和真实逐件下载。

**Allowed files:** `frontend/src/api/cases.{ts,spec.ts}`、`organization.{ts,spec.ts}`；`frontend/src/modules/cases/`既有Detail／List／Pages.spec与新`CaseComplaintConfirmationPanel.{vue,spec.ts}`；`frontend/src/app/AppShell.{vue,spec.ts}`及直接cases stage/count辅助文件；`frontend/src/modules/organization/RoleTemplateEditor.spec.ts`和必要人员页面兼容测试；新`tests/e2e/case-complaint-confirmation.spec.ts`。Task 1已提供helper仅调用，不改backend／schema／安全契约；确需helper扩展由主Agent另裁决。

**Relevant interfaces:** 仅使用Task 1已固定的读／写DTO；严格解码第四阶段、`canConfirmComplaint`和确认摘要，新Action同步人员／角色解码器。使用已有真实上传／下载、ApiError与状态变化事件。

**Acceptance / required tests:** 唯一版本自动选、多项必须明确选，默认使用已提交金额事实；必填星号，操作前说明进入诉状待盖章及原记录不覆盖；更换版本／金额须说明，PENDING不写假0。真实修订上传、提交加载／冲突／未知结果原key恢复，切案／切账号及卸载阻断迟到结果，刷新成功事实；非负责人只读真实下载。成功后列表和单套侧栏计数同步，诉状待盖章无未实现邮寄按钮。`confirmDisclose`选择与逐件下载入口明确，不假ZIP成功。

- [ ] RED：组件／严格API解码／角色兼容测试先失败；GREEN实现最小面板和接线，不重构整个Detail。
- [ ] 运行`pnpm --filter @dev-cor/frontend test src/api/cases.spec.ts src/api/organization.spec.ts src/modules/cases src/app/AppShell.spec.ts src/modules/organization/RoleTemplateEditor.spec.ts`及必要typecheck；自审无需另设Task Reviewer。
- [ ] 使用正式密码会话和正式API建立源链／材料（不是预置待确认记录），运行`pnpm test:e2e tests/e2e/case-complaint-confirmation.spec.ts`，证实提交→确认→下载真实字节→刷新／重登；只读另账号拒绝写。
- [ ] 只提交Allowed文件，报告`.local/ca003/task-2-report.md`按项目Completion Report并附RED／GREEN与真实浏览器证据。风险／contract冲突第一次出现升级Sol，不自行改后端或扩围。

### Task 3: 集成终审、固定候选与收口（主Agent＋独立Sol）

- [ ] 核对两Task报告／文件／风险，不完整重做普通UI；对全分支相对`eef05ec`生成Review包，独立Sol Final Review，集中修复finding并由原主体关闭。
- [ ] 同步实质契约及必要文档在门禁前完成。只读context解释全部本轮diff后标准`context:record`／strict，提交并固定干净候选commit/tree／测试环境指纹；门禁期间不修改。
- [ ] 候选执行上面相关双端单元、`pnpm check:fast`、受影响Prettier、`pnpm spec:check`、`pnpm context:check:strict`、`pnpm build:prepared`；串行受控E2E运行本切片三文件和既有`tests/e2e/cases.spec.ts`，覆盖CA-001／002真实链及权限／材料回归。临时schema迁移结果须与固定迁移文件一致。当前无CA-003自动scope，不伪造Evidence v2；若出现共享机制变化／无法界定影响则扩大正式门禁。
- [ ] 全部通过后才在VALIDATION记实际候选／命令／证据，将路线图CA-003完成、CA-004 Current、CA-005 Next；project-status仅摘要。累计收口diff只允许已确认的状态／证据／对应快照，按现有专项文档检查，不把旧候选说成最终HEAD实跑。
- [ ] 标准context记录／strict和适用格式／Spec通过后本地提交交付。未通过明确未完成和失败命令；不因阶段周转反复要求用户继续，不擅自发布或执行开发／生产迁移。
