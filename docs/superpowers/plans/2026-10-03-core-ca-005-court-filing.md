# CORE-CA-005 提交法院实施计划

> **For agentic workers:** 使用subagent-driven-development执行；Sol／Luna风险路由优先，普通Task自审交接，核心Command／迁移独立Sol Review，全部集成后一次Final Review。本计划不维护动态验收台账。

**Goal:** 获授权运营用真实法院、日期及材料完成单案待提交立案到待正式立案。

**Architecture:** 复用cases Command、Query、材料和权限目录；仅追加案件阶段、cases所属法院目录、不可变提交事实／材料引用／回执和内部Action。既有认证、授权计算、企业投影和通用审计／事务机制不重构。

**Tech Stack:** 既有NestJS／Prisma／PostgreSQL、Vue 3、Jest／Vitest／受控Playwright，无新依赖。

## 全局约束

- 基线main `b28e0f35fa8de21f752145e43177b7defe450341`，分支`codex/core-ca-005-court-filing`；[案件Spec CA-005与AC-CA-013](../../spec/v0.1/modules/cases.md#core-ca-005-提交法院契约)是唯一业务边界。
- Level 2：复用共享安全机制、普通可失败原子前向迁移；若实际修改身份／隔离／通用事务机制或历史数据语义，立即升级Level 3，不为省验证维持错误分级。
- 同一工作区只允许一个写入者，Task 1接受后再Task 2；共享数据库／迁移／故障注入串行。每个PowerShell先加载项目runtime并核对版本，数据库仅backend/.env.test，秘密不输出，不reset，不修改已执行迁移。
- 不做CA-006、批量、历史转入、金额更正或法院管理平台；不改门禁、锁文件、CI及无关业务。只本地提交，默认不push／merge／部署。

### Task 1：Command、查询、最小法院目录及迁移（Sol）

**Goal:** 后端重新核验状态、范围、法院、日期和精确材料，原子记录提交事实并推进。

**Allowed files:** backend/src/modules/cases的`case-filing.{dto,service,service.spec}.ts`、必要法院服务及直接测试、既有`case-read.{controller,dto,service,controller.spec,service.spec}.ts`、module/index、client-case严格阶段类型；backend/prisma/schema.prisma及仅新增迁移；scripts/prisma-model-owners.mjs；backend/src/access-control权限目录及直接测试；backend/src/modules/materials既有CASE材料过滤和直接测试；backend/src/core-ld-openapi.spec.ts；新增tests/support/case-filing-{database,migration}.{mjs,d.mts}和tests/e2e/case-filing-{database,migration}.spec.ts。必要权限Action同步frontend/src/api/organization.ts及其契约测试，仅机械同步、不接UI。

**Relevant interfaces:** Spec三路由；POST推进返回`{id, stage, version, submittedAt, recordedAt}`；内部详情追加`filingSubmission`（法院、日期、诉调号、精确材料、操作者），列表／详情`canSubmitFiling`；stage及counts追加WAITING_FORMAL_ACCEPTANCE。法院目录属于cases、部门内稳定ID／名称；客户投影不返回新内部事实，既有已登记查询可读取新阶段。

**Acceptance / required tests:** 先保留RED；命令合法／非法、目录真实入口／去重／异部门、精确冻结、权限目录兼容、旧版本／同键／并发、撤权／停用／转派后重放、所有失败回滚。聚焦`pnpm --filter @dev-cor/backend test src/modules/cases src/modules/materials/material.service.spec.ts src/access-control src/core-ld-openapi.spec.ts`。随机临时schema先验证全链／上一64份／每份失败原子与向前重试／SQL负向，再必要`pnpm db:test:migrate:deploy`，受控`pnpm test:e2e tests/e2e/case-filing-migration.spec.ts tests/e2e/case-filing-database.spec.ts`。正常链经正式API，不预置WAITING_FILING。

**Forbidden:** 共享机制改造、复制新权限平台、客户法院提交／内部材料泄露、假数据库状态、修改旧迁移、删断言／增加重试、全量E2E／verify机械重复。范围冲突先升级。

执行中仅追加允许修改`backend/src/modules/cases/case-complaint-mailing.service.spec.ts`的未来日期测试：原固定日期跨日后不再是未来，按实际复现改为Asia/Shanghai动态明日，保留拒绝及事务前校验断言；不改生产规则或测试配置。

**Report:** .local/ca005/task-1-report.md，Task／Model／Commit／Changed files／Tests executed及真实退出结果／Contract changes／Self-review findings／Known risks／Requires Sol attention；报告RED／GREEN及迁移真实结果。只提交Allowed文件。独立Sol Task Review查固定基线到HEAD累计diff，finding关闭后交接。

### Task 2：真实提交表单、阶段导航、严格API与浏览器（Luna）

**Goal:** 按已接受后端契约接运营提交入口，法院录入／单选自动完成、材料上传下载、刷新持久化与只读边界。

**Allowed files:** frontend/src/api/cases.{ts,spec.ts}、client-cases.{ts,spec.ts}阶段兼容、organization.{ts,spec.ts}／materials严格类型；frontend/src/modules/cases新增CaseFilingPanel.{vue,spec.ts}及现有Detail／List／Pages.spec；frontend/src/app/AppShell.{vue,spec.ts}及相关router测试；人员／角色目录直接测试；新增tests/e2e/case-filing.spec.ts，只调用Task 1已接受helper。

**Interfaces:** Task 1最终DTO，不自行变更；最小法院输入调用正式API；详情显示已确认金额但不编辑。后端允许时才上传／提交，无法操作仅只读可下载；客户端新阶段可解码但无内部事实。

**Acceptance / tests:** 先RED后实现；必填星号、唯一选择、材料限制／迟到上传、提交影响说明、已知冲突／未知请求原键重试、切案／账号／授权版本迟到隔离；列表／侧栏阶段同一口径。聚焦`pnpm --filter @dev-cor/frontend test src/api/cases.spec.ts src/api/client-cases.spec.ts src/api/organization.spec.ts src/modules/cases src/app/AppShell.spec.ts src/modules/organization/RoleTemplateEditor.spec.ts`。`pnpm test:e2e tests/e2e/case-filing.spec.ts`真实账号完整正常源链→法院录入→上传→提交→刷新／重登和文件字节；另一运营只读／客户已登记可读但无内部提交文件。非零选择和真实退出码必须保留。

**Forbidden:** 后端／安全／迁移／业务契约变更、Mock冒充验收、无依据样式改造、重复阶段条、先实现正式受理。风险信号立即升级。

执行中仅追加允许修改`CaseComplaintConfirmationPanel.spec.ts`夹具，补严格案件响应新增的`canSubmitFiling:false`与`filingSubmission:null`，不改原断言；客户端阶段标签和`ClientCasePages.spec.ts`同步既有投影，不新增内部字段。

**Report:** .local/ca005/task-2-report.md同Task 1字段；普通Task自审＋聚焦测试，不新增独立Task Reviewer。

### Task 3：候选Final Review、定向门禁与收口（主Agent／独立Sol）

- 核对任务报告／changed files／diff摘要／风险；独立Final Review累计main基线到候选diff，修复并关闭全部finding。
- 最终业务契约在候选冻结前同步；解释全部context漂移后标准record／strict并固定干净commit/tree。暂无cases scope，执行实际现有Level 2逐项门禁，不编造scope。
- 固定候选集中执行受影响单元／契约、check:fast、受影响格式、Spec、prepared构建、迁移专项和CA-005真实数据库／Chromium闭环及必要旧CASE回归；有真实共享安全机制变化升级完整verify和对应全量回归。报告保存.local/ca005各次独立日志及退出码，失败不覆盖旧证据。
- 全部通过后才CA-005完成、CA-006 Current、CA-007 Next；VALIDATION记录实际候选、结果和边界，project-status仅摘要。累计仅状态／证据／解释快照时文档专项，不把新HEAD称旧候选已实跑。
- 不开始CA-006，不默认推送／合并；失败明确未完成、具体失败命令和阻塞。
