# 功能开发路线图

更新日期：2026-10-15。CORE-CA-001～017、N1／N2、CORE-UI-001／002及展示修复、CORE-CE-001已交付；CORE-CE-002已完成验收及持久预览同步，已正常原子交付main与任务分支。CA018已由父级明确恢复领取，独立来源合同与产品源审通过，迁移专项已通过，正在最终工程与真实续办验收。准确证据与交付只见VALIDATION，不扩大为全部Demo或生产完成。

本文只回答“已经做到哪里、下一步做什么、之后按什么依赖顺序做”。详细业务规则仍以 [`docs/spec/`](spec/) 为准，核心主线的编码级字段、附件与存储边界以[核心业务字段、附件与存储契约](superpowers/specs/2026-09-21-core-flow-field-material-contract.md)为准，技术方案以设计文档为准，当前切片的技术任务以实施计划为准，实际验证结果以 [`docs/spec/v0.1/VALIDATION.md`](spec/v0.1/VALIDATION.md) 为准；[`docs/project-status.md`](project-status.md)仅保留当前恢复摘要。

## 状态判定

- `✅ 已完成`：前端、API、后端业务逻辑、PostgreSQL、服务端权限和关键自动化测试均已形成闭环，并有真实浏览器／数据库验证证据。
- `🟡 部分完成`：已有可运行子能力，但该行所述完整业务闭环仍缺 UI、API、规则、权限或关键测试。
- `🔵 已设计待开发`：已有获确认的业务方向或设计，但没有完整正式实现。
- `⚪ 未开始`：仅有范围方向，尚未形成足以编码的切片设计。
- `🔴 阻塞`：已有方向，但外部条件或关键业务决定使该闭环目前不能完成。

“已完成”只针对表中明确写出的切片边界，不把较小切片的完成扩大为整个模块完成。例如“一位准入联系人”已完成，不代表“联系人管理”已经完成；“客户域最小授权”已运行，不代表“人员与权限管理”已经完成。

## 当前开发状态

系统已经具备可运行的运营端到客户端最小主线：管理员开通内部人员、企业客户和公证处账号 → 内部人员登录并按部门／TEAM／SELF范围维护客户和权利主体 → 补齐证件与联系人并正式准入 → 创建待推送线索 → 运营推送为待审核 → 企业客户用真实账号登录并查看本企业获推送线索与允许附件 → 客户确认侵权后进入待确认，由运营决定不取证归档或确认取证并移交公证、登记线上取证物流，再由有权运营或绑定事项公证处的真实账号登记开箱，之后由有权运营或来源客户企业账号完成开箱审核；侵权后运营选择出证／不出证，出证分支由公证处真实账号登记公证书、归档并原子生成待匹配案件；客户也可判定不侵权并归档。共享视觉壳层继续调用真实API和服务端权限；关键链路已有浏览器、API、真实文件字节、数据库约束、越权、并发、事务回滚和迁移测试。

客户确认侵权并进入待确认已由CORE-LD-003形成正式闭环；不侵权归档已由CORE-LD-004完成，撤回纠错已由CORE-LD-007完成，运营不取证归档已由CORE-LD-005完成，确认取证并移交已由CORE-LD-006完成。CORE-NT-001已完成线上取证物流登记，CORE-NT-002已完成单事项开箱材料登记，CORE-NT-003已完成运营／客户双身份开箱审核，CORE-NT-007已补齐公证处真实账号与开箱入口，CORE-NT-004已完成运营出证选择，CORE-NT-005已完成真实出证并生成最小待匹配案件，CORE-NT-006已完成不出证退货归档；CORE-CA-001已完成案件匹配，CORE-CA-002已完成起诉材料提交并进入待确认诉状，两者均已合入`main`。案件后续办理、费用结算、日历和报表尚未形成正式闭环。客户001～008组合已验收并集成main，包含多联系人、合作状态、负责运营转派、真实权利资产、协议/开票资料及真实人工结算台账；独立最新人工入口已通过密码、cookie/CSRF写入和刷新验证，已按用户授权推送并快进集成main至b719857。材料能力仍仅提供本地／测试私有Adapter，生产E02仍阻断上线。

### 系统 MVP 缺口快照

本表以上方已验证代码候选、[固定候选验证记录](spec/v0.1/VALIDATION.md)、[核心主线设计](superpowers/specs/2026-09-21-core-business-mainline-roadmap-design.md)和[Demo事实](demo-reverse/v158/AS-IS.md)核对；只在后续Slice影响对应行时增量更新。`已验证`仅指写明的边界；Demo页面、Spec或单独可调用接口不等于正式闭环。这里的“上线”还要通过生产存储与运维发布条件，不能把内部测试可用称为生产可用。

| 功能／核心流程                                     | 是否属于 MVP                                     | 前端状态                                             | 后端状态                                                                | 数据库状态                                             | 验证证据                                                                                                                    | 剩余缺口与依赖                                                                     |
| -------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 内部／企业身份、最小客户准入、手工建线索及真实附件 | 是，主线输入与授权基础                           | 正式页面可操作                                       | 认证、授权、准入、手工录入已实现                                        | PostgreSQL持久化及前向迁移已验证                       | [VALIDATION](spec/v0.1/VALIDATION.md)的客户、认证、LD-001／002；单模块及线索跨角色链已验证                                  | 后续角色和材料规则仍须随对应动作补齐；生产材料依赖E02                              |
| 推送→客户侵权／不侵权审核→归档撤回纠错             | 是                                               | 双账号正式页面已实现                                 | LD-002／003／004／007 Command与企业隔离已实现                           | 决定、归档及撤回历史持久化已验证                       | [LD-007固定候选](spec/v0.1/VALIDATION.md)及既有完整浏览器链；已跨角色验证                                                   | 不代表后续公证办理已可用                                                           |
| 运营不取证归档／确认取证移交                       | 是                                               | 双分支运营与客户端正式页面已验证                     | LD-005／006 Command已验证                                               | 决定、回执、审计、归档及公证事项来源持久化已验证       | [LD-005／006固定候选](spec/v0.1/VALIDATION.md)的跨账号、迁移、并发与回滚验收                                                | 两分支已完成；后续公证办理已推进到NT-004                                           |
| 公证办理、出证转案与不出证退货                     | 是，已确认主线及支路                             | 取证、开箱、审核、真实出证及退货归档页面已验证       | NT-001～007的已确认动作均已验证                                         | 公证书、冻结文件、费用来源、归档和唯一待匹配案件持久化 | [NT-005／006固定候选](spec/v0.1/VALIDATION.md)分别证明真实出证转案与不出证退货归档、隔离、并发及回滚                        | 本行已确认切片动作无剩余；不代表费用结算或生产上线完成                             |
| 案件立案、审理／执行、结案归档                     | 是，已确认主线                                   | 正常流程至业务归档及UI002、CE001／002已验收，预览150 | CA-001～017正常来源动作已验收并集成main                                 | 分轮、二审结果／撤销、执行提交／确认及冻结材料已持久化 | [CA-012验证记录](spec/v0.1/VALIDATION.md#core-ca-012-确认执行材料2026-10-12)完整verify、36文件PG／Chromium163/163及独立终审 | CA018入口已验收，预览仍150；实收／结清仍后续                                       |
| 跨模块真实主链与启动／测试数据准备                 | 是，系统级验收                                   | 正常来源各段真实UI已增量验收至业务归档               | 正常来源至业务归档及CA018外部／历史入口已验收                           | 来源、公证、转案及案件至业务归档真实历史已持久化       | [本地启动说明](../README.md)及CA-007真实运营／律师／客户浏览器回归；007已集成                                               | 各段真实验收已证明后段归档及刷新／重登录；不冒称单次整系统全链组合或生产验收       |
| 客户资产／协议／人工台账及其余外围能力             | 客户八片已批准范围已交付；其他首发边界保留待裁定 | 客户正式页面与独立人工入口已完成                     | 客户资产、协议/开票、人工台账已形成闭环；完整财务、证物和日历报表未完成 | 客户不可变版本/证明引用/台账模型及112条前向迁移已验证  | [客户验收记录](spec/v0.1/VALIDATION.md)及各Spec                                                                             | 不把人工台账扩大为支付、公式结算或完整财务；其余按对应切片定界                     |
| 线索检测接入／识别录入                             | 否，2026-09-23明确允许延期                       | 未见正式可用入口                                     | 未实现接入／识别流水线                                                  | 无正式候选流程                                         | [MVP时序决定](spec/v0.1/DECISIONS.md)；无实现验收                                                                           | 不阻断人工录入、审核、归档；未实现入口保持隐藏／禁用或明示暂不可用，已有代码不删除 |
| 生产材料与发布条件                                 | 是，若宣称“MVP上线”                              | 内部本地／测试材料链已可用                           | 生产Provider及部署条件未完成                                            | 生产迁移／备份恢复未验证                               | [能力09](#能力总账不再作为执行顺序)仅证明内部链                                                                             | E02、OPS-01、CI-01及目标环境演练仍阻断生产可用宣称                                 |

当前已确认正常来源案件主线CA-001～017均已验收；CA017已原子交付main，持久演示已按验收及备份保全升级至150迁移和CE002稳定候选。这是已确认状态动作范围，不是系统整体可用性比例。CA018外部转入／历史补录独立入口已验收，代码交付与预览升级分别核实，不计入正常来源CA-001～017状态动作数量。NT-008～010及CA-001～012已验收并集成；客户八片组合验收和最新独立人工入口已完成。唯一任务指针以[Current Slice](#current-slice)和[Next Slice](#next-slice)为准，不在本摘要另行维护。外围能力的首发边界及生产条件须单独澄清，不能靠“延期两项自动化能力”推断一并排除。未量化流程提速效果；后续使用既有门禁输出和验证记录，记录每次完整复跑的触发原因即可，不建新统计平台。

`CORE-LD-001｜运营新建待推送线索`已完成明确边界内的UI、API、后端规则、PostgreSQL、权限、审计、迁移与真实浏览器验收。核心实现最终全分支总审为`APPROVED`（Critical／Important／Minor均为0）；叠加Demo对齐前端后的当前合并候选`71ecc0f`、tree`daae709e60906d993c2f18df2d338936d3676f9e`已通过正式Level 2门禁。本完成态不扩大为生产上线许可。

`CORE-LD-002｜运营推送至真实客户端审核`已完成`WAITING_PUSH → WAITING_REVIEW`唯一状态变化、真实企业客户账号绑定与密码会话、企业固定数据范围、推送幂等／版本／审计，以及运营推送和客户端只读列表／详情／附件页面。原始完成候选`6be15b2`已通过Level 3完整门禁、76项数据库型浏览器验收、空库24份迁移和独立终审；随后的快速上手硬化候选`667da39`、tree`4fe53798ef755ca7cab59ff3b0427f833a60a6fb`又通过CORE-LD切片门禁和独立UX终审。本完成态不包含客户审核Command或生产上线许可。

`CORE-LD-003｜客户确认侵权并进入待确认`已完成`WAITING_REVIEW → WAITING_EVIDENCE_DECISION`唯一状态变化、真实企业客户审核、不可变决定与幂等回执、客户端“待我审核／已处理”和运营端审核记录。固定候选`9167b22`通过完整Level 3门禁与CORE-LD专项门禁；完整数据库型浏览器套件在`8d4742d`通过80/80，独立终审无未关闭问题。不包含不侵权归档或后续取证动作。

### Completed Slice

**CORE-LD-007｜不侵权归档后的运营申请、原客户确认撤回（已完成）。**

固定候选及完整门禁、浏览器验收和独立Final Review证据见[验证记录](spec/v0.1/VALIDATION.md)。按SD-40，运营申请不改变原归档；原客户企业当前有效获权账号确认后才生效并回到可重新审核状态，原归档、决定、申请及确认历史均保留。

本Slice仅完成该不侵权归档纠错路径，不覆盖其他归档类型、公证／案件更正或通用工作流。

**CORE-LD-005｜运营不取证归档（已完成）。**

固定代码候选`b9add2c9e016043ad645454e2033ce59c6cecf7b`的完整Level 3门禁、数据库型浏览器验收及独立Final Review均通过，详细结果见[验证记录](spec/v0.1/VALIDATION.md)。完成范围仅为客户确认侵权后运营决定不取证并归档，客户仍可按企业范围只读已处理线索与允许附件；不包含确认取证、公证移交或该归档类型的撤回。

**CORE-LD-006｜运营确认取证并移交（已完成）。**

固定代码候选`eafd131c61c37e9e7759a3430c489f95d8e714d3`通过完整Level 3门禁、91项数据库型浏览器验收及独立Final Review，详细结果见[验证记录](spec/v0.1/VALIDATION.md)。完成范围为客户确认侵权后运营确认取证、生成稳定来源的公证事项并保留原线索与材料引用；不包含后续取证物流、开箱、出证或转案。

**CORE-NT-001｜取证物流（已完成）。**

固定候选`0597388`的完整门禁、93项数据库型浏览器验收及独立Final Review均通过，详细结果见[验证记录](spec/v0.1/VALIDATION.md)。只完成线上待取证事项登记真实取证日期、样品费状态和逐字段明确物流并进入待开箱；不包含后续开箱、审核或出证。

**CORE-NT-002｜开箱材料（已完成）。**

固定候选`f7bca9b`通过完整Level 3门禁、96项数据库型浏览器验收及独立Final Review，详细结果见[验证记录](spec/v0.1/VALIDATION.md)。仅完成单个待开箱事项的真实照片上传、误传纠错、开箱记录与材料冻结，推进至待开箱审核；不包含客户或运营开箱审核结论、出证或转案。

**CORE-NT-003｜开箱审核（已完成）。**

固定候选`56a0ed6`通过完整Level 3门禁、102项数据库型浏览器验收及独立Final Review，详细结果见[验证记录](spec/v0.1/VALIDATION.md)。有权运营或来源客户企业账号对单个待审核事项作侵权／不侵权结论，保留不可变决定、冻结照片、审计与幂等；不包含公证处开箱入口、出证或转案。

**CORE-NT-007｜公证处身份与开箱入口补齐（已完成）。**

固定候选`84380cf`通过完整Level 3门禁、106项数据库型浏览器验收、空库及上一支持schema迁移专项与独立Final Review，详细结果见[验证记录](spec/v0.1/VALIDATION.md)。只补真实公证处账号绑定、最小待开箱读取、照片选择和共用开箱Command；不包含出证、退货或转案。

**CORE-NT-004｜运营出证选择（已完成）。**

固定候选`7882a9e`通过独立Final Review、Level 2切片门禁、隔离PostgreSQL／Chromium 50项浏览器验收及空库／上一支持schema迁移专项，详细结果见[验证记录](spec/v0.1/VALIDATION.md)。仅允许有权运营对开箱确认侵权的单事项选择出证或不出证，进入待出证或待退货；不包含实际出证、退货、转案或归档。

**CORE-NT-005｜公证处出证转案（已完成）。**

固定候选`debe747`通过独立Final Review、完整`pnpm verify`、隔离PostgreSQL／Chromium 113项全量浏览器验收及空库／上一支持schema迁移专项；证据边界见[验证记录](spec/v0.1/VALIDATION.md)。仅完成正常出证、归档和生成最小待匹配案件，不包含退货或案件后续办理。

**CORE-NT-006｜不出证退货归档（已完成）。**

固定候选`3cba594`通过独立Final Review、完整`pnpm verify`、隔离PostgreSQL／Chromium 118项全量浏览器验收及空库／上一支持schema迁移专项；证据边界见[验证记录](spec/v0.1/VALIDATION.md)。仅完成原决定为不出证的单事项退货事实记录与归档，不包含案件办理、支付或费用结算。

**CORE-CA-001｜案件匹配与承办（已完成并集成）。**

匹配事实修正后的固定候选`1279b1d`通过独立审查、完整`pnpm verify`和隔离PostgreSQL／Chromium 124项全量浏览器验收；证据边界见[验证记录](spec/v0.1/VALIDATION.md)。有权内部人员登记真实被告、主办律师姓名和实际匹配日期，律所未知可留空，单案从`PENDING_MATCH`进入`WAITING_COMPLAINT`；同部门其他案件只读并可下载获准附件，客户／公证处和跨部门账号不得读取内部案件。旧案日期未知保持未知，旧成功回执可原样重放；不包含起诉材料或后续案件状态。

**CORE-CA-002｜起诉材料（已完成并集成）。**

固定候选`cf75372`通过独立审查、完整`pnpm verify`和隔离PostgreSQL／Chromium 127项全量浏览器验收；证据边界见[验证记录](spec/v0.1/VALIDATION.md)。有权内部人员为待写诉状案件上传真实起诉材料和授权材料，登记标的金额已知／待定后确认提交，原子进入`WAITING_COMPLAINT_CONFIRMATION`；冻结附件引用、成功审计和幂等回执持久化，按现有案件范围限制读写。本切片不包含诉状确认、客户盖章邮寄或法院提交。

**CORE-CA-003｜确认诉状（已完成并集成）。**

固定候选`6acdc65472c19971e672c5a815df799056dba6d5`、tree`bb8eb53af58c57757b0674c120386dd6775c71e6`通过正式Level 2逐项门禁、隔离PostgreSQL／Chromium四文件17/17及独立Task与Final Review；2026-10-03按授权集成，集成事实与证据边界见[验证记录](spec/v0.1/VALIDATION.md)。有权运营确认精确诉状版本与金额，保留原提交事实，使用独立授权与企业／部门隔离、当前撤权检查、版本幂等并发、冻结文件、成功审计及回执事务，原子推进至`WAITING_COMPLAINT_STAMP`。集成不代表MVP上线或生产准入。

**公证事项列表增强（CORE-NT-008→009→010，按切片交付）。**

按独立可验收切片排队：`008`为当前内部账号保存列表列的显示／顺序，重登仍生效；`009`增加独立授权的已选事项／当前阶段办理清单 CSV 导出，不含附件和未正式记录的取证表字段；`010`仅批量执行已有 `WAITING_RETURN`＋`NO_ISSUE` 的合法退货归档，逐项事实、整批原子提交且不改原费用。008～010均已验收并集成；不改变上文NT-001～007已完成的单项动作，也不把其他阶段的终止／撤销视为普通归档。契约与验收边界见[公证Spec](spec/v0.1/modules/notary.md#公证事项列表增强core-nt-008010)。案件主线Current／Next见路线图顶部状态；CA-003已集成`main`。

**CORE-NT-008｜公证事项列表列设置（已完成并集成）。**

固定候选`6d2c884`经独立终审和Level 2门禁、隔离PostgreSQL／Chromium 3项组合验收通过，证据见[验证记录](spec/v0.1/VALIDATION.md)。编号／详情入口及阶段固定可见，其余三列可隐藏换序；按本人账号由服务端保存，刷新、重登和换浏览器恢复，恢复默认只影响本人，不改变事项读取范围。分支`codex/core-nt-008-list-columns`已推送，收口提交`a650f31`已快进合入`main`，不含导出、批量归档或新业务字段。

**CORE-NT-009｜公证事项办理清单导出（已完成并集成）。**

固定候选`c303858`经独立Sol终审及补审、Level 2门禁和隔离PostgreSQL／Chromium 6项组合验收通过，证据见[验证记录](spec/v0.1/VALIDATION.md)。内部受权账号明确选择已勾选事项或当前阶段，预览后下载固定五列CSV；实时读取／导出范围取交集、最多1000条，成功生成审计持久化，不含附件和内部费用。收口提交`d54fb2c`已推送并快进合入`main`；开发／生产库迁移未执行。

**CORE-NT-010｜公证事项合法批量归档（已完成并集成）。**

固定候选`f5fb604`通过独立Sol终审及补审、Level 2门禁和隔离PostgreSQL／Chromium19项组合验收，证据见[验证记录](spec/v0.1/VALIDATION.md)。有权运营在列表选择1～50项合法待退货事项，逐项登记处理方式、费用事实和原因后整批原子归档；重放不重复推进或审计，失败无部分写入，不改原费用。收口提交`862bc9c`已推送并快进合入`main`；不包含其他阶段的终止／撤销。

**CORE-CA-004｜客户盖章邮寄（已完成并集成）。**

固定候选`e30f708b3d95285ca085451090dc500f0192a899`、tree`9a4c850549a29a22b2336a261939560333334a9e`通过独立Task与Final Review及修复补审、完整`pnpm verify`和隔离PostgreSQL／Chromium全量160/160，证据边界见[验证记录](spec/v0.1/VALIDATION.md)。来源客户企业有权账号或有权运营登记真实邮寄日期与精确凭证版本，原子从`WAITING_COMPLAINT_STAMP`进入`WAITING_FILING`；材料、事实、审计与幂等回执持久化，客户只读本企业允许投影，刷新／重登和真实文件字节已验证。收口提交`8bcd03e`已按授权推送并快进合入`main`，未带入其他代码；不包含法院提交、快递平台或生产发布。

**CORE-CA-005｜提交立案（已完成）。**

固定候选`b33462401fa128742dc2b427c8375682454fe05e`、tree`ea684d26264c064022025617b5d11c7f08eecc43`通过独立Sol Task／Final Review、Level 2逐项门禁及隔离PostgreSQL／Chromium27/27，证据见[验证记录](spec/v0.1/VALIDATION.md)。有权运营从真实法院目录选择或录入法院，填写提交日期并上传精确证据版本，单案原子从`WAITING_FILING`进入`WAITING_FORMAL_ACCEPTANCE`；事实、冻结材料、审计与幂等回执持久化。客户新阶段可读但不可获取内部提交事实／文件，不包含正式受理；含SD-44及测试端口修复的组合候选已通过完整Level 3并按授权快进集成main，远端已核实。

**CORE-CA-006｜正式受理（已完成并集成）。**

实际候选`d3836fc`、tree`6e911e6a96029a5d83ca98f242c633a168a70da6`通过独立Sol Task／Final Review、Level 2逐项门禁及隔离PostgreSQL／Chromium31/31；收口`6ca3786`已按授权推送并快进合入main，结果与非执行性收口边界见[验证记录](spec/v0.1/VALIDATION.md)。有权运营或当前承办律师登记真实受理日期和法院案号，原子从待正式立案进入待开庭；三类受理材料可选、精确版本冻结且可在待开庭后补。客户只读取原允许投影，不获取内部事实或材料；不包含开庭后推进、付款或金额更正。

**CORE-CA-007｜开庭后推进（已完成并集成）。**

从已核实本地main`6ca3786`建立`codex/core-ca-007-hearing-followup`。2026-10-08用户确认最小受控纠错随CA-007交付，与已确认的真实日期登记／修改、到期自动推进及重启补跑共同验收；不新增人工“已开庭”门槛，待判决不表示法院已判决。唯一详细业务契约见[REQ-CA-008](spec/v0.1/modules/cases.md#req-ca-008-开庭次日自动推进)。推进后不得随意回退；已有判决等后续正式事实的纠错不扩入本切片，按CA-008契约接入判决事实时阻断开庭纠错并验证竞争保护；新增其他后续事实仍随对应Slice接入补验。

实际业务候选`b4fb37a30571895a5ff881b30c0d49ef06bfab07`、tree`d8f0480c28a61fd8ddb0d0783188763cbbda4f9e`通过独立Sol高风险Task／Final Review、完整`pnpm verify`及全量隔离数据库／Chromium187/187，详情和收口边界见[验证记录](spec/v0.1/VALIDATION.md)。六份新前向迁移、受限SYSTEM成功审计、不可变开庭历史、真实角色入口及内部／律师页面已验收；真人审计保留原约束，客户仅新增阶段可见。收口`4bfeab7`已推送并快进集成main，集成tree未带入其他变化；开发／生产迁移及部署未执行。[CA-007计划](superpowers/plans/2026-10-08-case-hearing-followup.md)只保留实施步骤，不再重复维护完成台账。

**CORE-CA-009｜判决后续选择（已完成并集成）。**

从main`6ae39ac1a688f2d553bc5b439e0fbc208e131151`建立`codex/core-ca-009-judgment-next-step`。已按[案件契约](spec/v0.1/modules/cases.md#ca-009判决后续选择)交付运营／当前承办律师正常选择、双方／多被告上诉、人工核实转执行准备及独立权限运营受控撤销；选择、撤销、判决和附件历史保留。固定候选`0442c83`、tree`44b6879fa430ed35c7701485f9713dde11e24323`通过完整verify和适用隔离PG／Chromium95/95；Final Review及修复补审两轴ACCEPTED、未关闭C/I/M0。同模型非实现隔离、独立性不足，外部异模型Review Pending。实际证据、失败历史及纯文档收口边界见[验证记录](spec/v0.1/VALIDATION.md#core-ca-009-判决后续选择2026-10-10)，[计划](superpowers/plans/2026-10-10-case-judgment-next-step.md)只维护实施任务。收口`866771b`已按授权推送并快进集成main，组合tree与原收口一致；本片不登记二审结果、不办理执行申请或财务。

**CORE-CA-010｜二审（已完成并集成）。**

2026-10-10从已核实main`a1d99fc446b0753957fb1a268a297ab5f19913de`建立`codex/core-ca-010-appeal`。按SD-50交付二审进展保存、改判／维持原判／发回重审、同案分轮继续办理及有权运营留原因撤销；运营和当前承办律师办理正常动作，客户仅见本企业允许投影。业务契约见[案件Spec](spec/v0.1/modules/cases.md#ca-010二审办理与结果)，实施步骤见[计划](superpowers/plans/2026-10-10-case-second-instance.md)。实际候选`38c7ab9`／tree`53309640bdc258ea29eec4dade1d3784b01bb1b4`通过独立非实现6 Sol终审及补审、完整verify和适用隔离PG／Chromium147/147；失败历史、13份前向迁移及证据边界集中见[验证记录](spec/v0.1/VALIDATION.md#core-ca-010-二审办理与结果2026-10-11)。2026-10-11已与前置反馈规则一并推送并快进合入main，组合tree与原收口`6fd7a92`一致，未混入其他业务变化。

### Completed CA-011

**CORE-CA-011｜上传执行材料（已完成，已集成）。**

2026-10-11从已推送且核对组合tree的main`caba39d264d68da11577519d4dc87852571240a4`建立`codex/core-ca-011-execution-materials`。只推进待写执行材料→执行材料待确认，正常办理限有权运营和当前承办律师；SD-51确认的留原因同阶段重提、历史精确下载及客户新阶段兼容已交付，不扩大客户材料范围。业务契约见[案件Spec](spec/v0.1/modules/cases.md#ca-011上传执行材料)，步骤见[计划](superpowers/plans/2026-10-11-case-execution-materials.md)。实际候选`f206df0`通过独立非实现Sol终审及补审、完整verify与34文件PG／Chromium158/158；四份前向迁移、失败历史和纯文档收口边界集中见[验证记录](spec/v0.1/VALIDATION.md#core-ca-011-上传执行材料2026-10-12)。2026-10-12已按授权推送并快进合入main，组合tree及证据边界见[集成记录](spec/v0.1/VALIDATION.md#ca-011与开发反馈入口集成2026-10-12)；不默认领取CA-012。

### CA-012最近集成

**CORE-CA-012｜确认执行材料（已完成，已集成）。**

2026-10-12从已核实main`d57b359`建立`codex/core-ca-012-execution-confirmation`。按SD-52一次确认当前整套不可变执行提交及全部精确版本，只推进待确认→待盖章，客户端不扩大材料范围，确认前重提保留、确认后重提阻断。候选`e5ccf8c`通过独立非实现Sol Task／Final及修复补审，两轴ACCEPTED、未关闭C/I/M0；完整verify及36文件隔离PG／Chromium163/163均退出0。实际证据与收口边界见[CA-012验证记录](spec/v0.1/VALIDATION.md#core-ca-012-确认执行材料2026-10-12)，业务契约见[案件Spec](spec/v0.1/modules/cases.md#ca-012确认执行材料)。2026-10-12已按授权推送并快进集成main，组合tree及证据边界见[集成记录](spec/v0.1/VALIDATION.md#ca-012与开发反馈优化集成2026-10-12)；未部署或领取CA-013。

**CORE-CA-013｜执行材料盖章邮寄（已完成，已集成）。**

运营、当前承办律师或本企业客户按真实日期和精确回执版本办理；与CA-014同批候选及证据见[执行申请办理验证](spec/v0.1/VALIDATION.md#core-ca-013014执行申请办理2026-10-13)。2026-10-13已按用户授权推送并快进集成main，实际提交及证据边界见[集成记录](spec/v0.1/VALIDATION.md#ca-013014日历与人工台账集成2026-10-13)。

**CORE-CA-014｜申请执行（已完成，已集成）。**

候选`0c7be16`在CA-013成功事实后，由有权运营／当前承办律师登记真实法院提交日期及精确证明；完整verify、独立补审与39文件PG／Chromium167/167通过。首轮SQL回归和人为中断仍保留原记录。详见[验证记录](spec/v0.1/VALIDATION.md#core-ca-013014执行申请办理2026-10-13)。执行结束、结案与归档未交付。

### Current Slice

**CORE-CA-018｜外部转入／历史案件录入（已实现、验收并原子交付main与任务分支）。** SD-23／57独立来源与16个真实初始阶段、日期／来源／原因、普通／归档高风险Action、正常后续Command和最小外部投影已完成；不伪造前序事实。产品／测试7236c8e同干净候选22/22真实PG／Chromium通过，150→155迁移专项1/1、独立源审及限定工程证据见[VALIDATION](spec/v0.1/VALIDATION.md)。I仍是唯一集成、文档与DB作者；持久预览source81ebfed／150处于人工测试窗口，本批未升级预览或增真实CA018权限，不能把代码交付称生产上线。

### 上批已交付

**CORE-UI-002后续展示小修复｜已完成验收和预览同步，已原子交付main与修复分支。** 全前端“当前”分类核对：步骤后缀直接去掉，无“本轮”替换；真实stage／历史保留，技术ID移次级详情。稳定源码be71b5b及独立双轴审查通过，具体测试候选／复验／预览数据保持边界只见VALIDATION。原批已收口；CE001已交付，CE002已验收和同步预览，CA018只读暂停。

**CORE-UI-002｜案件工作页三页签、八栏折叠／合法编辑入口与紧凑密度；已组合验收并原子交付main与任务分支。**

基线main696fad75；I复用ca015-integration／codex/ui002-case-workspace-integration。全部实现Worker已停写接纳，八栏／生命周期分段、字段和值布局、内容分组导航、动作语义、drawer样式和SPA原意图恢复均已通过独立累计审查及真实验收。稳定源码／测试候选`648faa1da8a625a7d450a8d999ab7e292deaa446`；完整verify实际441候选80／1779／1451及双构建，17组工程输入限定复用，根静态及最终14项PG／Chromium同候选通过。详细证据及失败记录只见[VALIDATION](spec/v0.1/VALIDATION.md#ui002八栏与抽屉最终组合验收2026-10-14)，业务／呈现合同只见[UI002合同](superpowers/specs/2026-10-14-case-workspace-ui-contract.md)。

持久预览146及本候选已备份保全同步，原2案／6凭据、124业务／授权表、材料和配置保持；正常私密登录只读三页、三tab×三宽及真实主动作打开／取消0业务写入。原有财务、通用字段编辑、手工时间轴和其他角色新布局未实现；不把现有表单入口称所有字段已可编辑。file://Demo协议拒绝保持，未绕过；本地源码和用户截图仅作呈现参考。

### 已完成CA017批次（原独占边界保留）

以下保留CA017原批次交付时的验证与分派边界；当时暂缓预览的叙述是历史事实，当前146预览及UI002交付以Current和最新验证记录为准。

**CORE-CA-017｜已实现、验收并原子集成main；演示预览已保全升级146。**

实核main基线`3f636ea5f7f1adfef0adaf215dd97384ac87a318`／tree`3c7d8896461a07521f49fd9c66c3aa0e0810991d`。I复用`.local/worktrees/ca015-integration`，分支`codex/ca017-archive-integration`；只写权威文档／快照／集成和隔离验收。合同只见[案件CA017冻结](spec/v0.1/modules/cases.md#ca-017最终归档与归档后原因更正技术冻结2026-10-14已实现并验收)。SD-44允许当前PRIMARY律师正常归档，原因更正仅获权内部运营；正常WAITING_ARCHIVE→ARCHIVED，精确当前结案版锚、日期／Demo六类型／原因，更正追加不可变版。PENDING结案额／null日期／空附件及未收齐款项不自动阻塞；不产生实收／结清或重开事实。

四执行目录复用已干净、停写的CA016目录，原分支及成果保留，不创建第二批同职责编码目录。下表是本轮唯一文件所有权；I先固定冻结文档候选并通过技术Review，再在各目录从该冻结SHA建新分支。B17独占全部共享后端读取／DTO／Controller，F17独占共享API；P17只有两个新增面板文件，N17不写API或内部／律师详情，不与F17共改CasePages。白名单外接点必须先由I裁定重新分配，不覆盖其他Task文件。

| Task | 模型                      | 复用目录／新分支                                                                  | 可独立交付目标                                                                    |
| ---- | ------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| B17  | gpt-6-sol＋独立Sol Review | `.local/worktrees/ca016-backend-summary`／`codex/ca017-backend-archive`           | 唯一后端／schema作者；正常归档、内部原因更正、连续链、固定回执和最小外部投影      |
| P17  | gpt-6-luna                | `.local/worktrees/ca016-closure-panel`／`codex/ca017-archive-panel`               | 仅两个新面板文件；局部冻结props／callback／事件；无文件上传／额外审批             |
| F17  | gpt-6-luna                | `.local/worktrees/ca016-frontend-integration`／`codex/ca017-frontend-integration` | 唯一共享API作者；先固定最小API给N17，再接P17面板和内部／律师详情；保留未知原参    |
| N17  | gpt-6-luna                | `.local/worktrees/ca016-case-list-display`／`codex/ca017-archive-navigation`      | 只读ARCHIVED阶段／列表／导航兼容；精确API依赖后同步自身fixtures，保留N1／N2及分页 |

#### B17精确写入白名单

```text
backend/prisma/schema.prisma
backend/prisma/migrations/20261014090000_add_case_archive_enums/migration.sql
backend/prisma/migrations/20261014090100_guard_case_archive/migration.sql
backend/src/modules/cases/case-archive.dto.ts
backend/src/modules/cases/case-archive.dto.spec.ts
backend/src/modules/cases/case-archive.service.ts
backend/src/modules/cases/case-archive.service.spec.ts
backend/src/modules/cases/case-read.controller.ts
backend/src/modules/cases/case-read.controller.spec.ts
backend/src/modules/cases/case-read.dto.ts
backend/src/modules/cases/case-read.service.ts
backend/src/modules/cases/case-read.service.spec.ts
backend/src/modules/cases/lawyer-case.controller.ts
backend/src/modules/cases/case.module.ts
backend/src/modules/cases/client-case.response.dto.ts
backend/src/modules/cases/client-case.service.ts
backend/src/modules/cases/client-case.service.spec.ts
backend/src/modules/cases/client-case.controller.spec.ts
backend/src/modules/cases/case-closure.service.spec.ts
backend/src/modules/cases/case-execution-finish.service.spec.ts
backend/src/access-control/access-control.service.ts
backend/src/access-control/access-control.service.spec.ts
backend/src/access-control/permission-catalog.ts
backend/src/access-control/prisma-access-control.store.ts
backend/src/access-control/prisma-access-control.store.spec.ts
backend/src/access-control/organization.service.ts
backend/src/access-control/organization.service.spec.ts
backend/src/modules/materials/material.service.ts
backend/src/modules/materials/material.service.spec.ts
backend/src/modules/materials/material.controller.spec.ts
backend/src/core-ld-openapi.spec.ts
scripts/prisma-model-owners.mjs
```

#### P17精确写入白名单

```text
frontend/src/modules/cases/CaseArchivePanel.vue
frontend/src/modules/cases/CaseArchivePanel.spec.ts
```

#### F17精确写入白名单

```text
frontend/src/api/cases.ts
frontend/src/api/cases.spec.ts
frontend/src/api/client-cases.ts
frontend/src/api/client-cases.spec.ts
frontend/src/api/notary.ts
frontend/src/api/notary.spec.ts
frontend/src/api/organization.ts
frontend/src/api/organization.spec.ts
frontend/src/modules/cases/CaseDetailPage.vue
frontend/src/modules/cases/LawyerCaseDetailPage.vue
frontend/src/modules/cases/LawyerCaseDetailPage.spec.ts
frontend/src/modules/cases/CaseArchiveDetailIntegration.spec.ts
frontend/src/modules/cases/CaseClosureDetailIntegration.spec.ts
frontend/src/modules/cases/CaseClosurePanel.vue
frontend/src/modules/cases/CaseClosurePanel.spec.ts
frontend/src/modules/cases/CaseComplaintConfirmationPanel.spec.ts
frontend/src/modules/cases/CaseExecutionConfirmationPanel.spec.ts
frontend/src/modules/cases/CaseExecutionSubmissionPanel.spec.ts
frontend/src/modules/cases/CaseExecutionFinishPanel.spec.ts
frontend/src/modules/cases/CaseHearingPanel.spec.ts
frontend/src/modules/cases/CaseFilingPanel.spec.ts
frontend/src/modules/cases/CaseJudgmentPanel.spec.ts
frontend/src/modules/cases/CaseSecondInstancePanel.spec.ts
frontend/src/modules/organization/RoleTemplateEditor.spec.ts
frontend/src/modules/organization/RoleTemplatePanel.spec.ts
frontend/src/modules/organization/PeopleAccessPage.spec.ts
```

#### N17精确写入白名单

```text
frontend/src/app/AppShell.vue
frontend/src/app/AppShell.spec.ts
frontend/src/modules/cases/CaseListPage.vue
frontend/src/modules/cases/CaseListDisplay.spec.ts
frontend/src/modules/cases/CasePages.spec.ts
frontend/src/modules/cases/LawyerCaseListPage.vue
frontend/src/modules/cases/LawyerCaseListPage.spec.ts
frontend/src/modules/client/ClientCaseListPage.vue
frontend/src/modules/client/ClientCaseDetailPage.vue
frontend/src/modules/client/ClientCasePages.spec.ts
frontend/src/modules/leads/NotaryMatterListPage.vue
frontend/src/modules/leads/NotaryMatterListPage.spec.ts
frontend/src/modules/leads/NotaryMatterDetailPage.vue
frontend/src/modules/leads/NotaryMatterDetailPage.spec.ts
```

#### 依赖与验收安排

B17和P17可从同一冻结提交独立并行。F17先固定最小案件／客户／公证／Action API类型、严格解码与所需回执方法，交准确SHA给N17；N17只接固定API依赖，不读未提交共享源码。F17在P17固定后接纳真实面板补内部／律师详情交互。B17无前端依赖，P17按局部冻结类型开发；F17不能用替身声称真实面板已验收。F17的旧Panel测试只改本片必要typed fixtures及直接兼容反例，P17不碰旧Panel；N17持有CasePages及列表fixtures，F17不得代改这些文件。

作者只跑本Task聚焦单元／契约、对应类型／Lint／格式／context，精确区分未接依赖引起的组合编译缺口；不改权威docs/context、不跑共享PG／完整verify、不迁移预览、不push/main。B17独立Sol Review后交固定候选，材料路径只保持原结案历史下载，不新增归档文件category或上传。Action目录开发期核权限目录／严格parser／人员角色页及case-contracts，前后两阶段缺项分别报告，不拼称通过。Model路由按AGENTS；实际执行型号不可核验时不假称满足。

I唯一持有权威文档、最终前向迁移环境及合成E2E：新增tests/e2e/case-archive.spec.ts、case-archive-database.spec.ts、case-archive-migration.spec.ts；tests/support/case-archive-database.mjs／.d.mts、case-archive-migration.mjs／.d.mts。直接旧兼容接点允许串行修改tests/e2e/case-closure.spec.ts、case-closure-database.spec.ts、case-closure-migration.spec.ts、case-execution-finish.spec.ts、case-execution-finish-database.spec.ts、case-list-display.spec.ts、case-complaint-confirmation.spec.ts及tests/support/case-closure-database.mjs／.d.mts、case-closure-migration.mjs／.d.mts、case-execution-finish-migration.mjs；只支持新146链／准确旧144探针和正常来源准备／清理，不放宽原断言或改旧SQL。其他接点先报告后裁定；不另造门禁scope或自动affected能力。

本片接续跨历史事实末端守卫，I组合采用Level 3：作者聚焦验证→B17高风险独立审查→固定组合一次Final Review／finding关闭→稳定候选完整verify及适用PG／Chromium／146空库／144升级和失败原子专项。真实运营／当前律师归档、有权运营更正、旧Closure及Archive回执／准确文件、未知结果原参、撤权／竞争／回滚／直接SQL、客户／公证最小投影、ARCHIVED stage/counts与N1／N2／21条分页／三视口均需覆盖。使用backend/.env.test的15433隔离库，持久5186／3206／15436保持已验3f636ea与原数据，不提前迁移／seed／造归档数据。真实新Grant另需明确目标授权。

### 已完成CA016批次（历史独占边界保留）

**CORE-CA-016＋案件既有字段对齐＋N2｜已验收、集成main并更新持久预览。**

已验main基线`1471bfa76380409607a2d87a834b63cda3bc35cd`／tree`1d595f73970c66155273f4bc5ab2e0ed2a82905e`；只读分析01a1367f已读，I采纳登记及原因更正仍WAITING_ARCHIVE、未知日期null、真实结案额KNOWN／PENDING、首版附件可空、当前PRIMARY律师正常登记、获权内部运营更正。实收保持未登记，不伪推结清。具体请求／响应／版本链／摘要／面板合同只见案件Spec的CA016冻结段，不用Demo派生财务语义。

本批I复用`.local/worktrees/ca015-integration`，分支`codex/ca016-closure-display-integration`。五路实现及共享后端摘要均已接纳，所有Worker已停写；下表保留原独占边界及依赖历史，不再作为待派发任务。已验收候选`8cc3a8e88a9ce7305e4dee7714f05b81e8268cd2`／tree`3a7e0054218b08d4405939ba6bd48c3ed6ff607c`，九项PG／Chromium及五项静态通过，独立两轴接受；完整verify在fc0a514实际通过，17组相同工程输入限定复用。权威docs/context与交付仅由接替I写入，实际回执见VALIDATION。

| Task／模型                                                 | 独占worktree／分支                                                                                                 | 精确写入白名单                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N2跨模块案件导航，Luna                                     | `.local/worktrees/n2-case-route-context`／`codex/n2-case-route-context`，基线1471bfa，冻结离线安装及context已exit0 | `frontend/src/app/AppShell.vue`、`frontend/src/app/AppShell.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| B1结案Command／连续链／材料及受权摘要，Sol＋独立Sol Review | `.local/worktrees/ca016-backend-summary`／`codex/ca016-backend-summary`                                            | `backend/prisma/schema.prisma`；唯一两迁移`20261013190000_add_case_closure_enums/migration.sql`、`20261013190100_guard_case_closure/migration.sql`；新增`backend/src/modules/cases/case-closure.dto.ts`、`case-closure.dto.spec.ts`、`case-closure.service.ts`、`case-closure.service.spec.ts`、`case-list-display-read.ts`、`case-list-display-read.spec.ts`；既有`backend/src/modules/cases/case-read.controller.ts`、`case-read.controller.spec.ts`、`case-read.dto.ts`、`case-read.service.ts`、`case-read.service.spec.ts`、`lawyer-case.controller.ts`、`case.module.ts`；`backend/src/access-control/access-control.service.ts`、`access-control.service.spec.ts`、`permission-catalog.ts`、`prisma-access-control.store.ts`、`prisma-access-control.store.spec.ts`、`organization.service.ts`、`organization.service.spec.ts`（只必要类型／目录接点，不改授权算法）；`backend/src/modules/materials/material.dto.ts`、`material.service.ts`、`material.service.spec.ts`、`material.controller.spec.ts`；`backend/src/core-ld-openapi.spec.ts`；`scripts/prisma-model-owners.mjs`仅四新模型cases主责 |
| P1独立结案面板，Luna                                       | `.local/worktrees/ca016-closure-panel`／`codex/ca016-closure-panel`                                                | 仅新增`frontend/src/modules/cases/CaseClosurePanel.vue`、`CaseClosurePanel.spec.ts`；冻结props／callbacks／events开发，不改API／详情／样式                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F1共享API及详情接线，Luna                                  | `.local/worktrees/ca016-frontend-integration`／`codex/ca016-frontend-integration`                                  | `frontend/src/api/cases.ts`、`cases.spec.ts`、`materials.ts`、`materials.spec.ts`、`organization.ts`、`organization.spec.ts`；`frontend/src/modules/cases/CaseDetailPage.vue`、`LawyerCaseDetailPage.vue`、`LawyerCaseDetailPage.spec.ts`、`LawyerCaseListPage.vue`、`LawyerCaseListPage.spec.ts`；新增`CaseClosureDetailIntegration.spec.ts`；`frontend/src/modules/organization/RoleTemplateEditor.spec.ts`、`RoleTemplatePanel.spec.ts`、`PeopleAccessPage.spec.ts`；明确追加`frontend/src/modules/cases/CaseComplaintConfirmationPanel.spec.ts`、`CaseHearingPanel.spec.ts`、`CaseJudgmentPanel.spec.ts`，仅补新能力false／closure=null typed fixtures及必要直接断言，不改三Panel产品源码。不改CasePages.spec.ts（D1持有）或AppShell（N2持有）                                                                                                                                                                                                                                                                                                                                                          |
| D1内部案件列表字段，Luna                                   | `.local/worktrees/ca016-case-list-display`／`codex/ca016-case-list-display`                                        | `frontend/src/modules/cases/CaseListPage.vue`、`CasePages.spec.ts`；新增`CaseListDisplay.spec.ts`。CasePages只同步本片必要typed fixtures／旧列表断言和直接回归，不替F1改详情实现                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| I合成验收及集成，Sol                                       | 复用上述I worktree                                                                                                 | 权威docs/context；新增`tests/e2e/case-closure.spec.ts`、`case-closure-database.spec.ts`、`case-closure-migration.spec.ts`、`case-list-display.spec.ts`；新增`tests/support/case-closure-database.mjs`、`.d.mts`、`case-closure-migration.mjs`、`.d.mts`；必要既有E2E fixture／选择器按实际接点串行同步。不另造门禁入口，不在Worker现场跑PG／预览                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

N2已按以下范围实现并验收：跨公证／线索／其他模块展开案件范围时不继承外模块stage/group/view；案件及律师自身合法stage／group保留，非法案件URL仍交原页面明确拒绝，不静默变全部；组／原子书签、计数、恰一阶段高亮及分页重置回归。只两文件，不改CaseStage／Action／API。

原派发依赖（现已完成）：B1与P1从冻结候选并行；F1可先严格API／材料／权限及面板注入契约，真实面板接纳后补交互。F1先固定最小API候选供D1接纳，D1不读未固定文件或修改共享API；随后四路组合真实类型／直接组件验证。缺依赖时报告准确模块／fixture限制，不用any／skipLibCheck或把替身说成真实组合通过。作者只本片聚焦测试／类型／Lint／格式／context，不自行完整verify、PG、安装共享依赖、占预览、push/main；高风险B1固定候选独立Review后给I。

现有真实账号权限不随迁移自动增补。本片只枚举／目录／Action类型，隔离验收显式合成Grant；真实账号若需新动作须明确目标授权，不靠夜间通用指令扩安全权限。既有142迁移不动、唯一两新前向迁移；初版及每个原因更正精确接续finish→closure版本链，不用>=。客户最小投影与旧事实／回执／文件字节保持。

I正式验收已覆盖空库及142基线升级／第二步失败前向恢复、直接SQL负例、正常运营／当前律师登记及内部更正、权限撤销／竞争／回滚／旧原键、未知与真实0／精确版本历史、内部摘要及外部最小投影、21条分页／组书签、N2跨模块和三视口。实际候选、独立审查和同树门禁结果见VALIDATION；验收只用15433独立测试库，持久15436另按既有数据保留约定备份后前向升级，不造业务数据或自动增权。

### 已完成CORE-UI-001批次

**CORE-UI-001｜运营Demo字段与列表视觉对齐（已完成、已集成、预览已更新）。**

本批从已验main bd0e02b冻结d709600，严格沿受权真实来源扩展公证／线索Query与前端展示；原Command、schema、迁移、导出和财务语义不扩。四路候选已接纳；V0高风险独立审查及组合发现修复留痕、正式门禁与真实浏览器结果只在VALIDATION维护。

上一已集成CORE-KL-001、人工台账B2及U1/U2分页已收口main`3f914ad`，真实证据及旧失败保留于VALIDATION；验收后按用户单独授权备份并升级5186/3206/15436至66b85ce，原数据保留，Demo8123不操作。

CA015＋N1已验收、集成main bd0e02b并曾保留数据升级5186；本批只完成运营字段／列表闭环，不展开CA016／017、历史补录、资金发起或新后端财务事实。

#### 当前批次唯一文件所有权（从bd0e02b冻结，Worker由父线程启动）

本批保留侧栏；公证17列与详情／偏好、线索真实字段和案件现有字段纯排版并行。不扩案件新业务事实。DTO／来源与偏好合同见notary／leads Spec本日冻结段。没有本地.agents/skills或.codegraph，未加载额外设计服务。

| 任务／模型                 | 独占worktree与分支                                                        | 精确写入白名单                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V0公证受权Query与偏好，Sol | .local/worktrees/v0-notary-display-read；codex/v0-notary-display-read     | backend/src/modules/leads/notary-list.dto.ts、notary-list.service.ts、notary-list.service.spec.ts、notary-list.controller.spec.ts、notary-list-preference.dto.ts、notary-list-preference.service.ts、notary-list-preference.service.spec.ts、notary-list-routing.spec.ts、lead-notary.service.ts、lead-notary.service.spec.ts；新增notary-display-read.ts／notary-display-read.spec.ts                       |
| V1公证列表详情，Luna       | .local/worktrees/v1-notary-display-ui；codex/v1-notary-display-ui         | frontend/src/modules/leads/NotaryMatterListPage.vue／NotaryMatterListPage.spec.ts／NotaryMatterDetailPage.vue／NotaryMatterDetailPage.spec.ts                                                                                                                                                                                                                                                                |
| V2线索列表表单详情，Luna   | .local/worktrees/v2-lead-display-ui；codex/v2-lead-display-ui             | frontend/src/modules/leads/LeadListPage.vue／LeadListPage.spec.ts／LeadForm.vue／LeadForm.spec.ts／LeadDetailPage.vue／LeadDetailPage.spec.ts                                                                                                                                                                                                                                                                |
| V3案件现有字段表格，Luna   | .local/worktrees/v3-case-list-layout；codex/v3-case-list-layout           | frontend/src/modules/cases/CaseListPage.vue／CasePages.spec.ts／LawyerCaseListPage.vue／LawyerCaseListPage.spec.ts                                                                                                                                                                                                                                                                                           |
| I唯一共享接线及验收，Sol   | 复用.local/worktrees/ca015-integration；codex/demo-list-display-alignment | frontend/src/api/notary.ts／notary.spec.ts／notary-list-preference.ts／notary-list-preference.spec.ts／leads.ts／leads.spec.ts；新增frontend/src/modules/leads/lead-display.ts／lead-display.spec.ts；backend/src/modules/leads/lead.service.ts／lead.service.spec.ts；frontend/src/styles/demo-components.css；必要既有OpenAPI／leads module直接接点；权威文档／context；tests/e2e及support本片专用新增文件 |

V3不改后端/API/AppShell/阶段语义，仅现有businessNo、stage、owner、sourceLead、sourceNotaryMatter与所有实际capability合并显示，准确编号不截后四位；无虚假选择／搜索／导出入口。详情链接、旧URL、分页／请求取消和未知URL行为保留。既有表格结构table/thead/colgroup/tbody，六列：操作／案件编号、案件进展、负责人、办理权限、来源线索、公证事项；律师只呈现既有字段，不猜未提供的负责人。全部can*实际能力有任一true才显示办理，仍由服务器授权。不得占V1／V2文件。

I共享CSS只新增业务列表限定类，不重写全站table／导航。统一class约定：页面business-list-page；工具栏business-list-toolbar；容器business-list-scroll；表格demo-table business-list-table；单元格business-list-cell--nowrap／--text／--number；徽标沿pill；页尾business-list-footer。正文13px/1.5、表头12px，单元格8px 12px，普通单行目标44px，长文本最多两行约60px；数字／金额右对齐且tabular-nums，日期／短编号／状态不换行。列min-width：操作/编号200、阶段140、姓名主体/店铺160、平台100、日期120、手机140、金额120、地址240，宽表按colgroup与min-width横滚，不压成竖排；长文本有键盘可用展开或精确详情。工具栏与分页紧凑相邻，不以固定min-height制造大片空白。视口1440×900与1024×768同Demo对照，并核390×844无正文横向溢出（表内横滚允许），键盘横滚/展开/详情可用。

Worker只跑自身聚焦测试／类型／lint／格式，报告SHA/tree/实际结果／边界；不改共享API／样式／docs，不运行PG、环境安装或全仓门禁。新API缺模块期间先做现有字段与fixture，I共享候选后补真实类型组合，不以测试替身通过冒称整合。V0涉及跨资源读取，由独立Sol审查；普通UI自审，不逐Task另设Reviewer。I统一普通API／固定15433测试库、真实素材语义与受控浏览器截图，验收期间保持5186用户预览及其15436/进程不变；验收后按明确授权备份并保留数据更新预览。正式固定组合及真实来源／权限／偏好／三视口已验收，实际结果只在VALIDATION维护；不扩大为其他新增字段、支付发起或全部Demo完成。

### Next Slice

**CORE-CA-019｜仅预留跟踪标识，未定范围／未冻结／未领取。** CA018已验收；按既有模块依赖选择下一独占任务；不派实现，不提前新增业务决定或长期细拆计划。

CA018已从原暂停队列领取，实际范围只见Current及案件Spec；原SD-23外部接办／历史来源约束保持。其他详情布局／按钮语义和字段对齐两条待办仍在各模块交付前验收，不把本片称所有Demo已完成。

#### 三模块新增待排优先级（2026-10-15）

以下是用户新增的待排规划编号，均**未领取／未实现**，不是六个已冻结Slice，也不把全部范围塞入CA019。CA018保持唯一Current；原结算、证物、报表依赖顺序不改。业务确认、已具备能力及去重依据统一见[INPUT-016](deferred-design.md#input-016三模块少操作办理闭环与快捷批量能力)。

| 待排编号 | 顺序与边界                                             | 必须保留的入口与验收要点                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UXQ-01   | 已有入口可发现性与案件列表正式单项办理                 | 从列表真实获权动作进入既有办理表单，沿原Command、材料、阶段和版本校验，提交后刷新列表与详情同事实；不做通用改状态，不重做CA018新建。                                                                                               |
| UXQ-02   | 公证资料维护与独立批量开箱                             | 原事项内带原因更正取证日期／物流／寄件；证书出证后另受控。跨事项开箱须明确选中、真实材料与单项资格逐项验证；不重做NT008／009／010，实体误建另见UXQ-06。                                                                            |
| UXQ-03   | 线索批量推送、能力15 CSV导入、合法批量归档分别冻结验收 | 列表关键词与选择区→显示已选数量→相应独立动作；推送沿整批原子，导入有只读预览／逐行错误／明确选择，归档只处理获准且已确认的合法对象。未确认对象按INPUT-016可恢复删除，不以归档代替。                                                |
| UXQ-04   | 案件服务端筛选排序、列设置／真实统计及受权清单导出     | 查询、分页与排序同服务端范围；设置按实际账号保存；统计明确字段、时间、空值与当前范围，导出同口径快照，刷新／重登可复核。不得照抄Demo将全部归档当本月累计。列表／批量归档独立复用正式结案／归档门槛。                               |
| UXQ-05   | 其他高频确认／邮寄／匹配批量                           | 按真实单项资格独立拆片，明确选中和数量、原动作、逐项结果、事务模式与原请求恢复；不能批量跳过材料、角色、来源或阶段约束。                                                                                                           |
| UXQ-06   | 误建可恢复删除、受控撤销／终止及能力20合并             | 线索从未客户确认才可恢复删除，曾确认只能带原因撤销留痕；删除关闭未确认待审核入口，保留推送／审核历史并事务处理确认竞争。有公证／案件／费用关联受控处理。公证／案件保留各自来源和关联约束；合并承接能力20，不复制事实、材料或费用。 |

各项领取前补齐真实按钮／步骤、字段来源、服务端权限和验收条件；批量NT010／线索推送沿既有整批原子，其余模式在各片冻结。这里只排队，无实际删除、改历史、终止、迁移或预览升级。

#### 上线故障定位待排队列（2026-10-15）

复用既有OPS-01，正式子任务为**OPS-01-A～E，均未领取／未实现**。A先冻结最小诊断契约，B页面提示和C安全日志可并行；D部署方案可离线并行准备，实际告警联调依赖C及目标环境；E最后做隔离故障演练。作为生产准入前置，不改变CA018收口、CA019占位、UXQ-01～06顺序或原结算／证物／报表依赖。任务范围、现有能力、验收和部署待定项统一见[OPS-01方案](deferred-design.md#ops-01上线异常提示与故障定位已入队未实现)，不接第三方、不自动重试通用写操作。

#### 已完成分页批次的分派留痕

本批开工时实查内部`CaseListPage.vue`及客户`ClientCaseListPage.vue`分别固定调用`listCases(1, 20)`／`listClientCases(1, 20)`，现有严格API已支持分页；公证与律师列表已有分页，不重复开发。依据本页Demo对齐矩阵的案件列表范围、SD-13／39既有读取合同及`demo/DESIGN.md`，先补只读可用性；不从Demo批准新的阶段或财务规则。

| 任务                             | 唯一实现白名单                                                                  | 交付与验收                                                                                                                                                                                                                               | 禁止／依赖                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| U1 内部案件列表分页，Luna        | `frontend/src/modules/cases/CaseListPage.vue`、`CasePages.spec.ts`              | 真实请求page／pageSize；21条可翻第二页，首末页与空页明确；切mine／department及stage／stageGroup回首页；URL刷新／返回恢复合法页；迟到响应不覆盖新范围；原精确ID跳转和办理入口保留。相关Vitest、前端类型／Lint／格式及两页正常浏览器验证。 | 不改cases API、后端、权限、AppShell、共享样式或阶段动作；已有过滤合同不新增字段。                                    |
| U2 客户案件列表分页，Luna        | `frontend/src/modules/client/ClientCaseListPage.vue`、`ClientCasePages.spec.ts` | 沿既有客户API翻页；21条第二页、切view回首页、刷新／返回、空／错误／加载、401／403清旧投影和迟到响应覆盖反例；保留本企业最小字段与精确caseId。相关Vitest、前端类型／Lint／格式及客户正常浏览器验证。                                      | 不改client API、后端、企业范围、材料投影或办理动作；不读取内部金额／审计。                                           |
| D1 历史补录入口技术设计准备，Sol | 只读分析及报告，无正式代码／Spec写权限                                          | 按B12／SD-23已批准角色、任意目标阶段、真实日期／来源／原因及主管补已归档，给出来源身份、编号防重、授权／同案事务、历史事实锚、材料未知、迁移与AC的最小契约建议；区分已知规则与待决定。供I冻结接口并独立审查后再派实现。                  | 不直接造目标阶段、虚构历史材料／日期，不借补录实现CA015／结案／收款；外部转入和历史补录是否共用入口由I核对来源语义。 |

I唯一持有`frontend/src/api/{cases,client-cases}.ts`、共享类型／样式、router／AppShell、后端、schema／迁移、测试环境、共享E2E及权威文档；U1/U2只在各自白名单工作，可并行，D1不写它们。父任务启动独立实现任务，I负责契约、接纳commit、一次组合Review和适用门禁；原九文件结果不覆盖新分页逻辑。分页不需新业务决定；SD-54三项最小执行结束／业务归档／资料更正已批准；B13其他主协办等范围、B15其余财务／留存及B18～21/E03支付规则保留，不要求开发者猜测。

本批组合验收边界（实际通过见VALIDATION）：两线固定SHA和实际检查已交回；父已授权I直接接纳，白名单／基线已核，集中做一次组合Review。对新候选运行两线组件／相关严格API契约、正常项目入口的静态与受影响格式检查；只有实际新增契约才扩相应门禁，不默认重跑旧完整verify或68项。现成`LawyerCaseListPage.spec.ts`有21条第二页组件范例；当前案件相关E2E与`core-leads.spec.ts`未找到内部／客户两页场景，不能冒称已有整合覆盖。复用既有`createSubmittedCaseThroughApi`、正常密码登录与数据准备／清理入口，先核重复准备和账号／案件归属，再在固定合成测试库补最小真实21条跨页浏览器验证；不新建服务或把测试fixture身份／reset用于持久预览。实际运行的PID、日志、开始／结束／退出码和最终候选进入既有VALIDATION，不预写通过。I已在既有诉状确认E2E及来源准备器补一个双端21条分页场景（普通来源API／密码登录），已在稳定候选完成固定测试库2/2，正常密码和两端21条分页取得实际通过；作者组件结果没有代替浏览器证明。

#### SD-54原实施所有权留痕（原分派时CA015已集成，CA016已验收，CA017待实施）

原派发记录：当时允许父任务派技术冻结／设计准备，实现基线取该分页批次最终核实main。CA-015单次办理闭环现已集成，CA-016也已完成冻结及验收；CA-017仍须按SD-54另行冻结，不能将重开或付款发起夹带。每个闭环都要正常角色办理→刷新／重登→事实与准确历史可读，并覆盖失权、旧版本／来源、未知结果、竞争和失败回滚；展示未登记／未知，不伪造实收或结清。

CA-015原工程合同在[案件Spec](spec/v0.1/modules/cases.md#ca-015技术冻结2026-10-13依据sd-54已按此合同实现)和DOMAIN登记；以下保留当时唯一文件分工，替代冻结前概括建议。原代码基线为已核main `3f914ade4613fd75c1463f7f7f2c16951f12b0a4`，当时先接纳I本地冻结文档提交，再于冻结技术Review接受后启动独立worktree。该记录描述原准备阶段，不代表当前CA-015仍未实施／验证。

| 任务                           | 唯一写入白名单                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 验收及协作边界                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E0只读准备，Sol                | 无写入权；线程01a133fa-12ce-7547-87f4-79670d29502a报告已完成，含迁移计数措辞校正                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | I已裁定说明或真实附件至少一项、客户仅stage、两步enum/DDL迁移及共享所有权；独立技术Review通过后放行实现，不重问SD-54。                                                                                                                                                                                           |
| E1后端正常执行结束及兼容，Sol  | `backend/prisma/schema.prisma`；新迁移`20261013070000_add_case_execution_finish_enums/migration.sql`和`20261013070100_guard_case_execution_finish/migration.sql`；`backend/src/access-control/{permission-catalog.ts,access-control.service.ts,access-control.service.spec.ts,prisma-access-control.store.ts,prisma-access-control.store.spec.ts,organization.service.spec.ts}`（计算算法不改）；`backend/src/modules/cases/{case.module.ts,case-read.controller.ts,lawyer-case.controller.ts,case-read.dto.ts,case-read.service.ts,client-case.response.dto.ts,client-case.service.ts}`；新增`case-execution-finish.dto.ts/service.ts/service.spec.ts`；`backend/src/core-ld-openapi.spec.ts`仅Finish provider／接口断言；该目录直接`case-read.controller.spec.ts,case-read.service.spec.ts,client-case.controller.spec.ts,client-case.service.spec.ts`及新增finish契约测试；`backend/src/modules/materials/{material.dto.ts,material.service.ts,material.service.spec.ts,material.controller.spec.ts}` | 整个backend／Prisma本片只有E1写；材料公开freeze/list、上传/下载身份路径、客户RECORDED阶段、授权Action类型及旧SQL版本链接续由E1完整交付，I不并行改这些文件。独立高风险Review、聚焦单元及I调度的固定测试库SQL/迁移证据后交固定commit；不安装/改共享环境、不自行全仓门禁。若出现白名单外编译/契约接点先报I重分配。 |
| E2注入式结束面板，Luna         | 仅新`frontend/src/modules/cases/CaseExecutionFinishPanel.vue`与`CaseExecutionFinishPanel.spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 按Spec冻结item/callback/events构建日期、原因、说明/附件或二者、核对、精确原请求未知恢复、冲突/失权及事实原版展示；用局部结构及既有CaseFile，不写API/detail/shared/backend。可与E1并行，Mock组件及自身类型/Lint/格式后交commit，不运行DB或全仓门禁。                                                             |
| E3前端共享接线与阶段兼容，Luna | `frontend/src/api/{cases.ts,cases.spec.ts,materials.ts,materials.spec.ts,client-cases.ts,client-cases.spec.ts,organization.ts,organization.spec.ts}`；`frontend/src/modules/cases/{CaseDetailPage.vue,LawyerCaseDetailPage.vue,CaseListPage.vue,LawyerCaseListPage.vue}`及本目录既有`*.spec.ts`（明确排除E2新面板spec）；`frontend/src/modules/client/{ClientCaseListPage.vue,ClientCaseDetailPage.vue,ClientCasePages.spec.ts}`；`frontend/src/app/{AppShell.vue,AppShell.spec.ts}`；`frontend/src/modules/organization/{RoleTemplateEditor.spec.ts,PeopleAccessPage.spec.ts}`                                                                                                                                                                                                                                                                                                                                                                                                                          | 独占统一Finish严格请求/回执、材料category、权限parser、WAITING_ARCHIVE导航/筛选/客户最小stage与两详情薄接线；保留同案同身份未知请求内存快照及一次workflow通知，退出/身份变化清理。与E2分别写互不重叠文件；面板接线在接纳E2后验证，严禁代写E2新文件。客户不新增内部字段/表单或依据权限。                         |
| I工程集成，Sol                 | 权威docs及context；`scripts/prisma-model-owners.mjs`仅新三模型归cases，随接纳schema同步，不改architecture-check算法；`tests/e2e/case-execution-finish*.spec.ts`；`tests/support/case-execution-finish*.{mjs,d.mts}`及现有`case-execution-filing-database.{mjs,d.mts}`的必要来源复用（不改共同清理器）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 冻结/技术审查、接纳E1/E2/E3固定提交、测试环境/门禁互斥、两正常身份普通API闭环、最小客户/精确材料及一次组合Review与最终门禁；不与worker争写其backend/前端白名单。实际验证层级按最终修改裁定，旧CA014/分页证据不冒充CA015通过。                                                                                   |
| A0归档/资料更正准备，Sol       | 仅只读报告，无文档/代码/环境写权                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 与上述实施并行准备SD-54后续片，不能夹带重开、收款、财务公式或历史补录问题。                                                                                                                                                                                                                                     |

冻结技术Review已接受，E1/E2/E3均已冻结并由I接纳，原作者停止写入；来源SHA、接纳SHA及实际检查见project-status/VALIDATION；CA015最终组合已通过，本段保留实施所有权。E1两步迁移不可把enum失败后的现场说成全原子，必须测新库/支持schema升级、旧facts与回执保留、第二段失败回滚及向前恢复。E1所需直接数据库验证统一预约I的backend/.env.test测试库，worker不争用其他预览环境。E2/E3仅普通Task自审和聚焦验证，不逐Task加重复Reviewer。

2026-10-13用户再次授权指挥实施并同步文档。导航N1（01a13452-9ded-7087-a0a6-d0241fd84005）从完整组合4b753de独占12文件：frontend/src/app/AppShell.vue/spec、frontend/src/api/cases.ts/spec、frontend/src/modules/cases/CaseListPage.vue及CasePages.spec.ts、LawyerCaseListPage.vue/spec；backend/src/modules/cases/case-read.dto.ts、case-read.service.ts、case-read.service.spec.ts、case-read.controller.spec.ts。它只落实REQ-CA-010既有两文书分组与顺序、范围计数及旧原子书签，不新增状态或办理权；此所有权替代E1/E3对这些文件的已完成实施分派，I不得并写。I持有新finish DB/migration/浏览器验收、必要的旧mailing来源显式回调和迁移复制/FK检查导出、模型归属和权威文档。浏览器测试准备任务仅新filing来源helper及声明、finish.spec三文件，已交固定候选，未运行PG。最终组合统一Review及所属门禁，不把只读导航报告当验证结果。

### CA-013原前置边界

CA-013前置为已集成CA-012。

CA-013只处理执行材料待盖章→待申请执行；本批次CA-014在其成功事实之后单独办理申请执行，两个动作各自保留来源与门槛。

## 核心主线优先的交付顺序

SD-37之后，四个大段只作为里程碑，不能再作为实施Slice。一个Slice只完成一类角色动作和一次主要状态变化，并形成正式页面、API、服务端规则、PostgreSQL、最小权限、审计和关键浏览器验收；支撑能力随当前动作补齐，不另建阻塞主线的大平台。

| 里程碑         | 小切片顺序                                                                                                                                                                                                              | 完成标志                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 线索到公证移交 | `CORE-LD-001`运营新建待推送线索 → `002`推送至真实客户端 → `003`客户确认侵权（已完成）／`004`不侵权归档（已完成）→ `007`运营申请、原客户确认撤回（已完成）→ `005`运营不取证归档（已完成）／`006`确认取证并移交（已完成） | 待推送、线索待审核、线索待确认、线索已归档及已移交公证状态可见；不侵权归档可留痕纠错并重新审核；取证分支生成有稳定来源的待取证事项 |
| 公证到案件     | `CORE-NT-001`取证物流 → `002`开箱材料 → `003`运营／客户开箱审核 → `007`补公证处开箱入口 → `004`运营出证选择 → `005`公证处出证转案／`006`运营退货归档                                                                    | 公证正常路径原子生成案件待匹配，退货支路独立闭环                                                                                   |
| 立案前案件     | `CORE-CA-001`匹配律师 → `002`起诉材料 → `003`确认诉状 → `004`客户盖章邮寄 → `005`提交立案 → `006`正式受理 → `007`开庭后推进                                                                                             | 案件从待匹配逐动作到待判决，客户邮寄为真实客户端动作                                                                               |
| 判决到归档     | `CORE-CA-008`判决登记 → `009`后续选择 → `010`二审 → `011～014`执行材料及立案 → `015`执行结束 → `016`结案信息 → `017`最终归档                                                                                            | 按已批准规则完成审理、执行和归档；B13／B15只阻塞依赖它们的小切片                                                                   |

多联系人、客户负责人、资产、协议、完整生产存储、费用结算和报表仍在能力总账中，但不再决定上述核心动作的开发先后。真实客户端从`CORE-LD-002`开始按需交付，不再整体后置；完整客户门户仍后置。

## 实现证据审计

| 能力                           | UI                                                 | API／后端                                         | 数据库                                             | 权限                                               | 测试与结论                                                                                         |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 运行与数据库健康               | `/health` 连接检查及重试                           | `GET /api/v1/health` 实际查询数据库               | Prisma/PostgreSQL `SELECT 1`                       | 公共健康接口，不返回数据库秘密                     | 浏览器覆盖成功、失败和恢复；`✅`                                                                   |
| 本地账号认证                   | 登录、退出、匿名路由跳转、会话恢复                 | 登录／会话／退出、同源、CSRF、限速、Cookie 会话   | 账号、凭据、会话、限速表及迁移                     | 每次请求重读账号、成员和授权修订                   | Playwright 真实登录→写客户→刷新→退出，以及 CSRF、并发限速和迁移测试；`✅`                          |
| 授权与部门隔离基础             | 客户与人员工作区按服务端 capability 展示动作       | 不可拆分 Grant、管理API、范围查询和Grant Boundary | Team、角色、分配、成员及客户组合部门约束           | 跨部门／越范围拒绝，撤权下一请求生效               | 人员、Team、角色生命周期及模板复制／Grant编辑均有数据库型浏览器E2E和独立终审；客户域边界`✅`       |
| 客户草稿                       | 列表、新建、详情、编辑和历史                       | 创建、分页读取、详情、编辑、判重                  | 客户、版本及审计事件，部门内证件唯一               | 创建／读取／编辑分别校验动作和范围                 | 浏览器真实新建→编辑→刷新，数据库判重、并发、回滚、审计和越权测试；明确范围 `✅`                    |
| 一位准入联系人                 | 新建／编辑客户表单和详情展示                       | 随客户创建／编辑校验姓名及电话／邮箱              | 客户聚合字段与完整性 CHECK                         | 沿用客户范围和编辑权限                             | 浏览器持久化、格式、空白约束、审计脱敏和回滚测试；明确范围 `✅`                                    |
| 权利主体最小关联               | 客户详情中新建、选择已有主体、列表和只读详情       | 新建并关联、可关联查询、关联已有和嵌套详情        | 主体、多对多关联、幂等回执、组合部门外键           | 以有权客户为访问锚点，不泄漏其他客户关系           | 浏览器复用同一主体，数据库幂等、并发、撤权、跨部门、事务回滚和迁移测试；明确范围 `✅`              |
| 客户正式准入                   | 客户详情补齐证件、联系人和真实材料后确认准入       | 主体／证件组合、联系方式、材料版本和幂等Command   | ADMITTED约束、准入回执、审计及冻结材料引用         | `customer.admit`与客户当前范围双重校验             | 真实PDF／JPEG字节、下载一致、准入刷新、幂等／越权／失效版本及回滚；最小内部范围 `✅`               |
| 待推送线索                     | 四阶段计数、列表、新建、详情、刷新和待推送编辑     | 字典、表单上下文、创建／读取／编辑及稳定错误码    | 线索、商品、侵权类型、日编号计数器、幂等回执与审计 | `lead.read/create/edit`与SELF／TEAM／DEPARTMENT    | 真实浏览器创建→详情→刷新→编辑，权限、幂等、并发、999／1000边界、回滚与迁移专项；`CORE-LD-001` `✅` |
| 推送及客户端只读               | 运营详情推送；客户端待办、详情和附件读取           | 推送Command、客户账号管理、企业范围查询           | 客户绑定、推送时间／人员、幂等回执与成功审计       | `lead.push`内部范围；客户绑定固定企业范围          | 真实双账号浏览器链、跨企业／待推送隔离、撤权、并发、回滚及迁移专项；`CORE-LD-002` `✅`             |
| 客户确认侵权                   | 客户端确认及已处理；运营详情只读审核记录           | 客户审核Command、企业范围查询和附件再授权         | 不可变审核决定、幂等回执及前向迁移                 | `client.lead.review`固定企业绑定范围               | 真实双账号浏览器链、跨企业隔离、撤权、并发、回滚与迁移专项；`CORE-LD-003` `✅`                     |
| 不侵权归档与撤回纠错           | 客户归档及双账号撤回页面已实现                     | CORE-LD-004／007的决定与撤回Command已实现         | 不可变历史、幂等回执及前向迁移已验证               | 原客户企业确认、运营申请分别校验                   | [LD-007固定候选](spec/v0.1/VALIDATION.md)完整门禁与87项数据库浏览器验收；明确范围 `✅`             |
| 实际出证、退货和案件等后续业务 | 公证处出证、运营退货归档、案件匹配与起诉材料已可用 | NT-005／006、CA-001／002已验收；后续未实现        | 公证书、费用事实、归档、匹配及起诉材料已持久化     | 案件本部门可读、获权负责人可写；公证／退货沿原范围 | [CA-001／002固定候选](spec/v0.1/VALIDATION.md)分别证明匹配及起诉材料，不证明后续办理               |

当前正式前端已通过共享壳层承载运营端客户、权利主体、人员权限、线索、公证、案件匹配与起诉材料工作区，并提供独立客户及公证处身份入口；后端已有来源移交、取证物流、开箱、审核、出证、退货归档、案件匹配及起诉材料提交Command。相应事实、命令回执、待确认诉状案件与审计已持久化并验收；CA-001／002均已合入`main`，后续案件动作仍按路线图推进。

### 路线图来源索引

| 路线图项                     | 现有承诺／规则来源                                                                |
| ---------------------------- | --------------------------------------------------------------------------------- |
| CORE-LD-001～007             | REQ-CU-001／002、REQ-LD-001～004、REQ-XM-001～003／006、SD-13／22／30／34／37／40 |
| CORE-NT-001～006             | REQ-NT-001～005、REQ-XM-003／006、BD-01／12、SD-02／14／26／34／37                |
| CORE-CA-001～017             | REQ-CA-001～009、SD-06／13／23／24／34／37                                        |
| 01～03、07                   | `README.md`、`architecture.md`、REQ-XM-001／005、REQ-SY-004、AUTH-LOCAL-001       |
| 原08～13及15、20～27能力总账 | 对应REQ-CU／SH／CA／EV／KL／FE／ST／RP／SY及既有Decision                          |

CORE编号表示当前交付顺序；下方原01～27编号改为稳定能力索引，不再表示执行优先级。两者都不改变对应Spec的批准状态，也不把设计方向自动升级为已实现。

### 全Demo后续实现顺序（2026-10-14，阶段到来时才细拆）

依用户最新要求，只在统一规划排模块顺序和前置依赖，不提前扩写三模块契约、用例、切片文件或实施白名单。当前先完成UI002三项案件页面修改；CA018已停在只读安全点，之后推进正常系统功能和真实独立来源入口。下列完整Demo模块均未形成正式闭环，不以能力占位冒称完成；到对应阶段才冻结最小可验合同并拆任务。

| 后续顺序 | 正式待实现模块与Demo覆盖目标                                                                                   | 前置与已实现边界                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | 结算中心：客户／律师结算、费用中心及源明细、账单／合单、发起与实际完成                                         | 案件／费用真实来源、双方字段及金额状态，B18/B19/B20、SD-20公式后置及E03实际财务协议。CU007／008客户协议／开票／人工台账已实现，但不等同完整结算中心            |
| 2        | 证物管理：实物编号／货架位置／状态、律师／阶段筛选、入库／签收／移交／批量维护／受控销毁，公证书纸质保管及多本 | B21实物粒度、状态和销毁留存；E02生产发布另定。已有公证书文件／内容版本／下载不是实物保管；不将案件文件页替代证物模块                                           |
| 3        | 数据报表：真实概览指标、平台／类型分布、法院TOP5、金额分布及受权CSV快照                                        | 按对应指标依赖案件／费用／结算真实源，B17/B22的时间／无值／空集／舍入口径与授权／导出快照；现RP两项REQ不足覆盖完整Demo，到此阶段再逐指标细拆，不从模拟图猜规则 |

父级及本轮只读核对Demo菜单／对应render函数和正式settlement/evidence/reports Spec；G04/G05/G07是差异记录，不是执行Task。最新排期要求覆盖刚拟的远期ST／EV／RP细拆，本轮尚未提交这些切片，已撤回细拆、保留模块顺序与依赖，不挤掉Current UI002。未部署、生产材料／真实资金及权限边界仍按各模块规范。

## 能力总账（不再作为执行顺序）

本表保留全部能力边界和原编号供追踪；实际开发顺序只看上方CORE切片。每项完成标准中的真实UI／数据库验证仍不能用组件单测、Mock或只有API的结果替代。

| 顺序 | 功能闭环                       | 当前状态                 | 已完成内容                                                                                                                                       | 剩余内容／当前边界                                                                                             | 前置依赖                         | 完成标准                                                                                                                                                                                |
| ---- | ------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01   | 运行与真实数据库健康检查       | ✅ 已完成                | 健康页、数据库健康 API、统一错误和请求编号、真实 PostgreSQL 浏览器测试                                                                           | 生产监控和告警属于发布能力                                                                                     | -                                | 部署到测试／验收环境后，业务人员通过真实 UI 看到数据库就绪；断开服务可见失败，恢复后重试成功。                                                                                          |
| 02   | 本地账号登录与会话安全         | ✅ 已完成                | 首位管理员初始化、登录／恢复／退出、CSRF、同源、限速、不透明会话和匿名路由                                                                       | 人员开通、重置密码、MFA、OIDC 不在本 Slice                                                                     | 01                               | 测试／验收环境真实 UI：登录→进入客户页→刷新仍登录→退出→受保护页重新要求登录；错误密码、停用或失效会话被拒绝。                                                                           |
| 03   | 客户域最小 RBAC 与部门数据隔离 | ✅ 已完成                | Grant、SELF／TEAM／DEPARTMENT、Team组合外键、管理Action、Grant Boundary、人员／成员／角色管理及模板复制／Grant编辑                               | 完成仅指客户域及当前人员管理边界；其他业务域权限仍随各自Slice扩展                                              | 02                               | 数据库型浏览器已验证复制／分配／编辑模板、下一请求使用新Grant、跨部门／越级拒绝、并发与回滚；Level 3完整门禁及独立终审通过。                                                            |
| 04   | 客户草稿建档与维护             | ✅ 已完成                | 列表、新建、详情、编辑、部门内判重、乐观版本、审计和持久化                                                                                       | 搜索／状态筛选、正式准入、合作状态、删除不在本 Slice                                                           | 02、03                           | 测试／验收环境真实 UI：登录→新建草稿→打开详情→刷新数据仍在→编辑→处理同名／证件冲突→查看审计；权限与部门范围正确。                                                                       |
| 05   | 多联系人及冻结准入资料         | ✅ 已完成                | CORE-CU-006已本地验收：多联系人、最多一位主要、可无主要、结束留史；准入快照与当前联系人独立                                                      | 本行已确认联系人范围无剩余；不自动获得账号/权限，主体后续范围见08                                              | 04                               | 实际候选db33bf6全库259/259、完整verify及102迁移通过；真实密码cookie/CSRF、原键恢复、撤权清资料与分页已验证。                                                                            |
| 06   | 权利主体最小新建、查看与关联   | ✅ 已完成                | 主体新建、客户内查看、关联已有主体、跨客户复用稳定身份、幂等和审计                                                                               | 编辑、删除、解除关联、默认主体和自动查重不在本 Slice                                                           | 04、03                           | 测试／验收环境真实 UI：客户 A 新建主体→客户 B 关联同一主体→刷新仍是同一身份→无权客户和另一部门不可见；重复提交不产生重复关联。                                                          |
| 07   | 人员账号、部门成员与角色分配   | ✅ 已完成                | 管理工作区与API、原子建号／成员／初始角色、账号与成员启停、重置密码、调队、角色撤销／恢复、Team维护、会话失效、角色模板复制／Grant编辑和自动审计 | 跨部门公司级账号管理、自助改密、模板删除／停用不在现有已完成边界                                               | 02、03                           | 数据库型浏览器已验证管理员创建人员→分配Team及角色→新人员登录，以及模板复制／编辑、调队、撤权和密码重置；Level 3终审通过。                                                               |
| 08   | 多联系人及客户关系维护         | 🟡 部分完成              | 多联系人及主要/结束关系已由CU006本地验收；权利主体最小新建、查看和关联已实现                                                                     | 权利主体编辑/解除关联/默认规则仍需单独确认；不将联系人完成泛化为主体关系全完成                                 | 04～07                           | 测试／验收环境真实 UI：客户下新增、修改、设主要和结束联系人关系→刷新及历史正确；联系人不自动成为账号，主体关系变化不破坏历史业务引用。                                                  |
| 09   | 私有材料存储与版本生命周期     | 🔴 生产集成阻塞          | CORE-LD-001已实现上传草稿、本地／测试私有存储、不可变内容版本、下载再授权、删除／恢复、冻结引用和Blob失败补偿，真实PDF／JPEG字节已验证           | E02的生产provider、bucket、凭据、加密、签名链接、安全扫描及备份恢复条件未提供                                  | 03、07；生产E02                  | 内部MVP真实字节和授权契约已验证；只有生产私有存储、备份恢复和安全条件通过后，才可把完整能力标为完成。                                                                                   |
| 10   | 客户证件材料与正式准入         | ✅ 最小准入已完成        | 草稿、证件字段、部门内判重、一位联系人、主体关联、真实证件材料、按主体类型校验、准入Command／状态／审计已形成闭环                                | 完成只指CORE-LD-001的正式线索门槛；生产材料仍受09/E02限制，多联系人、合作状态等另属后续能力                    | 04～07；CORE-LD-001最小材料      | 真实UI补齐证件、联系人和材料→准入→刷新仍ADMITTED已通过；越权／失效材料拒绝，只有已准入客户可创建线索。                                                                                  |
| 11   | 客户负责人、合作状态与转派     | 🟡 CU005已本地验收       | 负责运营的独立授权转派、暂停／终止／恢复、原因、不可变审计、未知结果原请求恢复；新线索受限、存量继续                                             | 客户经理普通资料字段尚待最小录入／读取交付；存量业务逐项暂停另随对应案件切片，不扩大CU005范围                  | 07、10                           | 真实密码cookie/CSRF证明源SELF转派成功后失读、目标按实际Grant读；暂停／终止存量线索转公证/Case继续，恢复后真实新增线索；客户经理不创建账号、不影响权限；98项组合及迁移证据见VALIDATION。 |
| 12   | 权利资产与授权材料             | 🔵 已设计待开发          | 权利资产、有效期、精确版本引用和 OCR 候选隔离已有设计方向                                                                                        | 资产字段／动作切片、材料实现、有效性规则；真实文件依赖 09，OCR 另依 E04                                        | 06、09、10；E04（仅 OCR）        | 测试／验收环境真实 UI：登记权利资产及授权材料→刷新仍存在→案件引用固定版本→换版不改写历史引用→到期／未知有效期正确提示；越权访问失败。                                                   |
| 13   | 客户协议、开票信息与版本适用   | 🟡 部分完成              | CORE-CU-007真实协议/开票资料、不可变版本、精确历史附件及独立读改权限已本地验收                                                                   | 本片不自动绑定或回填Lead/Case适用版本；CU008人工台账已验收，历史业务适用规则仍按对应切片接入                   | 07、10                           | 实际76c0506完整verify、全库274/274及103～108迁移专项通过；真实密码cookie/CSRF、撤权清资料和未知上传核对已验证。                                                                         |
| 14   | 线索手工录入、审核与移交公证   | ✅ 已完成                | CORE-LD-001～006及007已完成手工录入、推送、真实客户审核、归档纠错与运营两分支取证决定、移交及查看                                                | 本行范围内无剩余动作；公证后续办理属能力16                                                                     | 06、07、10                       | [LD-006固定候选](spec/v0.1/VALIDATION.md)验证稳定来源、原线索只读及重试不重复；不代表公证后续办理完成。                                                                                 |
| 15   | 线索 CSV 预览与批量提交        | 🔵 已设计待开发          | 已确认解析预览、逐行校验、明确选择、取消不残留的目标                                                                                             | 文件格式／大小、批量原子模式、重复与并发契约、页面及测试                                                       | 09、14                           | 测试／验收环境真实 UI：上传 CSV→只读预览及逐行错误→明确选择有效行→提交→刷新仅出现所选线索；取消、换文件、重复提交和混合非法状态不写错数据。                                             |
| 16   | 公证事项线上办理与出证转案     | ✅ 已完成                | 来源只读、取证物流、开箱、双身份审核、出证选择、公证处真实出证转案及运营不出证退货归档已验证                                                     | 本行已确认切片动作无剩余；不包含支付结算与生产上线                                                             | CORE-NT-005／006                 | [NT-005／006固定候选](spec/v0.1/VALIDATION.md)分别证明正常出证生成待匹配案件与不出证退货归档，刷新和重登后均可追溯。                                                                    |
| 17   | 案件创建、当事人和承办关系     | 🟡 CA-001已验收          | 案件身份、来源、负责人、被告、主办律师与内部列表／详情已验证；本部门可读／下载、获权负责人可办理                                                 | 外部转入／历史补录须独立入口Slice，在案件模块完成验收前交付；律师更换后置                                      | CORE-CA-001                      | 公证转案生成稳定案件身份；“我负责／本部门全部”与阶段计数一致，他人案件只读可下载、跨部门不可见，撤权下一请求生效且不改写历史。                                                          |
| 18   | 案件正常前段流程               | 🟡 CA-001～006验收已完成 | 匹配、起诉材料提交、诉状确认、客户邮寄、法院提交和正式受理已验收；正常后段至业务归档已按能力19验收                                               | 本行前段无剩余动作；正常后段见19，独立历史／外部来源仍另排                                                     | CORE-NT-005；最小材料能力        | 每个状态转换单独通过真实UI验收；缺材料、重复提交、越权、跳级和旧版本被拒绝，刷新显示当前阶段与完整历史。                                                                                |
| 19   | 审理、执行、结案与归档         | 🔴 局部阻塞              | 判决、二审／同案重审、执行结束、结案资料及业务归档正常动作已验收并集成；实际收付和结清尚未实现                                                   | CA-013～017正常来源已交付；历史补录／外部转入、重开及真实资金仍独立后置；B13／B15其余范围保留                  | CORE-CA-010；B13／B15按需        | 从待判决按已批准路径逐Slice完成审理、执行、结案和归档；财务未完成不冒充已结算，非法回退、越权和缺件被拒绝。                                                                             |
| 20   | 案件合并办理组                 | 🔵 已设计待开发          | 同客户、保留源案归属、聚合查看和可解除的方向已确认                                                                                               | 组模型、并发与批量契约、权限、UI/API 和跨材料／费用投影测试                                                    | 17                               | 测试／验收环境真实 UI：明确选择源案建立组→聚合查看但不复制案件／材料／费用→解除后源案完整保留→并发与越权操作被拒绝并审计。                                                              |
| 21   | 证物与公证书保管               | 🔴 阻塞                  | 稳定身份、来源、多本明确对象、空台账和附件生命周期方向已确认                                                                                     | 实物粒度、入库／签收／移交／销毁、公证书纸质状态规则及 E02 材料实现                                            | 09、16、17；E02及对应 BQ         | 测试／验收环境真实 UI：登记真实来源对象→入库／移交到明确对象→刷新后位置和历史正确→合法空台账保持空；销毁不等于删库，越权与跨案操作失败。                                                |
| 22   | 业务日历与就地提醒             | 🟡 真实来源已验收        | SD-53真实一二审开庭与协议到期日历已本地验收；提醒不替代阶段的原则已确认                                                                          | 缴费／其他来源、手工事件、推进后更正、提醒接收范围、调度／补扫                                                 | 17、18                           | 测试／验收环境真实 UI：案件日期生成来源明确的事件→改期／清空只更新对应事件→刷新和补扫无重复→转派后未完成提醒随责任人变化；不猜不存在的期限。                                            |
| 23   | 原始费用、退款与办理状态       | 🔴 阻塞                  | 稳定费用身份、已知／待定、非负方向、0 元不发指令、累计退款上限和已处理保护已确认                                                                 | 费用类别、收付方、更正／冲销、完整状态；外部提交和回执依 E03                                                   | 17；E03及对应 BQ                 | 测试／验收环境真实 UI：登记原始费用→保存／刷新→发起或退款→重试不重复且累计退款不超原支出→已处理原事实不可覆盖；外部未知结果不伪装成功。                                                 |
| 24   | 结算、账单、发票与实际结果     | 🟡 人工台账已验收        | SD-47客户真实人工结算台账及SD-53页面接线已本地验收；完整财务账单仍属其他范围                                                                     | 客户人工事实台账不依赖公式／外推；完整财务公式、分次／撤销／外部回执仍待后续确认                               | 09、13、19、23；E02/E03及对应 BQ | 测试／验收环境真实 UI：按批准条件形成结算→发起账单→正确律师上传发票→登记实际结果→三个页面口径一致；0／待定不发起，撤权、重复和部分失败正确处理。                                        |
| 25   | 报表与受权导出                 | 🔵 已设计待开发          | 已归档案件平均标的额和客户仅见本企业范围的方向已确认                                                                                             | 其他指标、时间／空值／舍入口径、导出权限、快照版本和页面                                                       | 19、23、24                       | 测试／验收环境真实 UI：选择范围查看指标→导出同口径快照→刷新实时值不改历史文件→撤权后不可领取；空集、部门和企业范围不泄漏。                                                              |
| 26   | OCR／爬虫候选与导入辅助        | 🔴 条件未齐              | 核心设计已要求表单、OCR和爬虫最终复用领域Command，并保留幂等意图、创建渠道和可选外部来源标识                                                     | OCR／爬虫候选暂存、批次失败模式、重复检查、人工确认、供应商／协议／预算／数据许可；案件导入另走历史补录Command | 09、对应CORE Slice；E04按需      | OCR／爬虫只生成候选，人工确认后调用正式Command；不得直接写业务表或推进状态。重复输入不重复创建，失败不污染正式数据，历史案件导入不绕过阶段。                                            |
| 27   | 外部角色入口与系统集成         | 🟡 最小客户端已运行      | CORE-LD-002已交付真实企业客户账号、密码会话、企业绑定和待审核线索只读入口；CORE-LD-003／004已交付客户侵权确认与不侵权归档动作及企业隔离证据      | CORE-LD-007已完成撤回纠错；完整客户端、公证处端、律师端及外部系统协议仍按首次业务动作分批实现                  | 07、对应CORE Slice；E01/E03按需  | 每类真实身份只能看和办理获准企业／事项／案件；撤权或委托结束下一请求生效；完整门户及系统间重复、失败和恢复在对应Slice验收。                                                             |

## 影响开发顺序的架构与数据模型问题

- Team前置已收口：`DepartmentMembership`、`RoleAssignment`和`Customer`的非空`teamId`现在通过组合外键引用同部门Team；停用保留历史且禁止新增／恢复绑定。当前Slice无需再以裸UUID或人工改库表达团队。
- 管理授权前置已收口：服务端已有人员／Team／角色Action和逐Grant授予上限；首位管理员身份、角色名称及前端菜单均不构成授权。独立`ROLE_MANAGE`及角色模板Grant编辑已完成。
- `CustomerProfileStatus`已通过前向迁移增加`ADMITTED`；最小真实材料、准入Command、历史审计及绕过DTO的CHECK负向验证已收口。生产E02联调仍是发布前置，不否定本地／测试内部闭环。
- 权限范围内核已在客户／权利主体和CORE-LD-001线索／材料路径有运行证据；未来每个案件、公证、费用、报表 Slice 仍要增加自己的动作与数据库范围测试，不能把现有通过泛化为全系统通过。
- 案件读取／办理范围已由[SD-39](spec/v0.1/DECISIONS.md)和[REQ-CA-010](spec/v0.1/modules/cases.md)收口；后续案件Slice直接引用，不另建平行设计文档。

前两项已经完成；客户准入和各业务域授权证据由对应CORE切片按实际动作补齐，不再单独扩成主线前置平台。

- 当前已有CORE-LD-001～004、007所需的材料、线索、企业客户账号绑定、推送事实、客户决定和撤回历史；公证、案件、费用或结算模型仍按本路线图逐Slice建模和迁移，不预建大而全的空模型。

上述边界不改变CORE-LD-001已完成的收口范围；已收口的团队、授权和模块边界继续作为后续实现契约。

## 发布能力（不计入业务 Slice 数量）

生产环境、托管 CI、监控、备份恢复、密钥注入和发布回滚尚未就绪。它们不阻断当前本地／测试环境继续开发无外部依赖的 Slice，但在任何功能宣称“生产可用”前必须独立完成 OPS-01 和 CI-01，并在目标环境执行迁移、备份恢复和回滚演练。

## 当前看似存在但尚未形成闭环的能力

- **权限管理**：人员、Team、角色分配、角色模板复制与Grant编辑已形成闭环；后续只随业务Slice增加固定Action，不继续横向建设权限平台。
- **客户管理**：001～008组合已验收并集成main，包含草稿／准入、搜索／状态筛选、受控生命周期、合作状态、负责运营转派、多联系人、真实权利资产、协议／开票资料及真实人工结算台账；完整verify和PG/Chromium293/293通过，独立人工入口已验证。客户分支已推送并快进集成main至b719857。
- **联系人管理**：Customer聚合内多联系人维护已本地验收：最多一位主要、可不指定，结束关系保留历史，准入显式选择活动联系人并冻结快照；联系人不自动获得登录权限。
- **权利主体管理**：仅支持新建、查看和关联；编辑、删除、解除关联和默认主体均未实现。
- **材料／文件**：CORE-LD-001已有本地／测试私有适配、材料／内容版本／引用表、上传／下载／删除／恢复 API和客户／线索页面入口；生产对象存储及完整通用文件中心未完成。
- **线索**：CORE-LD-001～007已完成运营手工录入、原子推送、真实客户审核、不侵权归档与撤回、运营不取证归档及确认取证移交；后续公证办理另属CORE-NT。
- **案件、公证、费用、结算、日历和报表**：公证正常来源办理及案件CA001～017状态动作已实际验收并集成；UI002八栏／三页签只读工作页已验收。客户人工结算台账及真实来源日历已有各自验证；案件实际收付／结清、完整结算中心、证物管理及数据报表仍未形成完整正式闭环。
- **四端与外部集成**：已有CORE-LD-002最小真实客户端入口和企业身份绑定；完整客户端、公证处端、律师端及外部集成协议仍未实现。

## 文档状态冲突与同步结果

本次审计以代码、Prisma、路由、模块注册和自动化测试为准，并同步修正了以下会误导后续开发的当前态结论：

- `README.md` 不再只写连接检查，现已列出认证和客户正式能力并链接本路线图。
- `docs/spec/v0.1/READINESS.md` 已将认证改为内部集成，并移除竞争性的“下一步”队列。
- `docs/spec/v0.1/TECHNICAL-DESIGN.md`、跨模块／客户／设置 Spec 和认证设计页已同步认证及权利主体的实际实现状态。
- `docs/deferred-design.md` 已把认证第一切片从“等待实施”更新为已内部集成，并保留人员管理、OIDC／MFA等真实剩余项。
- `docs/project-status.md` 的历史验证段落保留了当时“待复审”的阶段事实；其“当前任务／未决／下一步”才表达最新状态。

维护时不要删除历史验证叙述，但必须修正当前态入口。后续顺序只在本文件维护；`READINESS` 负责准入条件，不再维护另一份竞争性的“下一步队列”。

## 维护规则

1. 开始业务 Slice 时，在顶部只设置一个 `Current Slice`；完成或暂停后同步状态、证据和唯一 `Next Slice`。
2. 只有 UI、API、后端、数据库、权限和关键测试全链路齐备，并在测试／验收环境由真实 UI 完成业务链路后，才改为 `✅`。
3. 代码完成但缺数据库 E2E、权限负向或部署验收时保持 `🟡`；只有设计时保持 `🔵`；局部外部依赖只把对应行标为 `🔴`。
4. 路线图不复制 Spec 字段和状态机。业务范围变化先更新 Spec／Decision，再调整本表顺序和完成标准。
5. 每次状态变化必须链接实现、迁移、测试或验证记录；不能用 Demo、Mock、页面截图或文档自述作为完成证据。
6. 新增未来能力前先确认它来自现有 Spec、Decision 或用户批准；不得为了填满路线图扩大产品范围。

### UI后续一致性约束（非本批完成）

案件UI002、CE001及二审补缺CE002已完成验收；以下仍未完成，放在各相关模块功能交付前验收，不另扩全站重构计划：

- 客户等其他详情的真正一级页签／二级内容子页、主／次／危险／禁用按钮语义及布局按各自模块冻结边界核对；不以锚点代替内容子页，不用客户截图猜案件未展示布局。
- 字段／展示对齐真实Spec／Demo，逐项核未知／null、事实来源和实际权限；相关模块交付前复核，不以假业务或新按钮代替正式能力。CA018仍暂停。
