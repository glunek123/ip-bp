# CORE-UI-002 案件工作页、八栏折叠与紧凑密度合同

状态：2026-10-14内部案件三页签／八栏、字段值布局、内容分组与真实抽屉操作已完成组合验收，独立累计Spec／Quality ACCEPTED、C/I/M0；固定候选及实际验证边界见VALIDATION。持久预览已保全数据同步；应用交付main／任务分支已于09:22 UTC实核bac9a26；末次仅补实际回执及快照。普通联系方式编辑及受理信息受控更正仍是后续缺口，不能把本合同的合法编辑入口称每栏全部字段可修改。基线main696fad75，I复用ca015-integration；业务流程和授权仍以案件Living Spec及既有Command为准。

## 范围与证据

- 本批优先于CA018；CA018只完成SD-23／现有源码只读核对，无合同冻结、正式修改或实现派发。CA001～017、14列摘要、N1／N2、内部／客户分页均已交付，不重复开发。
- 用户只要求：案件工作页三个子页及标题操作；八栏默认折叠、编辑入口和文字层级；收紧padding与留白。先落实内部 `/cases/:id`；律师／客户／公证页不扩大投影或重设计，只验既有行为兼容。
- Demo原始路径 `D:/工作项目/品维and知产/dev_cor/demo`，已读DESIGN、`index.html`三个tabs与timeline、`app.js`的renderCaseDetail、renderCollapsePanels、editCard、openTimelineAdd。父级已核两张截图：返回箭头、标题／灰色摘要、右侧真实阶段及示例动作、紫色tab下划线、当时七栏白底浅边框；其后用户要求增设第七位只读结案栏形成八栏。截图只证明折叠外观，没有证明内部编辑字段或费用功能。
- 当前Edge的file://Demo读取被浏览器协议安全策略拒绝，未点击／改值，未绕过。此处真实行为核对来自本地源码；不是已完成实际浏览器操作。Demo部分执行／结案栏默认展开，与本次用户全部默认收起要求不同，以用户要求为准。
- Demo可直接换阶段、改数组、播种材料、填今天及生成模拟时间轴；正式系统不采用这些行为。Demo保全／删除／执行更新是阶段示例，不能新增无授权或未实现的正式操作。

## 工作页与状态

1. 保留同一真实caseId及案件读取上下文。标题使用现有真实businessNo，不发明不存在的案件标题字段；辅助行显示法院案号（未知“未登记”）、客户及真实阶段。左侧返回保留合法list `view/page/stage/stageGroup`，剔除工作页tab和跨模块参数，继续遵守N2原子stage优先规则。
2. 三页签按“案件详情／文件管理／费用管理”排列；默认details，URL只增 `tab=details|files|fees`，省略即details，非法值规范回details。既有list query保持原语义，不改后端过滤；切tab不提交命令、不刷新编号、不改阶段。
3. 页签键盘ArrowLeft／Right／Home／End和Tab可用，role=tablist/tab/tabpanel、aria-selected/controls准确；当前tab紫色下划线。桌面横排，小屏可横滚，整页不得横向溢出。
4. 首次进入本案／切案／身份或授权修订变化时八栏全关闭；同案详情数据refresh/re-fetch保留展开选择；浏览器整页reload按首次进入全关闭。八栏固定顺序：案件信息、线索信息、一审信息、二审信息、判决信息、执行信息、结案信息、流程时间轴。结案／归档事实集中在第七栏，结案信息只读且不显示编辑图标。
5. 资料正文只读呈现，编辑在同案drawer中复用既有表单和回调。折叠与tab切换使用保留实例的显示控制，不因v-if销毁未知结果的宿主或丢掉原body/key；不得复制一份表单或新增后台自动POST。关抽屉不等于成功或重置未知意图，重开同案能按既有规则显式重试。切案／失权清除旧敏感投影和操作入口，迟到响应不得覆盖新案。
6. 标题右侧状态＋本阶段已有合法动作，主操作最多一个，其他真实登记／更正置“更多操作”。只按服务端can*、真实阶段／来源锚和既有表单能力选择；读权限不变成写权限。取消、只读、越权时无写请求。保全、删除、重开、任意改阶段、支付等无已实现Command的动作不出现可用按钮。

## 八栏内容与编辑映射

| 栏         | 真实来源与只读内容                                                                                            | 可复用入口与限制                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 案件信息   | CaseDetail的部门、客户、权利主体、负责人、被告、当前律师、匹配真实日期、真实案号；归档日期／类型／原因摘要    | 适用时匹配当事人与承办律师；显式沿原动作提交，匹配／归档有阶段影响，不能伪装普通“保存字段”。编号、客户／权利主体关联、阶段、负责人等缺少现有安全编辑Command的字段只读   |
| 线索信息   | CaseDetail授权的来源编号；额外字段只能从真实sourceLead.id的既有getLead读取，403不伪装空态且不影响案件自身可读 | 只有来源Lead的capabilities.edit真实为true才进入既有LeadEditPage；状态／权限保护仍由来源后端执行。无来源读／编辑权限或已保护字段时明确只读，不写Case副本、不复活冻结资料 |
| 一审信息   | 诉状提交／确认／邮寄、法院提交、正式立案、各轮实际受理及开庭／更正历史                                        | 复用起诉材料、确认、邮寄、立案、正式立案、开庭登记／更正面板；受理日期、案号等没有对应更正Command的事实不能通用覆盖                                                     |
| 二审信息   | secondInstance中真实各轮资料／结果／撤销                                                                      | 复用canSaveSecondInstance／canRegisterSecondInstanceResult／canRevokeSecondInstanceResult；撤销是原受控动作，不自动撤销再保存或改原历史                                 |
| 判决信息   | 当前有效judgment、历史和后续选择／撤销，精确文件版                                                            | 复用判决登记／带原因更正、后续选择／撤销；没有当前事实时不造判决或金额                                                                                                  |
| 执行信息   | 执行材料、确认／邮寄／申请立案提交、结束及精确历史                                                            | 复用现有执行提交／确认／邮寄／立案／结束；不增加Demo式自由“执行更新”或改旧冻结文书                                                                                      |
| 结案信息   | CA016真实日期／金额／精确材料及更正历史、CA017归档版本；未知日期、待确认与零值保持区别                        | 只读，无编辑图标；既有结案／归档办理沿标题的受权原命令进入，不将归档推算为财务结清                                                                                      |
| 流程时间轴 | 只从当前CaseDetail可读的真实创建、匹配及各模块事实／历史派生视图                                              | 查看完整已返回记录；“登记／更正”只打开已有且本案可办理的Command。没有通用手工记录后端，本批不伪造“添加记录”保存，不编辑／删除既有审计                                   |

前六栏右侧统一编辑入口：有该栏合法命令时打开同案编辑drawer／具体命令选择；无命令则禁用并给出就地只读原因。点击编辑不同时触发折叠。时间轴右侧为“登记／更正”及“查看记录”，不把不可变事件叫可任意编辑字段。所有既有原因、CAS、幂等键、材料校验、服务端范围、实际审计及工作流通知维持原合同；本批不声称已支持全部Demo字段任意编辑。上述缺口需要后续独立Command，不能由前端临时造PUT或补权限。

## 文件、费用及时间轴的真实边界

- 文件页汇总CaseDetail已授权的公证／披露、诉状／授权、邮寄／立案／受理、裁判／二审、执行及结案的精确文件版，可补当前CASE上传池的既有listOwnerMaterials。按materialId＋contentVersionId去重，保留来源／历史类别；下载必须用精确版本，不悄悄换currentVersion。sourceNotary等跨资源文件只用CaseDetail已给出的可读引用，不查询整客户／公证全库。
- 文件页本批提供真实列表、版本／来源及下载；上传进入已有对应阶段表单。无后端能力／权限的通用上传、替换、删除／恢复／批量导出不造按钮。案件读取403／404时清除本案敏感投影；单文件403／404只移除该失效文件并提示，不清空其他仍受权文件，不把失败当“无文件”；所有加载按caseId＋contextKey隔离并取消迟到请求。
- 费用页显示CaseDetail.fees的真实来源费用，及本案现有诉状／判决／结案金额事实，标明来源与KNOWN／PENDING／UNRECORDED；不求新财务公式，不用0代未知，不把客户级台账当案件实收，不从归档类型或备注算结清。无案件收付明细时明确尚未登记；无发起／保存／结算按钮。客户CustomerSettlementsPanel的资源粒度不同，不移植为案件账单。
- 时间轴只投影已给真实时间／记录，业务日与recordedAt分开，旧null业务日仍未记录；排序用已知recordedAt且稳定source种类／id，不用今天补时间。原资源事实及审计未改，视图无重复模拟“系统完成”记录。来源受权字段不足时如实少显示，不补猜测演员或未返回的完整审计。

## 共用Interface与样式合同

A2唯一生成 `case-workspace-contract.ts`：WorkspaceTab为details/files/fees；SectionKey为case-info/lead-info/first-instance/second-instance/judgment/execution/timeline。SectionAction为`{enabled:boolean,label:string,hint:string|null}`，由F2按真实能力提供，呈现组件不推断授权。

- CaseWorkspaceShell props：`businessNo,subtitle,activeTab,contextKey`；emit `update:activeTab`；slots `back,actions,details,files,fees,editors`。slots实例保留，Shell不读取／写入业务数据。
- CaseWorkspaceSection props：`sectionKey,title,contextKey,action:SectionAction,actionLabel?`；默认关闭，emit `edit(sectionKey)`；slots `default,tools`，独立可访问的展开与编辑按钮。contextKey变化重置展开；不得嵌套button。
- CaseDetailsSections props：`item:CaseDetail,lead:LeadDetail|null,leadState:idle|loading|ready|denied|failed,actions:Record<SectionKey,SectionAction>,contextKey`；emit `edit(sectionKey),view-timeline`。只读模型函数在R2的case-workspace-read-model.ts，直接依已存在类型，不添API字段、any或开放索引。F2持有Lead请求，R2不调用API。
- CaseWorkspaceFiles props：`item:CaseDetail,contextKey,listCaseMaterials,downloadVersion`，listCaseMaterials为`(caseId:string,options?:RequestOptions)=>Promise<{items:OwnerMaterial[];total:number}>`，downloadVersion为`(materialId:string,contentVersionId:string,signal?:AbortSignal)=>Promise<void>`，分别适配现有listOwnerMaterials与downloadMaterialVersion，不新造存储；emit `open-upload`只请求F2打开本阶段已有编辑动作。CaseWorkspaceFees props：`item:CaseDetail`，只读无写事件。
- F2持有Case读取、上下文revision、原各Command回调与unknown session。workspace contextKey明确为caseId＋既有identity（principalType/user/department/authorizationRevision），不能直接传不含caseId的旧identity；原命令的context/actorKey及API会话语义保持。A2／R2／M2／D2不得修改这些控制器、API或授权逻辑。I独占router，只给内部cases/:id增加meta.caseWorkspace=true与tab白名单；返回过滤延续N2。

D2唯一密度CSS，统一前缀case-workspace：header/title/subtitle/tabs/tab/section、section__header/section__body、fields、field__label/field__value/field__help、files/fees/timeline/editors。AppShell只加app-content--case-workspace类并由route.meta.caseWorkspace===true触发；不改其他模块侧栏、登录、全局table或颜色体系。

目标：外层desktop padding16px／tablet12px／mobile10px；八栏间隔8px，header padding8px 12px、最小44px，正文12px；正文13px/1.5、label12px muted、value13px ink、分组14px/600、标题22px/650、辅助12px muted。保留hairline和现有紫色强调。移除本页page-view--narrow的过窄居中，使用可用主区，宽屏max1440px，小屏单列。金额／日期适度等宽，不将全页加粗；移动交互目标最小44px，drawer滚动和文本折行正常。以上只收紧本案件工作页及其抽屉，本批不重设计全站。

## 独占任务与派发依赖

| Task／模型 | 唯一允许文件（均frontend/src下）                                                                                                                                  | 禁止／依赖                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A2／Luna   | modules/cases/case-workspace-contract.ts；CaseWorkspaceShell.vue/.spec.ts；CaseWorkspaceSection.vue/.spec.ts                                                      | 只呈现骨架、tab／折叠语义；先交公共Interface固定commit，不写CaseDetail、API、CSS或业务状态                      |
| R2／Luna   | modules/cases/CaseDetailsSections.vue/.spec.ts；case-workspace-read-model.ts/.spec.ts                                                                             | 真实八栏及timeline投影，依A2类型；不请求API、不写表单／金额事实或公共CSS                                        |
| M2／Luna   | modules/cases/CaseWorkspaceFiles.vue/.spec.ts；CaseWorkspaceFees.vue/.spec.ts                                                                                     | 材料callback、真实费用投影，依A2类型；不写CaseDetail、API或客户台账                                             |
| D2／Luna   | styles/case-workspace.css；main.ts（只该CSS import）；app/AppShell.vue（只密度class）                                                                             | 依冻结类名，可独立实施；不改router／导航语义／API／全局业务样式                                                 |
| F2／Luna   | modules/cases/CaseDetailPage.vue；CaseWorkspaceIntegration.spec.ts；CasePages.spec.ts；CaseArchiveDetailIntegration.spec.ts；CaseClosureDetailIntegration.spec.ts | 唯一宿主接线作者，依A2/R2/M2固定提交；只复用原面板与API，LeadEditPage复用原路由，禁止改共享API／后端／Panel代码 |

I唯一持有router.ts、router.spec.ts、AppShell.spec.ts的必要meta／只读导航兼容、所有tests/e2e与必要source fixture、docs/context。CaseDetail和既有页面集成测试只由F2写，避免多个Task改同宿主。A2接口提交后R2/M2可并行，D2独立；F2在其固定版本接纳后接线。每个Task可以核源码／直接测试，只修改表中完整路径；清单外先报I裁定。旧CA017 refs及干净目录保留，派发后才从同一冻结SHA复用对应目录；本轮准备不启动实现Worker或安装依赖。

## 验收与交付区分

- Worker直接单测／类型／Lint／格式，不把缺依赖组件时的替身通过称组合通过。I先接纳固定依赖，独立审查关闭finding，再在稳定组合执行适用门禁；宿主涉及原流程命令、unknown session及跨资源Lead编辑入口，最终新组合采用Level3。一次完整verify与必要隔离PG／Chromium，不默认跑全量数据库E2E或再叠邻接重复Slice。
- 正常密码运营进入真实待匹配／审理／执行／待归档／已归档案件：三个tab、八栏全关闭、真实字段／空状态，header仅正确已有动作；展开／关闭互不干扰，编辑不改变只读派生字段，已实现登记／原因更正保存后刷新／重登保持真实新版本和历史，取消无写入。
- 切tab／关闭drawer／SPA返回后保留同案未知原body/key，明确重试；失权、切案、迟到回复和只读同部门账号不漏前案，不自动提交。非法阶段／历史修改／越权仍由既有后端拒绝；范围不拼接。
- 文件页正常查看各期精确版本、下载实际bytes，未登记为空／403失权／500错误区分；费用KNOWN0、PENDING、UNRECORDED保持语义，归档不变已结清。来源Lead权限／冻结字段不可写，没有编辑能力的字段说明实际限制。
- N2、我负责／部门、原子／组filter、21条分页和详情返回不退化；lawyer/client最小投影兼容。1440×900、1024×768、390×844截图实际读图；默认八栏、紧凑间距、字体层级、键盘／drawer及页面无横溢出。依据父级截图做实际对照，不称本次已在Demo file页实操。
- 原准备审查及文档专项只代表当时可派发；当前UI002已在648faa1同干净候选完成14项组合验收，持久预览已保全升级146并同步抽屉样式。原正常账号、2案、6凭据、124业务／授权表、配置和材料已实际只读核验；保持备份校验及原数据保全，不重置密码、不扩真实Grant，隔离验收仍15433。应用交付main／任务分支已于09:22 UTC实核bac9a26；末次仅补实际回执及快照，原准备阶段3f／144暂缓状态不再代表当前现场。

## 编辑完整度核对与最小补缺建议（2026-10-14，未冻结／实施）

现场case-read.controller.ts与lawyer-case.controller.ts只有具名办理／更正命令，没有案件整体PATCH／PUT或通用资料保存。case-match.service.ts:120仅允许PENDING_MATCH，一次创建被告并匹配；不能用于已匹配案件修改电话、地址或重新分派。来源线索已有getLead／updateLead／LeadEditPage，但必须即时capabilities.edit成立，不能凭案件读取权限或“编辑”按钮绕过来源状态保护。因此本批八栏展示＋已有表单入口，只能称已有办理字段可登记／受控更正，不能称每栏所有字段均可直接修改。

F2应完整接入已有合法表单：匹配、起诉提交／确认／邮寄、立案、受理登记／补材、开庭登记／更正、二审资料／结果／撤销、判决／后续选择、执行办理、结案与归档登记／更正。来源编辑按其真实能力使用原入口；没有命令的字段明确只读，不把其他阶段办理、归档或更正当基础字段“保存”。时间轴查看真实记录及进入既有登记／更正，不改历史；文件和费用页不出现伪造的保存或收付功能。

最小后续建议首先补一个基础资料受控补正闭环：首批只处理稳定被告ID下的联系电话／地址，明确当前资料与原匹配／文书冻结快照的区别；服务端范围、独立资料版本冲突及自动审计必须真实；联系电话／地址普通保存不强制原因，受理日期／案号更正另填原因，兼容既有Case业务版本和归档锚，不直接改原回执或冻结事实。编号、来源关系、部门／负责人／承办更换、被告身份等不并入普通保存。此建议只补常见档案修改缺口，尚非批准字段合同；若要求已登记受理日期／法院案号也能编辑，还缺独立正式立案受控更正，必须先明确后续事实的保护规则。已冻结来源线索的字段亦不能由案件页代存。只有这些新增闭环验收后才能扩大“可修改该栏字段”的完成声明；当前不新增Task编号、迁移、权限或长期实施计划。

## 本轮字段值布局与恢复修复补充（2026-10-14）

用户实图明确要求描述列表而非表头数据表：八栏真实资料采用固定标签宽度、字段值对齐，桌面每行三组、窄屏二／一组；灰色标签、深色值、淡水平线，无竖线或灰底标签格。地址、材料文件、备注、原因及长值独占行并自然换行。判决登记的收到日期、判决金额、已缴诉讼费作为前三项同行，保留PENDING与KNOWN零；文件独立行，历史登记／更正可折叠，时间轴保持真实记录顺序。只读提示次要而保留完整原因，不从Demo补不存在的字段或开放编辑权限。I持有此R2／CSS及实际展开截图补充，不改业务API。

SPA修复独占范围由I按实际故障扩展到App/router、CaseDetailPage、旧Case*Panel及Files与直接测试；身份／部门／authorizationRevision变化清整个案件缓存，每案按caseId保留同会话组件与原意图。离页取消后续请求链、隐藏Teleport并隔离迟到结果；返回先getCase复验，403／404清空，成功后才恢复读取。GET前进不推定原请求成功，详情中的原表单入口重开同实例后只允许用户显式沿原body/key重试。header保留当前可办理动作，不把已过阶段的旧表单当新动作。此缓存随本会话访问案数增长，reload不保证匹配／起诉等非既有session意图恢复；原finish／closure／archive与既有session存储仍按其独立约定。没有新增后台推进、越权授权或直接改阶段。

## 已授权编辑缺口的数据来源核对（未实施）

用户本轮要求的最小交互为原栏带出当前值、保存／取消；电话和地址普通保存，不强制更正原因；受理日期／法院案号修改加一句原因，不另设审批。自动保留谁、何时、前后值，后端权限与版本冲突检查，当前展示更新但阶段不倒退、不改生成文书。该诉求在本轮UI交付后优先补齐，不被CA018排期覆盖；尚未形成新接口或数据库事实。

电话／地址来自稳定CaseDefendant及case-read投影，不能误改客户／律师主档或被告主体身份。一审CaseAcceptance有acceptedAt／courtCaseNo，并绑定精确冻结附件、审计、回执及trialRound；20261006011000迁移禁止原记录／版本／回执UPDATE或DELETE，现前端还校验Case案号与原Acceptance一致。因此受理更正须独立追加更正投影，明确原事实与当前显示，不直写原Acceptance或单独覆盖Case.courtCaseNo。日期更正要核既有立案／开庭等后续事实约束；不能靠倒退阶段或重写原文书解决。

CaseSecondInstanceProgress目前只有hearingAt／hearingPlace／judgeName及资料、结果链，没有独立二审acceptedAt／courtCaseNo；现Case案号仍来自所指Acceptance，发回子轮还会清原当前锚。因此二审受理日期／案号要补本轮次独立登记／更正投影，不能把开庭日当受理日或覆盖一审案号。这是源码可行性结论，不是已完成能力或已冻结新字段合同；具体最小实现应以这些事实边界收口。

## 2026-10-14 八栏生命周期补充

后续用户要求替代原七栏约定：新增独立只读结案信息，归档后八栏仍能查阅全部已返回事实。初审与发回重审按真实trialRoundId关联；判决栏包括各轮一审判决及二审结果／撤销。执行申请提交日期不冒充正式执行立案日期。来源截图仅显示已受权读取的版本引用，未读取图片不称已核对。第一审开庭地点／法官／预缴、二审独立受理日期／案号、正式执行案号／日期、实物纸证与财务结清缺少独立来源，明确待接入。此补充不新增后台字段、权限、可写命令或财务计算。

旧候选ed767d1的完整verify只属于当时七栏版本；新八栏候选单独记录验证证据。

## 后续视觉反馈落实边界

案件仍保留已确认三页签与八栏折叠。每栏内多组资料使用真正分组切换，一次只显示所选组，刷新保持选择、身份变化清空，不是仅滚动锚点；历史折叠与真实原命令保留。卡片采用独立边框、浅色标题带及清楚间距；主办理按钮主题色，次入口描边，危险动作使用既有danger语义，禁用灰且理由可读。时间轴独立滚动及查看记录抽屉，不把全部表单堆在页面末端。

用户后续截图是客户详情一级基本信息／权利资产／结算记录与二级客户资料／联系人／权利人／身份材料／企业账号／办理历史导航，仅证明导航；不推断未显示的卡片布局。客户等其他详情一致性在本批交付后按统一路线图推进，不把当前案件交付称全系统改版。

### 2026-10-14“当前”语义及技术标识展示澄清

用户要求全前端盘查，普通身份／权限／范围／资料版本等明确语义的“当前”保留。案件业务当前阶段必须来自真实item.stage，不由选中分组或各类事实.current推断；事件组最新有效记录只用实际动作名称，历史版本保留历史区分，分组选择用aria-pressed和样式。二审currentTrialRoundId表示真实审理轮次，与业务阶段不同；依用户最后明确要求，轮次名称不增加“本轮”等替代后缀；动作成功提示描述完成时结果，不把回执阶段当以后任何时刻的当前阶段。

审理轮次显示初次一审／真实发回重审轮次，未匹配明确标示，不默认初审；精确轮次、记录和文件版本ID保留在可主动展开的关联／版本详情中。文件普通视图使用真实文件名，API未提供人类版次时不编造第几版。缺失日期、案号、金额保持未知／未提供语义，资料说明作为次要可展开信息，不用开发实现限制占据正文。无API／权限／状态机或资金规则改变；新实际验证由VALIDATION后续记录。
