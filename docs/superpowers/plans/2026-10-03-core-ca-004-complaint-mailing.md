# CORE-CA-004 客户盖章邮寄实施计划

> **For agentic workers:** 使用subagent-driven-development按任务实施；项目Sol／Luna路由及独立Review要求优先，普通UI Task不增设独立Reviewer。计划只记录实施边界，不作动态完成台账。

**Goal:** 真实客户或获权运营登记单案实际邮寄日与凭证，原子从诉状待盖章进入待提交立案。

**Architecture:** 在既有cases模块新增企业过滤的最小Client Query；双身份共用邮寄Command与事务事实，不调用内部案件投影给客户。材料模块只扩展明确CASE客户谓词与精确冻结版本白名单，复用现有身份、上传／下载、审计和幂等机制。

**Tech Stack:** 既有NestJS／Prisma／PostgreSQL、Vue 3／TypeScript、Jest／Vitest／Playwright，无新依赖。

## 全局约束与依据

- 基线`main@58e405665ea295890cc949c33854b525d902ba9f`；分支`codex/core-ca-004-complaint-mailing`。CA-003已推送／快进集成，main tree与原收口tree一致，没有额外组合代码。
- 契约为[案件Spec的CORE-CA-004](../../spec/v0.1/modules/cases.md#core-ca-004-客户盖章邮寄契约)与AC-CA-012；唯一Current为CA-004，Next为CA-005，不实施后者。
- 首次客户端CASE读取／材料路径，按Level 3；高风险Task使用gpt-6-sol及独立Sol审查，明确UI执行由gpt-6-luna；同一目录单写入者，后端API接受后再接UI。
- 每个新PowerShell先加载`Use-ProjectRuntime.ps1`并核对Node v24.21.0、pnpm11.27.0；只写`backend/.env.test`独立测试库，秘密不入日志，禁止reset、开发／生产迁移或卷删除。新迁移草稿先随机临时schema验证，再部署测试schema；不修改已执行迁移。
- 不改共享权限平台、门禁配置、依赖锁或既有线索／公证业务，不提前实现盖章邮寄以外阶段。更正／撤回与批量另作后续；不自动调用快递或生产Provider。

### Task 1：双身份Command、Client Query、CASE材料边界与迁移（Sol）

**Files:** 新建`backend/src/modules/cases/case-complaint-mailing.{dto,service,service.spec}.ts`、`client-case.{controller,service,service.spec,response.dto}.ts`；修改该模块`case-read.{controller,dto,service,controller.spec,service.spec}.ts`、`case.module.ts`及公开`index.ts`。允许schema和仅新增前向migration、`scripts/prisma-model-owners.mjs`；新增Action涉及的`backend/src/access-control/{permission-catalog,access-control.service,prisma-access-control.store}`及直接契约测试；`backend/src/auth/auth.service`仅客户端固定能力投影和直接测试（确需改其他身份规则须升级主Agent）。材料`material.{dto,service,service.spec}.ts`、公开索引及必要同目录CASE过滤小helper；`backend/src/core-ld-openapi.spec.ts`。新建`tests/support/case-complaint-mailing-{database,migration}.{mjs,d.mts}`及`tests/e2e/case-complaint-mailing-{database,migration}.spec.ts`。

**Interfaces:** 生产内部／客户两个POST路由均消费同一DTO：`{ expectedVersion, idempotencyKey, mailedAt, mailReceiptContentVersionIds }`，返回`{ id, stage, version, mailedAt, recordedAt }`。内部详情新增`complaintMailing`与`canMailComplaint`，第五阶段为`WAITING_FILING`；客户`GET /api/v1/client/cases[/:id]`用企业过滤、最小具名DTO，不引用内部响应DTO。客户端材料仅获准精确版本，无未经确认的当前版本或内部元数据。

客户列表`view=PENDING|RECORDED`默认PENDING，列表／详情只加权利主体及被告名称，详情确认金额只读不可变确认事实，不带内部修改说明。数据库上传／审计客户路径按Spec仅扩两表，作为第四份新迁移；额外允许`material-cleanup.service.spec.ts`补撤销后清理回归，不改共享Auth／transaction／audit服务。随机schema验证目标为64份迁移／上一支持60份，已执行迁移不修订，逐份验证失败原子和向前重试。

- [ ] 先写Command合法／非法及企业隔离、Client Query脱敏、材料猜ID／精确版本越权、日期／版本／幂等、权限目录兼容的失败测试，保留实际RED，不改旧断言适配错误实现。
- [ ] 实现稳定案锁／CAS、当前账号与绑定／Grant、精确凭证、不可变事实／审计／冻结／回执事务；使用已确认schema命名，枚举、业务约束、初始化Grant分别单事务前向迁移，保留旧记录和旧回执。
- [ ] 聚焦命令：`pnpm --filter @dev-cor/backend test src/modules/cases src/modules/materials/material.service.spec.ts src/access-control src/auth/auth.service.spec.ts src/core-ld-openapi.spec.ts`；有必要才类型／构建，不机械重跑无变化检查。
- [ ] 在独立测试库随机schema先验证空库全部迁移、上一支持60份schema合成旧数据、SQL约束负向、每份部署失败原子及向前修复重试；确认完成后用`pnpm db:test:migrate:deploy`前向部署，禁止reset或账本伪修。
- [ ] 真实PostgreSQL：`pnpm test:e2e tests/e2e/case-complaint-mailing-migration.spec.ts tests/e2e/case-complaint-mailing-database.spec.ts`，覆盖客户／运营成功、跨企业／部门、撤绑定／停用／撤权／转派即时及重放、不可用版本／缺确认事实、审计／事实／冻结／回执故障和双身份并发单胜。辅助初始化走正式API完整源链，不预置待盖章状态。
- [ ] 自审、只提交Allowed文件并简报；独立Sol Task Review覆盖源码／累计diff及实际测试，所有finding关闭后交接固定接口给Task 2。不能确定业务语义、公共契约或范围时第一时间升级。

### Task 2：双端真实邮寄页面与浏览器闭环（Luna）

**Files:** `frontend/src/api/{cases,client-cases,materials,organization}.{ts,spec.ts}`（client-cases新建）；`frontend/src/modules/cases/CaseComplaintMailingPanel.{vue,spec.ts}`、既有Detail／List／Pages.spec；`frontend/src/modules/client/ClientCase{List,Detail}Page.{vue,spec.ts}`；应用`App{,Shell}.{vue,spec.ts}`及`router.{ts,spec.ts}`、`frontend/src/modules/organization/RoleTemplateEditor.spec.ts`；新建`tests/e2e/case-complaint-mailing.spec.ts`，仅调用已接受helper。

**Interfaces:** 只用Task 1最终DTO及真实上传／下载；客户端API严格解码最小投影，内部组织页面仅新可分配内部Action，客户固定能力保持与内部目录隔离。

额外允许新建`frontend/src/modules/cases/index.ts`仅公开导出邮寄表单，客户端从公开入口复用，遵守现有模块护栏；不直接跨模块导入内部.vue或复制另一套表单。

- [ ] 先补API／页面失败用例：单／多凭证明确选择、必填标记、非法／未来日期、加载／成功锁、已知冲突、未知请求原键保存、真实父子RouterView切案／账号／授权版本及迟到结果隔离；只读无上传／办理按钮。
- [ ] 客户壳层增加“案件”入口与本企业待盖章列表、最小详情、真实文件下载和邮寄表单；内部详情复用同一低负担表单，非本人只读，列表及单套阶段侧栏同步第五阶段。提交前说明影响、刷新读服务端事实，不虚构法院提交。
- [ ] 聚焦命令：`pnpm --filter @dev-cor/frontend test src/api/cases.spec.ts src/api/client-cases.spec.ts src/api/materials.spec.ts src/api/organization.spec.ts src/modules/cases src/modules/client src/app src/modules/organization/RoleTemplateEditor.spec.ts`，按实际非零选择执行；必要类型／格式检查，自审及简报，不增设普通Task Reviewer。
- [ ] `pnpm test:e2e tests/e2e/case-complaint-mailing.spec.ts`：真实管理员绑定客户→正常API来源／运营匹配、提交、确认→退出→客户密码登录、下载确认文件／上传真凭证→登记→刷新／重登事实和字节仍在；另一案运营办理，同部门他人只读及另一企业不可见。无法测试须报告具体未完成，不用Mock或假成功代替。
- [ ] 只提交允许文件，Task报告包含真实RED／GREEN、命令／退出码、版本、风险、Contract changes及Requires Sol attention。后端或身份／材料规则冲突升级，不越界自行改造。

### Task 3：最终集成Review、Level 3候选与收口（主Agent＋独立Sol）

- [ ] 从基线58e4056核对全部任务报告／changed files／风险，独立Sol Final Review全分支；集中修复并由原主体补审关闭Critical／Important／Minor，不重复普通Worker全套工作。
- [ ] 必要业务契约与文档在门禁前完成；只读上下文解释累计差异后标准record／strict，固定干净commit／tree与测试环境指纹，禁止门禁期间编辑。
- [ ] 在稳定候选执行完整`pnpm verify`，再串行现有`pnpm test:e2e:full`及本切片迁移专项；既有权限、客户／公证材料、CASE只读和确认版本反例均保留。日志／报告树外保存并保留真实退出结果，不打印凭据，不删除断言或用重试掩盖失败。
- [ ] 全部通过才将CA-004完成、CA-005 Current、CA-006 Next；VALIDATION记录实际候选和证据，project-status仅恢复摘要。后续累计只有非执行状态／证据及解释快照时文档专项，不冒称收口HEAD实跑旧门禁。
- [ ] 文档格式、Spec、strict及累计diff通过后本地提交。CA-004本轮不默认推送／合并，不启动CA-005；失败则明确未完成、失败命令及剩余阻断，不机械要求用户回复继续。
