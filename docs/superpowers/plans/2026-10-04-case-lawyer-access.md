# 案件律师账号与承办办理实施计划

> **For agentic workers:** 使用 subagent-driven-development 按任务实施；项目明确的Sol／Luna路由、普通Task自审和高风险独立Review规则优先。任务串行交接，一处工作区只有一个写入者。

**Goal:** 运营按真实律师用户名分派，律师密码登录后在本人承办案中办理已实现的完整正常流程。

**Architecture:** 复用UserAccount、会话及案件Command，新增独立LAWYER身份与显式档案绑定。后端以有效绑定与当前PRIMARY承办关系授权，外部读取只返回必要案件投影。律师页面复用案件表单、材料请求层和Demo视觉，不建设平行工作流。

**Tech Stack:** Vue 3、NestJS、Prisma、PostgreSQL、Jest／Vitest／Playwright；不新增依赖。

## Global Constraints

- 权威契约为案件Spec“律师账号与承办办理补齐（SD-44）”及AC-CA-014；用户已确认正常全案办理、异常管理保留运营。
- 本轮修改身份与隔离，Level 3；高风险实现／Task Review／Final Review使用gpt-6-sol，确定方向的UI和证据执行使用gpt-6-luna。
- 复用`codex/core-ca-005-court-filing`，起点`d0ff5bd79738789af6ccd08b692496af026bc390`；不自动push／merge，不实现CA-006或其他未来节点，不推进Current／Next。
- 每个新PowerShell进程运行Node／pnpm前点加载`Use-ProjectRuntime.ps1`并核对Node v24.21.0／pnpm 11.27.0。
- 数据库只使用`backend/.env.test`独立测试库；不打印凭据、不重置开发库／生产库／持久卷，不修改已共享执行的迁移。
- 正式新匹配须有效真实账号；旧匹配事实不按姓名归并，旧成功回执保留。停用／解绑／承办结束下一请求拒绝当前访问与办理，不能用幂等回执绕过。
- 律师仅本人承办案正常办理，无内部Membership／运营Role，无部门全案读取、异常管理、付款或系统授权。客户原能力不变。
- 原阶段、材料、精确版本、金额、日期、乐观锁、幂等、冻结、成功审计及失败回滚保持；日志保留真实退出状态。

## Task 1: 外部律师身份、分派与服务端正常办理（Sol）

**Files:** 修改`backend/prisma/schema.prisma`，仅新增前向迁移；`backend/src/auth/`、`backend/src/access-control/`受影响身份及权限目录；`backend/src/modules/cases/`读取、匹配和CA-002～005服务；`backend/src/modules/materials/`实际授权入口；`scripts/prisma-model-owners.mjs`模型主责。新增`backend/src/modules/cases/lawyer-account.*`、`lawyer-case.*`及必要直接测试。范围内数据库／迁移验证使用`tests/support/case-lawyer-*`及`tests/e2e/case-lawyer-{database,migration}.spec.ts`；既有案件fixture只改因新账号契约必需的输入。提前同步`frontend/src/api/organization.ts`与其目录测试，仅新增Action和一致标签，不改UI。

**Interfaces:** 对外接口使用`/api/v1/lawyer-accounts`管理，`/api/v1/cases/:id/lawyer-accounts`提供本案可选启用律师，`/api/v1/lawyer/cases`提供本人案件。列表和详情沿用现有分页及阶段编码；管理提供创建、显式绑定、状态变更及密码重置，每项权限独立重新校验。案件匹配新增稳定`lawyerAccountId`选择；旧`lawyer`姓名输入仅可重放升级前已成功的原请求，不供新匹配。律师起诉提交／确认／邮寄／立案及法院目录与原Command共用，由律师路由传真实Actor。最终具体DTO及错误响应写入`.local/case-lawyer/api-contract.md`供Task 2直接消费，不让UI自行猜字段。

- [ ] 先补能在旧行为上失败的直接测试：律师登录不会落入内部成员分支；非承办读取拒绝；当前律师可正常确认／邮寄／立案；新匹配纯姓名拒绝。RED须行为断言失败，不把类型编译失败冒称RED。
- [ ] 新增LAWYER enum与最小不可混用Binding：同一账号可显式关联同部门多个既有Profile，一个Profile锚定同一稳定账号；禁止跨部门和内部角色。认证login／resolveSession／restoreSession与响应均识别律师；每次请求重取有效身份，不依赖长效缓存。密码策略、哈希、会话撤销沿用AuthService。
- [ ] 管理新账号同时创建真实档案／Binding／LocalCredential，后端对用户名唯一性、范围、版本及事务审计负责。管理Action为`LAWYER_ACCOUNT_MANAGE`、仅DEPARTMENT，初始只复制现有USER_MANAGE的DEPARTMENT Grant并失效相关授权版本；外部律师读取／办理能力不能加入内部可分配目录。
- [ ] 新匹配根据目标案授权列出同部门启用律师，后台按稳定账号取得明确Profile，记录PRIMARY承办。旧案可由有权管理员显式关联已有律师账号，不修改原姓名、匹配事实和回执；不按同名合并，不让律师自行认领或转派。
- [ ] 集中实现律师案件授权（账号→有效绑定→当前PRIMARY承办）；列表／详情／阶段计数、全部Command及上传／下载都复用。律师仅正常办理CA-002～005，无匹配或其他异常权。保留原内部授权和客户企业投影。
- [ ] 律师材料只开放本案合法类别和当前阶段上传；冻结引用不可删除，本人上传的未引用材料删除／恢复仍遵守原生命周期。版本下载按当前身份和案内精确版本重验；来源公证书仅通过本案冻结引用授权，不开放公证事项枚举。不泄露内部费用、内部账号／联系方式、审计正文和存储键。
- [ ] 在统一锁顺序下重新核验账号／绑定／承办、阶段及版本；四个既有Command使用同一事务、幂等、事实／冻结／审计路径。扩展SQL actor guard为真实律师绑定路径，禁止用内部操作者字段冒充律师；数据库约束覆盖绑定部门、材料类别、当前关系和合法动作。
- [ ] 新迁移首次正式部署前在测试库临时schema验证空库／上一支持schema（现有67迁移）、合成旧案／回执、非法绑定／内部成员／SQL旁路、各迁移失败回滚及向前重试；禁止擅自reset测试public。
- [ ] 运行聚焦Jest与早期权限契约，再运行`pnpm check:fast`和受影响Prettier。使用独立数据库测试证明撤权、运营／律师竞争、同键重放与异参冲突、旧版本、错误阶段、审计／冻结／回执失败回滚。保存命令、真实退出码、日志及数据环境指纹，不打印环境内容。
- [ ] 写`.local/case-lawyer/task-1-report.md`及API契约，提交允许文件。报告包含Task、请求Model、commit、Changed files、Tests及PASS／FAIL、Contract changes、Self-review、Known risks、Requires Sol attention。独立Sol Task Review通过且finding清零后才交Task 2。

最小行为矩阵（真实数据库补证，不只mock）：

```text
承办律师A + 本案 + WAITING_COMPLAINT + 有效诉状/授权 → 诉状待确认
承办律师A + 本案 + 诉状待确认 + 有效版本 → 诉状待盖章
承办律师A + 本案 + 诉状待盖章 + 真实邮寄凭证 → 待提交立案
承办律师A + 本案 + 待提交立案 + 本部门法院/真实证据 → 待正式立案
律师B/未绑定/停用/已结束承办/跨部门 → 读取、上传完成、下载、重放均拒绝
相同请求键 + 相同请求 + 当前仍有权 → 原结果且一份事实/审计
相同请求键 + 不同请求 → 冲突；同版本竞争 → 一胜一拒绝
审计/冻结/回执故障 → 原阶段/版本且无部分事实
```

## Task 2: 账号入口、用户名分派与律师案件UI（Luna）

**Files:** `frontend/src/api/auth.*`、`cases.*`、`organization.*`及新增`lawyer-accounts.*`／`lawyer-cases.*`；`frontend/src/app/`路由和导航、`frontend/src/stores/auth.*`、`frontend/src/modules/auth/LoginPage.*`、`frontend/src/modules/cases/`及新的律师账号管理页面。只提取共享案件表单所需组件，不重构无关页面或增加依赖。

**Interfaces:** 首先只读Task 1的`.local/case-lawyer/api-contract.md`与报告。使用已审查实际DTO及正常Command接口；不得改后端、schema、权限语义或公共响应。账号状态／密码管理沿用现有请求层CSRF及稳定错误。

- [ ] 为LAWYER严格登录解码、首页及拒绝其他端路由先补行为RED；旧客户／公证处／内部登录保持兼容，非法身份字段组合仍拒绝。
- [ ] 正式账号页面提供真实姓名、用户名、密码、可选律所／电话；管理员可绑定旧案档案、停用／启用、重置密码。解释停用和绑定影响，必填明确，错误和加载状态稳定，不展示密码回读。
- [ ] 匹配表单由纯律师姓名改为真实账号选择“姓名（用户名）”，按用户名可搜索，唯一候选自动完成；无账号明确提示先由有权管理员创建，不以手工改库或普通姓名代填。
- [ ] 律师登录落到本人案件列表，沿用Demo节点和共享视觉，无运营模块及部门全案切换。共用起诉、确认、邮寄、提交立案表单，只显示后端当前能力；内部费用区不渲染，下载真实附件。正常提交成功、版本冲突、撤权及未知结果处理沿用既有机制，不因失败自动生成新幂等键。
- [ ] 对案A→B、切换账号、解绑／停用以及已成功POST但刷新GET失败，使用现有请求代次与成功锁防止旧案残留和重复办理；准备文书组节点不新增重复筛选条。
- [ ] 运行相关Vitest、前端typecheck与受影响Prettier，自审后提交。写`.local/case-lawyer/task-2-report.md`，与Task 1相同报告字段；普通Task不额外开Sol Reviewer，权限／契约冲突首次出现立即交主Agent，不扩大修改。

## Task 3: 真实账号业务闭环与全量候选验收（Luna执行／Sol终审）

**Files:** 新增`tests/e2e/case-lawyer.spec.ts`；必要合成fixture与既有案件用例按新匹配契约同步；本轮状态及结果仅更新已有`project-status`／`feature-roadmap`／`VALIDATION`，不另建状态规范。

**Interfaces:** 消费已集成的管理、匹配与律师正常办理正式接口；运行`node scripts/run-e2e.mjs`现有受控入口，仅独立测试库、Chromium、单worker且不增加重试。初始化管理员允许使用既有安全合成测试fixture，但律师账号、分派、文件和流程验收必须走真实页面/API。

- [ ] 浏览器通过正式管理员入口创建律师A/B，运营按用户名把两个正常来源案件交A，另一案交B。A真实密码登录仅见承办案，实际下载精确公证书／案件材料，分别经共享表单完成起诉→确认→邮寄→提交立案；刷新／重登核对阶段、业务事实和真实字节。客户原邮寄及运营原办理路径回归。
- [ ] 直接接口验证其他律师／跨部门／客户／公证处拒绝、内部费用和未获准版本不泄露；停用／解绑后旧会话、上传完成及重放下一请求拒绝；保留原完整权限、并发、冻结和回滚断言，不用预置目标阶段替代核心页面主链。
- [ ] 提交业务与测试后形成候选，独立gpt-6-sol Final Review核对从本轮起点到实际候选的完整范围、Task 1风险、跨角色和跨Task契约；修复由同Reviewer确认关闭。UI修复只跑覆盖其改动的聚焦测试，不重复原Task全部工作。
- [ ] 主Agent核对所有实际diff与快照漂移，先解释后运行标准`pnpm context:record`／strict；同步最终契约和必要文档，固定干净候选。正式门禁期间无任何代码／测试／状态写入者。
- [ ] 固定候选执行`pnpm verify`与`pnpm test:e2e:full`，取得前后端完整单测、构建、隔离PostgreSQL／Chromium和迁移结果；失败记录具体命令、退出码和原因，修复后形成新候选并复验失效门禁。已有同候选可靠结果不机械重复。
- [ ] `.local/case-lawyer/`保留完整日志、审查与HTML证据；`VALIDATION`只摘要真实候选commit/tree、结果、收口累计diff及证据适用边界。不要求记录自身提交哈希；业务门禁后仅补真实状态／证据，专项文档检查通过后本地提交。Current／Next仍不推进，待用户授权集成。

## 恢复与验证命令

所有命令先加载并核对项目运行时；实际选定文件名由Task报告保存，不伪造未匹配测试。

```powershell
. .\Use-ProjectRuntime.ps1
if ((node --version) -ne ('v' + (Get-Content .node-version).Trim())) { throw 'Node mismatch' }
if ((pnpm --version) -ne (Get-Content -Raw docs/environment-lock.json | ConvertFrom-Json).runtime.pnpm) { throw 'pnpm mismatch' }
pnpm --filter @dev-cor/backend test src/auth src/access-control src/modules/cases src/modules/materials
pnpm --filter @dev-cor/frontend test src/api/auth.spec.ts src/api/organization.spec.ts src/app src/modules/cases src/stores/auth.spec.ts
pnpm check:fast
pnpm spec:check
pnpm context:check:strict
pnpm verify
pnpm test:e2e:full
```

这些是不同阶段入口，不要求在同一未变化候选上紧邻重跑全部命令。完整verify包含的单元／静态检查不重复启动；共享测试库迁移、故障注入与浏览器测试串行执行。
