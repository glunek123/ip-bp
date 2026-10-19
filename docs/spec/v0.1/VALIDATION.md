# SPEC-001 文档验证

## 客户详情二级内容与按钮语义（2026-10-19，离线交付）

用户明确批准原UI任务实施CustomerDetailPage.vue及直接spec、离线测试与独立复审。基线b1a15e937491f4771ddbe8a8c07aacd66d42530f；原作者在customer-detail-secondary-ui树实施，原case-list-query-ui六WIP不动。只读派发最初因授权范围被拒，用户具体批准后同路径唯一重试成功；这次后续实施另有明确批准，不将其当CSV动作或数据库额度。

范围为基本信息内真正的二级tabpanel及本页按钮语义，保留原三个一级页签。作者回报原窗口人类选择“合并联系人与权利人（推荐）”，故两组共页且#customer-contacts与#customer-rights-holders均可进入；其余资料、准入身份、账号、协议、开票、历史各清晰可达，合作与负责人维持原页签外常驻。原子Panel挂载条件、草稿、权限、pending／unknown／stale、身份与迟到响应隔离保持；不增请求、业务入口或公共CSS，不改API／后端／业务保存规则。

作者基线28/28；新增布局与hash两个聚焦回归先红，首候选整页29/29，前端vue-tsc、两文件Lint／Prettier及diff检查exit0。原失败与实际命令输出由主控从原Task工具记录保存至`.local/customer-detail-secondary/author-tool-validation.json`，作者没有另存raw日志，不虚构其日志路径。首候选两份raw为d009eb36f6f1069b1037569313e0a9563bc4147368c573fd855c0754512a1c11／e4284956c4c3a3795408e59aacbabd0603414a6836269a7acba28594837c2efc。

原独立Sol窗口首次按精确两hash只读复审，Spec／Quality均为C0/I0/M1，未标ACCEPTED：M-01为同一客户先切外层资产、再进联系人hash时，外层基本信息未同步可见。原报告已留`.local/customer-detail-secondary/review-initial.md`，交原作者仅两文件补回归与修复；新增真实router用例先红、修后整页30/30，前端类型及两文件静态exit0。修复后两raw为a57029d32ae4ac094102d2d9b90163742c168291a2336eb02040d0b4808b172f／d09826573d40bfb2514507167bad6793c100ea00ab50f1af1e7c403673c1c732，原29断言保留；已知hash从资产／结算回基本，未知hash及延迟内部导航不覆盖后来一级选择。实际命令／红绿保留在author-m01-validation.json，原窗口已按这两新raw补审关闭M-01，Spec／Quality均ACCEPTED、C/I/M0；只读审查未重跑测试，原结论保存在review-accepted.md。

主控固定clean候选`90bc74d6d753e19032aee3b8c6b883c8b90af70e`／tree`d35e4e5304d09600ec34d16fbe4263c50d319927`后，实际执行下列显式离线切片；与基线累计仅两份源码、四份必要说明及对应快照，不混公证、CSV或环境配置。普通页面导航变更不改变后端授权／数据契约，本轮不调用含数据库E2E的整模块customer scope，也不将局部检查冒称完整verify。

| 检查                                                                                       | 实际结果与边界                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 11份显式客户组件（详情、编辑、联系人、合作、协议、开票、权利主体、准入、账号、资产、结算） | 183/183，failed0、pending0；Vitest JSON的testResults实际11文件，numTotalTestSuites22包含describe层，不能写成22文件 |
| pnpm check:fast:prepared                                                                   | exit0：架构18模块／166模型、前后端prepared类型及根类型、全仓缓存Lint；未生成或连接数据库                           |
| 两源＋四文档＋快照Prettier、spec:check、context:check:strict、git diff --check             | 全exit0；Spec59REQ／69AC／11BQ／60SD，context1340文本                                                              |

运行时按项目入口核Node24.21.0／pnpm11.27.0，原始日志、11文件JSON及逐步退出码在`.local/customer-detail-secondary/`的customer-components.json、final-gates.json及同名log；实际起止时间使用UTC明确标注。测试前后HEAD及工作区均保持固定，收口后只补记真实结果和对应快照，不称后续文档HEAD重新执行过该集合。未重跑完整verify、NT006、整模块测试或构建，不把作者30项与主控183项简单相加为不同测试总数。

离线源码、独立两轴审查和上述切片已完成；真实页面及整个客户模块仍未由本轮验收。本轮无DB／capture／Docker／HTTP／browser／服务／迁移／Grant／环境操作，不新增或复用已耗真实测试额度，不推送或接入ca015。CSV既有拒绝、公证d8ab与历史数据保护边界不变。

## CORE-CL-001 离线候选收口（2026-10-19，真实验证未执行）

固定源码候选为 `f2551344f2914b3f75b8cfefb8a6521ed7e5975a`／tree `423cb4262632ed530f108c80bf2515455aa88413`，开发树minimal-page-actor-admission。累计29源＝后端17＋API4＋UI6＋兼容纯测试2；不含公证d8ab，也未接入ca015。原任务分别实施，主控只负责合同、哈希接入、定向检查及权威文档。迁移目录20261019120000_case_list_preferences仅编写文本，开发链167；无新Action／Grant／Case事实写入。

### 独立审查与失败保留

原独立Sol窗口 `01a1544b-f5f2-7e21-a2ec-bd9137c05e50` 对固定29源累计Spec／Quality均ACCEPTED，C/I/M0。初审API的M-01（UTF-16长度口径）与UI的I-01（合法空查询转无效URL时旧请求未失效）原REJECTED均保留，修复交原作者、原窗口补审关闭；不把作者自报当关闭。后端19及UI6的阶段结论单列，最终M-01关闭才形成累计通过。Reviewer只读核源／哈希，没有运行测试，不冒真实PG证据。

原API回合13:24:31 UTC后无工具执行，最终明确返回max_output_tokens系统错误；同一原任务／模型缩短指令后完成修复，没有改权限、换路重试CSV或重造作者。原旧测试字节完整保留，精确对照删除／改写0字节，只新增1625字节、1个Vitest测试（内部循环覆盖补充平面及变体选择符的101／200／201边界）。此前325是案件API320＋列偏好5；修后321为案件API单文件，最终组合中两文件326，不能误认删测。

### 实际组合检查与精确复用

| 输入／候选                                                                              | 实际结果                                                                                                                    | 证据与限制                                                                                                                                             |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 8a63c1f842a84e101d5cff8c474827d829e56dd5／tree a9c5e9b4c90707221907e9cdad7111504c4ac5a0 | 正常Prisma validate／generate、后端类型exit0；6个显式Jest套件180/180；2份Node纯测试49/49，全部exit0                         | 795份后端／配置／纯测试输入在f255检查前后逐hash相同，限定复用这些结果，不称f255重新执行后端集合。Nest负例输出500/P2002保留，套件整体通过；没有DB连接。 |
| clean f2551344／tree423cb426                                                            | 11份显式前端文件489/489，failed0、pending0；含案件API321、偏好5，以及页面／解析器／列设置／原办理／Drawer／会话隔离回归     | 标准pnpm入口，JSON逐文件结果保留；不是全前端或完整verify。                                                                                             |
| 同一f255固定源                                                                          | 前端／根类型、18模块／166模型架构、27份源Lint／Prettier、prepared后端及前端双构建均exit0；检查后29源与795复用输入逐hash一致 | 原bundle大于500kB告警保留；没有启动服务、浏览器或NT006。schema／SQL两源不冒Prettier解析通过，schema已实际validate。                                    |
| 旧链兼容纯测试                                                                          | 旧输入34/46（12失败）保留；固定CSV166、EF161、HTTP165自有前缀后49/49                                                        | 新167目录不进入legacyfixture；运行helper／旧SQL原字节不改，默认入口仍拒未批准目录及篡改。没有将这次直接纯测试失败写成完整verify失败。                  |

Node24.21.0／pnpm11.27.0均按项目入口核对。证据在本树`.local/case-list-query-preferences/`：`final-reviewed29-manifest.json`、`final-source-review.md`、`api-test-retention.json`、backend-combination原日志／source-inputs／result、final-combination的frontend-results／checks／lint27／format27／post-source-verification。源码检查时HEAD/tree与收口文档HEAD分开记录；后续只有权威文档／快照变化，不能称文档提交重跑上述业务集合。

### 未运行与保留队列

完整verify（含NT006）、真实PG查询／偏好持久化／授权变化、空链及旧数据迁移升级、实际HTTP／浏览器均未运行，本片没有新增额度。离线源码准备完成，不等于完整Level3或上线验收。下一步只能按[验证准备](../../superpowers/plans/2026-10-19-case-list-query-preferences-validation.md)另给固定目标／账号／数据／有限预算，不复用旧耗尽额度。CSV两次策略拒绝仍BLOCKED，人工脚本未代跑；H42、用户人工事实／文件、公证d8ab和clean ca015均保留。没有capture、Docker、服务启动、迁移执行、Grant变更、部署或推送。历史日期倒序统计缺少可引用后续数量，以及其他详情页总体待验要求，已见[任务对账](../../superpowers/plans/2026-10-19-task-reconciliation.md)，不写未知为0或把本片关闭整个Demo。

2026-10-19 共享 HTTP 会话隔离已在原作者窗口冻结，原独立 CSV 复审窗口核两份 raw 后 Spec/Quality 均 ACCEPTED、C0/I0/M0。仅 http.ts/spec：45e57e0aad986f726c65543d0942d330a6d17ef0a60c545f6f164dbda4e91b91 / d56e4436c70e9291152502efe61bae9bff91f7a66505c61d36c82d362f745795；旧请求401和旧refresh在换人/同用户重登后不污染新会话，代际去重与原请求重试边界保持。作者 RED5→HTTP/auth/store49/49；接入开发组合后 HTTP/auth/store/CSV API/列表页5文件121/121、前端及根类型通过，原定向Lint/格式结果按相同两文件复用。未重复派发已在d3b7关闭的CSV API/宿主修复。EF旧批准换行补丁接入2a5a84fc、21/21纯组件通过；ca015未接。CSV helper新候选 --list 两次均在进程创建前被策略拒绝，仍BLOCKED；[人工步骤](../../superpowers/plans/2026-10-19-csv-discovery-manual-check.md)已核import顶层/7项哈希并仅准备不代跑。无DB、真实HTTP、迁移、浏览器或新验收额度消耗。

2026-10-19人工测试后只读基线续办完成：原runner首次自有查询误用不存在的material_references.ref_count而42703停止，原失败保留；依据真实schema修正后仅续材料小集合/物理字节和后台候选，未重做已完成165表哈希。当前全库快照为88Case、231Lead、96CV；材料续办96CV/110真实引用、377物理文件stream SHA/size及reparse检查完成，281未登记文件原样保留，材料四表与前次完整快照一致并明确两个时间窗口。开庭与材料清理四分支候选均0，H42保持84Grant、role/authrev2；0数据写入、清理、服务停启。续办summary SHA02f080c7600a50cd200b196924ab2c4dd50e5bf55168e458c85b86a25c0af4ee，manifest SHAb275935a2e2d0092dd5377f618fd669832a8fe6740f30cb5f328fb0e083e9d7e，证据在ca015的.local/manual-test/post-manual-baseline-20261019/continuation/。用户手测反馈问题尚未给细节，未记验收通过。后续实际实施另派原API窗口，仅http.ts/http.spec.ts修已登记迟到401与CSRF跨会话竞态；旧leads WIP保留，不改公证39源或运行环境。公证只读准备由独立子任务完成初稿，迁移语义/字面hash表达式勘误单独v2中，未以未冻结POST示意预算申请真实执行。

2026-10-19 CSV owned-schema辅助四文件已在原作者修复后由原窗口补审通过，Spec/Quality ACCEPTED、C0/I0/M0；初审三项Important（URL凭据泄露、回滚覆盖首错、累计预算缺失）均关闭，原REJECTED与红色反例保留。已核四份raw一致并接入，作者15/15纯测试、根类型及定向静态通过；每场景2分钟/整体6分钟、原连接终止和真实PG回滚效果仍须未来有限实库验证。新候选native Playwright --list整条临时配置命令被自动审批blocked by policy且进程未创建，未换入口重试、未借旧发现冒充当前通过；需明确批准原动作后才能补发现。用户已结束人工测试并反馈有问题但细节待提供，本轮不记人工验收PASS；原runner只读重新封存当前数据/材料，全部保留用户变化，不回滚旧snapshot。公证独立只读验收准备另由notary_acceptance_readiness负责，39源不改，未混入CSV或ca015；原可见公证续办窗口因AbsolutePathBuf路由失败未送达。隔离工程方案已提交0443cf7b，仅申请优先复用停止开发容器/独立卷，未启动或创建数据库、凭据及权限。

2026-10-19人工测试账号业务权限已实际补齐并独立读回：原R2/public165、ca015 f6e3a82f和原H42专用角色不变，仅追加42项DEPARTMENT业务Grant，原42项ID/行完整保留，总84；role version与该用户authorization_revision均1→2。其他安全行、凭据、assignment、membership、session保持，未假造管理员业务audit；无服务重启、迁移、自动登录或业务POST。用户需用原账号退出重登；结算中心/证物已有独立路由和导航，缺权限导致入口隐藏，不是尚无页面。新增角色/团队/凭据安全管理权限未开放，权限补齐不代表所有模块已真实验收。提交回执SHA f39c27e07119f29a9f43c0d4f96a4263ae2659bd5f9517e04ee37f7f6ba1a2cc，独立读回SHA 324b300f0fd2f03b53f3912966c86fc0d1a435f5a97d55f4baffe86c8e8bb0a0；普通证据在ca015的.local/manual-test/h42-business-permission-apply-20261019/。开发/人工环境仅代码与构建目录独立：当前人工服务使用R2 15438；主开发配置55432但未运行，不能声称已具备两个同时可写的独立运行库。人工窗口期间只并行离线源码/纯测试，绑定R2的PG/完整verify内NT006/迁移/第二服务仍暂停。CSV owned helper四文件由原后台Task离线实施，未执行SQL；公证未混入当前版本。

2026-10-19原“复审线索CSV原子导入候选”窗口已实际完成固定8533c47abfb2654b515fbaf6d05016e342270398／tree51652a8d764e2ab25d8831aa1042581237f50744补审，Spec与Quality均ACCEPTED、C0/I0/M0；I-CSV-RESPONSE01及I-CSV-RECOVERY02正式关闭，无新增finding。四源冻结哈希与交接一致，其余21源未变；原API27/27、页面45/45（含恢复8/8）、组合前端／根类型及定向静态／文档检查通过，不冒称新全前端集合重跑。原39的REJECTED、红绿失败及83份原证据保留，补审回执与精确复用在.local/csv-review-followup/。此后只补四份收口文档及snapshot，业务源码不变；CSV代码修复与源审交付完成，但完整verify含NT006／真实SQL／回滚竞争／登录和页面仍未执行，不能标完整Level3业务验收。无待用户处理的代码修复／派发权限阻塞，后续真实验收仍须另批有限方案，旧额度仍0；未push、未合ca015或公证。

2026-10-19按用户明确授权完成原两Task最小修复并接入：API严格接纳真实新建投影evidenceDecision:null、缺项／额外项／非null仍拒；恢复的所有未确认成功拒绝保留原body/key及互斥，只有当前身份／授权／路由一致的真实成功才结算。原API真实shape RED7失败→27/27，原页面RED3失败→恢复8/8及整页45/45，各自类型／Lint／格式通过；主控首次组合前端和根类型均exit0。仅四份前端源变化，后台／SQL／依赖不变，原后端132结果按输入不变复用，不伪称新全前端集合已重跑。待原独立窗口对固定新候选补审，不能把作者修复报告记为finding关闭；本轮真实库／HTTP／登录／页面／迁移／Grant／服务／push均0，ca015和公证保持独立。原REJECTED和全部失败／83份封存证据保留，补充证据在.local/csv-review-followup/。

2026-10-19最新独立复审已审最终39b6367d，Spec／Quality均REJECTED（同两项Important，合计C0/I2/M0）：CSV成功白名单漏后端必返evidenceDecision:null；原成功批次失权恢复409可能错误清除原body/key。两项已只读核实，原2613／132测试通过事实保留但未覆盖此组合，不再以降级C/I/M0代表当前已通过。CSV从未迁移或真实运行，ca015／公证未改，暂无已完成业务受影响证据。原API修复派发被自动审批拒绝（缺用户明确派发授权，未送达），其余作者／复审不重派；主控仅保存具体修复提示与证据，待明确授权后按原作者最小修复及原窗口补审。真实额度仍0，禁止合入ca015、push、迁移或页面验收。

### CSV完整导入代码候选：无DB检查完成（2026-10-19）

本片以纯准备收口 `4885c334` 为基线，不更新ca015或公证树。初次冻结源码 `b5db9a06b79a4a7693f67600c7f445ea3926b171`／tree `7dbeecc9972a27ed014e270ce108f540fa68068d`，累计25源（前端12、后台及registry13），最终补强候选见下。API规范化修复 `20879fb5` 保留请求原文，按金额、侵权集合、时点及NFKC.trim语义核成功回执；原作者API26项、类型及定向静态通过。宿主六源及修复至 `7d80a00d`：未知请求双向互斥、跨身份／授权迟返回、路由中止解析／提交／恢复、加载状态复位和成功实际条数提示均已补闭。原59／63项聚焦及最后页面37项证据按各自输入保留，不相加冒称同次统一测试。URL适配最终两漏拒修复已精确转移并标准格式化，C作者24地址Node对照仅为诊断；Root先前13项属于旧URL源，最终统一集合才能证明本次新源。

后台原 `d34ef606` 与修复 `80297cd3` 的13源在Root逐字相等：新触发器绑定原请求／实际Lead及商品／侵权；端点在DTO转换前计紧凑原JSON的UTF-8字节；亚毫秒字符串先截到毫秒再转换；旧来源约束两个分支逐字保留，只追加CSV＋NULL。Root正常Prisma validate初次在原缓存schema-engine的utime报EPERM，保留exit1；经正式审批在原入口重试后validate／generate均exit0，没有删除缓存、改ACL或换入口。随后本树5个显式纯Jest套件130项、后端类型与prepared构建实际exit0；不含NT006，没有连接数据库。

统一检查实际候选为 `53b949bdd541b89243e8cf549753b5806bcc6e99`／tree `64dd9bac37db547be3d064fa199ca8e6cd52ddd3`：前端142文件2613项及bundle、前端／根类型、全仓Lint、变更文件格式、18模块／165模型架构检查、Spec59／69／11／60、strict context均exit0；原jsdom导航提示及大包告警保留。收口复核又补了实际Lead外部引用字段绑定及合法大时区偏移转换，最终源码为 `bfa3da4f2f190b9a9e44909c46d8d8ed844678c4`／tree `24517fc44ad04b0449772fea31ce3022c009ac73`。相对53候选仅新SQL和直接spec两源变化；其余23源、package／lock／schema等输入逐字相同，前端全体及构建精确复用，不称在新HEAD重跑。受影响后台类型、5个显式Jest套件132项、直接spec Lint／格式实际再次exit0。最终SQL raw SHA256为 `e1afd0956aaea74d2d22dd263e7a0baec77a91552877f1e9b0f434dbb6d7518d`，未执行。

原指定独立Sol及内部审查多次实际报 `Selected model is at capacity`；按三级规则由无作者历史的隔离同模型家族主体完成降级累计补审，最终两轴C/I/M0，明确独立性不足，外部独立Review仍Pending。`.local/csv-import-full-evidence/`保留各候选、红绿结果、精确复用／转移hash、真实原日志及模型不可用回执。适配器Sol不可用后仅普通URL失败修复在原Task按路由转Luna，未重建重复作者；C树24地址Node对照不冒标准门禁，Root集合才覆盖最终源。最后普通沙箱有一次在命令启动前因sandbox-bin目录锁权限失败，经正式权限原入口完成，无遗留待审批，不改ACL或缓存。收口仅状态／路线图／本记录及已解释snapshot，源码、配置及验证输入不变，文档检查另列；不把收口HEAD写成统一集合实际执行HEAD。

所有纯SQL回归及Prisma生成均不等于PostgreSQL执行／真实回滚竞争证明；实际DB／capture／Docker／登录／业务HTTP／浏览器／服务／Grant／迁移执行／推送均0。完整verify因含NT006未运行；没有移入ca015、公证、生产或预览，有限真实验收只有未授权草案，旧额度不恢复。源代码准备完成，完整Level3及真实业务验收仍待后续明确准入。

### CSV八源组合交付与原树证据边界（2026-10-19）

固定业务源码候选 `8f4db1ec95ea2bf0ca8cb61aa22960f23450651e`／tree `b2add38943091d0dbef1220f150e93353a7b6ceb`，准备树 `minimal-page-actor-admission`；自 `fc723aa3` 累计仅8份CSV源。原预览最终修复 `2e12f3b3` 已接入；词法parser与宿主由各自原Task交付后Root精确转移、标准Prettier，格式变化及原hash有单独清单。parser输出只读cells／物理起始行且要求显式正整数bytes／records／columns界限；宿主只接受注入 `parseFile(File, AbortSignal)` 的有效行，以唯一session处理同步context失效、换文件、取消／重开、卸载、迟回调及一次明确selection意向。业务CSV映射、多商品、身份名称、重复来源、生产列表／路由及后端批量事务未实现；未来真正提交前仍须复核selection属于当前会话，不把当前意向当提交授权。

最终8源独立Spec及Standards均ACCEPTED、C/I/M0。宿主初次Root标准直接测试8/8通过后，前端类型实际exit2：两处`get().exists()`和一处可空事件计数；交原Owner用`find().exists()`及显式generation／事件存在守卫修正，未删弱旧VNode反例或引入any。最终类型实际exit0。审查者只读核hash／差异，没有重跑检查。稳定同一候选随后正常`pnpm --filter @dev-cor/frontend test`真实140文件／2571项全过（其中CSV模型23、面板17、parser13、宿主8，共61），前端全量ESLint、8源Prettier及bundle均exit0；本树Node24.21.0／pnpm11.27.0，前后源码／HEAD／tree一致。jsdom一条导航提示及原bundle大于500kB告警保留，不是失败。未运行全仓verify、后端／Prisma／NT006、数据库、capture、业务HTTP、浏览器、登录、Grant或迁移。

原树结果严格分开：5530解析树离线安装缺包，唯一正常冻结网络安装exit1／terminated（245326ms），原标准测试依赖守卫失败；Root新准备树直接parser13/13及上述组合通过均不回填5530。b4e5宿主树标准pnpm测试受依赖守卫阻断，正常安装的真实完成状态未核实；其直接CLI8项是诊断，不冒标准门禁。9784原预览完整前端集合的较早成功输入不含最后外层div修复；本次新组合才覆盖最终源。

缓存处置偏差单列：解析作者曾在Root明确禁止删除后，对其本地`C:/Users/97830/.codex/worktrees/5530/dev_cor/.pnpm-store`执行删除（当时记录1文件、退出0），后续安装重建目录但失败。主控只读最小核对确认当前为普通目录而非符号链接，tracked差异空，package／lock与原HEAD及首pin一致，原parser两raw不变；缓存可依未变锁及registry重建，但本轮没有证完整重建。未记录全局／共享缓存删除或配置更改；缺删除前链接元数据及共享缓存前后快照，不能断言历史共享缓存绝对零影响。原失败和此偏差保留，不继续清理、移动或重装，也不读取敏感配置。

证据在准备树`.local/csv-integration-evidence/`：`acceptance-summary.json`、`final-review-receipt.md`、`host-final-typecheck-result.json`、`final-frontend/results.json`及逐项原日志／source-before、after，`store-impact.json`、两项transfer及parser格式输出等价证明。随后收口仅4正式文档和已解释snapshot，实际业务候选沿上述commit，不称文档收口HEAD重新运行前端集合。ca015仍clean `f6e3a82f`，未合CSV／公证、未推送；原Lead正式FAIL仅经前节离线解释检验器误报，不改为真实PASS，已耗页面额度不恢复。

### CSV两项finding的静态关闭边界（2026-10-19）

原CSV Task在c83d5972之上仅改面板及直接spec；固定raw分别为 `6f51bc6c5e60daa129a5e8442a829a99c4b12c63b8f1e7fdda911850c15f5f65`、`bdf05628aed10dc9e0d44f1bdc9038eaf42a52d5a4f180d0113b4534c42a8485`。原独立Standards Reviewer确认上海时区纯展示、按需ElButton／ElCheckbox关闭I1／M1，Standards ACCEPTED、C/I/M0；独立Spec Reviewer核raw foundAt不变、旧generation闭包及真实DOM测试仍在，Spec ACCEPTED、C/I/M0。二者均只读，未代作者运行测试，不能据此称修后组件或完整标准门禁已通过。

修后定向组件命令在Vite/esbuild读取工作树上级目录时Access denied，配置加载前exit1；原Task已对同命令申请正式沙箱审批，当前待结果，未绕目录／权限或改用替代工具报告标准通过。已成功的离线冻结安装和修前类型检查分别保留，最终类型／全部前端Vitest／前端ESLint／四源格式／bundle仍按稳定新输入核实际结果。解析及宿主并行准备不改变此审查对象，也没有新增DB、HTTP、登录或业务验收。

### CASE_DIFF封存输入离线重放与CSV审查进展（2026-10-19）

准备树固定helper raw `601216f0a2da4885b2301cc9c11dbc703acd18243bd84f929af292c01cc68ec9`。仅从原e684 Git blob与现helper提取纯比较声明，8个封存安全输入先核bytes／SHA；165表旧PK行及sequence逐项保持，新增项仅为已批准的Lead增量，两个真实Lead UUID按PostgreSQL jsonb主键文本hash精确对应唯一两条新增行。旧函数在该实际映射报CASE_DIFF，修后通过；5个内存反例分别拒绝旧行漂移、额外Case、错Lead、counter异常及旧Case变化。未重建原行payload、未导入helper运行环境或调用prepare／capture，登录、HTTP、DB、服务、新业务对象和材料文件操作均0。

证据在准备树 `.local/lead-case-diff-offline-replay/`：`replay.mjs` SHA256 `4fa3887290bfd9cd1ebe2ee929cab9dd1cf81864b156748a4803061528d944ad`，`result.json` 为 `44b14e1fd3360a9c07fed08ac3d49dacb38743bec418d55744dc4fa98abf9bb8`，`hashmanifest.json` 为 `d948f88155071f16fb65e415e0c37aed8496f3df89faa47e34b99b569d086895`。独立Reviewer重新核8输入及映射、旧失败／新通过／反例，Spec／Quality均ACCEPTED、未关闭C/I/M0。结论为OFFLINE_REPLAY_PASS，仅关闭检验器误报；历史formal仍FAIL_CASE_DIFF，不转为真实E2E PASS，不授予新运行额度。封存closure中唯一新会话已撤销、两Lead为WAITING_REVIEW/v2、96登记CV与377文件保持。无需为了此解释再做真实只读登录；如未来另要新候选页面证据，仍须单独明确批准。

CSV `2ff863a9...c83d5972` 累计4源由独立上下文审查：Spec ACCEPTED、C/I/M0；Standards为C0/I1/M1，发现UTC直接显示和原生按钮未遵守上海时区／既有组件规范。原Task仅修面板与直接测试，未关闭finding前不称独立Review全通过。原树 `pnpm install --offline --frozen-lockfile` 已实际exit0，920包复用／下载0；原输入前端类型exit0，仅作阶段证据。新修复的定向检查及稳定候选完整标准前端集合尚待最终回执，不能借旧定向工具结果替代。解析／宿主新增任务仅离线准备、各自新文件，不新增共享API／schema或真实验收。

### 独立CSV模型及纯预览面板的交付边界（2026-10-19）

模型候选 `9659a600456cf6507f240dee3116961a42e60cf2` 的23项纯测试，以及其子提交UI候选 `c83d5972a6715da7ef899fb9ae8720457b8d3ce8` / tree `de63ae44b721a03f03681380dadbd6077b2a19ac` 的15项组件测试分别通过，未声称同次组合门禁。累计恰4源，独立位于原CSV Task，未合入ca015。UI仅收模型快照，发携generation的选择／取消／确认意向；无默认全选、invalid不可选、无业务HTTP／新导入状态，不把意向当服务端授权。

模型stamp-only选择校验曾被主控指出，真实RED3项后以冻结快照＋来源登记修复，最终23/23；UI真实挂载旧VNode的checkbox／cancel／confirm回调曾在换文件后发新generation，RED为3失败／原12通过。最小只读视图投影在渲染时捕获generation，执行时再核当前快照，最终15/15，正常新事件仍通过。隐藏预留ID、披露字段以是／否显示；当前只有客户／主体ID，名称解析仍待适配器，未假造已挂载生产界面。

最终UI raw：panel `ffa28af35b8dad270351224425bcc89b2bb12a5d2d9c6668465d03ece86d7b99`，spec `d0e6ffb6bf9de365396f0a6c4909e7e10023a16a1bc63c74172d2fab4ef2b98b`。模型原raw未变。分别有定向TypeScript／vue-tsc、两文件ESLint和Prettier通过。Node24.21.0／pnpm11.27.0；参考树同package／lock字节的Vitest4.1.11、Vue3.5.42／TestUtils2.5.0／plugin-vue6.0.9、vue-tsc3.3.11、ESLint9.39.5／Prettier3.9.6。原树标准装配的网络失败保留；组件初次runner config loader失败为0测试，随后只改自身ignored配置为native loader真实加载SFC。未改node_modules／registry／缓存／锁文件、未复制源或关闭依赖守卫。初版12项账本保留，最终证据为独立树 `.local/lead-csv-evidence/panel-v2-verification.json`；模型证据 `verification.json`，过程及范围在 `contract.md`。

本片为普通纯预览准备，作者自审和主控源码／hash／实际负例定点复核已完成；未安排独立Task Reviewer，不能称完整CSV独立Review通过。项目标准frontend／context门禁、CSV字节解析、名称解析、路由／宿主接线、提交事务、HTTP／浏览器／数据库验收均未完成。CASE_DIFF后续只读补证目前仅在原清单规划，本轮没有登录、runtime或新增业务写入；原正式FAIL与耗尽额度保持。

### Lead业务完成、正式收尾失败与额度耗尽（2026-10-19）

运行候选 `e6845104ffc0f59d617e46d90e0b4c22df6b7ef7` / tree `8a7a1cb9ab7bb083ced93261e73523d0d8f3a899`，独立Lead配置受保护发现恰1项、0回调；正式唯一运行expected0／unexpected1、skipped／flaky0、exit1。现成附件确认login1／logout1、leadCreate2／batchPush1，三业务响应均201、UNKNOWN0；`verifyLeadResult`、列表／详情／刷新后的WAITING_REVIEW/v2断言及 `flowCompleted=true` 已到达，正常页面logout204通过。最后 `support.dispose()` 的 `CASE_DIFF` 使正式结果失败，保留原报告，不追认为真实正式PASS。

独立只读closure通过：EF成功后的165旧表PK行及安全保持，Case／来源／sequence不变；仅新增2Lead、各2product／infringement／command receipt、1batch receipt、4audit、1已撤会话及当天lead counter行（last_value2），旧counter行保持。两Lead均为WAITING_REVIEW/v2。96登记CV和本轮全377物理文件无新增／修改／删除；端口空闲、标准锁释放。原Runner实际EF调用／新Case／文件／上传／账号／Grant／迁移均0。证据目录 ca015 `.local/next-batch-preparation/lead-only-e6845104-20261019/`，summary SHA256 `fbed914d132dc90f7019c4612caa4d21f9bcfff6836a3aea53401b38ff7242f3`，manifest `c532a342b7285d9bcfbc2cd76e1a9a216ccaabc4d637661941d2140e1cbe5e70`；raw仍只在批准私密目录。EF与Lead原登录／业务额度全部耗尽，不得重登、重造或重推。

源码根因：Lead的 `registered` 是两个UUID数组，Case增量上限原为0且旧Case摘要未变；共用检验器随后仍对truthy registered执行EF专用“新增一个Case且ID相同”条件，必然误报。最小修复只给该身份锚增加 `kind === 'EF_FEEDBACK'`；Lead的Case零增量、旧摘要、两个Lead ID与唯一counter＋2检查均保留。helper raw `601216f0a2da4885b2301cc9c11dbc703acd18243bd84f929af292c01cc68ec9`，test raw `281d175d9f9911b030d3592983c35c2061d70d19501cef6a8b4949dd3007b537`。RED复现CASE_DIFF，修后focused2/2、full25/25，定向Lint／格式／diff通过；额外Case、旧Case漂移、错Lead ID和EF错Case仍拒。独立Sol按固定raw、实际日志和完整守卫核对，Spec／Quality ACCEPTED、C/I/M0，复用作者结果未运行DB或页面。证据在准备树 `.local/lead-case-diff-red-green/`。此纯修复未进行真实重跑，不能改变已耗预算或原formal FAIL；需要新的真实验证时另报具体额度。

### EF页面通过、Lead服务前阻断与CSV纯模型（2026-10-19）

真实页面候选为 `2bf4b14bcbd805153c1a972dd20762909b8e17dd` / tree `bd6b7585e774451026fe089aa35845db1f614bde`。原Runner先通过无数据库／服务的argv round-trip，修正其ignored wrapper的output参数字面引号，旧ENOENT证据保留。随后EF标准单文件实际expected1、unexpected／skipped／flaky0，完成原案反馈初记及带原因更正；新增1session正常退出、2feedback版本／2receipt／2audit，当前revision2，原Case仍EXECUTING/v3、来源不变。96登记CV及本轮全377物理文件无新增／改变／删除；旧281文件不据此追认为自原始run起不变。

EF独立收尾通过后才运行Lead单文件；其在配置服务前阶段报 `PRESERVED_EF_LIVE / MINIMAL_PAGE_PRESERVED_EF_LIVE / MINIMAL_PAGE_PRESERVED_EF_ROWS`，expected0／unexpected1，未到回调、登录或HTTP。已保存的EF-after与Lead-after全165表PK行／sequence摘要相同；Lead closure及377文件保护通过，端口空闲、标准锁释放。EF的额外1登录／2POST已消耗，不再运行；Lead原H42的1登录／2Lead／3POST未耗。当前定位配置选片，不将异常直接定为产品问题，也不放宽数据保护。安全证据目录为ca015的 `.local/next-batch-preparation/preserved-pages-argv-fixed-2bf4b14b-20261019/`，summary SHA256 `62a3a1cbd4221c14da3b2084c22c84b9ce9f822747e8a37810ec2d1ad342677e`，manifest `1155e91cbe02619725e734429f0b9c2ff6e428ee2ef7be116f25f6c37f8fb0ab`；原报文／trace仍仅在批准私密目录。

选片根因已由锁定Playwright 1.63源码核对：CLI保存原argv，但worker重新加载配置时，本进程argv没有原Lead文件；旧配置的空选择回退使它重新校验EF。helper的 `resumeMode` 本来只对EF启用，未发现Lead缺失已批准增量的业务保护。修复新增 `playwright.lead-minimal-page.config.ts`，固定仅LEAD_BATCH和唯一Lead文件；保留原完整同步pre-server准入、R2／来源／账本／权限／行／文件／会话及预算守卫，原EF配置和helper实现不变。直接测试编译执行真实配置，覆盖CLI／loader／worker／空argv／EF位置参数，且核完整admission块同原文件逐字相等；不引入环境开关或动态成功回执。最终config raw `606d169f597dd9c73c8013959f3c71e66cd29c55699b637dafc8c389e6fd388a`，test raw `6730e3189838e58c22ecc1ef12a31ff81b5f3587f1506bb29bcacf52232bb08d`。作者实际pure24/24、定向Lint与root类型通过；第三条JS块比对测试追加后曾格式WARN，最终仅格式化、显式格式check及diffcheck通过，未重复未变逻辑。独立Sol按最终两raw与完整准入块核对，Spec／Quality均ACCEPTED、C/I/M0；测试和静态证据复用不冒称Reviewer重跑。该修复不代表Lead真实页面已通过。

独立CSV候选 `9659a600456cf6507f240dee3116961a42e60cf2` / tree `d4e09529eeeddc0612b73ba9cf25aff92e86a0f1` 仅新增 `lead-csv-preview.ts` 及直接spec。冻结raw为 `5ba820699a5437fd6c0e50b3aa1e098d0d188350d37dc19c1d5c01da3ad86a92` / `e9e45a786222527689801f8472d762b2a3784f0e03b76c870587685fb572e3f0`。伪造／篡改选择快照先RED3项，再23/23 GREEN；同锁参考工具链定向TypeScript、两文件ESLint／Prettier通过。Task原树联网装配因socket／timeout／metadata错误exit1，标准context及frontend门禁未执行；该失败不因参考CLI结果改写。证据在其 `.local/lead-csv-evidence/contract.md`、`verification.json`。无HTTP／DB／browser或导入写事务，未接产品UI，未混入ca015；安装残留未提交。根提交后尾部普通status遍历未返回，已终止该只读步骤；随后独立核实commit仅两源、tracked与index差异为空及raw吻合，未重复提交。

### 登记文件与全物理根分界（2026-10-19）

候选2ff863a9496708ef45e3e9f17f7f8b494ce59d07的protected只读probe已过原案LIVE，后报PRESERVED_EF_LIVE／MINIMAL_PAGE_PRESERVED_EF_LIVE／MINIMAL_PAGE_PRESERVED_EF_FILES；摘要SHA256 000b3654ce4b76a6d6f24c07c76b7cd87482ba8752f8f54f8de5d41b69d606cf。原Runner closure核165旧行／catalog／sequence和96份登记CV字节保持，0服务／回调／session／HTTP／业务写入，锁／端口释放。原Owner只读盘点发现全根377个普通文件，96个登记CV按ID／字节／SHA全匹配，另281个正常UUID存储键文件、0reparse、mtime均为2026-10-15；额外清单按path／size／SHA排序的摘要a1d25798b772493922885031ce41d00bae80ec38bbc5f7b8f69641380f0fb9dc。mtime只作来源线索，没有原运行时刻对这281个文件的密码学清单，不追认其历史未变。

helper原条件blobsBefore.size等于96必拒；修正仅去掉全根与登记集合等量的假设，提取纯文件断言并补96封存ID唯一性，保留实际DB版本数／逐ID存储路径与实际SHA，原dispose全根旧path／hash及resume新增文件0逐字保留。直接pure先RED后24/24，少登记、错SHA／storage key、多DB CV、重复封存ID均拒；root tsc、三文件ESLint／Prettier、diff通过，原独立Reviewer C/I/M0。三raw为helper d53c30e4e1ae58052aa1311037b3497a3b6aee6692915b7a7636c24da0646ca4、types 3cf5ddc2af8e701a56991135d35f0b92eda9f7ef9e2eea637f668e60e9b679df、test 82ce4f1afef819a77e67ac241c4979ce3903885abde4da65b6851134004237aa。只读代码结论不等于修复后实库前置或页面通过；全部377仅从本轮启动到dispose按完整集合保护，不删除或覆盖旧文件。

排查中一次只读搜索误把测试环境凭据所在邻接行带入本地工具输出；未写入Git、补丁或推送，未复制至公开产物，后续仅读指定非敏感项及聚合摘要。不复述或擅自修改该凭据。

### 原案LIVE材料引用类型根因（2026-10-19）

候选0cd41fc4e012137e7c4e348e9eba54110a73ab3d／tree832cc24dc8f0be62f6c9cb26e64e95527eee9d12。首个ignored只读probe的child字符串转义错误先于helper解析失败，原件保留；仅修两处换行转义、实际子脚本仅编译通过后，protected --list真实得到PRESERVED_EF_LIVE／MINIMAL_PAGE_PRESERVED_EF_LIVE／同causeCode。摘要e84c0473917ff845cfcc6c99e47d14e8b30ff2b75ccdc611579974ef1544acb9及probe-result／closure-result已独立核对；0服务／回调／session／HTTP／业务写入，165表旧行／catalog／sequence和96文件保持、锁释放。

实际helper查询material_references使用resource_type='CASE'且断言也要求CASE；MaterialService的mailing和filing两强freeze真实创建resourceType:'case'，同表既有读取亦小写。两命令的audit_events使用大写CASE，不能套入材料引用。原封存typed mailing／filing各新增1、material references新增2，8份既有私密facts hash核同且其余Case／external／source／三回执条件均吻合，反馈／followup仍0；因此错误筛选会排除真实引用而必拒。修复限于精确小写case的SQL及断言，保持2CV、同案、原文件／权限／预算全部门槛；不修改产品、SQL或既有引用。纯回归及独立复审绑定后续固定源，真正前置及页面仍分别等待原Runner证明。

两源最终raw SHA256：helper 1b9950f4d8cc9b2b128012f99ad95ffe6898d8d048f34e3f88a36bf655ff327c，直接test 3a3ce9d425d266288afb6664688fe703a749f672b9291dca1939d33dfcaf2881。实际生产freeze方法及helper读取SQL跨源对照先RED 2/2失败，修后直接pure23/23；大写／混合引用类型、错Case／CV等仍拒绝，root tsc、两文件ESLint／Prettier、diff检查通过。没有复跑未变的产品／完整门禁或使用既有运行额度；源码检查不能替代下一次只读前置与页面结果。

### checkpoint前置失败与安全诊断（2026-10-19）

运行候选22cd51e80a217ea36e579c0cde787bc1e3196fe3／tree ff11a66b7f19f59f916d77bfa91eccf42181b316。首次ignored普通Node脚本错误地额外调用受保护prepare，正式命令未开始，原失败摘要SHA256 6ac3fc68d47b61c3006f5d54d5ecaf4a3ed26faa6bdf7acff61de64c4149877c保留。仅移除此额外调用后，真正protected入口取得标准锁，于配置pre-server checkpoint exit1，错误MINIMAL_PAGE_PREFLIGHT／playwright.minimal-pages.config.ts:67，尚无回调／webServer／新session／HTTP／业务写入。其closure通过，165旧行／catalog／sequence及96文件保持，锁／端口释放；已有stderr没有保留内部guard，不能推定底层SQL或产品错误。

静态及仅本地读取核验：真实授权读取、封存summary和配套proof、实际readSource／readFrozenEvidence／既有fingerprint key读取均通过；这些不是prepare／capture或实库通过。原catch丢失cause，外层以整段stderr匹配且正则排除R2等数字码，会掩盖可用诊断。最小修正只保留固定阶段／规范错误码三字段，忽略warning、raw message／stack／SQL／URL，并保持所有准入／预算／保护语义；其纯测试与定向复审另绑定固定源。实际根因待正常protected环境的只读probe，不把诊断补丁或0消耗失败写成页面验收通过。

### EF原案checkpoint实现与离线验证（2026-10-19）

五文件仅改minimal-page-acceptance.mjs／.d.mts／.test.mjs与原EF页面spec／直接pure test；产品／SQL／权限／Lead spec／配置不变。EF入口专用于Case6c151c42-3054-466b-9a0e-a8daaf99fbde及filingc1fab17d-d583-45ad-bf36-f3492c5d8b9b，删除当前可执行fresh建案／上传链，原实现保留Git历史。授权回执须核真实批准原文SHA、消息ID／时刻／精确额度、完整候选HEAD／tree／clean及五路径raw；原summary／trace／来源回执／两CV／165表旧行与96文件在只读预检核定，缺证据先于capture／webServer拒绝。priorConsumed与当前实发分开，当前只1login、2反馈POST、1logout；H42仍留原1session／2Lead／3POST。

独立预审和主控实读发现并修复：封存表正则误拒_prisma_migrations、未核当前表全集、预算中文与镜像测试同损坏、分页GET误受写请求query限制。最终无U+FFFD／CRLF，actual snapshot函数假client覆盖旧账本／非法表名／额外表；预算测试从实际spec提取文案，包含分页GET、跨host和带query写反例。三直接pure文件含Lead共享回归一轮26/26，最后局部修复后受影响helper18/18、root tsc、helper Lint／格式通过，其余未变输入复用先前五文件检查；不将分轮数字相加造覆盖。最终五raw（helper／types／helper test／EF spec／EF test）为04511f49cbc6ad043b09981593d6af4b8f31709adefadc89066a4f2d0a307bc8、3f6cd18f362dc70d7cced5831ef79d89e46a70eb77a0c23343e000a47dc0710e、8e9f116756c9168203bfefdb531c549f81a76295e796b5610474e8f5f79a1b10、78357a9fbdfee6810e7946161696a0dbec586317b2f7bdb3edb304898c4c3ced、fbade15a41c9850a4f304359d6258b42564eb4bfb80b0e9a58deab3807cb45b3。独立Sol已按上述raw终核C/I/M0并独立核原summary及六配套proof；本地源码提交8c1bc8c761a726b4a187e6daf6b5c0863cca9e54，固定最终候选及receipt后交原Runner。本条没有运行新登录／DB／HTTP／浏览器／完整verify／NT006，不把编码中的live检查说成已执行。

### 公证独立集成准备及Demo模块证据对账（2026-10-19，只读）

独立Sol核d8ab9b3e的39路径对ca015 dadb／准备树add50均无文件级重叠差异，parent cfb3d2b3的11份来源分支公证规格／状态文档须另同步；未执行cherry-pick、编译或组合验证。来源有166个迁移目录，新20261018000100_notary_record_corrections原始SQL SHA256 0af29f0bd3ae041e4485d80a3a51f1ec259ea437e588e3f7402cc557f322c5f2。当前两页165源／账本gate会拒绝先合源或先应用该迁移，故公证实际集成与迁移必须在两页收尾后独立进行。最小事项／身份／Grant／图片SHA及大小尚未live核定，条件预算和缺口已并入原一次性计划；没有执行新增DB、Grant、迁移、HTTP或页面。39文件静态C0/I0/M0及508纯测试不扩大为真实验收。

另由原Luna盘点任务对M00–M10、正式能力01–27及最新固定验证记录逐域核对，结论同步路线图：明确五包为CSV、线索／案件合法批归档、线索可恢复删除／确认后撤销、可解除案件合并组、服务端列表能力；均是有依据的独立队列，不是新增开工授权。客户／资产／协议／人工台账、CA018、原NT、Demo A有限内部费用／证物／结算等按各已验子集保留，不将旧Pending覆盖新记录；报表指标、模板整包数据、退款及其余批动作未冻结，OCR／爬虫延期、E03自动集成、生产条件另列，不计当前确定包数。本次未重跑这些模块测试、未声称全模块完成。

### EF陈旧列表测试流程窄修（2026-10-19）

本地提交a4bf37923b4162c8aca6369bccd0e648a0306adf仅涉及tests/e2e/execution-feedback-minimal-page.spec.ts与tests/support/execution-feedback-minimal-page.test.mjs，raw SHA分别8ba02278ecded431576ac07e624c31dc3e5d49d89c1226fcbd11800c1c74bee3、dc9fb402ce40bb7a5532f15b32947d433996e69729b50a5bacbb2b904bd56897。来源准备后先监听新GET /api/v1/cases、点击已有刷新按钮、等待该Request自己的response为200，随后保留原精确businessNo链接断言；产品、预算、业务body／key、配置与超时均未修改。纯测试提取执行实际函数，以假Page验证监听→点击→新Request→其响应→可见断言，防止先前已发请求的慢响应误充本次刷新；RED后GREEN，最终4/4通过。两文件ESLint／Prettier、frontend vue-tsc、root tsc与diff检查通过，按未变输入复用作者结果。

单独整体pnpm typecheck实际失败在backend Prisma generate对AppData下schema-engine的utime EPERM；未重复生成、改ACL／缓存，也未称该命令通过。不触发生成的frontend与root类型检查实际通过。无浏览器、DB、HTTP、capture、服务或完整verify；ca015仍clean dadb0989。原失败及来源事实保留，页面续验尚未执行。下一步必须绑定原Case／filing／CV／三回执及上轮after保护基线，以真实priorConsumed证明来源额度，不伪造发送计数；额外EF登录1次／session1仍需单独批准，不能挪用线索保留会话或直接重跑原spec。

### 公证正式支持审批提交核对（2026-10-19）

用户在原任务窗口明确授权一次require_escalated git add／commit，原Owner通过支持审批成功，未修改ACL。候选d8ab9b3eb3700f9e3fc67b2f33b0e2ca27da2361／tree dfd7bc7517a012602d05928bc915ea9180dc14a3／parent cfb3d2b331db50ed02531eb417277dfa87fed674。主控在原ui003-notary-list-workflow只读核commit路径恰39个，逐项hash与新manifest6537c55cb5dd1f2bb0b6bf4253b3087e14d725af5ae12fcadc8c6140029edbb3全符、工作树clean，committed-state.json存在。此前普通暂存128／index.lock不存在及路由AbsolutePathBuf错误原证据均保留；正式审批成功不是改ACL或绕道重建成果。

已审纯门禁与格式AST同义补审按固定源复用，不重算508或6项。只交候选并停止：DB／Grant／迁移执行／真实HTTP／浏览器／Docker／merge／push仍0，未把39源接入dadb运行树，未宣称完整产品验收或关闭共享http.ts范围外残余。所有原子任务已结束，本条只登记用户批准提交及主控只读核验。

### EF来源成功、陈旧列表断言停止及只读归属（2026-10-19）

原Runner实际在同fullCID正常start一次并healthy，今日完整前置通过；EF正式exit1／unexpected1，源保持clean dadb0989。摘要ca015/.local/next-batch-preparation/r2-resume-pages-dadb0989-20261019/summary.json SHA566b1f7043334af0d2a8e106baa4c2ce285705e54536fca56121d8b68c90718f已独立回读。真实Case6c151c42-3054-466b-9a0e-a8daaf99fbde／CA-20261019-0001为EXECUTING/v3，external-entry／mailing／filing三成功事实／回执及两份43byte文件均保留，反馈及其回执0。会话正常logout204并精确撤销；原94文件、全部旧行／权限／序列和六EXPIRED保持，本批服务／端口／锁释放，未运行线索页。

主控及独立只读Task核safe-trace-http.json／usability-ledger及实际spec：成功GET /api/v1/cases在01:37:35.268／.271Z，均早于external-entries POST201（.349Z）、execution-mail 201（.971Z）及execution-filing-submit 201（01:37:36.257Z）；断言前无新列表GET，反馈POST0；logout后中止的GET不算刷新成功。spec来源完成后只点击同一路由case-nav，随即等待精确新案号。CaseListPage的load与“刷新”按钮已存在，route／identity未改变时不保证重载。普通trace未留列表响应body、query值和items count，故不据此指认产品筛选／分页bug，也不说刷新后的产品结果已验证。

最小代码方向仅E2E：来源完成后通过页面真实刷新，关联该动作发起的新列表GET并等待成功，再保留原精确案号断言；不延长等待掩盖、不改产品／scope。此修复不能使旧spec整份重跑获得许可，已有来源与上传额度已用。下一真实续验必须独立固定原Case／filing／CV／三回执和允许差异checkpoint，原来源POST／上传全部禁发；不以调用预算函数或假计数代替原真实成功证明。剩余正常业务POST为5（EF2＋线索3），原总2session仅剩1且原EF已退出，若保留H42需另批1个EF登录及原精确收尾；未获补充授权前仅代码／纯测试准备。

### 公证恢复成果核对与Git权限只读诊断（2026-10-19）

用户原窗口直接恢复后的handoff及原review已读取。公证仍HEAD cfb3d2b3、39源未提交／staged0；新manifest 6537c55cb5dd1f2bb0b6bf4253b3087e14d725af5ae12fcadc8c6140029edbb3的39文件逐项hash全部匹配。唯一格式文件3079d1885f07c590574d7f22840ca6f55403b1ddb1061450538da7f871417fe3，其余38源不变，原Sol用完整AST对比确认无语义变化、关闭M1为C0/I0/M0；纯6项为旧测试重跑，不另加算覆盖。真实DB／HTTP／浏览器／迁移仍未执行，不能称完整产品验收通过。

原普通git add日志准确为创建.git/worktrees/ui003-notary-list-workflow/index.lock Permission denied，未执行commit。主控仅Get-Acl／Get-Item／WindowsIdentity与Git只读查询：index.lock不存在、staged0、index及worktree Git目录非ReadOnly，目录可读且无reparse；仓库.git及其worktrees目录有继承Deny写条目，环境允许路径明确将.git配置为read。当前身份为CodexSandboxOffline；Deny SID未命中普通User／Groups枚举，未进一步读取restricted SID或做有效写入探针，所以不凭ACL文本断言仓库所有者本身缺权，更不将它认作僵尸锁。根.git的首个Get-Item因Hidden属性未带Force返回不可见，补Force后确认为Hidden／Directory而非缺失；该只读显示问题与git add失败区分。

结论为普通受限执行器不具备该Git元数据写上下文，最小合法办法是走支持的require_escalated审批，在原工作树对核定39路径再次核hash／空index／无锁后精确add及本地commit；不改ACL、不删锁、不另借目录／账号。主控先前两次文档本地提交通过同一正式审批机制成功，只能说明支持入口可用，不代表本公证提交已批准或已完成。此次按父级先诊断要求未发起写入或提权试验。若正式审批后仍OS Permission denied，应保留原失败并交宿主支持核该特定gitdir，不能自行修ACL。

文档范围同时纠正：此前15包将延期OCR、可选文件中心与外部自动集成混成本次运营Demo交付阻塞，现已撤回该数量；以SD-10、2026-09-23时序、SD-53和INPUT-016及M01／M02／M06／M08／M09为依据，来源明确的产品差异下限5包与范围待核组分开。这是规划口径修正，不是新增功能／测试授权。

### 今日离线发现通过与原R2停止断点（2026-10-19）

原Runner在clean dadb0989上仅修自有ignored配置的绝对testDir，原生CLI两指定文件恰2项、callback0／webServer0、exit0，旧No tests found与配置保留，tracked产品／helper不变。后续原R2 fullCID只读inspect running=false，故在连接前停止，当前165账本、身份／旧行、94文件和跨日后台候选尚未实核；DB／HTTP／登录／业务／上传／Grant和六草稿重复更新均0，端口空闲且未取标准锁。真实摘要为ca015的.local/next-batch-preparation/resume-pages-dadb0989-20261019/summary.json，SHA256 a438f60a71ab0de276bbad2f7140bfb3ceaa8dbf5eee83e9948c97fae690c6fa，不是业务验收结果。

父级依据用户恢复开发与验收指令，要求先核原容器完整ID／pinned17.11／持久卷／15438绑定后正常恢复同一个容器，再做今日全部前置。该续单已成功投递原Runner，当前尚无执行／healthy证据，不能把投递成功当docker start已成功。旧行／时间／候选任意变化即停，任何新清理对象不受昨日六行许可覆盖，不新建库／容器、不改配置规避、不迁移或补权。公证仍等用户原窗口恢复，未重复发送。

### 跨日恢复只读核对与全域差异盘点（2026-10-19）

用户明确恢复原任务并行及原未消耗两页范围；主控只读实核ca015 clean dadb09892b1b1bedd15789b8f9066cfa7f0d3617、独立文档树54d97fee，原公证cfb3d2b3下39源仍全部符合冻结manifest efea8516、dirty39／staged0。昨日exact-expiry summary 828de836与新基线保留，未再次执行六行更新。正常runtime24.21.0／pnpm11.27.0、文档树开工context检查通过；本轮没有真实capture、DB查询／写入、HTTP、登录、浏览器、服务或迁移新结果。

已实际启动并完成只读全系统盘点，覆盖能力01–27及逆向M00–M10，结果增量写回现有路线图而不建重复总账。初次盘点引用较早矩阵，错误把结算／证物写成从未实跑、把CA018和权利资产写成待开发；主控核最新固定摘要后退回，修正版采用2ef6a739累计Demo A及CU组合、CA018、独立SD61冻结回执。此前失败与有限验收范围不改，未因此推断全量Demo、生产或新候选门禁通过。此为文档证据一致性修正，不是新业务验证。

两原Task续单已保存于独立文档树.local/resume-20261019/{notary-resume.md,runner-resume.md}。原窗口工具初始未暴露，后来恢复；read_thread确认两原Task均idle后，Runner续单成功送达。公证格式修复续单被自动审批以“latest trusted user instruction explicitly said to pause”拒绝，未送达；随后只读核对安全替代消息返回invalid turn/start params: AbsolutePathBuf deserialized without a base path，仍未成功启动。父级当前恢复用户证据已在可信transcript中，读取父线程未返回可额外核验的turn；没有将同一被拒动作改道或间接执行，也未创建重复作者／Runner。公证需用户在原窗口直接发恢复指令。恢复必须由原Owner接单；公证实际DB另定范围，Runner先离线testDir发现2项callback0，再按今日真实日期／后台候选／15分钟硬窗口及旧行文件／身份锁重新准入。若有新现场变化先停，不扩大清理、权限、对象或会话额度。

### 六草稿精确过期与页面发现阶段停止（2026-10-18）

用户明确批准cleanup-assessment内六个固定draft仅OPEN→EXPIRED及真实updated_at、保留记录／不删除文件；原Runner在clean dadb0989/tree db226dab上重新核六ID与原行hash、P0/E6/L0/D0，事务内锁定并精确更新六行，一次提交／无自动重试。独立只读后核仅upload_drafts六行的status/updated_at差异，其余165表旧PK行、序列、ledger及身份授权保持，cleanup四分支归零；新基线phase3-all-old-rows.json与旧前置同时保留，不能声称六行从未改变。未运行cleanup全服务或物理清理，94份原文件字节核验通过。

来源证据为ca015的.local/next-batch-preparation/exact-expiry-dadb0989-20261018：summary.json原SHA256 828de83691a1328e62b512872be4481d7590928d6002db14aacf59b22d7f615e；phase2-receipt为COMMITTED，phase3-closure逐行核准唯一允许delta。真实数据变化仅此六行，非schema部署或业务验收结果。

随后EF正常protected命令exit1，No tests found、callback0，原Runner自有ignored证据配置继承相对testDir而未固定项目绝对tests/e2e，属于执行器发现配置错误；原输入和错误保留。线索命令未启动，未修／未重跑，两个页面没有真实PASS或业务失败结论。末次只读全库与六行更新后的新基线完全一致；新session／Case／lead／文件／业务POST／上传均0，无session需注销，matchingManagedNodeProcesses和端口为空、标准锁释放、R2未停止。私密证据未上传，产品／helper／Git HEAD未变。

按用户最新完成当前任务后暂停要求，已有公证任务也已收口暂停；不启动新批次、扩展修复或重新执行成功准备。将来收到恢复指令后，先核此执行器testDir断点，再复用未消耗原两页预算与获批新基线；不得重做六行过期、恢复OPEN、修改expires_at、关闭守卫、迁移或追加Grant。

### 公证SD61纯实现冻结并暂停（2026-10-18）

原ui003-notary-list-workflow目录、codex/notary-record-batch-contract分支仍为HEAD cfb3d2b331db50ed02531eb417277dfa87fed674／基线tree a25b39d001a1a0b237d2e5304c626c15099fe072；该tree不是dirty候选tree。公共作者29文件及UI作者10文件共39文件（27改／12新增）全部冻结，staged0，未产生新提交。主控逐项回读39个SHA256均与.local/ui003-evidence/notary-sd61-pure-20261018/candidate-manifest.json相符，manifest原SHA256 efea851637e8fd95e1de52cb017be1e6c2d6f1ce852b0e0e1f3b4bd6013bb029；handoff.md、review.md、final-state.json保存完整边界。

实际可信纯验证合计508个不同测试（后端直接96、后端跨契约141、前端API91、前端相关组件180，已去重），check:fast:prepared的架构18模块／167模型、三层类型和全仓Lint通过，Spec59REQ／71AC／11BQ／61SD、Prisma validate／generate及diffcheck通过。独立静态功能审查无剩余阻塞，Standards仍NOT PASSED、C0/I0/M1：backend/src/modules/leads/notary-record-edit.service.spec.ts一处Prettier失败按暂停指令保留，最终context未执行，未刷新快照，不能称完整ACCEPTED或完整门禁通过。shared http.ts迟到401通知的既有残余竞态仍列未验边界，不扩围修复。

普通git add因.git/worktrees/ui003-notary-list-workflow/index.lock权限拒绝而失败，实际暂存0、锁文件不存在；这是普通沙箱权限失败，不是自动审批拒绝。未重试、提权绕过或代提交。真实DB／Grant／迁移执行／Docker／HTTP／浏览器／merge／push均0；原Task和三个子任务已停止，无已知本任务常驻服务或锁。未将这39文件或公证schema混入ca015，ca015仍冻结dadb0989。恢复须从原39文件及准确hash续办格式／检查断点，不能把基线SHA或纯测试解释成真实验收完成。

### 两页只读前置停止及精确身份核对（2026-10-18）

原Runner在用户直接恢复／续验授权下，复原官方要求的基础15433模板，通过受保护DEV_COR_TEST_DATABASE_URL＋project/CID覆盖，standard capture实际仅R2 127.0.0.1:15438/dev_cor_test；没有连接15433或重复启动容器。原2284e2ef候选／tree bd305157干净，source/public165成功迁移及唯一已解决历史通过。一次REPEATABLE READ READ ONLY前置在EF身份门槛停止：当前user authorization_revision3、active assignment2，旧helper要求1／1；原主角色active/v1、10条Grant及所需7项都在。H42、客户资格、后台候选、物理字节及页面尚未继续；登录／业务／上传／账号或Grant变更均0，服务未启、锁释放。原摘要raw SHA256为28efe65d4c9417cf90bcaead082861b0c3c8bfac7dd8a421aca16cdc9c057f49，保留其BLOCKED结果，不称真实页面通过。

只读本地历史核对证明额外assignment及revision3来自已批准Demo A有限扩权和末端撤权：授予回执1→2，末端回执2→3，额外角色inactive/v2、assignmentChanges0/restored=false。当前全旧行快照raw SHA256 9af63453625c852d4ac962f63596d07b2eb330b6f366791d117bbd662bba6db9；从末端afterRole全字段按JSONB文本重构的row SHA256 82342d82aff575729f097ec0da45ec94cec59b784cc5cbb760827bdc6ee267a8，与当前唯一PK行精确一致。额外assignment row SHA256 7f3a2b943165f5b0741b68e4ba38f7fe3da7dd7860eb65682fa0052fc7b73185及14条原Grant逐ID行hash也一致。不是回退账号版本、撤分配或恢复terminal角色的理由；修复只能在隔离分支精确接纳该已证明状态，继续拒绝任意额外角色、重新激活或字段漂移，旧原始失败与回执不修改。代码修复／纯测试及独立复审结果另按固定输入登记，不借此推断页面或全仓门禁通过。

### 两条最小页面入口代码准备（2026-10-17）

本段以下保留原2284输入的历史证据。身份修复代码候选为`0901ffac3035c052fa6d462fbf81439f756a781d`，相对2284仅helper及直接pure两文件；raw SHA256分别为1bbaebada09ecfc74f6c348766a1434565db268c0dab4fb5a961c36e4240d9d8、1cef6af697a25cda0461598392270608cba60eccc46909ba7b3e74cebdb08c40。目标新终态用旧guard先RED，修后直接pure11/11，根tsc、两文件Lint／格式、架构和diff检查通过；原生Playwright同配置发现仍恰2文件2项、无callback／服务。不同Sol独立Spec及Standards两轴均ACCEPTED、C/I/M0，未复跑已过测试或接触DB。一次额外pnpm typecheck先调用backend Prisma generate，在Roaming缓存utime处EPERM停止，原失败保留；本补丁未改schema／后端类型，不改缓存权限或借此声称后端全门禁通过。最终文档／snapshot另按一致性核对，不覆盖未执行的真实页面。

新增共同辅助模块、声明、纯测试及 `playwright.minimal-pages.config.ts`，EF和线索各有独立页面spec及源码/预算纯回归，共8文件；不修改产品、SQL、依赖、环境或Grant。共同模块原三项Important（关键请求体发送前校验、capture前已有指纹密钥、主对象/材料/旧行精确差集）已由未参与实现的原Sol关闭，四文件两轴ACCEPTED C/I/M0；累计八源复审发现登录200后会话绑定失败会阻断正常logout；三文件窄修保证null绑定下只尝试一次原页面logout，成功/失败都以SESSION_UNBOUND退出、保留cause、read0/guardedUPDATE0。原Reviewer确认关闭，八源两轴最终ACCEPTED、C/I/M0。

源码候选`d3158d93c1aff9679adac3b49a198c033fb1b1f0`/tree`8582076b6671d7cddf281c83d6f32fcd4637b8be`已实际执行根TypeScript、架构检查（18模块/164模型）、三份纯测试16/16且无跳过，以及原生Playwright CLI同配置两文件 `--list`：恰好2文件2项、callback0、webServer为空。原生发现不经过会执行capture的protected入口。本轮未运行实际DB/capture/Docker/HTTP/浏览器/服务/登录，未读取私密credential载荷；没有完整verify或NT006新结果。原2ef6a739完整门禁与旧实际业务证据只保留其原输入/原范围，不覆盖本批真实页面。

正式运行仍须另行明确两新session、1新Case、2新线索、2份PDF共86bytes、8次业务POST及4次上传阶段请求；新增账号/Grant0，必要GET和新session自身更新时间另据实际记录。正常注销失败时仅精确已绑定新session可单次guarded撤销；未绑定不得猜ID/按actor批量撤销，也不能标收尾通过。失败trace仅留用户Temp受保护目录，可能含登录态，不上传Git或放普通报告，普通交接只引用路径/hash。配置仍15433与要求R2 15438不符，未经独立运行单不改、不启动；其余准确前置和公证三项推荐统一见[一次性清单](../../superpowers/plans/2026-10-17-next-batch-acceptance-readiness.md)。

### 最小真实页面计划与只读R2核对（2026-10-17）

原EF/线索API双块及11session提案撤回；三个独立准备任务按实际页面/认证源码收窄为两条操作员路径，复用旧EF activeSource与H42，拟新增身份/Grant为0、1新案、2新线索、2份86bytes来源PDF及2个新session。真实表单填写/按钮提交/结果读回/刷新和本轮精确session注销纳入同一范围，不把API准备或旧14/8项当页面验收。原source凭据仅核普通proof及受保护引用，没有打开私密payload；live资格未核。认证源码核得logout失败finally也清cookie，故失败收尾只允许登录前后差集/内存cookie摘要唯一绑定的新ID，正常logout后只读确认，必要时一次同ID完整谓词guarded撤销，不按actor撤旧session。具体步骤/新增写入和公证三项待决仅见[一次性清单](../../superpowers/plans/2026-10-17-next-batch-acceptance-readiness.md)。

本轮唯一live动作是过滤 `docker inspect`。普通令牌因配置文件/pipe Access Denied失败；同一只读过滤inspect正式审批后exit0，原完整R2 CID running/healthy、project/service、固定17.11镜像、127.0.0.1:15438和持久卷全匹配。四个运行目录.env.test只读解析为test/15433；未改配置，未输出凭据/Config.Env，未连接DB或执行capture、登录、HTTP、浏览器、服务、迁移/resolve。观测源 `.local/next-batch-preparation/r2-readonly-observation-20261017.json`；它不证明当前ledger/身份/后台清理资格。新增窄页面入口尚待工程准备/审查，正式运行仍需新额度；不重跑完整verify或已耗尽业务。

未参与实施的readiness165_review独立核认证/启动/表单源码及唯一计划和三份状态文档，两轴最终ACCEPTED、C/I/M0；线索caseType/needDisclose必填和对话框不显示身份两项精度finding已补闭。本次自7ab3e257起累计差异仅4份文档及对应快照，无产品/测试/配置/依赖变化，执行文档格式、Spec（59REQ/69AC/11BQ/60SD）、diff与严格context检查；不重复EF33/lead13纯例、类型/构建或全verify，不冒称新HEAD实跑旧门禁。静态方案可收口，实际执行仍BLOCKED于入口代码/审查、配置、live前置及新预算，不现在提交一个可直接启动的运行审批。

### 下一批回执追溯与创建时事实保护（2026-10-17）

本地0565acbc之后，三个独立子任务只读追溯EF／线索原回执、静态计算新预算并核公证UXQ-02范围。EF三件原文件及官方Resolve-result／实际validator proof在原ef001-integration中存在，原hash、1000原字节与官方命令窗相符；本目录的缺失属于ignored路径未接入，不是原操作未成功，不需要重resolve。线索固定terminal回执在已查workspace中未找到，原e487运行单仅为计划，实际对象是否存在未查，不能补造创建历史。三件文件精确路径、hash及来源任务见[确认清单](../../superpowers/plans/2026-10-17-next-batch-acceptance-readiness.md)。

独立Sol发现lead回执旧v1固定161，若在public165创建新terminal仍填旧模板会伪造创建时事实。原Owner仅修改helper及纯test加入v2 NEW_PUBLIC165：固定165／十pin、当前candidate／runId、六类目标全空before、原固定五身份关联＋四Grant的after及canonical差异SHA；v1原校验和旧候选拒绝保持。旧guard对合法v2的RED拒绝保留，修后13/13纯例、两文件Lint／格式／diff通过；同一独立Sol补审ACCEPTED、C/I/M0。没有实际创建、补写回执、恢复权限或数据库连接。与0565相比，产品／SQL／E2E、TypeScript／声明及架构输入未改，不重跑旧43纯例或完整verify；当前纯证据为EF33与lead最终13，不能称真实165功能通过。

只读配置核查发现主控及几个旧运行目录.env.test为15433，R2 helper固定15438；本轮无capture、Docker、DB、HTTP、浏览器或迁移，未读取私密登录载荷；配置只输出目标身份，不输出密钥。新预算是待确认提案，原额度为0。EF首项没有末端logout，11个本批新session精确撤销步骤尚须固定和审查，不能在此之前开始两个执行块。公证只完成范围／Owner核查，三项业务决定未冻结，不派产品实现；没有派发拒绝或绕路。新提交推送仍需单独明确范围。

### 公开仓库代码备份与下一批验收准备（2026-10-17）

用户明确替代此前“仓库必须私有”的条件，授权将固定候选 `0b90e9c3e28f7a1a3cf6cd195728f6a6da43cc52` 普通推送到公开仓库 `https://github.com/glunek123/ip-bp` 的现有分支 `codex/ui003-quick-actions-integration`。本次push exit0，随后ls-remote实核目标分支精确该SHA；main仍为 `b14752cad1f60cd98c609d0a2b436d7ec1d72cef`。备份范围166提交、283最终差异文件；没有强推、main合并、部署、迁移、数据库或登录状态上传。新一批本地准备改动不包含在此已完成备份中。

检查读取待推送1594个对象中的661份文本blob（61956181bytes）及288个历史路径，无二进制blob、环境文件、数据库归档、登录状态或运行产物路径，无高置信度私钥／令牌命中。`tests/e2e/lead-list-workflow.spec.ts` 的固定口令已存在于远端基线；完整tracked引用只见测试／fixture文件，fixture生成合成账号密码哈希并受test模式及隔离库绑定限制，当前本地.env.test不含该值。按用户明确的合成测试判断范围接受，不展示口令、不做登录有效性实验。模式检查不承诺排除任意编码内容；不把公开状态解释为凭据有效或账号被入侵。脱敏Git回执见ignored `.local/delivery-backup-20261017.json`。

本轮接续完成两个独立HTTP验收helper的严格165源／applied账本检查与纯回归，旧owned161专项不放宽。EF纯Node33/33、线索纯Node10/10，覆盖实际165源字节、各关键pin同步篡改、缺项／额外项／未完成与异常历史；原actor、Grant、业务限额、产品、SQL及E2E场景不改。根类型、定向Lint／格式、架构（18模块／164模型）、Spec（59REQ／69AC／11BQ／60SD）及diff检查通过；未参与实施的Sol累计只读审查ACCEPTED、C/I/M0。新owned测试fixture仅临时复制历史161前缀，不是当前库的运行结果。

真实执行仍阻断：本目录缺少 `.local/ef001-evidence/official-ef001-resolve/{receipt.json,stdout.log,stderr.log}`，以及 `.local/uxq03-evidence/lead-batch-push-terminal-creation-receipt.json`；没有生成替代回执或读取私密credential。实际数据库／HTTP／浏览器、账号／权限、文件和新业务写入均未执行，旧预算全部封存。下一运行单须分别明确合法对象、登录次数、账号／Grant新增或撤权、线索／事实／回执／审计写入、文件数量／字节、并发和故障注入额度，并先核原证据及当前状态；本次代码准备不授予这些权限。正常完整verify包含NT006真实数据库专项，故本轮未运行，也未把旧业务tree的完整门禁冒称新tree通过；新候选仅有上述离线准备证据。

### Demo A有限批准序列闭合及原证据边界（2026-10-17）

固定业务候选2ef6a73919dbf7eb739d54a2fe63ddfa735c8727/tree50effa5496ba4b86e7a7d44e0ba8ee9dd85315ac的正常完整verify已实际通过工具139、前端2510、后台2351、NT006及双构建。后续仅ignored执行器定位、等待和采集修正，tracked源码/依赖/环境与产物未变；成功证物、财务前序、上传和导出均不重复。原owned165、161备份/92份无覆盖复制、官方165部署及3role/3assignment20Grant的既有成功独立复用。本批业务是多次停止后按原捕获断点续接的累计覆盖，不写成单次整套浏览器绿色运行。

最终完成目录为.local/ef001-evidence/demo-A-f19-continuation-2ef6a739-20261017/。completion-summary.json SHA4bcf781247d3a54b72fe411d0a1673ee3756b2d4043163c449e33bff6a6ca91d；completion-manifest.json SHAd6a7cb7fc9c571c21a88903fb8cf4891feb6c0f0a64488f075998c0f93320876的26份文件逐bytes/hash复核相符。主控独立按实际私密捕获pin重算54个唯一step：34成功、13预定拒绝写、6失败GET、export1；三组F21/F03、F22/F07、F23/F13的method/path/body/key/status/result精确一致，原意外F06/E07的500及所有执行器失败保留，不混入预定拒绝数。正常A登录4/4，原计划额度全部耗尽。最终真实protected只读专项1/1 PASS、无业务HTTP/登录/服务，确认原165表旧PK和87Case/92CV、安全/账本/序列及原两根184次文件校验保持；新凭证2份共210bytes，材料引用冻结不删除，仅新sourceRole inactive/v2、assignment0变更，其余角色和旧权限不恢复。服务/端口/锁均释放，无后续执行。

最后managed用例exit1原因是脚本误将内部缺部门权限的G06期望为FORBIDDEN；实际原GET /api/v1/evidence?page=1&pageSize=1返回403/CUSTOMER_ACTION_FORBIDDEN。冻结EvidenceService先核内部账号再调用authorizeDepartmentAction，冻结AccessControlService该路径由forbidden()返回实际码，主控已核同一原响应及源码。因此允许只校正脚本期望并离线核原响应，不重发G06，也不把原exit1改写为exit0。final-readonly结果原元数据重复sha256键导致来源hash标签覆盖，G06-source-code-addendum.json分列两源hash；主控逆换字段名后与实际执行前副本逐字相等，证明未改任何断言，原结果保留。

F12/F15两次PUT的原二进制request body与上传response body在Playwright中未暴露/未留存，bodySHA明确null；现有materialId/CV引用来自实际proof请求及只读提交事实，不能称原HTTP响应捕获。binary-evidence-gap-register.json保留缺口和provenance，未用预期File字节填造raw body、未重传。实际文件证据独立闭合：原选中105bytes文件、准确draft/material/CV与费用v2/v3绑定、存储真实bytes、readonly按钮完成下载产物size/SHA均相符（P1 SHA d3089b6013877e493a2139d7f0151545e169cfef11101a680f0fd5fe6507b1e5，P2 SHA b4a540f146a900ed5ec02af9a494cf23decccbecf203c662756a27c145f44bf2）；主控再次核实际下载文件。这证明业务附件一致性，不补齐原上传报文可重放证据。

操作员路径已实际观察：来源/案件自动带入，同案公共日期一次录两费用、两行批量发起，凭证选择后自动保存、替换与明确移除，账单原500时选择/日期保留且原请求重试后成功；净额行访问凭证仍需一次展开原始费用，可后续在原UI范围讨论更直达入口，不增本批点击或数据。协议拒绝不冒页面错误恢复。未覆盖多客户/跨案合单、PRIMARY律师/门户、KNOWN自动费用来源（本次Q0）、新出证双初始化、多CV/同组多纸本、并发/流中回滚、真实24h超时及大数据分页；不把本批有限内部验收记成全量Demo完成或生产/预览发布。本次收口只改状态、验证引用及对应快照，业务源码与2ef6a739相同，复用其实际门禁，不重跑已耗尽预算。

### F06真实关闭与E07精确冲突修复（2026-10-17）

c1e56d8d正常完整verify实际PASS（139/2510/2347、NT006、双构建）。F06原body/key经页面原请求重试201，唯一账单/2明细/100元、发起占用及审计独立核PASS；F07撤销和F08重建201，现2账单4明细。随后E07预定409实际500，requestId 3f294c60-c316-41bc-9cc0-6a7a55f5df76，settlement-ledger.js:31的已占用检查抛普通INVALID_BILL_SELECTION；未新增第三账单。原summary .local/ef001-evidence/demo-A-bill-recovery-c1e56d8d-20261017/stop-summary.json SHAfc1fa9fe4b0045ea57970a2842e97fe513a2e17ab7356a32431448e756152cc9保持。原Owner服务仅新增一行明确占用→changed()检查，位置在授权/锁/原成功key回执之后、billSelection和编号/写入前；不泛捕获未知错误，不改SQL或原事务阻断。直接19/19、backend类型及静态PASS，原Spec/Quality均ACCEPTED C/I/M0，作者1a5c79b0；清单SHA22656acc03e1c580de4d8c14c7815dc1923d5d1fa5fc738c27cce2aee4d29d2f。真实E07恢复Pending，新产品候选须门禁后仅续原E07和剩链；余15成功写/5预定拒绝/6失败GET/2登录，角色未撤权，无重复前序或导出。旧行及92份文件保持，旧500证据不覆盖。

### A实际运行与F06最小修复（2026-10-17）

643d1e8e/tree5dca1c2f正常完整verify工具139、前端2510、后台2347及双构建通过；protected owned165 1/1、334整文件发送/4故障原字节重试、独立公有保持均过。新161私密备份及TOC、92份missing-only无覆盖复制、一次官方165部署和独立旧行/账本/catalog/sequence/文件保持通过；仅批准3角色/3分配/20Grant及指定3账户授权版本增量。总摘要SHA260a334113ffd1d1fdc0ae84a627b05da3a9077e27f401a6ee12440d264af2ba。后续ignored加载、响应关联、下载读取错误均保留，未改产品迁就脚本。最终证物13成功项已累计完成，实际B/C按钮下载各46bytes且SHA匹配；页面案件来源自动带入、同页编辑/批量/导出已验，不把协议拒绝冒充UI输入恢复。

财务F06于10:54:49.874Z返回500，requestId bb33828c-8063-47d6-b839-543245fd1d98；已成条款v1/60和40两发起，账单/明细0。safe摘要位于.local/ef001-evidence/demo-A-tail-download-643d1e8e-20261017/stop-summary.json，SHAff571519707f2c9362a3f2fd063e517f00672004b5fb2908f63f5ba249bf38f0。失败页保留勾选/日期并显示结果未确认和原请求重试入口，未点击。指定PG时窗为空，不猜DB码。原Owner用实际生成Prisma客户端及永不连接的adapter复现原嵌套payload在SQL0报Unknown argument departmentId；修复仅删子项departmentId/side并用精确生成类型，由父账单复合关系赋值，原授权/锁/幂等/占用/audit顺序和数据库FK不变。作者7af48f12两文件15例、backend类型及静态通过，原Spec/Quality均ACCEPTED C/I/M0；manifest SHA6a0d2df31c2ebcfb52672af2de62bec6ca7b8867c338c1045dbebdfc7ee8d0a1。这仅证明参数修复，实际F06原body/key恢复Pending。新业务候选须所属门禁；不重复迁移、备份、角色或前序成功写。累计16成功写，原余18成功/5预定失败写/6失败GET/2登录，export余额0、角色未终结；旧87Case/92CV及安全和文件保护保持。

### B三项真实收口与A受审候选固定（2026-10-17）

原Runner在047d256c4599e87123df459adb9323741acdf5ba/tree9355d51c9c5ede4b509b0add49f16c7a4e707105 protected发现3项，唯一正式3/3 PASS、skip/retry/flaky0。390x844的document宽390，Panel右沿380；原S1复用，历史及两tiny版本真实按钮下载、正常刷新/退出重登、桌面预填取消、readonly无写入口、revoked403且无案件菜单/EF均过。实际133 API请求，业务nonGET及禁止尝试0，仅3正常新login/1logout，累计A6回归S1+S2+readonly+revoked=4/4。独立153表旧PK/87Case/92CV/账本catalog序列和全部旧文件保持，仅S1正常变动及3批准新session，服务/端口/标准锁释放。summary位于ef001-integration/.local/ef001-evidence/browser-readonly-047d256-20261017/final-summary.json，SHAd3264e8869f6ede7241c8eaeec78439aba0ea7c8c88bfd08c4d5fe3b4ac10b4c；主控已实际查看封存390截图SHA bc2f73124835cca05eeb5c5858ee177989ce079324ec9a13badd6da24fa5bdbc，完整文件名在按钮内换行。所有旧失败保留，B预算封存，不重跑EF14。

A适配器v1独立Standards审两I（静态依赖在准入前加载pg、逐个DROP后report可能丢现场）已返原作者修复。v2顶层仅Node builtins，准入和自身165源校验后才动态加载驱动；清理前证据记录成功，两DROP同事务，公有复查与第二报告在COMMIT前，失败确认ROLLBACK保两份，commit/rollback或连接结束不确定明确unknown，不谎称保留或提交。17纯例、根类型、四文件Lint/格式/diff、离线CLI1文件1项callback0均过；两原Reviewer对固定v2窄补闭均ACCEPTED C/I/M0，未重复旧135源码审或真实DB。v1原字节/RED保留，v2清单SHA2a2197eba1b579af83dc5047e84066ed03eb87103768a7a18572038ae34337a4。

四文件原作者ead5b400683c2b3b65be6cdb715c4340824c9f52，主控逐raw集成a9ffb2d378d4f865d7cba667c7973b7f684322b5。mjs SHA8af1e3da0268add34e2998c08e82d26ee0bce486f81fe290b37ab0151d28f43b，d.mts cf440d98770ce574a1a0ce6604e08eb058422b5b877fbdef17bc3768c2c2cb82，pure.test 08e3c3455159412a0b5192dc61221ed651c2997b22c8ca2fd3fafa7782ed4fd5，spec aa5462309f098153509af06969442100e42129a9d7d9e3b5872b5b7c7ce0a67d。原135产品raw仍同120249，新增仅本专项4文件；作者树缺0950、164链无参拒绝是既知限制，主控自身完整165链才是运行候选，正式入口无fallback。证物离线Page helper五文件清单SHA f6b34653a4d78c36895e02b260ea2fd80e97790f9491cc9e076f90060802ef6b，原Runner已接线核符；4session/3role20Grant固定计划独立于B，尚未执行。

A后续原唯一Runner先正常完整verify（含真实NT006）和protected单owned165，成功再新161私密备份/缺失旧文件无覆盖复制/一次官方部署及独立保持核，再限定权限和原34成功写/1只读导出/固定失败；操作员体验复用同一次页面，不能靠隐藏API补普通用户步骤或把协议反例当页面失败恢复。当前未有A真实DB/HTTP/Grant或Demo体验结论。

### 两范围直接批准与单Runner恢复（2026-10-17）

父级转交可信transcript：用户07:50UTC消息Sentinel_b78772dd69a081919383d5135db9c0d3“允许，都允许”，分别回应Sentinel_1424a392fc4c819184dcf21f18c2cc0a（Demo冻结最小申请raw fc74d558e73cd920f7d1b151669c70c62bed3ff6c85754029fd6facf8395f570）和Sentinel_53f85111c59c8191a22d173a2e948af0（2fd84bd2接原树并续原批只读）。未扩大至生产、人工预览或原EF14重跑。只读B先于public165的A，唯一原Runner01a13e67继续，避免共享R2基线被并行改变。

核原Runner idle、a6clean、标准锁不存在及3101/5174空闲后，主控正常审批一次cherry-pick2fd84bd2076b062a58489963c9a51f137a50af14成功，原ef001-integration新HEAD047d256c4599e87123df459adb9323741acdf5ba/tree9355d51c9c5ede4b509b0add49f16c7a4e707105，两raw与受审源相同。GO为.local/ef001-evidence/runner-047d256-readonly-approved-go-20261017.md；原Runner已核前置和S1有效，累计1/4，尚未回报新正式结果。不重复作者21或完整门禁/构建。离线原shared Task准备专属4文件owned165 adapter，原evidence Task准备页面选择器；两者不连接R2，Demo后续必须固定受审源、正常完整verify后才owned/备份/public部署/权限/真实页面。批准及顺序回执.local/shared-demo-contract/demo-approval-and-serial-schedule-20261017.json SHA29d713bafA660afcfb33039863393022fe95dacf7dbb9c811075ce01deb64e09，旧申请字节保持。

### EF移动端文件名溢出定位与原作者两文件修复（2026-10-17）

运行树a6ff78953dc6d19ef7354832fe96de12f94ec918的真实只读续验复用首轮S1，已通过真实菜单开关、历史current与两版本展示及43/39bytes两次精确下载，随后390px视口document.scrollWidth=454失败；首项FAIL、其余2项未执行、retry0。独立只读DOM专项1/1确认Panel右沿380、当前文件按钮右沿408.72、历史按钮右沿454.34，内层span与按钮white-space:nowrap。DOM summary SHA3d59b5871daa1b800fe12c0ab7f1e04e0d17c8a890f75d910003edb98c2771f7；实际查看最后390x844帧SHA df5a55586246bd81fb5d6ebc8f57a8d7eaef9fa31da704b6929f48ab4fdbca29。没有额外登录、下载或业务请求用于DOM专项；累计S1一个会话，153旧表/87案/92文件及其余安全数据保护保持，服务和锁释放。

原Panel作者Task 01a142df-4a06-7d22-9207-dc1855def946通过本地通道恢复，仍独占ef001-frontend/codex/ef001-frontend，无新作者/工作树。基线87ac6ac3702e9a549e12bcf8fa15d941122f671d，仅CaseExecutionFilingFollowupPanel.vue/spec修复：三处文件链接增加局部类，scoped样式允许完整文件名在按钮内换行，不裁切文本、不改JS绑定/材料与版本ID。逆去三类属性及末尾style后Vue完整raw恢复基线SHA173016528c6a9ebeae81783e5386e03ec20de29a04986411d10ce89322cbb9c7。最终Vue SHA ba99a43bbffde36717fc404062643bb8a33d66c499567b0ce09d48dc7970163a，spec SHA c60d325ccbe22528fd1c5c64b21c0bfd6a59ad6b257b8f198a002ffd0030257c。原作者21/21、frontend类型、两文件Lint/格式/diff通过；既有Reviewer对固定两文件窄Spec/Standards审均ACCEPTED、C/I/M0，未重复全量门禁。

主控正式代提交2fd84bd2076b062a58489963c9a51f137a50af14/tree343b62fbe73ecef7d416d64b44af68d1045883ad，作者树clean。运行a6未接新代码，实际修复后390px效果仍Pending，不能由JSDOM或源码审替代。给原作者的提交回执通知被自动审批以缺少直接Task消息授权拒绝，未送达/未重试；交付通过平台本轮通知。Demo执行申请仍独立Pending，未新增DB/Grant/HTTP/browser动作。

### 原运行树直接许可、a6只读首失败及离线预算确定（2026-10-17）

用户在Sentinel_f0aec826ef388191ba47f442dc60d136明确允许原目标建codex/ef-readonly-shell-browser-acceptance并接75a4；核原Runner idle、clean676/无锁/端口空闲后，原命令实际一次exit0：a6ff78953dc6d19ef7354832fe96de12f94ec918/treea75f1d26d46ae97eb70ca9b41f641d846d0c33b2，三raw与75a4相同，backend/schema/依赖/env未改。旧两次自动审批拒绝已知未执行记录保留，不再是当前阻塞。新受影响AppShell/router/CasePages225/225、前端类型、Vue/TS lint、三文件格式/diff及ignored noEmit过；CSS无ESLint配置，实际由格式检查覆盖。protected恰3项callback0；正式仅一次首项FAIL/另2未运行/retry0，5秒getByRole(退出登录).toBeAttached在正常登录及列表200后未匹配。未到菜单/历史/下载，不把认证200当页面通过；完整verify/DB/原业务HTTP未重跑。

原Runner summary SHA38c6efa8f6713e932950f488389bc95cdb39d4eaf0887ca3f35d27bedd42ac59、129项seal manifest SHAb0691d0ecac90cd49766ba1010b3a44436fa90c12e67e4c5c2fce01351482b10；保护153表旧行/87案/92文件及账本，只有1新增正常source session、业务请求0。主控只读原私密trace433d3abf及实际查看最后390x844 frame SHA b4cfef924f6f57ba4496d5a9af6659511cdaf1313f3bedc10a45c3aced8b4117：cases渲染，aside data-open=false；trace有logout节点，CSS visibility:hidden解释role默认查询排除隐藏节点。诊断SHA43c70968450fe30f27f544bc084c70ba0dde3a0e667e487331464fe2f4f565b5，不认产品缺陷。父级新指示仅修真实toggle点击路径，窄续单SHAbba56452fe3cf9c2ccc05b2fd2dba4c3d9663ee0c4e0f2f2d1de7305c8695020已交原Runner：优先复用同一首轮真实Login创建S1、累计≤4session；不能安全恢复则停，不加超时、不fakeAuth或改产品、不重包129份证据。新正式结果Pending。

三个原Owner仅离线补定Demo申请：财务21/证物13成功写共34（48余额14封存）、只读export1、指定失败写13+失败GET6，auth4session/source2-readonly1-foreign1/logout1。3Case/0新身份、3run角色20Grant/3assignment，指定3用户authrev最多4次变化；1terms/2launch/2bill4items/取消1/3fee/2PDF≤2KiB、1group3item0paper，迁移两paper仅状态投影可改。owned2schema/4个内存P0001 fault/4ROLLBACK/4原字节重试/334原文件发送，旧161忠实镜像沿既有copyOldTables的TX-local replica，写仅owned、公有仅读，origin恢复及逐表hash/FK必须核，权限不足不增权。计划financial SHA41bb3e190fc753f868ae2a1a463a00c0da7cc9d0981e958369ab05c69f7e9d95、evidence SHAac7bb91271f4a2420ff059cdd9d9846bc42553f75216090dbca6d6051845de4a。没有新的22artifact盘点或任何Demo执行；165/备份/复制/权限/业务仍待完整一次审批。

### Demo累计Final Review、259项宿主及真实只读盘点（2026-10-17）

本地主控75e92ec6基础上合入已审结算35源2b8dd5e8及其证物前后端、双initializer、批量推送依赖；产品源无merge冲突，唯一context快照冲突保留主控后据已解释差异重记。组合首轮Final Review如实REJECTED I2：证物页面未注册route/menu，结算导航非403错误静默隐藏。原共享Owner仅AppShell.vue/spec、router.ts/spec修复，manifest SHAfc4d5868d5df48da4a62139a458361eaca5abd7dbea5415396c5890b1e0c401d，源提交44ab891e8808e478055ef67ca0ede32dfafe5145/tree9bde3b108336454320d6e3fa41f62c1ee1e6df74。四项raw依次8d9a4791/3bf20516/1fb0948e/07690258；复制前previousSha256全部匹配，原134清单其余文件逐raw保持，CSS2fafce97不变。两原独立Sol在实际主组合核4/4相同后累计Spec/Standards均ACCEPTED C/I/M0；旧拒绝和RED19/128pass、1个RED未消费deferred错误保留，GREEN147无unhandled。

主组合实际检查：正常prepare:prisma退出0（Prisma7.10，无DB），check:fast:prepared退出0（18模块/164模型、两端及根类型、全仓Lint），旧宿主230/230；最终四文件接入后AppShell/router/CasePages三文件259/259退出0（9.01秒）、前端类型、四文件Lint/格式退出0。旧230不充当新259；其余未变输入已有证据复用，不连续重跑。新组合完整verify/NT006/双构建、165迁移/PG、财务/证物真实HTTP/浏览器均未执行，不套用EF676完整门禁。

原Runner只读盘点：固定67625b9/treef6b18e96及原精确R2/public161，单次标准锁内REPEATABLE READ READ ONLY/34 SELECT，result SHA28d6e5b14e28455d83203a60573227a7eb6b0ef0c0383359ff58a44e32997fa4，manifest SHAd7ea7864635b927d5622d979d15b839c206a59938c947eb69a9b0468ab541e78，主控回读22项artifact bytes/hash全符。14新Action实Grant0；1200投影Q0（8PENDING排除），1300完整N2/异常0、预期8行，两证书各1CV。全87案无当前PRIMARY，主部门22案仅同一客户，无激活绑定LAWYER；现有CLIENT/NOTARY凭据没有已允许私密引用。0写入/新session/服务/HTTP/部署，ledger与安全摘要前后同，锁释放。后续最小申请不得称两客户/两律师/KNOWN源/新hook完整覆盖。

运行树冻结是独立审批阻塞：对原ef001-integration67625b9创建分支并pick75a4，第一次及父级补充证据后唯一原命令重试均被自动审批拒绝，目标仍clean/原分支，操作未执行；第二拒绝receipt SHA dbc48059e8ff06c506f6b3dd7394c9f8bb76bc6ab4f12c8c2f02643b6fb700b6。用户针对该精确目标的确认待回；不换目录绕过、不复验产品。原只读浏览器2PASS/1FAIL、旧全部失败与预算使用保留。以下为历史记录。

### 导航I1补闭、运行树冻结拒绝及结算v2固定（2026-10-17）

UI新三raw AppShell.vue b984fb700d392d7e2c81c579d6a47f1eea8acf96e8afa54a14c25a56a338b973、spec2c38cb25d558865254ccd4e303ae52af58f3f79be572eb7ddeb24612729bb99e、styles2fafce97931aaa942bc4ddbc8415f465e8650fd9f5b9f699199b8f40e829e4af逐项匹配；原两轴补闭C/I/M0。非403保留已验证入口、明确失败提示与主动GET重试；首次失败不伪授权，403仍锁同授权identity，Abort/卸载/旧identity不污染，retry loading防重复。真实5反例RED→82/82、前端类型/Lint格式/diff通过，73旧记录保持。三文件源提交75a4e611/tree9bc4e297，主控单接3e6dcb33；不冒真浏览器PASS。

自动审批拒绝在原ef001-integration创建验收分支并pick上述3文件：理由是原运行树冻结限制仍有效、建议独立树。CreateProcess前拒绝，操作未执行；未改命令重试或间接绕过，后续只读确认原clean67625b9/treef6b18e96及原分支保持，无服务/DB/业务/Grant变动。下一运行需父级明确解除该冻结用于此只读复验，或指定另一合法运行目录；已准备、已审源码可复用，旧浏览器3项2PASS/1FAIL证据不覆盖。普通错误与审批阻断分别保留。

结算原35候选v2 manifest49bc708a0d57f5c3405f956dfecc22dfc0f9eeca3132b5540f9faf16e4994184，9文件替换+v1余26逐raw不变；组合指纹a462d10a6a12f1153ae36caa75da5122a163596f283bed668c457c379ed832f6实算一致。原Spec/Standards均ACCEPTED C/I/M0，I1六fees端点201/200响应schema与真实服务一致；I2中心净额不可选择/编辑/凭证/删除，完整sourceRows保留各真实ID/原额/状态/精确proof，caseId与零净额原行不消失，全匹配选择/跨页确认只用真实源行。RED旧后端9/前端2失败封存，最终18后端/25前端及prepared types/9文件Lint格式过，未重跑原26输入。代提交2b8dd5e895aa71a50e694426c66da061aadc6ddd/tree8e485a1a37dc10b2470275a48425b3b4b25a42be后共享树clean，不混schema/SQL/EF；尚非与最新主控累计的完整门禁或真实DB/HTTP/浏览器结果。

### EF既有只读页面2PASS/1FAIL及导航后续（2026-10-17）

固定67625b9/treef6b18e96真实protected collection3/正式3，workers1/retries0/maxFailures1，2PASS/1FAIL、无skip/flaky；summary SHA7fd57cf75cc56bd501cf03be8379a93963c9fae3d759e260332f9482a771566e，主控逐项核101份seal证据bytes/SHA相符。正常source登录页、现案历史/当前、两个已有版本真实按钮下载（43与39bytes，SHA精确）、刷新/退出重登、反馈预填取消和补交空表单取消均通过；readonly读取与能力false/无写入口通过。撤权账号登录200、案件GET403，无EF数据与写按钮，但案件菜单可见，故该项按原GO FAIL保留；菜单本身不构成数据越权证明。

主控实看既有1440及390截图：后者是同登录态从桌面resize，导航覆盖/裁切内容的现象成立，尚未证明根因或冷启动手机情形。原前端Owner只获AppShell.vue/spec与app-shell.css最小核合同/样式修复权，独立树从03329e64切分支；执行单SHA48feb01224859ab944ba6fe6d5728afefa63177ac54e93475bfd5d74535eece1。发送原Task返回AbsolutePathBuf路径错误，未送达；须父级原通道恢复，不把排单写成实施完成。后续必须真实点击窄回归，不靠DOM替身声明布局通过。

本次独立保持核PASS：153表5492旧行、87Case头/92CV、账本161+原resolved失败、全安全/sequence/所有物理版本保持，仅正常auth_sessions+4；业务对象/Grant变化0，预算余额仍0。133个API请求中仅正常login4/logout1为非GET，业务写请求0/500为0。标准锁和正常双服务释放。旧门禁/双构建/T1/N9复用，未重跑接口或迁移。

证物前端9文件最终manifest e26ca238已原Spec通过、原Standards空导出finding闭合C/I/M0，仅API/API测试/挂载页面测试3文件相对前版变化，其余6文件不变；无效filename/CSV拒绝，有效CSV原bytes含BOM/空白保留。受影响RED8→GREEN27/27及类型/静态通过，旧117结果只绑定旧候选。源5320ac11/treee08fb39a提交后clean，单接共享树1c3c1026并逐项证明原结算35WIP未变。该35manifest49d2265d暂拒收：Standards C0/I2/M0（费用新端点缺响应schema、净额首笔冒真实操作对象），Spec按BD-05及fees Spec窄核由原通过修正C0/I1/M0，其余范围结论保留。样品100/退20显示80却发起100，不能隐藏退20及其凭证；要求净额只读展示、各原行ID/原额/状态/凭证独立可读可操作，净额0亦可查。已返还原Owner费用/OpenAPI/API/页面及纯投影必要文件做最窄修复，新候选待固定复审，不先提交。均非完整Demo真实业务验收；未混入冻结EF运行树。

### EF161原十四内部HTTP场景分段覆盖完成，预算耗尽（2026-10-17）

原Runner final-summary.json SHAb27a126b771c3834038d348b9c998d1aade1d816f40dc660aa434cc9a887edf0由主控核收，primary+post-process seal共134份证据逐项bytes/SHA相符。固定67625b9/treef6b18e96原source/build保持；新正式T1/1、N9/9均exit0、skip/retry/flaky0。T03:36:09.702Z/14.16秒，N03:37:38.757Z/91.61秒；两次独立closurePASS。既有完整正常门禁139/2378/2172、1241source/761build复用未重跑，未重新resolve/deploy。

| 原场景范围                                                                                           | 实际证据如何闭合                                                                                                                | 边界                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 四命令、原申请保护、未知结果同键和跨finish恢复（1）                                                  | 初场景四命令/读取/文件已提交，fixture结束依据400保留；原首案续验完成finish201和四原键201同回执/四新键409，原事实快照相同        | 同原案续办，不重造首案或声称原14初跑PASS   |
| 无本地申请的纯外部读取、无需伪造反馈正常结束、独立revision/共用key/路由锚/日期DTO（3）               | 2d670509的Part2前三项实际PASS，未重复运行                                                                                       | 原Part2第四项409失败及9未执行报告保持      |
| foreign/readonly/撤权前置授权（1）                                                                   | 原readonly403/foreign404，加67625b9的T尾段：错lawyer门户403、readonly能力全false、唯一自身role撤权、原operator原成功body/key403 | 合并分段断言，不把T额外计为第15业务场景    |
| 全局UUID占用、真实锁单胜、四命令各写点回滚、上传与保存隔离/精确复用/陈旧撤权、MIME与50MiB、池10（9） | N仅九个此前未执行标题，9/9；原16新对象故障点/超限拒绝按原断言实际执行                                                           | 预期故障保留，不重试测试、改期望或删除事实 |

T只批准原operator自身roleb3fa20e6变inactive/version2及updated_at，assignment/member/user/Grant不变，三正常新session为仅其余差异；原feedback/audit/ref/receipt和业务行保留。N原有行仅正常案号计数器2026-10-17 last_value5→16及updated_at变化；其余旧PK、完整161账本+唯一原resolved历史、H42/终端inactivev2/dadd唯一revision1/Part1保护通过。旧32文件两端和新60全部真实bytes保持，124个物理副本核对，一份50MiB、59tiny共3033bytes；所有原故障结构已按限定新对象finally关闭，无额外手工清理。两正常managed服务和资源锁已释放。

累计21身份/171自身新role部门Grant/16案/60成功文件全部用满，业务对象余额0。下一只读browser GO SHAa37c66f34f3569d0396767d20db19ad2e246578e2835019700c2eaf78c52bf86已成功送达：只原三身份/两案，真实页面浏览、刷新/重新登录、未提交表单取消、权限入口与两个已有tiny版本按钮读取；无新业务facts/CV/draft/role/Grant，最多四必要正常session。真实页面结果尚未收到，不能由APIRequestContext的HTTP测试推断浏览器。写入式页面的新增事实/文件需求须独立列明，超原预算先获许可；PRIMARY合法律师正向/脱敏、真正24h过期拒、上传claim/finalize流中争用及非current版本合法来源等原已声明缺口保持，不以十四内部场景覆盖掩盖。

### 已集成、待集成和待真实验收的边界（2026-10-17）

已集成独立候选：EF67625b9已验源码与全部既有事实；Demo共享schema/模型V3、费用来源/proof与精确材料读、证物后端与原出证双initializer在共享开发树5b5c23a2和证物树0cbb9d41已按审查小SHA交叉接入，后者仅源码/聚焦组合证据，不冒真实业务。

待集成：结算领域/API/UI/公共AppModule/router/menu最终候选；证物前端9文件（原117项/Spec通过，Standards空CSV误导出finding原Owner窄修中）及两说明。均未混入当前冻结EF运行树，不自动扩大R2预算。

待真实验收：Demo新组合完整门禁、1150/1200/1300独立风险与正式部署方案、真实源数据/新Action明确合法身份、HTTP及页面；当前public161不含这三迁移，0真实新模块Grant。人工预览/远端发布仍冻结。EF源码本地主控集成已逐一比较全部1090份非docs原始输入与已验67625b9，原始字节差异0，文档差异只以本轮Spec/格式/strict context重核，不把main文档分支误称该独立运行候选的重跑。

### 门户修复正常完整门禁PASS；原权限尾段与九项GO已核发（2026-10-17）

固定clean67625b96991e4fcc2f966b0c8df4c2b70e74e5d7/treef6b18e96正常full verify实际一次exit0，03:16:29.449Z至03:21:26.271Z（296820ms），工具13文件139、前端127文件2378、后端126套2172，实际标准锁owner及双构建证据成立。gate-preparation-summary.json SHA115279805500376979a2662bcd62e6fb77f64631bfccb20573c476fa66ba9f4c由主控核读；before/after153表4837旧PK行/完整161账本+保留resolved原失败/原旧32两端与新11真实文件/H42/终端/Part1/dadd一致，结束锁释放端口空闲。新1241source/761build manifest固定，不再重复门禁、生成、构建或迁移。

准备源manifest a3500456bc5f02b2a6bf05034624a8969d5fae4fabd7a4d00eeb507757c9fe27的6份TS/config/reporter由主控逐raw核同并实际读审；单role执行器SHA9048d09a4dc7b582de910ac7349a14cfd1eeb353be5d51276366e11083e38e9c，定义期无业务动作。实际protected collection权限尾段1项及原未运行9项均exit0/callback0，最终隐私安全断言改动后只重做受影响tail collection，原准备失败/旧文件均保留，不冒业务PASS。

准确formal GO runner-ef161-67625b9-formal-permission-nine-go-20261017.md SHA065f557dc0a3a2397acefa0db1f3ecc2c926bd4c227d57d35ad2ec25d001c181已投递唯一Runner。T仅原51533641案同原source/operator/readonly，真实wrong-lawyer403及readonly写能力false后，冻结事务锁定原案/run/唯一actor/role/assignment/member/成功receipt，只允许原自身新roleb3fa20e6的active/version/updated_at true/v1→false/v2，assignment不动；然后原operator原成功body/key403。任何异常或未知commit停止无重试/恢复，三新正常session及唯一role三列为仅允许旧行差异。T及独立保持核均PASS才N：只原9未运行titles一次、包含原故障/50MiB等原预算；不重造失败场景/已过首案和三项，不加新权限。普通报告保状态/hash，原凭据/trace仅批准Temp。当前正式T/N实际回执尚未收到，不把GO当通过，也不把APIRequestContext HTTP当真实页面。

### EF门户修复源码接受及原对象短只读核；业务续验待门禁（2026-10-17）

原E v2六文件manifest SHA9f043a9961c6cbb19e4aef517d9f46aa58c6460491f719ad9a0ff14043e320d9经原Spec和Standards独立补审均ACCEPTED C/I/M0。内部与律师portal分controller，认证actor的主体检查在领域/材料委托前；原domain当前授权先于旧成功receipt不变。Standards曾发现5个律师OpenAPI operationId重复，v2移除覆盖并由真实Lawyer类生成唯一ID，直接测试8/2路径和唯一ID集合，内部原ID保持，finding已关闭。作者controller79/79、领域定向16（v2复用未变输入）、类型/Lint/格式等为进程内证据，不冒真实HTTP。源28c8d617→运行树85fcd292+context67625b9/treef6b18e96，strict161 helper f45b4436及原14spec9013b3de保持；新的完整正常verify尚待唯一Runner实际结果。

原Runner permission-membership-readonly-20261017 单次标准锁READ ONLY PASS，manifest SHA f906853273d282d446cd68dd29f086a55e9a64286b8d293131362cbbad401cb9：153表4837旧PK行逐列同原Part2Close、完整161成功+唯一原resolved历史、四actor真实membership/role/assignment/credential内存核对、原单feedback/receipt/body/result，以及旧32两端和新11真实文件均匹配；HTTP/服务/role/assignment/Grant写均0。已确认原helper撤自身role_templates而非assignment：仅operator roleb3fa20e6-5b9d-4d27-95fa-9e1f707b848a（只此actor持有）未来active true/version1→false/version2，assignment c33aa76d原样。旧offline assignment方案保留，以clarification增量纠正；未执行撤权。

准确单runner-ef161-67625b9-gate-permission-preparation-20261017.md SHA f7bc2599b8411c18ee9b1a8b668c8bfb3e1833bb9677223bafd1fc518d4e9580已送达，只运行新身份边界组合一次正常full verify，成功后短保持核及ignored尾段TS/9未运行项的仅collection（1/9），交root核具体源再另正式GO。不重复已过首案/3项、不新造失败fixture、不再次resolve/deploy。累计9身份/66Grant/5案/11tiny及剩余预算不变，当前仍未宣称权限实际403和余9通过。

### 证物日期修复与稳定后端交付（2026-10-17）

更新28manifest SHA97e9784c7469f390d7e1b4e579169fed44eee4578d7e4aa91c2e7f850527f2eb由原Standards逐raw核同，其他24与原冻结完全一致。新增纯日期选择只在SECOND_INSTANCE取secondHearingOn、其他取hearingOn、缺失null不回退；筛选和展示共用，依据Demo index.html2924明确提示。实际RED6→GREEN16/16、类型/四文件Lint格式0，原51项和旧全构建仅保留为原候选证据，不合并称当前全跑。日期I关闭；后端28单提交9f2f9cf2e38ad34fb38ac45457356a7a5f0608f0，原Spec来源/权限/初始化范围通过，前端WIP未混。

证物树接已审材料/费用两依赖5ddaa361+bd6b06ed，后续同原notary.issue事务费用hook、正常生成后的组合编译、公共App/菜单及完整页面仍独立实施/验证。没有执行新1150/1200/1300迁移、真实DB/HTTP/页面或新Grant。

### EF同案结束与跨阶段重放PASS；剩余权限场景停止（2026-10-17）

原E单spec修复0fb861a仅补真实合成结束依据，不改服务/SQL。正式运行候选2d670509/tree3c260ec1复用已通过完整门禁，受影响类型/Lint/格式和strict context通过。原首案f3ebfaeb-85a8-41d4-9c51-8708a8b5895d的独立同案续验1/1 PASS，finish201至WAITING_ARCHIVE/version4；四原EF body/key跨阶段仍201且精确原结果，四新key409，finish后与重放后完整事实快照相同，无新fixture。原PS5 warning前置失败单独保留，改为已验证PS7正常stderr/exit路径后才正式执行，不伪造通过。

余13项protected发现通过，实际3PASS/1FAIL/9未运行，retry0；失败是内部source actor POST lawyer/cases前缀应403却返回409 VERSION_CONFLICT，请求a33b7653-299f-4f42-9d10-e2b2d3678335。只读现源码确认共用双前缀控制器未执行既有律师主体检查，使请求到达正常内部版本冲突路径；这不是已发生越权写入的证据，也不能把预期改为409。readonly403、foreign404已过；后续readonly能力读取和原定撤权后原键拒绝未到达。原E修复消息AbsolutePathBuf失败，精确relay SHA9e9cf265fb9fc80b8d5927f1a8ad7266369d74c456c40510696402e8e8cbcbeb，待父级有效通道派发，尚非实施中。

原Runner parts-final-summary.json SHA26764e5ef25baf73554b0dee27ca2f7ec2a2ba7c8006032b811d513f299bdaea及part2-failure-http-safe.json SHAb20cd7a83fec6ab5eb7857c0c4a47eb9488c8ca2b7dc492988714d9af6a49623固定本次结果；两阶段closure通过、旧事实/安全/文件保持，端口与锁释放。累计9身份/66个自身新角色Grant/5案/11tiny文件；剩余12身份/105Grant/11新案/49成功文件（48tiny+一份50MiB）及未执行原故障/超限子项。不得重造原失败/已过场景，不重复resolve或deploy；后续须先修审固定主体边界，再独立安排原失败对象和9未运行场景。完整14、真实页面和完整Demo仍未通过。

### 自动费用及凭证共享静态候选（2026-10-17）

原两Sol对frozen-fee-source-proof-manifest-v1.json（SHAb7488b3c136be3ea17680bdcddd0281712fef8941a0423e2a36b90531e05eeb6）28文件逐raw核同，Spec与Standards均ACCEPTED C/I/M0。枚举准备1150只新增FEE_PROOF，单提交e00c94fe8764888015ee25b2acaaba29fb89e478；其余27文件64cd8028b2c2f9ba77d1a5325c21bf2d5d348a1d。真实源自动费用保留KNOWN含0/未知PENDING、同事务来源与幂等约束；凭证精确版本/授权/audit/ref及旧历史不删；证物额外下载路径基于真实证书冻结集合而非只信JSON。作者材料265项、费用proof7项、迁移纯12项及API98项等聚焦证据不等于真实PG/HTTP/并发/页面结果。结算其余service/UI与证物本域候选仍分开开发审查，未部署这些新迁移。

### EF HTTP14真实首场景fixture失败；旧事实保持（2026-10-17）

父级提供原07:28允许与10-17继续的精确本机R2授权，并恢复消息通道后，续单91270f77…05248a一次成功投递。原Runner protected发现14/1 exit0；正式14库存仅首项执行，exit1/maxFailures1/retries0，原报告unexpected1/skipped13/flaky0保留。失败为2026-10-17T01:58:55.625Z原新案f3ebfaeb-85a8-41d4-9c51-8708a8b5895d execution-finish POST400，request823b048a-4953-49b6-b413-e500023829e4。safe trace SHA009acb5d7ee8d10c55c02c97629e7a480bfa53caf157503cf4bb0971575002ac证expectedVersion3、basisNote:null/附件[]；spec helper与正式cases.md399/原finish.service403–404及原直接负例一致，正确规则拒绝无任何依据的结束请求，不构成放宽产品或迁移理由。

Runner最终http14-failure-closure-summary.json SHA03863629447296347b744694c6bed7506bd99b12af8d2f2c470e368200c866b1已核。四命令真实201、4receipt/2feedback版本/2supplement版本/2doc保留，此前原body/key重放/冲突、刷新重登current/history及精确2supplement bytes断言实际越过；跨结束重放和后13场景未执行，不把这些局部证据记成完整场景PASS。新增2身份/15Grant/1案/4tiny共168bytes，合计72案/36文件；原旧行/安全/H42/terminal inactive v2/已闭合dadd与32文件保持，故障残留0，锁和服务端口释放，dockerlogs0。剩余预算必须扣除已创建对象，不自动整套重跑。

仅原E测试准备需要一个有效合成依据说明，原服务/SQL/权限不改；主控已准备一spec窄修及“复用现有首案+剩余13”的后续方案，实际执行仍须固定候选和独立准确运行单。发送原E遇AbsolutePathBuf路由错误，已知未送达，relay位于主控.local/ef001-evidence/ef161-http14-finish-fixture-fix-relay-20261017.md；父级有效通道交接即可，无须重新申请原本机R2预算。真实页面点击、完整Demo和预览仍未验收。

### EF恢复及补充保持核接受；HTTP14尚未派发（2026-10-17）

实际post-deploy-addendum-summary.json SHA325cd832fad8b587478b938bac94c6c30eb0707310075a4809565cace6419c49及其12份proof逐项raw哈希由主控回读全符。原Standards Reviewer核44个触发器全字段与事件集合/数量、实参大小写及其余冻结DDL，不作其它宽松归一；原Spec Reviewer复核官方真实receipt/stdout/stderr、完整PG微秒原start及仅rolled_back_at改变、161成功+唯一原resolved共162与旧149PK/71案/安全/32文件/22原源/新4表0和4列null，均ACCEPTED C/I/M0。源仍clean1832/treecd42cb4e，原PostMigrate BLOCKED不覆盖，Supplement为单独PASS_ADDITIONAL_PRESERVATION；没有将原exit1改称exit0。

正常本树完整verify实测工具139/前端2378/后端2124（实际NT006、双构建），owned发现1正式1、official resolve一次及正常deploy一次均exit0；这些输入未变，后续直接复用。HTTP14发现/正式均未运行。主控新独立续单runner-ef161-1832d99-http14-continuation-20261017.md SHA91270f774f554a611c4a3f546e20162974f91782945416ef472b6951ef05248a只接原预算Phase4，不再resolve/deploy/verify或重建原案。app消息通道Transport closed，续单已准备但已知未发送，父级需经原有效通道交原唯一Runner并获收讫；此通信阻塞不是新业务权限缺口。实际HTTP、浏览器点击和预览均未预记PASS。

### EF官方恢复与部署已执行；独立核验及HTTP仍分开（2026-10-17）

固定1832d991/treecd42cb4e的正常完整verify、protected whole-file owned专项各实际PASS；随后官方resolve只将原唯一failed1000标记rolled-back并保留原历史，正常pnpm db:test:migrate:deploy仅执行一次exit0。实际结果在ef001-integration/.local/ef001-evidence/official-recovery-http14-1832d99-20261017/的Verify/Owned/Resolve/Migrate-result.json；主控已读，尚无HTTP14结果。原failed started_at精确文本仍为2026-10-16 09:36:04.56343+00，不用旧毫秒报告代替身份。

PostMigrate-result.json保留BLOCKED/exit1：独立DDL检查首差异为触发器事件顺序delete or update与update or delete。offline-ddl-diagnostic.json用已保存目录复现，无新DB查询。主控仅准逐项事件集合及所有表/函数/时点/参数精确核对，保留原失败；若离线全部解释成立，再由唯一Runner补完原未到达READ ONLY保护项。此时不预记历史保持全PASS、不重跑部署、不运行HTTP或修改产品来迎合检查。

结算/证物共享V3十三文件固定9da6febf6f0a388073072bca71928a03af63b26f，证物原树接入5c58bd9941951eef8c9802494883139926e0f068，两者tree78bf1f72ce553b8cced4028a7e5b98ada4344760。manifest31fdfc9ed3d0442fc4e2a1c99ac0430df3f4bd0ace07ba87ba47ddfd05d44cd5逐项raw一致。原Standards/Spec V3均ACCEPTED C/I/M0，真实certificate_no保留，组/子行案关联及四类金融账号/同部门成员FK缺口关闭。模型生成/类型及源码边界检查是编译依赖证据，实际1200/1300迁移、真实并发、完整Demo领域和页面验收尚未完成。

### EF精确原时间纠正；正式阶段仍待实际结果（2026-10-17）

七文件候选73d72847独立两轴0后，唯一Runner在短准入首次停止。只读诊断rawSHA5736f08b022a6a2fcbb8dea34ea2c44b51123637a6d304c1e19623b5944337d4由主控核对：唯一failed1000原PG文本started_at为2026-10-16 09:36:04.56343+00，原summary/fixture的.563Z已丢失微秒，旧闭合时间guard误拒；其他失败行UUID/name/e125校验和/steps0/空字段全部同，0门禁/0恢复写入。原失败和执行单保留，不把其原静态审查0扩大成运行成功。

原S仅database helper及原纯test最小更正，manifest1cb37652b8c8894022fd15f882bb1470c4f35f27a381d4d19d012346aa8b671d；31纯测覆盖真实PG原文成功、正负一微秒/截断PG与ISO/回执原时间篡改拒绝，Lint/格式/语法通过。同两名独立Sol补审分别ACCEPTED C/I/M0，不重跑未变测试。source d0bcbbb0/snapshot1832d9913e01f3636fa5fe8b76ced8c46b143366、treecd42cb4e33cdc928e6cb06e533ae4d89104c9d92；原Runner停止且干净后单一快进，两个raw及0950/原1000 raw未漂移。新GO文件runner-ef161-1832d99-official-recovery-http14-20261017.md rawSHAe02929c3805538ec5e6875de660927e228f51aa06b3885d67c1e875a14147d10：正常完整verify→whole-file owned1→原具体许可的official resolve唯一失败/真实回执→正常deploy→独立保持核→原HTTP14，任一错误停止。阶段实际结果、已部署与真实点击分别登记，当前不预记通过。

### 暂停后原R2环境与历史只读复核（2026-10-17）

唯一Runner在精确原1a98fc7/tree dc167da6执行原容器恢复。退出状态255经原fullCID、标签、锁定镜像、持久卷和loopback15438、退出日志及端口复核后，仅docker start一次，最终healthy；未recreate/pull/换卷或配置。单标准锁及一次REPEATABLE READ READ ONLY快照核159成功+唯一failed1000原行、149表全部旧PK行/安全、71案/32文件及历史源真实bytes均与昨天相同，五新enum和EF DDL仍未提交；1240source/761build哈希保持，锁已释放。真实result.json rawSHA cae5aefb39196c4b17e292c35945d571b305c4f31065d6669f3c793ab4144838由主控实际核对。证据位于ef001-integration/.local/ef001-evidence/r2-restart-readonly-20261017/；无新DB行/业务服务/HTTP/Grant/resolve/deploy/fixture或verify/owned重跑。此项仅环境恢复和旧事实保持，不是新迁移、EF功能或浏览器验收通过；写槽仍待固定已审候选及既定恢复条件。

### EF正式入口首次失败：保留现场，源码修复与恢复分离（2026-10-16）

唯一Runner在clean1a98fc7正常pnpm db:test:migrate:deploy首次exit1，真实PG为unsafe use of new value EXECUTION_SUPPLEMENT of enum material_category；未启动HTTP14、未retry/resolve/rollback。安全摘要rawSHA48626b5d17d546ceb7c9fef08f70e1fb6e15e38bbf961508e34cc7dd04ddb8ae由主控实际核同。现159成功账本+唯一未完成1000 id9f547970-6eaa-4628-a670-f505590482e9，appliedSteps0、finished/rolledback均null；enumLabelsAdded/newTables/newNullableColumns均0，149旧表71Case/32CV/944audit/65session/counter13、全旧安全/文件保持。此前正常verify和owned五checks仍保留为其真实结果，但旧helper prefix/transaction两次query额外形成提交，未覆盖Prisma整文件的真实事务边界，不再扩大为正式部署通过。

原S独占树已核clean并建codex/ef160-official-enum-boundary-fix从精确1a98；主控启动消息遇AbsolutePathBuf技术路由失败且已知未送达，未重试，父级随后沿有效通道交接成功。当前限定七文件源码：0950独立五enum准备且保持原1000原hash，owned按每个完整迁移单次query，新增正式入口回归与精确历史failedrow合同。用户09:50UTC已批准复核无部分提交后官方resolve将唯一失败行标记rolled-back、保留失败历史，再正常部署0950及原1000；源码固定和独立审查前不执行。不得删失败历史、标记applied掩盖失败或改前159成功SQL，若再失败保留现场停止。序号顺延与稳定迁移名称/raw明确分开，不扩大原业务预算；成功161后的HTTP14尚未运行。

### exact5补丁已审交运行树；多文件源码独立交付（2026-10-16）

终端补丁当前固定d3d06b95ba9c848c7e256a6a9546c6dd66bd808e/tree486490f89bbed7149d22a82cb6fa81495a90f256，原Runner section-record-edit-ui-v2已仅fast-forward至同HEAD/tree、clean；三文件raw为database ee12fa0f…5d2c、声明2256537d…3b83、binding e0f0b852…260b。历史run raw3f684f40…dd03和直接授权583b2978…6f89独立钉住；新delta/真实执行summary绑定当前候选，五身份hash不含Grant且保持。原Reviewer发现的live4测试提前拒绝假覆盖、撤权marker误记历史候选均已修复；补审累计Spec/Quality ACCEPTED C/I/M0。作者最新228/228纯测试；主控最终修复raw上root tsc、ESLint、Prettier、diff及核明快照strict均exit0。没有本轮DB/Grant/HTTP执行，原5922整仓门禁不冒称d3新tree实跑。

独立多文件产品提交b13a8e6d9d431a7501c44f5dc652a3b4660e5b5a及快照0aeb8e630eef37f9d5ad36c6710cc52272373907/tree df083f2d76c7cb2237bda96487b3634c8aa505ba，仅Panel/spec和核明快照。实际82/82组件测试、Vue类型/Lint/格式过；多选顺序请求、失败停余项、精确冻结锚、回调独立副本、先确认后取消及迟回复隔离、10上限前置拒绝有直接回归。初次系统Temp EPERM和作者一次错误换TEMP运行59/21失败保留，不用作最终证据；最终82在原Temp经正式批准运行。没有DB/真实浏览器或新组合完整门禁，不混入终端候选。

### 终端准备首403及单项增量准入（2026-10-16）

5922e24实际正常verify工具139/前端2207/后台1864及NT006、双构建通过；原固定terminal五身份关联和四DEPARTMENT Grant已创建。正式单项在首次external-entry因CUSTOMER_ACTION_FORBIDDEN停止，实际案0/文件0，assignment仍active/v1；未到达目标“打开更正后撤权，保存403”，不能记该场景通过。原Runner安全摘要SHA2351ecc05966924131815c21c0e4695ecefb067ff4c275a08351bf182cc316fc，旧行/H42/159/31文件保持。

主控和独立Worker只读核全准备链：唯一缺customer.read/DEPARTMENT，H42代建不符合terminal本人来源约束。原Runner已收到直接用户批准，授权文件rawSHA583b2978c1f4b3015402a1efaa9bd13d32b3c63d75b5a635c5f8206184a06f89；批准不等于实际执行。新增固定Grant UUID a7f934b8-2c64-4fc1-8d7e-18d8c4132a75，仍原角色5b870b2e-f831-43e6-9ed0-3f2c66ed8412。当前仅纯源码同步exact5，须保原4 proof历史candidate及五身份hash，另链接单行增量执行原bytes，实际4/第6项/错误scope均拒；无新DB/HTTP/Grant执行证据。

### 批量161迁移风险源码已审，真实验收待执行（2026-10-16）

原Owner仅新增tests/support/lead-batch-push-migration.mjs/.d.mts/.test.mjs及专属E2E；源码提交dbe912e84c98733b26bacffc90ce08848828722e，加已逐项核对的context快照固定`ui003-lead-list-workflow/codex/uxq03-lead-batch-push` clean `e48760d24ea7d93a54c52f0b98ca739488318dc8` / tree `e557760ed45c3754a4e8eaad55265e7e5cbe2a58`。原产品/8项PG源及161 SQL raw1e267e10…0c9e87不变。实际纯7/7、根类型/Lint/格式/语法及离线发现1项、strict上下文通过；尚未运行正常完整verify/PG/官方161或HTTP8。

独立risk_review_resume累计Spec/Quality ACCEPTED、C/I/M0：156/160真实prefix+transaction各两query且拼回原raw；快照含enum标签排序/sequence/owner/OID/config；全部owned/inbound核验通过后才在单事务清理两schema；spec精确三checks并附真实fingerprint/public三digest。I-161-REPLAY01/PRESERVE02/CLEANUP03/EVIDENCE04均已关闭；失败时未到beforeCleanup不伪报public漂移，原异常仍保留。升级fixture只合法department/user/membership，不手工填Prisma账本或伪造lead/业务receipt；真实回执guard由后续8项验证。短续单为主控`.local/uxq03-evidence/runner-batch161-e48760d-20261016.md`，须前序160及EF14完成后，唯一Runner按完整verify→owned/public160保持→正常官方161→旧行保持→一个新terminal四Grant及H42复用→HTTP8顺序，不与EF并行或借旧树门禁。

### EF160完整门禁及owned风险通过，执行单60字节勘误（2026-10-16）

原Runner在同一clean1a98fc759e8859315ccf9030a6e3a809144a60b2/tree dc167da6cff82f10bdfebc908e4d96e8ad0a0ee9实际正常完整verify exit0、288284ms：工具139/13文件、前端2378/127文件、后台2124/126套、真实NT006 owner及本树双构建通过。protected发现1文件1项、正式owned1/1 exit0，无skip/flaky/retry；五checks/五enum staging、159 classifier精确变换与身份保持、两owned成功清理/public三时点摘要相同均有真实附件。public保持159/149旧表、70案头/H42/dadd唯一rev1/31原目标文件bytes，两个旧failedschema保留，锁释放/端口空闲。尚未执行public160、EF14或终端403。

原Runner因执行单要求64bytes而封存acceptance BLOCKED/phase exit1；冻结helper333的ASCII模板28bytes+32hex nonce恒为60，seed及升级前后CV metadata检查和实际memoryFile.size60/hash88fddede299b0bc326179be8699e5db5a67bb04cd508fdeeb0dc2e121df3ac25一致。64是主控执行单笔误，不是上传大小边界或新增覆盖要求；主控与独立risk_review_resume实核同源/附件后澄清接受，不重跑、不改SQL/源码/断言或原结果。证据`ef001-integration/.local/ef001-evidence/migration-1a98fc7-20261016/acceptance-summary.json` SHA256 `3a06ffa0f994d1890411144ff5ccc45e3be886a16861bf0388631ef9368e126c`；勘误补证为主控`.local/ef001-evidence/ef160-memory-size-correction-20261016.md` SHA256 `26323930422e6c42540f93dd8f0d4569da8257c6a30f21fb7fb0f4a65c19b9e0`，原执行单c7dd…及全部原日志保持。内存材料不证明实际stored blob或历史Case恢复；后续先严格159终端单，再160部署/HTTP14，不等待161。以下三候选段落保留源码交付时状态。

### 三个独立验收源码候选已固定（2026-10-16）

EF160风险四文件105b5870及仅context快照固定为`ef001-integration/codex/ef001-integration` clean `1a98fc759e8859315ccf9030a6e3a809144a60b2` / tree `dc167da6cff82f10bdfebc908e4d96e8ad0a0ee9`。实际纯24/24、root及workspace类型、四文件Lint/格式/语法、strict上下文通过；同一正常本地CLI发现1文件1项/callbacks0，首次系统cache EPERM后正式权限执行相同命令通过，未换cache/ACL。独立risk_review_resume累计Spec/Quality ACCEPTED C/I/M0，M-C-PROBE01同步篡改156–159 source/ledger及public/search_path反例已关闭。父级已启动原Runner的正常完整verify和单owned风险项，尚无实际结果；SQL副本预期仍只最小ACL/DRAFT/file metadata与内存bytes，不覆盖旧Case/blob。前置单在主控`.local/ui003-evidence/runner-ef160-1a98fc7-owned-first-20261016.md`；public160及原14HTTP单独顺序执行，不等161。

批量8项PG四测试文件5ef8e1ca及仅context快照固定为`ui003-lead-list-workflow/codex/uxq03-lead-batch-push` clean `f2dec65a366e4e689db187e521d3446caabe1be2` / tree `20477be45a8877f5fd3b5e6bf55d341fecbabe6a`。实际helper纯7/7、根类型、定向Lint/格式/语法、strict上下文和离线1文件8项/callbacks0；没有真实DB/HTTP。独立Spec/Quality ACCEPTED C/I/M0：本轮H42新lead的创建前无receipt、创建后真实create receipt与lead.created audit登记、私有故障集合和一次sequence命中均已核；terminal显式身份绕过H42登记但不扩大fault白名单，I-A-FAULT03/REGISTER04关闭。仍只复用H42主账号和一个新terminal role；完整161 source/applied严格门禁保留。独立161 owned风险四文件正由原Owner补齐，未运行或部署161；不得拿8项源码替代迁移风险。

新UI终端403四文件及快照固定为`section-record-edit-ui-v2/codex/section-record-ui-159-readiness` clean `5922e247c54a931b0d40f97551a2997a964a138b` / tree `07430d8ae67165c89773ba85430a1ad2889acaed`。纯204/204与根类型/Lint/格式/strict上下文通过、独立源码审C/I/M0；I-B-TERM02终端snapshot精确材料ref小写case已关闭，原H42路径和135断言不改。离线发现16/1是作者采用进程Temp重定向的非正式发现证据，不能冒受保护运行；原Runner须正常入口/系统cache、必要正式权限。新terminal sourceReady必须在专属配置globalSetup/webServer之前执行，未实跑或造新角色。单项执行单`.local/ui003-evidence/runner-terminal403-5922e24-20261016.md`已交父级，原十五项的两次自动审批拒绝及未送达状态另行保留，未绕过重派。

### 原案保存及独立只读页面闭环通过

原Runner在clean e9ee2e03/tree8148d8ea、R2/public159完成原dadd原279bytes body/key两次201、完整同回执，仅一条更正/回执使revision0→1，Case保持ARCHIVED/v6；原500已由本次实际成功关闭。fresh GET、刷新、有效值预填及规范化历史通过。脚本在编辑抽屉仍打开时点击退出，被遮罩挡住而超时；不能据此定性产品故障，也不能称重登、四文件精确下载或邮寄按钮下载已通过。149旧表行、70案头、H42、31文件、159账本及两个失败schema保持；正常只新增本次唯一纠错链及登录session。CASE/case采集误断言与原失败结果保留，由精确目标补证说明。

保存证据`test-runtime-stability/.local/ui003-evidence/dadd159-e9ee2e0-20261016/acceptance-summary.json` SHA256 `e697e5293690d373a697d49e5ecd6ffe7db610bf99d5cc33cddf2e645e0d1b49`，原超时及采集错误保持原记录。

同一e9ee2e03/tree8148d8ea随后独立只读续验实际1/1、exit0，无skip/flaky/retry：正常取消后抽屉及遮罩消失，正常退出、密码重登、有效值预填与规范化历史通过；四个精确CV均HTTP200且size/SHA256相符，真实邮寄下载按钮所得95bytes/SHA256也匹配。没有业务保存、重放、上传或新业务事实；原案仍ARCHIVED/v6、revision1，更正/回执/typedDocument/audit/ref各一份。149表旧PK行、70案头、159账本、H42及31文件和旧22来源字节保持，只新增2条正常登录session并退出其中1条；锁释放、3101/5174空闲。只读证据`test-runtime-stability/.local/ui003-evidence/dadd159-readonly-e9ee2e0-20261016/acceptance-summary.json` SHA256 `32cf2aa01132df972bfb3ea1817ea91fcf9343ad8d55a7514875d18862a918fb`已独立核hash。原500和该案窄UI闭环完成，不据此宣称其余16项、未知结果恢复、EF160或批量161通过。

### UXQ-03原子批量推送源码候选（2026-10-16）

源码提交f99dc920895a8219b0e19c8440fc619c5ec6adca共19文件，含单Serializable批次Command、独立不可变回执及唯一新161迁移、严格有序API与列表批量面板、未知原请求恢复。必要Spec同步后固定`ui003-lead-list-workflow/codex/uxq03-lead-batch-push` clean ad16e8585c1a98a4d4e75a5bb094f525e89995ea/tree d0a01a781e2769a084e290d4fe2433b4aaabd14f。原Sol累计Spec/Quality ACCEPTED C/I/M0；fresh GET、迟到响应、稳定actor/dept恢复、成功/明确拒绝后清除本地pending等finding已关闭，原单条身份与接口不变。主控核全部19最终hash；两次过期Page哈希未用于提交，最终Page为71057ea4…00f6。新161 SQL工作区原字节与提交blob一致，SHA256 `1e267e104e4a7a1b20f1014dfd10506ce1aa831e32a11175e3a4dde2430c9e87`。

实际直接验证：后端四套192/192；前端修复轮四文件50/50；最后仅Page两文件变更后该Page27/27复验，其余输入未变，不相加冒称同一轮。两端类型、变更Lint/格式、架构均通过；最终候选strict上下文、Spec57/67/11/59及本树`build:prepared`双构建实际exit0，Vite只保留既有大chunk提示。首次聚焦测试被临时目录EPERM拦截后，按正式权限重试同一命令通过，未改ACL/工具。此候选没有运行正常完整verify、NT006、真实PG/HTTP/浏览器或迁移；新161及其EF160前置尚未部署。后续需唯一Runner在明确准入后验证整批原子/失败回滚、并发、撤权原回执及真实页面，不能据源码和组件测试称已交付业务或上线。

同一clean ad16e858/tree d0a01a78随后实际完成新组合非DB切片：backend/frontend/root类型、全量Lint和格式均exit0；工具Vitest13文件139项、前端全量Vitest129文件2392项、后台精确9文件Jest502项均通过。后台只选已逐项核实使用fake DB/transaction或useValue provider的followup service/DTO/controller/read、supplement-upload DTO/controller、material.service、case-read service/controller；未核实的其余后台和真实PG的NT006排除。三组测试首次在收集前遇系统Temp EPERM，原命令正式权限下分别exit0，原失败与approved成功日志/退出码分开保留。证据在`ui003-lead-list-workflow/.local/uxq03-evidence/non-db-ad16-20261016/`；主控回读139/2392/502日志及approved退出码。原192及未变构建/Spec/strict上下文可信结果复用、不重复相加；本切片不等于完整后台或正常完整verify，不改变实库/迁移/HTTP/浏览器未运行状态。

### 原案严格159候选已备，父级已有效接力

原UI两文件5845cf101886f3ced88bcdc3679c4915a2fc531b只将完整source/applied链升为159并独立钉156–159 SQL原字节；174绑定及35准入纯测试、根类型、Lint/格式通过，原Sol补审C/I/M0。16业务项/135断言、H42/凭据/seal及产品字节不变。运行树接入后只更新context快照，固定clean e9ee2e03f44a6d8069325261d3b5eb6261c02267/tree8148d8ea067fa69984584ba602d15f0d81053e17，context strict通过；作者树缺env的protected发现失败保留，不当发现通过，须由已备运行树真实发现。

主控发送原dadd同请求保存/原键重放/页面验证单时，自动审批认为此前159/五类许可未明确覆盖该单案持久更正，消息被拒且未执行。用户随后对完整说明的原案动作明确回复“允许原案同请求续验”。只据新许可重试原未执行消息一次，审批不再拒绝，但工具返回AbsolutePathBuf路由错误；未再次重试、未转其它Task代执行。向父级报告亦thread not found。当前是消息送达阻塞，不再是等待人类批准；原dadd仍未发HTTP。精确候选及短执行单在主控`.local/ui003-evidence/runner-dadd159-same-request-20261016.md`，旧审批原文与新许可/路由状态在`dadd159-execution-denied-20261016.md`。父级随后已确认通过有效通道送达原Runner同一e9ee2e03固定续单及用户精确许可，现由原Runner继续，主控不重复派发；尚未取得原案新的业务结果。批量推送开发/审查独立继续，禁止把权限询问、消息送达或已备源码当业务验收结果。

### 159修复实库与五类HTTP通过，原案页面尚待续验

原Runner在clean11fbbfb5979fd5b7ccf555608deb1873ba753862/tree759a22d125354a902b9cd981d67c0d9c9e0a1138实际完成owned PostgreSQL专项1/1、正常官方`pnpm db:test:migrate:deploy`一次（仅0930修复，public158→159）及五类HTTP专项1/1，均exit0、无skip/flaky/retry。实际11条更正与11份typed回执已提交，五组原body/key重放完整解析DTO等价、五类错CV均400、mailing并发201/409；judgment JSON属性顺序不同，未声称响应原字节相同。原149表旧行、68案头、H42与26文件字节保持，正常新增2案/5文件保留，当前70案/31文件。两个旧失败schema原样保留，本轮owned无新增残留。

证据目录`test-runtime-stability/.local/ui003-evidence/reference-reuse-11fbbfb-20261016/`，acceptance-summary SHA256 `e3fcf34c345a1fb6d56e3a6c514028487d57f049263842423e4c76ab837465b7`；官方迁移、真实提交、重放/冲突、namespace及响应顺序均有独立proof。原Sol受限复核Spec/Quality ACCEPTED，C/I/M0。b9完整verify仅按未变产品输入复用，不说11fbbfb重跑。原dadd仍ARCHIVED/v6、mailing revision0、更正/回执0，本轮未发其POST；必须用原279bytes/key继续同案保存及实际页面刷新、重登、历史、精确文件验证，不能据五类新案HTTP关闭原UI500或宣称未知结果恢复。EF160、权限增量、预览及发布均未执行。

### 后续执行授权更正与独立开发边界

父级更正原Runner11fbbfb隔离→159→HTTP续单的调用实际被自动审批拒绝，未成功派发，不能记录started或经其他路径执行。该拒绝作为历史保留；用户随后对“本批隔离R2执行159修复迁移及测试账号五类更正保存、保留原历史/失败证据、不动人工演示/生产、不新增权限”明确回复“允许”，父级报告已通过有效渠道接力原Runner；本次不包含EF160部署、扩权或预览更新，尚不代表任何新数据库步骤已通过。public仍158；bd344 owned失败因夹具给真实filing_versions虚构fact_id列而触发歧义，新失败schema record_reference_reuse_f9f207208db94274b3fe8f9c53024190与先前148e54cfc73f4ceb9f07b45ccffcae06均保留。原Owner系统检查全部SQL/替换/别名/异常后，fe2171f仅两文件把23表改为固定白名单真实public列/类型WITH NO DATA，四种version各自只含真实键；不复制数据/FK/约束/索引/trigger，批准0930与旧函数正文不变，wrong-document断言收紧为代码加精确原文。6/6与静态通过，原SolC/I/M0；运行目录11fbbfb已冻结，未重跑PG。b9完整139/2207/1864及双构建仍仅按未变产品输入复用。

E严格160准入32557ca保持原14业务场景，仅更新两文件尾链及独立raw pin；207纯测试和真实CLI发现14、类型静态通过，原SolC/I/M0。独立EF组合已固定8373c90/tree3099aaf056d4cc13c96e5f1d793eb64b71f13253，累计源码审接受，frontend原560证据可复用；不访问数据库的strict上下文、Spec、架构、Prisma client生成、类型、全Lint/格式和双构建现已实际exit0，日志位于该EF树.local/ef001-evidence/static-build-8373-20261016；Prisma首次缓存utime EPERM按正式权限重试原命令成功，不改ACL/缓存，Vite只留大chunk警告。没有运行test/NT006/DB/HTTP/browser或完整verify，不将局部门禁说成完整门禁。EF实库／HTTP／页面仍待后续授权与真实验证。UXQ-03两处契约finding均已关闭：失权重放按原请求真实索引，先核不可变原目标当前权限再比指纹；原SolSpec/Quality ACCEPTED C/I/M0，纯模型14/14仅为开发前置。主控必要Spec9ced73e已冻结批准语义与专用不可变批次回执方案，独立目录ui003-lead-list-workflow新分支从EF837+Spec4cf40f96开始实现，不碰当前验收树/数据库，不新增权限或改整批原子语义。源码、PG、页面与发布结果均尚未交付。

### b9完整门禁通过；owned注入字符串修复待实库续验

原runner在clean b9d1de974970e02fa9cba88c1b1baa20eddb5b00/tree42c1326dabca20511e7739c7052308972ace797f正常完整verify实际exit0：工具139、前端2207、后端1864、NT006真实锁、全部静态与双构建通过。后续protected DB-only唯一owned项在预期deliberate rollback处得到syntax error at or near "$"而失败；未部署159、未HTTP，public158与149旧表/68案/42权限/26文件保持。失败schema record_reference_reuse_148e54cfc73f4ceb9f07b45ccffcae06按规则保留，后续namespace基线须包含它，不能为重跑清除现场。

原Owner定位JavaScript replace的字符串替换规则把DO $$压成DO $；修复6b68e9d3fda8a52ec6c0886ae86ad8a370b128c3仅helper改callback及直接测试，批准0930产品SQL/raw628a及原deliberate异常断言不变。真实RED4过1失败后GREEN5/5、根类型及两文件Lint/格式通过；原SolSpec/Quality ACCEPTED C/I/M0。纯测试验证精确注入位置、原SQL其余字节与BEGIN/COMMIT边界，不是PG证据。新候选仅失效的owned阶段须重验；产品/依赖/构建输入不变时限于该范围复用b9完整门禁，不重跑generate/build/verify。官方159及五类HTTP完整事务/错CV拒绝仍待唯一runner。

EF独立组合afab652c八个前端spec实际560/560、前端/根类型、13文件Lint/格式、架构/Spec通过，原Sol累计前端源审C/I/M0。初次受限令牌因既有Prisma缓存Temp目录权限在测试收集前失败、测试数0，原日志保留；相同参数经正式审批执行成功，未改ACL/缓存路径/源码。S160增量069b9ba58e343630184b49ffa3cc2eac3f2dc587仅1000分类证明与材料实际引用计数三文件，246/246、类型/静态、补入正式0900后完整160纯源检查通过，原SolC/I/M0。1000新raw e125a3278b0530860b1be49273fc667224451f8a6d35b420bdf14e2b9c684105，尚无PG/部署证据；上述EF结果不扩大为功能验收。

### a1工具超时：局部Git集成测试预算修复，PG未到达

原runner在固定a1bfea4正常完整verify工具阶段得到138/139，scripts/validation-evidence.test.mjs:68超5000ms；未运行owned探针、159部署或HTTP。原失败证据reference-reuse-a1bfea4-20261016保留，public158、149旧行、68案、42权限、26文件、原案零更正/回执与无owned残留保持，锁释放；不能把后续修前定向工具成功改写为原完整verify通过。

原工具Owner在独立同基线目录实际测得：原目标单项1/1通过、测试体1.55秒；修前普通负载全工具139/139通过、总22.63秒。目标单项有30多次同步真实Git调用；每次启动增加200毫秒时，原5秒预算稳定报同一timeout、体约9.88秒。拆成独立仓库用例既重复fixture又失去同一exact key连续生命周期语义，生产capture的重复Git重验不能为测试缓存绕过。最小修复ee0f4d743abec884e0cc3852e98ae0cdd9167444仅该用例局部15秒预算和两行说明，与文件原linked-worktree真实Git用例预算一致；全部原断言/fixture/生产代码/共享配置不变。受控压力修后9.877秒通过，删除instrument后原文件7/7及根类型/Lint/格式通过，原SolSpec/Quality ACCEPTED C/I/M0。当前运行树单一接入823c3bb8，0930八文件/raw628a不变；新候选完整门禁、PG与HTTP仍待执行。

EF前端I-EFUI01原Owner修复并经原Sol累计C/I/M0，七文件提交87ac6ac3702e9a549e12bcf8fa15d941122f671d，接独立EF组合afab652c。反馈表单冻结打开时revision，刷新后旧表单禁提交；补交过期表单禁保存/上传，未知重试原body/key/revision不变。最终28/28、前端类型、7文件Lint/格式及主控补根类型实际通过；未DB/HTTP/browser。EF160证明扩展和严格账本同步未完成，不标功能通过。

### 0930引用复用修复：源码已审，真实提交尚待验证

固定源码cca4fdadb97cdaca9a7112ab2b1fa0c3a524cc7a/tree79169fc88561e52c2505b82d320228a98c0e8117，八文件；原运行目录test-runtime-stability新分支单一接入e872b1d495bc065f1a711c51b506bef0ceff556f，tree相同。0930 SQL raw SHA628a0fc0a664942896fdd85e3811bfe977702e4924ef33a58f83399a9bf8280e。原Sol累计Spec/Quality ACCEPTED C/I/M0，I-REFREUSE01–06源级关闭；实际数据库与HTTP尚未执行。

完整源码核对纠正了初步索引描述：最终旧索引豁免JUDGMENT、三类SECOND_INSTANCE材料、EXECUTION_APPLICATION及EXECUTION_FILING_PROOF，共六类；新索引及普通引用竞争分支保持这些例外。旧filing、finish、judgment、closure的purpose守卫会先拒新更正审计，0930以原函数体MD5保护，仅插入当次audit/correction/typed document精确证明支路，保留旧正常正文/OID；mailing原动作筛选无需替换。服务器派生的重复引用分类字段不是首消费证明，客户端不能自行声明。服务同时检查实际插入数，防skipDuplicates静默漏引用。已部署155–158未改，失败原请求/guard未弱化。

执行者实际离线证据为材料179/179（后续产品服务字节不变）、纯测试4/4、Prisma validate/generate7.10、后端/根类型、聚焦Lint/格式及两个Playwright选择器各发现1项。前项自身只接受public158并验证owned编译/失败原子/六类索引兼容/四守卫分支；后项独立只接受public159及原42权限，使用真实HTTP准备、五类更正和事务COMMIT。前项须标准pnpm锁入口加独立DB-only配置，不能用会启动服务的根默认配置；后项才使用正常managed服务。上述是源及发现证据，不是PG、官方迁移或完整UI通过。

EF专用材料API两文件5bd51b89f433104ca8662c4933b7b80044ba6f05另经原SolC/I/M0，96/96及类型/静态/Spec通过；已接独立前端dcf7d934和EF组合ea8a5d19。未运行真实上传/EF数据库；0930成为159后EF1000为160，旧EF159准入/SQL证明扩展仍待同步，不能沿用旧计数声称可运行。

### b563同案首POST仍500：完整材料引用事务待修

运行候选b563271c2bf265db6ad0caec9637d4f9bdf4146c/tree895c4fed066dd55e181155854f10dd0e56fbc4a6只接已审UI158两文件及快照，未改应用或重新build。runner额外非protected前置误调assertSectionRecordUiRunner，先因未继承NODE_ENV=test、再因缺真实pnpm上下文停止；均在HTTP/服务前，只读保持，原失败保留。主控批准移除runner后来加到非protected前置的这一冗余调用，真实TS开头的同一guard逐字保留并在正常pnpm test:e2e执行；未改tracked guard、伪造user-agent或清除冲突绑定。

随后protected发现恰1/exit0，正式唯一项exit1，test6887ms、Playwright总17283.424ms、无skip/flaky/retry。原279字节请求SHA9382152ca0f3bd229f571a00ba4d8081343a110f12b6c90f43dd36fbc3d5bae9相同，首POST500/requestId0e7c8ff2-ac52-4d81-8992-4d705aa3969b/03:55:13 UTC；第二POST及全部后续UI读回未执行。现成后端UnknownError/errorCode23514，但没有constraint/location/DBcode，不能沿旧错归因。唯一一次原R2 dockerlogs窄取03:55:11–15Z，PG03:55:13.392明确ERROR correction document lacks exact retained material reference，CONTEXT check_execution_mailing_record_correction() line22 at RAISE；raw377bytes SHAeeb0f8c9356bf9825ce47a621d7f60e41f7802381a83034ca75dd144b239c52d，私密raw仅路径/hash，未输出SQL/DETAIL或认证内容。

ui158-b563271-nodeenv-20261016的精简增量40项逐条bytes/hash验证，acceptance-summary SHAad5e1890f2eb41593c229449307c12f6aa4a1c70ad1692bec3885af354698748，incremental-hash-manifest SHAa48cd5cab710466068a5bbf20eb64a12d3b854a4acde32d1c06eb621d62ba0a1；未重包旧85份历史。after formal保持149全部旧PK行/68Case头/42权限身份/158/sequence/26bytes，仅auth_sessions58→59新增正常登录1行；dadd仍ARCHIVED/v6、mailing revision0、更正/receipt/typedDoc0。服务正常退出、3101/5174空闲、标准锁释放。

初步只读诊断已核五类完整写序列audit→typed correction→typed document→material reference→receipt和字段对应，唯一索引与createMany(skipDuplicates)可能静默跳过本次审计新引用，再被精确guard拒；此静态因果未冒充原失败事务内行实测。早期“仅JUDGMENT豁免”的描述已由上节完整迁移链核对纠正为六类，并补出四个旧BEFORE守卫阻塞。后续修复及证据以上节固定候选为准，原失败与历史保持结果不改写。

### 五函数158修复：A真实PG、B官方部署、C历史保持全部通过

固定运行树test-runtime-stability/codex/section-record-material-guard-acceptance，clean af6ec55e061fd6aee06a426d06d34d4d2c5902d6/tree dd28af91187825c3e0bd371b98969e98e7062733。新增158原SQL raw SHA dfe31436055f7ab9bf8d0796c48b3a0dd38a16acf4e5b3554e04e3d299b7b869，仅五个receipt变量改名，156/157不变。原Sol实现和执行边界C/I/M0；应用/schema/依赖未变，复用5ac对应734份后台产物，不重复安装、生成、构建或全verify。

唯一runner在material-guard-af6ec55-20261016目录保留本轮证据。A protected发现恰1及正式唯一项均exit0（03:37:46–03:37:52 UTC）；在owned schema验证完整旧五函数的材料引用路径错误与修复后有效/错/缺引用路径，授权true shim仅用于该SQL路径，不充当生产ACL证明。独立PostA检查后，B一次正常pnpm db:test:migrate:deploy于03:39:53–03:39:58 UTC exit0，仅应用本158，实际标准owner观察与结束释放；无应用服务、HTTP或UI。C-result八个独立检查全部通过：旧157账本原行不变且只加158成功行、149旧表PK行/68Case头及sequence/42安全身份/26文件及旧22来源bytes保持；表列/约束/index/trigger/enum/ACL/owner/schema保持。five-function-exact-inverse-proof逐函数证明只改receipt变量，逆替换原prosrc精确相等，OID/签名/owner/ACL保持。原dadd仍ARCHIVED/v6、mailing rev0、成功回执0；标准锁释放，runner停在C，不能把迁移和保持通过写成原案保存或UI通过。最终85份manifest SHAce8824a0e3d123cb0fb1724e737bab4a54ce68be199fc7a7c948b4320979e5cf、summary SHA53b93a5dffaa2f27e2a582a37c37783ceea6a5b5e1ed32f8ecc7ede55ea8a5f9；主控逐项bytes/hash核同。

UI158严格准入增量已由原Owner完成、原SolC/I/M0、主控代提交5a06fcff9ff3437420193c39d24d5d618835eb12，仅support mjs与binding pure test，旧16场景/135断言不变。精确source/applied158与修复raw pin必须匹配，157/159及同步篡改source+ledger拒绝，H42/credential/seal不放宽。该提交未接正在运行A/B/C的验收树；C完成且冻结新组合后才重新seal同run并执行原案原body/key续验，当前没有实际UI成功结果。

### 5ac同案首次重试仍500：独立SQL变量遮蔽缺陷

runner按加载补单将ignored MJS逐字节复制为TS且SHA相同，protected发现恰1/exit0；正式唯一项执行原case/原body-key首次API重试返回500 INTERNAL_ERROR，requestId beafe9d6-bab1-4678-b098-d83e63fa6d11，2026-10-16T03:02:20Z。原body私密摘要9382152ca0f3bd229f571a00ba4d8081343a110f12b6c90f43dd36fbc3d5bae9。后台仅UnknownError，location/errorCode/databaseErrorCode均未提供；不能将旧23514追认为本次根因。第二POST与后续浏览器读取未运行，修复仍未形成实库通过。新目录test-runtime-stability/.local/ui003-evidence/ui-reason-ts-loader-5ac18c1-20261016正在只读收尾/封存，尚不引用未封存manifest为通过证据；原S唯一只读诊断，runner只窄取本次PG安全字段与现成日志，不查询写入或重试。

构建始终仅一次；private环境/材料/42身份/同runId保持。原执行单哈希替换触发保护停止、同PowerShell连续phase触发绑定保护均发生TS正式发现之前，原阻断保留；未清除或覆盖冲突env，改独立新进程在保护正常通过后才执行上述唯一TS发现/正式项。原案/失败数据保留，未造新链。此为新实际500，不改记旧165 FAIL或将前置保护误归产品故障。

后续仅读原容器03:02:18–03:02:23Z窗口，唯一ERROR 03:02:20.697035551Z为record r has no field material_id，CONTEXT为check_execution_mailing_record_correction() line22 at IF，无constraint或数字SQLSTATE。原S对156正式源码确认五函数DECLARE r receipt%ROWTYPE与FROM material_references r冲突，mailing/filing/finish/judgment/closure同型；hearing没有该材料ref子查询，排除本次修复。最小方案每函数只将receipt变量声明、SELECT INTO和末IF两字段改receipt_row，材料ref谓词与其它guard逐字保持。主控复用隔离修复目录从5ac另分支，独立Sol执行新前向20261016090000_case_record_material_guard_repair（158）及五函数实际PG执行路径回归源码；禁止改部署156/157或在库临时改函数。S现有未发布EF1000目录保持，组合顺序原157→修复158→EF159，不让修复等待EF或混写WIP。候选尚未产出/部署，不能称SQL或UI通过。

本次target真实correction/receipt/typedDoc均0、rev0，全部149既有PK行/68Case头/42安全权限/157/sequence/26文件bytes保持，只新增正常auth_session1；原body与私密原请求SHA9382152c完全相同。61份主证acceptance-summary SHA0b62f67817e4bc71abdb5470b1706c4beaae6a73e37ebd921822896db3c1b8ca、manifest SHA00e4da829a2d1fee23480c0d847791119b5eb61d714f5c95dd2ba9a3fa0a6e54；补证ui5ac-pg-error-addendum-20261016/pg-error-fields.json SHA2fbc9b9ce5a79869e933f8469ddb5a3c57a12d08a74e0daff45e7c92948d4b75，2份manifest SHA084ea1871c2b85e2aa3ad408c27685302b2a6630799f799ca05c0d003c1a0b81。主控逐项61+2 bytes/hash匹配；含SQL/认证的原PG窗口与trace留批准Temp，仅安全错误和path/hash公开。正式项7702ms，总27108ms，exit1，无skip/flaky/retry；服务端口空闲/标准锁释放，无第二POST或后续UI读回。

## 原因修复5ac与同案最小续验准备（2026-10-16）

隔离section-record-reason-normalization从165仅旧E service/spec提交2d1ef085757666706fc60357e28b731210cfd540；唯一产品差异为canonical Value构造correctionReason.trim()，fingerprint/audit/row同值，客户端原input/body/key不改。service SHA9c7b177736e310ef6fc54164a15249797650c3e403b7443522056b5de2f73612、spec SHA664b7d59a8c794f3430391316ac28dc3512b6c881d2b33452cca7819b1e86419。直接回归RED三失败/72通过→GREEN78/78，类型/Lint/格式/diff通过；原Sol固定hash Spec/Quality C/I/M0。运行目录test-runtime-stability保留165旧分支与证据，另分支codex/section-record-reason-acceptance单pick dd6673ca+标准精确快照固定clean5ac18c148bb60ecb8b3f17a29b4d724ca384498c/tree582ac97ca39a7bd2dd566c13ca4065db2aedd14a。累计只三文件，原Sol再次C/I/M0，复用同输入78/类型/静态，不重verify。

唯一runner只一次正常本树build:prepared及context通过，当前149表/68案/157/42身份/26真实文件保持；原dadd案仍ARCHIVED/v6，mailing6e77 revision0、更正0、原key成功回执0。旧环境和材料未重建，原请求已私密封存。同案ignored one-case.spec.mjs protected discovery因support命名导出加载不可见exit1/0项，正式项未调用、POST/应用/UI均0，不当作修复后产品失败；原错误/config保留。主控只批准原proof逐字节复制.spec.ts（原文件保留、SHA相同），配置副本只改后缀和独立输出，再protected发现恰1后唯一正式项；不改tracked support/产品/环境或循环修复。

原UI Owner确认旧grep会重建业务链且当前无断点入口，父级选择不造通用恢复fixture。执行单runner-ui-reason-5ac18c1-continuation-20261016.md SHA2751fe88de1b20c5af100b10c615c83ffa803876d878adc85e76af8e4490f5de已原Sol窄审C/I/M0，补单runner-ui-reason-5ac18c1-loader-continuation-20261016.md SHAc65875dddb1244be13a4aee101b654ed45a2407747198e232a649784af259ede。范围为核原案失败无回执后原body/key API首次重试及同参再重放，核revision只增一次/一回执/对应审计和typed引用，再真实浏览器fresh GET、刷新、退出重登、预填、历史与四份原字节；明确拆分API幂等与UI读取证明，不冒称UI UNKNOWN/sessionStorage恢复。原16项135断言不改，其余15项不自行运行；共用H主actor的terminal撤权留所有其它需此身份验收之后。当前没有真实修复后保存结果，原500仍FAIL。

EF001领域be19ee062ecb19df77d392974c18c585b6bd437e两文件固定hash原Sol C/I/M0，108/108及后台类型/定向静态通过；S单一接为3196cd8608d78fd8d1c326fb310d0212bfbaff6a并保留材料/158 WIP。S四命令及专用上传双前缀真实接线初轮HTTP/OpenAPI/E/材料组合347/347，后续新增上传边界材料218/218，不能把不同输入拼成同轮全验。F-API新独占ef001-api-sync从3196实现八个显式内部/律师入口，当前258/258、静态收尾未冻结；read/materials未动。158/真实DB与功能验收仍待完成，没有真实Grant或预览变更。

## 165首条真实UI保存500与数据库原始约束（2026-10-16）

固定clean165ee1bd3bc40d0b35d98ece65d6e5329f527724/tree99564dbe912c857b59334ccf83eb236428aa5bdf；当前根22文件3886bytes COPYFILE_EXCL成功，原三来源根与2a副本保留。原1203源/734后台构建产物hash一致，install/generate/build不重复。protected发现1文件1项exit0，正式仅execution-mailing正向exit1，无skip/flaky/retry；实际业务测试11771ms。真实登录、创建本轮自有来源案、预填、取消零command/零事实、再次编辑均已通过；尚未到刷新重登或最终下载，不能称整个场景通过。

保存execution-mailing-correction返回500 INTERNAL_ERROR，requestId7b83e499-393f-4621-ae46-e49d74f12290；精确target/revision0、原body/key及带首尾空格原因均已留原证。backend在case-execution-record-edit.service的correction.create报P2039/23514。唯一runner仅读原容器该时段日志，明确ERROR为case_execution_mailing_record_corrections违反case_execution_mailing_record_correctio_correction_reason_check，无CONTEXT/function字段。原S只读已核DTO接受首尾空格非空原因，E value/common/data原样存储，156要求等于btrim；对冻结dist的真实DTO/value纯调用得validationErrors0且会违反btrim。错误发生在create即时CHECK，尚未到deferred材料/审计或日期守卫；不是157或fixture来源非法。主控另设section-record-reason-normalization独占树从165开始，仅旧E service/spec，按H已有原因规范化处理canonical fingerprint/audit/row，保留客户端原body/key，不通过改夹具或放宽DB遮盖；修复尚未交付或实跑，不编辑已部署156/157。

新增本轮案件dadd8f79-1216-407c-9803-659577c0d8c1及正常API准备事实、4份材料/CV、6审计、1会话保留；更正失败事务未追加correction/receipt。67旧Case头、旧advance21/audit915行、42Grant及旧安全、157账本、22原source/target文件bytes保持。case_number_counters正常随新案递增；原取证器未纳入updated_at而产生的false与counter-check-limitation.json原样保留，不当作第二产品故障。服务已退出、3101/5174空闲、标准锁释放，无Grant或身份写入。

证据位于test-runtime-stability/.local/ui003-evidence/ui-first-storage-165ee1b-20261016，acceptance-summary SHA773493dda9a404b20a7d9c0aa8a42ee5e09bf29c127a73960be8723ae3f08645，67份manifest SHA8f1d2a2c83d0134a2f66e0f8dfdd256cc8d29f68985cb407ca3dbc31dec5639f；补证ui165-pg-error-addendum-20261016/pg-error-fields.json SHA52f025f430dd3dec9a760c497be0334f8a4680c1cf29b5c5587cc01eec886eac、2份manifest SHAa4b8a13295fadb8415433981618cf1b709f25df6fde5d370f5074ec593f3e329。主控逐项67+2份bytes/hash全匹配。含认证数据的trace/原PG窗口仅在批准Temp私密目录，普通证据只引用path/hash，不搬回开发区。旧材料根前置失败21份保留，不再作为当前阻塞。

并行EF001材料helper v2三文件实际208/208及backend类型/Lint/格式通过，原Sol固定hash Spec/Quality ACCEPTED C/I/M0，正式提交f9c0d1d75e1e69d85f7abcb7edff0abf673007a6；仅这三文件单一接入E树609e6417d1bd30143fab48f10f5833e2a45da24c，保留领域两文件WIP并恢复验证。两真实方法同tx品牌/权限/真实root及head/typedDoc/ref闭环已形成源码依赖，158 SQLproof、专用上传及真实DB仍待验，不称功能完成。新业务日期按SD59严格日期/null，不新增today或上下界。环境材料根单一真源7f1f07b独立小修已审C/I/M0，未混入本次165运行输入。

## 165首UI组合与材料根前置纠正（2026-10-16）

已审H/工程/UI微增量累计到独立test-runtime-stability树branch codex/section-record-h42-vertical-acceptance，固定clean165ee1bd3bc40d0b35d98ece65d6e5329f527724/tree99564dbe912c857b59334ccf83eb236428aa5bdf；原2a运行树与H503备用均未改。新组合实际rootTS、UI128/128、H61/61、入口54/54、context11精确已审漂移标准record/strict及diff0，原Sol组合Scope C/I/M0；三工具测试首次Temp缓存mkdir EPERM在0tests前阻断，保留后正式权限同切片54通过，无DB。原作者同字节Lint/格式结果复用，不称完整verify或真实UI已过。

唯一runner按首UI单只准备，正常frozen install/context/Prisma generate/backend build均0，1203tracked源/734backend dist已留；但主控要求复用2a PRIVATE_FILE_ROOT与scripts/test-environment.mjs194-200当前root/.local/private-files/test硬约束冲突，官方capture前拒绝。DB连接/写入、服务、discovery、正式项全部0，未造run manifest，非产品断言失败。原目录ui-first-165ee1b-20261016的blocked-handoff SHA4fa0cf28bd417534a60004c32287d1d402499f184dc63b3c6cf94f1502a4bde6，21份hash-manifest SHA68f9a672450bcb801bcb7d2c496804e18f9d75440b04168430f4855814b3f72a，主控逐bytes/hash核21/21；原配置/失败记录保留。

父级明确同意按当前候选独立根正常准备，原Sol修正执行单C/I/M0。主控ignored runner-ui-165ee1b-storage-root-correction-20261016.md SHA12a5ea56663eff3bf45f7bb2e4d1892059d7585b4923d2650eea62d9b96c56ed覆盖前单错误两句：只改.env PRIVATE_FILE_ROOT，其它凭据/URL不变；准入后标准锁内先只读核CV与已封22/3886bytes清单，再source真实bytes核对、target missing-only COPYFILE_EXCL/已存exacthash、不覆盖不移源、不DB/Grant写；复制后fresh capture/metadata/list1/唯一execution-mailing完整正向1次。既有源/产物未变可复用install/generate/build，不重做整个准备。当前复制/capture/UI尚未执行。原环境Owner另独立test-runtime-storage-root从0f6开始仅五文件，将测试根派生抽到既有pure helper并让validator同用；不松guard、不造共享存储根/新runner，当前165源冻结，不等未来工程小修。

并行EF001首稳定19文件已精确提交b12b41bcb7f0296a4cb19df360b34e19a6788dff/treeaf9fa22c348f2f0fce33c9b7e8aa014f1be0d755，manifest SHA1569957ab0b3e58c9245f1f40d6a7f9457f1a002109ba849e824caeadaec6d9e主控/原Sol逐19hash核准，受限Spec/Quality C/I/M0。schema四模型/DTO/四Action及provider/组织decoder、材料类型同步但generic新类别显式拒，后台4suite219、前端组织49、三类型/Lint格式/架构通过，无DB。原S继续158/专用材料/读路由；新ef001-domain独占树从b12创建供原E仅领域service/spec，具体指令已落ignored relay待父级原通道续办。首baseline不是完整功能或158已验。

## R2既有角色42项实际闭环与并行实施边界（2026-10-16）

用户第二次明确批准三项execution.mailing.correct、execution.filing.correct、execution.finish.correct（消息Sentinel_99c7388c6e608191a8cf0379ef2f1f39；与此前六项授权分开）。唯一runner正常start原持久卷R2一次，现场healthy及原149表闭合后，两事务仅同一user edc8bf6f-6660-41f6-8418-f72f87443a1c、role51c34a8b-fb00-45b1-ab9f-d077d59d4878、部门10000000-0000-4000-8000-000000000001的缺失DEPARTMENT项：35→39补complaint.mail/filing.submit/acceptance.register/external-entry.create，hearing.schedule/execution.submit原已有；再39→42补三项执行更正。没有替换actor、扩foreign/readOnly/baseline或恢复旧撤权。149表所有旧行/全安全关系/67Case/21advance/915audit/157账本/sequence/22两端bytes保持，只有7条新增Grant；端口空闲/标准锁释放，无HTTP或新测试。

固定运行树仍clean2a99bba/tree3f594e58、1197源及737构建hash保持。运行树证据r2-four-grants-continuation-20261016完整26份manifest SHA e6baa1d3b7e94b59cc2a83e90b43696bc6563046fd927206e8a3306fe02073de，事务SHA8e257ce99283f9e049e62bb422d8eae0317444564a6c94c56fc36a97996e5103；r2-three-correction-increment-20261016完整29份manifest SHA32331cbbc325cd2fb76d1fde7e4e7e0f2d3cee0e6d5ec8688892cee8bbd83021，事务SHA69eb7198813f00a47025d4f944cb8c165527377d5e4d114fb1a05a0465a36e9a；handoff-summary SHA df1b29f2e618d7c54f0e6960d5c03a39fb2a6ca03cfcf6e8e347457cc7f6bed0。主控和原Sol各逐55份bytes/hash核验通过，Spec/Quality ACCEPTED C/I/M0，范围仅授权和实际回执。原credential从原失败trace精确资源内存恢复、原hash复核且未重置；私密文件仍用户Temp，普通proof只存引用/hash，主控/Reviewer未打开私密内容。初次reader不识别_file的BLOCKED证据原样保留，没有重复start。UI/H已获成功送达的非敏感回执，继续纯代码恢复；真实登录、H命令及UI16仍Pending，不能把权限准备当功能完成。

H恢复四文件候选已按冻结hash正式提交9bdb23f454ad00796cf1525f251d814cf54ad6d3/tree54fab09559d307b06acf4f1d9ec505b3bf00f465，原目录clean；53聚焦/root类型/四文件lint格式通过，原补丁SHA717a07574b1620f41b0f00cfa589edfd653aa53cf4633a7b9696250aa3f6fc8e。原Sol窄审Spec/Quality REJECTED，C0/I1/M1：I-H-RESTORE01新增7条只验action/scope/数量而未钉事务实际ID，须原Owner补精确7记录及替换反例；M-H-RESTORE02两负例实际原创建manifest仍由唯一runner在注入前核bytes/hash/身份/credential，不能只凭64hex格式。主控没有合入运行树或派实跑；原Owner修复续办工具被AbsolutePathBuf拒绝，父级原通道待转，未循环重试。此源码finding不推翻上段已核两实际事务与旧行保持结论。

后续原H经父级恢复：仅两support补丁70ac1d933ed4a2482347cb89a4d73d7da4a2d3ec，mjs BE34BC35698A23E1E141FFD7B22AF2C89B5AC92A9C555C09D2446CA4C69F853F，纯test8986637FB9E396DC7498DA09A40ADA29C4EA2AEB6BD6723626B577B9FF48BB0E。真实七新增记录按action排序摘要016d104b18a9609b1228be6e44046c0742f253f1fdb7d1d003683d38cce76c30，原Reviewer独立从两事务重算一致；旧源8项ID替换反例RED，新42定向纯测/类型/Lint格式通过，I-H-RESTORE01关闭C/I/M0。累计pick到独立closeout并标准快照为503b9806a71c44c853ca7a36e2dc366812d0ae44/tree0865c03ccd203256fe4286c3109c719c17d36635，组合实际rootTS、61/61 restore/recovery/sourceadapter、四文件Lint/格式、diff/context strict全过；backend/package/锁文件与2a99精确同字节，无DB/HTTP。原Sol候选scope条件化接受，M-H-RESTORE02必须唯一runner在webServer前实核两个负例原创建manifest/身份/旧credential；缺即BLOCKED，不造对象。首项运行单主控ignored runner-h-503b980-first-vertical-20261016.md SHA7e991d19ee3eb819cd36716d55b25ee0953d681fe5c6267f4a6ad550bd2c76fa，规定fresh cleanup完整资格/15分钟、锁/capture/157/42/22bytes、正常本树build及3101同源、protected发现1→正式首项1次，禁止旧verify/E65/迁移重跑，未实际执行或声称业务通过。

CORE-EF-001原S已通过父级有效通道在ef001-shared-contract接单并开始共享小基线：4追加模型/4DTO命令和Action、route唯一filingId/目标、独立revision/原filing不可变、受控补交材料。业务SD-59不变，当前仅纯实现，无DB/158迁移执行或真实Grant；E域service/spec仍独占待稳定SHA，前端另派，当前验收不等EF。

工程优化原独立Agent三文件提交c34bf23258092497a87d94ad1ae1009e5b193687→0f6b3b7e67396e82003e2f3315ac4f870d974041/tree77b2e6e4d8b51971b0564852c2e922ad848e5d88，仅scripts/managed-test-runtime.mjs/.d.mts/.test.mjs。原I-RUNTIME01接口修复后createManagedTestRuntime生成真实backend/Vite命令、绝对cwd、API3101单服务/UI5174双服务、no-reuse等片段，同对象验证并可直接defineConfig；4纯测（含实际PW消费）、声明TS/Lint格式通过。原Sol接口层C0/I0/M1：实际UI唯一Owner必须直接消费factory片段，禁止再覆写webServer.env/命令，未接线不能称环境准入完成；现有六入口路径仍该Owner独占，稳定累计两SHA和约束已成功送达。无Docker/DB/HTTP/新日常runner。主控最初pnpm exec的包shim不可用后直接执行已锁定CLI，轻量snapshot不支持文档后按已解释自有diff正常record/strict；Spec57/67/11/59、三文档格式/diff已通过，没有重复完整verify。

## 六项隔离测试权限新授权及恢复核对（2026-10-16）

用户01:02 UTC消息Sentinel_fdf4b7a29e488191a3002876ccc91fa7，在明确询问仅为本轮隔离测试角色补齐诉状邮寄/立案提交/受理登记/开庭安排/执行提交/外部转入六项部门权限后回复“补齐”。封闭Action为case.complaint.mail、case.filing.submit、case.acceptance.register、case.hearing.schedule、case.execution.submit、case.external-entry.create；只补manifest内隔离R2角色实际missing的DEPARTMENT项，原角色/正式账号/其他Grant不扩。用户原文与边界保存于主控ignored six-action-user-authorization-20261016.md，SHA871f3692227edcaa6e8a2dac5c4a85edc6981f19346d46aa070be756c7b7b2e5。此为新授权，不将先前“继续”追认为补权批准，也不追认旧未执行/拒绝操作已成功。

恢复现场五树均与固定断点一致且clean：主控62e54d6、独立ce3794d/tree08f8c1ce、运行2a99、H a6d3d59、UI212b270，主控context:check实际exit0；没有重测同树门禁、服务或数据库操作。原Reviewer收到新边界，待原runner只读对象/缺失计划、UI/H准入微合同后窄审；唯一runner实施实际权限差异并保留前后安全行，原Owner不并发写Grant。三个原Task直接消息均遭AbsolutePathBuf路径路由错误、未确认送达，父级有效通道待转；不循环重试或新建替代Task。真实点击/接口结果仍Pending，人工预览和日期硬规则hold保持。

## H同源准备两文件纯修复（2026-10-15）

原H Owner在clean f83fc130基线仅修改case-historical-record-edit.spec.ts及其r2-binding.test.mjs。专项origin与baseURL共用3101，局部sourceBuilderRequest对内部及client/notary/lawyer登录/写入同步Origin，浅拷贝headers且保留原body/key/CSRF、内部actor映射和四个独立cookie context；不改共享helper/产品Origin守卫/Grant或原业务断言。旧5174配置在直接VM回归中RED两失败，新47/47纯测及root类型、两文件Lint/格式、diff通过。无真实HTTP/capture/DB/服务/浏览器或补权，已有实库actor保留。

两文件SHA依次46d4d15b777a58a812e79f75c77eda846a96bec7199d3f5c0bbde682610dc816、74500d1fcf13cbd660fd7828347d875091639e8597d9b2def7ecb0ea751841b2；补丁/日志在用户Temp/h-origin-f83fc130，patch SHA8b2662144d23b6adcc74804366c5e52182a8839219375df0a83cd270d2ab8b7d。普通Git因index.lock权限拒绝后未绕过，主控正常require_escalated精确提交a6d3d59b91f437eee8badc6557a184c508d03970/treeaf22772ebaa7181ce4a6318ff72999b1433dd074，原树clean，原Reviewer窄审Spec/Quality C/I/M0。该结论只关闭已定位测试准备源码问题，原57份Origin403失败保持，H业务及缺三Action仍Pending，不再实跑准备链。独立closeout接此小提交为af749d38，运行2a99不动；本地未发布，新组合不冒旧完整verify或UI通过。

## H首项实际Origin阻断与本轮独立收口（2026-10-15）

原runner仅在新ignored配置修正cwd及锁proof取证顺序后继续同clean2a99。protected发现精确H首项1/1，正式仅一次、0retry，首次POST /api/v1/auth/login到3101、Origin5174即403 ORIGIN_FORBIDDEN，requestId50be9c6d-245b-4a1f-905d-592647c13a96；未到业务权限或资料API，不能称缺Action403。冻结factory仅留下新合成user/credential/membership/role/assignment各1及35条本轮role_grants，无hold external-entry.create，Case/Lead0。旧全149表原行、157链、结构/sequence及22source/target文件保持，H只读closure6/6，正常服务/端口/标准锁收尾。E65秒已证结果复用、未重跑；另两项H和UI未执行。

service-h-api-cwd-2a99bba-20261015共57份，manifest SHAa5307e17af39d842c1ed01b59acae261de8eee16a5454685a8d9137978c340af，summary SHAc5f8ba22857b2e9d34fb6f855c94c05ba82c9a89a8a004cc68a897c715807b3b；主控及原Reviewer全部bytes/hash核对，证据边界Spec/Quality C/I/M0，H业务仍BLOCKED。原H Owner仅静态诊断合法同源入口，禁止关闭/绕过产品Origin、防护配置放宽、泄露token或补权；不再实跑已知缺权限准备链，真实业务等用户授权。已审c11/212只作为测试安全修正接入另树独立候选，与必要文档收口；不合入/发布未验收分栏产品，不把新的测试/配置组合冒称实跑2a99旧完整门禁。

## 2a99 v6真实周期补证与UI启动准入（2026-10-15）

原runner按新单从现存v6继续，20:36:16.890至20:37:31.005 UTC总74115ms，正常后台PID32568从health成功起真实monotonic存活65446.4402ms；原149表全当前行/结构/29Case列/安全/157账本/sequence/22source及target字节不变，精确advance21/audit915不再增加，12新表仍空。四类cleanup安全窗口重查通过，无手动扫描/业务API/时钟修改或禁用任务；自有后台停止、端口与锁释放。E32份证据在service-h-v6-cycle-2a99bba-20261015，E-hash-manifest SHA00be7f70533d494d75e1bb4bb71328805219c1dceec7128ba31fafeb16586c76由主控核全部bytes/hash，不伪称取得raw扫描{0,0}。

同单H前检安全、固定工厂35Action无hold但缺已知三Action，protected发现恰1。正式第一次在启动webServer前因runner ignored配置未设项目cwd而找不到evidence/backend/dist/main.js，未进入测试/API、actor及Grant0；reporter未先保存formal token的证据缺口如实保留，不能称得到403或H业务失败。原runner已成功收到仅ignored配置cwd/reporter取证顺序修正的续办，fresh安全窗口后仍仅原首项，403即停不补Grant，不重E或verify。

UI原Owner固定212b270a4b896d7e5340ae3ec6216afb2b5eee53/tree83caa350b12cf91150b7e01f859f15ba1b6a2f13，父c11；八文件增量只含已授权六入口路径及原support两处勘误。主控/原Sol核8源码+22证据共30份bytes/hash，原spec全文blob56b749c7a329320a1a199fe0fa8ff0cbfadf99af不变，16项/135断言保持。48/48入口纯测、79/79原source纯测及类型静态通过；三种正常离线counter配置均固定Pending、启动0，真实list16/启动0；dummy H无服务框架重放1/1只是配置兼容。原Sol Spec/Quality C/I/M0，可关闭受保护runner及默认root config的webServer-before-spec Important，不宣称覆盖任意外部自定义配置。全部16真实业务与待批权限仍Pending；未合入正在运行的2a99，旧完整门禁不扩大到此新八文件组合。根回执ui-webserver-212-root-receipt.json。

## 2a99正常服务首次推进及未完成周期（2026-10-15）

原唯一runner同clean2a99bba完成四类cleanup只读盘点（当前候选、非时间条件对象均0，deadline null）后启动正常自有后台。20:19:53.060 UTC，旧案d16c2ee8-9a31-456f-9836-79e1908636f9合法WAITING_HEARING/v5→WAITING_JUDGMENT/v6，精确advance5203c56f-f82e-4cda-955d-79615c270920、SYSTEM audit1e801808-a163-4768-bce4-eb0c87d4c1ec各追加1；原安排/轮次/entry/dueAt不变。主控执行单误列cases.updated_at，冻结实际29列没有该列，故原断言BLOCKED/exit1保留，不改schema。原只读收尾4644/4644证明其余旧行/安全/sequence/157账本/22份两端bytes不变，新12表仍空；推进总21、审计915。健康仅约5.2秒，60秒周期NOT_PROVEN，H未运行/Grant0；自有后台已停止，端口和锁释放。

34份证据service-h-2a99bba-20261015的manifest SHA3960f48a7e77e4cf7eb22d0a1077c8226d90928c8615e47fe3cea619a6c74983、summary SHA6d34569689cd036cd47f82627b2d18f5b07dc0703771c0053ab26b250333ab85由主控及原Reviewer核bytes/hash，既有转移与恢复边界源码审C/I/M0，不是完整服务验收。新runner-2a99bba-v6-cycle-continuation.md SHA8b43e415f58d3468836bcb7bfb8fc74c4a202210ca5ce7ca1d94c566c40a2bca已独立窄审：以真实v6及既有advance/audit为基线，fresh cleanup安全窗口后观察health起至少65秒无任何再变；成功再按原范围H首API1项，403即停不补Grant。发送原runner遇AbsolutePathBuf路由错误，未确认接单；旧失败不覆盖，待父级有效通道续办。全部实际UI及待批权限仍hold。

## 2a99正式Prisma部署与真实历史、文件保持（2026-10-15）

固定clean2a99bba578a0a98743302478c8312d4a36a9bf8c/tree3f594e58ebe0eda47accad405725e280da090692，原唯一runner按精确执行单完成A/B/C。A在单标准锁内用COPYFILE_EXCL复制22文件3886bytes（来源列表16/公证4/开庭2），每项copy前后原source与新target stream SHA/size匹配、逐层no-reparse/escape，无覆盖/move/delete，旧137列投影及安全/Case/sequence保持、锁释放。B在A锁释放后一次正常pnpm db:test:migrate:deploy，通过固定pnpm→scripts/run-test-migration.mjs→Prisma7.10.0自行取锁，19:46:11.437至19:46:15.039 UTC实际exit0，原输出明确应用156/157；实际ownerPID21712/token f17c1246-91e8-4abb-a726-1d1bf7437988被观察live并结束释放。没有rawSQL替代、alternateURL、修改SQL、retry/resolve/rollback/reset；正式CLI发送边界由这次实际部署独立证明，不再只依据owned replay推定。

C独立READ ONLY后检确认public账本157完整名/checksum/finished/noRollback、原155全账本整行hash不变，仅新增156/157两成功行；原137表按原列/PK投影4336行逐项保持（账本对原155行单独投影），全部67Case头、旧轮次/来源/事实/回执/audit/材料/ref、9完整安全表及baseline3用户/3角色/66Grant、sequence不变。新增12模型表全0、旧draft5新列及旧CV1新FK共6列均null；四旧函数pg_get_functiondef只精确日期输入literal替换，其余旧函数/索引/触发器/ACL等已核。22原source及runtime target真实bytes全匹配，原due案d16c2ee8仍v5/WAITING_HEARING，无服务调度。closure/archive及DELETED/PURGED等旧零行覆盖限制沿预检据实保留，不虚构这些历史或恢复证明。

原post-result.json必须保留为BLOCKED/exit1（3788/3789）：唯一new-constraints-within-frozen-ddl检查漏计旧表上的合法CREATE CONSTRAINT TRIGGER对应pg_constraint contype=t行，不是产品迁移或旧数据失败。原SHA a65ee1ad99468deeb4f988fe17fedc42ffad6df9bc700c324b8153f767ffeb87未覆盖。仅使用已保存schema-before/after与冻结156/157做离线补证，未再连DB/重迁移：旧1210约束0漂移；新增162中36个t精确对应156静态14、157静态2及动态20consumer，旧表18，逐表/名称/时点/deferrable/函数/动态列参数一致；其余126普通约束为12新表123及旧表明确3项。普通约束中49个63字符名称为PG截断，按DDL类别/定义核对，不以原长字符串直接猜名。addendum SHA47666d04e04f43a0a0354c950adc9a057d85244f550a5171692d82564931dfdd绑定原post SHA，仅处理本批已核字面量不含空白/引号/public限定的deparse呈现，不是通用SQL parser。主控及原Reviewer据原3788项与严格补证综合接受阶段C，不能改写为原3789项同轮全过。

最终证据section-record-edit-frontend-integration/.local/ui003-evidence/public-upgrade-2a99bba-20261015/含52份manifest，主控及原Reviewer逐项bytes/SHA匹配；manifest SHA071d761e2e7d7bbd11cd5cdcfe0c8732922474c67f315d4da835bba0431f2446，summary SHA4b6e9da68582fbe03958b49dd977aa882b4106ed5b4072a72bf4d87f9cf64c3f。阶段Spec/Quality ACCEPTED C/I/M0，根回执.local/ui003-evidence/public-upgrade-2a99bba-root-receipt.json；同1197 tracked输入/737构建hash不变，限定复用2a99完整verify，不重跑。旧28/36/39/53/50/18份证据不变，备份两文件只核byte未移/restore，端口与锁最终空闲，未Grant/新actor/服务/UI/预览操作。

后续边界：服务启动前除hearing due盘点，还须按MaterialCleanupService四类真实where核当前与下一到期时刻并覆盖启动/观察安全窗口，不能只凭当前0推断未来0；不得改日期/禁scheduler或清理旧bytes。父级已允许把旧due案自然推进独立记录，H首条API可按既有冻结factory（无external-entry Action）范围实际验证，失败停、不临时补Grant。E/156bridge/S当前factory显式含hold的case.external-entry.create，暂不可运行。合并权限请求.local/ui003-evidence/section-validation-permission-request.md/.json准确记录基线roleA/B/SELF为23/23/20=66（不是22×3），管理user.manage/lawyer.account.manage已在基线A/B但不可私复制，正常UI另缺5流程Action；前三新执行更正标签无自动Grant。既有UI c11四文件移除S/H外部工厂，79纯回归、类型静态与发现16通过，只关闭测试源码unsafe委托风险。Playwright1.63正常run在load/beforeAll前先启动webServer，故不能声称整个运行在capture/DB前拒；该独立Important开放、c11暂不合入、全部16真实UI继续Pending。日期硬规则和持久预览冻结。

## 2a99历史只读预检与后续准入边界（2026-10-15）

19:28:00.769至19:28:04.190 UTC，同clean2a99bba578a0a98743302478c8312d4a36a9bf8c/tree3f594e58ebe0eda47accad405725e280da090692，唯一runner完成只读历史预检exit0，结论READY_FOR_EXACT_COPY_REVIEW。标准锁实际PID42748/token d84824d5-9b80-43a3-8c20-735f7b76b850，结束释放，3101/5174前后空闲。PG快照为REPEATABLE READ READ ONLY，137表4336行按全部原列/类型/PK逐行hash、完整结构/enum/ACL/sequence/155账本前后相同；包含67Case头、65round、全部原typed/receipt/audit/material/reference和9完整安全表，另列baseline3用户/3角色/66Grant，不仅保护baseline。closure/archive等实际零行表明确记覆盖限制，不虚构这些历史事实。既有Temp dump/TOC字节与canonical备份摘要相容，未restore、不含库外blob。

全部CV实测22，AVAILABLE22、DELETED/PURGED均0；批准四根内22/22真实stream SHA/size匹配，父链lstat/realpath无reparse逃逸、无缺失或冲突，无metadata-only无法验证项。来源ui003-list-module-baseline16、公证列表4、hearing2；当前验收树私密根0/22。封存proposed-missing-only-copy.json精确22唯一CV/目标，共3886bytes，raw SHA256815c23e94766a800623d1765655316a0cfd68b80412445949397ec6857fc00e7。只形成复制建议，未copy/move/delete或改DB指针。后续须复制前重验、拒覆盖、复制后原/目标字节复核；官方pnpm db:test:migrate:deploy及原137旧列/新增null列/旧155账本加两成功行的实际证明仍待独立执行，owned回放不替代该边界。

真实只读调度盘点：Shanghai日期2026-10-16，WAITING_HEARING7、过期且满足固定服务源/当前安排/轮次/版本条件1，case d16c2ee8-9a31-456f-9836-79e1908636f9，v5，hearing2026-10-10，当前advance为空。onModuleInit立即scan，故后续UI服务可能合法推进该旧案；须先明确记录该变化，不能误算为迁移改写，当前未调scan/启动服务/改日期。

证据section-record-edit-frontend-integration/.local/ui003-evidence/history-preflight-2a99bba-20261015/共18份，manifest SHA2569aecbc6973950aab276b606dd0d49cff170f02b82a505e5c76d369d941b343f5，summary SHA256645985bde89648b8280152f65ff82966491271c343f96368e063fee46dc4f058；主控及原Reviewer逐项bytes/hash核对，并重核原50份不变，回执.local/ui003-evidence/history-preflight-2a99bba-root-receipt.json。原Reviewer最终Spec/Quality ACCEPTED C/I/M0。没有重复verify/owned、public升级、seed/Grant、备份移动/恢复或UI。

父级本轮已批准精确missing-only复制与无服务R2正式前向升级，主控固定执行单.local/ui003-evidence/runner-2a99bba-copy-public-upgrade-admission.md SHA256887ad05332330a834bcdf8a1f7b3d80dc4cb882e265a0193da7da8181816aeca，原Reviewer准入C/I/M0；A复制锁释放后B官方入口自己取锁，失败不resolve/retry/reset，C逐列旧行/全安全/sequence/真实bytes保持及新null/新表空/账本两成功行实证。发原runner被AbsolutePathBuf路由错误拒绝、未确认送达，不重试；当前仍无copy/public部署。父级另明确后续服务启动时应单列上述真实due案的合法推进，记录精确头/安排/advance/audit并证明只预期案变化且无重复推进，不改日期/删案或禁用生产规则；这不属于当前无服务迁移单，也不是业务推进已发生的证明。

I-SECTION-UI-GRANT01为新增Important测试准入阻断：case-section-record-ui-database.mjs的actor factory调用S createSectionUploadActor，后者写入仍hold的case.external-entry.create新Grant；spec external()及两层own校验均依赖历史转入来源。因此原五kind UI16不能称为不依赖该Grant，当前禁止执行。原UI应在既有已批准权限下用真实正常来源/流程API准备新对象，保留本run actor/源链归属、CAS/文件/回执断言；无法合法构造者保持Pending，不换角色绕过、不直接伪造Case/stage、不改baseline安全行。该问题不追改既有产品源码质量结论，也不阻只读历史及独立迁移。根向原UI发送续办消息被自动审批以当前发送授权证据不足拒绝，未送达/未重试；准备说明.local/ui003-evidence/ui-grant01-owner-relay.md及非运行升级草案r2-public-upgrade-next-draft.md已落盘，待明确发送授权，不能代发绕过拒绝。

## 2a99完整门禁与owned-schema风险专项通过（2026-10-15）

固定clean2a99bba578a0a98743302478c8312d4a36a9bf8c/tree3f594e58ebe0eda47accad405725e280da090692，19:06:53至19:10:41 UTC正常完整pnpm verify实际exit0：工具11套94项、前端124文件2207项、后端120套1850项、全部严格context/Spec/架构/Prisma生成/类型/Lint/格式和本树双构建通过。NT006实际标准锁PID20976/token9b75e2dc-7a7a-4cb2-9205-1835d7c6a407于19:09:22.802观察并释放；source及737构建产物manifest留证，不复用旧候选充作本次执行。私密archive/TOC仅size/hash/metadata复核，未还原或读取内容。

同树protected --list实际恰1文件1项、exit0，随后唯一DB-only spec真实1/1 expected、unexpected/skipped/flaky/retry均0，正式5.1秒、exit0。真实sanitized attachment source157，六checks精确通过：empty-original-chain157、156-controlled-failure-and-original-retry、four-functions-exact-literal-date-replacements、157-controlled-failure-and-original-retry、old155-projected-data-acl-file-metadata-preserved、owned-foreign-keys。156原前缀与事务两次query发送，受控失败后精确残留mailing/filing/finish三个新Action enum再原字节重试；157失败后labels=[]再原字节重试。内存文件64字节、SHA256b8749b4769c204cad585d91b3930f9014569e95d002cd6d24fb787cfe592428b；fixture明确仅ACL+DRAFT客户+文件metadata/内存bytes，排除真实Case历史和存储blob。

helper三次public摘要一致，自有empty/upgrade schema均按受审保护清理，cleanedSchemas2、无手工cleanup或残留，最终仅public。外围前/门禁后/最终public155全部名称/checksum/finished/noRollback、137表4336行、结构/事实/全部安全摘要/sequence及标准指纹保持。发现实时ownerPID40108与正式PID29388独立记录，结束释放；未启动业务服务或页面，按原retain-on-failure策略PASS不生成trace，不伪称已有成功trace。原28/36/39/53份旧失败证据hash全部匹配、无覆盖。

最终证据section-record-edit-frontend-integration/.local/ui003-evidence/migration-2a99bba-20261015/含50份manifest，主控与原Reviewer逐项核hash/bytes；manifest SHA2569d116cca20ba32f7d1eb9f1b27f89685141ebf9cd6ddfb33b56d1f1ce38cde19，acceptance-summary SHA256806ec217cccb143d63ad929c57714662985a384ba5d9faf83ba085db9d27fdd5。阶段Spec/Quality ACCEPTED C0/I0/M0，只关闭该完整门禁及owned风险验收；不扩大为正式Prisma public deploy、真实旧Case/blob保持或16UI通过。正式Prisma发送边界仍由后续实际CLI独立证明，不因两query replay推断已过或反向定性为bug。

按父级明确的隔离R2开发授权，根已给只读历史保留前检单（.local/ui003-evidence/runner-2a99bba-history-preflight-admission.md），原Reviewer受限审C/I/M0：同固定树/身份、单标准锁、137表原列与Case/回执/全安全及baseline66摘要、全CV状态/指定四R2根内真实byte保留版本hash/size、PURGED不恢复、缺失/冲突精确清单，Temp备份仅hashmetadata；不copy/move/deploy/login/Grant。根续办通知被AbsolutePathBuf路由错误拒绝、未送达，所以该只读单尚未运行；这不是待用户重复批准正常步骤。取得实际物理位置/缺失copy清单后再给精确missing-only copy及正常pnpm db:test:migrate:deploy边界和旧列/新增null/旧ledger+新2行的比对，之后独立五kind UI16。external-entry新Grant仍待用户，不能换actor绕过；预览/生产不属于本授权。

## 524完整门禁通过、157真实回放失败（2026-10-15）

固定clean524dc060bb34f2f1ecce991246caeecbc4d32d7e/tree9a0178f264f0b92ba6d23150a264f2b03ac3b4a7于18:47:38至18:51:28 UTC实际一次正常pnpm verify，exit0，未复用48d：工具94、前端124套2207、后端120套1850及严格context/Spec/架构/Prisma生成/全部类型Lint格式和双构建通过。NT006实际标准锁owner PID16080/token70d436c4-c437-4dde-8847-e9ad679a0cce于18:50:13.939被观察并释放；当前源码及737构建产物manifest留证，未借用其他树dist。私密归档/TOC仅size/hash/metadata复核通过，不等于还原或库外文件备份。

同候选protected --list实际1文件1项、exit0，随后18:51:33至18:51:38 UTC仅执行唯一DB-only专项，exit1、expected0/unexpected1，无skip/flaky/retry。空schema原链已越过修正156，但在20261015170000_case_section_record_uploads失败（helper474/replay508）。只读精确PG日志18:51:37.199/PID49779实际syntax error at end of input at character14066，未输出SQL或参数，未提供数字SQLSTATE，禁止推断。原Reviewer与S分别定位正式157 raw218b的该字符在:196 IF条件内CASE WHEN的THEN；I-S-MIG03 Important开放，由原S最小消除解析歧义，保持20MiB/50MiB/NULL与原守卫语义，并扫描同型，不修改15610760或旧155。新修复尚无固定候选/真实PG结果。

真实sanitized attachment source157，checks=[]、enumStaging=[]、memoryFile未达，upgrade/失败重试/旧数据矩阵未运行，不能扩大为156或157风险验收通过。自有empty schema安全清理1个、无手工cleanup，最终仅public。三次helper public摘要相同；外围public155全名称/checksum/finished/noRollback、137表4336行、结构/事实/原安全cohort及指纹前后相同。发现实时锁PID18544与正式PID5896分开留证，结束均释放；实际失败trace/JSON保留，未启动业务服务/页面。

最终证据section-record-edit-frontend-integration/.local/ui003-evidence/migration-524dc06-20261015/含53份manifest，主控逐一核hash/bytes匹配，manifest SHA256ea0f78d491e938fa21530bf33dffca78e272892b3eedf6390b374182de2c10e1、acceptance-summary SHA256d0f32ffa9f22fa6904412ef91e8739e32266adff4e0f57d9448247b8127cd5df。原28/36/39份历史证据hash不变。原独立Reviewer本轮完整门禁子阶段PASS、迁移REJECTED C0/I1/M0；旧I-S-MIG02源码已关闭，不能据此跳过新157失败继续部署。下一步历史旧列投影与真实blob保留的准入草案已受限审C/I/M0，仍非执行授权；public部署、Grant、业务/16UI、预览及备份恢复均未执行。

## 48d发现入口修正、156真实回放失败（2026-10-15）

原S在clean e9cc对相同配置进行真实离线CLI发现：.ts/.mjs均成功；继承root且无custom reporter的A成功，仅增加静态导入run-e2e的空reporter的B复现相同模块错误，删除该导入的C恢复成功。9项关键源输入raw hash与正式48d一致，未连接数据库。由原runner仅在新ignored目录修其reporter，使用内建os/path保持正式Temp锁根、固定resource key及实时owner读取/PID校验；正式源码、共享runner、SQL与测试不改，旧36份失败证据不覆盖。原48d发现阶段的runner-lock-proof.json实际448字节、SHA256dfbe9c1612bc8b49755a8ee4b05dc5521ab6b64deb0e8ccbb50bad508ce6b100，在18:18:16.164记录实时owner PID6184；此前“onBegin前失败且无owner”的summary表述错误，原Reviewer已撤回，保留旧原件并在此更正。

同一clean48d5bbe/a3ff7341于18:29:58至18:29:59 UTC经protected --list实际发现1文件1项、exit0；18:30:00至18:30:04 UTC仅执行该DB-only专项，expected0/unexpected1、无skip/flaky/retry，exit1。唯一失败为empty原链重放20261015150000_case_section_record_edits；PG原时间窗只读日志18:30:03.792报invalid input value for enum case_judgment_kind: "HEARING"，character81546，未提供数字SQLSTATE，不作推断。独立Reviewer确认I-S-MIG02 Important：156:698在case_judgment_facts j作用域使用bare kind='HEARING'，列kind的既有enum仅REGISTER/CORRECT，遮蔽同名函数text参数。不得通过扩枚举、削弱守卫或修改155迁就；原S从正式48d独占修未发布156参数消歧，并同步严格156字节pin及直接测试，157保持正式218b原字节。尚无修复候选或真实迁移PASS。

sanitized attachment记录source157、checks=[]、enumStaging=[]、memoryFile未到达；仅empty owned schema创建，按已审ownership/跨schema/public摘要守卫清理1个，upgrade未创建，最终schemas仅public、无手工清理。三次helper public摘要相同；外围前后public155全量名称/checksum/finished/noRollback、137表4336行、结构/事实/原安全cohort及标准指纹均不变，标准锁已释放、端口空闲。正式执行实时owner PID40056/token aa06dc1e-17a7-4098-8bbc-aad02371d313及trace留存。public升级、Grant、16项UI和持久预览均未执行，这不是Prisma部署或完整旧Case/blob升级证据。

新证据在section-record-edit-frontend-integration/.local/ui003-evidence/migration-48d5bbe-reporter-fix-20261015/，主控逐项核39份hash/bytes匹配；manifest SHA256c552d5e37599c9a16deb657efa920bf45f43f8c799ba3abbb01d52e2830fd553，acceptance-summary SHA2568e081bcc6cbef86502e8feba9d2f7780132dda8910468e6da39a4dcd79c753fb。1197项tracked输入、737项原双构建产物和旧36份证据raw hash保持一致，完整verify为PASS_REUSED_NOT_RERUN，仅在相同48d输入限定复用94/2207/1850。原独立Reviewer本轮迁移Spec/Quality REJECTED、C0/I1/M0；loader问题已关闭，SQL缺陷仍开放，必须修复复审后再给唯一runner固定候选重验。

## 48d完整verify通过、迁移发现未通过（2026-10-15）

固定clean48d5bbe2cc3c6db39161a8a32e1ff88ba2882af0/treea3ff7341f7e2ee4824e4c53cc9f0d366f2177b2b，18:14:11至18:18:12 UTC仅一次正常pnpm verify，exit0：工具11套94项、前端124文件2207项、后端120套1850项全部通过；strict context、Spec、架构、类型、全Lint/格式、当前源Prisma生成和双构建均通过。NT006在全量后端实际执行，资源锁PID12220/token c65d2a2a-ae37-4127-8e03-e56e9cb69546于18:17:47 UTC被观察，结束已释放；本树source/build manifest留存，没有借其他tree dist。旧ebba单次失败与红绿修复证据保留，未改写为通过。

随后准确protected单迁移spec --list于18:18:14至18:18:16 exit1：Node36504无法以当前加载模式导入scripts/test-environment.mjs，SyntaxError Cannot use import statement outside a module，support case-section-record-migration.mjs:6经spec:2触发，0文件0测试。正式SQL重放未运行，无owned schema/trace；实际reporter onBegin已读取并校验短命discovery活锁PID6184，tests=[]，原summary称未捕获的表述已在上节按sealed回执更正。R2前置、verify后、最终public155完整ledger、137表4336行、public结构/数据与安全cohort摘要相同，标准指纹87ddb629496fbfadd83a201c2518d2ed3406badfff2fd3843d2804f93e18cd42保持，最终无锁且端口空闲；没有public deploy/Grant/新UI/预览或备份还原。

最终证据section-record-edit-frontend-integration/.local/ui003-evidence/migration-48d5bbe-20261015/含36项manifest、verify.log、退出码、发现错误、当前源构建manifest、NT006实际锁与三次capture。主控逐项hash/bytes匹配，manifest SHA256373f1514870c04169929a1d8c58190c530967eb45cc50b91f4428681db432a93；verify.log SHA25610643172082866a4ae48c273a5303c900302d60e15d25f6a3c14ed7b9bedd180。原S只离线诊断配置loader归属，正式源48d当前未改；该完整门禁可按精确不变输入限定复用，发现入口/相关受影响门禁和真实S专项仍待验证、独立审查与新精确指派。不得因单入口问题机械重跑已通过的全仓，也不得跳过模块错误执行未发现的测试。

## ebba正常完整门禁失败并安全停止（2026-10-15）

固定clean ebba08631e3065a214a9f16a4221525d51f2fc11/tree1e4060cb9558330dd18007fbf6ec64fcff0f51c2，于17:06:34至17:09:42 UTC只执行一次正常pnpm verify，exit1。工具11文件94/94通过；前端124文件123过1失败、2207项2206过1失败；唯一失败CaseClosureDetailIntegration.spec.ts:469，uses exact closure material versions, real zero and internal complete correction anchor，点击closure-info分栏编辑后取不到旧closure-amount。该测试继续期望旧correctCaseClosure/Case.version推进契约，原UI需诊断准确既有workflow入口与新record编辑语义，尚未判定为纯断言或产品缺陷，禁止通过删除零金额/双锚/附件/历史断言掩盖。

Prisma当前源生成、两端与根类型、全Lint/格式通过；后端随递归测试失败终止，无完成计数，NT006虽在120文件库存中但没有实际owner锁观察，不能称运行通过；双构建未到达。按准入阶段2 --list/单项owned-schema均未运行、无trace、无owned schema创建，未升级public或写Grant。前后R2实际身份、155完整ledger、137表4336行及结构/安全摘要/指纹87ddb629496fbfadd83a201c2518d2ed3406badfff2fd3843d2804f93e18cd42相同，schema均仅public，锁不存在且3101/5174空闲。证据section-record-edit-frontend-integration/.local/ui003-evidence/migration-ebba-20261015/含实际退出码、before/after、suite/source inventory、verify.log和28份最终manifest；主控逐项核hash/bytes一致。verify.log SHA25688188c9e58921c5fdf6aea410dcd46cf4df88c805bbb9accfc621cb76fb5fbab。修复必须回原UI、固定新输入并补审后再给runner新准入；此FAIL不改写155已交付候选的历史PASS，也不允许跳过失败门禁继续S。

## R2只读备份与迁移专项源准备（2026-10-15）

唯一runner在clean c4c06820355b6ff7b2bbde34e8c6a6e3912814fd上完成R2 public155只读备份：pg_dump custom exit0，归档1652292字节、SHA256 0734daa1a325990b238baa5d0ac2b644890e1de184b30ab16557d1eecb7cd270；pg_restore --list exit0、1792项。前后137表4336行、结构/序列、155完整迁移和baseline安全摘要一致，标准锁释放。主控逐一核原manifest20项哈希/字节数，独立Reviewer限定证据C/I/M0。备份及TOC随后用原生文件操作移至工作区外用户Temp的本批独占目录，主控核两文件大小/hash不变且旧源不存在；未改ACL/服务配置、未重dump、未输出私密内容。证据在hearing-correction-chain/.local/ui003-evidence/r2-155-backup-20261015/及r2-155-backup-relocation-20261015/。原manifest作为历史保留，当前位置以relocation-pointer.json/relocation-receipt.json为准。TOC可读不证明成功还原；归档不含库外blob，不作为完整文件存储恢复证明。

S新增迁移风险四文件固定e9ccaddd615d948ef508967ff2772d37627bc30f，接入后续组合841956f97c6cb081b1b6a36229897f10d2b9bc9f/tree3f8b0e86a2bb7bb6aec9b76cd239ff77041c1ef6。原18/18纯测试、根类型、四文件Lint/格式及语法通过；原Sol与主控独立窄复审C/I/M0，I-S-MIG01关闭：原S的157 CRLF hash05fdbc与正式LF hash218b230不同，运行现严格钉正式raw字节，旧CRLF和篡改LF负例均拒，不normalize/双hash，旧SQL不改。主控在实际组合只读sectionMigrationPlan返回157及精确156/157 hash，未capture/DB。owned-schema空链/升级/故障重试、三次public摘要与跨schema依赖保护仍待真实运行；其夹具仅ACL、DRAFT客户、metadata与内存bytes，不证明旧Case/blob迁移保持，也不等同正式Prisma部署。完整verify和156/157/六栏浏览器尚未执行，155原已通过证据不重复。

新UI专项当前仅五类编辑及五类上传准备；HEARING与旧外部CORRECT的单一新合成角色权限申请被自动审批拒绝，待用户确认且未写Grant，旧受理/联系方式兼容缺口仍开放。不得通过另建actor/helper补权或把缺少的覆盖计作通过。

## 155开庭严格冲突恢复专项通过（2026-10-15）

独立clean候选c4c06820355b6ff7b2bbde34e8c6a6e3912814fd/treea0850faff5a568988f53884eb584a601720965ce，在16:20:51.006至16:21:19.949 UTC正常本树Prisma generate/backend build:prepared exit0后，仅protected hearing-correction-chain.spec.ts及DB-only配置实际1/1 expected、unexpected/skipped/flaky/retry均0，pnpm exit0，未启后台scheduler。schedule-first走STRICT_SAFE_ABORT，实际完成的expect步骤绑定first取得锁→second尝试→first释放屏障→second拒绝；冻结helper精确验证唯一second P2010/40001/TransactionWriteConflict、初扫0 advanced/1 failed、新独立null重扫0/0及head/history不变。另advance-first、judgment-before-correction、correction-before-judgment三组均实际second取得锁，人工命令未放宽。

证据hearing-correction-chain/.local/ui003-evidence/hearing-c4c-155-r2-20261015/含acceptance-summary.json、Playwright JSON/log/trace、16断言步骤、source-assertion-context.json与构建manifest。spec没有输出完整return；summary如实区分“实际执行断言与冻结源码hash证明的值”和单独raw返回对象，不伪称后者已存。主控核37份manifest文件哈希/字节数，原Reviewer独立核证据Spec/Quality C/I/M0。facts-before与after.oldFacts逐字段相同，旧8合成案保留，新9案追加（8→17）；R2精确身份、155完整名称/checksum/finished/no-rollback及指纹87ddb629496fbfadd83a201c2518d2ed3406badfff2fd3843d2804f93e18cd42前后相同，标准锁释放。回执.local/ui003-evidence/hearing-c4c-155-receipt.json。

原155实际运行阻塞在此限定专项关闭，不覆盖156/157、六栏浏览器或后续270完整门禁，也不表示c4产品已交付main。a539/d4b/9ba原失败及合成事实均保留。仅ignored汇总脚本曾误用不存在的旧runner导出，修正为读取本轮真实lockpath后汇总，post-processing-issue.json保留，没有重跑测试或放宽断言。后续source270阶段静态与156/157运行结果必须另记。

## 155交付及后续测试准入关闭（2026-10-15）

155正式候选19a及本节下述全门禁/9项证据经独立终核Spec/Quality C/I/M0；仅三份权威文档和标准snapshot收口为b39b90e89b3c1fd2cdc8258162e28553b613a07f/tree480840a0be82f6f3c5dd61ad9c9fa790245cdf53，已正常原子快进远端main和codex/ui003-quick-actions-integration，双ref与主仓main均只读核实同SHA。主仓.pnpm-store保留，预览未操作；交付回执主控.local/ui003-evidence/delivery-b39b90e.json。未声称b39重跑完整门禁，不扩六栏/156/157结论。

后续E69ac113四文件、Hf83fc13四文件接为1e84c60，原Reviewer受限核八文件差异Spec/Quality C/I/M0，关闭I-E-R2与I-H-R2测试准入问题。E纯40/H纯46、各根类型/Lint/格式为作者实际离线证据；完整R2绑定在capture/连接前拒错目标，正式capture/validator后逐项核本地156或兼容157全量迁移ledger和DB/public/user、finally仅断连。H仅创建本轮UUID合成actor/role/授权，原3用户/3角色/66 Grant及安全行全字段count/hash前后核对；不改旧baseline授权。真实156/157未运行，源码关闭不等于功能验收。

唯一runner在155诊断候选9ba66d376da11b6ed588af2ba7d25d23eb56439e/tree0298f3cfe2a539948b5f7c723da29e77274216ec正常生成/构建后，DB-only protected唯一spec仍exit1，expected0/unexpected1、无skip/flaky/retry。15:52:36.084 UTC开始，首schedule-first竞争直接捕获second的P2010、sqlState40001及TransactionWriteConflict，事件顺序first:attempt/acquired→second:attempt→first:barrier-released→second:rejected，原锁断言未放宽。此数值来自本次白名单nested metadata，不追认为旧d4b日志已含数字。155/指纹前后保持、标准锁释放，4新合成案保留。原证据hearing-correction-chain/.local/ui003-evidence/hearing-9ba-diagnostic-r2-20261015/的safe-query-rejections.json、acceptance-summary.json、原log/trace等32份哈希主控核对通过；这是诊断成功、业务测试失败，不是修复验收。

## 155三列表同树正式门禁与真实验收（2026-10-15）

固定clean候选19a0df2ba97d9acaa3b55b5d732570dc55351167/treef8d9d6b20437141c5ab9afe3a80421cb7abdb5f2，于15:41:03.721至15:48:04.669 UTC正常完整`pnpm verify`实际exit0：strict context、Spec、架构、Prisma、两端/根类型、全Lint/格式、工具11文件94项、前端123文件2006项、后端115套1532项及双构建全部通过。未过滤或跳过真实NT006迁移探针；nt006-inclusion-proof.json绑定源hash和全量Jest范围，标准资源锁PID40852在15:47:20实际观察并正常释放，无外层重入锁。

同一clean候选随后经正常protected入口发现3文件9项，15:48:12.503 UTC开始真实Chromium验收，duration139018.459ms，expected9、unexpected/skipped/flaky/retry均0、pnpm exit0。范围仅lead-list-workflow、case-list-workflow、notary-list-workflow三个新suite；正常Playwright服务3101/PID38916、5174/PID29384有实际监听证据，结束端口空闲，标准锁PID4436释放。前后R2完整CID45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236、项目dev-cor-ui003-r2/15438、155全量名称/checksum/finished/no-rollback及指纹87ddb629496fbfadd83a201c2518d2ed3406badfff2fd3843d2804f93e18cd42一致。原public合成事实保留，采样removedIds全空；没有重跑baseline/清理public或运行旧破坏性suite。NT006仅清除其自行创建的随机probe schema。

原始证据在ui003-list-module-baseline/.local/ui003-evidence/formal-155-19a-20261015/，含acceptance-summary.json、verify.log、playwright.json、9份trace、前后事实IDs、构建产物manifest及锁/端口证据；主控逐项核对hash-manifest.json的53份文件哈希/字节数，通过回执.local/ui003-evidence/formal-155-19a-receipt.json，未由主控重跑DB。累计限定三列表Spec/Quality源码审C/I/M0；本次收口只改三份权威文档及标准上下文快照，业务、测试、schema/迁移与运行输入保持19a，可限定复用本次结果，不另称文档收口tree实际重跑verify/9项。

该结论不覆盖随树C/e6详情编辑的独立浏览器验收（仍Pending），不允许运行其旧clear/reset/TRUNCATE/replica辅助fixture。六栏/精确上传独立组合6b6a1bb仅源码与分阶段证据，E R2准入修复69ac113的40项纯测试/类型静态及原Sol0不代表实库；H安全fixture修复、开庭9ba诊断及156/157迁移/上传/浏览器仍待验。持久预览81ebfed/150未操作；既有482f/b388分树结果和a539/d4b失败保留如下，不被本次列表通过覆盖。

## 155三列表独立真实验收与接续源码（2026-10-15）

R2 baseline在clean482f56e64f3525c56f936467d468a24d4e837475/treef8e6c803cc1dfde6d83d0bc61f2a0cdb31b2c58c于14:59:29.157至15:00:31.692 UTC实际PASS：本树正常context/Prisma生成/backend构建通过，追加批准102行（含固定66 Grant、2个批准合成credential行），checked全0，不生成环境密钥/DB密码，不改旧业务事实。prepare内部标准锁PID41876实际观察并释放，无外层重入。前后155全部名称/checksum/完成状态及指纹87ddb629496fbfadd83a201c2518d2ed3406badfff2fd3843d2804f93e18cd42保持。主控核25份证据哈希，回执.local/ui003-evidence/r2-baseline-482f-receipt.json；原证据ui003-list-module-baseline/.local/ui003-evidence/baseline-482f-r2-20261015/。

L+C2在同clean482f/treef8e6于15:05:21.625 UTC开始，两个新suite各3项，共6/6、exit0、unexpected/skipped/flaky/retry均0，正常3101/5174服务和标准锁PID40612退出。原本树696个dist逐文件再核相同后限定复用本树generate/build，没有借其它dist。前后155完整/指纹保持，事实只追加、removedIds全空，baseline未重跑、无旧清理。主控核40份证据哈希，含6份trace/facts前后，回执l-c2-482f-r2-receipt.json。FullConfig未暴露webServer，reporter空值不代表服务未启动，已用真实监听PID/退出端口核实。原证据ui003-list-module-baseline/.local/ui003-evidence/l-c2-482f-r2-20261015/。

N在clean b388be290b9690b22f95c379edda39d6521afc41/tree52f3a36a0dd541351c6610f863857cb29cbf92fd实际仅notary-list-workflow.spec.ts：正常安装/context/generate/本树构建通过，发现1文件3项；15:11:04.394 UTC开始ISSUE/NO_ISSUE/NO_INFRINGEMENT共3/3、exit0、unexpected/skipped/flaky/retry均0。前后155全名/checksum/完成状态与指纹保持，双服务退出、锁PID25316释放，无旧seed/disconnect/cleanup。初次只读采集器误假设复合键表有id而SQL42703，正式测试前停止，仅修ignored采集器后继续；初次日志保留，发现和正式E2E各只运行一次。主控核56份证据哈希，含3份trace/facts增量，回执notary-b388-r2-receipt.json；原证据ui003-notary-list-workflow/.local/ui003-evidence/notary-b388-r2-20261015/。

合计9项发生于两个明确候选，不称合并tree同次实跑。主控逐文件核两树backend/scripts/config/shared app/API一致，482f对已交付269c73c的backend零差异；接N绑定并合已交付main历史为独立155候选0de7b8f1865dcddb06ac64195f7cd27419b15526/treee3cb1f59c5178d6b9ff44ebe3afe9302a9a1f960。只本地主控快进，远端仍b318411；文档/快照及独立累计Review后集中执行完整verify和三suite组合验收，再交付，不升级预览。

新六栏/上传另固定4b81beb99d635ecf39dde4d8394dce70485203bc/treee0e518db11cc89043b7660db4756c9853e9fbbb7，S17文件9352e5f、C2上传宿主416d622等累计产品静态Spec/Quality C/I/M0。S357直接例及静态、C2增量48组件及两类型/静态为作者同输入证据；root9b正常generate及两端/根类型exit0。157原始SHA05fdbc...7392提交规范LF后为218b2309215b418c0e6ec3a5c072cb3f16034946002dbf69a6dad07f11f02296，已核仅CRLF→LF，另16文件一致，旧156仍87e2...001b。E hard15437、H generic准入并向baseline roleA补15 Grant为两项测试Important，待原Owner改R2/仅新合成actor后才可运行；不是产品源权限缺陷，不能被产品源0finding隐藏。156/157未执行。

独立开庭d4b于15:01:39.028 UTC重验exit1，expected0/unexpected1、无skip/flaky/retry。联系人通过后orderedRace第256行缺second:acquired（verify第622行），服务同轮P2010，SQLSTATE未暴露，不能断言40001。合成案0→4保留，155/指纹及锁释放保持；不计入列表9项。证据hearing-correction-chain/.local/ui003-evidence/hearing-d4b-r2-20261015/。原Owner只读诊断，先复用PG stderr，未改原竞争断言/隔离/生产即时重试；原a539失败独立保留。

随后唯一runner只读提取同轮原PG stderr，无新DB连接/写入/重跑：15:02:04.078 UTC PID13236唯一ERROR为`could not serialize access due to concurrent update`，SQL模板与advanceDue案锁一致；原stderr295字节SHA256155603167ef506b4fb743b2ebfce3127bede7e155abb838ba70080311f377123。数字SQLSTATE没有出现在日志/trace，不能标已验证40001；case归属为同秒/唯一错误/模板/源码关联，服务端未记录UUID参数。主控核10份诊断证据哈希，路径原d4b证据/read-only-diagnosis-20261015/。原Owner暂缓新诊断源码，待基于既有持续可重入扫描合同提出最小方案，不为测试新增生产即时重试。

独立155候选0de的限定三列表累计Spec/Quality源码及三文档审C/I/M0，可以进入正式门禁。随树C/e6详情编辑代码虽有聚焦证据，但独立case-action-entry、record-edit、closure、archive辅助E2E仍会调用旧clear/reset/TRUNCATE/replica夹具，继续禁止在保留R2执行、保持独立浏览器验收Pending；三列表正式范围只用已安全重绑的新三个suite，不能据9项宣称整个tree的C/e6/六栏验收完成。

## R2首次155开庭失败与列表源码收口（2026-10-15）

14:38:23.873至14:41:02.614 UTC，原唯一runner在clean a539ae4fbce4c7a25c53af29e35a40795a21f0ae/tree48eae4221fc278239784e3ae7eac19010f5168b3完成正常Prisma生成、本树backend build:prepared（均exit0），再用protected test:e2e及DB-only webServer空配置运行唯一hearing-correction-chain.spec.ts。结果expected0/unexpected1/skipped0/flaky0/retries0、pnpm exit1。seedOwner事务提交触发23514 customer contact projection mismatch：新客户的admissionContactName/Phone缺少customerContact/compatibilityContactId关联，违反既有20261009040000_customer_contacts延迟守卫。合成开庭案件前后0/0、addedCaseIds为空，开庭及锁竞争事件未到达；这是夹具失败，不能报告业务已通过或业务回归失败。

标准capture前后指纹87ddb629496fbfadd83a201c2518d2ed3406badfff2fd3843d2804f93e18cd42、155全部名称/checksum/finished/no-rollback及clean HEAD/tree保持，R2 healthy；实际标准锁owner PID25868有proof且结束释放。证据在hearing-correction-chain/.local/ui003-evidence/hearing-a539-r2-20261015/acceptance-summary.json与hash-manifest.json；hearing-e2e.log SHA25654c3b4530721442411d7a33c63ada1f819283f2af591920dcdd137c553f83c3f，trace.zip SHA25629fe8a81685bfe4032a7e7db2056d84860f8f8984a0ad96515116c7a4874454f。原Owner修fixture后需固定新候选再重验；未执行baseline prepare或156/157。

原Owner已分别修155/156同源seedOwner：原事务内创建同客户/部门的ADMISSION_FREEFORM联系人并设置compatibilityContactId，原admission快照/阶段/生产守卫不改。四文件精确哈希经原Sol受限补审C/I/M0，各10/10纯fixture测试及静态通过；主控代提交155 d4b573726fa69b291d1c0b00d365c08446e79030/tree5f221dd5215bcee6b0bed5b18e074e35133416ae、156 5b6b18f8dd0afb3cd48751a15c55f44e5dddb470/tree44d7857444e3eff79c96a26bbf577df69d871393，两树clean。纯测试从真实seedOwner抽取执行但没有PG，不替代a539原失败路径的实库复验；续办消息接口拒绝启动，固定新候选待父级恢复原runner串行执行。

C2六栏列表五文件冻结候选35055d37c11cd49586a567f10521432e3266e146/tree274bb276a406cd8ba3de6c902a466d0d9bbbb245与原作者五SHA逐项相同、代提交后clean。作者5spec128/128（含12真实Panel组件联调）、frontend/root类型、定向Lint/格式/架构/diff通过，原独立Reviewer源码终核C/I/M0。两项registered record E2E只编写、适用156，尚未运行。已审hook d584+740、材料API3db及C2接源码组合85c395eec5aec30291887e2d166241f645503bb2/treeb6803ca712a64ae54f0fefc2ad6ec3622635bf08，尚无该组合最终门禁。

前一组合6b73451的实际阶段集成仅三个前端spec309/309及前端类型exit0。首次普通测试因临时目录EPERM为0tests，正式审批相同检查重试后成功；原失败保留于该组合.local/ui003-evidence/phase-frontend-tests.log，成功为phase-frontend-tests-formal.log、phase-frontend-typecheck.log及phase-frontend-result.json。不得把这些结果称为85c395e或最终完整verify。

随后在clean afb0f4b2865f5b78f380ab7352ceb153bb3835c7/treee697bcbda763fe306aa3fbbf4af9ae09195fa7b1实际执行8个相关前端spec478/478及vue-tsc，均exit0；覆盖cases/materials API、列表Workflow/Display、六栏Panel、详情集成与W Drawer/context。已包含上传UI c253与C2原文件宿主350，尚无C2上传prep接线或S157。证据是该组合.local/ui003-evidence/phase-upload-tests.log和phase-upload-typecheck.log；这不是完整verify、PG或浏览器验收。

材料API3dbd172仅materials.ts/spec，57/57、两类型及静态通过、原SolC/I/M0；上传UI c2535d65fbf6bec29344d0dc2a815ac713da028b仅Panel/spec增量，作者213/213（含API57）、类型/静态/bundle通过，原累计Sol源码审C/I/M0。独立beforeUpload/prep事件与业务保存分离；C2宿主prep与真实157/上传字节/浏览器仍待验证。S上传读取旁路37项直接测试通过、主服务五suite320项作者通过，源仍WIP，不当作最终组合或PG结果。

R2 baseline6825d526c060811712661575c30f896a3e4b5fd3只新增三helper/类型/纯测试，7/7及静态通过、原SolC/I/M0；主控核三哈希后接155列表树482f56e64f3525c56f936467d468a24d4e837475/treef8e6c803cc1dfde6d83d0bc61f2a0cdb31b2c58c。仅批准固定155合成102行追加或逐字段核对、不恢复撤权、不触业务阶段、disconnect只关自身连接；实际写入仍未发生。原实现树依赖junction的安装状态不兼容未被绕过，执行树另正常安装自己的依赖；N R2重绑待回执。普通上传PUT200勘误、专用quota及外部证明前隐藏只见正式上传合同，157尚未执行。

## R2实际155与上传设计审关闭（2026-10-15）

runner在13:38:34至13:39:39 UTC实际建立新项目dev-cor-ui003-r2，完整CID45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236，唯一127.0.0.1:15438，持久卷dev-cor-ui003-r2-pgdata挂PGDATA，无tmpfs，healthy。新空库正常deploy155/155 exit0，逐名称/checksum/完成状态匹配；正式capture指纹87ddb629496fbfadd83a201c2518d2ed3406badfff2fd3843d2804f93e18cd42前后一致。主控已对准备summary和六份日志哈希逐项核对，未重新执行DB。源准备报告在hearing-correction-chain/.local/ui003-evidence/r2-environment-20261015/preparation-summary.json，主控核验回执在.local/ui003-evidence/r2-preparation-receipt.json。未生成新凭据、未seed或跑suite、未升级156/157；旧容器和预览未操作。

L/C2精确R2三常量小修分别代提交562e4c5430a3e2b386d077e1892767de3a8edf38/d5835ef0a1f5f5d9af6a1c397533698b0cba6c16，原静态/纯反例和原Sol无新增finding；接三列表652aaee8e56882499a06feae70fadd62de6a541d/tree4917a97dcf7e01125aa5c1cde9d0cbeb5f030f68。C2 support自身不查迁移表，155完整性由runner准入负责，不能把formal capture或本次纯probe说成helper实查155。N重绑待回执，未运行三列表。

开庭155/156各新增持久纯准入/迁移反例，各34/34、共68；六文件哈希与handoff相同，原累计Sol源码审C0/I0/M0。分别提交a539ae4fbce4c7a25c53af29e35a40795a21f0ae/tree48eae4221fc278239784e3ae7eac19010f5168b3和6a7ca02779d2f8db34a59ce2eefecc0b8a1f1ed2/tree2da9e7908071fe40a7913e086aef89435a9c5acb。除capture/纯guard外的既有函数、产品及E2E未改；原58未重复。作者语法/根类型/Lint/格式通过，纯测试拒绝分支的真实capture/PG调用0。155专项自建随机owner且finally只关闭本连接，可与通用baseline准备解耦；当前仍待本树实际生成/构建/PG运行。

UI a46f593b62ab89d01f2dee0ddb75e18b7a8b5ccc/tree5d3b30d142e4ca51f38bd9aed4583b7c5ef173d3九白名单文件已原累计Sol源码审ACCEPTED C0/I0/M0；作者350/350、前端/根类型、定向Lint/格式/bundle通过，check:fast因Prisma缓存EPERM未全过。API最终143f7443352ad1ede528bc40fa31ec94255fb5be为217项及原Sol0，POST abort不等于未提交。UI/API及两套开庭/L/C2绑定接源码组合6b73451b7ff05e638af4af72b7081cc394207d4a/treec61c20a177861e89c2ccb533abe59135952853d1，干净但尚未运行组合门禁。列表宿主新增精确恢复hint/同步准入接口交原UI与C2，不在此冒称接好。

材料微合同固定SHA256 C4647435DE6D00F5295F3FDF1025D41F0956B867CD7486AA76FD34DDA75EF79A，原Sol设计补审关闭I-UMAT01/02，C0/I0/M0，已同步[正式上传合同](../../superpowers/specs/2026-10-15-case-section-record-upload-contract.md)。它批准结构化target/revision/closure锚、三阶段短case锁及20消费表首次冻结守卫的实施，尚无157 SQL/服务/真实上传证据。I-SECTION-MAT-01功能缺口待实现验收；不能把设计finding关闭等同于功能关闭。

## R2前的恢复核验与源码边界（2026-10-15）

- 三列表b1f0125cb529952b3b7b33f0fa376ddae79cbc80/tree c49a2e7f33a2cc1d15399799d21b77e63351347f：原累计Reviewer关闭I-LNC-01，Spec/Quality ACCEPTED C/I/M0。L清理链删除和C2写入前/afterAll精确绑定均已接入。这里是源码与离线反例结论，没有DB/浏览器结果；旧C-UXQ-C02/C-SECTION-E2E01破坏式fixture仍禁止运行。
- 旧完整容器dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695已于11:54:05 UTC停止。runner和主控正式只读inspect均见tmpfs PGDATA、Mounts为空、无有效端口；未start/up/rebuild/delete/DB连接。原155与合成事实不能声明保留。ignored证据为`.local/ui003-evidence/retained-instance-state-20261015.json`及`hearing-7cbdec26-preflight-20261015/container-read.json`。
- 父级批准R2项目dev-cor-ui003-r2、loopback15438、独立持久卷dev-cor-ui003-r2-pgdata，固定镜像沿原digest。只读预检新资源未存在/端口未占，不等于实例建立；主控app恢复消息被AbsolutePathBuf拒绝，随后父级已通过原有效通道再次started；尚无环境实际创建回执。新完整身份、155新基线、原suite精确重绑及实际运行均待完成，旧证据只保留历史范围。
- 开庭bridge候选2db96c7471201d11997a2225f86f5ee57a8b9040/tree af910836360cfbd49aed8a32e8a3c57acdc29ed9，主控受限独立源码审Spec/Quality ACCEPTED C0/I0/M1，Minor为旧候选单测未单独隔离ID不匹配。作者RED8失败/48通过至GREEN58/58、完整fast prepared和源码构建为同输入证据；新增6日期路径/4锁竞态未PG。Serializable edit-first风险留真实PG判定，不改隔离或预先放宽断言。已接组合0d44b523f66b3ecf66fd96c7d41b9e16df3ede36/tree7b487a17503d82070573790ab29628f41df8ea71，不能称新组合实跑上述检查。
- API候选a8bf1550f431d966c8097ad5da49101f835a38b4/tree0105de098aa3875e0a242aa5150764285d9cdbae，仅cases.ts/.spec.ts；作者API211/211、前端/根类型、ESLint/Prettier/diff均0，原Sol最终补审C/I/M0。六栏严格解码/原body-key/closure双锚、律师专用有效业务字段兼容边界已核。律师无更正标记，不能仅凭同形合法字段识别业务值篡改，不虚构保证。证据在API Owner目录`.local/ui003-evidence/api-delivery.json`及`api-review.txt`。未DB/浏览器。
- I-SECTION-MAT-01仍开放：旧通用上传阶段阻止后续阶段更正时新增附件；S独占新树0d44b52设计精确上传闭环，157尚未实现/迁移。专用版本首次消费须匹配target/revision/closure锚并同事务冻结后才可沿旧同类冻结复用。新UI与材料合同仍WIP，无最终组合verify或真实上传证据。

持久预览5186/3206/15436未操作；本次未探测运行健康，不能用历史健康替代当前核验。

## 恢复收口的实际边界（2026-10-15）

纯文档0a6af4f于本轮正常原子快进远端main及任务分支，双ref和本地主main已核一致，12文件全在docs，不变产品／DB／预览。证据.local/ui003-evidence/docs-delivery-0a6af4f.json及.log。文档源审I-DOC01／M-DOC02均关闭，Spec／Quality C/I/M0；格式、Spec57REQ／67AC／11BQ／59SD、经核对快照及strict context实际通过。

三列表55cd453产品源码审查接受C/I/M0，I-UXQ-C01／I-UXQ-D01关闭；整体Quality C0/I1/M0，I-LNC-01要求L去旧全局cleanup并补managed精确准入、C2钉本批project／15437目标，原Owner修复发送失败待父级转达。浏览器／DB零执行，旧case-action-entry及分栏五专项的clear/reset/Grant/cleanup阻塞保留，不安排在保留实例运行。

S最终新路由／迁移五文件原hash精确暂存后，cached diff发现九空行尾空格，首次提交停止；S仅修九处空白，新migration SHA25687e2a8ee00ac8341419a07192a43227101fc60d182bd5f1006acc1cfe315001b，重新精确暂存提交d0ff2d6967d60654a94ff83563da57d33abbabb5／treedb4be313f6843495443a1492091a93bf4a136ec1。123HTTP/OpenAPI、类型／build及独立源审为作者证据，同语义空白未重跑；迁移未执行。H专属三文件405c84989d26e6ad1198d97a88bf8f923326abc4已静态及独立补审通过，含正常API真实REMAND来源用例，只有源码未实跑。接入S为f5e5bfac93bc01994077324b5210a32cd2733785。

S终审确认scheduler原hearingAt与新effective SQL不一致，六栏最终验收阻断。新独占bridge a99c93b8e87d1ce5ffd2ccca277b061a3b6f645b／tree80ccaa66a27048208fd2be47b450061bc4dfdcf2仅组合S f5e5bfa与d11／7cb已审原连续纠错，未编译／未验收；原hearing-correction-chain 7cb的155候选和目录未改。Owner消息工具失败，待父级恢复精确修复，前端新decoder及六栏编辑接线也未完成；不将这些候选或离线证据算PG／浏览器通过。

## 原子交付回执与恢复现场（2026-10-15）

恢复后候选留痕：L源7b5d230389ff8b861c421d1a1f00fd7a33ae0a19（9文件，88限定复用聚焦）、N源2cf6c5c9df8da045918bc9b3439f200629b677c9（14文件，117直接测试）、C2源063603b730ea1d2d08dd5c89bfabdb7fcf0d3e0a（21文件，核交接逐文件SHA256，418直接测试）均经各原独立Reviewer关闭finding后由I正式代提交；普通index.lock拒绝未绕过，原目录干净。类型／静态按作者最终报告通过，不冒称完整verify／DB。三者顺序接入开发目录ui003-list-module-baseline为55cd45357c54ed0bccb6977e232d6eb13a718524，最终组合审查／门禁和真实浏览器待执行，未推送／预览升级。

S开发组合：有效读取cbc2a2e精确10文件已单独提交；E原ffca652必须连同4612d738最小日期修正使用，不能单独最终集成。H原1c2bd081精确6文件已代提交，archive零差异排除。两域已正式接入S当前fa55f9d，路由4文件及迁移仍WIP；作者E最终69／H最新57聚焦及各独立补审只作为源码证据。执行、结案与归档互比及终端日期反向限制审理的无正式依据新门槛已裁定撤回，不改旧155或原动作规则；六栏正式工程合同详列精确锚、原键和E新增／H复用Action边界。

先前“待原子交付”已完成：09:58:44.7531416～09:58:53.1979475 UTC正常原子推送exit0，远端main及codex/ui003-quick-actions-integration均为269c73c008fff829af05d16d6e6027181e05b724。11:57 UTC用户恢复后只读再次核实两ref相同，本地主main从1f375ea仅快进至269c73c，未跟踪.pnpm-store保留。证据为I的.local/ui003-evidence/atomic-delivery-first.json及.log；没有重跑A/B、再次推送或更新预览，原验收的范围和旧失败记录保持。

恢复后只提交S材料两文件为9a78e557d73f885f0cbe8ae2645bb17bcec9ff8e，tree8ba5439e7b64c4e7cd91dd9e39f59d4805ea6368。精确哈希a890d3ac4621ad3a920f8547e432ce087072ea88aa362a27830cde94d805e912／ad839e24b67f2a97b472d273a0e0a4dbbd2ade26028172ccc710e082ae722612与作者134/134直接Jest、类型／Lint证据输入相同；I受限独立源审Spec／Quality ACCEPTED C0/I0/M0，S自身独立审查亦无阻断，均未运行DB。仅两材料文件分别接入E的c7393a6d689f13d9b7ce9b645fcab03c9ec77226、H的1d61e36c872842f0039f36a8f910de9602abf7dd，两个域WIP保留。证据.local/ui003-evidence/material-baseline-eh-integration.json，不称域服务或S整体编译／迁移验收通过。

开庭增量7cbdec26dbad4aa725208125335dfb6f69949f3b／tree09100d08b9522830c6c9febb9601d78bf3e202f9仅改三测试文件，产品service/spec不变。原Reviewer确认两无候选scan降为顺序状态检查，四真实竞争强制锁事件顺序且无锁settle拒绝、失败drain；I-HCHAIN01源码层关闭，Spec／Quality ACCEPTED C0/I0/M0。作者49/49及静态不代替尚未执行的155隔离DB专项。

L/N/C2/S/开庭以及E/H均已由原Task实际回执恢复，开发结果仍逐候选报告。SD-59仅新增最小规格和排队，经独立只读审查未见越权业务规则，不产生产品验证结果。持久预览81ebfed／150、原数据和账号冻结；15437隔离155实例保留，未执行迁移／清理／重置。

## UI003 A/B本批验收完成（2026-10-15，待原子交付回执）

稳定运行候选20877386352f700652f08b505ec8d18e432bd2f8／tree004c8acba7c40264979d01bf33c04e901b9a863a于09:46:02.0089424～09:46:51.6839210 UTC B-only正常Playwright1/1 exit0，retry0／skipped0／flaky0；真实编辑取消和保存均回page2/status筛选，API核字段及版本。首推送真实201后模拟丢响应，sessionStorage保存精确leadId/body/expectedVersion/key，刷新后同原请求恢复，阶段仅推进一次，真实审计/回执各1。B trace SHA29b10b199fbb32ff5cda4e74bb95f33b557d1045dd81c6636dbafae9e5a20319，I核4日志/1trace均匹配。容器dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695、155历史及前后HMAC919d10f4338f5f723f68cf337f91934034b22c56050e9d0ab1629ff65a2312d1保持；无reset/迁移重部署/旧15433/预览写入。证据.local/ui003-evidence/acceptance-2087738-b-only-20261015/acceptance-summary.json和integration-readback.json。

独立累计Spec/Quality ACCEPTED，新增C/I/M0。A正文/公共夹具和运行输入未变，限定复用da37实际A通过、工具94及NT0062；I逐Git对象核frontend/backend/包依赖/TS/Lint/runtime等11组输入与eb367相同，限定复用其前端1887/后端1532/双构建。da37→208工具源/配置相同。不是208同树完整verify，不是同次A+B双项浏览器，旧两次B失败和最早收集失败保留，不删除或拼成一次通过。208根TS/单文件Lint格式/严格context/Spec已过，最终收口仅文档；新三列表、C/D/e6/W/S及开庭实现不在本验收树。

推送前09:53:44 UTC远端main仍1f375ea，任务远端分支不存在；GitHub Actions workflows实查0、main protected=false，不能称远端CI通过。已获本批原子推送授权，执行后另填精确两ref SHA；此段不预称推送或部署成功。持久预览保持81ebfed／150和原数据，未升级。

## UI003 B第二次失败与等待修复／S首合同冻结（2026-10-15）

fa16b9d2aab2f4cb98bd86cf7506dd4143a9d758／tree a56a62978404d435e9edfe0605dbad47acf7f7a0于09:22:22.7405667～09:23:13.3149041 UTC正常B-only真实浏览器exit1，expected0／unexpected1／skipped0／flaky0。快捷编辑精确URL、取消/保存返回原page2/status筛选及真实API字段/version已过；第518行在retry控件可见但仍disabled时commands数组仍0，upstream随后HTTP201，响应丢失route故意abort为-1。刷新/原body版本key重放及最终单一事实审计回执均未验，不把部分通过写为整项通过。原容器/指纹保持，155历史逐项相同，不重部署/清库；四日志与trace SHA已由I全核匹配，trace5c2fc0f2607d679891e927cf9ecfbe88cf76acf104e7d0754fce17e395cd9ac4。证据.local/ui003-evidence/acceptance-fa16b9d-b-only-20261015及integration-readback.json。da37 A／94工具／NT0062项未重跑，既有证据保持。

原测试Owner依据同trace/timeline修复4207f44861408c48ed81603865808e5518f922bd，I接15c993a17f491210927730ee10405b77ae479e70；单文件只加四行toBeEnabled与有界commands.length poll，覆盖首发与重放，不加sleep、不删/改原body/key/最终事实断言，A/公共helper不改。作者根TS/该文件Lint/格式/diff通过，未DB/浏览器。I核精确增量后接SD-58纯文档0c202fa为7d18ecf；产品代码与工具/迁移/依赖不变，下一冻结仅重验B，不重复94/2/A/完整verify/双构建，最终SHA/tree见冻结回执。

S首合同正式代提交8b18c85e66cd6ba59d4e6f93de99dfc205ca07d4／tree3f1adbc0bb123a2db7dca138c97832dc6780a05f；精确10文件，提交前逐项SHA256等同作者handoff，schema+共享DTO/spec+六ACL+12模型owner登记。S新增expectedClosureVersionId必填UUID及32/32直接DTO正反例；独立Reviewer仅在DTO/合同源层关闭I-S01，锁内真实版本/CAS/指纹/旧回执条件已明确，H服务/DB尚未实现验收。六ACL源审C/I/M0，无默认真实Grant，模型登记无逻辑放宽。此前Prisma同schema validate/generate0直接复用。证据S目录.local/s1-baseline-coordination/result.json、i-s01-fix-evidence.json。读取/日历/摘要/新迁移WIP全部保留未入该提交，不接本次B树；可供父级独立派E/H，不称后台功能交付。共享列表W为01a13ee0-f72c-71a1-b033-bf5ca55d4012，四文件实现/类型自报进行中，未接本运行树。

## SD-58列表表单批准与S合同复验（2026-10-15，非产品验收）

用户已明确同意三模块列表原位真实表单、表单内选择合法分支、方向未定先保存已有资料及独立编辑不推进阶段。仅同步Decision／共享和模块Spec／拆分brief／状态路线图。B验收目录固定fa16b9d2aab2f4cb98bd86cf7506dd4143a9d758、tree a56a62978404d435e9edfe0605dbad47acf7f7a0，文档在独立ui003-list-workflow-docs目录；未新增实现或运行数据库／浏览器。新四Owner仍待父级创建，A已过/B待重验边界保持，不能写为新列表已交付。两张Library已prepare/read元数据但尚无实际可查看像素，不以caption/OCR称已看截图。

S独立合同修后正式require_escalated代跑Prisma validate和generate，09:05:30.3870482～09:05:35.5311037 UTC均exit0，Prisma7.10.0，未用数据库。三合同文件前后hash相同，schema为4d5ee06af8b6338504c0582422e36feb463b6d0214047fb287dee77387d08ffe；证据S目录.local/contract-prisma-coordination/attempt-2/result.json及两日志。六prior/next编译finding关闭；expectedClosureVersionId仍缺，I-S01未关闭，合同尚未提交供E/H。原Reviewer撤回hearingAt缺失校验错误结论；邮寄/申请旧服务已有严格date-only校验，新服务必须复用并补timestamp反例，不据此宣称新服务已通过。新迁移、guard、材料/读接线及业务运行均未验收。

## CA-015执行结束＋N1导航（2026-10-13，本地组合已验收）

实际集成：文档收口`66b85ce61a9b908957d18bee737b6ba8f0070bfd`／tree`662a13d55de206b4994fa8e3395d103575a1d4ee`相对已验8c2f45e仅project-status／feature-roadmap／cases Spec／VALIDATION及context五文件，文档格式、严格context、Spec、diff检查通过。用户已授权当前快进/推送，`git push --atomic origin HEAD:refs/heads/main HEAD:refs/heads/codex/ca015-execution-finish-integration`实际exit0，随后ls-remote两ref精确66b85ce；本地主main09:32:22 UTC从3f914ad ff至同SHA/tree，原stash b07482c2及.pnpm-store现场保留。最后实际记录提交仍只文档，不称其重跑产品门禁。没有PR/Release/生产部署，未查CI不写CI通过；人工预览之后按单独明确授权升级，实际结果见下段。

预览实际升级（独立于正式测试）：迁移前pg_dump custom备份994444字节，pg_restore --list校验可读，SHA256 808D6DB184D5073C221BD7952B215C0AA51B6DB73B6D3CE1E8E5CBE41649992D；原dist保留在runtime/ca015-backend-dist-before。旧预览切detached66b85ce，使用已验58fbd5d构建且产品字节与66b85ce相同；标准migrate deploy及start入口09:43:35.425～09:43:59.099 UTC exit0，140→142迁移，114张原业务表计数与内容哈希完全一致，原两案、账号、密码和私密配置未重建。09:45:06.956 UTC 5186/login与3206/api/v1/health均200。可见Edge已有正常认证会话重新加载后仍能读取CA-20261013-0001／0002，两文书组与流程顺序正确，全部2、执行文书组1、待申请执行1；仅导航／展开／只读浏览，无业务提交。证据旧preview ignored runtime/ca015-{backup-result,upgrade-result,health-result,browser-readonly-result}.json及迁移日志，恢复.local/ca013-preview/README.md。未执行prepare／initialize／bootstrap／reset／seed，未动Demo8123、共享15433或生产。备份可读校验不是恢复演练。

稳定代码／测试提交`8c2f45efd0491d4d4edfc2dab4a83cbe3c423c9c`／tree`537ffac310d70ccb922ab3a80a36edcd7d7b579c`，独立Sol最终组合Review两轴ACCEPTED、未关闭C/I/M=0/0/0。最后五项不是散装拼接：同一正常`pnpm test:e2e`运行`case-execution-finish-database.spec.ts`、`case-execution-finish.spec.ts`、`case-complaint-confirmation.spec.ts`，09:19:24.748～09:21:17.964 UTC，5/5 exit0；覆盖普通来源两身份、客户最小投影、说明-only/附件-only、刷新/重登/下载真实字节、两组与两个授权范围的列表/总数/badge/详情返回/原子书签、21条内部/客户分页、同部门只读与精确诉状下载，以及合成PG事务/重放/不可变守卫。迁移从普通API完成EXECUTING的旧来源复制到受控随机schema，空库全链、140份上一支持schema→142、第二段注入失败留下enum但DDL全回滚、向前恢复、直接stage-only拒绝、旧facts/回执/精确元数据及实际blob字节相同；不是仅检查SQL源码。

完整`pnpm verify`实际在`58fbd5d868b88f1355ac9be0c8691ca09bf646d6`／tree`5745eb34821c0cbea1e60884bc3a5ae67852ba5e`于09:05:23.198～09:09:36.800 UTC exit0：工具80/80、前端99文件1337/1337、后端106文件1345/1345，全部静态与两端构建通过。普通Vite >500kB chunk warning保留。随后该树5项首次4/5，旧诉状E2E仍定位原子菜单“诉状待盖章”而非获批文书组；失败在导航断言，不掩去。8c2f45e仅改该E2E定位、补组URL与精确原子书签和context snapshot，产品、依赖、单元及构建输入全部相同，独立Reviewer明确接受限定复用这些结果，不称完整verify在8c2f45e实跑。8c2f45e实际正常`check:fast:prepared`＋全`format:check`＋严格context＋Spec于09:19:18.455～09:20:40.348 UTC exit0，然后上述同5项全部通过。

新I ignored证据入口`.local/calendar-funds-evidence/ca015-formal-{verify,static,e2e-final}-{before,after,result}.json`及各`.log`；前后fingerprint均`343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`且Git干净。`ca015-formal-e2e-*`首次4/5、开发失败、源提交/作者限制都保留于下文。最终仅文档收口时核非执行diff及文档专项；远端/main/预览升级只按后续实际结果补记，不提前称成功。升级前09:23:23预览只读HTTP200、仍3f914ad；之后15436升级已完成，见本节实证，无生产迁移或部署。

合同ada34c6／tree148b006的独立技术Review两轴ACCEPTED、C/I/M=0，仅批准实现。E1源d2a769c／tree166cf1c独立Sol静态Review两轴ACCEPTED、C/I/M=0；作者339/339及类型/build/Lint/格式通过，I接纳为4b753de。E3自身73986ac＋7457885接纳为7e18a50＋d9932d7，真实E2/E3组合417/417及类型/Lint/格式/Spec/Vite是作者证据；375/375缺模块类型失败及装配/日期fixture失败保留。N1源a9083b2／tree9190618已接纳为8079b80（精确12文件，源dd8d897为中间候选不接纳），作者216/216及34/34、格式修正后的控制器14/14只作为作者证据。

I现用独占`.local/worktrees/ca015-integration`，原ca013-014-integration开工时固定detached main3f914ad服务5186，验收后按授权升级至66b85ce。中央正常pnpm离线冻结安装exit0，自身store来自只读复制缓存，无策略关闭；Node24.21.0／pnpm11.27.0。Prisma生成首次sandbox utime EPERM，正常提权重试08:12:38～08:13:04生成及后端构建exit0。I维护三模型归属，architecture检查122模型、Spec54SD通过；未新增另一套验证账本。

| 实际检查                | 候选与范围                                  | 真实结果与证据（新I ignored .local/calendar-funds-evidence）                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正常pnpm前端聚焦        | 891fbea／tree2d2bb5e，7文件                 | 首次Temp mkdir EPERM，零测试执行；正常提权同入口重试08:28:43～49 UTC，286/286 exit0，ca015-front-development-retry-result.json及.log。                                                                                                                |
| 独立测试库前向迁移      | E1两新迁移，15433/dev_cor_test              | 08:31:40～44 UTC db:test:migrate:deploy exit0；142份文件，两新增实际应用。ca015-test-migrate-result.json/.log；不是空库/升级专项通过。                                                                                                                |
| 聚焦PG开发检查          | 4c0e6a9／treeca7b4f6，Finish守卫合成fixture | 08:34:51～08:35:05 UTC正常test:e2e，1/1 exit0，测试本体3.3s。六处写入失败回滚、竞争单胜、原键重放/异参、停用及撤权、七处不可变SQL拒绝、旧执行facts/版本哈希与存储键保留。ca015-pg-source-{before,after,result}.json及.log；不称普通来源业务全链通过。 |
| 组合Review后URL修正聚焦 | 8079b80后的I四文件修正                      | 正常前端入口2文件103/103 exit0，ca015-url-recovery-result.json/.log；当前实际输入在固定后由最终门禁覆盖，不称旧8079b80原提交实跑此修正。                                                                                                              |

保留开发期阻断/失败：首次PG环境捕获在数据库操作前因复制的旧private-file root拒绝；只对齐新I自己的测试root，数据库目标/凭据不变。891fbea首次标准PG运行1failed，旧helper的lazy import在Playwright加载阶段报named export missing；修为既有static import后8dda2f5固定，4c0e6a9再加精确Finish成功审计fixture清理，后续1/1通过。pnpm exec短工具名首次未解析，后续正常pnpm exec node调用同一安装CLI进行静态检查，未关闭预检。所有原日志保留。

独立最终组合Review：75ea569／tree34955ab两轴ACCEPTED，未关闭0/0/0；原两URL Important已通过列表修正和103项直接测试关闭，N1 idle/completed后由I接管四文件，无并写。4b66f54／treed53e69fb相对75ea只改测试来源身份及下一批排队文档，Reviewer再次两轴ACCEPTED、0/0/0。审查不替代正式门禁。

普通来源开发验收失败与修正：75ea两项08:50:33～08:51:00均在来源准备被403拒绝、未提交Finish；测试曾在角色编辑后沿用旧fixture bearer及律师登录后继续运营材料路径。4b66测试改为先建诉状来源再正常UI改角色、当前运营重新登录/CSRF，律师开庭后重新回运营；产品权限守卫不变。4b66标准2项08:59:51～09:01:00结果1过1失败：律师附件-only及刷新重登/原字节下载通过，运营Finish/两组两范围/计数/详情返回/旧原子URL及普通API来源迁移探针已执行，但客户登录helper错误地用带query的path比较pathname，停止在客户投影断言前。修正为pathname及所需query逐项核验，保留ca015-browser-{development,source-retry}-{before,after,result}.json与.log，不将部分成功拼称组合通过。

迁移测试核普通API创建的EXECUTING来源，空库/上一支持schema升级/enum提交与第二段故障回滚/向前恢复、旧facts及精确blob实际字节；这些已在顶部稳定同5项组合通过。新增Demo字段展示对齐仅在既有路线图下一批排队，明确不成为当前验收或推送前置。

E2源b2d4ddd38b28515d8f4bf4dc6baee4e788244b87／treec21f6233af40afd40b78c111b12bc973194fc84f，仅两份新面板/vue及spec，40/40、类型、双文件Lint/格式均exit0，原件在其ignored .local/ca015-e2-evidence/report.json，UTC07:17:53～07:18:42。保留pnpm元数据失败、早期33/35及Lint失败后修正；未改策略，用已锁Node原CLI和隔离cache，不能称正常pnpm正式门禁。I核7项manifest/lock/policy/patch指纹匹配后于UTC07:25:31.049～07:25:31.387接纳为0935ef357fb4e493492f5a736528e4746519f760／tree64fee94c6dedfaab7bb84d12fc27ee0c03cc5156，exit0、clean，原件ignored .local/calendar-funds-evidence/ca015-e2-acceptance.json；这是依赖接纳，不冒充整批验收。

资源于08:22:24 UTC只读复核固定15433/dev_cor_test和15436预览库均健康，3101/5174空闲、标准资源锁无owner，5186/3206原PID10636/21616仍在；之后I独占标准锁运行上述开发检查。容量服务Selected model is at capacity不记代码或测试失败，恢复先核现场，不重复启动结果不明的验证。未push/main/生产，旧人工预览未热换候选。

## U1／U2案件列表分页组合（2026-10-13，已验收并集成）

基线main`953ae33a811d9c22da3a8f390f393ba407a7f2a7`。U1源`9d93abc4e819fce1c3d751a6ea24a8d37eed4cc3`／tree`ad1b51a0697d60a1625875fe7a46662708455c56`，只改内部列表与CasePages测试；U2源`025694b43eee9fbcfd7aa9a49f144472112af08c`／tree`94358ecc5c6a2545e7f1914480b8751baaa6b7d2`，只改客户列表与ClientCasePages测试。两线停止修改、工作区干净后，I于UTC06:02:12.399～06:02:12.680分别接纳为`2a8b8d0`／`2c7d4ff`，exit0，无冲突，原未提交恢复文档未被夹带；本批已完成本地验收并快进集成；首次授权审批阻塞及最终成功均保留于下文。

作者实际报告已核：U1组件56/56，类型16.155秒、Lint1.557秒、格式0.423秒均exit0；原件在U1 ignored `.local/u1-evidence/report.json`及对应日志。U2组件／既有客户严格API契约36/36，类型17.087秒、Lint1.456秒、格式0.351秒均exit0；原件在U2 ignored `.local/u2-evidence/checks.json`。两线Node24.21.0／pnpm11.27.0、锁文件及Element Plus patch与I基线一致，隔离junction依赖的pnpm元数据异常如实保留；作者使用已核项目Node直接调用已有CLI，未改锁文件、patch、策略或.pnpm-store，未把这些结果称为标准pnpm正式门禁。I本批实际门禁均走既有正常pnpm入口和完整环境指纹，未沿用跳过依赖校验参数。

I只为本次真实分页验收扩展现有`case-complaint-confirmation.spec.ts`：复用`createSubmittedCaseThroughApi`的完整普通来源链，21案确认后用正常运营／本企业客户密码会话验证20＋1、刷新、精确ID详情返回、范围／view回首页、空view及客户最小字段白名单。既有准备器只增加返回其已创建的客户登录信息，未改生产API／schema／授权或直接写目标阶段；密码不写聊天、普通日志或公开摘要。实际仅在固定15433合成测试库运行既有入口，未调用其reset／fixture身份到15436持久预览。新组合已完成独立Review和本批显式Level2门禁；上一批68项和旧verify没有作为本批新分页通过证据。

执行性通过候选为`a9207b43dfe24e3d19284daaea28cedf91f5f7cb`／tree`b1166044e5e2b587e843e708b799fa30ae720da6`。新双端普通密码分页场景47.9秒，既有确认／真实材料下载／同部门只读场景7.4秒；全文件2/2、exit0，UTC06:35:06.345～06:36:09.039、62.692秒，前后候选干净、tree及环境指纹`343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`一致。原件为既有ignored `.local/calendar-funds-evidence/pagination-e2e-20261013-143505-result.json`、同名log及before／after，不伪称Evidence v2。21案完整普通来源链、两端20＋1精确ID集合、刷新与详情返回、范围／view重置、空view和客户字段白名单均通过；不是向持久预览准备21案。

本批正式聚焦单元命令为`pnpm --filter @dev-cor/frontend test src/modules/cases/CasePages.spec.ts src/modules/client/ClientCasePages.spec.ts src/api/cases.spec.ts src/api/client-cases.spec.ts`，4文件154/154、exit0，UTC06:26:22.842～06:26:27.453；`pnpm check:fast` exit0，UTC06:26:28.943～06:27:17.644；累计受影响文件Prettier检查exit0，UTC06:27:19.061～06:27:21.336。这些原始证据绑定`98ff53756767c415735cfa1315af9eb5ebfa7b67`／tree`0799ddb32cfa7b3ca1b82d3068e9b6cda7eea5db`，分别见pagination-unit-20261013-142622、pagination-static-20261013-142628、pagination-format-20261013-142718的result／log。到a9207b4累计差异仅新E2E两项验收请求／链接修正及对应context；产品、组件、严格API及来源准备器输入未变，blob边界见pagination-reuse-boundary.json，限定复用获独立Reviewer接受。变化文件ESLint／Prettier及strict context已补验，a9207b4根TypeScript、Spec57REQ／66AC／11BQ／54SD、strict context、diff检查均exit0，UTC06:36:30.724～06:36:36.041，原件pagination-final-delta-checks.json。未重跑旧完整verify或68项来替代当前切片。

失败完整保留：98ff537首轮新分页场景因确认请求缺body.idempotencyKey而HTTP400，原场景通过，全文件1过1失败／exit1，UTC06:25:58.059～06:26:23.563、25.503秒；71e63de补同键后，内部页2刷新和20＋1已通过，但测试错误要求无query的详情href，实际链接保留page=2，等待耗尽300秒，全文件1过1失败／exit1，UTC06:28:16.785～06:33:35.327、318.540秒。两次仅修测试，不改产品；原件pagination-e2e-20261013-142557／142816的result及log，最终成功不覆盖旧失败。最终独立Reviewer为gpt-6-sol新上下文只读复核累计diff与两项finding关闭；Spec Compliance／Code Quality均ACCEPTED，未关闭Critical／Important／Minor为0／0／0，报告pagination-final-review.md。不是自审冒充独立Review。

预览只读核实UTC06:29:36.735～06:29:37.050：5186/login及3206/api/v1/health均HTTP200，原件pagination-preview-readonly.json；未更改15436数据、Demo8123或部署生产。短暂连接状态不作为通过证据；成功由上述实际result／after及退出码确认。文档收口只允许更新本节、路线图状态、项目恢复点及已核context，不更改代码、测试、合同或下一批设计。自动审批两次在CreateProcess之前拒绝本批main快进／原子推送，理由为初始no-push限制及历史工具输出中的后续授权不能确认为可信批准；两次命令未启动。随后父任务补充用户精确原文及ID Sentinel_d31d3fe5eaf481918243f6e22c08283b，并明确目标为本批U1/U2及必要文档合入main、不部署生产；再次自动审批允许后，实际UTC06:45:04.836～06:45:14.946快进并原子推送exit0，本地main／远端main／任务分支均核为1f69c4baeb81ad7b32cd2f19a905045bb0f12578，tree a3fc54e687eea5d808b6cd7c3fbeb856575e2aa2。原件pagination-first-integration.json；未绕过审批或重试结果不明的写操作。

通过业务候选a9207b4之后到集成收口1f69c4b累计diff只含project-status／feature-roadmap／本验证节及已核context，未改变业务合同、执行说明、代码、测试或环境；文档专项UTC06:43:44.956～06:43:49.169全部exit0，原件pagination-closeout-doc-checks.json。合并为快进且tree精确对应收口，依三级规则限定复用原业务证据，不称收口SHA实跑过业务门禁。后续仅补实际集成状态和对应快照，仍须文档专项与累计输入核对。主目录原cases.ts草稿stash b07482c2c6130baa39cc43658f3dadb17cf81551和未跟踪.pnpm-store保留，恢复指针main-workspace-preservation.json；没有生产部署。

## CA-013／014、日历与人工台账集成（2026-10-13）

用户本轮明确授权推送、合main并持续管理后续开发，不部署生产。读取远端及仓库准入后，确认origin/main与本地main均为`4802c320892a7ce50ce6f2c8600c806213061396`、是任务收口`ea9dcd18fcfcbf9fa092aeb427505ac9892db88b`的祖先；任务工作区干净。已快进本地main并原子推送main与`codex/ca013-014-integration`，实际推送exit0，两处远端refs均核实为`ea9dcd1`，GitHub commit API核实tree`5cd3290a6bf1e25133f30aa8574500170c3080ec`，与已核收口完全相同。没有冲突、强推、额外合并变化或混入主目录草稿，不因快进重复业务门禁。提交链接：[ea9dcd1](https://github.com/glunek123/ip-bp/commit/ea9dcd18fcfcbf9fa092aeb427505ac9892db88b)。

业务证据分别绑定原A`0c7be16`的完整verify／39文件167/167，以及新组合`32cb30d`九文件68/68（UTC05:15:49.403～05:19:34.849、exit0）；`f415f7f`完整verify复用已获独立补审接受，输入边界见下节。`32cb30d`至`ea9dcd1`只有六份完成状态／验证摘要／Spec完成态及已核快照，文档格式、Spec、strict context及diff检查全部exit0，原件ignored `.local/calendar-funds-evidence/closeout-doc-checks.json`。不称`ea9dcd1`实跑了原业务门禁。后续仅集成完成状态及下一批白名单准备，不改本批业务代码、测试、配置或批准契约；下一批任务说明不表示相应新能力已经实现或通过旧门禁。

GitHub准入只读核实：main未保护、rulesets为空、Actions workflows为0，仓库允许push；`ea9dcd1`的workflow runs、check-runs及commit statuses均0。combined status返回pending但没有任何status记录，属于没有配置CI，不能报告CI通过或CI失败。集成及最终收口refs、API结果与实际命令退出状态保存于同目录`remote-integration.json`，文档专项为`integration-doc-checks.json`；后续若配置远端强制检查，按实际规则执行。

主目录`frontend/src/api/cases.ts`原未提交改动与本批重叠，先按字节保全原文件及binary patch，再仅stash该已核tracked文件，stash commit为`b07482c2c6130baa39cc43658f3dadb17cf81551`；原文件SHA256`C9E6C897C616DBC0E60FF40B5D9B504D8D9283493A3CF1CD539444B78189F95E`。原件与恢复说明为同目录`main-cases-before-integration.ts`、`.patch`及`main-workspace-preservation.json`，stash保留，未盲目回填到已前进main，也未加入远端提交。未跟踪`.pnpm-store/`保留原位；其他现场未覆盖、重置或删除。

工程总控继续独占接口／文件所有权、schema／迁移、集成验收及权威文档；父任务负责需求优先级与启动独立实现任务。下一批只读分页U1／U2和历史补录技术设计D1的唯一白名单与验收已在[路线图](../../feature-roadmap.md#下一批分派边界)准备，集成时均未开始实施；后续在途恢复点只见项目状态，原组合证据不能覆盖未来新增分页逻辑。B13执行结束、B15结案／归档及资金门槛继续待业务决定；缴费／其他日历来源、支付、提醒及完整Demo仍未交付。

## 日历与人工台账组合（2026-10-13，本地验收完成，待集成）

以A业务`0c7be16`为基础，在I独立分支接纳B1/B2（`1d35d32`／`c3af081`）、calendar严格API`d7aacdf`、C1/C2（`c4c06f3`／`ee74f88`／`249b8a1`／`d90675e`），新组合`ee430658ade6ad3d3217deb5f30b7d11613fcaf3`／tree`8ed1663e0d20e608244216fba92622f705892e2e`。SD-53只批准真实当前开庭／协议到期与既有人工台账接线；pay／other未接入，支付发起另定。独立静态两轴ACCEPTED、未关闭C/I/M0；I-01当前关系竞态及M-01旧来源指针已关闭。

新组合完整verify实际exit0，UTC02:34:05.526～02:37:45.074、219.546秒；工具80、前端1166、后端1277、strict／Lint／格式／架构／Prisma／双构建通过，前后候选／干净状态／环境HMAC匹配。原件ignored `.local/calendar-funds-evidence/formal-verify-20261013-103405-result.json`及日志。九文件PG／Chromium的第一次实际exit1，UTC02:38:57.523～02:39:00.704、3.179秒：后端启动时日历模块未直接导入AccessControlModule，无法解析ActorContextGuard的IDENTITY_ADAPTER；没有测试执行，不记0项通过。原件`formal-e2e-20261013-103857-result.json`／日志保留。源修复后须重新绑定稳定候选门禁，不能继承ee43065通过结论；原A39文件167/167仍只指A原tree。

修复循环：I-02已补日历模块直接身份授权依赖及真实module编译测试（不替换guard，1/1通过）。日历PG首轮2/3通过；一审准备其他企业账号时缺customer.read范围，修正夹具后又发现律师账号ID误当档案profileId，现取真实API profiles返回，最终失败场景1/1通过，协议／二审原通过输入未变化；这些失败仅测试准备，不放宽业务授权。原件分别为`focus-calendar-after-module-fix.log`、`focus-calendar-first-instance-fixture-fix.log`、`focus-calendar-first-instance-profile-fix.log`。正常持久预览三角色日历切月、五卡／导航、精确caseId、无案协议与缺源类别均通过（`runtime/browser-calendar-summary.json`）；客户两案／律师一案，协议仅内部获权者可见。最后补导航读取同步与失权清空，旧summary成功／失败不可覆盖当前页读取，协议确认后刷新计数；三文件57项聚焦通过，独立静态补审C/I/M0。修复候选cff7151363d72376971774640af0536f6aadbb08（tree9ad573add8e7ed44579fe1ef4580b09cda4cebcf）正式verify于UTC03:04:38.295～03:05:21.995、43.699秒exit1，已过context／Spec／架构／Prisma／strict，停在AppShell.vue两处Event／CustomEvent的no-undef；未进入单元／构建／九文件测试。仅按项目既有globalThis写法修复，定点Lint／格式通过，不改行为。原件`formal-verify-20261013-110437-result.json`／日志保留，最终新候选待正式门禁。

候选f415f7f5736ee3d6be177406bf91427432fe3327（tree964724d1cbe39a5f639d5e7230b95a2a677f8d7d）完整verify在UTC03:08:28.052～03:11:32.941、184.887秒exit0，工具80／前端1167／后端1278及双构建通过，前后候选／环境一致；原件`formal-verify-20261013-110827-result.json`／日志。九文件68项在UTC03:12:00.343～03:15:48.848、228.503秒exit1（67/68），仅旧customers场景精确匹配“客户”但页面实际既有“客户管理”；其余包含全部日历三矩阵与A办理／身份／二审兼容均通过。原件`formal-e2e-20261013-111159-result.json`／日志。仅修改该旧测试选择器，完整客户草稿／编辑／联系人／审计聚焦1/1通过（`focus-customer-heading-fix.log`）；无产品行为或授权变化。该测试输入变动后最终门禁重新绑定新稳定候选，不把f415结果移写。

最后执行性候选`32cb30d670ed6c0f2eaa00ea210931caf0132c6a`／tree`c62f9412407d571cf713059240cd25d78f348eed`仅修改上述客户标题测试，另三文件为状态、验证摘要及对应快照。独立补审两轴ACCEPTED、未关闭C/I/M0；产品源码、类型、单元与构建输入未变，接受按明确输入边界复用`f415f7f`完整verify。原件ignored `.local/calendar-funds-evidence/review-progress.md`末段，不把67/68与聚焦1/1拼成通过，也不称`32cb30d`实跑过旧verify。

原`formal-e2e-20261013-115245-before.json`记录UTC03:52:46.521开始前快照及上述commit／tree、干净状态、相同环境HMAC；同名日志最后写入UTC03:57:18.292，止于第58项通过，没有最终汇总。UTC05:09～05:15核实owner PID13224及日志中的Node PID39236／40036／8168均已不存在，after／result未生成。准确结束时间、总耗时和最终退出码无法取得；实际中断原因未知，不归因于代码、不记exit0或68/68。原锁所有者已保全，核无原进程／已知子进程且测试端口空闲后，通过正常沙箱提权流程恢复该残留锁；核查摘要及日志校验值见同目录`recovery-20261013-0512.json`，不是补造原result。

用户随后明确原15433固定合成测试库仍属已授权验收范围。Docker只读查询的普通沙箱访问拒绝经正常提权流程恢复，确认`dev-cor-postgres-test-1`健康；未停止、重置或迁移其他环境。原九文件68项整组复验于UTC05:15:49.403～05:19:34.849、225.444秒全部通过，commandExit0／captureExit0，运行前后上述commit／tree、干净状态及HMAC`343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`一致。最终原件为同目录`formal-e2e-20261013-131548-result.json`、before／after及日志；单worker、无跳过／重试。这是显式集成范围，不是全仓Release回归、Evidence v2或远端CI。

开发态持久预览15436／3206／5186的正常密码、cookie／CSRF来源链94步已生成两条待执行邮寄／待申请执行合成案；真实Chromium验证四个运营／客户／律师待办入口可见，保留未办理；人工资金登记123.45→刷新逐笔来源→更正223.45→两版历史通过，金额未知仍未录入。摘要与截图在ignored `.local/ca013-preview/runtime/browser-scenario-summary.json`。日历修复重启后，三角色五卡／切月／精确跳转已通过，同目录`browser-calendar-summary.json`保留正常入口证据；这些不冒充固定候选正式门禁。UTC05:11:34只读GET登录页和后端health均200，Edge实际显示登录表单，没有新登录或预览数据写入；恢复入口见`.local/ca013-preview/README.md`，凭据只在`runtime/login.txt`，不入Git／聊天。

此后仅同步本批完成状态、实际证据、范围与对应context快照，不改变SD-53契约或验收要求。累计收口diff限定于项目状态、路线图、日历／客户Spec的完成态、验证记录及快照；文档专项结果保存同目录`closeout-doc-checks.json`。不把收口HEAD称作实跑上述门禁的候选，不重复已匹配verify和68项整组；没有生产发布、推送、合main或Demo服务操作。资金发起、缴费截止／其他节点、提醒、CA-015及后续仍未交付，不称全部Demo完成。

## CORE-CA-013／014执行申请办理（2026-10-13）

授权范围为单案执行材料盖章邮寄→待申请执行、真实法院提交→强制执行中。基线`4802c320892a7ce50ce6f2c8600c806213061396`；业务候选`0c7be16b8d7c50c33535386b66b75d13c6db2569`，tree`84ef4308b4528f86b4039f54647ca306d335de72`，独立`codex/ca013-014-integration`。三类合法邮寄身份、两类提交身份、准确来源锚、不可变日期／精确材料／成功审计／幂等回执及同案CAS／失败回滚已实现；客户仅新增最小邮寄事实与技术锚，不获得执行提交材料或确认详情。四个前向迁移使正式支持链136→140，原已执行SQL未改；执行结束、资金发起、结案和归档未完成。

独立非实现Sol的Task风险审查、组合终审及补审均两轴ACCEPTED、未关闭C/I/M0。I-01客户复用前序冻结回执、M-01Prisma源键索引漂移、I-02普通NULL动作引用被邮寄守卫误挡均关闭；最新报告`ignored .local/ca013-014-evidence/final-review.md`绑定上述候选。

| 检查                       | 候选／实际结果                                      | UTC起止／耗时                                     |
| -------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| 完整Level3 verify          | `0c7be16` exit0；工具80、前端1018、后端1255与双构建 | 2026-10-12 10:08:32.136～10:12:02.713；210.575秒  |
| 39文件PG／Chromium最终组合 | 同候选exit0，167/167，单worker，无跳过／重试        | 2026-10-13 01:35:52.409～01:53:26.452；1054.041秒 |

组合范围显式选择全部`case*.spec.ts`及core-leads、personnel-access、role-template-management，文件清单`formal-e2e-files.json`；不是全仓Release E2E。正常账号浏览器、跨企业／部门、撤权与原键重放拒绝、旧来源链及材料字节、竞争和各写点回滚、140空库／136合法旧业务升级、直接SQL负例和迁移失败向前重试均覆盖。客户端旧CA012断言只放行CA013批准的顶层`executionConfirmationId`技术锚；去该锚后的响应仍不得含确认ID，提交ID、材料版本和内部确认／提交详情继续禁止。停用合成账号后的两个新动作原键重放均拒绝，案件快照不变，恢复后以当前授权版本合法重放且无新写入。

Node24.21.0／pnpm11.27.0；两项命令前后候选／tree／干净状态与HMAC环境指纹`343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`一致。10-13恢复指纹匹配后直接复用verify，未盲目重跑；指纹不证明数据库内容相同。今日原Compose测试容器启动后对隔离合成库成功部署140全链，旧中断锁仅在核PID2528及子进程均结束、端口空闲后保全并释放，未改互斥规则。原件在同目录`formal-verify-20261012-180831-result.json/.log`、`formal-e2e-20261013-093551-result.json/.log`及recovery记录，不伪称Evidence v2／远端CI。

失败和中断保留：`4ae29e9`首轮完整verify通过，但PG组合157/167、exit1，旧技术锚断言及共享NULL引用守卫暴露。第140前向修复在真实触发器最小RED／GREEN、增强PG／迁移2项和原失败浏览器3项通过后补审；`0c7be16`新verify通过。其10-12组合在39项后因用户明确暂停中断、退出1，没有after／成功result，不计167全通过；原`formal-e2e-20261012-181231.log`不覆盖。首轮failure trace、原审查、NULL探针均保存在ignored证据目录。

真实隔离预览使用独立持久Compose库15436、后端3206和前端5186，正常密码登录／授权案件GET200与新导航冒烟已于10-12通过，暂停安全停止后10-13恢复；尚无待办案件，不能把空列表或组件测试当人工全动作验收。凭据只留ignored私密文件，不入Git／聊天。B1与C1仍是各自组件候选，B2／C2接线进行中，不计入A通过范围，不宣称完整费用／日历或Demo全部动作完成。

本记录之后仅A完成状态、验证摘要及解释context的非执行性收口，累计diff必须只含这三份文档及对应快照并做文档专项；不把收口HEAD称作实跑上述门禁的候选。后续日历决定／Spec／API与B2/C2组合属于新业务候选，独立记录其审查与门禁；不push、不合main、不部署生产。

## CA-012与开发反馈优化集成（2026-10-12）

按用户明确授权重新 fetch 并读取真实远端，集成前本地／远端 main 均为 `d57b359ae3e77bfdf73f090e4f3a29cc35750b72`、工作区干净且无分叉。main 快进至 `e6c53d1083924b6e713c1830869995cc0dbe76d2`，组合 tree 为 `05d5c48287edea2735a7cf015667683ea5762b9d`，与流程收口完全一致，无冲突或额外代码变化。原子推送 main、`codex/core-ca-012-execution-confirmation`（`5b77d00`）及 `codex/ca012-development-feedback`（`e6c53d1`）成功；随后真实远端 main 精确 SHA 及包含两个实际候选已核实，原件 `.local/ca012-development-feedback/integration-result.json`。

证据分层保留：业务候选 `e5ccf8c` 的独立非实现审查、完整 verify 及 36 文件隔离 PG／Chromium 163/163；流程候选 `eab6494` 的独立非实现审查、完整 verify（工具80、前端998、后端1222与双构建）和扩展入口127＋159项／4项实测。后者包含原业务实现，相对业务收口 backend／frontend／原tests／SQL／runner／锁及环境输入均无差异；质量规则和预检配置增量由新候选实际验证，不能当作纯文档变化借旧门禁。`eab6494` 至首次集成仅三份非执行性证据／状态／快照变化，文档格式、Spec、strict context及累计diff均退出0，日志 `closeout-*`，环境指纹一致。没有重复原163项整组，不声称组合HEAD实跑原业务门禁。

UTC07:18远端 main 未保护、rulesets0、Actions workflows0、该SHA check-runs0、commit statuses0。Combined status 的默认 `pending` 对应空列表，不代表存在必需检查；未发现必须PR／CI的约束，未绕过保护，不把无CI说成CI通过。本记录之后仅同步实际集成完成状态、验证摘要及对应已核快照，累计四份文档差异按非执行性收口例外执行格式、Spec／链接／状态、strict context和Git diff检查后推送补记，原件在同目录 `integration-closeout-*`。CA-012与本轮微调已推送并集成，Current保留CA-012已完成已集成，CA-013未领取；未部署、创建试用账号或操作人工／开发／生产库，原人工环境保留。

## CA-012开发反馈优化与效率对照（2026-10-12）

用户授权复盘、少量流程微调及 CA-012 推送／集成；不部署或领取 CA-013。流程增量在 `codex/ca012-development-feedback`，从已验收业务收口 `5b77d004622459d6c7a86bc94b7f9b244fcc2234` 建立，与 CA-012 业务提交分开。以下对照只用两片实际记录，不把不同起点的 CA-011 恢复会话约 144.5 分钟与 CA-012 分支准备至收口约 95 分钟换算成提速百分比。

| 可比口径                 | CA-011                                             | CA-012                                                                   | 结论                                                                         |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 正式命令次数与失败       | verify 3 次、PG／Chromium 2 次；各失败 1 次        | verify 3 次、PG／Chromium 2 次；各失败 1 次                              | 晚期失败和正式复跑次数没有减少                                               |
| 五次正式命令包装耗时合计 | 2193.233 秒（36 分 33 秒）                         | 2172.250 秒（36 分 12 秒）                                               | 约 21 秒差异；范围由 34 文件／158 项增至 36 文件／163 项，不据此宣称整体提速 |
| 最终成功 verify＋PG 命令 | 968.150 秒                                         | 986.272 秒                                                               | 最终成功一轮没有更快                                                         |
| 实现／修复／聚焦反馈     | 早期 Worker 部分只有日志或交接摘要，无统一阶段起止 | 11 个已记录开发命令共 266.842 秒；不包括全部 Worker 单测／类型及实现时间 | 不能比较纯编码、修复或聚焦验证总耗时，不能从并发命令之和反推历时             |
| 审查与等待               | Review 有候选／finding轨迹，无完整统一阶段计时     | Task、Final、补审有局部起止；容量故障与恢复偏离任务未单独计时            | 不编造审查／等待占比；容量故障不是代码失败，错误恢复不计作功能验证           |

两片正式结果来自 ignored `.local/case-execution-submission/formal-*-result.json` 与 `.local/case-execution-confirmation/formal-*-result.json`。CA-011 末期是测试装配／旧探针兼容：OpenAPI provider、权限目录数量、旧读取快照、历史迁移窗口及导航断言；CA-012 契约预检在 UTC 05:21 先发现 backend provider／目录问题，但 `&&` 使 frontend 阶段未执行，修复后只复跑 backend，遗漏前端 action 解码在第一条浏览器流程暴露。旧非空列表用例不等于覆盖新必填能力字段，其缺口后来由兼容导航发现。新版权限目录与非空 fixture 已在 CA-012 修复并验收，本轮不再次修改业务或弱化断言。

CA-012 两个正式失败分别是缺字段 fixture 未使用变量（测试静态装配，82.298 秒退出）和旧律师确认前重提控件被阶段门控隐藏（真实 UI 行为回归，整组 162/163，881.248 秒）；后一项组件测试曾把合法重提写成只读快照，且原兼容预检没有选该旧浏览器动作。operator API 准备后页面未刷新是测试时序准备问题，已等待并核对精确 GET 后再办理；没有提高 timeout／重试。先前容量故障与本 Agent 一次恢复误转只读 CA-013 调研属于服务／任务恢复问题，后者已纠正，不能称业务返工或调研完成当前任务。CA-012 的迁移和两项原快照／历史探针兼容在开发期已通过，部分反馈确有前移，但不足以证明总体返工减少。

本轮仅补可定位缺口：①现有 `test:unit:case-contracts` 加前端 organization API 解码和人员／角色编辑器，保留后端失败即停止，并明确补完未执行的受影响阶段；②现有 `test:e2e:case-compat` 增选原律师确认前重提，原测试、断言及 timeout 不变，护栏拒绝漏选、额外文件及扩大匹配；③只在阶段／能力条件变化时核对已批准的阶段／权限／后续事实组合并实际触发旧合法动作，变更 fixture 做受影响 Lint／格式；④恢复先核最新授权、目标、HEAD及原验证进程／结果，避免重复启动或沿旧任务收口。没有新增统一重流程、生成器、依赖或修改正式业务门禁／迁移覆盖。

复用依据：CA-012 服务直接使用 `currentLawyerBindingId`、`authorizeCase`、`assertAvailableVersions` 和 CA-011 不可变提交的版本集合；页面调用既有 API／下载／工作流事件，PG／浏览器复用正常来源准备链。减少了另建身份、版本和恢复基础设施的内容，但没有“从零实现”的对照耗时，不能量化反事实节省。前置入口选测与流程规则发生变化，按 Level 3 独立审查并在固定候选完整 verify；新增入口接线另做针对性实测，不借 CA-012 业务门禁声称本轮新入口通过。

实际流程候选为 `eab6494b814a793c512efcffaf87bc70a75a5b39`，tree `161fa76277201f26eca86b75d14964d71a258d9b`。未参与本增量实现的独立上下文 Sol Reviewer 自行审完整 7 文件累计 diff，Spec compliance／Quality 均 ACCEPTED、未关闭 C/I/M0，报告 `.local/ca012-development-feedback/review.md`；不是外部异模型审查，不追认历史 Pending。开发期工具护栏 13/13、改动文件 Lint 和 mdc 专项格式 exit0；其脏工作区 metadata 仍为基线 HEAD，不冒称最终候选正式门禁。

| 固定候选正式检查                | 实际结果                                                                                               | 命令包装耗时 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------ |
| 完整 `pnpm verify`              | exit0；工具80/80、前端998/998、后端1222/1222及双构建，strict context／Spec／架构／类型／Lint／格式通过 | 213.294秒    |
| `pnpm test:unit:case-contracts` | exit0；后端5 suites 127/127、前端6文件159/159                                                          | 15.544秒     |
| `pnpm test:e2e:case-compat`     | exit0；4/4，单worker，无重试／跳过，包括原律师确认前重提                                               | 47.592秒     |

verify 于 UTC 07:05:18.390～07:08:52.122，契约预检于07:09:18.139～07:09:34.128，兼容预检于07:09:35.140～07:10:23.189。每项前后同一干净候选／tree，Node24.21.0／pnpm11.27.0、环境 fingerprint `8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337` 一致；指纹不证明数据库内容相同。真实命令、退出、时间及边界和完整日志在 ignored `.local/ca012-development-feedback/{verify,unit-contracts,case-compat}{-result.json,.log}`。新增接线实测约63.136秒，只证明这些入口可以更早给出对应反馈，不证明下片总耗时下降；不为所有任务追加必跑要求。

核对相对 `5b77d00`，backend／frontend／原 tests／SQL／受控runner／环境与锁文件完全无差异；`verify`、`test:e2e` 和正式门禁集合不变。CA-012 36文件163/163仍只归原业务候选 `e5ccf8c`，本轮新配置由上述完整verify和新增入口实测验证，不冒称重跑36文件整组。此后只补实际完成状态／验证摘要及对应快照，按非执行性收口例外核完整累计diff并做文档专项，证据在同目录 `closeout-*`；流程规则及选测逻辑本身不适用旧门禁例外。待按授权核真实远端并集成／推送，不部署或领取CA-013。

## CORE-CA-012 确认执行材料（2026-10-12）

实际通过 Level 3 业务门禁的候选为 `e5ccf8c4765678359567d44bc9ac06a5e8d83b87`，tree 为 `dded001ee691915813078033f64a4c6375559a48`；分支 `codex/core-ca-012-execution-confirmation`，main 基线 `d57b359ae3e77bfdf73f090e4f3a29cc35750b72`，已包含 CA-011 与开发反馈优化。本片按 SD-52 一次确认当前整套不可变执行提交及全部精确文件版本，只推进执行材料待确认→执行材料待盖章；运营须有独立确认权，律师限当前 PRIMARY 承办，客户只兼容新阶段，不增加确认事实或材料读取。确认前 SD-51 留原因重提仍保留，确认后由服务及 SQL 拒绝重提；不实现邮寄、申请执行或确认后纠错。

复用既有当前授权／律师绑定、精确版本校验、CA-011 不可变提交与版本关联、案件锁及事务、审计、原请求恢复和正常来源测试链；没有复制单文件诉状确认、金额或披露语义，也没有新建版本系统、生成器或依赖。两个前向迁移将独立测试库由 134 升至 136 条，未修改已执行 SQL。高风险 backend Task、完整集成 Final Review 和修复补审均由未参与实现、独立上下文的 Sol 主体完成；最终候选两轴 Spec compliance／Quality ACCEPTED，未关闭 C/I/M 为 0/0/0，I-01 已关闭。报告在 ignored `.local/case-execution-confirmation/review.md`；本轮不是外部异模型审查，不追认历史外部 Pending。

| 正式检查                             | 实际候选  | 结果                                                                                                                               | UTC 起止                   | 命令包装耗时 |
| ------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------ |
| 完整 `pnpm verify`（attempt3）       | `e5ccf8c` | exit 0；工具 77/77、前端 998/998（90 文件）、后端 1222/1222（97 suites）及双构建；strict context、Spec、架构、类型、Lint、格式通过 | 06:13:46.048～06:16:51.485 | 185.004 秒   |
| 36 文件隔离 PG／Chromium（attempt2） | `e5ccf8c` | exit 0；163/163，单 worker，无跳过／重试                                                                                           | 06:17:14.533～06:30:36.233 | 801.267 秒   |

第二项使用受控 `pnpm test:e2e`，固定选取全部 `case*.spec.ts` 加 core-leads、personnel-access、role-template-management 三文件，范围在 `.local/case-execution-confirmation/formal-e2e-files.json`，完整实际命令在 `formal-e2e-attempt2-result.json`；不是发布前全仓 E2E。两命令前后 HEAD／tree、干净状态及环境均一致；Node v24.21.0／pnpm 11.27.0，非秘密 HMAC fingerprint 为 `8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`，不证明数据库内容相同。真实退出、起止、候选和环境记录在同目录 `formal-verify-attempt3-result.json`、`formal-e2e-attempt2-result.json`，完整 stdout/stderr 为对应 `.log`，不伪称自动 Evidence v2 或远端 CI。

本片 5 条正式 PG／迁移／浏览器用例覆盖整套确认、直接执行及 CHANGE／AFFIRM 来源、空库 136 全链和 134 合法旧提交升级、历史与回执保留、每份迁移失败原子／向前重试及 SQL 负例。运营和当前律师通过正式页面确认，多文件精确字节、刷新／重登、客户敏感字段缺席及准备执行组一致；授权／承办失效后的原键重放拒绝，同键异参、旧提交锚／版本、错误来源／阶段、双确认及确认与重提竞争、审计／事实／阶段／回执写点故障全回滚均有真实 PG 证据。原 CA-011 律师确认前重提用例也在本轮原断言／原 timeout 下通过。预期故障注入的 HTTP 500／SQL 错误属于通过的回滚断言，不隐藏失败。

保留实际失败及修复轨迹：`00d1340` 的 verify attempt1 exit 1（82.298 秒），两处缺能力字段 fixture 的未使用变量导致 Lint 失败，单元／构建未开始；最小 fixture 修复后 `0658a81` 的 verify attempt2 exit 0（222.433 秒）。该候选正式 PG attempt1 为 162/163、exit 1（881.248 秒），新增 CA-012 用例虽通过，原 SD-51 律师重提因前端错误隐藏控件失败；组件 RED／GREEN 11 项及原律师浏览器单例修复通过，独立 Reviewer 于 UTC 06:12:03～06:12:55 关闭 I-01 后才验证新 `e5ccf8c`。原失败日志、结果和 trace 在 `formal-*-attempt1-*` 及相应 artifacts，开发期契约、目录解码、非空列表和页面刷新准备失败也保留在 `dev-*-result.json`／日志，不把旧失败或脏候选定向结果记作最终正式通过。

记录的分支准备时刻为 UTC 05:07:14，正式业务门禁于 06:30:36 完成，现场历时约 83 分 22 秒，包含实现、审查、修复和门禁；不是纯编码时间。最终成功门禁命令合计 986.271 秒，前述失败尝试另计。既有实现减少了重新建设授权、文件版本和请求恢复的工作，仍发生实际兼容修复；没有同等切片对照，不量化提速比例或 Token 节省。

门禁之后仅补本记录、路线图完成状态、项目状态及对应已核对快照。收口核对从 `e5ccf8c` 至最终状态的完整累计 diff、暂存／未暂存及相关未跟踪文件；业务 Spec／Decision、源码、测试、迁移、依赖及运行／验证配置均无变化，按非执行性收口例外执行受影响格式、Spec、链接／状态一致性、strict context 及 Git diff 检查，实际退出和候选边界保存在同目录 `closeout-*`。原业务门禁只归属于上述候选，不称文档收口 HEAD 实跑完整 verify／163 项 E2E。本片本地已验收，待授权集成；未 push、合并 main、部署或操作人工／开发／生产库。CA-013 未领取，原人工环境保留；材料生产 Provider 与完整执行流程仍未交付，既有大 chunk／pg 警告非阻断。

## CA-011与开发反馈入口集成（2026-10-12）

按用户授权获取远端后，本地／远端main均为`caba39d264d68da11577519d4dc87852571240a4`，工作区干净且无分叉。本地main快进至`9105da8535d3919765b5e8a08f7716b7e27f34b2`，组合tree为`3baab87637fbdbf948f53a4a20f80926c939d993`，与开发反馈任务收口完全相同，无冲突或额外代码变化；原子推送main、CA-011业务分支及开发反馈分支成功。

证据分层保留：业务候选`f206df0`的独立非实现Sol终审、完整verify及34文件隔离PG／Chromium158/158；后续规则／入口候选`5303dce`的独立非实现Sol终审及补审、完整verify（工具77、前端988、后端1216及双构建）和新增入口3/3。后者包含原业务全部实现；相对业务候选，backend、frontend、tests、受控E2E runner、环境入口及锁文件均无差异。规则和工具测试变化已由后者实际验证，不归入纯文档例外。

逐项核对`5303dce`至集成tree的累计差异及干净工作区，只有项目状态、验证摘要及对应快照。当前环境指纹仍为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`。因此按现行收口／集成规则保留上述不同候选的实际证据，不把组合HEAD描述为实跑完整门禁。集成专项strict context906、Spec57 REQ／63 AC／11 BQ／51 SD、受影响格式及Git diff检查均退出0。GitHub现场main未保护、rulesets为空、Actions workflows为0，不冒称远端CI已运行。

本记录之后仅同步路线图、项目状态和解释快照，最终累计收口差异仍须完成相同文档专项检查。证据原件沿用ignored `.local/case-execution-submission/`与`.local/ca011-development-feedback/`；本轮未重跑完整verify或158项E2E，未改业务／测试／配置，未部署、未操作人工／开发／生产数据库。Current保留CA-011已完成已集成，Next为CA-012未领取，本轮不启动下一切片。

## CA-011开发期兼容反馈优化（2026-10-12）

用户要求同时减少总耗时／不必要返工并保持代码质量。原CA-011会话`01a0c73a-3c32-7090-a1ee-0f7291fd52ec`于UTC`2026-10-12T03:28:08Z`明确completed／idle、收口`fbe3b9a`且现场干净后，才在本地`codex/ca011-development-feedback`实施。保留原业务成果、Current为CA-011已完成待集成、Next为CA-012未领取；没有推送、合入main或部署。

本次复盘只使用CA-011实际记录：恢复会话约144.5分钟，正式verify三次及34文件PG／Chromium两次的命令包装耗时累计36.554分钟，最终成功一轮16.136分钟；此前尝试累计20.418分钟，均由实际修复触发，不能全当作无理由重复。其余时间没有独立的编码、审查、澄清和等待计时，不编造占比。高成本反馈前遗漏OpenAPI测试provider、权限目录55→56及非空列表解码；旧读取快照schema与当前Service不兼容、历史探针误读后续迁移和聚合导航断言也到正式整组才暴露。开发期还出现授权revision／默认mine等准备错误及Docker重启后tmpfs测试库恢复，这些记录有原因但无完整阶段计时。本轮不改存储策略、共享权限或业务实现，不把CA-010耗时当本次实测。

最小改动只增加既有package脚本的`test:unit:case-contracts`和`test:e2e:case-compat`，复用5后端／3前端直接测试及3项现有PG／浏览器回归，所有原断言、历史升级及独立测试库保护保留。前者提前发现provider／目录／读取／列表fixture不同步，后者提前发现当前schema／历史窗口／导航兼容问题，减少这类问题到整组后才修复和重跑的机会。规则仅在相关契约或来源链变化时按需选用，固定范围外的新增反例、身份／页面和旧链仍补选；不给每Task强制追加，不在同候选最终门禁前机械重复，不生成正式Slice证据或替代Review、完整verify及必要数据库验收，没有自动affected推断或新依赖／平台。

实际通过候选`5303dce74eb097b76ef9e9d55b8977af44a3fad8`，tree`ab89a10bc8164caa4ac1d53b05adb50dfc5cf742`。独立上下文、未参与实现的`gpt-6-sol`审查累计5文件；首轮I1发现选测护栏未拒绝额外文件／双引号标题，保留两负例RED 2FAIL／8PASS；修复为精确文件参数及单／双引号标题匹配后GREEN 10/10，原Reviewer补审两轴ACCEPTED、未关闭C/I/M0。原拒绝及关闭依据在ignored `.local/ca011-development-feedback/review.md`，不是外部异模型审查。

| 固定候选实际验证                | 结果                                                                                        | 命令包装耗时 |
| ------------------------------- | ------------------------------------------------------------------------------------------- | ------------ |
| `pnpm verify`                   | exit0；严格context／Spec／架构／Prisma／类型／Lint／格式、工具77、前端988、后端1216及双构建 | 196.130秒    |
| `pnpm test:unit:case-contracts` | exit0；后端5 suites126/126、前端3文件103/103，正确限定文件范围                              | 14.148秒     |
| `pnpm test:e2e:case-compat`     | exit0；受控PG／Chromium3/3，读取快照、原130历史链及导航；无跳过或重试                       | 29.344秒     |

每项前后干净commit／tree及环境一致，Node24.21.0／pnpm11.27.0，fingerprint`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`；指纹不证明数据库内容相同。完整日志、真实退出／时间、非秘密候选与环境摘要在同一ignored目录的`verify*`、`unit-contracts*`、`case-compat*`。两个新入口的实际执行用于验证新增命令接线和选测范围，非要求普通开发在稳定候选前重复已包含检查。本轮无生产／权限／迁移或原E2E输入变化，数据库验证限定新增入口；CA-011整组158/158仍只归下文原业务候选`f206df0`，不冒称本轮重跑了34文件整组。

实测只证明两个入口约43.5秒可完成这一组反馈；没有同等范围下一切片的前后实验，尚未证明总开发耗时／返工率降低，也未取得token用量。后续有需要时在既有Task报告／检查点记录阶段起止、真实命令耗时、重跑原因及资源等待，不另建台账，效果统计不作为本次交接阻塞。受限进程曾无法解析本地bin，在同一锁定运行时的正常进程中验证；未安装依赖或改全局／安全配置，失败诊断不当作业务或提速证据。

以上验证后只补本记录、项目状态及对应已解释快照；须核对从实际候选到最终收口的累计差异仅为结果／证据／状态，不改变已验证规则正文、脚本、测试或业务契约，再执行受影响格式、Spec、引用／状态一致性、strict context及Git专项。最终结果仍归实际`5303dce`候选，不称文档收口HEAD实跑完整门禁；不要求记录包含自身提交哈希。

## CORE-CA-011 上传执行材料（2026-10-12）

实际通过业务门禁的候选为`f206df06749a8141d29ec2db5aae88eb5e825dcb`，tree为`0c20e04f184c6d0ff85849be87ee0f70ce2e6921`，分支`codex/core-ca-011-execution-materials`，main基线`caba39d264d68da11577519d4dc87852571240a4`。交付范围见[案件Spec](modules/cases.md#ca-011上传执行材料)与SD-51：运营／当前承办律师真实上传、明确选件后提交，首次进入执行材料待确认；确认前可留原因同阶段重提，原提交及精确文件版本保留。侧栏“准备执行文书”聚合本片两个阶段；客户只识别新阶段，不获取执行详情、内部原因或未确认材料。本片不确认执行材料、不邮寄或申请执行，不代表执行流程已全部完成。

新增提交／文件／回执模型及当前指针、内部与律师提交接口、共享正式表单与历史下载；四份前向迁移使测试库达到134条。真实浏览器发现已执行133的律师上传阶段映射错误，以134向前修复，未倒改旧SQL。空库134链、130／133旧schema升级、历史保留、失败原子及向前重试均有PG专项。身份／企业隔离、撤权及承办失效、精确冻结字节、幂等重放／异参、旧锚／版本、并发单胜、上游撤销竞争和各写点回滚由真实数据库验证；五条正常来源浏览器场景覆盖运营提交、律师重提、客户敏感字段缺席、只读／跨案拒绝及分组导航，含刷新／重新登录。

独立上下文且未参与实现的`gpt-6-sol`主体审查完整累计组合，Task／Final Review及修复补审均已关闭finding。最终固定候选两轴Spec compliance／Quality均ACCEPTED，未关闭C/I/M均0/0/0；不是外部异模型审查。首轮发现列表阶段／办理徽标遗漏、403后陈旧历史仍显示和领取旧文案，均保留RED、最小修复及补审关闭依据。此前历史外部Review Pending不据此追认。

| 正式尝试             | 实际候选 | 结果与耗时                 | 原因及证据边界                                                                                                                  |
| -------------------- | -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| verify 1             | bcf519a  | exit 1，167.108秒          | 前端988通过，后端1139通过／74失败；OpenAPI缺测试provider、目录旧55断言未同步56。未执行双构建。                                  |
| verify 2             | d3c60a4  | exit 0，181.077秒          | 工具74、前端988、后端1216及双构建通过。不能当作后续新候选实跑。                                                                 |
| 34文件PG／Chromium 1 | d3c60a4  | exit 1，155/158，876.898秒 | 旧开庭快照临时schema缺新枚举、旧二审历史探针读入后续迁移、旧导航断言误用单阶段文字。失败trace保留，三处定向修复及补审后才复跑。 |
| verify 3             | f206df0  | exit 0，187.269秒          | 工具74/74、前端988/988（89文件）、后端1216/1216（96 suites）及双构建全部通过。                                                  |
| 34文件PG／Chromium 2 | f206df0  | exit 0，158/158，780.881秒 | 全部case文件及core-leads、personnel-access、role-template-management；无跳过／重试，三处旧失败在整组复验通过。                  |

完整日志、真实退出状态、前后候选／脱敏环境记录和Review在ignored `.local/case-execution-submission/`：`formal-attempt3-verify*`、`formal-attempt2-e2e*`、`final-review.md`；前次失败日志及`formal-attempt1-e2e-artifacts/`保留。正式命令前后HEAD／tree／工作区一致，环境指纹均为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`。聚焦开发反馈不计作完整门禁；部分早期Worker测试只有原工具输出转存摘要，未冒称完整机器日志，最终正式日志已完整保存。Token用量未取得，不据耗时声称提速比例。

门禁后只补本记录、路线图完成态、项目状态摘要及对应已核快照。核对从实际候选到收口的完整累计差异（含未提交项），确认没有业务契约／验收、代码、测试或配置变化，按现行非执行性收口例外执行格式、Spec、引用／状态一致性与strict context检查；结果保存在同目录`closeout-*`。原业务证据仅归属上述候选，不称文档收口HEAD实跑完整门禁，也不要求记录包含自身提交哈希。CA-011已本地验收，尚未推送或合入main，CA-012未领取；只操作15433独立测试库，人工／开发／生产库、部署均未操作。既有大chunk与pg弃用警告非阻断；CA-012接入确认事实后仍须增量补后续阻断及竞争验证。

## CA-010与前置反馈规则集成（2026-10-11）

按用户授权获取远端后，确认本地／远端main均为`a1d99fc446b0753957fb1a268a297ab5f19913de`，工作区干净、无分叉；快进合并至`6fd7a920ca03dedea9f48ea0c97f11cfe19c1b46`，组合tree为`b60463c97a7e4f393dd1b6f530a1b9edf20685e6`，与任务收口完全一致。原子推送后`ls-remote`确认main与CA-010分支均为该提交。GitHub当时main未保护、rulesets为空、Actions workflows为0；没有远端必需检查，不冒称CI已运行。

组合已包含实际通过完整verify的规则候选`26b4f23`；核对该候选至集成提交的完整累计diff、暂存／未暂存及未跟踪项，仅三份状态／证据／解释快照。业务候选`38c7ab9`至集成提交的backend、frontend、tests、scripts、依赖及运行输入均无差异；规则正文变化已在`26b4f23`独立审查和完整verify覆盖。当前环境指纹仍为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`。因此按现行非执行性收口／集成规则保留`26b4f23`完整verify与`38c7ab9`的147/147数据库／Chromium证据，不称集成HEAD实跑旧结果，不机械重跑完整门禁。当前组合strict context889、Spec57 REQ／63 AC／11 BQ／50 SD、受影响格式均退出0。

本次之后仅补记路线图、项目状态、本记录及对应快照；再次核对累计收口diff并完成格式、引用／状态一致性、Spec和strict context后提交，不要求本记录包含自身提交哈希。未部署、未操作人工／开发／生产数据库。下一片须从已核实的更新后main领取，未将本集成记录当作CA-011业务验收。

## 切片前置反馈最小修复（2026-10-11）

基线`f88264086c124568c8203b1ea7d033b7e7f437f2`；实际通过规则验收的候选`26b4f23b7a71f33c704eecde72c854e106a6ae4b`、tree`99bab86cb9c7f53006a60a8302155ea747fee946`，仍在`codex/core-ca-010-appeal`。仅修改既有三级规则、AI交接段落、状态摘要和已解释快照；未改业务Spec／范围、代码、schema、迁移、测试／输入、选测逻辑、依赖、运行配置或CI。Current仍为CA-010已完成待集成，Next仍CA-011未领取；本轮不推送、合并、部署或开发新片。

前置反馈复用现有Brief／计划和Tests executed／Contract changes字段：先核对本次公共契约的必填锚、合法空值和精确版本变化，提前检查受影响的权限目录、旧fixture及历史迁移边界；先主要真实纵向流程，再覆盖其余必需分支／角色。重复失败无新证据先定位，不靠改生产授权、弱化断言、放宽超时或增加重试通过。未新建脚本／平台／台账，未增加逐Task全量门禁，保留原独立审查、正式门禁及真实数据库／浏览器要求。

独立上下文且未参与实现的`gpt-6-sol`Reviewer核对完整四文件差异，并走读缺必填锚、合法空附件、SAVE+0／RESULT+2、新Action兼容、旧117与新130迁移链、旧GET／会话／日期／选附件时序、首条流程不替代最终覆盖、规则修改不适用文档例外共八个场景；Spec符合性／质量均ACCEPTED，未关闭C/I/M0。报告`.local/slice-feedback-optimization/review.md`，是规则边界走读，不冒称自动证明未来不会再发生同类错误。

此规则修改按Level 3在固定候选实际运行一次`pnpm verify`，退出0、264.743秒：严格上下文889文件、Spec57 REQ／63 AC／11 BQ／50 SD、架构、Prisma、类型、Lint、格式、工具11文件74/74、前端87文件963/963、后端95 suites1206/1206及双端构建通过。UTC`2026-10-11T15:13:34.8236743Z`开始、`15:17:59.5718506Z`结束；前后干净commit／tree与环境一致，fingerprint为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`，Node v24.21.0、pnpm11.27.0。完整日志和真实退出／时长、候选／环境在ignored `.local/slice-feedback-optimization/verify{.log,-summary.json,-before.json,-after.json}`。`.mdc`另以Prettier显式Markdown parser通过格式检查。

没有业务、权限实现、数据库结构／输入或验证入口变化，本轮不重新运行数据库／Chromium整组验收；CA-010的147/147仍只绑定下文`38c7ab9`，不写成规则候选实跑。正式门禁后仅补本记录、状态摘要和对应快照；须核对`26b4f23`至最终收口的累计diff、暂存／未暂存及未跟踪项，仅允许非执行性状态／证据／已解释快照，再运行受影响格式、Spec、链接／指针、strict context及Git专项，日志`.local/slice-feedback-optimization/closeout-doc-check.log`和`closeout-diff.txt`，真实退出0才提交。规则正文和交接流程不在收口阶段改动，不以文档例外跳过本轮规则的完整verify。

前置调用曾因Node版本比较漏归一化`v`前缀、Prettier未指定`.mdc`解析器而停止；修正调用后使用锁定运行时和显式parser通过，未修改环境锁或测试条件。原始情况保留在ignored `progress.md`，不计作正式verify成功。未取得token用量；本轮证明规则一致性和工程检查通过，不证明未来返工率下降，提速效果尚未量化。

## CORE-CA-010 二审办理与结果（2026-10-11）

实际通过正式门禁的业务候选为`38c7ab98dad1717bdaeeb9956208291f96ba49ce`、tree`53309640bdc258ea29eec4dade1d3784b01bb1b4`；分支`codex/core-ca-010-appeal`，main基线`a1d99fc446b0753957fb1a268a297ab5f19913de`。本轮本地验收，不推送／合并／部署，不领取CA-011。后续非执行性收口提交不冒称实跑过该候选的业务门禁。

按SD-50交付`CaseTrialRound`及二审进展／结果事实、精确材料版本、撤销历史和幂等回执。运营及当前有效PRIMARY律师可保存进展、登记改判／维持原判／发回重审；改判或维持原判结果进入待写执行材料，不等于申请强制执行。发回重审保留同一案件、创建独立轮次，重新受理、开庭、判决和后续选择，不覆盖原事实；具备独立权限的运营留原因撤销仅允许无正式后续事实的目标，律师无异常撤销权。金额已知／待定分开，维持原判沿用本轮一审金额，发回重审金额不适用；费用只记事实、不发起支付或退费。案锁、版本、精确当前轮次／选择／进展锚、事实、冻结、审计及回执原子提交，重放仍重验权限。客户端只获取本企业允许投影，不获取内部二审资料／费用／文件。

内部新增`POST /api/v1/cases/:id/second-instance-save`、`second-instance-result`、`second-instance-result-revoke`；律师前缀只提供前两个正常动作。运营／律师详情共用`CaseSecondInstancePanel.vue`，接通进展、三种结果、历史下载、影响说明、冲突反馈及结果未知时原body／key恢复。上传未知保留最小恢复标记，Command恢复限当前页面内存，不冒称整页刷新后仍保存原请求。前向迁移共13份：`20261010040000`至`20261010050000`的11份，以及`20261011010000_allow_lawyer_second_instance_material_upload`、`20261011020000_scope_retrial_acceptance_freeze`；完整名称以`backend/prisma/migrations/`为准，未修改已执行迁移。只升级`backend/.env.test`的15433独立测试库public至130条；人工、开发和生产库及持久卷未操作。

分轮、后端及前端高风险Task均经非实现6 Sol审查后集成；整体Final Review覆盖累计87文件候选，首次发现合法SAVE+0／RESULT+2回执被误拒，`fea090e`精确修复并补浏览器证明。之后Lint、权限目录兼容、空受理附件解码和旧回归测试修复由原Reviewer补审，最终`38c7ab9`的Spec符合性及实现质量均ACCEPTED，未关闭Critical／Important／Minor均0。Reviewer为独立上下文、未参与被审查实现的`gpt-6-sol`主体，符合当前主体独立判据；不冒称外部异模型审查，历史Pending不追认。报告在`.local/case-second-instance/final-review.md`及各Task审查／修复记录；补审围绕修复累计diff，不重复未变范围的全部审查或Worker测试。

| 固定候选正式检查                           | 实际结果                                                                                                                      | 包装耗时  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| `pnpm verify`                              | 退出0；严格上下文、Spec、架构、Prisma、类型、Lint、格式、工具11文件74/74、前端87文件963/963、后端95 suites1206/1206及双端构建 | 291.914秒 |
| `pnpm test:e2e`，下述31文件，`--workers=1` | 退出0；隔离PostgreSQL／Chromium147/147，无跳过或重试                                                                          | 959.621秒 |

verify于北京时间`2026-10-11T17:53:33.2565406+08:00`开始、`17:58:25.1743029+08:00`结束；E2E于`17:58:50.8092113+08:00`开始、`18:14:50.4343022+08:00`结束。每项前后干净commit／tree及环境一致，fingerprint均为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`，Node v24.21.0、pnpm11.27.0；指纹不证明数据库内容相同。完整输出与真实退出／时长、候选／环境摘要为`.local/case-second-instance/final-verify-attempt-4/final-verify{.log,-summary.json,-before.json,-after.json}`及`final-e2e-attempt-2/final-e2e`同组文件。HTML为后者的`playwright-report/index.html`，机器结果`test-results/.last-run.json`为passed且failedTests为空。原始证据被Git忽略，不冒称远端CI产物。

E2E实际范围为`tests/e2e/`内：`case-second-instance`的浏览器／database／migration／cleanup-database四文件；`case-acceptance`、`case-hearing`、`case-judgment`、`case-judgment-next-step`、`case-complaint-confirmation`、`case-complaint-mailing`、`case-filing`各浏览器／database／migration三文件；`case-lawyer`浏览器／database两文件；`cases.spec.ts`、`core-leads.spec.ts`、`personnel-access.spec.ts`、`role-template-management.spec.ts`。这是本片、分轮影响的旧来源链及新增权限目录的风险范围，**不是全仓Release E2E**，不伪称自动affected选测。共享数据库清理、迁移和故障注入串行运行。

真实PG覆盖三种结果、精确旧文件字节、历史／回执保留、权限和企业隔离、撤权／当前承办失效、同键重放／异参、版本及锚过期、并发单胜、与既有纠错互斥、事实／冻结／审计／回执故障整笔回滚和SQL绕过拒绝。迁移专项覆盖空链130条、117条历史基础含旧事实升级，以及128→129、129→130前向修复；合成旧数据不冒称旧账号HTTP办理。5条新真实密码浏览器流程证明运营未知上传恢复、合法SAVE+0与RESULT+2、发回重审受控撤销后完成独立同案新轮次、律师改判及客户受限投影、维持原判已知／待定金额；刷新、重登、阶段列表及精确附件读取通过。当前承办结束后的拒读有PG服务验证，但正式结束承办入口／前任律师参与期历史仍未交付；不冒称该操作已有浏览器闭环。未来CA-011正式执行事实仍须接入同案锁及撤销／更正阻断，不把当前缺少未来表视为未来安全证明。

| 正式失败与复跑历史     | 实际结果及原因                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verify第1次，`56d6a55` | 58.130秒、退出1；浏览器测试未用参数触发Lint。`5390da9`仅删未用参数，定向静态检查及补审通过。                                                                  |
| verify第2次，`d2b94b5` | 247.746秒、退出1；工具74/74、前端961/961通过，后端1205/1206，权限目录旧断言52与新增3项后的55不符。`af13026`更新精确数量并断言三项Action及范围，不弱化旧断言。 |
| verify第3次，`ca8700e` | 244.040秒、退出0；工具74/74、前端961/961、后端1206/1206及构建通过，结果只绑定该旧候选。                                                                       |
| E2E第1次，`ca8700e`    | 983.300秒、142/145、退出1；本片5条新浏览器及130迁移通过，但旧受理空附件被严格解码器误拒、旧迁移探针误要求总数117、运营／律师／客户合并用例耗尽原30秒预算。    |

`1938986`只移除与既有可选附件契约冲突的非空条件，仍严格校验附件内容及敏感投影；API54/54和原受理浏览器1/1通过。`e23ff07`只限定旧CA-009明确支持的117条迁移前缀，并将原长浏览器用例拆为各自准备／清理的三个独立场景，保留全部关键断言、原超时和零重试。拆分首轮1/3失败：宽泛GET监听捕获更正POST前的旧响应，以及选择执行分支前查找条件复选框；保留trace并定位后修正测试顺序，3/3通过。一轮漏加载项目运行时的迁移尝试使用Node24.16，明确不计有效证据；同一进程加载锁定运行时后1/1通过。原失败和无效日志均保留。最终新候选才取得上表完整通过；正式verify共4次、正式31文件E2E共2次，复跑来自实际修复，不是完成态写回Spec。未取得token用量，提速效果未量化。

之后仅补本记录、`feature-roadmap.md`完成态／受影响余量、`project-status.md`恢复摘要及对应`context-snapshot.json`。按现行非执行性收口例外，须核对从实际候选到最终收口的累计提交／完整diff、暂存／未暂存及相关未跟踪项；只允许上述状态、证据及已解释快照，不改变业务Spec／AC、代码、测试、迁移、配置和环境。受影响格式、Spec／引用、状态指针、标准context记录／strict及Git差异专项以真实退出0为提交前提，结果保存`.local/case-second-instance/closeout-doc-check.log`，累计范围见`closeout-diff.txt`；不要求本段包含自身提交哈希，不称收口HEAD实跑业务门禁。

本片没有剩余验收阻塞；执行材料／申请／结束、结案归档、外部案件补录、完整财务及生产材料／运维发布仍未交付。开发／生产迁移、部署、远端CI未执行。Current保留CA-010已完成待授权集成，Next CA-011未领取；须获授权集成并核对组合tree后再领取。

## CORE-CA-009 判决后续选择（2026-10-10）

实际通过正式门禁的业务候选为`0442c832a92e01942e370837bcc9d870d03d4d5c`、tree`44b6879fa430ed35c7701485f9713dde11e24323`；分支`codex/core-ca-009-judgment-next-step`，main基线`6ae39ac1a688f2d553bc5b439e0fbc208e131151`。本轮本地验收，不推送／合并／部署，不实施CA-010。后续状态收口提交不冒称实跑过该候选的业务门禁。

按SD-49交付不可变`CaseJudgmentNextStep`、上诉人关联、`CaseJudgmentNextStepRevocation`及回执、案件当前选择指针。有权运营或当前PRIMARY律师从已登记判决的待判决选择APPEAL→二审，或明确核实EXECUTION→待写执行材料；支持原告、多个被告及双方同时上诉，稳定ID与当时名称分别保留。内部独立撤销权限、必填原因、允许阶段和同案锁约束受控回到待判决，再更正／重新选择；律师没有异常撤销权。选择、撤销、审计、CAS与幂等回执原子提交；原键返回原结果，当前权限及承办关系仍重验。客户仅同步阶段，不获取内部判决、选择、原因、人员账号ID或附件。

新增内部／律师`POST .../judgment-next-step`和内部`POST .../judgment-next-step-revoke`，同步详情capability、权限目录及前端严格解码；共享`CaseJudgmentNextStepPanel.vue`接通运营／律师详情、历史、影响说明、确认、未知原请求恢复与冲突反馈，侧栏新增真实可达的二审／待写执行材料。不得将转执行准备称为已申请强制执行。五份前向迁移为`20261010030000_add_case_judgment_next_step_enums`、`20261010031000_add_case_judgment_next_step_facts`、`20261010032000_guard_case_judgment_next_step_chain`、`20261010033000_allow_lawyer_judgment_next_step_audit`、`20261010034000_guard_case_judgment_plaintiff_snapshot`；仅独立测试库升级至117条，未改已执行迁移。

高风险Task及最终集成Review由非实现`gpt-6-sol`子Agent执行；最终代码`487d948`的两轴Spec compliance／Code quality均ACCEPTED，未关闭Critical／Important／Minor为0，`0442c83`只记录已解释上下文快照。原告名称SQL守卫、旧CORRECT头升级、律师投影、同案未提交草稿失效和409反馈等finding均已补审关闭。报告集中在`.local/case-judgment-next-step/{task-1-review,lawyer-projection-review,final-review}.md`及Task／修复报告。审查为**同模型非实现隔离，独立性不足**；外部异模型独立Review为**Pending（本轮未执行）**，不称其通过，也没有证据称外部服务不可用。

| 固定候选正式检查                             | 实际结果                                                                                                              | 包装耗时  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- |
| `pnpm verify`                                | 退出0；严格上下文、Spec、架构、类型、Lint、格式、工具11文件74/74、前端85文件913/913、后端94 suites1180/1180及双端构建 | 179.600秒 |
| `pnpm test:e2e`，下述13个文件，`--workers=1` | 退出0；适用隔离PostgreSQL／Chromium95/95，无跳过或重试                                                                | 451.467秒 |

E2E实际选择`tests/e2e/`内的`case-judgment-next-step.spec.ts`、`case-judgment-next-step-database.spec.ts`、`case-judgment-next-step-migration.spec.ts`、`case-judgment.spec.ts`、`case-judgment-database.spec.ts`、`case-judgment-migration.spec.ts`、`case-hearing.spec.ts`、`case-hearing-database.spec.ts`、`case-hearing-migration.spec.ts`、`case-lawyer.spec.ts`、`case-lawyer-database.spec.ts`、`cases.spec.ts`和`core-leads.spec.ts`。这是本片及受影响旧链的正式风险范围，**不是全仓E2E**，不伪称自动affected选择。verify于UTC`2026-10-10T07:03:06.9105622Z`开始、`07:06:06.5100689Z`结束，E2E于`07:06:46.7909407Z`开始、`07:14:18.2577796Z`结束。

两项前后干净commit／tree及环境一致，fingerprint均为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`；Node v24.21.0、pnpm11.27.0，数据库只用`backend/.env.test`的15433独立测试库，不打印凭据。指纹不证明数据库内容相同。原始日志、真实退出／时长及环境摘要为`.local/case-judgment-next-step/formal-attempt3-verify{.log,-result.json,-environment-before.json,-environment-after.json}`与`formal-attempt2-e2e`同组文件；独立复制的HTML为`formal-attempt2-e2e-playwright-report/index.html`，机器结果为`formal-attempt2-e2e-test-results/.last-run.json`，status=passed且failedTests为空。原始证据被Git忽略，不冒称远端CI产物。

真实PG覆盖权限／企业范围、当前承办及停用即时拒绝、原键重放／异参、旧version／judgment、选择与判决更正竞争、撤销竞争，以及事实／上诉人关联／审计／回执故障整笔回滚。SQL负例拒绝假原告名称、外案被告、伪造版本／锚点／审计／回执和跨案指针；主体后来改名仍保留原快照。撤销后通过真实HTTP更正并逐字下载原冻结文件，旧回执不变；清理故障回滚并恢复不可变守卫。迁移覆盖空链117条及上一支持112条含REGISTER／CORRECT头、开庭、审计、回执和冻结引用的合成旧数据升级，逐JSON保真后以旧更正头正常选择提交。合成旧数据不冒称旧HTTP办理，真实文件字节另由HTTP路径证明。

真实密码浏览器覆盖运营双方／同名多被告选择→二审→刷新→留原因撤销→真实上传并更正判决→转执行准备→列表／侧栏／刷新／重登；当前律师真实登记并选择，不能撤销；本企业客户只见允许阶段，其他企业拒绝，内部事实及附件不可见。未知POST原body/key恢复、同案普通草稿失效、切案／身份迟到响应、403清资料及409持续提示另有组件证据。

失败与复跑如实保留：正式verify共启动3次。首轮`fb7eb34`退出1（161.178秒），工具74/74、前端913/913通过，后端93 suites／1107项通过、OpenAPI一suite71项因测试provider遗漏失败，构建未运行；F1只补provider及两项201 schema断言，聚焦76/76及补审通过。第二轮`9eff3fc`完整verify退出0（174.262秒），但正式E2E首轮94/95退出1（461.412秒）：更正POST成功后测试先填写旧详情，随后GET新判决触发正确的旧草稿保护。F2只等待真实GET的judgmentId／version一致及新金额／文件DOM呈现，单条1/1后补审关闭；没有改保护、断言、重试或超时。最终新候选才取得上表完整通过。首轮verify在`formal-verify.*`，第二轮在`formal-attempt2-verify.*`，失败E2E在`formal-attempt1-e2e.*`及独立复制的HTML／trace；F1／F2 RED／GREEN及原因见`final-fix-report.md`。正式E2E共启动2次；这些复跑源于实际测试修复，不是完成状态写回Spec。未取得token用量，提速效果未量化。

之后仅补本验证记录、`feature-roadmap.md`完成态／受影响余量与唯一指针、`project-status.md`恢复摘要及对应`context-snapshot.json`。按现行非执行性收口例外，必须核对从实际候选到拟收口状态的累计提交／diff、暂存／未暂存及相关未跟踪项，只允许上述状态、证据和已解释快照；代码、测试、迁移、业务契约／AC、构建、配置及环境不变。收口检查使用受影响Prettier、Spec、链接／指针一致性、标准上下文记录及strict和Git差异，实际结果保存在`.local/case-judgment-next-step/closeout-doc-check.log`，以真实退出0为收口前提，不要求本段包含自身提交哈希，也不称收口HEAD实跑业务门禁。

本片没有剩余业务验收阻塞；二审结果、执行材料／申请、财务及外部补录未交付。CA-010／011接入正式后续事实时仍必须扩展同案锁及撤销／判决更正数据库阻断，不以缺少未来表冒称已验证未来安全。开发／生产迁移、对象存储生产Provider、部署和远端CI未执行；旧大chunk与pg弃用警告为非阻断，pg@9兼容未验证。Current为CA-010未领取、Next为CA-011未领取；须先获授权集成CA-009及核对组合tree。

### CA-009授权推送与快进集成（2026-10-10）

用户授权“推送合并CA-009，核对组合tree”。只读context无漂移；获取远端后，本地main与origin/main均为`6ae39ac1a688f2d553bc5b439e0fbc208e131151`，是任务分支祖先，无分叉或未提交修改。本地main快进至`866771b56a782b93d778cc67f2369c14695930dd`，tree`a5f66b92adcef638c7a9299eb07cdf5f13ca2202`与原收口完全一致；原子推送main及任务分支后，`git ls-remote`确认两者均指向该提交，没有形成未验证的业务组合。

集成前重新采集候选及实际测试环境，fingerprint与原完整verify／95项E2E一致。从实际业务候选`0442c83`到本次最终状态，累计提交／diff、暂存／未暂存与相关未跟踪项只含上述四份非执行性完成态、集成摘要、证据引用及对应快照；模块Spec、代码、测试、迁移、构建、配置和相关环境未变。复用原业务候选的完整verify与适用95/95证据，未机械重跑完整业务门禁，也不称最终main实跑其结果。集成快进核对、格式／Spec／链接与状态指针、严格上下文及累计范围检查的实际结果保存`.local/case-judgment-next-step/integration-doc-check.log`和`integration-result.json`，原始环境见`integration-environment-before.json`；以真实退出0为状态提交前提，不要求本段包含自身提交哈希。

GitHub查询显示main的protected=false、仓库rulesets为空、Actions workflows为0；首次推送后的`866771b` check-runs为0，无远端必需检查，不表述为服务器CI已通过。首次推送前查询该尚未上传SHA返回422“commit not found”，推送后重新查询成功，不将其误报为CI失败或通过。同模型隔离审查的独立性不足及外部异模型Review Pending仍保留。本轮仅集成CA-009，不实施CA-010／011、不发布／部署、不操作开发／生产数据库，独立人工环境保留。

## 仓库整理与历史迁移探针修复（2026-10-08）

基线`e15fd4b797abb609b4e8cd39b2b872246271b15a`；本地分支`codex/repository-hygiene`。实际受验候选`c7572c6eb53bf42fd05416d9fb4317134319b062`、tree`1013c61a28ed2878132a6bb904365e98368ad4ed`。整理验收轮不开发业务Slice、不改变Current CA-008／Next CA-009、未推送／合并或部署；后续授权集成另记如下。

检查132份README／docs Markdown、463份代码／测试入口的引用及196份自动发现测试，没有发现可确认安全删除的正式业务孤儿文件或重复测试；静态引用分析不证明全部动态调用均无死代码。删除9份已无当前引用的旧`.superpowers/sdd`Worker报告，独有现行业务契约及验收证据未发现缺失；可从上述基线Git恢复。清理状态页的旧阻塞和重复验收摘要，详细历史仍在本记录；案件Spec／路线图改掉CA-008尚未接入的过期将来时，不改变权限、业务约束或AC。

6份手工迁移脚本保留独有旧数据／回滚断言，不删除。CA-001、NT-004、NT-005、NT-007及开箱审核Node测试原先把全部新迁移当作历史目标，RED均退出1；只限定明确的历史迁移前缀，保留全部断言，GREEN均退出0。律师67→72脚本仅补用途和限制，仍须匹配历史schema、服务及Prisma Client，不能直接在当前HEAD复验，也不冒称当前门禁。入口和安全调用示例集中见[README历史迁移专项](../../../README.md#历史-schema-迁移专项)，未新建选测入口或证据平台。

本轮按Level 2执行：只改历史探针的迁移枚举与文档，未改正式业务代码、迁移SQL、依赖、构建／测试配置、权限或验证规则。实际结果：

- `pnpm check:fast`在`24cf0358fdcab6c741244f35a2f119f404f70ee0`／tree`ffbdc73989b2e59560c95247e3a0cde20786e1e5`退出0，59.179秒，覆盖架构、双端／根类型及Lint。至c7572c6只修README说明和对应快照，静态检查的代码、配置和生成输入未变，保留该结果，不称c7572c6重新实跑。
- `pnpm test:context`首次与快速静态检查同时执行，73/74，60.100秒，`architecture-check.test.mjs`的ESLint冷启动项超5000ms；没有证据断言唯一原因。保持配置、断言和超时不变，c7572c6上单独串行复验退出0，11文件74/74，20.035秒；原失败日志保留，不增加自动重试掩盖失败。
- c7572c6上实际提取README的PowerShell内Node示例，逐一替换前五份目标并串行执行，5/5退出0，其中Node测试2/2；每项取得现有E2E资源锁，校验并注入`backend/.env.test`环境，仅创建／清理随机测试schema，不重置public、开发／生产库或卷。Node v24.21.0、pnpm11.27.0，环境fingerprint为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`，前后候选／tree、干净工作区及指纹一致。
- 候选受影响10文件格式、`spec:check`（54 REQ／60 AC／11 BQ／44 SD）、严格上下文及累计Git差异检查均退出0。没有修改业务行为或当前迁移链，不重跑完整verify、前后端全部业务单测或全量浏览器；本轮历史前缀结果不能替代当前91份完整迁移链或CA-008业务验收。

非实现Sol子Agent对完整20文件范围及补丁执行Final Review，c7572c6为ACCEPTED、未关闭C／I／M均0；同模型隔离审查，不等同于外部异模型独立审查。首审的README加锁说明不准确及测试用途误述已修复并补审；安全示例另由主Agent实际运行验证。完整输出、RED／GREEN、真实退出、时长及非秘密环境摘要保存在被忽略的`.local/repository-hygiene/`，不冒称远端CI产物。

此后仅补本实际证据、状态页引用及其对应上下文快照，不修改README、安全运行说明、Spec、代码或测试。核对候选至最终收口的累计差异、暂存／未暂存及相关未跟踪项后，执行受影响格式、引用／状态一致性、Spec、严格上下文和Git差异专项；记录为`.local/repository-hygiene/closeout-document-check.log`，通过才提交，不称收口HEAD实跑旧候选检查，不要求本段包含自身提交哈希。没有取得实际token用量，清理及提速效果未量化；律师历史复验限制保留。

### 整理授权推送与快进集成（2026-10-08）

按用户后续授权“推送合并”，只读context及严格检查通过；fetch后本地main与origin/main均为上述e15fd4b基线，无分叉或未提交变化。main快进至收口`df7a7c47240fb89610bc7b5e40e74558354d19f5`，tree`436c38533a092512fd4a7ddbf5c7e3d4f23ddecb`与原收口完全一致；原子推送main及清理分支后，`git ls-remote`核实两者均为该提交。

重新采集的环境fingerprint与上文五份专项一致；从c7572c6至拟最终状态的累计差异、暂存／未暂存及相关未跟踪项，只含本记录、状态摘要和对应已解释快照，未带入业务代码、测试输入、迁移或配置。集成后的格式、Spec、严格上下文及累计差异检查退出0，日志为`.local/repository-hygiene/integration-document-check.log`，候选／环境摘要为`integration-environment.json`。按现行收口／集成规则保留原候选结果，不把本次HEAD称为重新实跑完整verify或全量E2E。GitHub main的protected=false、rulesets为空，check-runs和Actions workflows均0，不称服务器CI通过。

此后只补实际集成状态与对应快照；同类文档专项保存为`.local/repository-hygiene/integration-closeout-document-check.log`，退出0后提交并推送main，不要求本段记录自身提交哈希。保留可复用工作区，不移除其他任务worktree或正在使用的人工测试目录、进程、容器；本轮不部署、不操作开发／生产数据库、不领取CA-009。

## CORE-CA-008 判决登记与受控更正（2026-10-08）

实际通过Level 3的业务候选为`90924147ccf3c001bf4ffb6f8f17ba3bb13aa247`、tree`ce10e17c7136b8148b786817b5f2d6cd9ad85f0e`；分支`codex/core-ca-008-judgment-registration`，main基线`4bfeab7ae73a6c0b5455c39da326dba57d5ee4e7`。此后收口HEAD不冒称实跑该候选的门禁；开发验收轮未推送、合并、部署或领取CA-009，后续授权集成另记如下。

交付`CaseJudgmentFact`、`CaseJudgmentVersion`、`CaseJudgmentReceipt`及Case当前判决指针；内部`POST /api/v1/cases/:id/judgment-register`、`judgment-correct`和律师`POST /api/v1/lawyer/cases/:id/judgment-register`，运营／律师详情共享表单、历史和精确文件下载。运营按Action及范围、律师按当前有效PRIMARY承办校验；更正只给独立权限的运营并必填原因。日期不早于正式立案、不晚于北京时间今天，两组金额分别已知／待定且不改原标的或发起支付。登记／更正均保持待判决，任何判决事实阻断开庭纠错及旧键重放；客户／公证处不增加判决事实、费用或文件投影。案锁、CAS、成功审计、精确冻结与幂等回执原子提交，旧回执不拼接后来当前值。

九份新前向迁移为`20261008020000_add_case_judgment_enums`、`20261008021000_add_case_judgment_facts`、`20261008022000_add_case_judgment_grants`、`20261008023000_allow_lawyer_judgment_actor_path`、`20261008024000_align_case_judgment_constraints`、`20261008025000_allow_judgment_version_reuse`、`20261008026000_repair_case_judgment_deployment`、`20261008027000_guard_case_judgment_references`、`20261008028000_guard_case_judgment_reference_inserts`。仅独立测试库public正常升级至91条；不改已执行SQL、成功账本或checksum。临时schema覆盖空链、上一支持82份升级及旧开庭事实、Grant同范围复制、真实Prisma部署11个失败前缀与前向补齐／严格对账／继续升级。240／250的部分DDL失败仍如实保留，不冒称其原子；260／270／280另验证自身事务回滚、重复执行及异常定义／重复数据拒绝。恢复约束见[实施计划](../../superpowers/plans/2026-10-08-case-judgment-registration.md)，不能将测试恢复入口用于不明结构或生产写入。

审查由非实现子Agent分阶段和全集成执行，最终候选`9092414`的SpecCompliance／CodeQuality均ACCEPTED，未关闭C／I／M为0；Task报告及审查为`.local/case-judgment/{task-1-report,task-1-review,task-2-report,final-review}.md`。**同模型隔离审查／独立性不足**；可确认审查为GPT模型家族，精确运行model ID未暴露，不冒称异模型外部审查。外部独立Review为**Pending（本轮未执行）**，与自动测试及工程门禁分别记录；没有证据称外部服务不可用或额度不足。非实现主体按项目当前路由完成本地审查，未复跑Worker相同通过测试；必要根TS检查确实发现I5后才修复。

| 固定候选正式检查                 | 实际结果                                                                                         | 命令包装耗时 |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| `pnpm verify`                    | 退出0；严格上下文／Spec／架构、类型／Lint／格式、工具74/74、后端1078/1078、前端706/706及双端构建 | 156.045秒    |
| `pnpm test:e2e:full --workers=1` | 退出0；未过滤全量隔离PostgreSQL／Chromium192/192，含新迁移、真实判决主链及既有跨模块回归         | 628.651秒    |

verify于UTC`2026-10-08T08:52:32.7212901Z`开始、`08:55:09.1700915Z`结束；E2E于`08:55:38.8893050Z`开始、`09:06:07.9412125Z`结束。两项前后commit／tree、干净工作区和环境一致，跨门禁fingerprint同为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`；不证明数据库内容相同。Node v24.21.0、pnpm11.27.0，数据库只用`backend/.env.test`的`dev_cor_test`／15433。测试schema／固定夹具受控清理，未知归属和异常守卫失败关闭；未重置开发／生产库、public schema或持久化卷，不输出凭据。

完整日志、真实退出／时长、候选／环境摘要为`.local/case-judgment/formal-attempt2-verify{.log,-result.json,-environment-before.json,-environment-after.json}`及`formal-attempt1-e2e`同组文件；HTML为`formal-attempt1-e2e-playwright-report/index.html`，机器结果为`formal-attempt1-e2e-test-results/.last-run.json`（status=passed、failedTests=[]）。本地原始证据被忽略，不随Git推送；本记录保留可定位候选、摘要和路径，不伪称远端CI产物。

新增真实PG用例覆盖登记／留原因更正、已知0／待定、精确文件历史、重放／异参、撤权和承办失效、企业／材料隔离、同案并发单胜、判决与开庭纠错互斥、事实／冻结／审计／回执失败整笔回滚及直接SQL守卫。额度反例证明冻结10份后可新上传并更正为9旧＋1新，单次选11份及未冻结池第11份仍拒绝，旧10份字节和审计引用保留。配额锁定顺序经审查，新增额度场景未强制调度并发，不将静态判断冒称该反例实测。清理故障反例的合成构造／拆除仅使用事务局部replica，不用于实际清理、业务Command或真实浏览器闭环，实际守卫与数据回滚、异企业sentinel另有证据。

本候选全量浏览器通过两条真实密码主链：正式角色页授权→运营上传10份判决书并登记→新上传、原因更正为9旧＋1新→两事实各10份历史保留→原件／新件精确下载→刷新／重登及成功反馈→承办律师可读脱敏更正历史；律师本人真实登记另一案，客户仍不获取判决事实／费用／附件，异企业拒绝。上游使用既有受控夹具及真实cookie／CSRF API办理正式立案、真实开庭安排并等待自动推进，不通过直接改库阶段或预置判决事实替代本次动作。

失败历史保留：正式verify启动2次，第1次同候选于格式阶段退出1（64.115秒，ignored `.superpowers/sdd/ca008-task-1-brief.md`不符合Prettier），只格式化该非执行Brief，代码／tree不变；原失败完整证据在`formal-attempt1-verify.*`，第2次才取得完整通过。全量E2E启动1次通过。开发期浏览器确认9次启动：初始6次中的权限前置、异步阶段／清理FK、nullable解码、历史原因断言、折叠下载定位失败后第6次通过；额度修复期1次嵌套定位失败及2次通过。早期共用工件被覆盖的不声称保留，正式成功HTML／机器结果已独立复制。审查原I1～I4及清理补丁、Final的累计额度／冲突草稿／提交上传／nullable类型与I5测试类型均已关闭；未知结果即使GET更新版本仍保留原key／body／expectedVersion，已知409不得静默重基。未删测试、弱化断言、增加重试或放宽超时；大chunk与pg弃用警告为非阻断。未取得实际token用量，提速效果未量化。

此后仅补`feature-roadmap.md`完成状态／受影响余量、`project-status.md`恢复摘要、本验证记录和对应`context-snapshot.json`。从实际候选到收口`dac6b1c`的累计diff及工作区已核对，只有这些非执行性状态与证据变化；模块Spec、计划、代码、测试、迁移、配置和环境未变。受影响格式、链接／指针一致性、Spec、严格上下文及Git差异专项退出0，结果保存`.local/case-judgment/closeout-doc-check.log`；原候选业务证据仍适用，不称收口HEAD实跑其门禁，不要求本记录包含自身提交哈希。开发验收轮Current为CA-008已完成待集成，CA-009仍Next未领取。后续上诉／执行须补更正阻断及阶段数据库守卫，退费、外部补录、生产部署和开发／生产迁移未交付。

### CA-008授权推送与快进集成（2026-10-08）

用户另行授权“推送合并”。只读context及strict均通过；获取远端后，本地main与origin/main均为`4bfeab7ae73a6c0b5455c39da326dba57d5ee4e7`，它是任务分支的祖先，无分叉或未提交变化。本地main快进至`dac6b1c823f9e96f8edc69266cbae6579c40b68a`，tree`71c500c5f62649333a3812a22f520f17f99a7c14`与原收口完全一致；原子推送main及任务分支后，`git ls-remote`确认两者均为该提交。没有形成未验证的业务组合。GitHub main的protected=false、rulesets为空，check-runs与Actions workflows均0；没有远端必需检查，不表述为服务器CI通过。

集成前重新采集实际环境，fingerprint与原完整E2E一致。从`9092414`至本次最终状态的累计提交／diff、暂存／未暂存和相关未跟踪项，仅涉及上述四份非执行性收口文件；原候选的完整verify及192/192结果继续适用，不将最终HEAD称为实跑旧候选门禁。当前Current为CA-008已完成已集成，Next仍CA-009未领取。集成状态补记的格式、Spec、严格上下文、Git差异及累计范围检查，保存`.local/case-judgment/integration-doc-check.log`，以真实退出0为提交／推送前提；不记录本段自身提交哈希。原同模型审查的独立性局限及外部异模型Review Pending不变，本轮不部署或操作开发／生产数据库。

## CORE-CA-007 开庭后推进及受控纠错（2026-10-08）

实际通过Level 3的业务候选为`b4fb37a30571895a5ff881b30c0d49ef06bfab07`、tree`d8f0480c28a61fd8ddb0d0783188763cbbda4f9e`；分支`codex/core-ca-007-hearing-followup`，main基线`6ca3786491e18c0b1253bdee0995df7d59bf06ae`。本轮未推送／合并或开发CA-008；后续状态收口HEAD不冒称实跑过该候选的业务门禁。

交付`CaseHearingArrangement`、`CaseHearingAdvance`、`CaseHearingCorrection`、`CaseHearingReceipt`及案件当前安排／推进指针；共享审计增加受限SYSTEM执行者而不放宽真人身份。六份新前向迁移为`20261008010000_add_case_hearing_enums`、`20261008011000_add_case_hearing_facts`、`20261008012000_add_case_hearing_grants`、`20261008013000_allow_lawyer_hearing_schedule_audit`、`20261008014000_bind_case_hearing_correction_audit`、`20261008015000_require_latest_case_hearing_chain`；仅部署独立测试库，旧已执行迁移不改。空链共82份、上一支持76份schema升级、合成旧事实、结构化管理Grant交集／零资格拒绝、失败原子与重试、直接SQL反例均有真实数据库证据。

正常内部／律师`hearing-schedule`和内部`hearing-correct`Command使用原授权／当前承办范围、同案锁、版本及幂等回执；安排、纠错、成功审计与回执原子持久化。真实过去日期不得早于正式立案；按北京时间开庭日次日零点自动推进，保存到期日或服务重启补跑前重查最新阶段／日期。重复扫描不重复推进或审计；自动执行者不伪作安排登记人。有权运营填写原因更正：未来／未定返回待开庭，已到期更正保持待判决；旧安排、推进及连续更正历史保留。当前PRIMARY律师只可正常安排，客户只读本企业原投影及新阶段，不泄露内部原因／身份。“待判决”不表示法院已经判决。真实判决事实及其纠错阻断由CA-008接入时补齐，本次不声称该后续保护已交付。

高风险Task及集成Final Review由独立`gpt-6-sol / high`主体完成，最终`SpecCompliance = ACCEPTED`、`CodeQuality = Approved`，未关闭C／I／M均0。后端Task、测试管理员夹具、详情同快照修复及最终补审报告分别为`.local/case-hearing/{task-1-review,admin-fixture-review,detail-snapshot-review,final-review}.md`；Final Review接受04a8f02及此前全部累计范围，b4fb37a只追加已核对的标准上下文记录。审查主体未重复Worker的相同通过测试。

| 固定候选正式检查                 | 实际结果                                                                                         | 命令包装耗时 |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ------------ |
| `pnpm verify`                    | 退出0；严格上下文／Spec／架构、类型／Lint／格式、工具74/74、后端1057/1057、前端684/684及双端构建 | 152.462秒    |
| `pnpm test:e2e:full --workers=1` | 退出0；未过滤全量隔离PostgreSQL／Chromium187/187，含新迁移及真实账号主链                         | 515.502秒    |

verify于UTC`2026-10-08T03:50:30.0917892Z`开始、`03:53:02.5534739Z`结束；E2E于`03:53:47.4007198Z`开始、`04:02:22.9025670Z`结束。前后HEAD／tree、干净工作区及环境指纹一致；Node v24.21.0、pnpm11.27.0，fingerprint为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`，不证明数据库内容相同。数据库只使用`backend/.env.test`对应的`dev_cor_test`／15433；迁移专项随机临时schema和既有固定A／B夹具受控清理，不重置公共schema、开发／生产库或持久化卷。完整输出、退出状态／时长和非秘密环境摘要为`.local/case-hearing/final-{verify,e2e}{.log,-result.json,-environment-before.json,-environment-after.json}`；HTML为`final-e2e-report/index.html`，机器结果为`final-e2e-test-results/.last-run.json`。

新真实数据库用例验证安排／推进／纠错、启动与双实例／并发单胜、旧安排失效、同键重放／异参冲突、撤权／企业与承办隔离、审计／事实／回执故障整笔回滚及当前事实链约束。详情一致性采用真实PG查询屏障先复现“旧阶段＋新历史”，RepeatableRead聚合后通过；仅装饰无关展示字段，不伪造开庭事实。真实密码浏览器经正式角色页授权→运营／律师办理→到期补跑→未来纠错返回待开庭→新安排再次推进→另一案已到期纠错保持待判决→客户仅看本企业阶段及异企业404→刷新／重登持久化通过。预期HTTP500／SQL约束异常属于已通过故障注入，不隐藏失败。

失败与复跑边界保留：正式verify共启动4次，首三次分别在7f1a598（33.258秒，未用导入Lint）、dc36840（51.621秒，六文件格式）及436bbc2（134.043秒，OpenAPI夹具漏CaseHearingService依赖）退出1，不算完整通过；修复后由原Reviewer确认，第4次才取得上述全套结果。失败原始证据为`formal-attempt{1,2,3}-verify.*`。完整E2E启动1次并通过。开发期单文件浏览器共14次，第8次揭示真实详情混合快照，其余具体失败／最终通过在`task-2-test-log.md`；6～14次原始记录仍保留，早期被覆盖产物不声称存在。终审曾发现代理5xx未知提交误判，经组件行为RED→GREEN14/14关闭：登记／纠错均保留原键和原body，GET不代替成功。未删测试、弱化断言、增重试或放宽超时；既有大chunk及pg弃用警告非阻断。未取得实际token用量，流程提速效果未量化。

此后只补本实际证据、路线图完成态、恢复摘要及对应已解释快照；模块Spec／计划不再重复维护“待门禁／已通过”台账。核对b4fb37a至拟收口状态的提交链、累计diff、暂存／未暂存及相关未跟踪项，范围仅`docs/feature-roadmap.md`、`docs/project-status.md`、本VALIDATION及对应快照，不改业务范围／契约／权限／状态转换／AC、代码、测试／输入、迁移、配置、生成物、依赖、验证逻辑或环境。受影响格式、Spec、严格上下文（含引用及Current／Next一致性）和Git差异专项结果保存`.local/case-hearing/closeout-doc-check.log`，通过才提交；原候选业务证据仍适用，不将收口HEAD称为完整实跑，不要求本记录写其自身提交哈希。CA-007已完成待集成，唯一Current仍007、Next008未领取；实际集成结果及远端检查仍须按新的明确授权核实。生产部署与开发／生产迁移未验证。

### CA-007推送与快进集成（2026-10-08）

按用户授权，分支`codex/core-ca-007-hearing-followup`及main均已推送，远端逐引用核实为`4bfeab7ae73a6c0b5455c39da326dba57d5ee4e7`；本地main由原`6ca3786`快进，无冲突或额外代码组合，集成tree为`d57f39bd5c4322b498144fb08e56b42d5185f8ad`。重新核对b4fb37a至4bfeab7的累计四文件差异及干净工作区，只有上文真实状态／证据及对应快照；业务代码、测试／输入、迁移、配置与环境未变。只读上下文、严格上下文、Spec、四文件格式及Git差异检查均退出0，当前环境指纹与上文验收相同。按既有非执行性收口／集成规则保留b4fb37a的完整业务结果，未重新启动verify或全量E2E，也不声称4bfeab7实跑旧候选门禁。

GitHub main无分支保护／适用规则，候选check-runs和commit-status数量均0；未配置托管CI，不将空检查集合或status的pending标为CI通过。不创建PR、发布或部署，开发／生产数据库未操作。核实集成后从更新main建立CA-008分支，任务领取不属于上述业务验收。

## CORE-CA-006 正式受理／登记正式立案（2026-10-06）

实际通过正式Level 2逐项门禁的业务候选为`d3836fcffa5a5d3e2e9af92d0943e407293f3e22`、tree`6e911e6a96029a5d83ca98f242c633a168a70da6`；分支`codex/core-ca-006-formal-acceptance`，main基线`7cd6525a77e04b52f5352c9702f2392e69b46ac0`。用户授权的此前待同步内容已推送并快进集成该main；本轮只实施CA-006，新业务代码未推送／合并，不开发CA-007。

有权运营或当前PRIMARY承办律师登记实际受理日期和法院案号，原子从`WAITING_FORMAL_ACCEPTANCE`进入`WAITING_HEARING`。复用当前身份、范围、事务、锁及材料能力；当前授权先于幂等重放，受理事实、精确冻结版本、成功审计、回执和阶段同事务提交。受理通知、缴费清单、送达文件均可选，可在待开庭补传但不改原冻结事实；客户只增加新阶段识别，不获取内部受理事实、案号、材料或Command。未知POST结果保留原请求／键，通过原样重放裁决，详情GET不冒充本次成功。

新增`CaseAcceptance`／`CaseAcceptanceVersion`／`CaseAcceptanceReceipt`，沿用`Case.courtCaseNo`；内部和律师`POST /api/v1/{cases,lawyer/cases}/:id/acceptance-register`成功返回201。正式运营／律师共享登记表单、详情记录、精确文件下载、待开庭列表和侧栏均已接通真实API。四份前向迁移为`20261006010000_add_case_acceptance_enums`、`20261006011000_add_case_acceptance_facts`、`20261006012000_add_case_acceptance_grants`、`20261006013000_seal_case_acceptance_versions`；未修改旧迁移，仅部署独立测试库。迁移专项覆盖76份空链、上一支持72份schema及75→76旧事实／回执保留、精确冻结封闭、直接SQL负向、每份失败原子及向前重试，不操作开发／生产数据库或持久化卷。

独立`gpt-6-sol / high`后端Task Review在5911bde接受；整合Final Review及d3836fc补审为`SpecCompliance = ACCEPTED`、`CodeQuality = Approved`，未关闭Critical／Important／Minor均0。报告在`.local/case-acceptance/{task-1-review,final-review}.md`；Task报告与开发期完整证据保留，不冒称Reviewer重复执行Worker检查。

| 固定候选正式检查                                             | 实际结果                              | 命令包装耗时   |
| ------------------------------------------------------------ | ------------------------------------- | -------------- |
| `pnpm prepare:prisma`                                        | 退出0；本轮统一生成一次               | 3.916秒        |
| 后端cases／materials／access-control／OpenAPI定向Jest        | 退出0；32套件394/394                  | 36.467秒       |
| 前端案件／客户投影／材料／权限目录／人员角色／壳层定向Vitest | 退出0；17文件213/213                  | 8.702秒        |
| `pnpm check:fast:prepared`                                   | 退出0；架构、双端／根类型和Lint       | 26.176秒       |
| `pnpm spec:check`／`pnpm context:check:strict`               | 分别退出0；Spec和严格快照／文档一致性 | 0.807／2.841秒 |
| 累计受影响文本Prettier                                       | 退出0；58项非空范围，含`.d.mts`       | 3.622秒        |
| `pnpm build:prepared`                                        | 退出0；前后端构建                     | 15.508秒       |
| 九文件隔离PostgreSQL／Chromium组合                           | 退出0；31/31，单worker、无重试        | 165.156秒      |

单元准确命令为`pnpm --filter @dev-cor/backend test src/modules/cases src/modules/materials src/access-control src/core-ld-openapi.spec.ts`与`pnpm --filter @dev-cor/frontend test src/api/cases.spec.ts src/api/client-cases.spec.ts src/api/materials.spec.ts src/api/organization.spec.ts src/modules/cases src/modules/client/ClientCasePages.spec.ts src/modules/organization src/app/AppShell.spec.ts`。数据库／浏览器命令为`pnpm test:e2e tests/e2e/case-acceptance.spec.ts tests/e2e/case-acceptance-database.spec.ts tests/e2e/case-acceptance-migration.spec.ts tests/e2e/case-lawyer.spec.ts tests/e2e/case-lawyer-database.spec.ts tests/e2e/case-filing.spec.ts tests/e2e/case-filing-database.spec.ts tests/e2e/personnel-access.spec.ts tests/e2e/role-template-management.spec.ts`。没有已配置case scope，按现行Level 2逐项执行，不伪称Evidence v2或完整`pnpm verify`／全仓E2E通过；未改变共享权限、身份、事务机制或历史含义，无Level 3升级依据。

正式检查于UTC`2026-10-06T09:12:23.7303283Z`开始；E2E于`09:14:25.1617877Z`开始、`09:17:10.3193255Z`结束。每项命令前后HEAD／tree、干净工作区及环境指纹一致；Node v24.21.0、pnpm11.27.0，fingerprint为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`，不证明数据库数据相同。完整日志、准确命令／退出状态／耗时机器结果及非秘密摘要保存于`.local/case-acceptance/final-{prepare,backend-unit,frontend-unit,fast,spec,context,format,build,e2e}{.log,-result.json,-environment-before.json,-environment-after.json}`；HTML为`final-e2e-report/index.html`。

31项包含CA-006真实数据库4项、迁移1项与真实密码浏览器主链1项，以及原法院提交、律师身份／办理和人员／角色目录兼容回归。运营登记→刷新／重登→精确文件字节下载，当前承办律师登记另一案件→待开庭后补→刷新下载且不推进，客户仅看本企业原允许投影均通过。错误阶段／日期／版本、同键重放／异参冲突、越权／跨企业／撤权、并发单胜，以及审计／事实／冻结／回执故障整笔回滚已验证；预期HTTP500和SQL23514／P0001为故障注入用例，不隐藏失败。冻结后不得追加新版本集合或改写新动作成功审计；既有其他审计含义不变。

失败轨迹保留：后端Task Review发现冻结集合可追加，新增第76份迁移封闭并取得SQL RED→GREEN；前端开发期刷新草稿、案号解码及浏览器测试接线问题均修复。首轮Final Review的0／1／2 finding（未知结果误判、计数漏更新、重复GET）由原Reviewer关闭，组件取得行为RED4失败／4通过→GREEN8/8。首个正式候选5c1da54的单元／Spec／格式／构建虽通过，`pnpm check:fast:prepared`因两处DOM类型`no-undef`退出1，不算整体验收；修复类型并补审后，d3836fc重新完成上述整套定向门禁。旧`formal-*`日志仍保留，不冒称它们属于新候选。本切片完整verify与未过滤full E2E均未启动；当前实际定向E2E正式启动1次并通过。原有大chunk、pg弃用警告为非阻断，未删测试、弱化断言、放宽超时或增加重试。

此后收口仅补本实际结果、路线图完成态、恢复摘要及对应已解释快照，模块Spec／计划不重复写动态验收台账。核对d3836fc到拟收口状态的提交链、累计diff、暂存／未暂存及相关未跟踪项；差异不含业务范围／契约／AC、代码、测试／输入、迁移、依赖、生成物、配置、验证逻辑或环境变化。受影响格式、Spec、严格上下文（含本地引用和Current／Next一致性）与Git差异专项结果保存`.local/case-acceptance/closeout-doc-check.log`，通过后方可提交。原候选业务证据仍适用，不称收口HEAD实跑其门禁，不要求本记录包含自身提交哈希；集成结果及远端必需检查仍须按授权核实。CA-006已完成待集成、CA-007仍Next，生产部署及开发／生产迁移未验证。

2026-10-06 CA-006集成事实：fetch后本地main与origin/main同为`7cd6525a77e04b52f5352c9702f2392e69b46ac0`，收口`6ca3786491e18c0b1253bdee0995df7d59bf06ae`、tree`f428289ad00ad37cf1c00161b1b21039b90e9b4c`已按用户授权推送任务分支、快进合入main并推送main；`git ls-remote`分别核实两远端分支均为6ca3786。集成tree与收口分支完全一致，没有其他代码组合；d3836fc至6ca3786累计diff逐字匹配已核对的`closeout.diff`，仅为上述四文件非执行性状态／证据／快照，环境指纹与实跑候选一致。合并前严格上下文、Spec、受影响格式及差异检查，合并后严格上下文均退出0；远端main无分支保护或适用rules，无托管CI配置，不声称服务器验收。原业务候选结果保留，不因快进／文档收口重复完整业务门禁；原始记录为`.local/case-acceptance/merge-{fetch,branch-protection,branch-rules,environment,preflight-doc-check,feature-push,main,main-context,main-push}.*`。随后从该main领取CA-007，只补实际集成事实与任务指针，不把CA-007设计视为实现或验收。

## 测试端口修复与集成前新候选复验（2026-10-06）

用户授权避开Windows保留的55426～55525，将独立测试库固定端口从55433改为15433；开发库55432、凭据、业务代码和迁移均未改变。Compose、setup默认、统一测试目标及律师迁移专项守卫已同步，保留127.0.0.1、测试用户／库名、无连接查询参数、固定镜像／健康容器校验，以及跨checkout共享应用端口的原E2E锁。仅打印非秘密摘要。

实际新候选为`c3d78c93cf3433dea960a7c5c0edcdc52904fcbc`、tree`f55de5aa077bcd70d3e03979d02a5bf3b2ff44b6`。独立`gpt-6-sol / high`审查累计`c5d85dc8..c3d78c9`及补审，ACCEPTED、未关闭Critical／Important／Minor均0；旧“当前环境不可用”的文档残留已明确为历史检查点。报告`.local/case-lawyer/test-port-review.md`；原03c4070业务高风险及Final Review保持其历史边界，本次不重复审查未变化的全部业务源码。

| 正式检查             | 实际结果                                                                                                 | 命令包装耗时 |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------ |
| `pnpm verify`        | 退出0；严格上下文／Spec／架构／Prisma／类型／Lint／格式，工具74/74、后端1021/1021、前端643/643及双端构建 | 269.672秒    |
| `pnpm test:e2e:full` | 退出0；真实隔离PostgreSQL／Chromium176/176，1 worker、无重试                                             | 532.715秒    |

verify于UTC`2026-10-06T05:15:36.0892241Z`开始、`05:20:05.7633042Z`结束；全量E2E于`05:20:14.1577380Z`开始、`05:29:06.8751615Z`结束。两项命令前后固定HEAD／tree、干净工作区及环境指纹均一致，fingerprint为`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`，不证明数据库内容相同。完整日志、机器结果和非秘密环境摘要为`.local/case-lawyer/c3d78c9-{verify,e2e-full}{.log,-result.json,-environment-before.json,-environment-after.json}`，HTML保留于`c3d78c9-e2e-full-report/index.html`。

本次完整verify及full E2E各启动1次并通过，触发原因是实际测试端口／配置／测试输入变化，不是补记完成状态。聚焦先RED后GREEN12/12和72份空库部署日志保留；旧数据升级、历史保留及失败重试的既有迁移证据不被端口调整改写。没有修改断言、超时、重试或覆盖。旧候选结果不冒称新候选通过；用量未取得，不声称提速百分比。

其后的收口只补真实结果、完成状态、证据引用及对应已解释快照。已核对从c3d78c9到拟收口状态的累计diff、暂存／未暂存和相关未跟踪项，不混入代码、测试／输入、配置、依赖、迁移、业务契约／AC或环境变化。文档专项结果保存在`.local/case-lawyer/test-port-closeout-doc-check.log`；通过后方可提交集成。不称收口HEAD实跑上述门禁，不要求本记录写入自身提交哈希；目标分支与组合tree仍须核实，未部署或操作开发／生产数据库。

2026-10-06集成事实：收口`1e111e138bbdfcd6fcecf5da57f1828a2db9cf21`、tree`866ac5c9af4550a08f06b97dbe6641d437b63c08`已按授权推送任务分支并从main基线`b28e0f35fa8de21f752145e43177b7defe450341`快进合入main，无新分叉或其他代码组合；`git ls-remote`核实两远端分支均为1e111e1。合并tree与收口分支一致，`c3d78c9..1e111e1`仅VALIDATION、路线图、恢复摘要及对应快照四文件，文档专项及合并后严格上下文均退出0；环境指纹与实跑候选一致，不因该文档收口重跑完整业务门禁。日志为`.local/case-lawyer/test-port-{feature-push,main-merge,main-context,main-push}.log`。随后仅补本集成事实与对应完成态；当前仍未实施CA-006，生产环境未操作。

## SD-44 律师身份与案件正常办理前置补齐（2026-10-06）

实际通过Level 3完整门禁的CA-005＋SD-44组合候选为`03c407013fb48efd6dfc72b7ae14e847abc32bb8`、tree`8e1f98e8b18d91200102c192b68d72549650de5c`，分支`codex/core-ca-005-court-filing`，main基线`b28e0f35fa8de21f752145e43177b7defe450341`。本轮补齐已确认的真实律师身份与已实现正常动作，不开发CA-006，不推送／合并／部署。

独立`LAWYER`复用真实账号密码及会话，不加入内部DepartmentMembership／Role；`LawyerAccountBinding`和`LawyerProfile.boundUserId`永久账号锚防止旧档案换人接管。新增内部部门级`LAWYER_ACCOUNT_MANAGE`，正式律师账号页面可建号、显式绑定历史未绑定档案、停用账号／绑定及重置密码；运营按用户名选择真实账号，后端按账号去重并稳定选择有效Profile，不按姓名认领旧案。律师工作台只读取本人当前PRIMARY承办案件，复用CA-002～005起诉材料提交、诉状确认、客户邮寄、提交立案；内部异常管理、跨案／跨部门、通用公证列表和内部费用仍不可见。法院与精确附件仅按本案必要投影提供，源公证书只下载案件已冻结版本。

主要接口为`/api/v1/lawyer-accounts`管理及历史档案候选、`/api/v1/cases/:id/lawyer-accounts`匹配候选、`/api/v1/lawyer/cases`本人列表／详情／四Command，复用现有CASE材料入口及窄公证书下载授权。前端交付律师账号管理、用户名匹配、独立律师导航／分页列表／详情和共享办理表单。每次读取、写入、上传终结、下载及幂等重放均重新校验当前身份／绑定／承办；前端迟到搜索、分页和Blob返回也不会覆盖或下载到已切换上下文。

五份前向迁移为`20261004020000_add_lawyer_identity_enums`、`20261004021000_add_lawyer_accounts_and_actor_paths`、`20261004022000_fix_lawyer_actor_case_variable`、`20261004023000_reject_lawyer_internal_membership`、`20261004024000_anchor_lawyer_profile_and_cleanup_drafts`；未修改已执行迁移，仅向`backend/.env.test`独立测试库部署，未reset或操作开发／生产库。Task 1专项在临时schema实跑72份空库链、上一支持67份真实旧案／PRIMARY／被告／审计／回执原样升级及当前正式CaseMatchService重放、71→72锚回填、第68～72份失败原子与向前重试、SQL越权及账号锚攻击负向。撤权后的过期草稿只允许既存行无内容变化的清理；证据验证真实SQL更新，不冒称完整`MaterialCleanupService.runOnce()`已执行。管理Serializable冲突映射409经14项单元及真实setStatus竞态验证，不冒称另外三个管理操作均跑过数据库竞态。

| 正式检查                         | 实际结果                                                                                             | 命令包装耗时 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ |
| `pnpm verify`                    | 退出0；上下文／Spec／架构／Prisma／类型／Lint／格式，工具73/73、后端1021/1021、前端643/643及双端构建 | 155.436秒    |
| `pnpm test:e2e:full`             | 退出0；隔离PostgreSQL／Chromium176/176，1 worker、无重试                                             | 463.865秒    |
| 独立高风险Task及Final Review补审 | ACCEPTED；未关闭Critical／Important／Minor均0                                                        | 未统一计时   |

完整verify于UTC`2026-10-05T18:30:18.0816586Z`开始、`18:32:53.5228437Z`结束；全量E2E于`18:35:14.6772252Z`开始、`18:42:58.5464604Z`结束。两项命令前后固定HEAD／tree、干净状态及环境指纹均一致，Node v24.21.0／pnpm11.27.0；非秘密fingerprint为`5eda1feed3489f2cf83c4228cd79afbc395b83c9d5ef9a96cc7c99b3e56130f1`，不证明数据库数据相同。完整日志在`.local/case-lawyer/03c4070-{verify,e2e-full}.log`，环境摘要为相应`*-environment-{before,after}.json`；HTML已独立保存至`03c4070-e2e-full-report/index.html`。完整运行摘要见`acceptance-gate-report.md`，Task 1迁移证据见`task-1-evidence.md`，Review轨迹见`task-1-review.md`与`final-review.md`。

176项包含新增律师数据库7项和真实浏览器主链：管理员真实登录建律师账号→运营真实用户名分派→律师密码登录→本人案件的四个正常动作及5类获准文件逐件字节核对→刷新／重登→停用下一请求拒绝，并回归既有认证、线索、公证与案件。企业／部门／本人隔离、撤权先于重放、异参同键、旧版本／错误阶段、运营与律师并发单胜、上传后解绑及审计／冻结／回执失败整笔回滚均通过；聚焦组件反例另证明第21项可达、搜索乱序和切案／切账号后的迟到下载中止，详见Task／修复报告。

初次Task Review的1项Critical／3项Important及Final Review的3项Important均已修复并由原独立主体关闭。本轮完整verify实际启动3次：`6f46d17`在50.776秒因共享表单Event/no-undef退出1，`19e5f3f`在23.157秒因旧测试调用私有setSelected API退出2；两次均未完成完整单测／构建，不能复用为通过证据。修复生产类型及测试接线后补审、定向复验，在03c4070第三次通过。未过滤全量E2E启动1次并通过；Worker聚焦失败轨迹另保留，未删除断言、放宽超时或增加重试。预期SQL23514/P0001／HTTP500属于通过的故障回滚测试；Vite大chunk、pg重叠query弃用及颜色环境警告为非阻断。Token用量未取得，效果尚未量化；本轮没有仅因完成态文档启动完整复验。

以上业务门禁只归属于03c4070及其tree。此后累计收口只补本实际验证摘要、路线图完成态、项目恢复摘要及对应已解释快照；不改业务Spec／计划、契约／权限／AC或代码、测试／输入、迁移、依赖、构建／运行配置、验证逻辑及环境。核对从该候选到收口工作区的全部提交链、累计diff、暂存／未暂存和相关未跟踪项，再标准记录快照；受影响格式、Spec、严格上下文（含本地文档引用／Current与Next一致性）及Git差异专项实际结果保存`.local/case-lawyer/closeout-doc-check.log`。原业务证据仍适用，不把收口HEAD写成实跑旧候选完整门禁，不要求记录包含自身提交哈希。CA-006／Next保持原指针；后续集成组合和远端必需检查照常执行。开发／生产迁移及生产发布未验证。

2026-10-06按授权启动集成：fetch后本地main与origin/main同为`b28e0f35fa8de21f752145e43177b7defe450341`，至收口`290b135edb13f12acd4c718d358b7b08a8a13bc2`可快进，无新代码组合；完整累计差异仍仅上述非执行性文档。当前严格上下文、Spec、受影响格式及diff检查退出0，日志`.local/case-lawyer/merge-preflight-doc-check.log`。分支已推送，`git ls-remote`核实任务分支为290b135，远端main仍为b28e0f35；日志`merge-feature-push.log`。远端main未启用分支保护，适用分支rules为空；没有`.github`目录，不声称托管CI通过。

当时的集成环境核对未完成：Docker最初未运行，后台启动后Server29.5.3可读；`pnpm db:test:up`因测试库55433端口绑定被拒绝而退出1，Windows动态保留55426～55525涵盖该端口，无55433监听进程。该检查点的统一指纹检查不能取得运行中的健康测试容器，不沿用旧结果声称条件已满足。当时未改Compose／端口／凭据／系统服务或门禁，不绕过保护，不重置数据库；未合并main、未领取CA-006，Current／Next保持原指针。原03c4070的业务结果仍为其实际候选历史证据，本环境失败不是业务测试复跑失败。

2026-10-06随后取得测试端口调整授权：Compose测试映射、setup默认、统一固定端口校验及律师迁移专项目标同步为15433；只改被忽略`backend/.env.test`的连接端口，逆向比较确认其余内容不变，根`.env`与开发库配置哈希不变，不记录秘密值。E2E保留旧锁键，确保旧／新checkout仍对共享应用端口互斥。回归先RED（新端口被旧守卫拒绝，7失败／2通过），再GREEN（工具两文件12/12，退出0）；旧55433及开发55432仍被固定测试目标校验拒绝。`pnpm setup:local`保留配置、`pnpm db:test:up`测试容器健康、`pnpm db:test:migrate:deploy`72份空库链成功，均退出0；完整日志为`.local/case-lawyer/test-port-{red,focused,db-up,migrate}.log`。配置／测试输入已变，必须完成新候选独立Review及完整verify／数据库浏览器复验；此段不预写通过或将03c4070证据套给新HEAD。

## CORE-CA-005 提交立案（2026-10-04）

实际通过正式Level 2逐项门禁的业务候选为`b33462401fa128742dc2b427c8375682454fe05e`、tree`ea684d26264c064022025617b5d11c7f08eecc43`，分支`codex/core-ca-005-court-filing`，main基线`b28e0f35fa8de21f752145e43177b7defe450341`。有权内部运营按现有Action／负责范围，选择或通过正式入口录入真实部门法院、填写提交日期、可选诉调号并上传精确证据版本，原子从`WAITING_FILING`推进至`WAITING_FORMAL_ACCEPTANCE`。不改已确认金额，不提前实现正式受理；客户新阶段可读，但内部提交事实及立案材料仍不可见。

新增法院列表／录入`GET／POST /api/v1/cases/:id/filing-courts`、提交`POST /api/v1/cases/:id/filing-submit`，两个POST成功码为201。新增cases所属`FilingCourt`、`CaseFilingSubmission`／`CaseFilingVersion`／`CaseFilingReceipt`，独立`case.filing.submit`及CASE材料`FILING_EVIDENCE`／`FILING_SCREENSHOT`。版本、当前账号／范围／阶段／法院／精确文件重新校验，提交事实、冻结引用、成功审计、回执与推进处于同一事务；撤权先于重放检查。运营真实表单、法院唯一选择自动完成／多选、必填提示、操作影响、已知错误／未知结果原请求原键重试与新阶段侧栏均已验证；未复制共享认证、范围或事务机制。

三份新增前向迁移为`20261004010000_add_case_filing_enums`、`20261004011000_add_case_filing_facts`、`20261004012000_add_case_filing_grants`。仅部署到`backend/.env.test`独立测试库，未改旧迁移、操作开发／生产库或重置持久化卷。迁移专项覆盖空库67份全链、上一支持64份schema旧事实／回执／Grant保留、每份失败原子与向前重试及SQL负向。数据库约束保护单行事实和引用，组合业务门槛由正式Command原子保证，不冒称SQL能独立覆盖全部不变量。

| 实际检查                                                     | 结果                              | 实测命令包装耗时 |
| ------------------------------------------------------------ | --------------------------------- | ---------------- |
| 后端cases／materials／access-control／OpenAPI定向Jest        | 退出0；25套件316/316              | 16.673秒         |
| 前端案件／客户投影／材料／权限目录／人员角色／壳层定向Vitest | 退出0；13文件161/161              | 9.247秒          |
| `pnpm check:fast:prepared`                                   | 退出0；架构、前后端／根类型和Lint | 24.288秒         |
| 累计受影响文本Prettier                                       | 退出0；非空范围，含`.d.mts`       | 3.613秒          |
| `pnpm build:prepared`                                        | 退出0；前后端构建                 | 14.177秒         |
| 七文件隔离PostgreSQL／Chromium组合                           | 退出0；27/27，单worker、无重试    | 105.160秒        |

准确命令、候选及原始日志位置见`.local/ca005/b334624-gate-report.md`与`b334624-{backend-unit,frontend-unit,check-fast,format,build,e2e}.log`。E2E实际命令为`pnpm test:e2e tests/e2e/case-filing-migration.spec.ts tests/e2e/case-filing-database.spec.ts tests/e2e/case-filing.spec.ts tests/e2e/cases.spec.ts tests/e2e/case-complaint-confirmation.spec.ts tests/e2e/case-complaint-mailing.spec.ts tests/e2e/case-complaint-mailing-database.spec.ts --output=.local/ca005/b334624-test-results`；HTML在`b334624-playwright-report/index.html`。真实账号浏览器证明正常来源链、法院录入、上传／提交、刷新／重登、冻结文件字节、同部门只读和客户不披露；数据库证明当前撤权、企业／部门隔离、异参同键、过期版本／错误阶段、并发单胜以及审计／事实／冻结／回执故障整笔回滚。组合同时回归既有匹配、诉状确认与客户／内部邮寄。

固定候选提交前针对相同文件内容的标准`context:record`、`context:check:strict`、`spec:check`及diff检查均退出0，日志`candidate-2-preflight.log`；此前只读检查仅报告已审组件一处漂移。Prisma生成与validate在f9候选退出0，此后仅Vue全局对象引用修复、生成输入不变，prepared门禁复用该生成物且保留全部类型覆盖。Node v24.21.0／pnpm11.27.0，每项正式命令前后可观察HEAD／tree与干净状态一致，环境fingerprint均`5eda1feed3489f2cf83c4228cd79afbc395b83c9d5ef9a96cc7c99b3e56130f1`；指纹不证明数据库内容不变。

独立Sol Task和Final Review及定向补审均ACCEPTED、未关闭C／I／M为0，报告`.local/ca005/task-1-review.md`与`final-review.md`。初始Swagger201、提交未知结果分类及正式首候选3处DOM对象lint错误均已修复并补验。f9正式首候选单测通过但静态门禁退出1，不是通过证据；只改组件对象引用、未放宽lint，聚焦8/8后原主体补审关闭，再固定b334执行上述门禁。开发期浏览器早期4轮失败与后续通过的原始日志／报告均保留，不冒充本轮正式结果；Task1 Command最初是编译失败而非行为RED，部分中间长输出仅留工具记录，不能声称全程test-first或所有中间日志落盘。

本Slice完整verify启动0次、未过滤全量E2E启动0次；正式七文件组合启动1次并通过。按现行Level 2规则，cases暂无正式scope，实际执行定向门禁，不伪称Evidence v2或全仓验收。Vite大chunk、既有pg重叠查询弃用及颜色环境警告为非阻断；故障注入预期500对应通过的回滚断言，未忽略失败或增加重试。Token用量未取得，效果尚未量化。

上述业务结果只归属于固定b334候选及其tree。此后累计收口仅补本验证摘要、路线图完成态／唯一Current与Next、项目恢复摘要及其已解释快照，不修改模块Spec、计划、业务契约／权限／AC或代码、迁移、测试、构建／运行配置／环境。核对从实际证据候选到收口工作区的完整提交链、累计diff、暂存／未暂存和相关未跟踪项，解释漂移后标准记录快照；现有受影响Prettier、Spec、严格上下文、引用／状态一致性和diff专项实际结果保存`.local/ca005/closeout-doc-check.log`。原业务证据仍适用，但不称收口HEAD实跑b334门禁，不要求本记录写入自身提交哈希。CA-005已验收、尚未推送／合并／发布；开发／生产迁移未执行，后续集成tree和远端必需检查仍按规则核对。

2026-10-04展示名称对齐：基于收口`4be62a7057d3db127d889988396c4487d1216b15`，表单／记录标题改为“提交立案／提交立案记录”，活跃Spec及排期使用Demo导航的“待正式立案／待申请执行”，修正CA-005标题及引用。只改展示文字和对应测试断言，不变更状态编码、接口、字段门槛、权限或流转，Current／Next不动。两项名称断言先出现预期行为RED，修正后案件表单／详情、侧栏与客户端4文件53/53及`pnpm check:fast`退出0；原始日志`.local/ca005/naming-{red,green,check-fast}.log`。本次按Level 1执行，不冒用纯文档收口例外；格式、Spec、链接／状态一致性及已解释快照专项见`naming-doc-check.log`。未重跑完整verify、数据库／浏览器或迁移，不把原b334业务结果称为本次修订HEAD实跑结果。

## CORE-CA-004 客户盖章邮寄（2026-10-03）

实际通过Level 3完整门禁的固定业务候选为`e30f708b3d95285ca085451090dc500f0192a899`、tree`9a4c850549a29a22b2336a261939560333334a9e`，分支`codex/core-ca-004-complaint-mailing`，基于已集成CA-003的`main@58e405665ea295890cc949c33854b525d902ba9f`。来源客户企业当前有效有权账号或覆盖目标案件的有权运营，登记真实邮寄日期与1～10份精确邮寄凭证版本，单案原子从`WAITING_COMPLAINT_STAMP`进入`WAITING_FILING`。客户真实密码登录后只见本企业允许案件、已确认诉状、冻结授权材料及邮寄凭证，不可读取内部费用／人员／未确认版本；同部门非办理人只读并可下载获准文件，公证处及跨企业／部门拒绝。

新增内部`POST /api/v1/cases/:id/complaint-mail`、客户`POST /api/v1/client/cases/:id/complaint-mail`以及最小客户案件列表／详情。复用现有Command、材料、事务、审计和会话，新增`case.complaint.mail`及客户固定能力；`expectedVersion`与`idempotencyKey`必传，当前身份／范围先于重放校验。锁与版本竞争、不可变`CaseComplaintMailing`／`CaseComplaintMailingVersion`、冻结引用、成功审计及`CaseComplaintMailingReceipt`同一事务提交；重复请求原结果、异参冲突、故障整笔回滚。客户绑定上传／审计身份仅在本动作的CASE路径开放，未授予内部DepartmentMembership或通用运营权限。共享邮寄面板用于客户与内部详情，真实上传／下载、核对影响、加载／成功／稳定错误和未知结果原请求重试均已验证；第五阶段侧栏、两种内部列表范围及计数一致。

四份新增前向迁移为`20261003010000_add_case_complaint_mailing_enums`、`20261003011000_add_case_complaint_mailing_facts`、`20261003012000_add_case_complaint_mailing_grants`、`20261003013000_add_case_client_mailing_actor_paths`，未修改已执行迁移。真实迁移专项覆盖空库64份全链、上一支持60份schema、旧事实／回执保留、约束及每份失败原子与修复重试。数据库和迁移仅使用`backend/.env.test`独立测试库；正常测试写入、清理及随机schema探针不等于环境不变，指纹也不证明数据库内容相同。开发／生产库与持久化卷未操作。

| 实际命令             | 结果                                                                       | 北京时间起止                          | 命令耗时  |
| -------------------- | -------------------------------------------------------------------------- | ------------------------------------- | --------- |
| `pnpm verify`        | 退出0；后端77套件980/980、前端58文件584/584、工具11文件73/73及双端构建通过 | 2026-10-03 23:09:20.293～23:12:45.064 | 204.771秒 |
| `pnpm test:e2e:full` | 退出0；隔离PostgreSQL／Chromium全量160/160，单worker、无重试               | 2026-10-03 23:13:18.031～23:20:28.503 | 430.472秒 |

完整verify包含严格上下文、Spec、架构、Prisma生成、类型、Lint和格式检查。Node v24.21.0、pnpm11.27.0；两命令前后HEAD／tree、干净状态及环境fingerprint`5eda1feed3489f2cf83c4228cd79afbc395b83c9d5ef9a96cc7c99b3e56130f1`一致。完整报告`.local/ca004/e30f708-gate-report.md`，原始日志`e30f708-verify.log`、`e30f708-e2e-full.log`和浏览器HTML／test-results副本`e30f708-e2e-full-report/`均在同目录保存。完整套件证明双身份真实登录、确认诉状→邮寄→待提交立案、刷新／重登与冻结凭证字节、当前撤权与企业隔离、幂等／旧版本／错误阶段、竞争及失败回滚。故障注入的预期500对应通过的断言，未忽略失败；既有Vite大chunk警告为非阻断建议。

Task 1、Final独立Sol Review及两轮历史helper补审均为`ACCEPTED`，未关闭Critical／Important／Minor均为0；报告`.local/ca004/task-1-review.md`、`final-review.md`、`migration-boundary-review.md`、`legacy-probe-review.md`。Final初审三项问题（第五阶段过滤、异步上下文／凭证快照／未知重试、邮寄前只读和邮寄后凭证字节证据）已由原主体补审关闭；最后两份状态／快照差异适用性在`e30f708`补记。补审只查修复delta，未冒充重新完整Review或重跑数据库。

保留失败和恢复轨迹：①`32f01cd`完整verify通过181.4秒，其全量E2E因CA-003历史探针错误而人为中断，约69.5秒，不当作自然完成结果；上下文／trace在`first-formal-e2e-failure/`。②`c2846bf`完整verify通过178.7秒，CA-003／004迁移定向2/2；经用户授权只清理死owner39172的单个失效锁。测试容器tmpfs重启后public为空，恢复遗漏README既有迁移步骤使一轮全量E2E7/160通过、153项初始化失败（221.021秒）；已查明并用受控`db:test:migrate:deploy`部署64份前向迁移，未reset，日志`c2846bf-public-migrate.log`。③恢复schema后的全量158/160（427.863秒）仅失败CORE-LD预期revision9实际11与NT-010旧57份终点假设；`a248231`仅修复两份历史helper的窗口，保留原授权、约束、计数与回滚断言，定向2/2后独立补审接受。此前CA-003／004窗口修复亦未改变断言或迁移SQL。各轮日志／HTML／context／trace分别保存于`.local/ca004/`，未覆盖或把旧候选结果冒称新候选通过。两项修复定向stdout未单独归档，其2/2为实施者交接；本次全量日志及HTML已独立证明两探针通过。

本Slice正式完整verify共启动3次，全量E2E共启动4次（含1次中断）；复跑分别由测试helper实质修复和测试schema准备失败触发，非纯完成态收口触发。每个有效候选按实际输入验证；没有删除测试、弱化断言或增加重试。Token用量未取得，效果尚未量化，不按耗时差宣称提速比例。

上述业务结果只归属于固定`e30f708`／tree`9a4c850`。此后累计收口差异仅为本验证摘要、`feature-roadmap.md`完成态／唯一Current与Next、`project-status.md`恢复摘要及对应已解释`context-snapshot.json`，不修改模块Spec、计划、业务范围／契约／权限／验收要求或代码、迁移、测试／构建输入和环境；原业务证据仍适用。核对从实际证据候选到收口工作区的完整累计差异、暂存／未暂存及相关未跟踪项，先解释全部漂移再标准记录快照，执行现有受影响Prettier、`spec:check`、`context:check:strict`与Git差异检查；真实专项退出结果保存在`.local/ca004/closeout-doc-check.log`，不称文档收口HEAD实跑上述完整门禁，也不要求记录自身提交哈希。目标分支变化、实际组合tree与远端必需检查仍按规则执行。CA-004在该收口时已完成但尚未推送／合并，后续集成事实见下段；未发布，不含法院提交、快递平台、完整客户门户或生产存储准入。

2026-10-03集成核对：先获取远端，`main`／`origin/main`均仍为`58e405665ea295890cc949c33854b525d902ba9f`，没有其他组合变更；任务分支推送后，本地main快进至CA-004收口提交`8bcd03e45dd53167b85cf0c1d6dd88880bf7549d`、tree`f12aa945b2793deef9b749ddfbfe9f07284ffe06`，与任务分支一致。随后推送main，`git ls-remote`首次核实远端main和任务分支均指向该收口提交。当前环境fingerprint与实际验收记录相同；相对业务候选`e30f708`的累计差异仍仅为三份状态／证据文档和对应快照，没有带入业务、测试、迁移或配置变化。因此复用上述完整verify和160/160业务证据，不声称集成HEAD重新实跑了它们。此后只补本段集成事实、路线图和恢复摘要及已解释快照，受影响Prettier、Spec、严格上下文与累计差异检查的实际结果保存于`.local/ca004/merge-doc-check.log`；最终远端提交核实保存在同目录的`merge-remote-check.log`，不要求本文写入自身所在提交哈希。未创建PR、发布或执行数据库操作，也未开始CA-005。

## CORE-CA-003 确认诉状（2026-10-02）

通过正式Level 2逐项门禁的固定业务候选为`6acdc65472c19971e672c5a815df799056dba6d5`、tree`bb8eb53af58c57757b0674c120386dd6775c71e6`，分支`codex/core-ca-003-complaint-confirmation`。范围是有权运营为单案确认精确诉状版本与金额，保留原提交事实并进入`WAITING_COMPLAINT_STAMP`。新增`POST /api/v1/cases/:id/complaint-confirm`、`CaseComplaintConfirmation`与`CaseComplaintConfirmationReceipt`；独立`case.complaint.confirm`授权、企业／部门隔离、当前撤权检查、版本幂等并发、冻结文件、成功审计与回执在同一事务边界内验证。三份独立前向迁移为`20261002020000_add_case_complaint_confirmation`、`20261002020500_add_case_complaint_confirmation_facts`、`20261002021000_add_case_complaint_confirmation_grants`，仅部署到独立测试库。空库60迁移、上一支持57份schema、旧列／回执保留、失败原子回滚与修复重试专项通过；上一schema合成旧提交／回执探针只证明DDL保留，不代表完整合法旧来源业务链；新的完整来源链由API／PostgreSQL验收。

固定候选逐项正式门禁均退出0：后端20套件278/278、前端6文件90/90，以及`prepare:prisma`、`check:fast:prepared`、`spec:check`、受影响Prettier（含`.d.mts`）、`context:check:strict`和`build:prepared`。PostgreSQL／Chromium四文件组合17/17，于2026-10-02 23:16退出0，命令总耗时55.57秒（Playwright 54.2秒）。Node v24.21.0、pnpm 11.27.0；测试环境fingerprint为`5eda1feed3489f2cf83c4228cd79afbc395b83c9d5ef9a96cc7c99b3e56130f1`。各实际命令及结果见`.local/logs/ca003-final-{prepare,backend-unit,frontend-unit,check-fast,spec,format,context,build,e2e}-6acdc65.log`首尾；浏览器报告保存在`.local/ca003/6acdc65-playwright-report/index.html`。Task 1与Final独立Sol Review均为`ACCEPTED`，C／I／M均为0，报告`.local/ca003/task-1-review.md`、`.local/ca003/final-review.md`。Final补审针对最新`f285450`；相对固定`6acdc65`的变化仅有已解释快照，不声称在`6acdc65`重新完整Review。

组合验收的实际命令为`pnpm test:e2e tests/e2e/case-complaint-confirmation-migration.spec.ts tests/e2e/case-complaint-confirmation-database.spec.ts tests/e2e/case-complaint-confirmation.spec.ts tests/e2e/cases.spec.ts`，由现有受控入口在隔离测试库串行执行。覆盖正常来源链、精确修订与变更说明、只读下载及跨身份隔离、撤权／转派后的同键拒绝、旧版本与错误状态、并发单胜、审计／事实／冻结／回执故障整笔回滚、迁移和刷新／重登。日志中故障注入的预期500属于通过的回滚断言，不作为隐藏失败；Vite大chunk提示为已知非阻断警告。

失败历史仅作诊断记录：`e24571a`首次静态检查发现4项lint错误，`101c149`机械修复；`afd63f5`组合17项中16项通过，失败因旧cases只读定位缺少标记，`f285450`恢复原条件标记并补充无写入／上传控件断言，未删除旧测试、权限或真实附件字节断言。失败报告保留于`.local/ca003/afd63f5-failed-playwright-report`及`.local/ca003/afd63f5-failed-test-results`。早期worker日志曾同名覆写，且误传参数导致前端全557项而非聚焦项；已披露，不将该阶段结果冒用为最终候选证据，独立RED／GREEN记录保留。

此前仅按明确授权重建独立测试库并执行迁移，旧测试行已删除；未触碰开发／生产库或持久化卷，不再执行reset。CA-004／Word跨工具兼容／生产Provider不属于本切片，本地验收不代表集成、生产准入或MVP上线。按Level 2处理；本Slice暂无正式scope，因此逐项记录正式门禁，不伪称Evidence v2，未运行完整`pnpm verify`或未过滤全量E2E（未修改共享认证／RBAC／scoped机制）。业务结果只归属于上述固定候选。其后的累计收口差异仅为`docs/feature-roadmap.md`完成态与唯一Current／Next、`docs/project-status.md`恢复摘要、本验证记录及对应解释快照；不改变契约、代码、迁移、测试／构建输入或环境，原业务证据仍适用，不把收口HEAD称作旧候选实跑结果，也不要求记录自身提交hash。收口检查使用现有受影响Prettier、`spec:check`、`context:check:strict`及累计Git差异核对；实际命令、退出状态和结果见`.local/logs/ca003-closeout-doc-check.log`。CA-003完成后曾按用户要求暂停后续切片；2026-10-03新授权解除该暂停并领取CA-004，此记录保留历史事实，不改写此前状态。

2026-10-03集成事实：固定CA-003收口提交完整hash`58e405665ea295890cc949c33854b525d902ba9f`及tree`9bb941e90703a22a73682ccf77f47b0511218857`与原收口一致；`main`、`origin/main`及任务远端分支均已核实指向该提交。相对固定业务候选`6acdc65`累计仅有4份状态证据快照变化。文档专项preflight与合并后`context:check:strict`均为0（preflight日志`.local/logs/ca003-merge-preflight-20261003-115858.log`）；保留原固定候选的17/17业务结果，不声称新集成tree重跑业务测试、完整`pnpm verify`或E2E。未发布，未执行开发／生产迁移。

## CORE-NT-010 公证事项合法批量归档（2026-10-02）

实际通过正式Level 2门禁的固定候选为`f5fb604435dae4bbb7847c934441c67d839b8c72`，tree`0a5672ba9027ab3a9e6272cf47987262885b1b1f`，分支`codex/core-nt-010-batch-return-archive`，基于已集成NT-009的`main@85b5bc5`；尚未推送／合并本切片。有权内部运营从正式列表选择1～50项`WAITING_RETURN`且已有`NO_ISSUE`决定的事项，分别确认退货／不退货／仅退款、实际金额或待定、适用收付方和原因，一次原子归档。复用既有`notary.return.archive`和逐项来源线索范围、当前身份、版本、费用不变量与审计；不预设假零、不付款、不改原费用，不将其他阶段终止视为归档。

新增正式`POST /api/v1/notary-matters/return-archive-batches`，强制逐项`expectedVersion`和请求`Idempotency-Key`；唯一ID规范排序后稳定加锁，单个Serializable事务内复用单项归档路径。每项不可变事实与成功审计、一次批次成功审计及`NotaryReturnArchiveBatchReceipt`同时写入，任一失败整批回滚。回执保存原结果，重放仍重查当前身份与每项授权；倒序等价请求原样重放，同键异参冲突。前向迁移`20261002010000_add_notary_return_archive_batch_receipt`只新增回执与唯一／FK／不可改删约束；仅在`backend/.env.test`独立测试库部署，未操作开发／生产数据库或持久化卷。

后端高风险Task独立Sol审查`ACCEPTED`；集成终审首轮在`8305880`指出未知结果后切换账号／部门／阶段会锁住面板（Important 1）。`8fb90a3`保留页面内原请求／键，原范围显式恢复，新范围不显示旧明细并可操作，迟到回调不假成功或清除新请求；新增4项先失败再通过的用例，原Reviewer补审关闭finding。`e7de29e`首次正式静态门禁因两份测试格式及未使用类型导入失败，未启动数据库E2E；`b8afe65`仅修正三处机械差异，补审确认不改事实／断言。最终未关闭Critical／Important／Minor均为0，报告`.local/nt010/task-1-review.md`、`.local/nt010/final-review.md`，失败与修复日志保留，不作为最终通过证据。

固定候选`f5fb604`各项检查退出0：后端Jest138/138（13套件）、前端API／组件及相关页面Vitest123/123（11文件），`pnpm prepare:prisma`、`pnpm check:fast:prepared`、`pnpm spec:check`、本切片累计受影响Prettier（含两份`.d.mts`声明）、`pnpm context:check:strict`及双端`pnpm build:prepared`全部通过。机器日志`.local/logs/nt010-final-{prepare,backend-unit,frontend-unit,check-fast,spec,format,format-types,context,build}-f5fb604.log`包含实际候选、命令与退出结果。门禁前后commit／tree、干净工作区和环境指纹均核对，指纹为`5eda1feed3489f2cf83c4228cd79afbc395b83c9d5ef9a96cc7c99b3e56130f1`，Node v24.21.0／pnpm11.27.0与环境锁一致。

同一候选的隔离PostgreSQL／Chromium串行组合13/13通过（命令耗时43.61秒）：`pnpm test:e2e:full tests/e2e/notary-return-archive-batch-migration.spec.ts tests/e2e/notary-return-archive-batch-database.spec.ts tests/e2e/notary-return-archive-batch.spec.ts tests/e2e/notary-list-preference.spec.ts tests/e2e/notary-list-export.spec.ts`。覆盖真实运营密码登录、正式API构造起点与真实开箱照片、不同事项费用事实、列表整批归档、客户密码登录后仅见本企业允许结论／无内部费用、刷新与重登、非法混选拒绝且数据库不变；越权／跨部门／外部身份、停用与撤权后重放、错误阶段、旧版本、退款上限、最大50项、同键／不同键／单项与批次并发单胜、审计及回执故障整笔回滚。迁移专项验证空库57份全链、上一56份schema旧归档／金额／单项回执保留、绕过DTO约束、真实Prisma失败原子性及解决后重试；列偏好／导出既有浏览器能力回归通过。原始日志`.local/logs/nt010-final-e2e-f5fb604.log`，保存浏览器报告`.local/nt010/f5fb604-batch-playwright-report/index.html`。

随后同一候选`pnpm test:e2e:full tests/e2e/core-leads.spec.ts --grep "return archive"`通过6/6（38.39秒），验证原单项归档身份与企业隔离、费用历史、幂等／版本、并发、真实账号刷新持久化及失败回滚；日志`.local/logs/nt010-final-single-e2e-f5fb604.log`，报告`.local/nt010/f5fb604-single-playwright-report/index.html`。本轮正式数据库／浏览器合计19/19；故障注入产生的预期500对应通过的回滚断言。历史开发期浏览器选择器／夹具／无序金额断言失败见`.local/nt010/task-2-report.md`与原日志，不冒充正式通过记录。

本切片使用而未改共享授权、隔离、事务或财务核心不变量，普通增量迁移保持Level 2；暂无NT-010正式scope，按现行规则在固定候选逐项门禁，不伪称Evidence v2，未运行完整`pnpm verify`或全仓E2E。上述结果只归属于`f5fb604`／tree`0a5672b`。此后累计差异仅为路线图完成态及唯一Current／Next、恢复摘要、本验证记录与对应已解释快照；无业务契约、代码、迁移、测试／构建输入或运行环境变化。收口执行受影响文档Prettier、`spec:check`、`context:check:strict`和Git累计差异检查，实际专项结果保存于`.local/logs/nt010-closeout-doc-check.log`；原业务证据保留，不将文档收口HEAD称为实跑上述门禁。目标分支变化、组合tree及远端必需检查仍按实际集成要求执行。未知请求恢复仅限当前挂载列表页的内存，界面明确离页／刷新会丢失该恢复入口；不宣称生产迁移、发布、其他阶段终止／撤销或CA-003已实现。

2026-10-02集成核对：本地`main`从`85b5bc5`快进至收口提交`862bc9c96342532d7cec06dfb00291f9b279c107`、tree`ce735b7e743a1eef7b41f1fa612946e64e5ea38d`，与NT-010任务分支一致，未带入其他组合代码。远端`main`与任务分支已核实均为该提交；测试环境指纹未变。合并态严格上下文、Spec、受影响文档Prettier及累计Git差异检查通过，保留`f5fb604`的业务证据，不冒称合并HEAD实跑旧门禁。随后只补本段集成事实、路线图与恢复摘要及对应快照，专项检查日志为`.local/logs/nt010-merge-doc-check.log`。未执行发布或开发／生产迁移。

## CORE-NT-009 公证事项办理清单导出（2026-09-30）

实际通过正式Level 2门禁的固定候选为`c3038582e9f1678d9d58ee1072bc886fa2e43874`，tree`4fbfb1cda8328f43513cde5c0fb0ff4b19bc5c6e`，分支`codex/core-nt-009-list-export`，基于`main@346d531`；尚未推送或合并。内部有效账号通过真实页面跨页勾选事项或明确选择当前阶段，后端预览数量后下载最多1000条、固定五列的CSV。新增`notary.list.export` Action与`lead.read`实时范围取交集，客户／公证处拒绝；选中未知或越权ID整批拒绝，预览到下载数量变化409。CSV防公式注入、审计成功提交后才返回文件；个人列偏好不改变导出字段或可见范围。不包含附件打包、内部费用、详细取证表或批量归档。

前向迁移`20260930030000_add_notary_list_export_action`与`20260930031000_add_notary_list_export_admin_grants`分别提交枚举与既有部门角色管理员Grant；实际变化模板增版、活跃受影响账号授权修订号递增，普通读取角色不自动获权。仅`backend/.env.test`独立测试库部署本切片迁移；随机临时schema验证56份空库全链、上一支持schema旧数据保留、精确补权／修订号、真实Prisma部署失败原子回滚及解决后重试。未改已执行迁移或重置开发／生产库、持久化卷。

高风险后端Task独立Sol审查及集成Final Review、各次修复补审均已关闭finding，最终候选结论`ACCEPTED`，未关闭Critical／Important／Minor为0。审查记录在`.local/nt009/task-1-review.md`与`.local/nt009/final-review.md`；开发期发现大小写等价UUID重复校验与切换范围时待处理预览未取消，均保留RED并修复。正式候选`bb092b4`曾因5项Lint失败；`44b8175`正式E2E为4/6，不是通过证据。后者两项失败分别为枚举目录查询未限定schema、旧列偏好E2E精确表头遗漏固定“选择”列；仅限定随机schema且保留exact-one、补齐五处精确表头，未弱化断言或改迁移SQL。原失败日志与定向修复记录保留在`.local/logs/nt009-*`、`.local/nt009/probe-fix-report.md`；后者明确为工具输出转录，不冒充原始机器日志。

固定候选各项检查退出0：后端聚焦Jest150/150（11套件）、前端API／列表及人员角色兼容Vitest94/94（7文件），`pnpm check:fast`、`pnpm spec:check`、受影响Prettier、`pnpm context:check:strict`及双端`pnpm build:prepared`通过。原始日志为`.local/logs/nt009-final-{backend-unit,frontend-unit,check-fast,docs-format,build}-c303858.log`，包含实际命令、固定commit／tree与退出状态。环境指纹在门禁前后均为`5eda1feed3489f2cf83c4228cd79afbc395b83c9d5ef9a96cc7c99b3e56130f1`；Node v24.21.0／pnpm 11.27.0与环境锁一致。

同一候选的隔离PostgreSQL／Chromium串行组合6/6通过（39.2秒）：真实密码登录、跨页选择／阶段导出及CSV字节、公式转义、成功审计与实际行匹配、SELF／TEAM／部门范围和跨部门拒绝、外部账号／无Grant／撤权／停用下一请求、伪造ID、空／超限／数量变化、审计失败无文件且无成功审计；真实1001条授权事项边界；新迁移全链／升级／失败重试；列偏好刷新／重登／换浏览器与账号隔离；既有公证移交并发、审计／回执回滚和旧迁移回归。命令为`pnpm test:e2e:full tests/e2e/notary-list-export.spec.ts tests/e2e/notary-list-export-migration.spec.ts tests/e2e/notary-list-preference.spec.ts tests/e2e/core-leads.spec.ts --grep "real operator selects across pages|real authorized filtered scope above 1000|notary list export migrations|personal notary columns|notary handoff serializes|core lead migrations"`；原始日志`.local/logs/nt009-final-e2e-c303858.log`，浏览器报告`playwright-report/index.html`。故障注入产生的预期500对应通过的回滚断言；Vite大chunk、既有pg弃用及jsdom导航提示不是门禁失败。

本切片复用既有授权／范围／事务基础设施及普通非破坏增量迁移，按已核定Level 2执行；没有NT-009 scope，不冒称Evidence v2，也未运行完整`pnpm verify`或未过滤全量E2E。上述业务结果只归属于`c303858`及其tree。此后的累计收口仅补路线图完成态与唯一Current／Next、项目恢复摘要、本证据引用及对应已解释快照；不改变业务契约、权限、AC、代码、迁移、测试输入、依赖、构建／运行配置、验证逻辑或环境。受影响文档格式、Spec、严格上下文及累计Git差异专项结果记录于`.local/logs/nt009-closeout-doc-check.log`；原业务证据不标成收口HEAD实跑结果。集成结果变化或远端必需检查仍按现行规则执行；开发／生产库迁移尚未执行，未发布，未验证Excel等第三方软件的CSV导入兼容性。

2026-10-02按授权集成：fetch后本地main与origin/main同为`346d531`，工作区干净且上下文无漂移。推送NT-009分支后main快进至收口提交`d54fb2c7a876661941aee2c88e5fff29064f8379`，tree`5ad689a676a4c053e99449a693d929fddf969cce`与原分支一致；远端main与任务分支均已核实包含该提交。集成前相关后端13/13、前端26/26及严格上下文、Spec、受影响文档格式和累计diff检查退出0，日志为`.local/logs/nt009-merge-{backend,frontend,doc-check}-d54fb2c.log`；合并态严格上下文亦退出0，见`nt009-merge-post-context.log`。相对业务候选仅有已核对的非执行性收口，无新组合代码；保留原候选6项数据库证据，不称合并tree实跑完整verify或旧E2E。后续仅补本集成事实、恢复摘要及对应快照，文档专项结果保存于`.local/logs/nt009-merge-main-doc-check.log`。未部署或执行开发／生产迁移。

## CORE-NT-008 公证事项列表列设置（2026-09-30）

实际通过正式Level 2门禁的固定候选为`6d2c884de27abb457c8694124110b6423d114843`，tree`bab0f0a2b81ab1e699df3e0ebdbd5a4c758e9c06`，分支`codex/core-nt-008-list-columns`，基于`main@4d362dd`；后续集成边界见本节末段。内部有效账号通过正式页面调整本人列显示与顺序，`GET`／`PUT /api/v1/notary-matters/list-preference`只按Actor保存本人偏好，实时复用`lead.read`。编号／详情及阶段固定可见，其余三列可隐藏换序；严格请求和响应、历史键容错、刷新／重登／换浏览器恢复及恢复默认均已实现。不扩展事项读取投影，不包含导出、批量归档或新的业务字段。

增量模型`NotaryListPreference`由leads主责，以账号主键／Restrict外键保存列顺序、隐藏列和更新时间；前向迁移`20260930020000_add_notary_list_preference`在独立测试库随机schema验证54份空库迁移链、上一schema旧账号保留、外键／Restrict拒绝及真实Prisma部署故障与重试。独审发现原故障探针额外包事务，真实部署复现失败残表，修订尚未交付的本切片迁移草稿为显式事务后，部署失败无残表、失败账本未完成，`resolve --rolled-back`、排除故障并重试成功且保留旧账号；PG注入点42809和CLI的transaction-aborted分开断言。该草稿仅曾部署独立测试库：核对`dev_cor_test`、偏好表0行及唯一已完成目标账本旧hash精确匹配后，事务CAS只更新该条checksum，status／deploy通过，不重置或删除测试schema／旧数据，不操作开发库、生产库或持久化卷。脱敏证据位于`.local/logs/nt008-backend-migration-prisma-repair-probe.log`和`nt008-backend-migration-test-ledger-cas.log`。

后端Task及补审、集成Final Review均为独立Sol主体`ACCEPTED`，未关闭Critical／Important／Minor均为0。真实浏览器开发验收曾暴露静态偏好GET被先注册的`:id`详情路由截获，修复正式模块顺序并补读取该模块元数据的HTTP回归，RED 400到GREEN 3/3；另外修正测试选择器、使用旧dist及第二账号空范围却期望表格的测试问题，失败日志／trace保留在`.local/logs/nt008-task2-e2e-*fail*`，不记作通过。固定候选已重新构建，不使用旧产物。

固定候选正式检查均退出0：后端聚焦Jest46/46、前端API／组件Vitest25/25，`pnpm check:fast`（架构58模型、前后端及根类型、ESLint）、`spec:check`、受影响Prettier、严格上下文和双端`build:prepared`通过。完整日志为`.local/logs/nt008-final-{backend-unit,frontend-unit,check-fast,docs-format,build}-6d2c884.log`。同一候选以现有`test:e2e:full`入口显式选择三文件及名称过滤，在隔离PostgreSQL／Chromium串行3/3通过（22.2秒）：新设置真实密码登录／保存／刷新／重登／第二浏览器及第二账号独立设置，非法键／主体ID400、外部客户403、撤权下一请求403；迁移真实失败回滚／重试；既有移交并发、失败回滚及列表／阶段范围回归。命令为`pnpm test:e2e:full tests/e2e/notary-list-preference.spec.ts tests/e2e/notary-list-preference-migration.spec.ts tests/e2e/core-leads.spec.ts --grep "personal notary columns|notary list preference migration|notary handoff serializes"`，日志`.local/logs/nt008-final-e2e-6d2c884.log`，报告`playwright-report/index.html`。故障注入的预期500对应通过的回滚断言；Vite大chunk及既有pg客户端弃用提示不是门禁失败。

本切片是复用既有授权的普通偏好与非破坏增量迁移，按Level 2处理；未配置NT-008 scope，未冒称Evidence v2，也未运行完整`pnpm verify`或未过滤全量E2E。上述结果只归属于`6d2c884`／tree`bab0f0a`。此后累计收口差异只补路线图完成态与唯一Current／Next、恢复摘要、本验证记录及对应已解释快照；无业务契约、代码、迁移、测试输入、配置或环境变化。受影响文档格式、Spec、严格上下文及累计Git差异检查通过，保留原候选业务证据，不把收口HEAD称为重新实跑业务门禁。集成结果变化或远端必需检查仍按现行规则执行；未发布，开发／生产库迁移尚未执行。

2026-09-30按授权集成：获取远端后确认`main`与`origin/main`同为`4d362dd`，功能分支推送后本地`main`快进至`a650f3103fad6f47947f6b8f1b3d17401fd87cc3`，tree`457480880c516dbbf7c01c451d8b2051193dff27`与合并前分支完全相同，未引入其他变化。合并前重新执行原四文件后端46/46及两文件前端25/25，均退出0，日志为`.local/logs/nt008-merge-{backend-unit,frontend-unit}-a650f31.log`。从实际业务候选到该tree及本轮工作区的累计diff均仅为上述四份非执行性收口文件，后续只补集成状态、证据引用及其快照；按现行例外保留原业务／数据库证据，不重复完整`verify`或E2E，不称最终HEAD实跑了旧候选门禁。文档专项使用现有Prettier、`spec:check`、`context:check:strict`及累计Git差异检查，实际结果保存在`.local/logs/nt008-merge-doc-check.log`；不要求记录自身提交哈希。未部署或执行开发／生产迁移。

## CORE-CA-002 起诉材料（2026-09-30）

实际通过完整业务门禁的固定候选为`cf7537263fce26f9e16f182b9aa8ce150581d0ee`，tree`2735244a09fa210c39d1c79537c1d65ec54e01d9`，分支`codex/core-ca-002-complaint-materials`，基于已集成的`main@1d41525`；本切片尚未推送或合并。有权内部人员在`WAITING_COMPLAINT`案件上传真实起诉状和授权文件，明确登记诉讼标的金额已知或待定，再以版本和幂等键确认提交；服务端重新校验账号、独立`case.complaint.submit`授权、案件范围、状态、附件所有权及内容版本，并在事务中冻结材料引用，原子进入`WAITING_COMPLAINT_CONFIRMATION`、写服务端提交事实、成功审计和幂等回执。读写仍按现有内部案件范围限制：同部门非负责人只读可下载获准附件，跨部门／客户／公证处不得读取内部案件；授权撤销下一请求生效。本切片不办理诉状确认、客户盖章邮寄或法院提交。

前向迁移`20260930010000_add_case_complaint_submission`扩展案件阶段、材料类别与所有者、提交权限、金额事实及回执约束，保留旧案件和既有成功回执。仅在`backend/.env.test`独立测试库部署；空库53份迁移链、上一支持schema升级与失败回滚专项均通过，未重置开发／生产库或持久化数据卷。真实DOCX的ZIP／XML结构与DOC的CFB／FIB结构由服务端验证；浏览器验收上传实际生成的PDF、DOC和DOCX字节，不用文件名或前端提示冒充内容验收。

高风险后端与迁移Task经独立Sol审查：首轮指出SQL NULL检查、DOCX XML及DOC OLE伪文件边界，修复后`ACCEPTED`。集成Final Review首轮指出非空案件列表的能力字段解码遗漏和可办理列表误标只读，补先失败再通过的前端测试及真实浏览器复验后补审`ACCEPTED`，未关闭Critical／Important／Minor均为0。完整E2E首轮126/127：既有旧线索迁移测试仍预期新增授权前的修订号7；测试辅助查询新增`case.complaint.submit` Grant精确计数、修订号改为8，原断言未放宽，独立补审通过，迁移聚焦E2E 1/1。此前一次`verify`因单份测试文件格式退出，纯格式修正后重新固定候选；失败尝试均不记作最终通过证据。

固定候选`pnpm verify`退出0：严格上下文、Spec、架构、Prisma生成、类型、ESLint、Prettier、工具73/73、后端Jest 891/891、前端Vitest 471/471及双端生产构建全部通过；本地完整输出为`.local/logs/ca002-verify-cf75372.log`。同一候选的`pnpm test:e2e:full`在隔离PostgreSQL／Chromium上127/127通过（3.8分钟），包含真实账号登录、案件匹配→上传→提交→刷新／重登、部门只读下载和跨部门隔离、撤权、旧版本／同键重放／异参冲突、并发单胜、审计与回执失败整笔回滚、空库及上一支持schema迁移；完整输出为`.local/logs/ca002-e2e-cf75372.log`，浏览器报告为`playwright-report/index.html`。故障注入的预期500对应通过的回滚断言。Vite大chunk提示非门禁失败。

上述业务结果只归属于固定候选`cf75372`／tree`2735244`。从该候选到本次收口状态的累计提交链、工作区与相关未跟踪文件已核对：仅有路线图完成态与唯一Current／Next、恢复摘要、本验证记录及对应已解释上下文快照；无业务契约、代码、迁移、测试／构建输入或运行环境变化。受影响文档Prettier、`spec:check`、`context:check:strict`及Git差异检查均退出0，原业务证据因此仍适用于固定代码候选；不把收口HEAD称为已实跑完整门禁。目标分支变化或远端必需检查仍按实际组合tree执行。生产对象存储和Word／LibreOffice产出文件的跨工具兼容性未在本切片验证，不宣称生产上线。

2026-09-30集成核对：从`main@1d41525`快进至收口提交`fb992a39f83481c10a6e956eaa17d19521d445ee`、tree`cda7b7868c2804def25c97c28070be2dee2878ec`，与任务分支完全一致，没有新增组合代码或冲突；远端`main`与CA-002任务分支均已核实包含该提交。合并态的`context:check:strict`、`spec:check`、受影响文档Prettier及累计Git差异检查均退出0。相对业务候选`cf75372`仅有已核对的非执行性收口，依现行规则保留该候选的完整业务证据；本轮没有重新运行完整`verify`或127项E2E，不冒称合并tree实跑旧结果。随后仅补集成事实、恢复摘要及对应上下文快照，继续执行文档专项检查；未部署或运行生产迁移。

## CORE-CA-001 匹配事实口径修正（2026-09-29）

实际通过业务验证的本地固定候选为`1279b1d62a79d00116ab93b8e642743fe5ee196d`，tree`4c8952b03bdfa24bdafa3ab0e6046abb06f22bf5`，仍在`codex/core-ca-001-case-matching`，未推送或合并。此候选在已验收CA-001上修正事实口径：主办律师姓名必填，律所／电话未知可留空；新匹配必须登记实际业务日期`matchedOn`（页面默认上海当天、可改真实过去日期），服务端`matchedAt`仍独立记录操作时间。前向迁移`20260929022000`新增可空`DATE`并放宽律所列，不猜测旧案日期。升级前已成功的旧回执可在当前授权仍有效时以原请求、原幂等键精确重放，返回日期`null`，不重复写入或审计；缺日期的新匹配仍被拒绝。

独立Sol审查首次发现旧回执重放会被新日期门槛阻断（Important 1），补聚焦单测与真实测试库／Chromium旧形态回执用例后复审`ACCEPTED`，未关闭Critical／Important／Minor均为0。仅`backend/.env.test`独立测试库执行前向迁移；同一固定候选的随机临时schema探针验证空库和上一支持schema升级、故障回滚、已有律所保留、未知律所可空及空白律所约束，均通过；未重置开发／生产库或持久化卷。

固定候选的`pnpm verify`退出0：严格上下文、Spec、架构、Prisma生成、类型、ESLint、Prettier、工具73/73、后端871/871、前端462/462及双端生产构建通过。`pnpm test:e2e:full`在隔离PostgreSQL／Chromium上124/124通过（约4.0分钟）；新增案件第6项覆盖旧案日期NULL、旧回执精确重放、同键补日期409、新键缺日期400及审计不重复，其余案件用例覆盖真实登录与刷新、部门只读附件、跨部门拒绝、版本／并发／幂等、撤权及故障回滚。故障注入日志中的预期500均对应通过的回滚断言。本地浏览器报告为`playwright-report/index.html`；Vite大chunk提示非门禁失败。旧候选`0f2a222`的123项结果仅属历史，不作为本候选的验证证据。

从上述固定候选到收口状态的累计diff经核对仅为路线图／恢复摘要、本证据引用、实施计划勾选及对应已解释的上下文快照；未改变业务契约、权限、状态转换、验收要求、代码、迁移、测试输入、构建、运行配置或验证逻辑。受影响文档Prettier、`spec:check`、`context:check:strict`及Git差异检查均通过。原业务结果只归属于上述固定候选，不冒称收口HEAD重新运行完整门禁；目标分支变化或远端必需检查仍按实际组合tree执行。

2026-09-29集成核对：本地`main`从`93d8bcb`快进至收口提交`b6d3489cae9c9a4c5241428610afed84742a7334`、tree`cdff60ca49966811f4c55fcb7b98ba818866d98c`，与任务分支完全一致，没有新增组合代码；`origin/main`与任务远端分支均已核实包含该提交。合并后的`main`执行`pnpm check:fast`、案件后端聚焦Jest 27/27、前端Vitest 13/13、`spec:check`及`context:check:strict`均退出0。该集成检查不冒称收口tree重新运行完整`verify`或全量E2E；业务完整证据仍绑定上文固定代码候选，收口差异已按非执行性文档例外核对。未部署或运行生产迁移。

## CORE-CA-001 案件匹配与承办（2026-09-29）

实际通过业务验证的本地固定候选为`0f2a22200a8e402a32931703f59966e582da31d9`，tree`7a38ffa8b0d74043de86e89f45373b10ced8a6d6`，分支`codex/core-ca-001-case-matching`，基于已推送的`main@93d8bcb`；未推送或合并本切片。单案由有效内部账号在当前`PENDING_MATCH`、版本及独立`case.match`授权下登记至少一名真实被告和一名主办律师，原子进入`WAITING_COMPLAINT`，写服务端匹配时间、成功审计和幂等回执。前向迁移`20260929020000`建模被告、律师承办、版本／阶段与回执，`20260929021000`纠正首份迁移的默认部门级补权，只保留有对应`lead.edit`范围或明确人工授予的匹配权限；已执行的首份迁移未改写。本部门`case.read`与写权限独立：非负责人可只读并下载获准公证书，客户／公证处不能进入内部案件，跨部门不可读；“我负责／本部门全部”和阶段计数由服务端同范围查询。本切片不含起诉材料、律师更换、客户案件门户或生产部署。

高风险后端／迁移Task经独立Sol审查；集成Final Review首轮为Critical 0／Important 2／Minor 3，发现幂等冲突码与前端不一致、匹配后侧栏计数未更新等问题。修复与新增先失败后通过的聚焦测试后，原Reviewer复审`ACCEPTED`，未关闭Critical／Important／Minor均为0。隔离`backend/.env.test`测试库仅部署两份前向迁移；随机临时schema探针覆盖空库完整迁移链、上一支持schema升级、错误Grant清理、保留手工Grant、失败回滚与重试。未重置开发／生产库或持久化卷。

固定候选`pnpm verify`退出0：严格上下文、Spec、架构、Prisma生成、类型、ESLint、Prettier、工具73/73、后端861/861、前端459/459及双端生产构建全部通过。同一候选的`pnpm test:e2e:full`在独立PostgreSQL／Chromium上123/123通过（约3.7分钟），其中新增案件5项覆盖真实线索→公证出证→建案→匹配→刷新、同部门只读附件与跨部门拒绝、旧版本／并发／幂等、撤权即时生效及审计／回执失败整笔回滚。本地报告为`playwright-report/index.html`。正式验证曾因旧NT-006迁移探针错误要求自身迁移永远处于仓库末尾而停止；修正为目标三条迁移存在且连续后复审通过。首次全量E2E为120/123，旧案件夹具把`CASE_READ`错误设为TEAM／SELF、旧全链迁移期望未包含CA-001授权修订；仅修正夹具与真实期望，三条定向用例和最终全量123/123均通过，旧失败不作为通过证据。

从固定代码候选到本次拟收口状态的累计Git差异、暂存／未暂存及相关未跟踪文件已核对：只涉及路线图完成态与唯一Current／Next、项目恢复摘要、本验证记录及对应已解释的上下文快照；没有业务契约、权限、状态转换、验收要求、代码、迁移、测试输入、构建／运行配置或验证逻辑变化。受影响文档Prettier、`spec:check`、`context:check:strict`及`git diff --check`专项检查通过，因此原完整业务证据仍适用于固定代码候选，不能称收口HEAD实跑过旧候选门禁。目标分支变化或远端要求组合tree检查时仍按集成规则执行。

## CORE-NT-006 不出证退货归档（2026-09-29）

实际通过完整业务门禁的固定代码候选为`3cba594efc18bb58b9148f60cb40e23c82785076`，tree`b33e63d84dc5c2de0db1eebab805f3f05276e40e`。本Slice仅允许当前有权且覆盖来源线索的运营，对原决定为`NO_ISSUE`、仍为`WAITING_RETURN`的单个公证事项一次提交退货选择、归档原因及退款／退货运费事实，原子进入`ARCHIVED`。三种选择为退货退款、不退货、仅退款；已知金额和待定严格区分，正金额明确收付方，累计退款不超过已知原样品支出。服务端校验版本、身份、范围和状态，保留不可变归档／费用事实、操作者与时间、成功审计及幂等回执；客户仅按来源企业读取归档结论与允许的冻结照片，不读取内部费用。本Slice不发起支付，不包含案件办理、费用结算、生产对象存储或上线。

模型／迁移、Command及客户读取的高风险Task均经独立Sol审查；集成Final Review首轮发现前端原生`maxlength`会截断Unicode输入及`OTHER`收付方名称长度校验问题，修复后由原Reviewer复审`ACCEPTED`，未关闭Critical／Important／Minor均为0。三份前向迁移在隔离测试库的随机临时schema通过空库完整49份迁移链、上一支持schema升级、注入失败回滚与重试、历史操作者和约束校验；只部署到`backend/.env.test`对应的独立测试库，未重置开发／生产库或持久化卷。

固定候选的完整`pnpm verify`退出0：严格上下文、Spec、架构、Prisma生成、类型、ESLint、Prettier、工具73/73、后端846/846、前端446/446及双端生产构建均通过；Vite仅有大chunk提示。同一候选的完整`pnpm test:e2e:full`在隔离PostgreSQL／Chromium上118/118通过（约3.4分钟），含三种退货选择、真实运营／客户账号登录、刷新／重登、冻结照片原字节、跨企业和无权拒绝、旧版本、同键重放／异参冲突、并发唯一胜者及四个故障注入点的整体回滚。本地浏览器报告为`playwright-report/index.html`。开发期曾因Spec索引、E2E类型、格式及既有公证登出后登录页加载竞态使较早候选失败；逐项修正并在上述同一固定候选完整复验，较早结果不作通过证据。

从该业务候选到完成态的累计差异仅为路线图完成状态与唯一Current／Next、项目恢复摘要、本验证摘要及对应已解释的上下文快照；未改变业务契约、权限、状态转换、验收要求、代码、迁移、测试输入、构建、运行配置或验证逻辑。收口专项核对受影响文档格式、`spec:check`、`context:check:strict`与Git累计差异；上述原始业务证据仅归属于固定候选`3cba594`，不冒称文档收口HEAD实跑完整门禁。

2026-09-29本地`main`集成核对：从`7432082`快进至完成态`a6ef5f16addd3d51b152e6b3009714d69c43e99e`，tree`cc6e5a7f1926480d3f4a2a9fe604a7d0128f21b0`与NT-006分支完全一致，没有新增组合代码。该tree重新运行完整`pnpm verify`退出0（工具73／73、后端846／846、前端446／446、双端构建）；在`backend/.env.test`隔离PostgreSQL／Chromium重新运行完整`pnpm test:e2e:full`退出0，118／118通过（3.6分钟）。本地浏览器报告为`playwright-report/index.html`；故障注入预期500均对应通过的回滚断言。后续仅补本集成验证摘要、恢复状态与已解释上下文快照，须按非执行性收口规则核对累计diff及文档专项检查；不把`a6ef5f1`的实跑结果冒称为后续文档提交实跑结果。目标分支变化或远端必需检查仍按集成规则处理。

## CORE-NT-005 公证处出证转案（2026-09-28）

实际通过完整业务门禁的固定代码候选为`debe747b1d95c9e25d1813d3c96118147eb506d7`，tree`ed6042a551f0e9082330dd52f6e3e307b9f8ffab`。本Slice由当前有效、明确绑定事项公证处的真实账号，对单个`WAITING_CERTIFICATE`事项登记一本真实公证书（编号、日期及至少一份PDF／JPEG／PNG文件）；来源线索要求披露时须另附真实披露材料。服务端同事务冻结附件版本、保留四类费用来源、归档事项、创建唯一来源的内部`PENDING_MATCH`案件、写成功审计和幂等回执。内部案件列表／详情可按部门案件读取权限查看，公证处和客户不得读取内部案件；法院案号未虚构。多本、更正、退货和案件匹配均未交付。

高风险模型／Command审查和集成后独立Sol Final Review通过；Final Review发现的材料50MB／10项与双端披露标记问题已修复并复审，未关闭Critical／Important／Minor均为0。全量E2E首轮72/113通过，41项客户用例因共享测试部门的旧审核决定外键导致夹具清理失败；只修正隔离测试库夹具的依赖清理顺序，客户聚焦41/41通过，独立补审发现并移除两处超范围全库计数器清理，复审后Critical／Important／Minor均为0。固定候选`pnpm verify`退出0：工具73/73、后端803/803、前端440/440，以及上下文、Spec、架构、类型、Lint、格式和双端构建全部通过；Vite仅提示大chunk警告。

固定候选在`backend/.env.test`独立PostgreSQL／Chromium运行`pnpm test:e2e:full`为113/113通过，包含真实运营、公证处账号从出证选择到上传、归档、案件读取及刷新，企业／公证处隔离、撤权、旧版本、同键异参、并发单胜、审计／回执／建案失败整笔回滚，以及跨套件数据清理。测试报告位于本地`playwright-report/index.html`。测试库已通过第46份前向迁移；`core-nt-005-migration-probe.mjs`在随机临时schema分别通过空库迁移链、上一支持schema升级、约束检查与注入失败回滚。上述结果只归属固定候选，不表示生产存储、部署、退货或后续案件流程已完成。

从`debe747`到拟收口状态的累计差异经Git核对，仅有路线图完成态及唯一Current／Next、项目恢复摘要、本验证记录和对应已解释的上下文快照；无业务契约、权限、状态转换、验收要求、代码、测试输入、构建、运行配置或验证逻辑变更。最终收口态的受影响文档Prettier、`spec:check`、`context:check:strict`及`git diff --check`通过；原完整业务证据仅绑定`debe747`代码候选，不冒称收口HEAD实跑。目标分支变化或远端必需检查仍按集成规则执行。

2026-09-29集成核对：本地`main`从`86de860`快进至完成态`403653be054db9f3e3b24cddf73668fe9ff1abe4`，tree`3f0d5113c5a92aea8d9b35c7c658430daefabd18`与已收口分支完全一致，没有产生新的组合代码。该tree新运行`pnpm verify`退出0（工具73、后端803、前端440及双端构建）；远端`main`与NT-005分支均确认包含`403653b`。数据库／Chromium 113/113仍归属上述固定业务候选`debe747`，中间累计差异只为非执行性收口文档及已核对快照；后续集成状态回写继续按文档专项检查，不将旧结果冒称为新HEAD实跑。

## CORE-NT-004 运营出证选择（2026-09-28）

实际通过Level 2业务切片门禁的固定代码候选为`7882a9e61013266961f29e3e27bf94b8c7e1ee7b`，tree`d6c1c76e04ff8ac7c85302d0208eb5b6dacd35cb`。仅允许当前有效、具备`notary.issuance.decide`且覆盖来源线索的内部运营账号，对开箱审核已确认侵权的单事项选择`ISSUE`或`NO_ISSUE`，分别进入`WAITING_CERTIFICATE`或`WAITING_RETURN`；决定、版本、成功审计和幂等回执同事务持久化。运营页面提供两种选择及影响提示；客户仅按绑定企业查看允许的历史摘要。此证据不表示已实际出证、退货、转案或归档。

独立Sol高风险Task审查通过；集成Final Review首轮发现只读运营详情解码过严和跨事项同键并发冲突码错误（Critical 0／Important 2／Minor 0），修复及真实数据库反例补测后由原Reviewer复核`ACCEPTED`，未关闭Critical／Important／Minor均为0。固定候选的后端全套Jest 776/776、前端全套Vitest 418/418、`pnpm check:fast`、`pnpm format:check`、`pnpm spec:check`及`pnpm build:prepared`退出0。曾因旧OpenAPI阶段数组和新增E2E helper类型声明未同步导致开发期检查失败，分别修正后在固定候选重取相应通过结果；未删除测试、放宽断言或忽略失败。本切片按风险规则为Level 2，没有运行也不宣称完整`pnpm verify`通过。

独立`backend/.env.test` PostgreSQL 17.11从空库部署45份前向迁移；`core-nt-004-migration-probe.mjs`在随机临时schema通过完整空库链与上一支持schema升级，并验证约束和失败回滚。固定候选的`pnpm test:e2e:core-ld`在隔离PostgreSQL／Chromium为50/50通过，包含运营两种选择、刷新／重新登录后的持久化、客户最小只读摘要、企业隔离、同事项并发单胜、跨事项同键异参冲突，以及审计／回执故障注入后的整笔回滚和同键重试。故障注入出现的预期500由测试断言核对；本地浏览器报告位于`playwright-report/index.html`。全仓完整E2E未运行，本轮使用受影响的公证／线索50项套件作为Level 2浏览器门禁。

从固定代码候选到完成态的累计差异经Git状态与diff核对，仅为路线图完成状态和唯一Current／Next、项目恢复摘要、本验证记录、开发计划实施勾选及对应已解释的上下文快照；不改变业务契约、权限、状态转换、验收要求、代码、测试输入、构建或运行配置。受影响文档Prettier和`spec:check`通过；原业务结果只归属于`7882a9e`，不冒称收口HEAD实跑，目标分支变化或远端必需检查仍按集成规则处理。

## CORE-NT-007 公证处身份与开箱入口（2026-09-28）

实际通过完整业务门禁的固定代码候选为`84380cf80d80822f1afe857a2d71967eb55fe244`，tree`bf3a80d86a5116a249f2f54162d8ba71a459eecb`。本Slice以真实`NOTARY`密码账号固定绑定单一公证处，不建立内部部门成员或角色；管理员可正式创建、停用账号。公证处只能读取本公证处待开箱事项的最小事实和本人待提交照片，勾选照片后复用NT-002开箱Command，将单事项`WAITING_UNBOX → UNBOX_REVIEW`；提交后仅可读取冻结照片。运营原入口保留，出证、退货、转案及完整公证门户未纳入本Slice。

账号／迁移与开箱／材料高风险Task分别经独立Sol审查；集成Final Review首轮发现误传照片不可排除、隔离测试库迁移草稿账本不一致和公证端OpenAPI响应模型遗漏（Critical 0／Important 2／Minor 1）。照片勾选、最小响应DTO及契约测试已补齐，原Reviewer聚焦复审`ACCEPTED`，未关闭Critical／Important／Minor均为0。迁移专项使用`backend/.env.test`隔离库的随机临时schema，通过44份空库迁移链、上一支持schema的四类历史操作者回填、注入失败的事务回滚与重试、绑定／双操作者约束及既有开箱事实不可变性。早期未合并迁移草稿曾部署到独立测试库；确认目标为`dev_cor_test.public`、无其他活跃会话后，仅重建该测试schema并以修订后的44份迁移重新部署，账本校验和与当前SQL一致。移除的是可重建测试夹具和旧测试账本，不涉及开发／生产库或持久化卷。

固定候选的完整`pnpm verify`退出0：严格上下文、Spec、架构、Prisma生成、类型、ESLint、Prettier、工具73/73、后端759/759、前端413/413及双端生产构建均通过。同一候选在独立PostgreSQL／Chromium上的完整`pnpm test:e2e:full`为106/106通过（约2.7分钟），含管理员浏览器建号→公证处真实登录→精确事项隔离→上传两张照片并排除误传→开箱提交→刷新／重登读取冻结照片原字节→停用后失效；数据库用例还验证异公证处附件字节拒绝、绑定撤销即时失效、同键重放／异参冲突、旧版本、运营／公证处并发唯一胜者、上传与开箱同事项行锁、审计失败整体回滚。故障注入产生的预期500日志对应测试通过。本地浏览器报告位于`playwright-report/index.html`；此证据不表示生产发布或后续NT-004～006已完成。

从上述固定代码候选到完成态的累计差异仅为路线图的NT-007完成状态与唯一Current／Next、项目恢复摘要、本验证摘要及对应已解释的上下文快照；未改业务契约、权限、状态转换、验收要求、代码、迁移、测试输入、构建或运行配置。收口专项核对受影响文档格式、`spec:check`、`context:check:strict`和Git累计差异；原业务结果只归属于`84380cf`，不冒称文档收口HEAD重新运行完整门禁。目标分支变化或远端必需检查仍按集成规则核对。

## CORE-NT-003 运营／客户开箱审核（2026-09-28）

实际通过完整业务门禁的固定代码候选为`56a0ed687dc148fa0a26cac21a2aa5aab6350f0d`，tree`9b775440dfa0cf5b136ecd5ec5b364361c46ac89`。本Slice仅允许有独立审核Grant且覆盖来源线索的运营，或当前有效绑定来源客户企业的客户账号，对单个`UNBOX_REVIEW`事项提交侵权／不侵权结论；不侵权必填原因。Command在真实数据库事务中重校验身份、企业范围、状态、版本及冻结照片内容，原子写不可变决定、服务端审核人／时间、成功审计与幂等回执；侵权进入`ISSUANCE_DECISION`，不侵权归档。双端正式页面、最小读取与精确冻结照片下载支持真实登录、刷新及撤权后的即时失效。前向迁移保留既有开箱历史并约束审核事实；不包含公证处账号／开箱入口、出证、退货或转案。

独立Sol终审首轮发现冻结照片仅计数校验、页面网络失败重试入口不充分及事项列表响应契约遗漏；修复与聚焦复审后结论为`ACCEPTED`，未关闭Critical／Important／Minor均为0。其后Node迁移专项文件命名与旧浏览器预期的测试修正均经同一独立审查主体补审接受，未改变业务授权或弱化断言。迁移专项`node --test scripts/notary-opening-review-migration.node-test.mjs`在隔离测试库对空库和上一支持Schema升级为2/2通过；聚焦测试覆盖伪造／不可用照片引用、企业隔离、撤权、同键重放、异参冲突、并发唯一胜者及决定／审计／回执失败整体回滚。

同一固定代码候选的完整`pnpm verify`退出0：严格上下文、Spec、架构、Prisma生成、类型、ESLint、Prettier、工具71/71、前端398/398、后端738/738及双端生产构建均通过。完整`pnpm test:e2e:full`在`backend/.env.test`对应的独立PostgreSQL 17.11／Chromium上102/102通过（2.4分钟），包括运营／客户真实账号登录、双端审核与历史、冻结照片原字节与企业隔离、刷新持久化、并发竞争及故障回滚。首次完整E2E的99/102失败来自三个与已确认阶段／照片授权不符的旧断言，修正后在本固定候选全量复跑，不沿用旧结果；故障注入产生的预期500日志所对应测试均通过。本证据只归属于上述固定代码候选，不表示生产发布或后续切片完成。

从该代码候选到完成态的累计差异仅为路线图完成状态与唯一Current／Next、项目恢复摘要、本验证摘要及对应的已解释上下文快照；未改业务契约、权限、状态转换、验收要求、代码、迁移、测试输入、构建或运行配置。收口专项的受影响文档Prettier、`spec:check`、`context:check:strict`及Git差异检查通过，原业务证据仍只归属于上述代码候选，不冒称收口HEAD实跑完整门禁；目标分支变化或远端必需检查仍按集成规则核对。

## 线索库／公证阶段导航归属修复（2026-09-24）

固定业务候选为 `codex/sidebar-business-ownership@6b2881211f140effa7ea6a1ce6de0707eb4e2cfd`，tree `30587c57f650e4470aa5fd196e7b4167aed90c04`，基于 `main@459b78e`。运营侧栏将未移交线索与公证事项分成两个工作队列；`view=LIBRARY` 在原 `lead.read` 范围内排除已移交来源线索，旧列表默认语义保留；新增事项列表、已实现阶段筛选、同范围计数和来源追溯。未修改 schema、授权 Action、移交／取证／开箱写路径，也未展示尚未实现的案件与公证节点。

该候选的 `pnpm check:fast`、`pnpm spec:check`、受影响文件 Prettier 检查、双端 `pnpm build:prepared` 均退出 0；聚焦 Jest 215/215、Vitest 87/87 通过。隔离 PostgreSQL 17.11（测试容器映射端口 56233，经 `DEV_COR_TEST_DATABASE_URL` 仅覆盖固定测试 DSN 端口）与 Chromium 的 `core-leads.spec.ts` 三条定向 E2E 3/3 通过：一条来源线索生成两个事项后的列表／计数与页面归属、SELF／跨部门／客户端读取边界、未知阶段拒绝、取证和开箱后阶段计数。故障注入产生的两次 500 属既有回滚反例，测试断言通过。未运行全量 `pnpm verify` 或完整 E2E；本修复按 Level 2 单独验收，不冒充当前 `CORE-NT-003` 已集成或生产发布。

按用户要求，修复分支已并入开发中的 `codex/core-nt-003-opening-review`，合并提交 `379b9d2378e59f0b27d899e803f47b7fb3ee8741`、tree `80c8c2c1c9032eb35f4a5f357e522c2a2f29d593`，无文本冲突；该时点 NT-003 仅有领取／设计文档，尚未新增公证阶段。新组合 tree 上 `pnpm check:fast`、`pnpm spec:check`、受影响文件 Prettier、双端 `pnpm build:prepared`、聚焦 Jest 215/215、Vitest 87/87，以及隔离 PostgreSQL／Chromium 三条定向 E2E 3/3 均通过。后续 NT-003 若实际新增阶段，仍须同步公证列表允许值和导航并重新验证；当前预览服务仍基于 `main`，本次未推送、未合并 `main` 或发布。

## CORE-NT-002 开箱材料（2026-09-24）

实际通过业务门禁的固定代码候选为`f7bca9b9d4eec4d8bce6c8ce3615545cdc5db3d2`，tree为`c54221c265b71609b4e4c5dff0c5a30352446e66`。本Slice只办理内部有权运营对明确选择的`WAITING_UNBOX`事项上传真实照片、纠正误传并提交开箱记录；后端重新校验当前身份、`NOTARY_UNBOX_RECORD`与来源线索范围、事项状态／版本、1～50个同事项可用照片内容版本。在Serializable事务中原子推进到`UNBOX_REVIEW`、写不可变开箱事实与服务端操作者／时间、冻结照片引用、成功审计及幂等回执。客户端及别的部门不得读取内部开箱照片；运营刷新后仍可查看和下载已提交附件。开箱审核结论、识别匹配、出证和案件均未实现。

前向迁移`20260924018000`增加事项开箱事实、最小Action／材料所有者与类别、`UNBOX_REVIEW`阶段及复合部门约束和不可变触发器。先在隔离测试库的随机临时schema通过41份空库迁移链、上一支持schema保留历史事实升级、失败阶段回滚重试和绕过DTO的约束反例，之后只向`backend/.env.test`对应的独立`dev_cor_test`正式测试schema部署；迁移账本校验和匹配。未重置开发库、持久卷或生产数据。

独立高风险审查通过；集成终审首轮`REJECTED`（Critical 0／Important 1／Minor 0），指出50张ACTIVE照片误传后页面不能释放配额。修复后支持刷新恢复未提交照片、显式选择、服务端删除误传并补传，真实浏览器覆盖满50张后的纠错链；原终审主体补审为`ACCEPTED`，未关闭Critical／Important／Minor为0／0／0。首次固定候选`f32f88d`的`pnpm verify`仅执行到全仓格式检查并因两处材料服务排版退出1，不作为通过证据；确认仅格式变化后重新固定上述候选。该候选的完整`pnpm verify`退出0：严格上下文、Spec、架构、类型、ESLint、Prettier、工具71/71、后端693/693、前端365/365及双端生产构建全部通过。同一固定候选的完整`pnpm test:e2e:full`在独立PostgreSQL 17.11／Chromium上96/96通过，包含真实运营登录→取证物流→上传开箱照片→提交→刷新／下载，以及满50张→刷新→删除误传→补传→提交→刷新；权限、客户隔离、错误状态／版本、同键重放、异参冲突、并发胜者和事实／审计／引用／回执故障回滚均有测试覆盖。故障注入预期500日志对应断言通过；这不是生产发布。

从业务候选`f7bca9b`到完成态仅补路线图的完成状态与唯一Current／Next、项目恢复摘要、本验证摘要及对应的已解释上下文快照；累计差异未改业务契约、权限、状态转换、验收要求、代码、迁移、测试输入、构建或运行配置。完成态文字写入后已执行`format:check`、`spec:check`、`context:check:strict`及Git差异检查；本段追加内容也纳入最终文档专项检查。原完整业务证据只归属于`f7bca9b`代码候选，不冒称收口HEAD实跑完整门禁；目标分支变化或远端强制检查仍按集成规则核对。

## CORE-NT-001 线上取证物流登记（2026-09-24）

实际通过完整业务门禁的固定代码候选为`0597388d5dcc9731407de2b432c9c4da12573e71`，tree为`744c6978fb066ab25e914394484f7835bc2326f6`。本Slice只办理有权内部运营对稳定来源、仍为`PENDING_EVIDENCE`的线上公证事项登记取证日期、样品费用已知金额或待定状态，以及至少一条快递公司／单号各自明确为“有”或“无”的物流事实；成功原子推进为`WAITING_UNBOX`。`NONE`不写假值或参与匹配。前端正式页面通过真实API提交并在刷新后只读显示记录；客户账号不能进入内部公证操作。

前向迁移`20260924017000`新增独立不可变取证事实、物流行、最小事项Command回执和单一权限Action；空库完整40份迁移链、上一支持Schema的既有待取证事项升级、故障中途回滚并重试、数据库约束和测试库迁移账本校验均通过。后端以当前身份、Grant及来源线索范围、状态和`expectedVersion`重校验，在Serializable事务中写事实、阶段／版本、成功审计及幂等回执；旧版本、越权、客户身份、异参同键和并发竞争被拒绝，审计／事实／回执故障整体回滚。高风险审查的两项迁移发现已修复并聚焦复审通过；集成后独立Final Review为`ACCEPTED`，未关闭Critical／Important／Minor为0／0／0。

同一固定候选的`pnpm verify`退出0：严格上下文、Spec、架构、类型、ESLint、Prettier、工具71/71、后端686/686、前端355/355及双端生产构建全部通过。独立`backend/.env.test`测试库、PostgreSQL 17.11与Chromium的完整`pnpm test:e2e:full`为93/93通过，含真实运营登录→移交线索→登记取证物流→刷新读取；客户端重新登录后仍仅可读原线索和允许附件。其余用例覆盖权限、版本、幂等、并发、失败回滚和旧数据迁移。故障注入预期500日志对应的断言通过。只操作隔离测试库；修订仅在该库执行过的未提交迁移草稿时，先核对`dev_cor_test`目标及三张新表各一条测试夹具，事务内移除这三张表、对应触发函数、两种新建枚举类型和该草稿的`_prisma_migrations`账本行，再重部署修正版并校验账本；未重置开发库或持久化卷。此证据不表示后续开箱、审核、出证、退货、案件或生产发布已完成。

从业务候选`0597388`到完成态提交`e802561`的累计收口差异仅为本验证摘要、路线图完成态／唯一Current与Next、项目恢复摘要及对应上下文快照；未更改业务契约、权限、状态转换、验收要求、代码、迁移、测试输入、构建或运行配置。该收口通过`context:check:strict`、`spec:check`和`format:check`文档专项检查，故上述业务结果仍只归属于`0597388`代码候选，不冒称`e802561`实跑完整门禁。其后对开发规则及本摘要的修正不属于该纯完成态例外，须按新组合树另行验证；目标分支变化时也须核对实际集成结果。

## CORE-LD-006 运营确认取证并移交（2026-09-24）

实际通过完整业务门禁的固定代码候选为`eafd131c61c37e9e7759a3430c489f95d8e714d3`，tree为`9f2a7c67f95ba7e6fa55677699013523f1460a09`。本Slice在真实运营账号对已由原企业客户确认侵权的`WAITING_EVIDENCE_DECISION`线索提交`EVIDENCE`决定，原子推进为`TRANSFERRED_TO_NOTARY`并生成稳定来源的`PENDING_EVIDENCE`公证事项。首次移交固定来源线索、客户、商品、材料及内容版本，后续新批次必须显式选择并填写用途；重放同一请求返回原回执，异参同键、旧版本、错误状态、越权及竞争被拒绝。客户仅能按企业范围只读已处理线索及允许附件，不得读取内部公证事项。

四份前向迁移`20260924013000`～`20260924016000`增加公证处管理Action、事项及来源引用，并加固材料身份约束；迁移专项在实施候选验证空库39份迁移链、上一支持Schema升级、脏数据拒绝与失败回滚。正式入口包括运营线索详情的确认取证／移交、公证处管理页及公证事项来源查看；API包括公证处目录管理、线索移交Command和公证事项只读查询。独立高风险Review及集成后Final Review的发现均已修复并由审查主体复核为`ACCEPTED`，未关闭Critical／Important／Minor为0／0／0。

固定代码候选的完整`pnpm verify`退出0：严格上下文、Spec、架构、类型、ESLint、Prettier、工具71/71、后端679/679、前端346/346及双端生产构建全部通过。相同候选在`backend/.env.test`对应的独立PostgreSQL 17.11容器和Chromium上执行完整`pnpm test:e2e:full`，91/91通过（1.9分钟），包含真实运营登录→维护公证处→确认取证移交→客户重新登录查看已处理线索及附件→刷新，以及企业隔离、撤权、幂等、版本／并发、审计或回执失败回滚。故障注入产生的预期500日志所对应测试通过。首次全量门禁暴露旧fixture／契约断言未同步，第一个完整E2E候选90/91暴露旧四状态计数断言；修正后在本固定候选完整复跑，未沿用失败结果。

后续收口仅更新路线图完成态与唯一Current／Next、项目恢复摘要、本验证摘要和上下文快照；不变更业务规则、权限、状态转换、验收要求、构建、配置、测试输入或验证逻辑。文档专项检查与完整diff核对后，原业务证据仍仅绑定上述代码候选，不冒称收口HEAD实跑完整门禁。未推送、合并、发布或运行生产迁移；取证物流、开箱、出证和案件仍由后续Slice完成，生产材料Provider仍未就绪。

## CORE-LD-005 运营不取证归档（2026-09-24）

固定代码候选`b9add2c9e016043ad645454e2033ce59c6cecf7b`、tree`5ea88857728ec7ef1d631352a55cd155f624e8f8`完成本切片。运营真实内部账号对客户已确认侵权的`WAITING_EVIDENCE_DECISION`线索，通过`POST /api/v1/leads/:id/evidence-decisions`提交`NO_EVIDENCE`、必填原因、版本和幂等键；后端以当前内部身份、`lead.evidence.decide` Grant与线索范围重新授权，在Serializable事务中原子归档，写不可变`LeadEvidenceDecision`、服务端操作人／时间、审计及幂等回执。原客户侵权决定和历史保留；本企业客户真实账号可在“已处理”查看归档结果和原允许截图，其他企业与内部字段不可见。此完成态不含运营确认取证、公证移交或不取证归档撤回。

三份前向迁移`20260924010000`／`11000`／`12000`增加Action、归档类型、决定事实及受控引导Grant；迁移专项实际验证35份迁移空库链、上一支持Schema升级、组合身份约束、不可变性和失败回滚。独立Final Review在集成候选及发现修复后结论为`ACCEPTED`，未关闭Critical／Important／Minor为0／0／0；审查发现的内部身份显式校验、能力标记和OpenAPI历史枚举问题均有聚焦反例与复核。固定代码候选的完整`pnpm verify`退出0：工具71/71、后端666/666、前端328/328，以及严格上下文、Spec、架构、类型、Lint、格式和双端构建。相同tree的独立PostgreSQL 17.11／Chromium完整`pnpm test:e2e:full`通过89/89，包含真实运营登录→决定不取证→客户重登录→已处理详情及截图→刷新持续存在，并验证跨企业隔离、撤权、状态／版本、同键重放与异参冲突、并发竞争和审计／决定／回执故障回滚。

完成状态写入路线图、线索Spec和项目状态后的候选`c0856c96c1d7ada5b8523d9ca8faf8cb04e2c530`曾因工具测试中真实Git worktree操作超过通用5秒限时而未通过完整门禁；其余工具项70/71，未作为成功证据。仅对该外部进程测试设置有限15秒上限，断言、数量和选择范围不变，独立复审接受。新的状态候选`04fe63b7812607c3700663ba863a874d1c9a5f65`、tree`e768ea370dc7a17174d7ce1550d2139f8f5e1583`重新通过完整`pnpm verify`（工具71/71、后端666/666、前端328/328及全部静态检查／构建）。从已跑89项浏览器的代码tree到状态候选，仅有路线图／Spec／状态文本、上下文快照和上述工具测试限时变更；业务代码、数据库迁移、Playwright测试与执行入口均未变化，因此89项业务证据仍只归属于`b9add2c9`，不冒称状态候选执行了浏览器全套。

中途未通过的候选还暴露了旧权限目录固定数量断言、前端严格目录解码和迁移授权修订号断言未同步新Action，已各自修复并在最终完整门禁／浏览器回归覆盖。工具测试在并行Git子进程与主机CPU争用下曾有5秒超时，因此仅工具文件调度改为串行；未增加重试、删除测试或放宽业务断言。所有数据库写入仅针对`backend/.env.test`对应的独立测试容器；本机默认55433端口被Windows保留，受控E2E入口校验测试容器身份后使用本地56233端口，客户夹具复用同一隔离目标校验。未推送、合并、发布或运行生产迁移；生产私有存储E02仍是上线前置。

流程重复成本复核（仅计现有记录能确认的启动）：完整`pnpm verify`至少3次——`b9add2c9`代码候选通过；`c0856c96`仅完成态文档变化仍被旧规则中“业务Spec不适用例外”触发，工具外部进程测试超时而未通过；修正该测试时间边界后`04fe63b7`作为新候选重新通过。完整`pnpm test:e2e:full`可确认1次（代码候选89/89），没有证据表明完成态文档又触发全量E2E。各次实际耗时与模型Token用量未取得；这些次数不用于推断提速百分比。后续验证摘要提交只登记历史候选及其边界，不冒称摘要所在tree实跑完整门禁。

## CORE-LD-007 不侵权归档撤回纠错（2026-09-23）

固定候选`95b59274ad3e5b17827d78d6599e3b2ba24a9676`、tree`349b96d6ae86f32f1c61c335a31911cba29bf768`通过独立Final Review，结论`ACCEPTED`，未关闭Critical／Important／Minor为0／0／0。完整`pnpm verify`通过：工具71/71、后端645/645、前端320/320，以及严格上下文、Spec、架构、类型、Lint、格式和双端构建；独立隔离测试库`pnpm test:e2e:full`通过87/87。此前实施候选的CORE-LD-007专项真实PostgreSQL／Chromium用例29/29通过；最终候选的完整87项中继续覆盖真实运营账号申请、原客户企业真实账号确认、再次审核并刷新后核对历史。迁移专项空库和上一支持Schema探测通过，并覆盖授权／撤权与企业隔离、回执和材料边界。早期候选发现的TEAM Grant及组织目录回归已修复，并在最终完整E2E前完成聚焦浏览器复核。

本证据只证明CORE-LD-007在该候选的SD-40范围；不表示CORE-LD-005／006、公证或案件动作已实现，也不代表生产部署、生产迁移或公证事项已办理。全部数据库验证只使用`backend/.env.test`指向的独立测试库，未重置开发库；未推送、合并或发布。

## CORE-LD-004客户判定不侵权并归档（2026-09-23）

固定已验证候选`500e7cd4c5f4306a6ae744a4ac4207c783a84053`、tree`ef4f199a9867c1a80c4a50b85d68d11d778298ca`通过正式Level 3门禁。`pnpm verify`通过严格上下文检查、Spec（54 REQ／55 AC／11 BQ／40 SD）、架构（8模块／28模型）、类型、Lint、格式、工具71项、后端Jest 589项、前端Vitest 309项及前后端生产构建；`pnpm test:e2e:full`通过84/84真实隔离PostgreSQL／Chromium测试，覆盖空库及上一支持Schema迁移与失败回滚、跨企业拒绝、幂等重放与并发竞争、决定／回执故障原子回滚，以及运营推送→客户登录判定归档→客户端处理详情／截图和运营详情回看。独立Final Review为`ACCEPTED`，未关闭Critical／Important／Minor为0／0／0。

随后仅有状态、路线图、线索Spec、验证记录和上下文快照变化。最终文档收口候选`42d270ae993de6ed9d8068887ed5df19568690f2`、tree`05f5ff12e267e7d864e33901dcec3700210f0f19`再次通过完整`pnpm verify`（工具71项、后端589项、前端309项，含严格上下文、Spec、架构、类型、Lint、格式及双端构建）和`pnpm test:e2e:full`（独立测试库／Chromium 84/84）。此处补记只绑定`42d270a`的实际结果；本次补记产生的新文档tree不冒称已重跑。完成态仅涵盖CORE-LD-004，不包含CORE-LD-007撤回纠错；未发布或执行生产迁移。

## CORE-LD-003客户确认侵权并进入待确认（2026-09-23）

本切片完成已绑定企业客户对本企业待审核线索确认侵权的一次主要状态变化。真实客户身份经密码会话登录；服务端以当前有效的CLIENT账号、企业绑定和客户准入状态授权，再校验线索状态与版本，在同一事务内写入不可变`LeadReviewDecision`审核事实、推进状态及以`client.lead.review`标识动作的幂等回执。客户端可查看已处理列表和详情，运营端可读取审核结果。客户只能查看本企业线索及获准附件，不侵权归档、运营取证／不取证、公证移交和完整客户门户不在本Slice。

独立代码终审在候选`ab57a6f`为`ACCEPTED`，Critical／Important／Minor均为0；测试修正候选`dc27c37`的独立复审也为`ACCEPTED`，均为0。完整`pnpm test:e2e:full`在`8d4742d`、tree`3b24dcd`通过80/80；首次76/80的失败来自既有测试未同步权利人／客户字段文案及浏览器确认框行为，修正后全部通过。

固定门禁候选`9167b22`、tree`1d3d9813c2c4c449505867937536a121826b7ee6`的正式`pnpm verify`通过：工具71项、后端552项、前端296项，以及规范、架构、类型、Lint、格式和双端生产构建。该候选同tree的`pnpm verify:slice:core-ld`也通过：后端359项、前端183项、真实PostgreSQL／Chromium 22/22；仅该Slice门禁的Evidence v2位于`dev-cor-validation-evidence/1d3d9813c2c4c449505867937536a121826b7ee6.json`。

迁移`20260922011000`、`20260922012000`、`20260922013000`均为前向迁移；迁移验证覆盖空库应用、上一支持Schema升级及中途失败整体回滚。以上为本地／隔离测试环境证据，不表示已上线、已推送、已合并或执行生产迁移。

## Demo对齐前端壳层与线索页面合并候选（2026-09-22）

登录后共享壳层、线索列表、新建／编辑和详情页已按已确认的Demo视觉与操作层级完成对齐；正式页面继续使用真实API、后端capability和PostgreSQL数据，没有引入推送、客户审核或其他未实现动作的假入口。当前`main`与`origin/main`一致于`71ecc0f4a7805d2a9177b785da57f105c2107794`，tree为`daae709e60906d993c2f18df2d338936d3676f9e`。

该tree的`verify:slice:core-ld` Evidence v2状态为`success`，检查集合为Prisma准备、CORE-LD单元／契约、快速静态门禁、Slice格式、后端构建及CORE-LD数据库型浏览器测试；结果为后端228项、前端切片75项和Chromium 14/14通过。证据位于Git common目录`dev-cor-validation-evidence/daae709e60906d993c2f18df2d338936d3676f9e.json`。本次随后进行的状态治理只修正文档、检查器和上下文快照，不把该旧tree证据冒充为治理新tree的执行结果，也不改变CORE-LD-002仍未实现的判断。

## CORE-LD-001运营新建待推送线索候选（2026-09-21）

本切片完成最小客户正式准入、本地／测试私有材料Adapter、证件与线索截图的不可变内容版本，以及运营端待推送线索列表、四阶段计数、新建、详情和允许范围内编辑。后端强制客户已准入、客户—权利主体当前关联、Action与SELF／TEAM／DEPARTMENT数据范围；准入、线索和材料成功事实与审计／引用同事务提交。业务号按Asia/Shanghai业务日生成`LD-YYYYMMDD-NNN`；原子计数器在999停止，第1000号稳定返回`LEAD_NUMBER_EXHAUSTED`，PostgreSQL adapter形态的`40001`也进入既定有界整事务重试。

迁移专项在随机临时schema中实际执行22份完整链，并从`20260920040000_backfill_role_manage_grant`后的上一支持schema升级：已知`enterprise`／`credit-code`分别映射为`ENTERPRISE`／`BUSINESS_LICENSE`，未知遗留值原样保留且仍为DRAFT。绕过DTO直写的负例已补齐其余全部合法必填字段，只以`ENTERPRISE`／`NATIONAL_ID`不兼容组合触发23514；同一数据改为`BUSINESS_LICENSE`的控制组可进入ADMITTED。只有结构上唯一、未共享且已具备所有既有Grant的引导角色获得4个CORE Action并将授权修订加一，共享角色和结构不完整角色均不补权。预建冲突表导致schema阶段42P07时，本阶段新表、客户列和约束均为0；补权故障精确注入授权修订UPDATE阶段，非事务序列证明4次Grant INSERT和1次修订UPDATE已尝试，最终新Grant为0且授权修订仍为1。

当前聚焦证据均为GREEN：`test:unit:core-ld`后端226项、前端71项；工具／上下文查验69项；`check:fast`覆盖架构、前后端与根TypeScript及ESLint；独立PostgreSQL 17容器和Chromium的`test:e2e:core-ld` 9/9通过，其中8组业务场景覆盖真实PDF／JPEG字节上传下载、准入刷新、创建／编辑持久化、商品估算、越权与不泄漏、幂等／旧版本冲突、审计／子表／材料元数据失败回滚与Blob补偿、材料删除／恢复／冻结，以及999／1000边界和并发不重号。固定端口55433处于Windows排除区间，本次使用同一锁定镜像的随机本机端口和显式隔离测试DSN，未回退到开发库。

首个固定候选`c60bd18`的独立Q2为Critical 0／Important 4／Minor 1：PostgreSQL query参数可绕过URL字段检查；随机端口未绑定实际目标容器；补权故障在Grant INSERT阶段过早失败；路线图提前推进；ADMITTED负例同时缺少其他必填事实。修复候选现在禁止所有连接query，以实际`pg`解析器校验最终host／port／user／database／password，随机覆盖只允许改变端口且必须匹配唯一运行中、健康、测试身份和锁定PostgreSQL 17.11镜像的容器；外部条件指纹绑定实际容器ID与端口映射，fixture复用同一URL断言。迁移与文档问题也按上段及路线图修复。安全边界8/8、完整上下文69/69和完整CORE-LD E2E 9/9通过；独立复审与正式Level 2仍待下一固定候选，不据此推进Current。

独立Q2复审固定修复候选`fe2ba4e`并得出`APPROVED`，Critical 0／Important 0；唯一新增Minor是状态文档执行顺序与路线图冲突，已在不改变业务实现的时序修复候选关闭。保持CORE-LD-001为Current的提交`d4063f0`、tree`57021801a858033ce4f4befc3be0f2b5808b5073`已通过正式`verify:slice:core-ld`并生成Evidence v2：后端226项、前端71项、架构／类型／ESLint／Slice格式、后端构建及真实PostgreSQL 17／Chromium 9/9均通过。该证据满足推进状态的前置；状态提交形成的新tree须再运行一次正式门禁并以树外Evidence v2绑定，本段不预填其结果。范围不包含推送、真实客户端、客户侵权结论、取证／公证、CSV／OCR／爬虫、生产E02 Provider、发布或生产迁移。

## ROLE-TEMPLATE-001角色模板复制与Grant配置候选（2026-09-20）

本切片在`codex/role-template-management`隔离worktree按方案A实现：新增独立`ROLE_MANAGE`，只允许当前部门DEPARTMENT范围的模板写入；复制和编辑均提交完整Grant集合，并逐Action验证操作者的DEPARTMENT覆盖。编辑采用模板乐观版本和Serializable事务，模板、Grant、受影响账号授权修订与成功审计共同提交；并发序列化失败稳定映射为409。管理上下文提供严格固定权限目录、模板版本、活动受让人数和capability，正式页面使用复选框加单范围选择并自动加载影响预览，不增加原因、审批或重复认证。

迁移只增加`role.manage`枚举，并在后续事务中按唯一引导关系、未共享角色和结构条件受控补`ROLE_MANAGE / DEPARTMENT`；不按角色名称或用户名猜测。专用升级探针已证明共享角色和非引导角色不补权。模板删除／停用、跨部门或全局角色、自定义策略、角色继承、新业务Action、生产迁移和发布不在本切片。

当前开发期证据：角色模板Service／Controller后端25项、组织API／模板组件／人员工作区前端25项通过；独立`postgres-test`数据库型Playwright专用4/4通过，覆盖正式页面复制模板、创建第二位人员并分配、新人员登录、影响预览、模板编辑、授权修订递增和同一会话下一请求只获得新Grant，以及重名、TEAM管理权、跨部门、并发版本竞争、审计失败全事务回滚和迁移结构识别。相邻人员权限浏览器回归6/6通过。本段不提前声称最终Level 3完成；固定候选的完整`pnpm verify`、commit／tree及独立Review结果将在同一候选验证后回填。

首个固定候选`d810cbc`的完整`pnpm verify`通过（工具65项、前端152项、后端222项及双端构建），角色模板E2E 4/4、人员E2E 6/6通过；独立Review仍以4项Important和1项Minor拒绝。修复候选随后解除`ROLE_READ`与`ROLE_ASSIGN`的错误耦合并让`ROLE_MANAGE`具备必要模板投影；补权迁移排除已存在`role.manage`的候选，避免重复执行空增授权修订；拒绝审计保留稳定业务码；复制事务对一次PostgreSQL序列化冲突重试并重新读取撤权；页面明确同一会话无需重登。数据库验收新增未覆盖Action、并发撤权等待、带活动受让人的Grant／版本／修订／审计共同回滚，以及迁移重复执行和约束故障整体回滚。修复后专用E2E重新4/4通过；最终门禁和复审仍绑定下一固定候选，不复用被拒绝候选结论。

第二个固定候选`cf510a7`重新通过完整`pnpm verify`（工具65项、前端152项、后端225项及双端构建）、角色模板E2E 4/4和人员E2E 6/6。复审确认上一轮5项全部关闭，但新增1项Important：读取／管理可见模板与可分配模板共用数组，页面会向无`ROLE_ASSIGN`或Grant Boundary不覆盖的用户展示必失败的“添加角色”。修复后管理上下文对每个可见模板增加服务端计算的`assignable`标记，严格响应解析同步收口；模板摘要仍完整可读，创建人员和添加角色只使用可分配子集。后端45项、前端22项聚焦测试、`check:fast`和角色模板E2E 4/4通过；仍需对下一固定候选重新执行完整门禁和独立复审。

最终代码候选`d542c31d51efea3011b42aef8de64ff177eb52ae`、tree`cae336dad6de638c1e872fe5977df376fe388012`重新通过完整`pnpm verify`：上下文严格检查、Spec 53 REQ／55 AC／11 BQ／36 SD、架构检查、工具65项、前端153项、后端225项、类型、Lint、Prettier和双端生产构建全部通过。独立`postgres-test`上的角色模板E2E 4/4、相邻人员权限E2E 6/6通过；预期审计故障注入产生的500日志保留为事务回滚证据。独立终审结论`ACCEPTED`，Critical／Important／Minor均为0；终审另行聚焦实跑后端73/73、前端26/26并确认HEAD、tree及干净工作树一致。

完成范围仅为当前部门角色模板复制、完整Grant配置、影响预览、乐观并发、审计、受控补权迁移和既有人员分配入口；不包含模板删除／停用、跨部门或全局角色、自定义策略、角色继承及新业务Action。本轮只对测试库执行迁移和故障注入，未推送、合并、发布或操作生产数据库。此后的路线图、状态、验证文字和上下文快照收口不改变已审查代码候选。

## TEAM-AUTHZ-ARCH-001团队与管理授权前置收口（2026-09-20）

本任务只收口Next Slice之前的Team引用完整性和管理授权上限。Prisma新增部门直属`Team`及ACTIVE／INACTIVE状态，数据库拒绝改变Team部门，`DepartmentMembership`、`RoleAssignment`、`Customer`的非空团队引用改由`(teamId, departmentId)`组合外键约束；不增加Team编码、层级或物理删除。停用Team保留既有成员、角色和客户引用，既有客户仍可按原权限维护，但新建／恢复成员或角色绑定及新客户绑定必须使用活动Team。

PostgreSQL前向迁移拆为两个显式事务：第一步只提交六个管理`PermissionAction`枚举值，第二步在事务和引用表锁内创建Team、确定性兼容映射、组合外键并受控补齐引导角色Grant。跨部门复用同一旧UUID时按确定规则只由首个部门保留原UUID，其余部门生成稳定新UUID，三个引用表共用映射；原`NULL`不回填。模拟第二步中途冲突时事务整体回滚，原引用保持；第一步已提交的枚举值按PostgreSQL限制保留。共享角色明确不补权，避免把其他受让人静默提升为管理员。没有删除或清空既有业务数据，也没有运行开发库或生产迁移。

服务端新增`user.read`、`user.manage`、`team.read`、`team.manage`、`role.read`、`role.assign`。角色分配在可串行化事务和数据库行锁中重读操作者状态和Grant：先确认`role.assign`覆盖目标活动Team成员，再逐项确认待授角色每个Action／Scope均被操作者同Action实际覆盖；SELF不跨主体，TEAM要求操作者活动成员Team与分配Team一致，只覆盖同一目标Team的TEAM范围且不推导SELF。Team新建／启停只接受DEPARTMENT `team.manage`。实现不读取角色名称、用户名、特殊管理员标记或前端按钮作为授权依据；成功分配与审计、目标账号授权修订同事务提交。

最终Level 3证据：`pnpm verify`退出0，覆盖上下文与Spec（53 REQ／55 AC／11 BQ／36 SD）、工具35项、后端168项、前端125项、类型／Lint／格式和双端构建。隔离`postgres-test`从空库顺序应用13份迁移；完整PostgreSQL／Playwright 48／48通过。覆盖无效／跨部门Team引用、Team部门不可变、停用历史与新增绑定拒绝、三表非空UUID共用映射及各表`NULL`保留、共享角色不补权、迁移回滚、实际OrganizationService有权／无权／跨Team／超上限／审计失败回滚，以及用独立连接和`pg_blocking_pids`证明停用／撤权竞态按锁序拒绝且无业务、审计或修订残留。独立复审最终`ACCEPTED`，Critical／Important／Minor均为0。

`CustomerProfileStatus`保持只有`DRAFT`；正式准入继续按文件能力→资料完整性→准入规则→状态机→Command→Audit顺序另开Slice。未创建Lead、Case、Notary、File、Fee、Settlement或Report表。

## AUTH-LOCAL-001本地账号认证第一切片（2026-09-18）

本切片按已确认设计实现一次性首位管理员初始化、规范化用户名与版本化scrypt密码、12小时绝对期限的不透明数据库会话、退出、Cookie写请求CSRF、用户名／来源双桶登录限速、前端登录页及匿名路由重定向。会话仅持久化SHA-256摘要，来源仅持久化带服务端密钥的HMAC；账号、成员、部门状态和授权修订在每次请求重新读取。生产Cookie要求Secure；登录先校验同源。原Bearer身份只在`NODE_ENV=test`保留，未进入正式认证路径。

当前聚焦与全仓测试通过工具19项、后端142项和前端120项。认证PostgreSQL／Playwright 4/4通过，覆盖登录→客户真实落库→刷新恢复→退出→401、缺失CSRF拒绝、六个并发错误密码产生五个401和一个429，以及从前九份迁移升级并证明脏显示名导致迁移失败时不留下新列／表。首次完整E2E复跑40/42，准确发现既有Bearer浏览器fixture未返回正式会话新增的`departments`字段；补齐同一契约后失败用例2/2及固定最终候选42/42通过。`pnpm verify`随后通过上下文、Spec（53 REQ／55 AC／11 BQ／35 SD）、类型、ESLint、Prettier、上述全仓测试和双端生产构建。未打印或提交本地密钥、密码和数据库凭据。

连接故障修复：Vite代理显式传递转发主机／协议，后端同源校验据此判断浏览器原始来源；会话恢复401不再触发全局重复跳转，公共健康页在后端离线时仍可显示，只有status 0的真实传输失败显示“无法连接服务”。Docker Desktop恢复后专用测试库`127.0.0.1:55433/dev_cor_test`健康，十份迁移已应用且完整E2E通过。开发库仍需操作者运行迁移与一次性初始化命令；本轮未创建真实人员账号。

分支治理纳入：候选已把`main`的治理提交`8e02126`纳入隔离分支，形成合并候选（父`a7d91fe`＋`8e02126`）；`README.md`、`docs/context-snapshot.json`、`docs/project-status.md`、`docs/spec/v0.1/VALIDATION.md`四处重叠已逐项人工解决，`package.json`自动合并，上下文快照重录。合并后门禁：`pnpm check:fast`退出0；`pnpm verify`退出0（后端142项、前端测试、双端生产构建）；完整数据库型Playwright 42/42；迁移专项用例2/2，并在临时空库顺序应用全部11份迁移成功（14张表、12个CHECK、5个UNIQUE）。本机`git`无法创建嵌套分支名，任务分支改用顶层名`codex-local-account-auth`承载同一提交。

独立复审与修复：隔离审查对合并候选给出`REJECTED`（Critical 0／Important 1／Minor 2），首轮13项全部确认关闭。三项finding已修复：I-01补齐本记录与状态文档的合并候选证据；M-01在前端`http.ts`对`CSRF_INVALID`自动刷新会话并重试一次（并发去重、至多一次、刷新失败保留原错误），补3项回归；M-02新增`cookie.spec.ts`断言生产Secure分支与清除语义，并在`auth.service.spec.ts`断言登录成功／失败／需选部门三类结构化安全事件。另修正登录失败文案不再提及"部门"（单部门用户会被误导），并把`LoginPage.spec.ts`的`DEPARTMENT_REQUIRED`状态码由409更正为实际401。第二轮增量复查确认上述三项关闭，并新报两项Minor：刷新自身返回401时未触发未授权通知、会话被另一标签页换成其他账号时写请求会静默重放；已分别改为刷新401即触发未授权通知，并在`/auth/session`回填的身份与已知会话身份不一致时拒绝重放并转登出，各补1项回归。修复后聚焦测试前端28项、后端15项通过。当前状态`IMPLEMENTED_UNVERIFIED_Q2`，等待独立主体复查确认finding关闭；不执行生产迁移、发布或真实数据写入。详见[安全复审记录](../../security/local-account-auth-q2-review.md)。

## GOV-AI-FLOW-002三级开发流程优化（2026-09-17）

用户要求在不降低正式系统质量的前提下，减少AI Coding的时间和Token成本。审计范围覆盖`AGENTS.md`、AI开发规范、唯一Cursor集成规则、开发规范入口、README命令说明、根／前后端`package.json`、上下文检查器及测试配置；仓库没有托管CI workflow，也没有可靠的跨workspace依赖图。确认的低收益流程是：普通接口默认完整`verify`／E2E／独立审查，每项任务强制两批状态回填，新任务重复通读长规范，以及Skills／设计／计划／确认没有按真实分支触发。

现已在原入口上收敛为Level 1轻量、Level 2默认、Level 3严格；历史Q0／Q1／Q2仅保留映射，不再用于新任务。`AGENTS.md`由原有全量启动规则改为状态入口＋相关模块按需加载，AI开发规范只负责恢复和文档同步，唯一Cursor规则负责全部风险与验证强度。Level 1／2不再默认完整E2E、独立审查、设计／计划文档或状态双写；Level 3继续保留完整`verify`、风险专项、必要E2E／迁移验证和合并前独立Review。类型、Lint、核心业务／契约、迁移、权限负向、数据隔离、核心事务、合并前完整验证和发布回归均未取消。

自动化新增`pnpm check:fast`和`pnpm context:record:light`。前者采用并行workspace类型检查、根类型检查和位于既有忽略目录`.local`的ESLint内容缓存，并在独立Review后显式固定`--cache-strategy content`；后者最初可对任意路径关闭状态检查，被独立Review判为Important，现已收紧为只允许`demo/`和`frontend/src/styles/`差异，源码、配置、治理、Spec及其他路径必须使用标准状态支持的`context:record`。工具回归增加高风险源码拒绝场景。没有新增`test:affected`，因为当前无可靠依赖图；规则要求使用现有Jest／Vitest／Playwright过滤能力，避免用不完整自动选择冒充安全覆盖。

生效入口冲突扫描未发现旧的Q1完整`verify`／E2E／轻量独立审查、每任务通读长规范或强制设计／计划确认仍在执行规则中；项目状态和历史验证中的Q2文字作为历史事实保留。首轮独立Review结论`REJECTED`（Critical 0／Important 3／Minor 1）；除上述轻量快照和缓存问题外，还指出Level 3缺少`ACCEPTED`＋0 finding的精确集成判据，以及身份／认证／会话／授权守卫未被真实数据库E2E强制触发。首轮修复后工具21/21、`check:fast`和完整`pnpm verify`通过；复审关闭原4项，但新增发现缺失快照时轻量模式仍可从零登记任意工作区，最终修复要求轻量模式必须存在可信旧快照并增加负向回归。最新完整`pnpm verify`退出0；同一`gpt-5.6-sol`独立终审结论`ACCEPTED`，Critical／Important／Minor均为0。本轮不改业务功能、schema、迁移、依赖版本或生产环境，数据库E2E不适用。

## GOV-WORKTREE-CLEANUP-001合并后清理（2026-09-17）

用户要求合并完成后清理任务worktree。现场审计确认4个任务分支的HEAD均为`main`祖先，且各分支`main..branch`提交数均为0；其中`customer-admission-contact`和`process-risk-gates`工作目录干净，另两个客户基础worktree分别有142和159项未提交／未跟踪状态。没有强制丢弃这些内容：先以`git stash push --include-untracked`保全为提交`6e240704c0f6342e5c9588bf02ae10555ce653a8`和`8e2edd1f49a022a8d05084cc66cdaa4baa76a664`，确认目录转为干净后再清理。恢复时应在合适分支使用`git stash apply <提交>`，核对内容后再决定是否保留。

随后通过`git worktree remove`删除4个明确位于用户临时目录的任务worktree，删除4个已合并本地任务分支并执行`git worktree prune`。最终`git worktree list --porcelain`只列出`D:/工作项目/品维and知产/dev_cor`的`main`，目标本地分支清单为空；未删除远端分支、stash、未合并提交、开发数据、业务文件或生产内容。自动集成规则增加远端核实后的worktree／本地分支清理和脏现场保全门槛。Node v24.21.0／pnpm 11.27.0下完整`pnpm verify`退出0，用时149.8秒，覆盖213个上下文文本、Spec、类型、Lint、格式、工具／前后端测试和双端构建；本轮不改变业务运行时，数据库E2E不适用。首次格式命令未为`.mdc`指定解析器而退出2，改为显式Markdown解析后通过并继续，未关闭检查。收口回填后重新执行格式、上下文和Git差异检查；未调用独立审查主体，规则改动不自动集成或推送。

## CUST-RH-001客户权利主体实现候选（2026-09-17）

依据TD-SLICE-CU-RH-01 rev1与用户当日编码授权，范围仅为主体新建、只读查看及客户关联。Task 1/2实现固定至`c4891d1`；Task 3补充真实PostgreSQL／浏览器测试与迁移证据。Q2原因是客户范围、共享主体信息、组合部门约束、事务、审计、幂等与版本控制；修复候选最终独立Q2已`ACCEPTED`并进入内部集成，不包含生产上线许可。

- **运行环境与安全核验**：每次PowerShell加载项目入口，Node `v24.21.0`、pnpm `11.27.0`符合锁定值。读取`backend/.env.test`并只输出脱敏目标，确认`NODE_ENV=test`、`127.0.0.1:55433/dev_cor_test`，连接后`current_database()`也为`dev_cor_test`。测试helper再次比对连接串与该文件一致并限制本机专用库，才允许fixture清理、故障约束和临时schema。未操作开发库、生产或真实数据，未打印／提交凭据。
- **首个RED**：先增加浏览器A／B创建客户、A新建H、B关联同一H和字段边界测试，再运行`pnpm db:test:up`、`pnpm build`及筛选。计划原命令`pnpm test:e2e -- --grep "rights holder"`把额外`--`原样转发，实际选中29项；首个组件冷启动超时后中止，不能记为主体RED。改用`pnpm test:e2e --grep "rights holder" --max-failures=1`实际选中2项，1失败／1未运行：主体表未迁移，后端`P2021 / 42P01`，页面无法出现“新建主体”，等待30秒超时。随后补齐fixture的receipt→link→holder→customer清理顺序及专项helper。
- **空库全迁移**：只精确重建Compose `postgres-test`临时服务，重建前public表为9，重建后实际查询public表为0；随后Prisma `migrate deploy`顺序成功应用8份迁移至`20260917070000_add_customer_rights_holders`，`migrate status`报告schema最新。临时测试数据随容器重建清除，可由fixture重建；开发持久卷保持原状。
- **上一schema升级**：`verifyRightsHolderMigration`在两个随机命名临时schema应用前7份迁移至`20260917060000_add_customer_admission_contact`，写入两部门、成员及含联系人资料的2个合成旧客户。应用新迁移后逐行全字段比较保留2/2；3张新表存在，同部门关联成功。原始SQL的NULL名称得到23502，空串／纯空格由`rights_holders_name_nonblank_check`拒绝，跨部门客户／主体分别由`customer_rights_holder_links_customer_department_fkey`及`customer_rights_holder_links_holder_department_fkey`拒绝，重复关联由`customer_rights_holder_links_customer_holder_key`拒绝。另以预存receipt表制造迁移中途42P07，回滚后新主体／关联表与客户组合唯一约束均为0，旧客户仍2/2；临时schema在finally清理。
- **聚焦GREEN**：首次helper使用顶层await遇到Playwright模块转换`ReferenceError: await is not defined`，改为启动期同步读取安全配置后，`pnpm test:e2e --grep "rights holder"`退出0，10/10通过（7.4秒）。覆盖真实页面稳定身份复用、空名称及同名／同信用代码允许、猜测隐藏UUID、同部门SELF／TEAM与跨部门404、响应白名单和隐藏关系不泄漏、不同key并发关联与相同key并发重放、同key不同指纹、版本过期、编辑／读取撤权、两种创建审计失败及关联审计失败的全事务回滚、脱敏审计。
- **完整候选门禁**：固定执行树`3a93717dab65e2c7da819537b18e660718a5d42c`，基于`c4891d1`，本地`main`及`origin/main`均为`e5b55de`。`pnpm verify`退出0，用时56.9秒，覆盖212文本上下文、Spec 53REQ／55AC／11BQ／34SD、工具19项、后端98项、前端95项、类型／Lint／格式和前后端构建；随后完整`pnpm test:e2e`退出0，37/37通过（Playwright 13.5秒，命令14.6秒）。两项完整门禁各正式执行1次；最初错误带`--`的29项选择被中止，单独保留为失败尝试，不计通过。服务由当前构建启动且禁止复用；数据库fixture串行重建，未改锁文件、测试配置或迁移。预期审计故障场景的脱敏500日志和Node颜色环境提示保留，不作失败隐藏。收口只追加这些非执行性结果及快照，业务验证复用该执行树。独立Q2由主代理另行组织，当前待独立Q2审查／未上线，未给出ACCEPTED。
- **独立Q2首轮与修复**：独立主体审查固定候选`70c4b41`后结论为`REJECTED`（Critical 0／Important 2／Minor 1）：070000的`BTRIM(name)`未拒绝tab／换行／Unicode空白；嵌套详情只在mount加载，复用RouterView切换参数会显示旧主体；一条投影E2E并行读写同一候选集合。修复均先有失败回归：新增080000前向迁移显式列出ECMAScript trim的25个WhiteSpace／LineTerminator码点，直接SQL逐项、CRLF及组合均由`rights_holders_name_nonblank_check`拒绝，U+200B／U+0085等非trim字符仍可作为名称；存量纯空白使升级23514失败，旧约束、脏主体与旧客户在事务回滚后保持。详情页监听客户和主体参数、立即清空旧数据、Abort旧请求并阻止旧响应覆盖，真实memory RouterView的三组参数切换、乱序和新锚点404共8/8通过；投影E2E改为先断言候选响应再关联。
- **修复候选门禁**：精确重建唯一隔离的`postgres-test`临时服务后，从空库顺序应用9份迁移至080000，`migrate status`报告最新；开发库、生产、真实数据均未触及。主体专项11/11通过。随后`pnpm verify`退出0，覆盖213文本上下文、Spec 53REQ／55AC／11BQ／34SD、工具19项、后端98项、前端100项、类型／Lint／格式和双端构建；完整`pnpm test:e2e`退出0，38/38通过。预期故障注入500日志及Node颜色提示保留。当前仅待独立Q2复审，不据此集成、推送、上线或声明ACCEPTED。
- **最终独立Q2**：复审对象`f63310a2556cb32a4e15fe471a4534b07c3e6732`、tree`8e3d3d8aa240968456c442032b66aec0f78fe625`。审查主体独立核对当前命名CHECK对25个ECMAScript trim码点的拒绝、9份已应用迁移校验和、真实SFC／RouterView参数切换与旧响应、投影E2E顺序，以及绑定同一HEAD/tree且前后工作区干净的完整原始verify／E2E输出。首轮I-01、I-02、M-01均关闭，无新增finding；结论`ACCEPTED`，Critical 0、Important 0、Minor 0，Task 3 Approved。状态为`IMPLEMENTED_VERIFIED_INTERNAL_INTEGRATION`；不代表E01、生产迁移、发布或真实数据获准。

需求与证据：[REQ-CU-002／AC-CU-002](modules/customers.md)→[技术设计第19节](TECHNICAL-DESIGN.md)→[后端](../../../backend/src/modules/customers/rights-holder.service.ts)、[客户内页面](../../../frontend/src/modules/customers/CustomerRightsHolderPanel.vue)→[数据库／浏览器测试](../../../tests/e2e/customers.spec.ts)、[迁移helper](../../../tests/support/customer-database.mjs)。E01仍只阻断真实身份联调；E02不阻断本无文件切片。未实现主体编辑、删除、解除关联、默认主体、多联系人、资产、协议、合作状态或主链Query，未执行生产迁移／发布。

## CUST-RH-DESIGN-001客户与权利主体最小关联设计（2026-09-17）

用户引用会话`6aab8337-fe04-83eb-8e94-f5de0fd83e03`并要求按其中固定范围执行。本轮只设计权利主体新建、查看和客户关联，不创建业务代码、Prisma schema、迁移、接口、页面或可执行主体测试。TD-SLICE-CU-RH-01比较了客户锚定独立主体、Customer内嵌数组和部门级主体目录三种方案，采用独立稳定主体记录＋客户—主体关联，并把所有本轮入口锚定到一个有权访问的客户；多对多不简化为一对一，不建立主体名称／信用代码自动判重，也不暴露主体关联的其他不可见客户。

设计复用已验证的`customer.read`和`customer.edit-routine`完整Grant：读取要求授权覆盖访问锚点客户，创建／关联要求授权覆盖目标客户；关联已有主体还要求主体已能通过操作者的客户读取范围到达。逻辑模型要求Customer、RightsHolder和关联的部门由组合外键或等价数据库约束保持一致，主体创建与首个关联、客户版本和两类共享审计同事务；共享主体编辑、删除、解除关联、默认主体、多联系人、资产、协议和合作状态均排除。实施拆为数据库／后端、原页面前端和PostgreSQL／浏览器／独立Q2三个连续任务，不并行修改共享schema和Customer Interface。

设计自审检查了占位符、内部矛盾、范围漂移、跨客户信息泄露、猜测UUID、跨部门直接写入、重复／并发关联、乐观版本、审计正文和事务回滚。唯一未获确认的业务门槛是主体创建最低必填组合：现有DOMAIN只确认CU03字段语义，不代表必填已批准；设计建议名称必填、信用代码／地址／法定代表人／职务可空，用户确认前状态保持可评审而非`PLAN_READY`，也未获编码授权。E01缺失只阻断真实登录联调，E02与本无文件切片无直接依赖；两项缺失输入已按现有记录复核，没有选择供应商或把测试Adapter写成完成。

本轮实际执行项目Node v24.21.0、pnpm 11.27.0与锁定值一致；开工`pnpm context:check`通过。首次`pnpm spec:check`因技术设计标题未显式包含当前SD-34而失败，补回有效约束标记后通过53个REQ、55个AC、11个BQ和34个SD；`git diff --check`通过。最终格式、上下文快照、本地链接及Git差异检查在收口命令后回填。纯设计文档任务不运行代码单元测试、构建、数据库E2E或迁移专项；静态通过不表示主体功能已实现或获得生产准入，独立Q2留在编码候选门禁。

## CUST-FND-008一位准入联系人纵向切片（2026-09-17）

用户明确授权在不搭建`dev:acceptance`和不进行人工localhost验收的前提下，实现每个客户一位准入联系人。实现沿用Customer聚合、`customer.edit-routine`、客户数据范围、乐观版本和Shared AuditEvent；只增加联系人姓名、电话和邮箱三个可空字段。草稿允许三项全空；填写任一字段时，姓名必填且电话／邮箱至少一种。联系人不创建账号或权限；多联系人、主要标记、删除、正式准入、材料、E01/E02、权限页面和生产发布均未进入本批。

测试先行证据：新增后端测试在实现前5项失败，原因分别为DTO拒绝字段、响应缺字段、缺少聚合校验和修改未生效；实现后客户后端聚焦31/31通过。新增前端/API测试在实现前8项失败，原因分别为响应未校验联系人契约、三张页面无字段及冲突流程未保留联系人；实现后前端当前53/53通过。全仓类型检查与前后端构建已通过。

数据库证据：只重建Compose服务`dev-cor-postgres-test-1`，其目标为`127.0.0.1:55433/dev_cor_test`临时测试库；未触碰开发库、持久卷、共享库或生产库。Prisma从空库依次应用7份迁移并报告schema最新。首个固定候选`5b88467`的独立Q2为`BLOCKED`（Critical 0、Important 1、Minor 1）：数据库CHECK仅判断NULL，直接SQL可写入空白姓名或把空白电话／邮箱充当联系方式；审计测试也未直接断言姓名和电话脱敏。修复提交`a3ee91e`将CHECK改为`NULLIF(BTRIM(...), '')`非空判断，新增原始SQL负向回归，并精确断言姓名为`***`、电话为`***8000`且不含原值。重建测试库后7份迁移再次从零成功，数据库型Playwright 27/27通过；修复后的`pnpm verify`通过198个文本上下文、53 REQ／55 AC／11 BQ／34 SD、工具19项、后端Jest 68项、前端Vitest 53项、全仓TypeScript／ESLint／Prettier及前后端构建。独立复查结论为`ACCEPTED`（Critical 0、Important 0、Minor 0），上一轮问题全部关闭。本轮没有人工localhost截图／录屏，E01/E02、生产迁移和发布仍不在范围内。

## CUST-FND-DB-E2E数据库迁移与内部集成验收（2026-09-17）

Docker Desktop Linux引擎恢复后，`postgres-test`在127.0.0.1:55433健康运行。Prisma对独立`dev_cor_test`实际应用`20260916120000_add_access_control`、`20260916123000_add_customer_draft`和`20260917020000_enforce_role_assignment_department`三份迁移，随后报告数据库schema为最新；未连接或修改开发库、共享库或生产库。

测试先实测RED：新客户E2E在生产默认拒绝身份Adapter下返回401；角色分配完整性测试证明数据库原先允许将B部门角色模板写入A部门分配。最小修复增加仅在`NODE_ENV=test`且显式提供映射时启用的身份Adapter工厂，并以组合唯一键／组合外键绑定角色模板与分配的部门。生产和无测试映射环境继续拒绝身份；迁移采用新增向前迁移，不改写已执行历史。

数据库型Playwright最终9项通过：真实草稿持久化和共享审计历史、外部门列表0条、外部门直达详情不泄漏404、跨部门角色模板分配由数据库拒绝、停用角色分配在下一请求返回403、客户插入失败不产生审计、审计插入失败不保留客户，以及健康页和组件交互。完整`pnpm verify`通过：190个文本上下文、53 REQ／55 AC／11 BQ／34 SD、工具19项、后端Jest 45项、前端Vitest 39项、全仓TypeScript／ESLint／Prettier和前后端生产构建均成功。实现者Q2复核修复了上述组合外键缺口，但不替代独立审查；E01真实登录与E02真实存储仍无实际参数，因此不属于本次通过范围。

## CUST-FND-004运营端客户直接页面（2026-09-17）

在`e2be2c0`客户后端检查点上继续采用TDD：客户API解码与列表／新建／详情组件测试先因实现文件不存在而RED；随后仅新增`/customers`、`/customers/new`和`/customers/:id`三条路由，不加入向导、审批、文件、编辑、判重、准入或权限配置页面。列表分别呈现加载、空、失败和成功状态；创建只要求名称、提交中防重复、失败保留输入；详情显示草稿提示与默认折叠的共享审计历史。创建入口由后端返回的动作能力控制，但后端仍逐请求授权，前端隐藏不作为安全边界。

本轮同时修复两个接口一致性问题：授权拒绝统一返回`CUSTOMER_ACTION_FORBIDDEN`，详情在确认客户处于授权范围后才查询并投影共享AuditEvent；列表返回服务端判断的`createDraft`能力，底层存储错误不会伪装成无权限。前端API对列表、详情、创建响应做运行时结构校验，错误码继续由既有`requestJson`保留。

聚焦前端运行结果为7个测试文件／39项通过，新增后端聚焦测试10项通过。最终`pnpm verify`完整通过：185个文本上下文、53 REQ／55 AC／11 BQ／34 SD、工具19项、后端Jest 42项、前端Vitest 39项，以及全仓TypeScript、ESLint、Prettier和前后端生产构建。使用Playwright拦截的合成API响应在1440×1000视口走通列表→新建→保存→详情，三个页面经截图人工检查未见截断、重叠或明显操作歧义，浏览器控制台错误0；该检查不冒充真实后端联调。提交前实现者自审修正了一个残留的旧403错误正文；受独立复核要求和本轮禁止委派边界限制，本自审不替代独立Q2复核。Docker daemon仍不可用，未创建会跳过数据库事实的伪E2E；测试迁移、合成身份下的跨部门Playwright验收和真实E01登录均未验证，状态为`IMPLEMENTED_UNVERIFIED_INTEGRATION`。

## CUST-FND-003客户草稿、范围读取与原子审计（2026-09-17）

中断恢复后重新核对功能分支、工作区、开发状态和AI规范，项目入口实际为Node v24.21.0／pnpm 11.27.0；`context:check`只报告两份新测试尚未登记，不再存在此前Node／pnpm解析漂移。客户测试先实测RED：服务、控制器、身份端口和Guard均不存在。

随后实现生产默认拒绝的身份Adapter端口、逐请求ActorContext Guard、客户草稿schema及增量迁移、服务端派生部门／负责人、同一Prisma事务内的Customer＋共享AuditEvent写入，以及在数据库查询中合并授权范围的列表／详情。DTO拒绝未知字段，详情对不存在和越范围统一返回`CUSTOMER_NOT_FOUND`；列表固定按`updatedAt desc, id asc`排序。未加入编辑、判重、准入、文件、权限后台或真实SSO。

聚焦Jest 10项通过，覆盖名称清理、服务端归属、默认草稿、共享审计、审计失败传播、范围谓词、稳定分页参数、未认证401、缺少创建动作403、伪造部门400及不泄漏404。完整`pnpm verify`通过：177个文本的上下文检查、53 REQ／55 AC／11 BQ／34 SD的Spec检查、工具19项、后端Jest 40项、前端Vitest 24项，以及全仓TypeScript、ESLint、Prettier和前后端构建均成功。`pnpm db:test:up`仍因本机Docker daemon不存在而失败，因此迁移执行、跨部门PostgreSQL查询隔离，以及客户／审计真实事务双向回滚尚无运行证据；状态保持`IMPLEMENTED_UNVERIFIED_DB`，且Q2最终`VERIFIED`仍需独立安全复核。

## CUST-FND-001／002首批实现门禁与最小授权核心（2026-09-16）

用户引用会话`6aaa8346-93e0-83eb-a63e-2949b98d591a`，在环境漂移修复后明确要求按运营端优先路线执行；授权范围包含已确认Spec内的业务编码、开发库迁移、自动化测试和必要文档同步，不包含生产操作、生产数据、真实账号授权或范围外功能。实现门禁记录见[Q2检查](../../security/customer-foundation-q2-review.md)，最终独立安全复核前保持`IMPLEMENTED_UNVERIFIED`。

CUST-FND-002先写负向测试并实测RED：授权服务、ActorContext及测试身份Adapter尚不存在，两个测试套件因模块缺失失败。随后实现最小部门、账号、部门成员、可编辑角色模板、操作＋范围Grant和角色分配schema，以及统一授权服务、Prisma读取Adapter和只允许`NODE_ENV=test`的合成身份Adapter；未加入策略语言、权限管理页面、真实SSO或案件权限。

当前实测GREEN为授权核心7项Jest通过，覆盖部门读取Grant不能与本人创建Grant拼成部门创建、跨部门拒绝、停用分配、陈旧`authorizationRevision`、本人查询谓词及测试身份生产禁用；Prisma schema校验通过。完整`pnpm verify`通过：工具测试19项、后端Jest 30项、前端Vitest 24项，以及全仓TypeScript、ESLint、Prettier和前后端构建。Docker Desktop进程虽已启动，但daemon在两个等待周期内未就绪，本机`com.docker.service`又因权限不能启动，因此迁移尚未在`postgres-test`执行，数据库约束和查询隔离仍为未验证；本检查点不得标为最终Q2`VERIFIED`。

## GOV-LIVE-SPEC-001活Spec收口、自动检查与首批计划（2026-09-16）

用户引用会话`6aaa7dd8-c60c-83eb-ab9f-b0cc48273eec`，要求把AI开发方式收敛为“必要上下文→本轮Spec检查→执行→按风险验证→最少留痕”，并直接完成此前已经批准的Spec修正、可再生文件清理和首批任务拆分，不再重复请求同一确认。本轮在现有入口修正SA-01～06：客户准入冻结`materialId + contentVersionId`，客户Module复用共享AuditEvent；就绪状态分为`PLAN_READY`、`IMPLEMENTATION_READY`和`INTEGRATION_BLOCKED`；客户角色改为可编辑模板与Grant；当前范围统一为SD-34／TD-BASE-05／TD-TRACE-UX-01；关系事实留存与敏感内容保留／清理分开表达。

新增`scripts/spec-check.mjs`和根命令`pnpm spec:check`，并纳入`pnpm verify`。测试先于实现建立，实测5个故障样例覆盖重复REQ、缺失REQ／SD引用、Markdown表列漂移和当前SD／TD版本过期；当前Spec检查结果为53个REQ、55个AC、11个BQ和34个SD，错误0。首批计划只含Q2复核、最小灵活授权、客户草稿／范围内读取／共享审计、直接页面与跨部门验收；编辑判重、证件版本、正式准入、权限管理页面和真实E01/E02适配不进入首批。本轮没有创建业务schema、迁移、接口或页面。

启动时发现`Use-ProjectRuntime.ps1`只固定外层Node，嵌套`pnpm verify`仍回落到Codex自带pnpm 11.19.0／Node 24.19.0并被engine门禁拒绝。新增受版本文件驱动的`tools/project-runtime/pnpm.cmd`并将`.cmd`纳入上下文跟踪后，项目及嵌套脚本均使用Node 24.21.0／pnpm 11.27.0。最终`pnpm verify`通过：工具测试19项、后端Jest 23项、前端Vitest 24项，以及类型检查、ESLint、Prettier和前后端构建均通过。未运行Playwright E2E、数据库迁移、真实SSO、真实对象存储或外部联调。

清理前逐项解析并验证仓库内绝对路径，删除`.tmp/`、`.local/`、`frontend/.local/`、`playwright-report/`、`test-results/`、`backend/dist/`和`frontend/dist/`中的6918个既有文件，共44,428,178字节；完整验证重新生成的两个`dist`目录共43个文件、209,653字节，验证后再次删除。最终7个目录均不存在，`.env`、`backend/.env`、`backend/.env.test`、`node_modules`、`backend/src/generated`、Demo和`pnpm-lock.yaml`均存在。被删目录不受Git跟踪，不能从提交恢复，但可由对应构建、测试或临时检查重新生成。

## TD-TRACE-UX-001低负担回溯与原页面易用性设计（2026-09-16）

用户要求按引用会话`6aaa718a-18d0-83eb-8e44-d12b178ba737`修改系统设计，并先保存版本。改动前完整工作区已保存为本地提交`a7649ff`（`docs: save approved system design baseline`）。本轮登记INPUT-013和SD-34，新增REQ-XM-006／AC-XM-006及TD-TRACE-UX-01；A01～C04均回写现有DOMAIN、模块REQ／AC、CROSS-MODULE、GAPS、READINESS和COVERAGE，没有另建字段表、流程表、工作台、审批中心、审计台账或通用工作流。

设计采用业务事实与审计事件同一PostgreSQL事务写入、按当前资源权限读取历史投影的方案，不采用事件溯源。材料区分稳定身份和不可变内容版本，历史动作引用具体版本；文件下载由应用网关重新授权，导出在执行和领取时分别重检。业务日期、录入时间和更正时间分别保留；合并办理组不搬数据或扩权；退款关联原支出并做幂等和并发累计校验。优化只进入原列表、表单、详情和日历，正常新建、上传、阶段办理和费用录入的新增必填字段、必经页面和强制确认均为0。

静态核对实际结果：27份Spec Markdown、53个唯一REQ且标题无重复、55个唯一AC引用、11个BQ和SD-01～34连续；本地链接失效0处，Prettier格式检查和Git差异检查通过。项目Node v24.21.0、Corepack pnpm 11.27.0与锁定值一致；最终上下文记录／检查通过。仅修改设计与治理文档及上下文快照，没有修改Demo、正式代码、schema、迁移、接口或页面；没有运行代码测试、构建、E2E、数据库或外部联调。以上结果只证明设计文档一致，不表示A01～C04已经实现或通过运行验收。

## BR-007／TD-AUTHZ-001五项依赖确认与灵活权限设计（2026-09-16）

用户引用会话6aaa69ff-43d8-83eb-a5b9-33ec0e2c7ac1并确认“通过建议，按照这个对话来做，并且要做到角色权限灵活调配”。本轮新增SD-28～33，将SD-24案件矩阵改为可编辑初始模板，采用不可拆分的操作权限＋数据范围Grant、按部门角色分配、案件资源成员、授予上限、下一请求生效、会话撤销、授权来源解释和全量变更审计；权限配置不能创造新功能或绕过阶段、材料、金额、合并和归档守卫。

同轮确认客户按企业／个体／自然人／其他组织匹配正式证件和最低信息，准入至少包含一位联系人及一种联系方式；身份优先公司单一SSO／OIDC，无SSO时使用管理员开通的实名内部账号；客户证件使用部门隔离的私有对象存储，限定PDF/JPG/PNG、20MB／文件、10个／次并保留版本；知产与品维使用共享PostgreSQL／共享表按部门强隔离，客户档案及精确判重按部门独立。TD-BASE升级为04，新增TD-AUTHZ-01并将客户基础更新为rev2。

静态核对实际结果：27份Spec Markdown、52个唯一REQ且无重复、54个唯一AC引用、11个BQ和SD-01～33连续；本地链接失效0处、Markdown表结构错误0处。项目Node v24.21.0、Corepack pnpm 11.27.0与锁定值一致；最终受影响文档Prettier、上下文记录／检查、Git差异空白和暂存差异检查通过。

本轮只修改业务／技术设计、就绪／缺口／覆盖／后续设计和项目状态文档及上下文快照；没有创建账号、权限后台、业务schema、迁移、存储Adapter、客户页面或可执行测试。认证、部门隔离和敏感证件属于Q2范围，实现前仍需独立安全设计复核；E01实际身份参数、E02实际存储条件和明确编码授权仍未满足。纯文档任务未运行代码单元测试、构建、E2E、数据库或外部联调。

## TD-CU-001客户基础最小技术设计与编码准入（2026-09-16）

用户引用会话`6aaa6599-aff4-83eb-8f99-18fc03b227ae`并要求“根据回答执行”。本轮在既有DOMAIN、DECISIONS、READINESS和TD-BASE-03内新增TD-SLICE-CU-BASE-01，范围限定为运营端客户列表、新建／编辑、判重、草稿保存、资料准入校验和详情。设计比较了单一客户Module、拆分准入Module和通用CRUD三种形状，采用单一深Module；明确客户资料状态与合作状态分离，并完成页面、Module Interface、HTTP／OpenAPI映射、事务／并发／幂等、权限／材料／审计、错误码和测试场景。未复制字段表，未扩展联系人、主体、资产、协议、合作状态动作、案件、结算、审批中心、通用工作流或完整文件中心。

编码准入结论为`BLOCKED`：仍需客户建草稿／编辑／准入的角色和数据范围、正式证件类别及最低信息、E01身份／会话条件、E02文件存储条件，以及DD-09分库或共享库决定。逻辑判重范围已固定为同一业务数据范围，物理唯一约束随DD-09落地；这些输入缺失不能用演示账号、内存附件或前端校验替代。本轮没有创建业务schema、迁移、Nest模块、HTTP端点、Vue页面或可执行客户测试。

静态核对实际结果：27份Spec Markdown、50个唯一REQ且需求标题无重复、52个唯一AC引用、11个BQ和27个SD；项目Node为v24.21.0，Corepack解析锁定pnpm 11.27.0。最终全仓Prettier、上下文记录／检查、`git diff --check`和暂存差异检查通过；上下文检查包含本地链接校验。启动时普通`pnpm`仍命中Codex后备11.19.0／Node24.19.0并被引擎门禁拒绝，随后按环境报告使用项目Node和Corepack；未安装依赖或修改运行时。

本轮仅修改技术设计、业务词汇／索引、准入、覆盖、后续设计、项目状态、验证记录和上下文快照；保留已有Demo及其他未提交差异。纯文档任务未重跑代码单元测试、构建、E2E、数据库或外部联调；设计通过静态检查不表示功能已实现、业务已验收或已获编码授权。未提交或推送。

## BR-006补问决定与简单性收口（2026-09-16）

用户确认BR-04补问全部采用建议，并补充“不要设计太复杂不好用”。本轮新增SD-22～27：客户信用代码重复阻断／名称重复说明后继续／无证件草稿／历史关系只读，正常16阶段与历史补录，案件三层动作矩阵和旧律师只读，文件90天恢复及引用版本作废，金额已知／待定／非负／0元不发指令／累计退款上限，以及不迁移源数据的可解除合并办理组。受控动作直接填写原因并审计，不新增审批单、审批队列、多级审批状态、替代主案或数据复制。

决定已同步到BUSINESS-REVIEW、CONTEXT、DOMAIN、CROSS-MODULE、GAPS、READINESS、TECHNICAL-DESIGN、相关模块REQ／AC、准备包、覆盖与一致性记录及后续设计INPUT-010。TD-BASE升级为TD-BASE-03；客户基础、历史补录、合并办理组、金额基础和文件生命周期列为可分别进入TD-SLICE设计评审，仍不等于编码授权。原BR-03工作簿保持只读且未改写。

最终静态审计实际结果：27份Spec Markdown、50个唯一REQ且无重复、52个唯一AC引用、11个唯一BQ、SD-01～27连续；本地链接失效0处、Markdown表列数错误0处。项目Node v24.21.0下最终`context:record`和`context:check`通过，共153个跟踪文本；全仓Prettier、`git diff --check`和`git diff --cached --check`通过，暂存区为空。

本轮只修改业务与技术设计文档、项目状态和上下文快照；没有修改Demo或正式系统代码，没有创建业务类型、API、Prisma模型、迁移、页面或可执行验收测试。纯文档任务未运行代码单元测试、构建、E2E、数据库或外部联调；文档准入只允许下一步设计，不证明功能已经实现。

## BR-005业务回件回填、差异收口与准入重评（2026-09-16）

原始回件按原字节保存为[evidence/BR-03-return-2026-09-16.xlsx](evidence/BR-03-return-2026-09-16.xlsx)，SHA256为`3C0D63BE0FF9FC2B811949859A3AB295CAE0DC66302F4254A36FC883316BD950`。只读核对结果：工作表为“业务审核”和“案件阶段门槛”；BQ-01～11共11行均有业务反馈，只有BQ-02在结论列明确选择“同意建议”；审核人和日期非空数均为0；辅助页有16个正常案件阶段。表头公式仍为`COUNTA(E7:E17)`和`11-E3`，只统计结论列，不能作为回复数或真正收口数。本轮没有代填审核人、日期或其余结论，也没有改写原工作簿。

[BR-04回件整理](BUSINESS-REVIEW.md)按子问题而非整行回填，[SD-11～21](DECISIONS.md)只承接明确文字；领域字段、关系、动作、模块REQ／AC、跨模块约束、缺口、就绪清单及后续设计输入同步更新。TD-BASE升级为TD-BASE-02，并增加结算／律师费发票字段准备和可恢复删除技术缝；它们是TD-PREP，不是schema、API或编码准入。重评结论是当前没有完整业务切片满足端到端TD-SLICE门槛；剩余问题收缩为五组最小补问，正常16阶段、历史补录、案件合并、完整结算和文件生命周期均不可提前实现。

最终静态审计实际结果：27份Spec Markdown、50个唯一REQ、52个唯一目标AC、11个唯一BQ、21项SD；本地链接失效0处、Markdown表列数错误0处。回件证据哈希与登记值一致，工作簿事实复核仍为11组回复、0个审核人／日期、16个阶段。项目Node v24.21.0下完成最终`context:record`和`context:check`，共153个跟踪文本；全仓Prettier、`git diff --check`和`git diff --cached --check`通过，暂存区为空。常规`pnpm`仍解析到11.19.0而非锁定的11.27.0，因此未使用该入口，也未改运行时或依赖。

本轮只修改Spec、后续设计清单、项目状态、上下文快照并保存原始回件证据；没有修改Demo或正式系统代码，没有创建业务类型、API、Prisma模型、迁移或可执行验收测试。纯文档任务未重跑代码单元测试、构建、E2E、数据库或外部联调；结构检查不等于业务验收或实现完成。

## CTD-001字段／流程／依赖收口与TD-BASE-01（2026-09-16）

本轮不复制字段和流程正文：[DOMAIN](DOMAIN.md)新增字段组→BQ→TD收口索引，[ACTIONS](preparation/ACTIONS.md)新增流程切片→业务阻断→技术依赖索引，[READINESS](READINESS.md)区分TD-BASE、TD-SLICE和编码准入。[TD-BASE-01](TECHNICAL-DESIGN.md)完成T01～08不依赖待决业务规则的通用设计；GAPS和后续设计清单保留所有BQ／E阻断及未产出TD-SLICE的状态。

静态核对实际结果：27份Spec Markdown、49个唯一REQ、51个唯一目标AC、11个唯一BQ；`context:record`及`context:check`通过，共153个跟踪文本，本地链接无报错；全仓Prettier检查、`git diff --check`和`git diff --cached --check`通过，暂存区为空。启动时常规`pnpm`仍命中Codex后备11.19.0／Node24.19.0而被引擎门禁拒绝；随后在点加载项目Node24.21.0后直接通过Corepack核对pnpm11.27.0，并使用项目Node直接执行现有检查脚本与Prettier；未改运行时配置或安装依赖。

仅修改Spec、架构链接、后续设计清单、项目状态和上下文快照；没有改Demo或正式代码，未新建API、业务类型、Prisma模型、迁移或可执行业务测试。因为是纯文档设计任务，本轮未重跑代码单元测试、构建、E2E、数据库或外部联调；TD-BASE不冒充这些机制已实现或验证。

## BR-004 Demo基线分流与11项业务审核表（2026-09-16）

用户授权把Demo足以确认的内容先处理，等业务表返回后再补剩余11项。SD-08将清晰、一致且无已知问题的字段、状态和正常流程写入目标Spec，已知缺陷继续按纠偏处理；B02、B06、B07和B09可确定部分不再交给业务人员。旧Excel已经填写的首期OCR、首期不依赖公证／财务自动对接和分批开发三项答案已固化为SD-09/10，没有因删题丢失。当前唯一业务入口为BR-03的BQ-01～11，案件16阶段只作为BQ-06辅助表，不计为额外问题。

原工作簿被其他进程占用，未强制关闭或覆盖，另生成`正式系统业务审核问题清单-11项.xlsx`。Artifact Tool复核两张工作表：主表11项、阶段表16行；结论列提供“同意建议／修改／暂缓决定／不纳入首期”下拉。完成数公式空表显示0/11，临时填写一项后正确更新为1/10；最终公式错误扫描0项。两张工作表均重新渲染并人工检查，未发现截断、低对比、空白页或明显布局问题。

静态审计实际结果：26份Spec、49个REQ、51个目标AC、11个唯一BQ、16个阶段、46项固定证据哈希，本地链接及哈希错误均为0。项目Node下Prettier、最终上下文快照与Git差异空白检查通过；Demo和正式代码未修改，未运行代码测试、构建、E2E、迁移或部署。业务表未回复的11项不视为批准，也不把文档完成当成可直接编码。

## BR-001 全量业务审核稿验证（2026-09-16）

按用户要求取消三轮业务问答，使用单一[全量业务审核稿BR-02](BUSINESS-REVIEW.md)承载全部问题，不再生成后续分轮审核文件。文档列出19项已确认方向和BR-01～BR-36连续问题，按六个业务主题组织，内部附录覆盖B01～B24；技术设计T01～T08明确不交给业务人员选择。建议、已确认和外部资料清单分开，未回复不视为批准。

静态检查实际结果：26份Spec文档、36个连续BR编号、519个本地链接、35张Markdown表、46项固定证据哈希，错误0；152个文本的context:record／check、全仓Prettier检查及Git差异空白检查通过。Git读取用户全局ignore仍提示权限警告，但命令退出0。环境入口问题按用户要求未修复：本轮使用已核对的项目Node v24.21.0直接调用既有检查脚本和本地Prettier，不运行不匹配的pnpm 11.19.0。仅编制业务审核文档，未执行代码测试、构建、浏览器、迁移或外部写入。

## DOC-001 文档整理验证（2026-09-16）

删除重复的Spec进度页及模块目录：目录导航合并至README，进度事实由项目状态、此页历史记录及CONSISTENCY承接。保留准备包的独立关系／动作证据；不新增清理报告或备份。Spec现25份、49REQ、51个未执行AC，固定46项哈希一致，Spec本地链接检查无错误。删除的是未提交的生成文档，不依赖Git恢复；必要内容已迁入／保留于上述文档，未承诺原文件可由回收站恢复。

启动pnpm入口误用Codex后备11.19.0／Node24.19.0，命令被引擎检查拒绝；未安装或修改任何工具。改用点加载入口后已核对的Node24.21.0，直接调用既有scripts/context-memory.mjs与node_modules/prettier/bin/prettier.cjs，未使用不匹配pnpm继续执行项目脚本。启动快照153文本通过，整理后重新登记快照；全仓Prettier检查与Git差异空白检查通过。Git用户全局ignore读取有权限警告，仓库差异检查仍返回0；未进行提交／推送。仅文档变更，未跑业务测试、构建、浏览器或迁移。历史验证的文件数保持其当时范围，不改成当前数字。

## SPEC-002／PREP-1 补证验证（2026-09-16）

- 启动恢复检查通过：150个文本，Node v24.21.0／pnpm 11.27.0；无.codegraph目录，直接复用文档和定点源码读取。
- 新增preparation下3份文档；同步术语／领域模型／缺口／就绪／输入登记及状态，没有增加已确认要求。只读审计：27份Spec、49个REQ、51个目标AC、510个本地链接、30张表，未发现重复REQ、失效引用或表格列数错误；46项固定SHA256（5个Demo＋41份反向文档）全部一致。
- Git差异与暂存空白检查通过，暂存区为空；保留既有Demo、架构及其他文档差异，未提交／推送。固定证据哈希证明本轮未改写，而不是用Git相对HEAD的既存差异推断本轮变更。
- 格式化仅本轮新文档和修改文档；context:record和context:check通过，153个受跟踪文本；format:check通过。回填本验证结果后再次记录／检查快照及格式。无代码／配置变更，未重跑业务测试、构建、浏览器、E2E、迁移或部署；六个P样例只是审核输入，不计入已执行测试。
- 本轮未调用独立代理，结论为主代理静态核对。未对全部源码再做全文阅读或动态穷举；范围及引用方式见preparation/README。业务选择未决定的条件仍保留B/T/E，不能宣称全部模块可设计。

以下为SPEC-001历史报告，其24份／476链接等数字不代表PREP-1当前规模。

日期2026-09-16；版本v0.1-draft.1。全量业务审核草案完成文档验证；不是正式业务验收通过。

## 本轮实际执行范围

- Node v24.21.0、pnpm 11.27.0，与项目锁定值一致；启动时126文本上下文检查通过。
- 读取11模块事实和候选、案件字段字典及聚合／决定／纠偏／缺口；固定五文件与41份证据指纹。
- 主链定点源码核查、独立主链目标审查见CONSISTENCY；不重复执行旧Demo观察。
- 临时只读Node审计实际输出：24份Spec、49条唯一REQ、51个唯一目标AC；REQ引用及同号AC无缺失／重复，73项候选、12BD、27FIX、12G、18U均有覆盖。另有AC-CA-010阶段表、AC-SH-005金额／日期补充场景。
- 同次扫描23张Markdown表列数一致，476个本地文档链接可解析；46个SHA256匹配（5个Demo文件＋41份固定反向证据）。这是结构和版本检查，不是逐条语义自动证明。
- 三个独立只读代理的源码核查、主链审核和全量审查及修订见CONSISTENCY；确定错误已修订，业务取舍仍保留GAPS。
- `pnpm context:record`后`pnpm context:check`通过，150个文本文件，包含新增24份Spec；`pnpm format:check`通过。记录检查点不是需求批准或测试通过。
- `git diff --check`、`git diff --cached --check`通过，暂存区为空；Git提示既有文件LF将转CRLF，仅为行尾提示，无空白错误。本轮无提交、推送或清理；已有Demo及架构差异保持原样，哈希检查验证Demo没有本轮变化。
- 仅格式化新Spec与受影响项目文档，没有格式化固定证据。报告回填后再次记录／检查最终快照和格式，不沿用过期快照。

文档任务按AI开发规范执行；审计通过不把条件性AC变成可直接执行测试。共有51个目标AC与前轮51个Demo观察只是数量巧合，集合、目的及执行状态完全不同。

## 明确未执行

未修改Demo；未生成API、业务类型、数据库模型、迁移、正式业务代码或可执行测试。未进行真实财务、公证、AI、身份和存储集成；未执行生产操作。目标AC全部未执行，本轮未新运行浏览器、代码测试、构建或E2E。

静态检查证明格式、引用和映射结构，不证明业务语义自动获准或正式系统已满足验收。未解决项保留GAPS，模块准入见READINESS。

# PERSONNEL-ACCESS-001 人员与已有角色管理聚焦验证（2026-09-20）

本切片在`codex/personnel-access-management`隔离worktree实现。已执行的开发期聚焦证据包括：后端认证与访问控制10个Jest套件、87项测试通过；前端18个Vitest套件、134项测试通过；`pnpm check:fast`通过；前后端生产构建通过。

独立测试库`dev_cor_test`的数据库型Playwright共6项并通过：管理员从正式页面创建第二位人员后，数据库存在账号、散列凭据、当前部门成员、Team范围角色和创建审计，新人员可用真实密码登录；活动Team角色阻止直接调队，页面提示先撤权，撤权后保留目标Team并可直接调队；管理员只填写目标新密码即可重置，旧密码随后被拒绝、新密码可登录；账号、部门成员和角色启停在下一请求生效且旧会话不复活；自操作、跨部门和多部门全局账号变更被拒绝；审计写入失败时账号、凭据、成员和角色创建整体回滚。验收人员不是由测试夹具直接插入，夹具只准备首位管理员、两个Team、两个角色模板及跨部门负向目标。

首轮Level 3 Review报告4项Important和1项Minor：无读取权限时的页面可见性、失败请求后的密码清理、管理上下文严格解析、数据库负向覆盖和调队目标保留。对应实现和回归测试已补齐；最终结论仍以固定候选复审为准。

第二轮复审确认上述问题关闭，并新增2项Important：调队冲突后原生选择框无法对已保留的同一目标再次触发，以及九个组织接口缺少成功响应OpenAPI模型。页面现会在停用冲突角色后自动重试所保留的Team变更，真实浏览器不再需要重复选择；组织查询和八个写接口均声明具体成功响应DTO，并由生成OpenAPI文档的契约测试逐路由检查JSON schema引用。最终结论仍以新固定候选复审为准。

固定代码候选`4cb7329`的最终Level 3结果：完整`pnpm verify`通过，包含工具55项、前端140项、后端195项以及类型、Lint、格式和生产构建；独立测试库人员E2E 6项、认证E2E 4项、完整E2E 54项全部通过。最终隔离复审结论为`ACCEPTED`，Critical／Important／Minor未关闭数量均为0。该证据仅绑定`4cb7329`；其后的文档性收口不改动已验证代码。未执行推送、合并、发布或生产数据库操作。

本记录不提前声称最终Level 3候选已通过完整`verify`、完整E2E或Review；这些结果以固定干净候选的树外证据和最终交付报告为准。未执行生产迁移、推送或发布。

# CORE-LD-002 运营推送至真实客户端审核（2026-09-22）

固定代码候选为`6be15b2`，tree为`f71f44e4db09699f310e608e135254204ea3679e`。实现范围严格限定为`WAITING_PUSH → WAITING_REVIEW`：新增真实企业客户账号与客户企业绑定、复用本地密码和Cookie会话、服务端固定企业数据范围、`LEAD_PUSH`内部授权和客户专属读取边界；推送Command在同一事务中校验状态、客户准入、有效商品、有效绑定账号、操作者范围、`expectedVersion`和`idempotencyKey`，并写入推送事实、成功审计和幂等回执。正式页面包含管理员在客户详情创建／绑定账号、运营在线索详情推送、客户端待审核列表／详情和允许附件读取；未实现确认侵权、不侵权归档、批量推送或完整门户。

数据层使用两份前向迁移`20260922009000_add_client_identity_actions`和`20260922010000_add_client_accounts_and_lead_push`。独立测试库目标经只读确认是`dev_cor_test|dev_cor_test`后，从空库重新创建并依次成功应用全部24份迁移；同一代码候选的迁移专项还验证上一支持schema升级、脏数据拒绝和失败阶段回滚。数据库延迟约束保证已提交CLIENT账号恰有一个企业绑定，触发器阻止客户账号获得内部成员／角色以及内部账号获得客户绑定。

正式`pnpm verify`在同一tree通过：`context:check:strict`、53个REQ／55个AC／11个BQ／37个SD、架构、全仓类型、ESLint、Prettier、工具71项、后端Jest 499项、前端Vitest 253项及前后端生产构建全部成功。正式`verify:slice:core-ld`也在同一tree通过并生成Evidence v2：后端308项、前端147项、架构／类型／ESLint、Slice格式、后端构建和真实PostgreSQL／Chromium 18/18；证据位于Git common目录`dev-cor-validation-evidence/f71f44e4db09699f310e608e135254204ea3679e.json`。

同一最终代码tree的完整数据库型Chromium E2E为76/76。主链由管理员创建并绑定真实客户账号、运营创建／选择待推送线索并推送、运营端显示待审核和推送记录、退出运营账号、客户以真实密码登录、只见本企业已推送线索、打开详情和下载附件、刷新后状态持续存在。负向覆盖其他企业和待推送线索不可见、无`LEAD_PUSH`、未绑定／停用账号、客户非ADMITTED、错误状态、无有效商品、同键重放／异参冲突、旧版本／并发竞争、审计或回执失败整体回滚，以及账号／绑定撤销后下一请求立即失效。

独立Review首轮发现内部角色请求DTO仍可接受客户专属`CLIENT_LEAD_READ`这一项Important。修复后，内部可分配Action由后端共享集合统一驱动目录、响应DTO、请求DTO和OpenAPI，服务绕过DTO也会在事务前拒绝客户专属Action；`LEAD_PUSH`保持可分配。最终复审结论为`ACCEPTED`，Critical 0／Important 0／Minor 0。未执行远端推送、main合并、发布、生产迁移或任何生产数据操作；生产对象存储E02仍是上线前置，不否定本地／测试闭环完成。

## CORE-LD-002 快速上手 UX 硬化（2026-09-22）

固定代码候选为`667da39`，tree为`4fe53798ef755ca7cab59ff3b0427f833a60a6fb`。本轮不改变CORE-LD-002的业务状态、权限范围或企业隔离；新增可访问的必填标识和未保存离开保护，统一客户／权利人／线索／客户端术语，唯一权利人自动带出，条件必填和输入限制在操作前可见，停用与推送均预先说明实际影响；后端增补只读派生的`pushedByDisplayName`，运营页不再向用户暴露推送人UUID。客户端仍只读，未实现CORE-LD-003／004或完整客户门户。

独立UX Review首轮发现Critical 0／Important 4／Minor 3，两轮修复补齐团队停用实际撤权影响、商品增删脏状态、放弃草稿后的状态清理、条件必填及输入帮助的`aria-describedby`关联；最终复审为`ACCEPTED`，Critical／Important／Minor未关闭数均为0。

同一代码tree的正式`verify:slice:core-ld`通过：后端Jest 309项、前端Vitest 155项、架构／类型／ESLint／Slice格式／后端构建全部成功，真实PostgreSQL／Chromium 18/18通过。Evidence v2位于Git common目录`dev-cor-validation-evidence/4fe53798ef755ca7cab59ff3b0427f833a60a6fb.json`。为用户手动测试启动的本地服务曾占用3101端口，关闭手动服务后重跑可稳定通过；业务测试本身无端口依赖回归。

记录上述代码证据和状态后的收口候选`d20675d`、tree`03ac4e412281e1c736973536509b3d5add847887`通过完整`pnpm verify`：上下文严格检查、53个REQ／55个AC／11个BQ／38个SD、架构、类型、ESLint、Prettier、工具71项、后端Jest 500项、前端Vitest 268项及双端生产构建均成功。随后只补写本验证记录并重录上下文，不改动已验证代码。

## 客户详情页组织 CORE-CU-001（2026-10-08）

实际业务候选`3c967934607c68e85b51f357b23382c83045cd13`，tree`5426d057856a7c3ce731c170c7854d00ca8df126`。仅前端详情三个页签、基本信息子面板状态保留、客户路由切换与迟到请求／事件保护；直接面板事件带来源客户ID。未改变API、权限、数据库或已有业务门槛，资产／结算页签仍明确说明尚未交付，不显示假金额或动作。

普通UI按项目路由派发gpt-6-luna执行并自审；实际底层模型不可观测。直接页面／主体／准入面板Vitest56/56、前端prepared类型及改动格式检查通过。固定候选客户Level 2正式scope最终退出0：后端46/46、前端43/43、架构／全局类型／ESLint／切片格式／后端构建成功；隔离PostgreSQL与Chromium30/30，真实创建→三页签切换→未提交主体表单仍保留→编辑→刷新与审计验证通过。Evidence v2已由原runner记录该tree；原始报告／四次scope日志在`.local/customer-alignment/`。不把scope结果扩大为完整客户模块或Level 3验收。

失败历史保留：首次在Docker未运行的指纹检查处结束，未执行测试；第二次静态／单元／构建通过，Docker重启后的tmpfs测试public为空，30项E2E均在准备阶段失败；只在独立测试库补齐91条现有迁移，无reset/drop，人工／开发／生产库未迁移。第三次29/30，新增取消按钮定位误用form（实际dialog）导致超时，页签与草稿断言已通过；修正测试定位后第四次正式scope30/30。重复正式门禁分别由数据库准备修复和测试输入修正触发，没有冒用失败候选证据。

Docker由用户打开后恢复，引擎及原人工数据卷保留；原人工5181/3201/55434已恢复、登录页和直连／代理健康均200。旧人工构建副本保持原版本，未自动更新。后续002～008尚未交付，本轮没有推送、合并或部署。

## 人工权利资产 CORE-CU-002（2026-10-08）

实际正式候选`f0ce8417106abdf6e478266f49b5fd92f268fe26`，tree`cee48539db5f773d400984d93c637403d2e8fbc5`；门禁前后HEAD／tree与干净工作区一致。只实现人工资产登记、修订、独立授权撤下、不可变历史、当前客户授权及冻结原请求的幂等恢复。新撤下动作不自动授予旧角色；无证明文件、批量或OCR能力，不扩展为整个客户模块完成。该候选按当时SD-48未新增客户经理资料字段；2026-10-09的字段语义澄清不改变本候选实际验收范围。

高风险Task由gpt-6-sol实现，另一非实现Sol复核。原候选a5e4c60被判REJECTED（C0/I4/M0）；b466c70、454420c修复409保稿／明确刷新、未知结果原body和键、迟到详情竞争及指定并发／SELF／错主体证据。最终454420c复审ACCEPTED，未关闭C/I/M为0，报告`.local/customer-alignment/task-2-review.md`保留原结论与逐项关闭证据。此为同模型隔离审查，独立性不足；外部异模型Review仍Pending，本轮未执行，不能称外部独立Review通过。

正式完整`pnpm verify`第二次退出0：严格context、Spec（56REQ／62AC／11BQ／48SD）、架构（11模块／82模型）、全局类型、ESLint、格式、工具74/74、前端727/727、后端1085/1085及双端构建通过。日志`.local/customer-alignment/task-2-f0ce841-verify-attempt2.log`。第一次只因Git忽略但被全仓Prettier扫描的`.superpowers/sdd/progress.md`格式失败；仅格式化该树外记录后重试，候选业务tree未变，失败日志`task-2-f0ce841-verify.log`保留。原有前端大chunk提示和JSDOM导航提示未变为测试失败。

同一候选按既有资源互斥入口运行`pnpm test:e2e tests/e2e/customers.spec.ts tests/e2e/customer-right-assets.spec.ts`，真实隔离PostgreSQL／Chromium45/45，退出0，日志`.local/customer-alignment/task-2-f0ce841-customer-assets-e2e.log`。覆盖客户／主体既有路径、同键重放、不同键同版本竞争仅一次提交、SELF正向及越范围拒绝、撤权下一请求失效、数据库历史／指针／日期守卫和注入审计失败后的完整回滚。注入失败的500属于预期断言。资产UI场景使用现有测试身份及session界面桩，业务API和数据库真实；不以该场景声称真实密码登录或私有文件流程已验证，后者属于003。

迁移专项在同一候选通过既有环境解析和共享测试资源锁，在测试库随机schema执行91条旧迁移到95条完整空库链、合成旧数据升级保留、DDL失败回滚与重试、跨部门及同部门另一客户主体FK负例，全部true且退出0。日志`.local/customer-alignment/task-2-f0ce841-migration.log`；环境指纹`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`。只有隔离测试public升级至95条，未reset／drop public。初次开发数据库E2E触发42703后以第四条前向迁移修复，旧已执行迁移未编辑；原控制台在工具记录中，首次Playwright报告已被覆盖，不冒称仍保留。开发期RED／GREEN及精确文件清单见`.local/customer-alignment/task-2-report.md`。

门禁后仅补记project-status、roadmap及本验证记录中的完成状态／实际证据和对应已解释快照；未改业务契约、代码、测试输入、迁移或环境。收口执行累计diff、文档格式、Spec、严格context专项，并保留实际候选的业务证据，不称文档收口HEAD实跑完整门禁。001～002仍为本地分支成果，没有推送、合并或部署；人工5181/3201/55434保持旧构建与数据，未自动迁移。

## 权属文件与批量人工登记 CORE-CU-003（2026-10-08）

实际通过正式门禁候选`dee738770465465efe30a8b3fa1c77f26ecb8c34`，tree`dff96949cc55819e1f9ba849a259ae146d8c2ca7`；各项前后HEAD／tree和干净工作区一致。PDF/JPEG/PNG真实权属证明与资产不可变版本、精确引用和历史下载接通；逐条人工核对后显式选择登记，上传成功与登记成功分开，不造号码／日期或识别结果。每版最多10份，当前未登记池按当前文件版本计数，历史冻结不占当前池。

非实现Sol初审bf158cb为REJECTED（C0/I2/M0）：完成10行后不能继续下一批、同一行重复上传耗尽配额。59ebc3e修复，面板20/20及前端类型／两文件Lint和格式通过；复审关闭两项，C/I/M为0。未知PUT禁止盲重传，通过当前客户证明池的真实元数据、精确下载和人工选版恢复；未登记结果未知仍保存原body/key，403／404不能证明原写未发生。若池中无可核对版本，则保持未知并由管理员核查。原95版省略附件的指纹和回执兼容；后来增加附件后仍重放首版事实。审查与修复证据见`.local/customer-alignment/task-3-review.md`、`task-3-report.md`及`task-3-fix-report.md`。同模型隔离独立性不足；外部异模型Review Pending，不表述为外部Review通过；八片组合Final Review仍待全部实现后执行。

第一次正式`pnpm verify`在52ebcf6的架构阶段失败两项，测试和构建尚未开始；资产服务与测试直接导入材料内部文件。334f3d7仅改两处导入为既有公开出口，架构、资产Jest9/9、后端类型及定向Lint／格式通过，非实现Sol受影响补审ACCEPTED（C0/I0/M0）。原失败日志保留`.local/customer-alignment/task-3-52ebcf6-verify.log`，导入修复报告为`task-3-import-fix-report.md`。

实际候选dee7387完整`pnpm verify`退出0：严格context／Spec（56 REQ、62 AC、11 BQ、48 SD）、架构（11模块、82模型）、Prisma生成、全局类型／Lint／格式、工具74/74、前端735/735、后端1094/1094及双端构建全部通过。既有JSDOM导航提示、NO_COLOR／FORCE_COLOR及863.92kB大chunk提示为非阻断。日志`.local/customer-alignment/task-3-dee7387-verify.log`。

隔离数据库／Chromium组合`customers.spec.ts`、`customer-right-assets.spec.ts`、`customer-right-evidence.spec.ts`、`core-leads.spec.ts`、`case-judgment.spec.ts`共112/112退出0（3.9分钟），经既有E2E互斥，只使用15433／5174／3101；覆盖客户与主体／资产、真实证明文件与旧字节、运营／客户端／公证处／律师现有材料链路、隔离、撤权、并发及失败原子。003专用5项使用真实密码登录、session cookie及CSRF，未替换`/auth/session`；其他既有用例同时保留fixture身份，不把全部112项称为真实密码登录。真实审计／引用／回执写入失败的500为故障注入预期断言。日志`.local/customer-alignment/task-3-dee7387-customer-material-case-e2e.log`。

临时迁移专项在同候选通过既有环境解析和E2E资源锁，测试库随机schema全97条空链、旧95条合成客户／资产／旧回执／材料升级保留、DDL失败回滚及重试、SQL所有权／引用／不可变守卫，以及同一Material的V1已冻结而当前V2仍占待登记池的反例，全部true并退出0。日志`.local/customer-alignment/task-3-dee7387-migration.log`，环境指纹`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`。仅测试public前向升至97条，无reset／drop public。开发期迁移探针的保护码预期／缺合成回执，以及浏览器fixture漏id／登录等待／重复定位失败均如实留在实现报告；原输出在工具记录中，不伪称被覆盖的旧Playwright报告仍存在。

门禁后收口只补project-status、roadmap、本验证记录的真实完成状态／证据及其快照；不修改业务契约、源码、测试、迁移或环境。按非执行性收口例外核对从实际候选至收口的累计diff并执行文档格式、Spec和严格context检查，复用原业务候选证据，不称文档收口HEAD实跑完整门禁。001～003均为本地成果，无推送、合并或部署；原人工5181／3201／55434仍为旧构建与数据，未自动迁移。

## 客户草稿生命周期 CORE-CU-004（2026-10-09）

最终工程及相关业务回归实际候选`a58ff3a1a546b68381e279ab2259fdb8c42ba2e9`，tree`a03d8f63e4d6df2dab25949222bba36f93bbdf1e`，前后HEAD/tree及tracked工作区稳定。只允许从未准入且没有任何业务关联的DRAFT软删除和独立授权恢复原ID；曾准入永久锁存、身份唯一占用、普通入口tombstone拒绝、事务审计/事实/回执、原键原体的未知结果恢复均实现。三个前向迁移98～100不改写已执行历史，删除/恢复动作不自动授权。

业务初审6bfaf072为REJECTED（C0/I5/M1，含root补充两项）：回收列表分页/身份恢复定位、真实认证和合法SQL反例证据、准入/主体回执父锁及组合FK、曾准入守卫OLD值与触发器顺序，以及准入成功后删除按钮。ecfe0f56修复候选非实现Sol补审ACCEPTED，全部关闭，未关闭C/I/M为0；报告`.local/customer-alignment/task-4-review.md`。同模型隔离独立性不足，外部异模型Review Pending，不称外部Review通过。其后生产代码/迁移不变，普通fixture Task按项目路由自审、聚焦测试及root差异核对；八片最终组合Review仍待全部切片完成。

最终`pnpm verify`退出0：严格context、Spec（56REQ/62AC/11BQ/48SD）、架构（11模块/84模型）、Prisma生成、全仓类型/Lint/格式、工具74/74、前端740/740、后端1094/1094及双端构建。日志`task-4-a58ff3a-verify.log`。已有JSDOM导航、NO_COLOR及876.66kB前端chunk提示非阻断。

同候选通过统一资源互斥执行明确六文件组合：`case-hearing-database.spec.ts`、`case-hearing.spec.ts`、`case-judgment-database.spec.ts`、`case-judgment.spec.ts`、`core-leads.spec.ts`、`customer-lifecycle.spec.ts`，真实隔离PostgreSQL/Chromium79/79，退出0，4.2分钟。日志`task-4-a58ff3a-related-e2e.log`，前后环境文件`task-4-a58ff3a-environment-before.json/-after.json`；HMAC指纹`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`，仅15433/5174/3101。生命周期11项中专门真实密码cookie/CSRF用例覆盖删除已提交响应丢失、刷新/重登、撤权拒绝且保原请求、重授后原键回放、恢复和21项分页；其余底层用例保留fixture身份，不称全部79项为真实密码登录。判决/开庭局部合成样例只证明客户父约束与局部写入，完整运营/企业/公证处/律师流程由独立真实API链路覆盖。

失败历史与修复范围：f9cd4f8完整verify因前端权限目录旧样例9项失败；af2a138只同步两个新动作。06f9420完整verify因OpenAPI缺生命周期service桩及后端目录数量旧断言，后端33项失败；12518b4只修两测试文件。f598a52完整verify成功，但全量E2E为111失败/100通过：110项旧core-lead清理遗漏生命周期fact/receipt，1项旧判决样例使用不存在的客户ID。010b6f4只修清理依赖顺序、合法DRAFT父行及清理回归。22d1f6e完整verify成功、全量E2E为211通过/1失败（14.9分钟），剩余开庭seed仍用随机不存在客户。6566a94仅修改`case-hearing-database.mjs`固定客户映射和seed，origin下核验两部门实际ADMITTED父记录，生产守卫/共享cleanup不变；定向开庭3/3及类型/Lint/格式通过。对应原始日志、报告、trace在`.local/customer-alignment/`，失败产物复制到`task-4-f598a52-failed-e2e-results/report`及`task-4-22d1f6e-failed-e2e-results/report`。不将211/212或旧失败日志冒称最终全量通过；依据最后修复仅局部测试函数且生产输入不变，最终稳定候选执行完整verify和上述直接相关组合，不伪造自动affected范围。

正式迁移专项实际候选`22d1f6e616e3b8c7f8c2652e79204c10f39afa8f`，tree`c756ec44c9cae8b05865a9dc793134405d72424b`，日志`task-4-22d1f6e-migration.log`。helper自行解析测试环境并持有共享E2E资源锁，在随机schema验证100条空链、97→100客户8→8、旧回执整行JSON及CU003证明元数据/当前指针保留、98～100错误DDL整体回滚/重试、合法child INSERT/UPDATE对已删除父行的目标23514、永久曾准入OLD/NEW守卫，退出0，指纹同上。元数据保留不扩大成文件字节验证，真实旧字节由CU003文件E2E独立覆盖。合法case必须先有同客户lead/matter，因此不构造“空草稿合法case”并以FK失败冒充删除竞争。22d1f6e至a58ff3a累计差异只有开庭fixture seed、状态和快照，schema、所有迁移、专项helper和环境输入均未变，保留此实际迁移候选证据，不称a58ff3a重跑了迁移。

本地只将测试public前向升级100条，未reset/drop public或操作开发、生产、人工库。人工数据库使用原持久卷改绑15434，仍91条迁移；退出的服务监督进程仅用原旧构建脚本恢复，登录页/后端/代理200，未重置密码或重复登录，证据`.local/manual-test-20261008/service-recovery-verification.json`。人工5181仍旧CA-008版本，不能用于验收新增CU能力。未推送、合并、部署。

门禁后收口仅project-status、roadmap、本验证记录的真实完成状态/证据与对应已核对快照；从a58ff3a核对提交链和累计diff、暂存/未暂存及未跟踪现场，执行文档格式、Spec和严格context。业务契约/代码/测试/迁移/配置不变，按非执行性收口例外保留原候选证据，不称收口HEAD实跑过旧候选门禁；005计划及契约将另行提交，不混入本例外。

## 负责运营与合作状态 CORE-CU-005（2026-10-09）

正式业务门禁实际候选`4922f9f8e56e1e1954fc9f49e171f69cde70ca6f`，tree`7afbc6efbfbfa01b1d20f4a7fac8a4cea7d2855f`。按Level2显式检查，未临时伪造scope，也不称完整verify或全量数据库E2E已执行。只维护负责运营、独立配置的转派/暂停/终止/恢复动作；目标同部门有效内部成员，不自动改团队或Grant。暂停/终止阻止新线索，现有状态机下存量业务继续。当前read/动作范围先于幂等回放，未知/BUSY保原键原体，历史回执不覆盖当前GET。新增迁移101未改旧迁移。

全组合非实现Sol首次在8e2d70c为REJECTED（C0/I1/M0）：合作维护结果未知或已成功但GET失败时资产面板仍可写。b71846f仅修详情页及回归，RED两项失败→GREEN16/16，原Reviewer已关闭I1并接受b71846f，未关闭C/I/M为0；其后4922f9f仅恢复状态及已核对快照，累计源码/测试diff为空。报告`.local/customer-alignment/task-5-final-review.md`。此为同模型隔离审查，独立性不足，外部异模型Review Pending；八片最终组合Review仍待全部完成。

同一4922f9f候选完成全局`check:fast`（架构11模块/86模型、前后端及根类型/ESLint）、`spec:check`（57REQ/63AC/11BQ/48SD）、后端10文件Jest260/260、前端及角色配置15文件Vitest166/166、受支持改动文件Prettier及后端/前端生产构建，全部退出0。构建892.99kB chunk警告为非阻断。日志前缀`.local/customer-alignment/task-5-4922f9f-`，后缀check-fast/spec/backend-unit/frontend-unit/affected-format/build。

同候选经统一隔离入口运行`customer-cooperation.spec.ts`、`customer-cooperation-fixture.spec.ts`、`customer-lifecycle.spec.ts`、`core-leads.spec.ts`、`cases.spec.ts`五文件组合，98/98退出0，5.4分钟，日志`task-5-4922f9f-related-e2e.log`。主链专门用真实密码、cookie/CSRF且无Bearer，覆盖SELF转派201后可见成功及失读/实际目标Grant、已提交丢响应刷新重登原请求恢复、真实PG锁BUSY原键恢复、合作恢复后浏览器新线索201，以及真实运营/公证员发证到Case；其余setup及低层用例保留fixture Bearer，不能称全部98为真实密码流程。暂停/终止每例各有两条不同旧Lead：WAITING_PUSH可编辑，已审核另一条继续公证/Case，不冒称已审核线索可编辑。多数HTTP500来自审计/事实/回执故障注入，目标回滚断言通过；另有一次材料下载ERR_HTTP_HEADERS_SENT，关联断言仍通过，本片未改共享下载实现，后续组合验证保留关注。

同候选迁移专项`task-5-4922f9f-migration.log`退出0：受保护随机schema全101条空链、100→101旧客户/线索/历史回执及合法旧Case来源链保留、DDL失败原子回滚重试、非合作新Lead SQL父守卫及无关联草稿删除。旧Case用正常FK和触发器下的合法SQL合成前态，包含Customer/Holder/已审核Lead/归档Matter/ISSUE/Certificate/费用/审计/冻结引用/回执，前后逐行及关联对照；不等同旧运行时真实签发，也不证明其合成存储键的文件字节。当前真实发证与文件链由组合浏览器用例另证。

各项检查前后HEAD/tree及干净工作区稳定，gate-before.json、format-resume-before.json、gate-after.json记录环境HMAC`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`完全一致；没有暴露凭据或声称数据库当前内容相同。首次受影响格式入口把无Prettier解析器的SQL/Prisma显式传入，退出2，原日志`task-5-4922f9f-affected-format-parser-error.log`保留；只修树外检查命令为ignore-unknown，在同候选/环境复用已成功的静态/单元结果，支持格式退出0后继续构建/E2E/迁移，没有覆盖原失败或变更质量门禁。Task A死锁RED、冷启动超时、缺原Lint日志由root固定补测、UI成功提示RED及Task C合法迁移seed修复/类型格式失败均保留在各Task报告；812cd323的258/12、a8db9f0的124、ff4de3f的23等仍属各自实际输入，不冒称最终候选旧测试数。

本地仅测试public前向至101条，无reset/drop public。人工5181/3201/15434旧CA-008构建和91条迁移保留，登录页/健康及代理200；不推送、合并、部署或操作开发/生产库。门禁后只补project-status、roadmap、本记录的真实完成状态/证据及已核对快照，累计4922f9f至收口仅这四文件，不改业务规则、代码、测试、环境或验证逻辑；执行文档格式/Spec/严格context，按非执行性收口例外保留实际4922f9f证据，不称收口HEAD重跑门禁。CU006正式契约与计划另行提交，不混入该例外。

### CU006 Task A 后端及审查修复检查点（2026-10-09，尚未整片验收）

原实现7b5120d/tree e0069de、正式迁移helper补提交875c724/tree d3490e6，后续修复实际候选84fc51ef8205daa13ce01f8a7e0d419c147fa7c4/tree d1556c8521e750b5ea81e1c89bb8c23aed5d77f4。新增联系人当前行、不可变版本/回执、旧字段锚定桥接、冻结准入资料与102前向迁移；原准入回执JSON/指纹不改，任何已结束联系人也阻止草稿删除，不生成账号或客户经理。仅测试public前向升级102，SQL SHA256 d7c65786f8290c62c9fc9bf31bc0f314d5db3ce5b8edb2be6757fe403001f03b与完成行checksum一致；未reset/drop public或修改人工/开发/生产库。

正式helper tests/support/customer-contact-migration.mjs在875c724新输入独立实跑五组：空链102、101合成旧客户升级/原JSON与指纹保留、SQL约束负例、同版本矛盾原子失败重试、最低资料缺失失败修正重试。此前原实现定向Jest123/123、OpenAPI45/45、联系人fixture Bearer PG7/7、旧路径6/6及开庭/判决清理2/2按其原候选保留；旧cases/core-leads浏览器选例注入Bearer并模拟session，不能当作真实密码cookie/CSRF证据。迁移初版guard/延后FK、Jest mock及旧PATCH测试输入的失败均记入.local/customer-alignment/task-6-backend-report.md，不抹掉失败或虚称业务RED。

原非实现Sol审查875c724为REJECTED 0/3/0；84fc51e修复后原Reviewer复审ACCEPTED，I1/I2/I3全部关闭、未关闭C/I/M0。同模型隔离独立性不足，外部异模型Review Pending。I1真实actor持锁恢复500→六次有界重试/BUSY409及释放后原键成功，完整生命周期事务保留原隔离设置；两个删除/恢复前端叶子将BUSY归unknown且保留原请求。I2自然双客户重叠在修复前已201/409，未复现自然500；原生P2002元数据和精确23505唯一约束注入才是500 RED→稳定409 GREEN，只映射指定receipt模型和约束，其余数据库异常不误认成功。I3实际Swagger把nullable字符串生成为object的RED已修为显式String；响应required和nullable有测试，原请求optional/format装饰器保留。固定修复候选的整文件联系人PG10/10、相关Jest两套54/54、前端两文件18/18、工作区prepared类型/双端构建/改动lint与format通过。报告及原始日志见.local/customer-alignment/task-6-backend-report.md和task-6-backend-review.md。

当前仅Task A完成，Task B正式联系人页面/严格解码、Task C真实密码cookie/CSRF、组合Final Review和Level3完整verify/全量隔离E2E/最终迁移专项尚未执行。001～005原验收不替代本片；Current CU006、Next CU007保持，006～008尚未交付，不推送/合并/部署或自动更新人工环境。

### CU006 Task B 页面及集成修复检查点（2026-10-09，真实登录与组合门禁待验）

Task B原页面提交355c48e4a01cf39099f039ecc967126d90c165d9/tree35fdabee433963d6edcadc17cd1a38a7d2c473dd，13个前端文件：严格联系人/历史/详情解码、独立原请求pending、多联系人面板与分页、准入选活动ID、移除旧编辑页重复联系人录入及详情交叉维护冻结。合作面板spec仅经Root批准补两项合成详情必有空值。原聚焦七文件94/94、类型/lint/格式通过，保留task-6-ui-355c48e-final.log；写成功但联系人GET失败的真实RED/GREEN保留在task-6-ui-readonly-{red,green}.log。原报告的无剩余风险结论不能覆盖随后发现。

Root展开风险源码后发现正常列表读取递增发送上下文代次，使确认成功请求无法收尾；父页在pending清除后未继承联系人资料过期；403/404仍留联系人/历史资料且未完整处理中止卸载。修复d2d57ca52095fc70b65f5e059fc403d1c1924940/treeb9a84805e44d6c8a17d2e9a8f947c927d74f1812仅Panel/Detail及直测四文件，分开身份与读取代次、增加带客户/actor校验的过期事件、保留自恢复、清可见PII但不删未知原请求，并在卸载中止读取；旧源码六项行为RED后两文件35/35 GREEN，最终七文件101/101及类型/lint/格式通过。原始task-6-ui-red.log、task-6-ui-targeted-green.log和task-6-ui-final.log不替代真实浏览器。

最后e2d6ad62f533c1cd85cab7aca30c53a2c663b268/treef2176c8c7bc68aa7bc9d4915546f07f3cc9b0153两文件修复已结束列表第2页只读恢复误取第1页：同一直接行为RED→GREEN，Panel15/15与FE类型/两文件lint/格式通过，task-6-ui-pagination-{red,green,final}.log。其余未变输入沿用此前结果，不称此HEAD实跑101/101。报告.local/customer-alignment/task-6-ui-report.md保留各候选；没有后端/迁移/共享Auth或业务契约改动。尚无本片真实密码cookie/CSRF端到端证据，下一步Task C及Final Review/Level3完整门禁；Current/Next仍CU006/CU007，不将本检查点视作整片验收。

## CORE-CU-006 Task C真实会话与父级刷新修复检查点（2026-10-09，未整片验收）

Task C实际提交`0cc238bdffc930aecc2be7058425b2d45ee14b00`，tree`c4934c0a904b04b21f897531f987ea415ce926a5`，仅六个测试/夹具文件，提交后工作区干净。联系人专项`pnpm test:e2e tests/e2e/customer-contacts.spec.ts --workers=1`16/16通过；前12例真实浏览器密码登录/cookie/CSRF，第13～15例Bearer API兼容/隔离，第16例外部CLIENT/LAWYER真实API密码cookie拒绝访问。准入明确选活动联系人ID、不重复平铺字段，冻结快照/旧回执JSON与指纹保持，未知结果原key/body刷新重登、真实PG BUSY、撤权清可见资料并保留未知请求、合作/删除交叉冻结、只读恢复、实际历史及结束联系人第二页、跨客户迟到读取均有对应证据。未另造浏览器actor切换晚到响应端到端例，复用B组件对应证据；不得把Bearer或组件测试说成真实密码浏览器。旧`customers.spec.ts`仅获批旧UI适配和新增旧平铺PATCH邮箱审计脱敏用例，定向2/2通过；其UI仍为fixtureBearer。六文件Prettier/ESLint/tsc及Git差异检查通过。

真实浏览器先暴露父级同ID新Customer对象被getter数组watch误判为上下文切换，写后保存持续禁用。最小修复`3dbb70d4b5d4ee2149fdffad8a363f634b646e43`/tree`ea90bedad45c027f438ba5986674ad70ea66fb4c`仅Panel与直接spec，改为Vue多源watch；父级实际替换对象的组件RED→GREEN、Panel15/15、类型/精确lint/格式通过。Task C原两条cookie失败例修复后纳入16/16通过；浏览器RED终端输出未单独落盘，保留这一证据限制，不将Panel日志充当浏览器日志。

新增外部身份用例后首次整组被残留测试会话的外键约束阻断，16例均未进入用例体；夹具RED已单独保留。修正仅清理本用例限定核心部门/客户且用户名和名称核对的CLIENT/LAWYER账号及其会话/凭据/绑定/律师档案，未知身份拒绝清理；其后16/16通过。不改生产守卫或102 SQL；仅测试库15433与5174/3101，未reset/drop public或操作人工/开发/生产。原始日志、需求映射及未覆盖项见`.local/customer-alignment/task-6-integration-report.md`、`task-6-integration-e2e-final.log`、`task-6-integration-old-compat-e2e.log`、`task-6-integration-static.log`、`task-6-integration-fixture-red.log`与`task-6-ui-parent-refresh-*.log`。

本检查点不预写组合Final Review或Level3通过。Task A原I1/I2/I3已关闭的审查结论保留；最终组合审查、固定候选完整verify/全库E2E/迁移专项仍待执行。Current/Next保持CU006/CU007，人工环境仍旧构建及91条迁移。

## CORE-CU-006 组合终审发现与修复候选（2026-10-09，待原审查者关闭）

固定`22c0e24a1aa43c6153d6f948deaa4140a6ef7266`/tree`6bb1cf168f8397a373403a8f1936237d6ac00c50`组合只读审查REJECTED，未关闭C/I/M=0/2/0。I-1是联系人GET失权后父详情及准入快照仍显示已加载姓名/电话/邮箱；I-2是新增显式ID准入在真实提交、响应丢失、撤准入权限后遇403丢原恢复key。I-2通用4xx清key逻辑在CU006前已存在，但新增UI接线继承了本片验收缺口，不称本片新引入旧API回归。两项均经真实密码cookie页面RED复现，原报告不改写为初审通过。

修复`926c2d49b16475396eddb72a92e7a4168984bbca`/tree`5aeef0740a63675ceb740a6278da35d08ea3f9f6`仅十个前端/测试/helper文件。读失权事件携来源客户与actor，清父详情及子快照、取消迟到读取，保留无PII的只读恢复和原联系人请求。新增独立准入pending按user/department/customer保存原正文/key，发送前存储失败不POST；403/404/BUSY保留，刷新重登且客户已准入/联系人已结束仍原key回放。真实I-2回放前后Contact1/Version2/AdmissionReceipt1/准入Audit1，未重复写。正式页面契约仅澄清上述恢复和资料清除，不改后端/旧无ID指纹、schema、已执行102或其他旧模块未知机制。

最终完整联系人真实环境18/18（55.0秒），四份组件/持久化直接spec66/66，十文件Prettier/ESLint、root tsc及frontend vue-tsc通过。真实cookie两条finding定向2/2通过。首轮全文件15/18和后续17/18均保留：旧撤权locator仍查已正确卸载面板、外部身份夹具顺序、首例异步request.allHeaders取证超时；修正后前两例repeat-each=3共6/6，最终18/18。首例同步头验证key/CSRF/无Bearer，原始Cookie头由第二例实际route请求明确验证，不过度概括逐次完整头覆盖。更早编排失败不充当产品RED。

原始证据见`.local/customer-alignment/task-6-integration-report.md`追加节、`task-6-review-findings-red-final.log`、`task-6-review-findings-green-final.log`、`task-6-review-full-contact-e2e-final.log`、`task-6-review-direct-spec-final.log`、`task-6-review-static-final.log`、`task-6-review-header-capture-red.log`和`task-6-review-header-capture-green.log`。此候选仍待原Reviewer确认关闭I-1/I-2，完整Level3门禁尚未执行；Task A原三项finding保持关闭。同模型隔离独立性不足，外部异模型Review Pending。人工环境、开发/生产不变，仅测试库/端口验证。

## CORE-CU-006 首次固定Level3门禁失败与修复（2026-10-09，尚未验收）

原组合源码复审在`eff2acb2d2b26013e5b4f25a2e9bbbf829cf468b`/tree`bc4f8b38e59abeb928052a7ff02f819ce48aac63`为ACCEPTED、I1/I2关闭、C/I/M0/0/0；同模型隔离独立性不足，外部异模型Review Pending。固定候选完整`pnpm verify`退出0：工具74/74、前端800/800、后端1134/1134、类型/lint/格式/Spec/strict及双构建；全库隔离PG/Chromium E2E **251通过/8失败/259**，退出1，迁移专项因此**未启动**。前后HEAD/tree干净一致、环境HMAC`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`不变。原始`task-6-eff2acb-gate-before.json`、`task-6-eff2acb-verify.log`及`task-6-eff2acb-database-e2e.log`保留；没有成功after记录，不称整片验收。

8例诊断：Auth两例多发fixture的userId而被严格DTO拒；旧准入UI一例使用移除的联系人输入；四例直接把ADMITTED改DRAFT，与准入快照不可变/草稿全空正式约束冲突；另有一例真实合作维护回归，runtime actor新增authorizationRevision被spread进持久命令，严格七字段reader刷新后拒绝原请求。`3b78b1664720da486fb7b9d4f38cf9413df0c809`/tree`349b09906d08e5a388e384cd91ebfd3f4edb35c4`只改七个前端/测试/helper文件：新合作命令显式存user/department、读取兼容仅含合法旧revision的现场并返回规范七字段，活跃请求仍按revision隔离；原body/key与持久namespace保持。真实cookie原用例1/1、Panel/helper12/12及精确静态通过。四例保留账号/绑定/Grant/并发/回滚/历史断言，改为原生23514拒绝回退且完整Customer/Lead/products/审计/回执前后相等，PG/Chromium4/4。原四条不可达DRAFT后的HTTP拒绝分支不再覆盖，报告不冒称覆盖；未关守卫、未改SQL102或生产权限。初次仅改状态失败及同次清五列后的第二次4RED均保留，后者日志原名`task-6-core-status-green.log`实际为RED。

`f47ef82f849d46f83b715dd1a48e637a7b7ad9c6`/tree`5450c828452135c6616cda853a2fe2c7ce50dd38`仅两个旧E2E文件：Auth fixture投影为username/password，4/4；单例准入fixture明确补既有TEAM edit-routine Grant，与admit独立，经真实Contact页面创建、选择实际ID，保留PDF/JPEG及下载/元数据断言，客户版本合法前进至3，1/1。该旧浏览器仍fixtureBearer，不充当密码cookie证据；未改默认角色、共享helper或业务实现。首次0tests与缺Grant按钮定位失败保留。报告和实际日志见`.local/customer-alignment/task-6-integration-report.md`末节、`task-6-legacy-test-adaptation-report.md`及其引用；只记各自聚焦结果，完整门禁须在原Reviewer核新组合后重新固定执行。Current/Next仍CU006/CU007，人工环境旧构建和91条迁移不变。

## CORE-CU-006 固定候选Level3通过与本地收口（2026-10-09）

实际业务门禁候选`db33bf6c717e98829ba2728a6a9455cf1d886eaf`/tree`8eca1b3397b7b6c51da434e78c72d12d67c18795`，2026-10-09 17:44至18:00（UTC+8）固定执行：`pnpm verify`退出0，工具74/74、前端802/802、后端1134/1134、全局类型/lint/格式、Spec57REQ/63AC/11BQ/48SD、strict793及双构建通过；`pnpm test:e2e --workers=1`全库隔离PostgreSQL/Chromium **259/259**，13.1分钟，退出0；`node tests/support/customer-contact-migration.mjs`退出0，空链102、合成101→102最早有效/无效原准入回执选择和原JSON/hash保留、SQL非法写负例、冲突回执及最低资料缺失的原子回滚/修复重试均通过。合成升级资料不冒称线上业务数据；数据库专项仍绑定实际临时schema和独立测试库。

原非实现Reviewer在同一db33候选补审ACCEPTED，未关闭C/I/M0/0/0，原I1/I2及Task A三项保持关闭；同模型隔离独立性不足，外部异模型Review Pending，不表述为外部审查通过。原eff2acb完整E2E251通过/8失败及22c首轮REJECTED均保留于前节和原始报告。本次修复后通过，不抹去失败；四条旧的ADMITTED回退DRAFT后的HTTP分支已被真实SQL不可变守卫验证取代，边界仍如前节，不声称它们继续覆盖。

门禁每项前后git干净、HEAD/tree相同，环境HMAC`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`一致；Nodev24.21.0/pnpm11.27.0/win32/x64。原始`.local/customer-alignment/task-6-db33bf6-gate-before.json`与`gate-after.json`均有实际成功记录，三份verify/database-e2e/migration日志同前缀；审查在`task-6-final-review.md`。102SQL SHA256为`d7c65786f8290c62c9fc9bf31bc0f314d5db3ce5b8edb2be6757fe403001f03b`，与已执行checksum相同。全库日志未观察到CU005旧`ERR_HTTP_HEADERS_SENT`，不据此宣称共享下载永无错误。

门禁后的完整收口只改本验证摘要、project-status、feature-roadmap、customers Living Spec的实际完成状态/相应历史表述，以及核对后的context snapshot；不改业务要求、AC、源码、测试、SQL/生成物、依赖、配置或环境。按三级规则的非执行性收口例外复用db33实际业务证据，受影响文档格式、Spec/链接状态一致性、diff和strict检查另实跑，不称收口HEAD实跑过db33完整门禁。Current/Next推进CU007/CU008；007正式契约及实现必须另提交，不混入本完成态例外。仅测试public到102，旧人工5181/3201/15434构建/91迁移/数据不变，无开发生产迁移、推送、合并或部署。

## CORE-CU-007 固定候选Level3通过与本地收口（2026-10-10）

实际业务门禁候选`76c0506d710800894bd2478769644f98448a0b83`/tree`d9c68a0889b648197d28a1aef4cdb2f4797c2cca`，实际时间2026-10-09T23:51:06.6542830+08:00 至 2026-10-10T00:06:31.7838719+08:00。`pnpm verify`退出0：工具74/74、前端842/842（79文件）、后端1153/1153（91 suites）、Spec57REQ/63AC/11BQ/48SD、严格上下文818、类型/Lint/格式及双构建；`pnpm test:e2e --workers=1`全库隔离PostgreSQL/Chromium **274/274**退出0。全库包含customer-agreement-migration.spec.ts的102→108前向链、合成旧协议/开票与旧回执保留、不可变审计与单调head等SQL负例、失败原子与修复重试；不重复单跑相同迁移，不把合成旧数据称线上数据。测试public到108，已执行迁移不改，开发/生产和旧人工环境未迁移。

原组合de5de27终审REJECTED、C/I/M0/2/0，发现上传403/404保留敏感投影和上传先发后存标记。21d7968修复，当前76c0506补审Spec compliance/Quality均ACCEPTED、未关闭C/I/M0/0/0；协议403/404先清当前/历史/草稿并保留上传标记，网络发送前存标记、失败不发，旧代次/卸载保留，当前确定成功/失败才清，清失败禁写；同身份在途协调与删除失败补偿仅内存，不称跨整页刷新/跨标签保证。原报告.local/customer-alignment/task-7-final-review.md保留首轮REJECTED和补审，Task A原两项SQL finding及108修复报告、Task C真实会话/组件RED和修复日志均保留；不拼接旧聚焦通过数冒称同候选整组执行。Reviewer为非实现Sol同模型隔离，独立性不足，外部异模型Review Pending，当前可用工具无异模型审查主体；不称外部审查通过。

门禁前后git干净、HEAD/tree和环境HMAC`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`一致；Nodev24.21.0/pnpm11.27.0/win32/x64。原始`.local/customer-alignment/task-7-76c0506-final-gate-before.json`、`-gate-after.json`、`-verify.log`、`-database-e2e.log`保留。大chunk、pg及NO_COLOR警告为非阻断，不扩大为生产或性能保证。实际密码cookie/CSRF及上传撤权/存储拒绝/正常/未知核对用例包含本次全库；独立人工最新环境尚未启动，旧5181仅旧构建。

门禁后的完整收口仅改本实际验证摘要、路线图完成态/唯一Current与Next、项目恢复摘要、customers Living Spec的实际完成表述与已解释context snapshot；不变更业务要求、权限、AC、源码、测试/输入、迁移、依赖、生成物、构建/运行配置及环境。按三级规则非执行性收口例外保留76c0506业务证据，另执行受影响文档格式、Spec/状态一致性、strict与累计diff专项，结果保存.local/customer-alignment/task-7-closeout-doc-check.log；不称文档收口HEAD实跑完整门禁。Current推进CU008；008正式设计与实现另提交，不混入本例外。001～007尚未推送或集成main，无生产迁移/部署。

## CORE-CU-008及客户八片组合本地验收与人工入口（2026-10-10）

实际业务门禁候选`5cc84c1717528bfef5c85b5f580ce3be00ba5588`/tree`2dd737a4fe612963947ec8b0861148afb32ed5f5`，实际时间2026-10-10T02:10:37.4577101+08:00至2026-10-10T02:26:25.5950320+08:00。实际候选5cc84c1/tree2dd737a完整verify通过：工具74/74、前端892/892（84文件）、后端1171/1171（93 suites）及双构建；全库隔离PG/Chromium293/293通过，覆盖完整112条迁移链、旧事实/回执、SQL负例、失败原子及重试。完整`pnpm verify`及`pnpm test:e2e --workers=1`均实际退出0；Spec57REQ/63AC/11BQ/48SD、严格上下文845、类型/Lint/格式及完整前向迁移和旧片回归在同一固定候选覆盖，不重复单跑相同迁移输入。测试public前向到112，已执行SQL不改；合成旧数据不称线上数据。

原累计b48a39e终审REJECTED的CU008-FR-I1（合法不足一元超收被解码拒绝）已由d70027a修复。随后4f851d9完整verify74/890/1171及双构建通过，但全库289/293、4项失败；原日志和trace保存在.local/customer-alignment/task-8-4f851d9-final-*，不能称首轮组合通过。5873d7d只修统一DATE测试夹具、103～108严格连续迁移子链、开票持久原请求在撤权后交后端鉴权并保留恢复入口，以及无结算Grant时隐藏页签的旧测试。CA006两个TZ各1/1、CU0071/1、客户42/42、开票真实投影edit=false后原键403/恢复整文件7/7、组件6/6及类型/lint/格式的RED/GREEN见task-8-gate-regression-report.md；原竞态单独复跑通过和无效中间命令分别披露，不当修复成功证据。Root随后只补状态/context固定5cc84c1。原非实现Sol对八片累计及最终回归补审Spec compliance/Quality均ACCEPTED、未关闭C/I/M0/0/0；同模型隔离独立性不足，外部异模型Review Pending。原全八片报告task-8-final-review.md保留每轮REJECTED/ACCEPTED和关闭依据。当前可用工具无外部异模型主体，不称外部Review通过。

门禁前后clean HEAD/tree及统一测试环境HMAC`8cebe60684ba5641d54f9c5c32e7c85b7b62c8fd8d55d4583e40330b5f5e9337`一致，Nodev24.21.0/pnpm11.27.0/win32/x64。原始证据为`.local/customer-alignment/task-8-5cc84c1-final-gate-before.json`、`-gate-after.json`、`-verify.log`、`-database-e2e.log`。现有大chunk、pg与NO_COLOR警告非阻断，不把通过扩大为生产或极端负载保证。

最新独立人工入口http://localhost:5182/login，后端127.0.0.1:3202，PG127.0.0.1:15435/dev_cor_manual_cu008_20261009，独立账号及密码保存在ignored .local/manual-test-cu008-20261009/credentials.txt。已核112条迁移名称/checksum/完成态、真实密码会话及浏览器cookie/CSRF创建客户、登记台账和刷新；保留一笔明确标识的合成验收数据。旧5181/3201/15434及原持久卷保留旧构建/91迁移，不重置。首次人工容器healthcheck在首启临时服务器阶段提前就绪，初始化首次connect短暂断开，尚未开始迁移；保留first-start-failure.json及容器日志依据。随后仅对已准备的精确快照续接initialize，重新核实际库身份及空public后前向迁移成功，不重跑prepare、不重建容器或reset。人工服务复制本业务门禁候选构建，不重新构建业务；新数据库首次空public核验后仅前向migrate deploy，独立管理员首次创建，未占自动化库15433/账号/5174/3101。actual verification记录为`.local/manual-test-cu008-20261009/startup-verification.json`、`verification.json`、`browser-smoke-verification.json`与截图；实际浏览器创建合成客户`6f32643e-4f6c-47b1-8fd8-75ba6efd6f75`及一笔1000.00结算、未知回款，整页刷新仍精确恢复。新旧人工和自动化逻辑资源隔离，仍共享物理CPU/内存，不承诺零负载竞争。无开发/生产迁移、数据重置、推送、合并或部署。

门禁后的完整收口仅本验证摘要、路线图完成态/唯一Current与Next、项目恢复摘要、customers Living Spec完成表述及已解释context snapshot；不改变业务要求、AC、源码、测试、迁移、依赖、构建/运行配置和相关测试环境。按三级规则非执行性收口例外保留本5cc84c1实际业务证据；受影响文档格式、Spec/状态一致性、strict及累计diff检查另实跑并保存在task-8-closeout-doc-check.log，不称文档收口HEAD实跑完整门禁。客户001～008尚未推送或集成main；CA-009仍未领取。

## 客户人工问题修复、界面统一与合并准备（2026-10-10）

前端增量提交`d659f1b3036b4f9d00305eb0ecff3c91e8ac474e`，tree`c810b411a9f1d22a8e0d9290ccfda2a2d17c49ed`，基于八片收口`0aada438df5b078fa81a3c873e3f6b2a586d60ed`。只修改16个客户前端组件、直接测试及限定在客户页面的共享样式；不改后端、API、权限、业务规则、schema、迁移、依赖或测试运行配置。明确的删除业务拒绝显示原因并解除其他维护冻结，版本冲突仍需刷新、未知结果仍原键重试；批量登记成功文案统一为“已上传并登记”。按Level 1验证本增量，不将代码改动冒充非执行性文档收口。

两项回归断言先取得2 failed/52 passed的预期RED，修复后54/54；最终客户目录24文件225/225、`pnpm check:fast`、受影响Prettier及`git diff --check`实际退出0，前端生产构建成功。真实浏览器复测覆盖删除拒绝后仍可维护、合成PDF批量登记、新建/编辑客户、联系人保存、合作暂停/恢复、协议/开票编辑取消及刷新持久化。窄屏表单改单列、宽表在容器内滚动，页面没有横向溢出。结算真实记录仍为结算101.00、回款101.01、超收0.01、回款率100.01%。原始日志、9项浏览器结果、截图、报告及源码校验清单位于`.local/customer-ui-20261010/`；2026-10-10合并前逐文件核对16个SHA256与实际差异集合完全一致，将提交前实际验证明确绑定到本增量提交，不伪称Slice Evidence v2。

原八片高风险代码、迁移、测试输入及依赖沿用已审查并完整验证的`5cc84c1`；该候选到`0aada43`仅有已披露的文档收口，本次新增前端变化另有上述Level 1证据，不称原293/293为本增量HEAD实跑结果。当前远端main=`8a8fe1113c18b972bd58df2260ab52e6ad82f0f8`，已核为任务分支祖先；可快进而不构造额外组合tree。当前用户已明确授权推送和合并；待实际推送后再补记远端ref核对结果。严格上下文首次报告16个已知前端文件漂移，核对源码清单与测试后才更新快照，未隐藏未知改动。

人工入口继续使用localhost:5182、后端127.0.0.1:3202及独立PG15435；原数据库及合成验收数据保留，不占E2E15433/5174/3101。未执行开发/生产迁移或部署。原外部异模型Review Pending及同模型隔离独立性不足的限制保留；本前端Level 1增量不追加独立Review，跨账号运营转派仍保留人工未覆盖限制。Current仍为CU008，CA009未领取。

### 实际main集成与收口

2026-10-10按用户“推送合并”授权，将`codex/customer-module-alignment`推送到origin，然后本地main从`8a8fe11`快进到`b71985740a7f833e9d6be569a72d0a8e1ab39e2c`，tree`85e9ed0ff93866ac51ebb0e60d744acf41303c70`与已核任务分支完全一致，没有冲突或额外组合代码。`git push origin main`退出0；随后`git ls-remote`实际返回main与任务分支均为b719857。主工作区已回到main。

该集成候选相对前端修复提交d659f1b仅增加项目恢复摘要、本验证记录和对应快照；客户源码仍与225项测试及浏览器复测的16文件SHA256清单一致。原5cc84c1完整verify/293项数据库证据和本次Level 1增量证据分别保留，不称b719857实跑完整门禁。准备阶段及快进后严格上下文、Spec及受影响格式检查按实际输出核对；本次最后收口仅补项目状态、路线图、本完成态记录及对应快照，使用文档专项核对，不重新改写业务契约或验证输入。

远端CI结果未查询，不称CI已通过。未创建PR、Release或部署，未执行开发/生产迁移，也未停止独立人工服务。外部异模型Review仍Pending，Current保持CU008已验收并集成main、Next为未领取CA009。

## CORE-UI-001运营字段与列表对齐（2026-10-13）

代码／测试固定候选`fd7a839cb6cb119953da78e61c759893dbc2f04f`，tree`771a42db2840ae2b244f11a5151db8906f01bad5`；从冻结`d709600`组合V0源8091e62＋修复c063f0a、V1源3d4e24f、V2源5ecb044、V3源9504aa8及I共享API／精确汇总／受权名称／限定CSS。公证来源只按同部门精确关系读取，转案摘要另要求case.read DEPARTMENT，不从lead.read拼接；旧五列存储读时扩19而不PUT，新默认17运营列。线索读响应新增displayNames，原创建／更新回执不扩；BigInt分位汇总保留真实0，未登记／待定不造金额。案件只重排既有字段和真实能力汇总，不新增案件财务或操作。

作者及I聚焦结果分别保留：V1两页82/82，V2表单＋列表详情46/46，V3两页142/142；I共享线索API／helper25/25、后续guard API17/17、公证API37/37、后端Lead91/91；V0原76项与审查前序修复45/45。不能把各树合计称为本候选一次组合测试。V0原独立Review REJECTED I1，修复前序照片／evidence门槛后两轴ACCEPTED。组合a224437另REJECTED I1（线索旧身份投影），0cdec61加入同步范围watch、读／下载取消和迟到命令保护及40/40反例，frontend类型首次fixture never[]错误仅修注解后exit0；同一未参与实现的gpt-6-sol独立复审及fd7a839最终增量审查两轴ACCEPTED，未关C/I/M=0/0/0。未核到作者实际模型标识，不假称路由匹配；未宣称外部异模型Review通过。

真实隔离环境恢复：既有dev-cor-postgres-test-1此前停止，启动后第一次迁移在health尚starting时拒绝、未执行；健康后正式pnpm db:test:migrate:deploy exit0，142条前向迁移已应用。只15433/backend/.env.test及I专用test私有文件根，未碰15436持久预览或其他库。LeadNewPage初轮Temp EPERM／0tests，相同pnpm入口一次提权4/4通过；保留预检和工程配置。

初轮真实验收不算最终通过：17:14:29–17:15:15 UTC新三项2过1失败（恢复case.read helper写回TEAM而非原DEPARTMENT，已精确恢复）；17:21:57–17:25:11 UTC八个明确文件14项8过6失败（“平台”匹配下拉及店铺ID，已改稳定name并补齐批准文案）。2过包括旧偏好与三视口；8过包含普通密码21案双端分页、律师办理、判决分组、列偏好、原五列CSV与批归档。日志／退出码／准确UTC／输入SHA256／初轮trace及图片保留于ignored `.local/ui-evidence/operational-display-initial.*`、`display-compatibility-initial.*`与对应artifact副本。新截图进一步限制长摘要宽度、展开全文，并区分closed主图与expanded补图；旧失败结果不改写为新候选通过。

正式最终完整verify与同17项统一PG／Chromium组合待执行；三视口最终图片待读图确认。当前未push／main或更新5186，不称本批完成、生产可用或全部Demo完成。最终结果将在本节回填，不新建平行账本。

正式verify首轮候选`7feeb001bc4d45074323ce3678768010508a6675`／tree`a6adf1982f6f8a237c62e4ef57aae0634f59ae43`，17:31:55–17:35:10 UTC exit1；严格context、Spec、架构、Prisma、类型、Lint、格式及80工具测试通过，后端1374过1失败（旧OpenAPI偏好尺寸仍5/5/3）。前端整套未给完成结果、双构建未执行，不能称通过。只将该断言同步到批准的19/19/17，不改产品或DTO规则；原首轮log/JSON与环境HMAC前后一致`343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`保留。

最终稳定候选`ed3dc29153c8abc0f898b10a83873c342afb1c4b`／tree`c57bf677c4007b5f0b877ed4596be85c3f36fe7e`完整`pnpm verify`于17:40:48–17:44:20 UTC退出0：80工具、1443前端、1375后端及双构建均通过。17项统一PG／Chromium于17:45:28–17:49:15 UTC为16过1失败、exit1，唯一失败为旧移交测试商品文字同时命中新summary与展开正文；新来源／权限／偏好与三视口三项通过。原结果及全部15张对照／展开截图已保全于`.local/ui-evidence/final-e2e-first-artifacts`，没有称17项通过。仅将该E2E选择器明确到商品summary，不改产品、单元、迁移、依赖或构建配置；根E2E类型／受影响Lint与格式复核后，按独立审查核定复用上述完整verify并重新固定运行同17项。原成功及失败metadata均绑定实际候选、前后干净、同HMAC`343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`，不把新tree说成旧完整verify实跑。

### 本批最终稳定组合

固定候选`5ad06d1fd4dd7294fab227ea73f56052bf839453`／tree`5ef3342d2d6bc4e8b8ebe292b05bc9ed70325f49`，2026-10-13 17:56:21–18:00:10 UTC原标准入口统一17/17退出0；前后HEAD/tree及干净状态相同，环境HMAC仍`343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`。此为同一新候选的完整明确组合，不拼装初轮2/3、8/14或16/17。实际普通来源、精确字段／版本／字节、内部密码cookie、客户隔离与律师冻结下载、授权独立性／撤权、旧偏好不写回和双账号、21案分页及原CSV／批归档均通过。1440×900、1024×768、390×844的closed主图、展开补图及同视口Demo公证参考共15张已保全，几何／键盘横滚与页面溢出由真实页面验证；I读图确认准确编号／短日期、表内滚动及长摘要展开，金额仍按原十进制字符串真实展示。Demo图片只作视觉参考，不是业务或权限证据。

完整verify仍精确引用ed3dc291（17:40:48–17:44:20 UTC exit0，80／1443／1375及双构建）；相对新候选只E2E定位和非执行性记录，14组Git输入逐字相同，独立Reviewer已明确接受限定复用，新E2E根TSC、Lint、格式和新树strict／Spec另通过，不宣称新tree实跑verify。两轴ACCEPTED，未关C/I/M0/0/0。首次V0前序、线索身份、尺寸、标签重名、商品重名及文档Minor失败与修复均保留。没有新增模型／迁移、改Command回执或权限算法、构造未知费用／结算、预建CA016，剩余案件摘要／新业务字段、CA016／017、历史补录、资金发起与生产条件仍未完成。按三级规则本段及状态／路线图收口仅非执行性文档与快照；Git实际集成及15436数据保留回执稍后记录。

### 本批实际Git集成与持久预览

2026-10-13 18:11:29–18:11:35 UTC将已验收应用收口候选`b26cdfeedf699f2803f331352052db48798a3e36`／tree`333921eb581287684a277b9558a59fc66cfdc347`原子非强制推送main与`codex/demo-list-display-alignment`，退出0，远端两ref实核同SHA；主仓main从bd0e02b快进至同候选，保留原未跟踪.pnpm-store与恢复stash b07482c。b26相对5ad仅四份文档，不称其另跑完整verify或17项；末次提交继续只补实际回执及对应快照，远端最终ref以交付实核为准，未查询CI。

持久预览此前已停止，核两个旧PID均不存在后保全旧services记录，恢复唯一dev-cor-ca013-preview容器及原命名卷。备份`runtime/ui-display-before.dump`为1,028,124字节，SHA256 `043453EC6BE81A43282ED9D476D6D78BA6B9FA2534521881F590CD451161AA13`；pg_restore目录检查exit0，未做恢复演练。原源码66b85ce与旧dist备份`runtime/ui-display-backend-dist-before`保留。应用切换b26cdfe、后端复制ed3完整verify构建，逐文件哈希与I构建一致；未运行新迁移、reset、seed、初始化或改密码。

18:14:04 UTC 5186/login及3206/api/v1/health实际200；15436仍142迁移。更新前后121张业务／凭据表（仅排除认证会话／限流表）的行数及哈希完全相同，2案件、6本地凭据保留。原私密本地密码经真实登录cookie只读核验：案件6列／2行，公证17列／2行，线索空列表保持原状；exit0、业务POST/PUT/PATCH/DELETE为0，未打印账号密码或造数据。证据与预览指纹为原runtime内`ui-display-{before,after,backup,source-update,health,browser-readonly,fingerprint}.json`和三页PNG；恢复仍用原start.ps1／stop.ps1，不重新prepare／initialize。此次版本比较包装器首次因v前缀误判停止于DB读取前，修正比较后实际检查通过，失败不算数据或产品错误。

最终15张三视口／展开／Demo对照图保全于I `.local/ui-evidence/final-success-artifacts/`；统一17项、完整verify及限定复用证据仍沿上段精确候选，不把预览私密账号只读三页当作正式PG组合。Demo8123、其他人工库与生产未操作；全部Demo、案件新业务摘要、CA016／017、历史补录、资金发起及生产准入仍未完成。Next只准备CA016工程冻结，不夹带实现。

## CORE-CA-016最小结案资料、案件摘要与N2集成（2026-10-13）

业务基线main `1471bfa76380409607a2d87a834b63cda3bc35cd`／tree `1d595f73970c66155273f4bc5ab2e0ed2a82905e`，冻结`0d52a004ef2ab1d92886b1dc7ca58a36df8be3a2`／tree `c2d93ba83356a15bd1cf67a7c7ca3bb74f2b3adf`。I复用`.local/worktrees/ca015-integration`／`codex/ca016-closure-display-integration`，主仓原.pnpm-store及恢复stash保留。范围仅待归档中的最小结案登记和原因更正、真实来源内部列表摘要、真实法院案号及跨模块导航上下文；不实现实收／结清／最终归档／重开／历史补录或资金发起。

接纳链：N2源fc57d2d→9f95508；F1最小API b956906→5da49f9；P1源004f95c→2e08174；D1源3d9141e→243e0fa；F1作者增量abdf7f2＋e7c8461→8082bab＋80985c1；B1源61bfff4→8a4e315。P1／D1依赖blob保持，不重复接纳各Worker依赖副本。B1源tree40acddd、28白名单；作者固定候选11套327/327、后端类型／Lint／格式通过；F1真实组合15套494/494、全前端类型／静态通过。作者报告只证明各自输入，不拼成I同树门禁；作者实际模型元数据无法核验，不假称路由型号。B1由未参与实现的独立gpt-6-sol主体两轴ACCEPTED、C0/I0/M0，静态接受不证明PG。

集成8a4e315／tree5323049的正常pnpm Prisma生成及后端构建exit0。15433测试库标准迁移第一次普通沙箱因Docker inspect权限阻断未执行；精确升级原入口后第一enum提交、第二DDL失败（PG语法错误character19614）。I仅修新DDL两处IF内CASE括号，独立复核接受；144全链随机schema回放退出0、第二DDL表仍缺席，官方Prisma resolve --rolled-back后标准前向部署退出0。旧142迁移文件无diff，无真实Grant回填。

随后普通旧来源opening API触发新引用守卫PG42702（局部action变量与列名歧义）；I只改新函数局部名及限定列，独立复核接受。15433精确CREATE OR REPLACE该新函数，所有_prisma_migrations行／原checksum保留；不能把此前部署变体称为最终迁移源码checksum一致。最终新文件另以随机schema空库144、142真实Finish源复制升级、第二DDL失败回滚／enum留存／前向恢复及旧事实／回执／文件元数据／字节逐项实证；无回填比较针对142兼容旧Grant全集，不将142无法表示的两新Action合成Grant混入历史基线。持久15436从未迁移。

首项运营纵向修复后1/1通过。干净固定候选`8f4f4d5cdf2b4643cd940b371941e909bd35e58c`／tree `1bd4c1b0cdf2044ad745571bfdd7b28bbc9e9a3e`统一8项于19:43:32～19:45:52 UTC退出1：6过2失败。已过权限范围不拼接、撤权原键、竞争更正；七个故障点均以独立sequence命中标记证明实际到达并回滚，正常原参随后成功；运营／律师、未知成功原参跨同案刷新及SPA重挂、21案普通密码双端分页通过。两失败为迁移初次快照误包含142无法表示的新Action Grant、列表验收非法stage=all请求，不能称本组合通过。限定修正后迁移及旧CA015 PG兼容实际通过，列表再因未获合同保证的被告录入顺序断言失败，按精确集合修正；原失败保留。

组合Review另报Important I1：确定409后同值新详情对象不解锁。I只在可信新item且conflict／无pending／未denied时清确定冲突和草稿，不释放未知原参或自动POST；三code回归覆盖手动新意图。普通pnpm初次Temp EPERM、0tests保留；同入口升级重试2套62/62通过（47面板＋15真实详情），独立复核I1关闭、C0/I0/M0。最终固定候选／完整门禁与同组PG／Chromium结果待本节回填，尚未push／main或更新预览。

恢复证据统一ignored `.local/ca016-evidence/`：各作者接纳JSON、迁移首次／恢复／函数修复、首项闭环、combination-8、focused-3、review-fix-unit及最终候选记录。每步绑定实际退出码、UTC、commit/tree或未提交输入SHA256；失败记录不覆盖。2026-10-13本轮只读5186/login及3206/health均200、预览HEAD b26cdfe干净，15436原142／2案／6凭据保持；Demo8123、其他库及生产不操作。该旧预览不是CA016验收入口。

限定复验19:48:21～19:48:56 UTC为2过1失败：最终144／142迁移及旧CA015原子／不可变证据通过，列表被告顺序断言失败。后续列表各次只改验收接点：精确被告集合、客户RECORDED视图、按aria-expanded避免折叠已展开导航、独立active类避免命中Router默认类、旧原子书签高亮其批准分组、实际批准表头。原API／业务规则不放宽；各次log／JSON保留。最终列表单项19:55:13～19:55:41 UTC退出0，14列／源金额／权限／导航／1440／1024／390横滚键盘及无body溢出已过，三视口主图已实际读图。最终同候选统一组合及完整门禁待运行，不将散装复验合称统一通过。

新干净候选`94c18831383ffbd2917da06c8293e1573d349fad`／tree `d0b378a70c18c370f3ea2313a2b180406a492167`的累计组合Review两轴ACCEPTED、C0/I0/M0。统一九项（原八项＋旧CA015 PG）19:58:06～20:00:31 UTC退出0，9/9，前后HEAD／tree及clean相同，环境HMAC前后一致。完整verify首次19:58:32～19:58:36 UTC退出1：严格context和Spec已过，架构门禁拒绝CaseListPage直接导入leads内部lead-options，后续类型／单元／构建均未执行，不能称完整verify通过。I按现有公开模块边界仅新增leads/index.ts re-export同一labelLeadPlatform、替换一个导入路径，函数及显示规则未变；新候选须再次独立确认及完整门禁／同树验收。

公开入口修复后的干净`fc0a514d5349c4c48536d793efa573923938a177`／tree `67fdc973edb1a81762f3418bc9f216bcbf921a07`，独立组合增量确认两轴ACCEPTED、C0/I0/M0；完整`pnpm verify`20:03:07～20:06:56 UTC实际exit0：80工具、1586前端、1411后端及双构建通过，前后同tree／clean，正常预检保持。Vite只有既有500kB普通chunk warning，未调阈值。15433十个新函数prosrc与最终新DDL对应体逐字一致、原部署checksum保留，另以随机schema验证最终144文件及142升级，不能混淆二者。

最终最低验收补齐仅扩`tests/e2e/case-closure.spec.ts`：当前律师真实密码读取两版最小历史并下载同一结案PDF字节、客户内容下载拒绝，律师登记后结束当前PRIMARY承办，同cookie同键原参重放403且事实／历史未变。根E2E类型、该文件Lint／格式实际通过；20:09:07～20:09:51 UTC同文件3/3 exit0，输入SHA256 A5D433A1EA6697005569EBB149CE89723FDBAF5B2385751416EB9A3F8A1E2727。此后产品／单元／构建输入不再修改；最终固定增量须核明确Git输入组同一性，并将fc0完整verify的限定复用与新候选根检查／统一九项分开记录。

### CA016最终固定候选与恢复核验（2026-10-14）

最终候选`8cc3a8e88a9ce7305e4dee7714f05b81e8268cd2`／tree`3a7e0054218b08d4405939ba6bd48c3ed6ff607c`于2026-10-13 20:16:35～20:19:01 UTC统一六文件九项PG／Chromium实际exit0，9/9，前后HEAD／tree／clean一致。环境HMAC前后一致；五项根TSC、E2E文件Lint、格式、strict context及Spec均exit0（20:16:28～20:16:37 UTC）。独立Reviewer 01a13607在未参与实现的上下文自行核累计diff，两轴ACCEPTED、C0/I0/M0，接受fc0a514完整verify的限定复用；随后九项及五静态真实结果另行完成。

限定复用证据`.local/ca016-evidence/verify-reuse-proof.json`逐字比对17组Git输入；fc0a514→8cc累计仅docs/context-snapshot.json、feature-roadmap.md、project-status.md、VALIDATION.md及tests/e2e/case-closure.spec.ts。唯一执行性差异是该E2E律师历史／精确下载／撤权原参重放增量，其直接3/3、根静态及同树9/9已另验。backend、frontend、scripts、patches、package／lock／workspace、runtime入口、根TS／ESLint／Vitest／Playwright／Prettier配置与环境锁均相同。不得把8cc称为实跑完整verify；完整实跑候选及失败历史仍沿上文fc0／94c准确记录。

2026-10-14接替I实际只读确认原HEAD和产品tree相同、status／diff干净，无不确定补丁落盘；context:check exit0，Node24.21.0／pnpm11.27.0按锁核对。根及主仓无.agents/skills目录，使用AGENTS和三级规则；没有.codegraph，按rg／源码定位。原reviewer最终增量报告已读取核验；旧主控completed且未执行恢复写入。获取远端后origin/main仍1471bfa，主仓只有已知.pnpm-store未跟踪，保留原stash。普通沙箱fetch／CIM访问受限，精确升级后fetch及只读进程核验成功；没有并行实现或验收进程。持久预览专用库／应用原来停止，按既有start-db恢复15436后再备份检查。

本轮收口只补完成状态、以上实际结果、证据引用及对应已核快照，累计白名单为docs/feature-roadmap.md、docs/project-status.md、docs/spec/v0.1/VALIDATION.md、docs/spec/v0.1/modules/cases.md与docs/context-snapshot.json，不改变合同／AC／权限／业务或工程输入。产品、全tests与既有142迁移须逐字保持8cc；文档专项和独立收口检查完成后才提交／集成。CA017不在本轮实现。详细恢复、Git及预览回执存于同一ignored证据目录并在后续真实完成后回填，不能预称已推送或已升级。

独立收口Reviewer `/root/ca016_closeout_review` 未参与该五文件修改，自行核累计diff、17组Git输入及原日志；首次报M1（历史CA015派发段仍用现在时），I仅改历史叙述／当前Spec锚。2026-10-14 01:11 UTC文档格式、strict context、Spec及git diff检查均exit0，证据`recovery-doc-checks.json`；Reviewer复核关闭M1，最终Spec／Quality两轴ACCEPTED、C0/I0/M0。此审查只覆盖非执行性收口／证据边界，未重复全产品审查或旧完整门禁。本段实际结果回填后重新记录对应快照并核文档专项，不能沿用变更前快照。

### CA016 Git集成及持久预览交付回执（2026-10-14）

文档收口`299cd7cde2e221c7be5be02a5039e453d061d537`／tree`05716602b860c3aa21a2368699f2801e0b31737b`相对8cc完整差异仅上述五份完成态文档／快照；独立收口两轴接受后再回填真实结果并于01:13 UTC重做格式、context record／strict、Spec、diff专项全部exit0。主仓main由1471bfa快进到299cd7c，合并tree逐字相同，无新产品组合；01:13:43 UTC原子push main及codex/ca016-closure-display-integration exit0，ls-remote两头均为299cd7c。未强推、改历史或清主仓.pnpm-store／stash。准确回执`.local/ca016-evidence/recovery-{closeout,first-push}.json`；本段后续只追加实际交付结果及对应快照，最终远端SHA在同目录末次push回执核实，不把299cd7c或末次文档HEAD称为实跑旧完整门禁。

持久预览复用`.local/worktrees/ca013-014-integration`及原私密runtime，目标固定127.0.0.1:15436/dev_cor_test，应用5186／3206。原服务断连后停止；旧前端PID已被svchost复用，仅保留过期services记录，没有kill其他进程。先恢复同一Compose数据库、核122张原表与上批已保存哈希／计数及原2案／6凭据／142迁移一致，再pg_dump自定义格式备份`runtime/ca016-before.dump`（1,028,262字节、SHA256 `00afc3289628035bdb75e1140228742ff1c56e0a55e1cbd76a1fae647f60e7ca`）；pg_restore --list exit0且包含cases／local_credentials，未演练恢复。旧backend/dist另存`runtime/ca016-backend-dist-before`，原源码b26cdfe保留于Git。回退须停本预览应用、核精确库并另存当前备份，再按授权恢复全库及旧应用；不能只降源码、删enum或迁移行。

预览从已验8cc生成匹配Prisma Client及后端prepared构建exit0，随后对齐同产品收口299cd7c。官方Prisma migrate deploy由原backend.env注入，只前向应用两份新迁移，exit0；144记录含原142整行／checksum不变，新两份checksum与最终SQL一致。迁移后122张原表哈希／计数、私密配置／login文件、原材料全部字节保持，四新结案表0行，无自动Grant／Boundary／账号写入。核验脚本首次查询不存在的Case结案锚列而失败，数据库迁移已成功；仅修ignored检查脚本后只读复核exit0，不重复迁移／重置／业务写入，记录`recovery-preview-check-repair.json`。

原start入口启动后frontend/login及backend/health均200；正常原私密密码／cookie只读案件14列2行、公证17列2行和线索空态，exit0、0业务写入，没有使用fixture身份或输出秘密。迁移后／浏览器后分别核122张原表和120张业务／凭据／授权表相同；浏览器核对排除auth_sessions／auth_throttles这两张正常登录会变动的表，其余所有原数据、账号凭据、授权、142迁移记录、材料及配置保持，两案阶段未推进，新结案事实仍0。截图实际读图，案件宽表在容器横滚；线索为空是原事实，无假数据。证据分别在本机preview/runtime/ca016-{before,backup,after,browser-readonly,after-browser}.json与I `recovery-preview-health.json`。真实原账号未加结案Action，不能将普通页面可读称为真实账号结案办理已获权；需明确目标账号／角色／范围才另行授权。

恢复旧15433验收服务初次在I因缺主仓Compose环境值未执行；改用主仓既有私密配置恢复同一服务，没有初始化／迁移／reset。只读环境指纹恢复为原8cc HMAC `343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`（01:16:09 UTC），Node／pnpm／镜像／浏览器／输入未漂移；未重跑已通过的业务验收或完整verify。生产、Demo8123及其他业务库未操作。

本轮交付已完成CA016＋案件字段摘要＋N2；唯一Next仍CA017，尚未冻结／实施。下一批先从末次实核main冻结ARCHIVED及准确结案版本锚、归档业务日／类型／原因和追加原因更正，再按既有独占文件边界划分后端／迁移高风险Task、独立面板、共享API与详情接线、I组合验收；支付、案件实收／结清、历史补录、重开和真实扩权不夹带。这里只给任务建议，不提前修改归档模型或验收合同。

末次实际交付回执由同一独立Reviewer只读核对Git、备份、122／120表逐项哈希及计数、旧142迁移行、私密配置／文件哈希、两案／六凭据、浏览器exit0／0业务写入和环境指纹。另报M1（Next标题残留“待CA016完成”），I仅改为待领取、未冻结／实施并更新快照，01:20 UTC文档专项四项exit0；复核关闭后最终Spec／Quality ACCEPTED、C0/I0/M0。范围只为非执行性收口／回执，不重新宣称全产品审查或旧完整门禁。本实际记录回填后的文档专项及末次远端SHA另保留`recovery-final-*`回执，产品／tests／工程输入继续逐字保持8cc。

## CA017最小工程冻结与派发准备（2026-10-14）

实核main／远端基线`3f636ea5f7f1adfef0adaf215dd97384ac87a318`／tree`3c7d8896461a07521f49fd9c66c3aa0e0810991d`，I干净并从该基线创建codex/ca017-archive-integration，原CA016集成分支和四作者refs／成果保留。只写既有cases／DOMAIN、roadmap、project-status、VALIDATION及对应快照；合同按SD-23／28／39／44／54、CA016源码／144迁移及Demo最小日期／六类型／原因冻结，没有正式代码／schema／迁移／测试实现或持久库操作。正常当前PRIMARY律师可归档，获权内部运营原因更正，准确结案版本与旧事实／回执／文件字节保留；分类不是实收，未扩真实Grant／Boundary，不能称CA017功能或业务验收完成。

未参与合同写入的独立gpt-6-sol Reviewer自行只读核累计diff、批准决定、CA016 schema／service及closure SQL强制WAITING_ARCHIVE的真实接点，确认新前向迁移须精确接续closure final／helper与matching→finish末端、不用`>=`或非空头跳过。Spec Compliance／Quality两轴ACCEPTED，未关C/I/M0/0/0；检查B17／P17／F17／N17白名单无重叠、B17共享后端和F17共享API单一作者、固定API后N17接依赖及I独占环境／E2E。此为可实现性技术审查，未执行代码／PG／浏览器或产品门禁。未来I稳定组合按合同采用Level 3完整verify与风险专项，旧CA016证据不冒充本片通过。

四执行目录复用原CA016干净停写目录，旧任务成果仍在原refs；共同锁文件／运行时输入须与基线逐字相同，B17的既有生成schema再核同一性，前端目录不把未生成后端Client视为依赖坏。冻结候选及正常格式／Spec／严格context检查实际结果、复用输入／目录就绪、精确HEAD／tree均保存ignored `.local/ca017-evidence/{freeze-checks,freeze,worktrees,dispatch-ready}.json`，不在正文写自身提交SHA或预称尚未返回的操作完成。首次只读复用检查误将前端P17旧后端schema当共同运行输入而停止，无修改；按职责分别核共享九项与B17 schema后继续，不为前端目录重新安装后端生成物。各目录实际准备只切干净工作区到固定冻结新分支、保留原refs，依赖输入未变时不重复安装；如缺失才按冻结离线入口补齐，不运行setup／bootstrap／seed或DB。

CORE-CA-018仅为已批准SD-23外部转入／历史补录后续入口预留跟踪标识，没有新业务批准、技术冻结或实现。本轮只交父级CA017派发准备；5186／3206／15436保持已验3f636ea、144迁移和原数据／账号／授权，Worker不得写入。真实新Action权限仍需明确目标授权，隔离测试只用backend/.env.test的15433合成流程。

## CA017实现及隔离集成验收（2026-10-14）

固定候选`4487f9bd87a4b19fd3155e6d3d70cfcbf42dbc6c`／tree`2076936e64420f2690b178271a7903a64efd8410`，产品与单位／构建输入最终不再改变。四作者自身固定源为B17 `714675b07701878789eb487feb36a471763e067d`、P17 `e1032f351778d22d3ce4a4537de73238c0529b9f`、F17 API `e16420ba1d3ee35fcb8b59d984ef70cee5fba79c`／详情`860c2dbeca3db4934a1c57854ae202289101d44f`、N17 `379b5ec82f0bd992a9022249924c215281879f72`＋`7b6fc3d4a34fc0d6de7c089e633ae19973973b1f`，依赖副本未重复接纳。源提交仅作为作者交接证据；I固定组合独立Review两轴ACCEPTED，未关闭C/I/M0/0/0。Reviewer发现SPA用例整页导航错误，I修复站内RouterLink／同document history返回后复核关闭。

实现本案精确当前Closure锚下WAITING_ARCHIVE→ARCHIVED、内部带原因追加更正、六业务分类、真实归档业务日和完整原因；PENDING金额／null结案日／空附件不阻断。内部有权运营和当前PRIMARY律师分别按即时Action／scope／binding授权，原因更正仅内部。八键固定原回执、逐案串行CAS、immutable版本／审计／回执及三模型精确末端链前向接续完整matching→Finish／Closure守卫。原Closure／Finish回执与准确旧材料保持，金额及分类不推实收／结清。内外投影、ARCHIVED阶段／计数、N1／N2及已有分页接续；新两权限不自动回填真实Grant／Boundary。未修改已执行的144份旧SQL。

完整`pnpm verify`实际02:30:06.031～02:34:16.907 UTC exit0：工具80/80、前端105文件1672/1672、后端112文件1451/1451、全部静态及双构建，Vite既有>500kB告警保留。启动名义HEAD为abdc084；运行中修正同一browser E2E三行（展开折叠段／真实日历hook），因此不能称该次为最终干净tree完整verify。`stable-reuse-proof.json`逐项核17组产品／单元／构建输入相同，独立Reviewer确认限定复用；最终4487f9b另实跑根E2E types、受影响Lint／格式、严格context和Spec全部exit0（02:40:57 UTC）。没有自动affected推导或复用CA016整片通过。

风险正式首轮02:35:59.085～02:39:14.720 UTC对9文件16个明确selector实跑，15过1失败；执行期间仅browser文件和快照漂移，不能写干净16/16。失败为operator客户端旧附件拒绝断言期望403实际404，既有CA016合同及测试允许403／404遮蔽；实际归档、更正、刷新／重登、历史、原律师精确下载和客户最小投影均已成功。I仅对齐此测试拒绝预期并禁用截图过渡动画，无产品修改。最后02:40:44.260～02:41:29.647 UTC在同干净4487f9b／tree前后`case-archive.spec.ts` 3/3 exit0（正常运营、当前律师及撤权、丢失成功原参重放）。余下13项为CA017 PG3＋迁移1、CA016 Closure3＋PG2＋迁移1、旧Finish PG1、真实14列/N2列表1、21条内部/客户分页1；9组包含整个tests/support及全部具体旧/PG验收文件、另17组产品／配置输入逐项同一，Reviewer核接受限定复用13项。不是三方作者证据拼成同树16/16。

CA017 PG证明grant/scope不拼接、撤权原键重放拒绝、旧Closure／Finish固定回执、准确结案锚、竞争更正仅一方成功、六分类不推财务；五个已到达写点分别对归档与更正注入故障，头／历史／审计／CAS／回执全部回滚，原参再提交成功；11个直接SQL反例拒绝并保持快照。迁移先在15433受控随机schema完整146空链通过，再正常public deploy成功；恢复后的public实际空库且无_prisma_migrations，未据旧环境指纹虚称144数据恢复。正常API完成的真实Closure来源／旧事实／审计／回执／精确元数据／材料字节复制到独立144schema，146向前升级、第二DDL注入失败保留enum但DDL原子回滚、向前重放及stage-only绕过拒绝全部通过，无真实Grant回填。全部只用backend/.env.test／15433和独立私有测试文件根。最终环境HMAC`343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`、Node24.21.0／pnpm11.27.0，仅环境旁证，不代表数据库内容连续性。

ignored证据入口`.local/ca017-evidence/`：b17-review、combination-candidate、empty-migration-probe、public-deploy、verify-fixed、final-risk-16、browser-final-3、stable-static、stable-reuse-proof、environment-current及各日志。三视口1440／1024／390截图browser-artifacts/archive-*.png已实际读图；正常读取真实归档与原结案数据，手机页面无水平溢出；fullPage固定栏出现位置是拍摄时滚动位置，最后截图关闭过渡动画。

本片已验收并原子交付main，实际Git回执见末段；演示升级依用户测试窗口另行协调。用户02:33 UTC预告、02:38 UTC开始人工测试，父级要求保持持久演示5186／3206／15436的CA016 `3f636ea5f7f1adfef0adaf215dd97384ac87a318`、144迁移、原2案／6凭据／授权／文件；本轮没有预览迁移／重启／密码或权限更改。CA017预览更新等待协调测试窗口，不将5174／3101隔离验收入口当演示入口。不做生产／真实资金／新长期凭据、reset、seed或历史删除。Next CA018仅独立合同与独占任务建议，未冻结或实现。

CA017 Git实际交付回执：六份必要docs/context收口commit`f9d6201f1160bc27a960e32c9e88a0581601bf7a`／tree`56ef4d137218727c2a2c852fe1c556078008dae7`相对已验4487f9b只非执行性收口，产品及验收文件逐字未改；独立文档Review发现路线图／Spec当前态残留未完成，I修正后M1关闭，双轴ACCEPTED、C/I/M0/0/0，文档格式／严格context／Spec／diff实际通过。02:49:59.582～02:50:05.435 UTC `git push --atomic` main＋codex/ca017-archive-integration exit0，随后ls-remote两个ref精确f9d6201；主仓已核3f基线且只有原.pnpm-store，快进至f9d6201，原stash仍保留。证据ignored `.local/ca017-evidence/{closeout,push-first}.json`及日志。本段是实际操作后的文档回填，最终文档回填SHA/远端复核以同目录final-push回执为准，不反写自身提交SHA、不重复产品门禁、不称未查询的CI已过。持久预览保持3f/144，用户人工测试中，本轮无15436数据迁移或服务重启。

## UI002案件工作页实施准备（2026-10-14，尚未实现）

基线main `696fad75ad427ce7431866c0710806983fdf9ba5`／tree `bd378946d0cf3d256816c7244340a271a35407b5`，I复用ca015-integration，新建codex/ui002-case-workspace-integration并保留CA017 refs。只同步[UI002合同](../../superpowers/specs/2026-10-14-case-workspace-ui-contract.md)、案件Spec链接、roadmap／当前状态及快照；无正式代码、API、迁移或实现Worker操作。CA018停于只读，三后续模块只排结算中心→证物管理→数据报表及前置，到阶段再细拆。

独立gpt-6-sol只读准备Review先拒绝contextKey缺caseId、刷新含义及下载参数不准确；I逐项修订，并在复核中补准列表total与下载Promise<void>、单文件403/404只移该文件。现Spec Compliance／Quality均ACCEPTED，未关闭C/I/M=0/0/0。A2／R2／M2／D2／F2独占文件、Interface、顺序及最终新组合Level3验收见合同，不把准备Review冒称UI、PG或浏览器门禁通过。

03:34:05 UTC文档格式、context record／strict、Spec和diff实际exit0，Spec为57 REQ／66 AC／11 BQ／54 SD；后续本次最小修订的最终专项结果与准确冻结SHA只据ignored `.local/ui002-evidence/freeze.json`，不得预写本提交SHA。没有重复产品verify或数据库E2E。Demo现有Edge file://tab只读选择被浏览器URL安全策略拒绝，未输入、点击或绕过；独立的本地源码及父级已核截图用于准备。持久预览仍CA016 3f/144，本轮不操作5186／3206／15436的进程、数据、账号、密码、权限或文件；人工测试窗口结束，未来稳定候选验收后仍先备份并保全原数据。

### UI002 I路由与导航开发检查（组合验收仍待实施）

父级正式派发A2／D2后，I只修改frontend/src/app/router.ts、router.spec.ts、AppShell.spec.ts及必要状态／证据。内部/cases/:id增加caseWorkspace meta；认证／受众检查后只规范非法、空或重复tab为默认details，保留原筛选、页码及hash，其他资源与身份不套工作页规则。侧栏返回明确不携带工作页tab，保留正常案件阶段／范围并沿已有规则重置侧栏分页。A2／D2白名单、分支和现场未改。

router＋AppShell两文件定向Vitest实际101/101通过，pnpm check:fast:prepared实际exit0（架构、前／后／根类型及Lint），受影响格式与diff检查通过。首次sandbox运行router用例前因Temp子目录mkdir EPERM停止、0用例；获准同一聚焦命令后通过，未把该失败当产品故障。没有运行本批完整verify、真实PG／浏览器验收或预览升级。现有真实归档／结案／列表与导航E2E准备映射留在ignored `.local/ui002-evidence/e2e-mapping.json`；等待F2真实入口落盘再适配和执行，不从Mock成功推断可用。精确提交／源码blob及检查回执只见i-router.json。

### UI002 A2／D2部分组合接纳（完整组合未验收）

A2公共类型源beab784dbfcf65a7c3c32fdd27e7ec35b53faa0b、骨架源56b6254cbda50aa9e42ad20bd0564820b378068b，D2源9b8c77e8e7684eefd7d66bee3a2cb4df16e8a5e5；父级确认三源完成停写，I核两个目录干净及八个白名单文件后，分别无冲突接入5968e37／443d580／d0e5fb37f9ce7630fec4208303780d1c181c7a77。八个源码blob与各源逐个一致。Worker报告A2 18单测／前端类型／五文件Lint格式，D2 65 AppShell／快速静态／构建；这与I实际组合检查分开记录，不冒称原Worker tree包含I路由。

I在AppShell.spec.ts补内部工作页进入／离开密度class边界；实际四文件120/120单测、完整前端typecheck:prepared、十个受影响TS／Vue的Lint、十一文件格式及diff通过。这是A2／D2与I路由的部分组合开发检查，没有跑本批完整verify、PG／Chromium或完整UI独立Review。普通任务按自审／聚焦检查接纳，稳定完整组合仍按冻结合同进行独立Review与最终门禁。R2／M2已由父级派发，R2需要A2完整固定组件而非只有类型；F2待其固定依赖后复用已停写D2目录，Teleport密度class须在实际drawer根节点。证据ignored `.local/ui002-evidence/a2-d2-acceptance.json`，未改变旧refs／Worker分支、main或持久预览。

### UI002 R2／M2接纳及F2依赖准备（宿主尚未接线）

R2源f886ab72c0a3142776e1aa0a413aa536c204cfd5、M2源e0fb389ff1f7eee8f1301b015cc1376cb31bcc9b均由父级确认停写；I核目录干净／四文件白名单并只cherry-pick实现提交为4efae18／a3fe4f9，跳过已接纳的A2类型／组件依赖。八个接入blob与源逐个一致；随后I仅将CaseWorkspaceFiles.vue的ElButton包根导入改成既有按需button入口，符合AGENTS，不增依赖或API。R2／M2原refs及目录未改。

I实际四文件32/32测试、完整前端typecheck:prepared、八文件Lint／格式及diff exit0；原Worker报告（R2 15＋A2 18、M2 17）与I结果分开留痕。A2／D2／R2／M2固定依赖齐备，F2准备复用已停写D2的ca016-frontend-integration并建立codex/ui002-f2-case-host，原被旧E3占用的ui002-f2-host候选保留。最终准备SHA／目录／runtime／strict与clean结果只据ignored `.local/ui002-evidence/f2-ready.json`；源接纳和一行修正证据见r2-m2-acceptance.json。尚未宿主接线、完整UI Review／verify／真实字节下载或PG／Chromium验收，不升级持久预览。

### UI002 I并行E2E准备与编辑缺口核对（尚未浏览器实跑）

父级已派F2 `01a1389e-d6d9-7354-b76e-e71965e64026`从b1b1866接线，I不改其目录或白名单。在既有case-archive.spec.ts和真实API来源／清理流程上新增只读工作页验收：七栏默认关闭及展开保留、三个tab／键盘、精确版本去重及真实浏览器下载bytes、PENDING不变0、1440／1024／390密度／无横溢出和三页签截图，核浏览器交互不写案件及原版本／结案／未归档事实保持。原三个归档角色／未知回执用例保留，实际入口适配待F2固定交付。

新增测试准备实过根TypeScript、文件Lint／格式、diff和项目受控pnpm test:e2e --list（4用例、1文件），不等于四用例执行通过。首次直接Playwright --list因未加载独立测试环境被模块保护拒绝、0用例；未绕过，改用既有脚本捕获backend/.env.test及资源锁后发现成功。没有运行测试钩子、服务／浏览器、DB写入或预览操作，没有本批验收截图。证据ignored `.local/ui002-evidence/i-e2e-preparation.json`。

源码核对确认Case无整体PATCH／PUT，匹配仅PENDING_MATCH；有表单入口不代表已匹配后的基础字段、已登记受理日／法院案号或冻结来源均能普通编辑。最小后续补缺建议仅见UI002合同末段，未批准字段／新Command／迁移／权限／实施Task；本批只能按实际已有命令报告修改能力，不扩大“各栏全字段可修改”的完成声明。

### UI002宿主接纳与真实浏览器开发回归（最终验收未完成）

F2源15e5c9e45167a9d36633e29629f56432b2d3f7dc固定交付并停写，I核五文件范围后接为95e9df5；Worker报告150直接测试／1755前端测试及静态通过，不代替I最终组合门禁。R2只读模型跨模块引用lead-options由I改成cases私有同语义类型映射，十个直接测试及架构边界通过，固定检查点aaf0fe3b9233d3b1fa6d715bc60ef11ecfae4d2d。当前组合未完成独立Final Review、完整verify或持久预览升级。

I实际使用项目锁定15433、5174／3101及Chromium执行开发回归：最初只读三页签／七栏／精确下载／金额／三屏宽用例1/1通过，截图实际读图后只局部收紧标题对齐及移动说明布局；归档／结案／执行结束九例先6通过、3失败，三失败均为原测试未打开新抽屉入口，保留原权限、原body/key、回执、真实文件bytes及数据库断言修正后3/3通过。根类型及受影响E2E Lint／格式通过。这些脏开发现场结果不是固定候选最终验收；原失败及后续补测均保留。

新增正常密码运营真实匹配＋起诉请求恢复反例，在aaf前端实跑RED：真实匹配POST201并故意丢响应，GET已前进，离开calendar再返回原匹配重试命令消失；未静默重发。证据ignored `.local/ui002-evidence/matching-spa-red/`保存原trace、错误上下文、源码／测试哈希和真实15433目标。独立Sol任务ui002_spa_intent_recovery正在隔离目录修复App案件缓存、稳定caseId、授权重验、Hearing迟到结果及旧Panel离页后请求链，I不并行修改该范围。不能把尚未通过的匹配反例记为完成。

另适配原case-hearing.spec.ts，仅沿真实命令打开工作区受理／开庭抽屉及新标题位置，保持原角色、过期登记、带原因更正、自动推进、历史与越权断言；项目受控PG／Chromium实际1/1通过（30.3秒用例），根类型和文件Lint／格式通过。缓存修复仍在进行，最终固定组合需复验受影响用例。这一开发结果不含前端未集成修复，也不代表生产发布。

### UI002稳定组合审查与开发GREEN（完整门禁待执行）

SPA固定源f46a0c2／f2cb2ac／9de1248分别接为7173e16／8748f4b／41fb153677faa4a3dea0a9b55e88b5e15d1c54f6；29／2／10文件均在获准frontend白名单，源目录干净停写，无后端、API或迁移变化。Worker分别报告405／28／200定向测试及类型／Lint／格式通过；I独立Final Reviewer核main696fad75至41fb153完整组合，Spec Compliance与Code Quality双轴ACCEPTED，未关闭C/I/M0/0/0。原Minor（成功后的空旧表单入口）与Important（inactive／active身份变更抢先材料GET）均已由审查主体核关闭，实际App请求计数RED／GREEN直接测试随源保留。

用户后续实图要求已在e6e1b4e实现：三／二／一组字段标签和值对齐、淡横线、无竖线／灰底；判决收到日期、待确认金额、已缴0.00元同行；长字段及文件独占行、历史可折叠。两只读投影组件／模型15直接测试通过；实际三屏宽展开截图烟雾1/1通过，I已读桌面案件／判决与移动执行图，数据来自真实隔离API链，未补Demo虚构字段。开发截图在ignored ui002-evidence/fields-development2，最终固定候选须再留验收图。

原cases匹配、同部门只读／跨部门404、普通密码匹配上传起诉三条沿新入口保留原断言，开发检查2＋1通过；新正常密码匹配＋起诉先真实POST201再丢响应、GETahead／calendar离返／原body/key显式回执比对实际1/1 GREEN（8748产品）通过。期间新测试误等不存在POST/materials，随后误把真实PUT完成200期望为201，两次测试准备错误均已修，不记为产品缺陷，业务POST仍严格断言201。完整verify与固定14项PG／Chromium尚未执行，不提前写通过。

持久预览仍3f636ea／144，按原私密正常登录只读核两案、0业务写入：0001处于WAITING_EXECUTION_STAMP、canMailExecution=true；0002处于WAITING_EXECUTION_FILING、canSubmitExecutionFiling=true。两现有面板及受必填约束的核对按钮存在，旧标题只有刷新，不是完全无推进权限；新版主动作应分别为登记执行邮寄／登记执行立案。真实账号不扩权、不代办两案，升级后再核主动作打开并取消与数据保持。数据来源与后续最小编辑缺口结论只在UI002合同，不声称联系方式或受理更正已实现。

### UI002断网恢复与浏览器失败留痕（2026-10-14，尚未最终交付）

08:40 UTC实际终端恢复，15cca4ef8b3270e6310906e671f41e2660ac528f／tree7df299948212f79e60a8799540d6d64c5e115430干净，旧源码和日志保留，原恢复检查点补丁未落盘。旧final-15-pg.log只确认11项，完成JSON缺失；旧进程和子进程已结束、3101／5174空闲。原日志副本与锁owner记录保全后恢复共享测试锁；15433为Compose的tmpfs测试库，宿主重启后空库，标准db:test:migrate:deploy只在15433恢复146链，不是重复迁移15436持久数据。启动命令首次缺主仓私密Compose变量而失败，未初始化凭据；改用原主仓.env后正常恢复，凭据未输出。

完整verify实际候选4419c10cc9461a1ece4f1c71a5ab1934ab72244d／tree111020a7fbca3102c92c3d2029f0a44d684d2b24，于07:39:13～07:43:23 UTC exit0，80工具／1779前端／1451后端、静态及双构建通过；15仅helper和snapshot变化，17组产品／单元／构建／运行输入逐字相同，累计独立Review双轴ACCEPTED C/I/M0。限定复用不是15完整verify。drawer CSS曾放Vue模块直接导入导致Node测试unknown CSS extension；已移到既有main.ts按需style入口，未改依赖或绕过Vitest；同候选完整verify证明修复。此前七栏、八栏初试、分组定位及drawer辅助用例失败证据保持，不拼接为最终组合成功。

15恢复后完整14项受控PG／Chromium于08:45:49～08:51:15 UTC exit1，11通过／1失败／2未运行。第12项原matching请求显式重放成功、原body和固定回执断言已过；CaseDetail确认成功后正常移除retry并关闭drawer，测试立即打开complaint时helper把尚处于关闭过渡的drawer当打开并点击已隐藏关闭按钮，120秒超时。仅在原重放成功断言后等待dialog隐藏，不增超时、force click或重试，不改产品／API／权限；聚焦复验及最终14项尚待完成。实际head/tree/exit/clean及前后环境HMAC见ignored reconnected-15-pg.json、reconnected-environment-{before,after}.json；完整失败trace另存reconnected-15-failure-artifacts，中断副本final-15-interrupted-0749.log及原失败记录均保留。

b73b82a506958da535bc16f0cb6f579eb25eb88e固定聚焦三项实际2通过／1失败：原请求丢响应／SPA显式回执恢复与同部门只读／跨部门404均通过，普通密码多文件兼容在旧matchCaseThroughBrowser正常匹配成功后紧接打开complaint时命中同一关闭过渡抢点，240秒超时。进一步仅在该真实匹配成功状态断言后等待dialog隐藏，不改产品/helper、不增加超时、不绕过点击；原两处完整断言保留。完整log／trace／JSON见ignored focused-recovery-pg及focused-recovery-failure-artifacts；该失败不计为通过，下一步先复验最后兼容用例，再固定最终14项组合。

持久预览已为fc1c9f3c03c532eb26ae6c0f1c9859cb5da01f6c／146，原144→146前向升级记录保留。原start入口恢复后再次核124张业务／凭据／授权原表、2案／6凭据、材料及私密配置保持，归档新增事实0；不reset／seed／改密码或扩权。146新完整备份runtime/ui002-reconnected-146.dump为1,113,990字节，SHA256 ef27cb222f02c0afb7eff51d16cbdf121dc8a934c0220abf05af51274f1b65b5，pg_restore TOC可读、未演练恢复；旧1,074,833字节备份及旧dist保留。预览尚缺最终抽屉CSS，UI002未推送／合并；08:50 UTC远端main实核696fad75，主仓原.pnpm-store和stash保留。

### UI002八栏与抽屉最终组合验收（2026-10-14）

稳定源码／测试候选`648faa1da8a625a7d450a8d999ab7e292deaa446`／tree`6ecd8aef04afa4df8c33882c7a0fc8a23dd29b57`，正式14项受控PG／Chromium于`2026-10-14T09:04:26.4601208Z`～`2026-10-14T09:07:30.5713751Z` exit0、14/14，前后候选精确相同且干净，环境HMAC `343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`相同。覆盖真实八栏默认闭合、三标签／键盘／三屏宽／真实文件bytes／PENDING与KNOWN0／历史归属，内部及当前PRIMARY律师结案／归档／执行结束／撤权、正常开庭／更正／推进、原匹配／同部门只读／跨部门404、普通密码多文件和真实201后丢响应／GETahead／SPA离返／原body/key显式固定回执恢复。最终日志和JSON见ignored stable-final-pg，最终截图在test-results及随后保全的stable-final-artifacts；不拼接先前中断或失败作为本次通过。

完整verify实际4419c10／tree111020a于07:39:13～07:43:23 UTC通过80工具／1779前端／1451后端、静态和双构建；17组backend／frontend／scripts／依赖／配置／运行输入与稳定候选Git tree/blob逐字一致，复用明确限定于产品、单元和构建。441之后只有浏览器helper、cases测试中的真实自动关闭等待、非执行性状态／验证文档及快照；根TypeScript、相应Lint／格式、strict／Spec已实跑，架构检查此前同输入通过。独立最终Reviewer及两处时序补审累计双轴ACCEPTED C/I/M0。不是稳定候选重新跑完整verify，也不把旧七栏证据当八栏验收；审查／proof见ignored stable-648-review-static、stable-input-proof及后续final-input-proof。成功后切换调用点一次只读核对：只有匹配与起诉成功自动关闭路径需要等待真实dialog隐藏，原回执／body／key／bytes／权限断言保持，无新增sleep、force click、重试或超时；聚焦原请求恢复／404两项及最后普通兼容1/1分别已过，最后只运行一次稳定14项组合。

持久预览已从fc源码同步稳定候选，5186／3206健康通过，15436仍146迁移；本轮样式同步不执行持久迁移、初始化、reset／seed／改密码／扩权。正常私密账号三页、三tab×1440／1024／390、八栏默认关闭及无整页横溢出通过；原0001执行邮寄、0002执行立案真实主动作按原can*打开并取消，drawer为fixed overlay、absolute flex且贴视口右侧，0业务写入。124张原业务／凭据／Grant表、2案／6凭据、材料／配置、原144迁移行保持，新增归档事实0。新增146全库备份`1113990`字节、SHA256 `ef27cb222f02c0afb7eff51d16cbdf121dc8a934c0220abf05af51274f1b65b5`，TOC可读、未演练恢复；旧备份、完整dist、stash和.pnpm-store均保留。实际只读／数据及健康回执见本机runtime与ignored preview-action-final、preview-final-health；只读图片实际核对，不复用未带drawer CSS的旧预览截图。

本次只补真实结果及当前状态，随后按非执行性收口例外执行受影响文档格式、strict、Spec及diff检查，固定收口tree并核正常快进／原子推送；远端回执取得后再补记。不新增业务规则／API／schema、不改旧迁移、Demo或生产。普通联系方式、受理信息受控更正、实收／结清、重开、历史补录／外部转入及其他详情页新布局仍未实施。

预览只读脚本首次调用漏传其要求的精确目录参数，在登录前失败，未有业务或权限写入；原preview-final-readonly.log保留，补齐参数后的preview-final-readonly-rerun及实际动作／几何／数据检查均通过。不是产品故障或迁移重试。

### UI002原子交付回执（2026-10-14）

应用收口bac9a2642f239190afd95340d1f24bfea438e15b，09:22:36～09:22:43 UTC git push --atomic exit0；随即ls-remote实际main与codex/ui002-case-workspace-integration同SHA，本地主main正常ff-only至同SHA、仅既有未跟踪.pnpm-store，原恢复stash保持。没有force push、reset或清理。独立收口文档审查发现合同77与路线图现状表33旧当前态，已统一修正并由原Reviewer核关闭；产品无finding，累计双轴ACCEPTED、C/I/M0。

648faa1后的0c4／bac9只改文档与快照，17组产品／单元／构建输入和完整tests tree与验收候选逐字相同；格式、strict、Spec及diff实际通过，复用仅限已证明输入，不冒称bac9实跑全verify／14PG。原80／1779／1451及双构建来自441，14PG来自648。末次本段只补已发生的远端事实、完成态和快照，再执行受影响文档专项并原子同步main／任务分支；最终末次SHA见ignored remote-final-receipt.json及交付报告，不能把本段回执SHA误作未来任何新树通过证据。

持久预览保持已验648产品；末次只同步相同产品的文档ref，前端／后端／schema和完整tests输入一致，不重复迁移或初始化。原2案／6凭据、124业务／授权表、材料、配置及146迁移已实际保全验证，0业务代办；源、备份和恢复指纹见本机README/runtime。普通联系方式、受理日／案号受控更正仍未实现，下一阶段先冻结独占最小合同，CA018保持只读暂停，不重复派发已停写Worker或在本批新建业务Task。CI未查询，生产未操作。

### UI002“当前”展示修复与暂停恢复验收（2026-10-14）

用户要求盘查全前端并直接删除误导性“（当前）”，不能改成“本轮”。58个命中文件及动态标题按真实业务stage、最新记录、选中态和普通权限／范围／版本语句分类；分类证据ignored `.local/ui002-label-evidence/current-text-audit.json`。事件组和二审步骤仅保留真实业务名称／序号，历史仍可辨，选择态仍aria-pressed；真正当前阶段来自item.stage，已确认执行事实不再在后续阶段声称“当前阶段待盖章”。匹配、起诉及正式立案成功提示改完成时结果。技术轮次、截图、文件版本和费用来源标识进入可展开次级详情；主视图保留真实文件名、来源和金额语义，未知轮次不默认初审，未提供版次不虚构。

第一次冻结候选`3b6416fd6fd8aaa4c3934ecd923952fa09463807`／tree`aee1eae856642f1a13cd8e63cd0b42e78891b5ee`，8个直接前端spec实际108/108，通过check:fast（架构、前后端及根类型、Lint）、strict、Spec和修改文件格式。正式入口PG／Chromium5/5于10:06:09～10:07:07 UTC exit0，同干净候选和前后环境HMAC `343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627`；覆盖真实三tab／八栏／三宽／原文件bytes／PENDING、匹配及刷新、原body/key丢响应后显式恢复、只读下载／跨部门404和正常密码上传起诉。原日志JSON在ignored ui002-evidence/label-final-pg，8spec在ui002-label-evidence/final-eight-specs-retry.log。此前89过2失败为新测试顺序／时间假设，已纠正；严格类型缺confirmedByUserId已补；普通沙箱首次无法创建Vitest临时目录、0测试，获准执行后通过，失败日志保留，不计入成绩。

10:07暂停时预览脚本工具调用中断未落盘。11:19后真实终端恢复只读核3b HEAD和tree干净、远端main及原UI002分支仍eccd28e，5项完成JSON已落盘，无残留测试／浏览器进程。持久预览source已是3b，但宿主断连使原应用PID死亡、端口空闲；保全services-before-pause-1014-1125.json后只沿原start启动原专用容器和应用。未重开已完成5项、未重复迁移／reset／seed或初始化。恢复首次只读浏览器在normal-login因服务尚未启动失败，0业务写入，log保留；服务恢复后用独立新证据名重验。

独立Sol审查3b为Spec REJECTED／Quality ACCEPTED、C0/I1/M0：截图版本和费用来源ID仍直出主视图。修复仅4个前端源码／测试文件及已核快照，最终稳定源码`be71b5b57ecabd7c436fd0faf9011b968ad0c5af`／tree`5392bec3eb0f5599a828265768e66868446cf213`；截图保留真实引用数量和未读取说明，原版本ID标为technical，费用保留来源名及金额状态、原精确来源ID折叠。相关read-model／Sections／Fees三个spec实际32/32（含新增截图和详情开合反例），check:fast、strict、Spec、修改文件格式及diff均exit0；ui002-label-evidence/review-fix-final-three.log及review-fix-final-static.log。审查主体固定新SHA后确认原Important关闭，累计Spec／Quality ACCEPTED C/I/M0。5/5 PG仅对应3b，不表述为be71或最终文档tree实跑；原批14项及441完整verify也仅属原批，不借作新前端全仓门禁。本次Level1展示修复不更改API／授权／状态机／数据库／资金规则，无全仓verify重跑。

持久预览源码be71、5186／3206 HTTP200，15436仍146迁移；11:25最新全库备份runtime/ui002-label-final-current-146.dump为1114251字节、SHA256 `346d62467036162af505eaa9931ded9673750f1a28ceaf96dc88a13b07e347fb`，TOC可读、未演练恢复，10:05备份及旧备份／dist均保留。正常原私密密码和cookie只读三页、三tab×1440／1024／390、八栏默认关闭和无整页横溢出通过；两案API实际stage与页面相符，执行分组无当前／本轮后缀、仅一组被选中，技术及文件／费用来源详情默认折叠可展开。实际桌面执行与移动费用截图已读取核对，验收0业务写入。最新基线前后129表中除正常登录session/throttle外业务表无变化，2案／6凭据、授权、配置、全部材料和迁移行保持，不用用户早前数据状态覆盖现有数据。证据runtime/ui002-label-final-{before,backup,after,browser-readonly,case-audit}.json及ignored preview-final-health／readonly；账号密码不输出。

源码冻结后仅补真实完成状态、上述证据和对应快照；正常快进及原子push前执行文档格式、strict、Spec和diff，逐项核累计收口diff只有非执行性文档，不改变上述验证输入。11:30:54～11:30:58 UTC实际原子push exit0，远端main／codex/ui002-record-label-followup与本地主main均实核d843a62515ea848040296a85a987dd41d1091aa3／tree463cb7981d66365c452ee220d4d1f33fcbf0f1e7，remote-first-receipt.json保留。末次仅补本段实际回执、已完成状态及对应快照，不改变产品／测试／构建输入；最终远端SHA和实际push回执另存ignored remote-final-receipt.json并随最终报告交付。原UI002分支eccd不改写，原main stash及.pnpm-store保留；不声称CI或生产部署完成。Next仍先冻结案件字段编辑补缺，CA018只读暂停。

### CORE-CE-001联系方式与一审受理更正最终验收（2026-10-14）

依据SD-55／cases最小冻结；I独占集成、main及权威文档，B／F／D隔离作者均停写。范围仅稳定被告phone／address普通保存和真实一审（含发回重审）acceptedAt／courtCaseNo追加带原因更正。后端两个内部Action复用当前授权及SELF／TEAM／DEPARTMENT范围，固定原body/key回执与独立资料revision；Case.version／stage／当前轮次及归档锚保持，原登记事实、原回执／审计、冻结材料字节保留。当前受理更正同步案号，历史轮次更正仅改变有效投影，真实发回撤销恢复有效旧案号；内部更正历史不泄漏到律师／客户投影。表单只在案件信息／一审信息分区，简单取消不保存，同案GET刷新后不能借新revision发送旧草稿，未知结果保留原body/key显式恢复。二审独立受理字段尚未实施，CA018仍暂停。

稳定源码／测试候选 **90ca244df2ffb95917026226411978dc2197a569**／tree **8ef42b4b8fd5e69797e15a0bbcc2577e1ec683ae**；正式受控PG／Chromium **11/11 exit0**，UTC **2026-10-14T14:43:56.3049508Z～2026-10-14T14:45:33.1608658Z**，前后HEAD／tree相同且干净，环境HMAC **343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627**一致。7项新验收包含合法受理日期真实改变、旧revision／越权／撤权后重放、旧作者撤权后新有权作者两种revision接续、并发单胜、SQL失败原子与重试、归档原锚／回执／材料字节保持、真实发回历史有效案号恢复，以及普通密码浏览器保存／取消／刷新和真实201后故意丢响应的原body/key显式恢复。4项旧兼容为开庭并发单快照、判决选择／撤销／更正、当前律师重提精确历史，以及旧CA010的130链回放和128／129前驱升级。没有拼接失败或未执行为通过；final-90c-combination-pg.{json,log}及trace／四张1440／390截图在ignored .local/ce001-evidence，已实际读图核表单、按钮和手机宽度。

累计独立非实现Reviewer ui002_final_review 的Spec／Quality均ACCEPTED、未关闭C/I/M0/0/0。最后源审查2aa2841，只接纳当前服务snapshot临时schema134→148准备修正；两旧browser的真实toolbar阶段定位和正常关闭抽屉等待已在98e3406补审，原业务断言不放宽。实际根类型、受影响E2E／helper的Lint／格式／语法、strict 1045和Spec57 REQ／66 AC／11 BQ／55 SD通过。Reviewer静态接纳不冒称执行了真实PG。

**完整verify实际**在fa6a38e7fa965b9f63b3926722117c92577cdb8c／treebfcc80744aed23d121cf298498c5ec4497289864，于2026-10-14T13:06:57.4506235Z～13:12:07.6457723Z exit0：工具80、前端1814（113文件）、后端1467（113 suites）、架构14模块／132模型、全部静态、Prisma生成及双构建通过。后续变化仅三份E2E的真实日期／分区／旧页面定位、当前服务snapshot临时schema准备函数，以及非执行性状态／证据／快照；backend／frontend／scripts、依赖／锁／workspace、根TS／工具Vitest／Lint／Playwright／格式输入逐字相同，verify-input-reuse-90c.json按这些明确输入限定复用。该helper只供真实E2E，并发断言／历史128和130迁移专项未变；新根静态及最终11覆盖变化，不能称90ca或收口HEAD实跑完整verify。

**148迁移专项实际**在959eb312d167c3d37e5d12b1aa16e959aa5326e9／tree2dcf338568be247201c6a8a7087cf75327a2108b，于2026-10-14T13:00:27.2664764Z～13:00:51.8962926Z **1/1 exit0**，先随机schema完整148空链、146原归档事实／审计／回执／授权／文件bytes升级、失败回滚重试及SQL反例通过，再于13:01:38 UTC只将15433 public标准前向146→148成功。旧146后端构建仅用于生成真实前驱资料，来源与P原146构建668文件一致；不是新API验收构建，新API用fa6完整verify生成的当前构建。新增枚举SQL SHA256 38207affd9261cddebc8c31db45a5ec65cd4edd553093b418208079d20b02eea，新事实／守卫SQL d12f3d2dd371d8bba32c2aa2af614073efdcf6ab626411d25bc1abd160635d69；后续没有SQL或产品变化，原146迁移文件不改。

**失败及恢复留痕。** 01c首次临时迁移遇保留字grant，7e9精确UPDATE错误文案断言不符，7e3多表trigger误访问不存在NEW字段；产品SQL草稿修正和测试精确文案修正各自保留，最终先临时通过再部署public，不改已执行SQL。959完整verify首试止于三新模型owner缺项，I登记cases主责后fa6正式完整通过。fa6／56d新7组合分别因测试错误期待当前Case案号不变、错误today越过真实下游日期而停；只允许已批准案号变化并明确每根真实日期，正常来源日前两天→today合法日期改变覆盖保留。c2e主日期／归档／发回3过，browser用了旧global primary；改实际分区编辑入口后478两browser真实2/2通过。旧compat478因旧page-head阶段标签停，集中适配真实toolbar及关抽屉后cb0律师聚焦1/1；cb0最终11实际1过／1败／9未跑，旧snapshot只建134表而当前查询需新corrections表。只修该当前服务fixture至148，判决／旧130先2/2、snapshot90c先1/1，再稳定90c最终11/11。所有原失败JSON／log／trace保留，不冒称旧组合通过。自动审批曾拒绝未经执行的原env无用读取、旧146准备和草稿mjs浏览器命令；先取消无用读取，另两项分别按实核旧146及I正确.js导入新证据仅一次安全续执行，均已解决，无待批准动作，不绕过拒绝。

**持久预览与数据保持。** P仍独立ca013-014-integration，source90ca244；5186／3206健康200，15436专用库前向146→148成功，无reset／seed／改密码／Grant扩展或生产操作。新完整146备份runtime/ce001-current-146.dump **1114390字节，SHA256 79f257e240b7a1d54ac603b4404d317d9ada76eaafc8ebdac60d930c897a12a6**，TOC可读、未演练恢复，所有旧备份保留；原dist另存ce001-backend-dist-before，新dist **678文件与已验fa6逐字节相同**。127张原业务／凭据／授权表、2案／6凭据、原146迁移整行、配置及材料bytes保持；正常原私密账号两案×1440／390只读通过，0业务写入，新事实0，当时两个新Action仍拒绝并有明确禁用原因。正向新写只在15433合成授权账号验收，不能称普通预览账号已获新编辑权。证据在P私密runtime/ce001-{before,backup,dist,migration-result,after,browser-readonly,after-browser}.json及只读截图；登录凭据不输出或转发，恢复仍沿原README的start／stop入口。

收口只同步真正受影响的状态、路线图、Spec完成标记、验证记录和context；SD-55业务合同、产品、测试、配置、依赖和迁移保持。主仓原stash／.pnpm-store及可复用工作树保留。2026-10-14T14:53:52.1378730Z～14:53:55.8376303Z正常main快进及main／codex/case-record-edit-integration原子push exit0，两个远端及本地主main实核d626334a7a789b0a8d6e03460e32c8659b157482。首次只读远端核对遇GitHub443连接超时，随后仅重试只读ls-remote核两SHA相同，未重新推送。末次只补实际回执与快照，产品／测试输入不变，最终SHA见ignored最终远端回执及交付报告；未查询CI，不称CI或生产发布通过。

### CE001用户确认后的本地测试账号授权（2026-10-14）

用户随后明确同意“测试账户可以开通”，15:11:26 UTC仅为唯一原测试账号ca013_preview_admin（CA013 Preview Administrator）增加case.defendant-contact.update与case.acceptance.correct，沿用CA013 preview部门既有DEPARTMENT案件范围。原角色所有历史／当前分配均仅该账号，未新增管理员／账号、未改其他账号／角色或密码；role版本2→3、目标authorizationRevision2→3并记本机审计。15:14:54两案真实后端均有两Action，两个表单逐案打开／正常取消通过，业务写入0；五分钟临时内存验证会话已撤销，没有读取密码或创建长期凭据，也不把此轮称为正常密码登录。126张非权限／审计表及其他用户／角色两个子集共128项保持，原Grant／审计整行另核不变，仅新增两Grant和一授权审计及正常会话活动，原2案／6凭据、材料／配置／148迁移和产品源码不变。精确回滚只移除两新增Grant并递增角色／用户revision、追加撤销审计，不降revision或删历史；须另获回滚授权，未执行。证据和回滚脚本见P本机runtime/ce001-permission-{granted,before,after,browser,session-cleanup,after-verification,final}.json及ce001-permission-rollback.sql。

本次不改产品、测试、迁移、业务合同或后续规划。首轮只读验证误用不存在auth/me而在认证准备阶段失败，原五分钟会话已确认撤销；按真实auth/session修正后正常后端认证／详情能力和表单开合取消通过，不重复Grant或写入案件。先前正常密码登录证明、源码90ca最终11及fa6限定完整verify复用边界仍保持；权限开通是用户明确确认后的独立本地配置变更，不冒称自动增权或生产授权。

## CORE-CE-002二审受理字段补缺验收（2026-10-14）

依据SD-56／案件Spec，从交付main97eff7c开始，I复用ca015-integration／codex/ce002-second-instance-acceptance，独占集成与权威文档。真实APPEAL选择为根，受理日期／法院案号可单独登记、带原因更正及清空，独立资料revision、不可变历史、固定原参回执和事实／审计／回执同事务；不改Case.version／stage、一审案号、原审次事实、归档锚、旧回执或材料。当前真实上诉根可首次登记，历史根需实际二审进展／结果或既有资料链；登记后即使清空仍挡上诉撤销。父二审与发回子一审有效日期互相校验并由同案锁串行化；只校验父链最终有效日期，保留旧链审计，不拿已被更正的旧日期错误限制当前合法值。内部有权编辑，律师只看获权有效值，客户投影不扩展；新Action仅登记目录，迁移不自动扩大真实Grant。

**真实验收与精确复用。** 原22组合8a8795a7510c6a9404427f74538524cc89018e31／treeb516be4d5c90ed7e116debf39d8bfb393e61d8b2于2026-10-14T17:54:22.5992234Z～2026-10-14T17:57:27.0177225Z UTC实际19通过、1失败、2未跑，exit1仍保留；不能称该组合全过。新8项覆盖未知值与原因更正／双null清空、严格字段／归属／撤权后重放／CAS单胜、真实上下游日期／注入故障原子回滚、清空后撤销屏障、真实REMAND历史与新APPEAL隔离、父子日期竞争仅合法一方提交、桌面／手机保存取消与律师／客户限制、真实201后丢响应的原body/key显式恢复和单一事实／回执，加旧7项CE001及4项案件兼容实际19项通过。随后只适配旧CA010浏览器命令入口，不改产品或原19项文件及依赖；按用户明确要求不重复已完成且输入一致部分，verify-input-reuse-lawyer-only逐blob核相同输入，原19项证据限定复用。旧三项组合2afef44210d174a591af941a6fd79a9399acb6eb于2026-10-14T19:01:29.6993574Z～2026-10-14T19:04:55.7794869Z UTC前两完整旅程实际通过，第三因入口退出被运营抽屉遮罩挡住失败，exit1保留。随后仅第三用例内部正常关闭抽屉并更正实际仅CHANGE的标题，完整模块第三段前后（所有imports/hooks/helpers/已过两项）字节相同，legacy-two-input-reuse证明仅复用那两项。稳定候选81ebfedc41967ea76e113c748ca1bd426b6743e7／treef3cc0ec1f20c14a135b1918e5b51c95f59fdd268于2026-10-14T19:11:21.9611920Z～2026-10-14T19:11:53.7766565Z UTC受控律师／客户1项正式实跑1/1 exit0，前后同HEAD／tree且干净。旧三项边界由上传未知恢复／选择撤销后新上诉、精确空REMAND子审次撤销与新轮次两项相同输入证据，以及本次当前律师CHANGE和客户限制实测闭合；AFFIRM是该文件后面的独立未选用例，不据旧标题虚称本批验收。22项验收边界由19项可信相同输入＋2项可信相同输入＋1项本次实跑闭合，不称最终HEAD单组22全过，不把原失败改写。两张1440／390新表单截图已读图，未知日期为空、分区和编辑入口可用、无水平页面溢出。环境HMAC343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627，Node24.21.0／pnpm11.27.0，仅环境旁证，不代替数据校验。证据ignored .local/ce002-evidence/final-8a8-combination-pg、final-legacy-lawyer-pg、verify-input-reuse-lawyer-only及artifacts。

**迁移专项。** 35fbc11181e742a73ac248f88dd9a0eeda685784／treec5801a5d20e1926cbe6639660038e736fbcea7c0于2026-10-14T17:41:40.9066673Z～2026-10-14T17:42:06.8465620Z UTC实际1/1 exit0。public前驱148由已验CE001旧构建按678文件字节证明运行，仅准备原真实API事实；两个受控随机schema重放150空链及复制原148真实归档锚／一审更正／上诉根／旧审计回执／材料版本后向前升级，第二DDL注入失败后事务回滚、保留enum并向前重放、SQL反例／精确日期helper／无自动Grant均通过。旧前置夹具明确不授予当时不存在的新枚举，150当前组合仍默认完整目录；历史128／130证明不改。随后隔离15433 public正常deploy148→150 exit0，不reset／seed；所有旧已执行≤148迁移未修改。证据legacy148-fixture-migration-pg、isolated-public-150-deploy及old148-build/layout-proof，不借持久库当验收库。

**完整门禁及审查。** 实际完整verify候选597bace20cb043794e0579c2b1e28f6e12e99676／treebea73dfc90a7d2177a6e0b25244e0711053398b4，2026-10-14T17:33:36.5051611Z～2026-10-14T17:37:13.5701201Z UTC exit0，80工具、1819前端、1473后端、全部静态／Prisma／架构及双构建通过。597之后仅旧148迁移夹具和声明、浏览器测试顺序／等待／截图及非执行性文档／快照变更；产品、单位测试、脚本、依赖、锁、workspace、根TS／Vitest／Lint／Playwright／格式和runtime输入逐blob一致，限定复用这些输入，不称最终HEAD实跑全verify。变化文件root类型、Lint、格式、strict实际通过，最终22覆盖新的测试输入；迁移专项输入与最终候选相同。独立Sol累计Spec／Quality ACCEPTED，C/I/M0，后端日期两finding、有效值双null解码、正确旧二审命令、测试操作顺序均关闭；预览脚本finally关闭失败仍撤销会话的边界已修复并复审。证据final-597-verify、final-source-review、verify-input-reuse-lawyer-only及verified-build。

**恢复与失败留痕。** 16:49:31根线程同一exec窄范围只读成功，未删除沙箱锁或修改安全设置；旧三个Worker pending_init已interrupt并停写，16:54核无实现进程后I接管草稿，不覆盖／回退成果。B73及修复66聚焦，恢复后B30通过；F初次347/348因旧归档fixture误放recordEdits块失败，单独API153修复通过，余195同输入复用，不冒称348全过。两次正式c76完整verify分别因ignored旧构建误放backend/.local被原Lint扫描、原权限目录测试仍期待66而失败；先迁移旧构建artifact至根ignored区不放宽Lint，再精确目录67＋新Action/范围契约35测试修复，597实际完整GREEN。迁移专项先工作目录、旧构建相对私有根两次启动失败，再旧148夹具写新enum失败；均保留，正常布局字节证明及旧目录限定修复后35f真正1/1。35f组合16过／1败／5未跑，浏览器在旧抽屉打开时误点后方tab，被真实遮罩阻挡；2396在已开抽屉内切命令后正常浏览器1过，丢响应1败因恢复按钮刚出现而请求尚未提交。8a8等待真实201和恢复按钮启用，保持原body/key及单事实／回执断言，聚焦1/1后22组合实际19过／1败／2未跑：旧CA010默认展开判决表单的假设不符合已交付工作页。只适配旧用例真实命令入口、正常关闭／刷新及真实只读材料路径，产品与原19项输入不变；旧三项按已过两项精确输入复用＋末项本次实跑闭合，边界如上。正式log／JSON／trace保留，不加sleep／force或放松业务断言，不把任何失败重写为通过。

**持久预览和数据保持。** P仍独立ca013-014-integration、5186／3206／15436，源码81ebfedc41967ea76e113c748ca1bd426b6743e7，680后端构建文件与完整verify597bace逐字节相同。新148备份ce002-current-148.dump 1155517字节／SHA256151c7cb9628c5d8ca8f374521cd970eefcf5347eee4ec9358fcaed558977f451，TOC有效，未演练恢复，旧备份／旧dist保留。正常前向148→150，无reset／seed／密码变更／授权扩展；130张原非会话表、2案／6凭据、旧148迁移整行、原授权／审计、配置及所有私有材料文件保持，新二审资料0。原已批准ca013_preview_admin两案×旧两表单打开／取消及1440／390只读通过，业务写入0，新Action无Grant且新命令不可用；仅五分钟真实后端内存会话验证原账号，finally已撤销，不读密码、不创建长期凭据、不称密码登录。本批新写只在15433合成账号验收，真实账号的新Action仍待用户另行确认。证据P私密runtime/ce002-{before,backup,dist,migration-result,after,browser,session-cleanup,after-browser}.json及截图，恢复沿既有README start／stop。

统一适配后46dd正式三项首项失败、两项未跑，精确原因是分组helper误将嵌套文件详情summary当外层折叠标题；7f13只将三处summary限定直接子级。其正式首项已走完结果／精确材料／刷新，在最终重登录时触及整条默认30秒预算，trace仅提取method／起止时间验证而不输出认证参数。6c762统一三条完整多阶段／多角色旅程120秒总预算，单步5秒和全部业务断言保持；上述正式失败记录及预算审查／timing proof保留。

6c762正式三项首旅程33.3秒实际通过，第二项因发回后原一审判决进入历史而标题不匹配失败，第三未跑。根一次核对全部10个资料组调用，2afef统一当前／历史标签和唯一目标可见文件名／childId，按真实导航逐项选择并检验aria-pressed及唯一可见组，显式历史不匹配当前，找不到精确记录即失败；所有API、轮次、版本和bytes断言保持。该共享helper变化影响旧三项，所以2afef正式三项实际两项通过、末项退出被未关闭运营抽屉遮罩阻挡失败；原19项输入未变继续复用。81ebfed只修改末项内部关闭步骤及准确CHANGE标题，已过两项及全部共享输入字节不变，末项正式1/1通过，分别保留组合失败和精确复用凭据。

旧CA010适配的首份开发聚焦log／trace曾因执行Task重用输出路径被第二次开发跑覆盖，不能声称首份完整文件仍保留；根实际读取的904行展示失败局部观察另存legacy-first-evidence-loss.json，未伪造完整恢复。后续开发日志／trace均改独立label，正式完整verify、迁移专项、两个22组合、旧三项失败组合及最终单项凭据保持；该局限不扩展为任何失败通过证明。

本次只收口实际受影响的Spec当前态、路线图、状态、READINESS／技术现状和验证记录／快照；SD-56合同保持，CA018暂停，其他详情UI两条待办仍在各模块交付前验收。正常原子main／任务分支交付回执取得后追加，不反写未来SHA或冒称未查询CI／生产发布；主仓原.pnpm-store／stash及可复用工作树保留。
**CORE-CE-002正常Git首交付及非执行性收口。** 独立最终收口候选9d96ac8f553d76bbbee038214666b725af6a6a42／treeeffcc397337816d21a92785b6094974145f66f8d，Spec／Quality ACCEPTED、C/I/M0；81eb源候选后仅七份必要当前态文档与已核快照，整个tests目录tree均c49fc4e18246b10c7479ab52ebe74c0dd063dd4c。受影响文档格式、diff检查、严格上下文、Spec（57REQ／66AC／11BQ／56SD）实际通过，产品、测试、依赖及运行／构建输入不变，证据docs-closeout-check、verify-input-reuse-recovery-pointer-closeout及closeout-review。预览README的旧当前指针发现后已修为source81e／680文件／150，旧CE001明确历史，独立复核finding关闭，未改恢复命令或数据。

于10/14/2026 19:23:27～10/14/2026 19:23:32 UTC实际正常git push --atomic（非force）exit0，远端main／codex/ce002-second-instance-acceptance及本地主main均实核9d96ac8f553d76bbbee038214666b725af6a6a42，原stash及未跟踪.pnpm-store保持。交付回执push-first.json／log、main-ff-first.log；未查询CI，不称远端CI通过、Release或生产上线。末次只补这份真实回执、完成态及对应已核快照，未改业务要求或验收输入；最终远端SHA以实际Git及本机push-final回执为准，不在本记录自指未来提交。预览仍已验source81eb，后续完成态文档差异不改变产品、原数据或新Action待用户确认的边界。

### CE002用户明确批准后的原测试账号授权（2026-10-15）

用户00:58 UTC消息Sentinel_2fb4ce946f3081919f743d4cf68a4c0b明确允许给原测试账号开通二审登记／更正权限。01:39:07.222 UTC仅向原ca013_preview_admin在原CA013 preview部门既有独占角色增加case.second-instance-acceptance.update的DEPARTMENT Grant一条及授权审计一条，role版本与authorizationRevision均3→4；原角色历史及当前分配均仅该账号，不新增账号／管理员、不改密码或其他账号／角色。132项原业务、凭据、迁移、配置、材料及其他账号／角色子集前后保持，原Grant与审计另核不变；原2案／6凭据／150迁移保持。

实际预览编译后的AccessControlService和PrismaAccessControlStore对两原案件授权通过、跨部门拒绝；5186／3206健康200。原两案分别处于WAITING_EXECUTION_STAMP与WAITING_EXECUTION_FILING，无真实APPEAL，故canSaveSecondInstanceAcceptance仍为false：Action已开通，业务来源资格未满足，没有伪造上诉或冒称二审表单已打开。五分钟原账号内存会话用于1440／390只读核验，两案0表单打开、0业务POST，01:41:31.756 UTC已撤销，不读密码、不称正常密码登录、不创建长期凭据。

准确证据在P本机runtime/ce002-permission-20261015-{inspected,planned,before,granted,after,access,browser,session-cleanup,final}.json及四张截图；rollback.sql仅准备、未执行。本次独立本地配置授权不改变已验CE002源码／迁移，不覆盖CA018来源分支验收或授予其新Action。此前“待用户确认”均为历史交付时状态，当前授权按本段为准。

## CORE-CA-018外部转入／历史案件录入验收中（2026-10-15）

SD-57／cases合同区分正常公证三来源与不可变外部entry，真实16初始阶段、日期／来源／原因及已知字段，后续首动作只有确实缺失的前序在精确entry分支为null；当前事实、真实材料、金额／日期、CAS、当前范围、审计与原键回执继续生效。正常150来源及既有已执行迁移保持。本节当前只记录已完成的工程及迁移证据，不标本片最终完成、全门禁通过或预览已部署。

**迁移专项实际通过。** 固定候选611347baea8090c568f28ba0dd4be072b7a18504／treebc73ce908c0f135230f31d8e2860e9b5a0104233，于2026-10-15T02:34:57.6768548Z～02:35:19.5097451Z受保护15433的标准PG／Chromium专项1/1 exit0，前后HEAD／tree相同且干净。151新增目录Action，无真实Grant回填；152完整随机schema空链、保全真实150构建经API创建正常归档事实后复制升级、原事实／原审计／材料引用逐旧列深等、第二DDL故意失败完整回滚／enum保留／前向重试、真实存在旧案的三来源非法置空约束拒绝通过。152源码SHA256689A627A292641188D1EAB75FF117E0C0419C3DD15A7B278DF863B6389C829D7；root与作者工作文件存在LF／CRLF差别时使用Git blob和规范化全文核同，不混称字节SHA相同。旧150迁移文件零差异。证据.local/ca018-evidence/migration-seventh-{before,after,report}.json、migration-seventh.log与保全artifacts。随后官方受保护db:test:migrate:deploy仅将隔离15433 public150→152 exit0，记录isolated-public-152-deploy；不reset，不操作持久15436。

**失败与修复保留。** 迁移静态审先关闭SQL拼接破坏dollar quote／regex及新录入receipt缺不可变trigger；首PG轮仍因受理guard少括号42601失败，最小修复后随机schema编译通过。第二轮旧reset试删不可变审计23514；改为案件provenance／FK闭包受保护TRUNCATE及共享原seed-only入口，保留审计、账号、凭据与材料，不禁trigger或删除它们。第三轮快照把额外audit_events／material_references当case_id表查询；只分离两表的正确resource查询，旧列深等保持。第四轮预期DDL失败后缺ROLLBACK导致25P02，补连接事务恢复；第五轮反例误在空retry schema命中0案，明确切upgrade并先断言真实案存在；第六轮真实反例发现正常closure guard引用未赋值entry_root，10处改已建表行类型，来源谓词不变，独立增量接受。SQL反例只认可23xxx约束类错误，语法／运行时异常继续失败；六轮原log／JSON／trace均保全，不能改写为通过。

**工程组合仍待最终验收。** 源审逐项关闭直接来源可办理能力与确认材料读取、真实null前序解码、原键重试被mutable GET阻挡、律师确认人ID投影、二审实际受理日期下界；最终审另发现冻结确认不得永久等同当前可变材料池，API最小修复及168/168聚焦后，固定fb6b7a3产品源审最终Spec／Quality ACCEPTED、C/I/M0；这是源码结论，不代表PG验收通过。共享组织目录已补两新Code及create三scope／直接归档DEPARTMENT精确限制，内部组织35/35和作者前端45/45实际通过。根读取37/37、后续律师读取32/32和后台类型，作者UI279/279及窄组件23/23、9/9仅证明各自候选；不累计成单次最终整组。所有真实16阶段续办、正常NOTARY新链、SQL／并发／故障／回执及浏览器验收，以及完整verify尚待稳定候选源审关闭后集中完成。

持久预览当前仍source81ebfed／150；CE002新编辑Action已按用户明确授权开通，独立132项保持和来源不合格两案边界见前节。CA018无真实Grant、未升级预览；用户人工测试窗口内禁止重启／迁移／替换5186／3206／15436，代码隔离开发、验收及正常推送不受影响。未来升级必须以人工测试结束后的新备份／数据基线保全，不把当前人工写入误算漂移或回退。生产、资金、批量导入、重开和未批准财务仍不在本片。

首完整verify绑定fb6b7a384d7feca57e7ffb384bfcdee90b641540／tree0b6c2fe8f647f97c05885245b20c1ad6edb1b7bf：严格上下文、Spec、架构、Prisma生成、前后端及根类型、Lint通过，格式检查报告12个后端文件，exit1；工具／前后端单元与双构建尚未执行。6a7ab02仅对明确报告的12文件应用Prettier，SQL及业务条件不变。新增并发／故障测试首审接受后复核撤回为I2：编号日不得误用录入阶段日，entry触发条件需精确部门／记录人；66052d3＋c991b94修复全部计数器稳定快照及精确合成条件后独立增量ACCEPTED C/I/M0；6a7ab02纯格式独立接受，fb6产品结论保持，不掩盖首审撤回。首轮正式原始日志及前后候选记录为ignored ca018-evidence/fullverify-fb6-*。

**完整门禁实跑及限定修复。** 干净0783ed9c644add413aa7492a0f0f800e7a726143／treec969970c8c0c85c1223b822974d4e7f7cfdfe781实跑verify，严格上下文、Spec（57REQ／67AC／11BQ／57SD）、架构（14模块／136模型）、Prisma、全部类型、Lint及全格式通过，工具80/80、前端115文件1852/1852通过。后端115组为112组过／3组败、1442过／86败／1528总，02:54:23 UTC exit1；不改写为完整verify成功。失败仅两OpenAPI测试module未注册新service及确认测试两个normal/direct材料断言反置。随后同候选prepared双构建实际exit0；build-078前后同树干净，完整源码／构建输入后续不变。原fullverify-078与build-078日志、前后JSON均保留。

三spec修复未改产品：4b5fb31补mock及新增请求／响应契约断言，93ef251正确断言普通available与direct完整池／冻结且互斥、CAS及审计；正常配置聚焦105项实际104过／1败，剩controller旧未知字段用例使用了新合法附件字段。746cee1保留附件并增加真正未知arbitrary字段及400／service未调用断言，f36cd97正常controller14/14实际通过；真实service已在事务前拒绝normal附加数组且现有单元负例保持。独立逐项接受C/I/M0。三spec唯一105闭合；078未改112组为1424条（1442总通过中含这三组18条，不能重复计数），推导最终覆盖1529条，仅为分段组合，不称最终HEAD全量Jest或单次verify exit0。证据three-specs、controller-final前后JSON及log。

**首PG前置失败与修复。** 078真实PG／Chromium实配22项，22项均在clean的通用setRoleGrant遇未登记case.complaint.mail而失败，未触达业务断言；pg-first日志、JSON和全部trace保留，环境前后同HMAC、152账本及无遗留fault对象。f36cd97仅将CA018独占三测试文件改用固定合成roles／19项精确动作／TEAM、参数化permission_action及15433/test/public保护的专用helper；不改共享core helper、产品或真实Grant，独立增量接受。该六测试文件相对078差异已逐项核对；工具／前端／112组后端及产品双构建输入完全不变，受影响静态与正式首browser／22项业务验收仍待实际结果。

**真实风险通过与后续缺陷，尚未最终验收。** 干净c0de13e固定PG第六轮独立并发／故障组2/2实际通过，同键四并发回执唯一、异键三并发编号唯一，audit／entry／receipt三处P0001命中独立sequence，完整Case／counter／entry／审计／回执／当事人前后回滚及原请求重试均过；前后343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627、152成功账本且无fault对象。证据pg-sixth-atomicity-*，仅对应这两项及其固定输入。其余各次首次失败即停的browser／API范围不称通过；第四轮缺工作页抽屉入口，第五轮将标准hearing空集合误断为null，测试已精确修复；第二／三轮定位歧义已唯一定位，浏览器来源遵守原合成清理前缀，不放宽清理边界。

正常NOTARY新链第七轮在complaint-confirm真实500；第八轮窄诊断临时配置cwd未指定、0测试，改临时配置后第九轮确认DriverAdapterError，第十轮仅增加安全cause提取，实际SQLSTATE42703及缺失字段new.origin确证。152通用fact trigger把非round的NEW.origin放在布尔AND中，不能靠短路保护记录字段解析；442cf44新增153用过程IF限制字段读取，独立C/I/M0接受，保留原来源／部门／23514约束与已应用152。153随机schema、官方前向和最终正常链／升级专项仍待实跑；不将此前152旧事实保全1/1升级为153通过。窄诊断仅树外调试文件，不提交原始错误／SQL／请求／凭据；正式验收将回默认入口，不带探针。

独立只读预检另发现真前端重提缺陷：submitExecution误套确认接口的normal禁数组规则，Panel同样省略versions、指纹忽略重提材料与原因。8aa236e＋fa5cb1a统一首提／重提1～10唯一真实版本、排序IDs和trim原因指纹，冻结未知command仍原key重放；正常确认接口规则不变。独立累计接受，作者API168/168、Panel14/14仅为各自输入，根须复验相应单元／前端类型Lint格式及bundle；旧前端构建不复用，未变后端／工具证据保留。

**153／154实际修复及恢复检查点。** 153随机行形状探针确认旧152非round报42703，新正常／外部来源通过而错误entry、部门、轮次及归档锚继续23514；03:27:09 UTC官方隔离15433 public152→153成功。随后正常执行提交报42702局部submission_id／confirmation_id与SQL列歧义，直接受理报未赋值record c的55000。新增154保留已应用迁移：六函数消除局部名碰撞、以已赋值case_head区分SQL别名，并用过程IF保护各表独有NEW字段。最终源码453e478独立Spec／Quality ACCEPTED C/I/M0、root88408cb集成；SQL SHA256为7b67eafcd2fa83ed0bdb1b5c55c3c4d31bf834b5f8f2fba472b8c924dfca54d5。03:43:03 UTC随机schema完整154空DDL链、新真实提交／直接确认引用、缺来源／错版本／部门／资源及已封回执追加23514正反例通过，probe-154.{json,log}保存，仅证明精确函数及空链，不冒称历史升级／业务全分支。TG_OP同表记录描述符另经探针确认正常，未据猜测扩大SQL修复。

03:47:43～03:48:02 UTC，b519653干净候选通过官方入口将隔离15433 public153→154，154项成功、无fault对象；isolated-public-154-{before,after}.json及deploy.{json,log}保存，不reset、不触碰15436。测试源审保留真实secondInstance.currentTrialRoundId、无变化保存语义及153／154失败原子／函数定义深等；83ebcff实际根tsc、四文件Lint通过，辅助文件仅Prettier格式修复2f14d13后Lint／四文件格式／语法通过。先前类型／重复局部变量／格式失败原log保留。默认无诊断探针入口于03:49:05～03:49:51 UTC在干净83ebcff／tree74ae95c97124775819945cc443467fe7c9cb9e9c正常公证全链至归档1/1 exit0，pg-fourteenth-normal-154前后JSON、report、log保留；同环境HMAC、154账本且无fault对象。第十一轮153执行提交、第十二轮直接受理和第十三轮错误顶层轮次断言失败各自保留，不拼成通过。

前端修复在干净c28d6b1实际API168＋Panel14共182/182，完整前端类型、四文件Lint／格式及新bundle于03:27:16 UTC exit0，front-revision-{before,after}.json和unit／static／build日志保存；以后无前端产品变化，旧078前端bundle不复用。断连后恢复实核HEAD2f14d13329526e97c0553950d99994b0e0b0a951干净、规划c28d6b1存在，两文档未确认补丁没有落盘，现按已取得事实补记。完整22项及旧150→154升级／失败回滚专项仍待实跑，尚未最终验收或推送。持久预览人工测试窗口及无真实CA018Grant保持，INPUT-016／UXQ规划未实施。

**恢复后组合失败及最小修复，仍待最终候选。** a4ac3af／tree5777b8e0a2194f07a0212dad3542adf0908a4385完整前端115组1852/1852实际于04:56:46 UTC exit0（frontend-final）；其后新增上传入口产品，须重验该新前端，不能借旧成功。第十五轮22项在前两browser通过后，直接WAITING_EXECUTION_CONFIRMATION缺上传入口失败、19未跑：原测试又错误期望先执行提交。正式合同要求正式上传完整包后null submission直接确认，不生成假提交。4593349集成F b5ced5d的精确upload-only入口，复用原上传／未知恢复／当前读取，原canSubmitExecution与确认权分别保持；作者三spec62/62、类型／Lint／格式通过，独立Spec／Quality ACCEPTED C/I/M0。主browser改真实上传两份、漏包4xx且全快照不变、精确null及两ID确认、实际确认版本关联和原字节；不再调用伪execution-submit。

第十六轮筛选实际18项（含一个through the browser受理），3过后PENDING_MATCH用旧lawyer自由对象400、14未跑；第十七轮三诉状根的确认把PENDING改KNOWN却未给changeNote400、13未跑；第十八轮独立13后续中7过，真实二审提交更正／确认后错误期待direct-only确认版本表1条而失败、5未跑。已修真实律师账号、金额变更原因；真实submission链继续引用原submission版本且direct-only表为0，null确认场景另查两条精确版本。filing／acceptance、judgment、四执行根、两种结案归档链、开庭自动推进与二审受理在第十八轮实际通过，仅属该候选和七项，不拼最终成绩。各轮pg-fifteenth／sixteenth／seventeenth／eighteenth日志、前后JSON、report与trace全保留。

旧150→154第八轮在旧compiledAPI读取合成角色的新Action枚举P2023失败，尚未升级；25c9115集成859f56e，仅NODE_ENV=test、15433/dev_cor_test/public，固定三synthetic角色×两CA018动作暂存，旧150真实API建归档段finally精确恢复原5列及深等，冲突抛错不覆盖，独立接受。第九轮已越过旧构建并实际创建旧正常归档，随后函数定义快照查询format多态绑定未显式类型报42P18；213e330仅给两参数加text，保留所有22012失败原子／函数定义深等断言，旧迁移及产品SQL不变。migration-eighth／ninth失败各自保留，不称升级通过。

根工程复用清单engineering-reuse-a4.json逐Git blob实核工具及共享配置34文件、后端构建218输入、112旧suite、三修正spec与旧150迁移完整不变；只按明确来源复用，不声称自动affected或新HEAD完整verify。04:54恢复及文档strict／Spec通过后，远端只读实核main仍e5e6fdd2cc82672695188af6ba2eadfab459e3e2、任务分支未建，本地主main同SHA且原stash b07482c／.pnpm-store保留。当前集成2592ced干净，正在冻结必要文档／快照并补最终静态、新前端单元／bundle、迁移专项及22项；持久预览及UXQ限制不变。

**f1稳定门禁及直接上传真实能力遗漏。** f1d3a060d8f8c4c94eba3ad87d4637e1395c9f3d／treecaf101cb8b9f93ebdd4011c749a607de44bc00f6同干净候选：final-static-f1于05:11:17 UTC exit0，严格上下文、Spec57REQ／67AC／11BQ／57SD、架构14模块／136模型、前后端及根全部类型、Lint、全格式与helper语法通过。front-upload-final实际115组1857/1857及新bundle于05:10:23 UTC exit0；migration-tenth-final-154于05:10:54～05:11:20 UTC实际1/1 exit0，完整随机空154链、旧150真实API归档后旧列／事实／审计／材料引用保持、153／154故意22012函数定义回滚及重试、来源probe／SQL约束均通过；合成新Grant兼容finally精确恢复已断言。前后同HMAC343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627、15433 public154/154成功且无fault对象。原始before／after／report／log全保存，独立Reviewer已核实上述边界。

同候选第十九轮完整22前两browser通过，第三direct上传入口缺失超时、19未跑，pg-nineteenth保留；真实快照确认文件tab已激活且没有上传按钮。CaseReadService的canSubmitExecution包含真实提交资格，精确direct WAITING_EXECUTION_CONFIRMATION且无submission为false；F原组件夹具假设true，故新UI虽有精确分支仍未真实可用。后端MaterialService已沿case.read／case.execution.submit及当前律师允许正式上传；现在新增可选只读canUploadDirectExecutionMaterials精确映射该来源及现有材料写权限，缺失false、非bool拒绝，客户不扩；禁止把canSubmit改true或借canConfirm授权。cases读取合同已补，Sol后台／严格API与前端组件分别实现，须独立源审及真实浏览器闭环。

此新读取产品使旧backend112suite／构建限定复用失效，稳定候选将实际重跑完整verify及22项；不能将前述f1门禁冒充新cap候选。migration-tenth的旧150 runtime、150→154 SQL、专项test/helper与旧配置均未改变，后续只在逐字核同这些明确输入后限定复用，不声称新候选实际重跑。持久预览、真实账号权限及UXQ规划均未操作。

**独立上传能力源审闭合，待根完整验收。** E4ec2af1实现六文件后，独立审查I-NEWCAP01指出list／detail只给部门的授权facts遗漏真实负责人／团队，SELF／TEAM可能错误关闭上传，原固定true mock未覆盖；该hash当时REJECTED I1、未进入根门禁。5711036补本案responsibleUserId及可选teamId，部门由同部门查询约束保持一致，增加SELF／TEAM各正负事实断言及真实list／detail覆盖。E组合独立累计ACCEPTED C/I/M0、该finding关闭；作者CaseRead＋Controller48/48、API169/169、类型／Lint／格式通过，仅属其源候选。

F2eff7b4及da7caa3把内部动作／文件页／上传面板与律师宿主的精确direct分支改用newcap===true，缺失／false关闭、canSubmit=false仍可仅上传，正常提交保持旧能力；作者组件63/63、律师页24/24及静态通过，独立接受。T6ff4baf与e935519在原22项内增加正式GET的false-submit／true-upload、每次上传控件visible/enabled，末项用真实新律师账号/profile及正常cookie登录，已指派读取最小四字段origin／未指派404／有效CSRF内部create403，原撤权和快照保持，独立源审接受。根已集成上述固定提交，补快照后将实际跑完整verify与全部22项，不以前轮分段或作者mock通过代替。

**最终真实门禁、155修复与固定22组合（2026-10-15）。** 干净2fc8ee86d19d47148b5dd22144f7eae3a396c9b8／tree06b09feb401f379d9a795f0b67da5e6e52a95984于05:28:44～05:32:30 UTC完整pnpm verify实际exit0：严格context、Spec57REQ／67AC／11BQ／57SD、架构、Prisma、全部类型／Lint／格式，工具80/80、前端115组1862/1862、后端115组1531/1531和双构建通过。证据fullverify-direct-cap-final-{before,after}.json及log；不能再把早前078分段覆盖当本轮门禁。

此后PG20前两过、第三在只等请求后提前GET未见已提交阶段，并因在途事务与cleanup死锁而失败；84016f7等待真实201和确认DTO后再读，PG21聚焦1/1通过。PG22三过后旧二审按钮文案失败、18未跑；d7a0f2f补真实文案、201／结果金额／附件字节，PG24 KNOWN／PENDING双browser2/2通过。PG23 remainder十二过后REMAND子轮受理真实500／23514，固定安全文案direct second progress/head mismatch，不能归为测试错误；PG25回执／并发／三fault三过，末scope误把固定空数组当字段缺失；PG26又把隔离隐藏404误期望403。只改对应精确断言，保留候选零泄露、跨部门隐藏、撤权和最小投影；所有pg-twentieth至twentysixth实际失败／聚焦报告、log、trace保留，不拼总成绩。

155新增20261015130000_guard_direct_second_remand_child（SHA256 a0ac77660a4752c8e36e7ec68bf127bab6caff203d3998f368d38b809fbfed4c）保留151～154及旧142／150文件，只修ca018_h_direct_second_chain在current result清空后的精确已受理子轮分支。它核同案／部门／entry的未撤销根轮REMAND、真child round与acceptance／audit版本、日期、开庭头和stage；真实child判决head非null后由154原完整guard接手。独立源审4e13edc＋8ce2d0e及T677bcda＋90e0676累计ACCEPTED C/I/M0；审查者初报I-155-01后核全部三个NULL门控caller而撤回，不隐瞒或把误报当产品修复。T日期链为首审-5／二审-2／REMAND与child受理开庭-1／child判决today，无日期放宽。

干净6018e171d14daf428083140503698d91c86c190d／treeee9af4b790a3fa7e5b317765d07c2d3b68b84a22于05:50:10～05:50:36 UTC实际migration-eleventh-final-155 1/1 exit0：完整空155链、旧150真实compiled API归档后旧列／事实／审计／材料保持、153／154及155故意22012函数定义回滚和原迁移重试，合成新Grant finally精确恢复通过；仍使用受保全旧150 runtime，不复制私密env。专项前后public仍154/154、无fault对象。05:50:58～05:51:02 UTC按官方入口仅隔离15433 public前向154→155成功，155/155，无reset；isolated-public-155前后与deploy日志保存。

最终干净源码／测试7236c8e968e633613db2abd0d72580bc9fb3d4d0／tree75e7cfba61aafe5ac1b79624bb9aa76130ace23b：PG27真实REMAND受理→开庭自动推进→child判决及scope聚焦2/2；随后05:52:02.554～05:53:08.446 UTC默认无诊断探针完整pg-twentyeight-final-155 **22/22 exit0**。含16初始阶段、正常来源全链、direct NULL确认两份冻结材料及原字节、AFFIRM两金额态、全部阶段后续、真实发回child判决、回执／并发／三点故障原子及授权／撤权／律师最小投影。故障项的三次P0001／500是预期注入并证明全回滚，不是上线错误。前后同HMAC343c59891dfe4d82e03a5c91faac2e1de7325b9c847f35fbaa3819c72290a627、15433 public155/155、无fault对象；before／after／report／log和失败trace全在ignored .local/ca018-evidence。工具final-tools-155在相同7236干净候选05:52:49 UTC实际80/80 exit0。

2fc→7236仅新155 SQL、主E2E、migration E2E及其helper.mjs／.d.mts五路径不同；fullverify-reuse-155-before-docs.json逐Git blob核后台产品／单元／schema／构建330文件、全部前台256文件、工具及共享配置34文件完全一致，另1105 tracked未变。独立Reviewer接受该限定复用：保留2fc单元和双构建成功，新SQL／迁移／22及新静态另实跑；不声称7236或后续收口HEAD完整verify exit0，不声称DB内容相同，也不推导自动affected。后续仅完成态、证据、OPS-01-A～E未实现规划及对应快照；业务Spec仅CA018标题完成标记，合同／AC／产品TS／依赖／配置／旧SQL不改。新根静态与收口文档检查结果在取得后补记。

持久预览在05:42:04 UTC只读实核source81ebfedc41967ea76e113c748ca1bd426b6743e7、工作树clean，5186／3206健康200，前端PID18688／后台34704保持；15436监听保持。人工测试窗口内未重启、迁移、替换或增加CA018真实Grant，未读凭据／写业务；旧2案／6凭据只是历史基线，不冒称人工操作后的当前计数。preview-frozen-readonly-final.json记录只读范围。预览升级必须待人工测试结束后按新基线备份保全再执行；此等待不阻断已授权代码交付，不称CI、生产发布或OPS监控已通过。

**最终审查、收口静态与真实交付回执。** 文档及OPS-01-A～E规划固定79a76d59683f8aa42fab8b5f6fdca355a5c5fea1／tree6df85fbc91bdb3d09e41597092d9ced566187c51，仅六份文档／快照，业务Spec只标题完成态。05:56:24.103～05:57:24.214 UTC final-static-155实际exit0，前后同HEAD/tree且clean：strict、Spec57／67／11／57、架构14模块／136模型、前后端及根全部类型、全仓Lint／格式、helper语法及diff通过。fullverify-reuse-155-closeout继续证明330／256／34明确输入不变；migration-input-reuse-155-closeout证明283 tracked专项输入及834冻结旧150运行／配置文件不变，最后只限定复用6018实际150→155专项，不称79a重跑迁移。独立累计终审核实际report：PG28 expected22、unexpected/skipped/flaky均0，migration11 expected1、unexpected0；Spec ACCEPTED C0、Quality ACCEPTED I0/M0，无未闭finding。

2026-10-15T05:58:06.8827157Z～05:58:17.8513503Z，正常git push --atomic实际exit0，远端main与codex/ca018-external-history-entry同时到79a76d59683f8aa42fab8b5f6fdca355a5c5fea1，两条ls-remote实核一致，未force；atomic-push-155-first.{json,log}保存。推送前实核主工作区main仍e5e6fdd、仅原未跟踪.pnpm-store及stash b07482c保留，最终本地主main快进及末次文档回执SHA在ignored交付回执和最终报告实核。本段之后只回填上述事实、完成态与相应快照，按非执行性收口执行文档格式／链接／Spec／strict检查，再正常原子交付，不重复产品门禁。OPS正式编号和依赖已在79a提交，仍未领取／未实施；CI未查询，不称CI或生产通过；持久预览和真实CA018Grant继续保持未操作。

**CA018交付后远端CI只读核查（2026-10-15 06:10 UTC）。** 对已交付1f375ea582f899d2033419b75c1f3ad1eba2dbd9用已认证GitHub REST读取：仓库Actions workflow总数0，本SHA workflow runs总数0、check runs总数0、commit statuses总数0。combined status返回pending但statuses为空，不能当成有CI运行或CI通过；未启动工作流、未改远端配置。原始聚合证据.local/ca018-evidence/remote-ci-1f375ea.json；OPS-01-A～E正式规划提交79a76d5已包含在交付main，仍未领取／未实施。

## CORE-UI-003候选、组合审查与隔离环境断点（2026-10-15）

当前集成HEAD cf8f5d814835de0410b534e2117c03735019e1c1／codex/ui003-quick-actions-integration，从已交付CA018的1f375ea分出，本批没有推送或预览更新。工具实际返回的Worker标识为canonical agent name，不提供独立可见聊天UUID：A为`/root/ca018_frontend`，worktree ca016-frontend-integration、分支codex/uxq01-notary-common-reason，来源f56d6ebddcc9db49ad254a92718ecbf8e8f34139及可选输入修复60ff42747048551cf30397ca10da0625dd2c5163，现场clean；B为`/root/ca018_tests`，worktree ca016-case-list-display、分支codex/uxq01-lead-quick-actions，首候选23e7de67354bc0fafe9d657ec1783571bf432bcc，后续修复仍在该Worker白名单。集成对应824eed5／f95e1d1／cf8f5d8；I另6798772只扩旧NT010浏览器共用原因断言。

A作者18/18、白名单Lint／格式／diff通过，初候选类型通过，60ff只改可选输入和直接反例未另跑类型；B首候选三文件34/34、类型／白名单Lint／格式／diff通过。这些是作者各自候选证据，不合称最终52项单次实跑或真实浏览器通过。独立累计初审`/root/ca018_contract_review`对cf8组合REJECTED：I-UI003-01跨账号旧pending使新账号全部快捷办理禁用，单sessionStorage键存在覆盖旧身份请求、迟到响应清理新请求风险；M1双击测试GET version4却mock成功receipt version3，真实API要求expectedVersion+1为5。A可选批填／冻结、最新GET能力与版本及合法returnTo未见其他确定缺口。B正在按身份保存原lead/version/key、只清自身精确请求并补跨账号与迟到反例；提交及原Reviewer关闭finding前不接纳。

真实NT010浏览器首轮6798772772e451f44cb9df7ebd5f6a9932369051／treea53d121588b853470812185152bb459e17018a8d，06:11:57～06:12:28 UTC在干净同HEAD退出1：首项beforeEach调用resetCoreLeadE2eData→clearDatabase于tests/support/core-lead-database.mjs:709 materialReference.deleteMany触发23514，原文`judgment material reference is immutable`；第二项未运行，新UI断言未到达。准确入口参数为`pnpm test:e2e tests/e2e/notary-return-archive-batch.spec.ts --workers=1 --max-failures=1 --reporter=list,json --output=.local/ui003-evidence/a-browser-first-artifacts`；首轮JSON／log／trace留在.local/ui003-evidence/a-browser-first-*。已有准备步骤先于失败执行，不能宣称旧库较首轮前完全无变化；用户随后明确保留旧受保护事实后不再写该库。只读聚合检查267条孤立材料引用、15个purpose/action组，触发器仍全部enabled O；不读取材料正文／凭据，记录fixture-orphans-before.json及fixture-trigger-catalog.json。旧清理草稿只保留在E的codex/ui003-fixture-cleanup一个未提交helper，未执行、未集成；禁止用其解锁验收。

**新环境准入阻塞，待根会话独立任务。** scripts/run-e2e.mjs:38及run-test-migration.mjs:15均经captureTestEnvironment；scripts/test-environment.mjs:94固定读取本worktree backend/.env.test，无替代文件参数。DEV_COR_TEST_DATABASE_URL可覆盖为新本地端口，仍严格校验127.0.0.1／dev_cor_test用户和库名、相同凭据、无query及Shell冲突；selectTestDatabaseContainer:238～289还要求唯一实际映射、固定名称dev-cor-postgres-test-1或Compose project=dev-cor/service=postgres-test/container-number=1、锁定镜像和healthy。普通新Compose project=dev-cor-ui003即使其他元数据合法也不满足身份条件。06:32:42 UTC纯元数据探针`node .local/ui003-evidence/probe-isolated-container-admission.mjs`真实退出0，确认准确拒绝`The published port does not belong to the test container`；输出isolated-container-admission-probe.json。该探针没有启动真实容器、Docker／网络／DB调用，不能描述为新Compose命令已运行失败。15437只作待批准新目标建议，未创建或迁移；旧15433、人工预览15436／5186／3206、生产均不为此更改。

最小修复brief交根会话：独立Owner只处理正式测试环境准入及对应工具测试，建议文件边界scripts/test-environment.mjs／test-environment.test.mjs，如需官方Compose定义／入口则先明确追加唯一所有者；本UI线程不并行改这些文件。以显式、可核验的独立测试身份绑定新项目／实际container／端口及镜像，不伪造旧标签、不做任意project通配、不放宽健康、loopback、DB身份、Shell冲突、HMAC和共享锁；默认原入口保持拒绝其他库。按质量门禁变更Level 3评估，保留错误项目／端口／镜像／不健康／歧义映射等拒绝反例及默认兼容。先通过准入专项，再用受控新实例执行155链；UI采用新合成记录及reuseExisting准备，不调用旧reset／clear或禁用约束。根会话单独创建可见任务，修复提交经独立Review及适用正式门禁后，本I才接入并完成真实UI验收。

尚欠：B修复提交、原Reviewer关闭I1／M1、稳定组合聚焦／快速静态、新隔离环境的A逐项原因批填及真实归档与B编辑返回分页／筛选、未知成功原key重放／单事实证明；不得以昨日任务或CA018通过替代。06:32恢复普通context:check exit0报告十项已知本批源码／测试／CI回填漂移，未盲刷快照；后续只在核实最终差异后记录快照和文档专项。

**06:37 UTC增量断点，组合仍未接受。** B提交3a2c3fecf32ec77d82c73e7809184f4fb2f3e48b（原分支clean），I已接入d92dc8879cb9cfda109e5590bffdd50315df8f77，只四文件增量。作者List＋Panel24/24及自报类型／Lint／格式通过；根在d92于06:36:10～06:36:14 UTC真实四文件组合54/54 exit0（含A／List／Panel／Edit），不是原18＋34汇总；日志combined-unit-d92dc88.{json,log}。随后check:fast实际exit2：架构14模块／136模型通过，前端vue-tsc在LeadListPage.spec.ts:164报TS18048 stored可能undefined，backend生成成功但整个并行类型阶段失败，根TSC和全仓Lint均未执行；check-fast-d92dc88.{json,log}完整保留，不能用作者类型通过覆盖根失败。原Reviewer确认Panel M1版本mock修复、跨身份map方向正确，但新增I-UI003-02：persistSettledAttempt及pending清理只按identity，无精确frozen tuple比较，同身份旧迟到响应可能清较新请求并关闭新面板；M-UI003-02为新List成功mock仅id缺真实PushLeadResult必填，仍绕过严格API。已交原B连续修复完整identity／leadId／expectedVersion／idempotencyKey匹配、succeeded事件归属、真实回执fixture及根TS错误；之后只重跑失效聚焦和最终所属静态，原R核闭。此时B仍运行，不预称完成。文档首次普通沙箱pnpm exec prettier未找到已存在入口、Spec未执行；精确升级后同三文档格式及Spec57／67／11／57与diff检查实际exit0，无数据库操作。

**第二轮修复、累计源接受及根静态（06:42～06:43 UTC）。** B原Worker提交03a6a026925a6680a729bf035b39cc55302410f6，原分支干净；I只合并该四文件至9599b2a82d9bdd53774b05e9140418fb75adf94d。存储、内存清理及成功事件均匹配完整identity／leadId／expectedVersion／idempotencyKey；持久化清理失败保留原请求，不清新attempt或误关面板。新增storage保护／同身份迟到反例、完整LeadPushResult及expected+1、stored显式类型守卫，无any／非空断言绕过。作者26/26及根tsc／白名单Lint／格式通过；原Reviewer自行核累计diff后Spec／Quality ACCEPTED C/I/M0，关闭I-UI003-01／02及两处mock Minor，结论仅源码与直接测试。根在9599b2a于06:42:27.795～06:42:31.540 UTC实际四文件56/56 exit0；06:42:31.562～06:43:08.970 UTC pnpm check:fast实际exit0，架构、Prisma生成、前后端与根类型、全仓Lint通过。前序失败不覆盖，证据combined-unit-9599b2a.{json,log}、check-fast-9599b2a.{json,log}；没有运行DB，文档checkpoint变化不冒充新的产品验证。真实浏览器仍待新环境，不宣称已交付或完整verify。

根会话已单独创建可见准入实施01a13e4a-4179-735e-923a-8129a0b040e1，基线1f375ea、独占test-environment脚本及直接测试；I只登记、验收和集成，Compose如需扩围先协调，未回候选不提前接入。只读流程入口核查01a13e49-2add-7514-9926-430be05b00d1接手用户反馈，I不重复扩大调查；已核预览81ebfed clean、06:40 UTC前后端200。源码证据确认预览／最新案件列表均只有编号链接和办理／只读文字，没有逐案动作按钮；两版详情已有页头主操作／更多操作及能力条件，人工账号实际缺入口原因仍待独立核查，不能全归旧版本。A原Worker另实施单独ui003-quick-actions浏览器专项及最小helper，新合成记录／reuseExisting／真实API前提，禁止旧reset／clear与DB运行；本I不亲自实施测试工具或业务代码。协作规范已按用户确认同步ai-coding，现有A／B任务保持。

**环境候选与浏览器专项接入，仍有准入阻塞。** I读取独立可见任务“修复隔离测试环境准入”01a13e4a-4179-735e-923a-8129a0b040e1原回执及其.local/managed-test-instance-evidence.json；d85ad2f9ed7a95a2f24d6723dcce2be9a3ea1ccd只两脚本，作者直接Node工具11文件85/85、两文件Lint／格式及隔离Sol审C/I/M0，pnpm复用安装state的patchedDependencies路径阻塞保留，未伪称pnpm正式门禁。I核文件白名单后接入9931583；A2ff1725e1a6372ff27a79f1cf5a3a3dc74504e42仅新增553行ui003-quick-actions.spec.ts，作者根tsc／Lint／格式通过，接入90e4d2ebd838b4f4e38894341a9c7a364b579472。原累计Reviewer确认A新专项源码C/I/M0：reuseExisting无reset、真实角色API前提、密码登录、真实POST成功后仅丢响应、原键重放及单审计／回执；没有实际运行该浏览器用例。

同一Reviewer对新增环境组合报Important I-ENV01：captureTestEnvironment在PROJECT／CONTAINER_ID都缺时仍允许非15433 URL，selectTestDatabaseContainer回退legacy名称／标签接受改端口的原容器，未强制新端口完整绑定；新测试还允许49123 legacy成功。整体90e因此REJECTED I1，不以作者85/85或其原隔离审覆盖累计finding。需原环境Task修非15433强制URL＋PROJECT＋64位实际ID，只有原15433保持legacy兼容并增加拒绝反例；I只派发／验收，不自行实施。全门禁及真实Docker／DB运行尚未执行。

环境运行brief：唯一Owner追加compose.test-instance.yaml，真实项目dev-cor-ui003、单一loopback15437映射，保留postgres-test的锁定镜像、tmpfs、health和原数据库身份；只启动postgres-test，不启动开发postgres，不占15433／15436／55432。本轮.NET只读监听枚举15437／3101／5174无命中，Compose版本5.1.4；启动前须再核端口及锁。合并后的Compose配置只输出端口／镜像等白名单，不能将含密码的完整config写日志。使用指定验收工作区backend/.env.test的私密值在子进程内配置测试容器，不改该文件或打印连接串；显式绑定实际project／full ID／URL后标准capture／migration入口只对新库执行155链，记录绑定指纹，再使用reuseExisting新记录运行UI003两项。原固定入口／锁／保护均保留；子任务运行I确认的冻结组合，不能在仅d85旧基线验UI003，也不为依赖复用问题改锁文件或绕过入口。环境工具为Level 3，原Reviewer核闭后稳定组合须完成正常完整verify及该真实专项；此处只分配运行brief，没有创建容器、迁移或宣称验收成功。运行输出仅ignored evidence，源和权威文档由I独占，结束只报告准确SHA、端口／容器身份、迁移、指纹和实际退出状态，不做自动清库／删除容器。

入口核查最终报告已读取（01a13e49最终msg_0c16e7551432b0ef016ad07682fd8c8197b8d6109acdfd1b04）：预览两例案件主动作实际存在、公证归档两例精确案件链接存在，案件列表行动作两版未实现；不把未知的账号资格归因为权限。I仅核路由／目标文件与1f375ea同输入及白名单不重叠，已在路线图分配UXQ-01-C／D实施brief交根创建独立可见任务，尚无实施或跨角色验收结论。

**可见实施所有权及环境finding关闭。** 根会话随后实际创建并启动UXQ-01-C“补齐案件列表办理入口”01a13e59-3cad-70a0-806c-aaede131b0cb及D“补齐跨模块流程交接”01a13e59-b7fb-71f0-8f13-a802319830ea，均基于1f375ea，各自独立worktree／白名单。D目录uxq01-d-workflow-handoff、分支codex/uxq01-d-workflow-handoff已现场核实；C回报uxq01-c-case-action-entry／codex/uxq01-c-case-action-entry、冻结安装完成，context:check受已有.pnpm-store符号链接阻断，聚焦测试／类型进行中，不能称其context通过；两Task均无正式候选或DB／预览操作。I仅登记与验收，不重复派发／实施。

环境原Owner提交c9c5e5280e05809ae2231d7e7d56cc428fbaf502只两文件，I核diff后合入6a985e7。修复为任何显式DEV_COR_TEST_DATABASE_URL均要求URL／PROJECT／64位实际CONTAINER_ID齐全，底层select对任意非15433再次强制managed绑定；默认无覆盖15433保留legacy。原Reviewer重新独立核闭I-ENV01，Spec／Quality C/I/M0；原Task当前回执记直接Node工具86/86及Lint／格式／diff通过，原RED仍保留，不能把d85旧审或根旧56组件当该工具修复实跑。原Owner继续compose.test-instance.yaml唯一映射15437、只包含postgres-test的合成配置核验，尚未交正式Compose候选，未启动实际容器／库。根未运行完整verify、新绑定／155迁移或浏览器验收，均待新稳定组合和子任务执行；人工预览与旧15433受保护事实保持不写。

**Compose正式回执、累计接受及冻结运行brief。** 原Owner随后交e6b2fce30400cb04174c98d48ca1c4a8a3680911，只新增9行compose.test-instance.yaml，I只合该增量至6928a476532fa515290af36d2d94b52216df1757。原delivery.json核c9两脚本blob不变、直接Node工具11文件86/86限定复用，Compose原隔离Sol已独立合成渲染，仅postgres-test／dev-cor-ui003／127.0.0.1:15437，保留pinned image／tmpfs／health／DB身份，无手写container_name／labels或持久数据卷；没有真实启动或实时端口保证。原累计Reviewer另核6928新增源码与原证据一致，Spec／Quality C/I/M0，前述“尚未交Compose”仅为c9时历史状态，本次已更新项目当前态。真实完整verify、迁移和浏览器均未执行；不将86工具或旧56组件汇总成新组合门禁。

I在本次文档／快照专项完成后给出最终干净冻结HEAD，根派独立执行任务，在D:/工作项目/品维and知产/dev_cor/.local/worktrees/ca015-integration使用既有正常依赖，源／权威文档只读、运行输出仅ignored .local/ui003-evidence。每次新PowerShell先加载项目runtime并核Node24.21.0／pnpm11.27.0；逐步绑定同一SHA/tree，I不改HEAD或接纳C／D，执行任务不自行改代码、安装或绕过入口。先在冻结树正常pnpm verify，保存原日志／实际单元数量／构建和退出状态；失败停止后续、交I转原Owner，不把直接Node替代称为完整门禁。

完整门禁通过后，启动前再核15437、3101／5174与标准资源锁；用compose.yaml＋compose.test-instance.yaml、profile test只up postgres-test，不启动postgres、旧dev-cor或preview。测试容器密码只在进程内取指定验收目录backend/.env.test的测试URL，不打印／提交原值，不改canonical .env；Compose被移除服务的插值需要时用合成占位值，不读取开发库凭据，合成config只输出白名单。检查实际project=dev-cor-ui003、真实完整64位container ID、唯一127.0.0.1:15437映射、pinned image、healthy、dev_cor_test用户／库及tmpfs，任何不符停止，不伪造标签或接管现有实例。仅在子进程设置DEV_COR_TEST_DATABASE_URL／PROJECT／CONTAINER_ID三变量，以captureTestEnvironment记录非秘密指纹，再正常pnpm db:test:migrate:deploy把155链应用于新空库，核实际完成数，不触旧库。

随后只用标准pnpm test:e2e tests/e2e/ui003-quick-actions.spec.ts --workers=1 --retries=0 --max-failures=1执行明确两项，保存JSON／log／trace和前后HEAD/tree、环境指纹／端口／container元数据，必须expected2、unexpected／skipped／flaky均0、exit0才报本片通过。不运行旧NT010／全量E2E或reset／clear；新seed使用reuseExisting和新记录，无约束禁用。A必须真实原因批填／归档后重登核事实，B必须第二页编辑保存／取消及实际POST201后丢响应、刷新原body/version/key重放并仅一事实／审计／回执；失败不扩大整组或修改断言，原A／B实施修复后再核失效范围。保留新测试库／容器与全部失败证据，不自动down／删库／改账号。人工5186／3206／15436、原15433、开发55432和生产全程不写。最后只返回准确运行SHA/tree、环境绑定、155链／各检查状态和未决项；UI003不能包含C／D尚未集成的新入口，也不代表预览已升级。

**fc4实际两轮verify失败，解除旧执行冻结并修正顺序。** 独立运行01a13e67-4068-778b-a1e9-9d808ecb50e8回执与ignored acceptance-fc4a175-20261015／acceptance-fc4a175-20261015-tmp-local均已读取。两轮HEAD fc4a1751a6ac02f57b0c1cbc9c05626cef694b6e／tree7029bbc90855bb1895eae4b3a51c04231439df02未变、工作区clean。首轮普通临时目录EPERM mkdir ssr，工具测试实际0；不是代码断言失败，也无工具审批拒绝证据。第二轮07:18:22.786～07:22:34.748 UTC仅为verify进程设工作区TMP／TEMP，写探针通过、末尾恢复，pnpm verify exit1：工具11文件86/86、前端116文件1887/1887通过，后端115套113过2失败、测试1529过2失败；静态通过，双构建未执行。新容器未创建、155链及A／B浏览器未运行，无trace。执行任务已idle且明确停止，I只读确认现场后结束旧验收冻结，保留该失败候选与证据；新修复另定候选，不声称原门禁通过。

失败一定位backend/src/common/environment.spec.ts:10有效PRIVATE_FILE_ROOT夹具从os.tmpdir派生；工作区TMP使路径进入repositoryRoot下但不在`.local/private-files`允许根内，environment.ts正确拒绝。原环境Owner新增独占该spec，最小修为与进程TMP无关的既有获准私有路径夹具，补工作区临时路径仍拒绝的反例，保留外部／本地安全路径及生产无私有根等原断言；environment.ts生产规则不在白名单，不改ACL／提权／绕过限制。

失败二定位backend/src/modules/leads/core-nt-006-migration.spec.ts:22 execFileSync→core-nt-006-migration-probe.mjs:11 capture→actualExternalConditions Docker ps／inspect catch。该probe随后真实Client.connect，在自己随机nt006 schema应用旧迁移、断言并清理自己本轮schema，非纯SQL源码测试；无managed三变量时默认会使用15433。因此前段“先verify再新库”的运行brief已被本节替代：先由执行子任务在唯一分配的15437新实例完成标准准入，绑定三变量并把同一绑定传入Jest／probe，再跑该失败专项，不能回旧库或删／skip探针。通用包装错误不能证实Docker底因，原Owner只做同身份无副作用诊断及必要脱敏错误分类，不输出原inspect／stderr或凭据；若确有访问拒绝则停报，不改ACL／提权／改变安全策略。原Owner拥有此spec及probe；仅有证据才改必要工具，旧迁移与业务源码均不动。

原环境可见任务01a13e4a-4179-735e-923a-8129a0b040e1文件所有权扩至上述两spec及core-nt-006-migration-probe.mjs，原test-environment.mjs／test及compose.test-instance.yaml所有权继续；本I不实施修复。先在进程工作区TMP条件下证明环境夹具聚焦通过，再核新库真实绑定与NT006三种迁移分支；必要工具诊断改动另补直接测试。仅实际失败范围通过后交I审查，稳定新候选再集中完整verify（包含这些测试和双构建），最后新库155链／UI003两项真实浏览器，不反复盲跑全仓、不用旧部分通过代替新最终门禁。实际数据库准备先后由probe核对其支持schema确定，新实例可先155 public而probe只用新建随机schema，不能修改旧15433。阶段运行交原执行Task，源修复仍交原Owner，互不争文件；当前尚未实际执行上述新顺序。

**C／D只读接收与新增finding，未合入验收树。** C b40225a467a53ae492ace0f60773baf8ccf3691f／tree496275ef036332edd857ba67ada205ae4074e6bc现场clean、8白名单；作者178聚焦／check:fast／格式／后端编译及原两轴0，6项浏览器未运行。原累计Reviewer另报I-UXQ-C01：摘要无动作不代表详情无能力，行内“只读”误导，应中性提示；C-UXQ-C02：新E2E调用clearCaseExternalEntryFixture／Grant helper，其withDatabase仅15433且走旧清理，不适用于新15437及保留旧事实要求；应由原C实现新实例下新合成记录及最小授权，不清旧库、不禁约束，不将其修复混入环境Owner白名单。D a1bfc535f2403c132f5dc995440748f2c1b72125 clean、7白名单，作者初85及最终Lead29＋其余57限定复用、正常快速静态和原两轴0，2项浏览器未运行；累计审报I-UXQ-D01，正式GET成功但关联列表无回执事项仍持续直链且测试反向期待保留，应撤链／中性提示。临时503保留已知成功和401／403／404清旧投影、角色路由保护未见另一缺口。两者均交根转原可见Task修复，当前C／D不接纳、无数据库执行，不把作者独立通过覆盖累计finding。

根会话随后回传原环境Owner无副作用诊断：默认Docker配置ps exit1，既有空配置虽消除配置读取报错仍有named-pipe权限错误；未以换配置／通道继续业务。再由原运行任务经正式require_escalated审批路径只读docker ps exit0，明确没有ACL／用户组／永久配置或通道变更，Docker访问阻塞已排除、无需用户操作。I只复用两份回执，不重复探测或将原通用capture错误称引擎停机。源／测试修复仍独立进行，实际新容器、迁移与浏览器未执行。

最小文件所有权即刻追加给原环境Owner：backend/src/common/environment.spec.ts；backend/src/modules/leads/core-nt-006-migration.spec.ts及core-nt-006-migration-probe.mjs；scripts/run-e2e.mjs及run-e2e.test.mjs。保留原test-environment.mjs／test及Compose所有权；只做夹具、真实探针的标准资源锁／finally释放和必要安全错误分类，不修改生产environment.ts、local-lock通用原语、旧SQL或跳测试。I已核原acquireE2eResourceLock默认根为os.tmpdir()/dev-cor-shared-e2e-locks，因此进程TMP改变可能拆出第二把锁，新增锁验证须覆盖同主机跨worktree及不同TMP仍与标准runner互斥、冲突失败且不强清活动锁、错误路径释放。不要新造同类锁或靠把旧probe放回15433通过。原Owner离线聚焦后交I，原运行Task等待新冻结候选；先新库真实准入及绑定／锁准备，再失败专项，稳定新候选只集中一次适用完整门禁及真实浏览器。

**原环境修复391接纳，累计源码接受，待新冻结。** 原Owner提交39126f3e3f27863941fd5c1747e6e7fe441208de，I核四文件白名单与runner-lock-offline-evidence.json后接入aa71ce5。合法私有路径夹具改为既有.local/private-files获准子目录，新增普通工作区临时目录拒绝，生产guard原blob不变；NT006 connect前取得原标准锁，connect／query／client.end均经嵌套finally释放，真实Jest spec／SQL／schema断言不变。Windows默认锁根固定原LOCALAPPDATA/Temp/dev-cor-shared-e2e-locks，资源key不变，runner进程TMP/TEMP搬迁不产生第二锁；非Windows沿旧逻辑，本轮未验证。作者workspace TMP条件下直接Node工具11文件92/92、夹具18/18、四文件Lint／格式／diff及隔离Sol审C/I/M0，仅离线；未连接DB或运行verify。原累计Reviewer自行核aa71ce5新增四源码与原Owner blob相同、Windows原锁根及key、connect前取锁与嵌套finally、真实Jest直接启动无标准runner重入，Spec／Quality C/I/M0；未重复作者测试，未把离线结果当真实锁／迁移证明。

新执行brief由I文档专项后的最终干净提交指定SHA/tree，仍由01a13e67-4068-778b-a1e9-9d808ecb50e8接续，在指定集成目录源／权威文档只读，输出仅ignored evidence。先经已支持的正式工具审批路径，复核15437／3101／5174及现有锁，不改ACL／用户组／配置／Docker通道；只启动dev-cor-ui003的postgres-test，核唯一loopback15437、实际project／完整ID／image／healthy／tmpfs，以同一三变量绑定capture及所有后续子进程。可先用标准db:test:migrate:deploy在新库public应用155，再正常Jest选environment.spec.ts及core-nt-006-migration.spec.ts；probe仅在新15437自己的随机schema执行，旧15433不可触及。

NT006现自行取非重入标准锁，**外层不得再持有同一把锁运行该Jest或pnpm verify**；协调唯一执行Owner及核对锁状态即可，标准migration／E2E入口各自取并释放。若锁正被其他活进程持有则停报，不删锁或绕过；新Windows固定锁根须与原根一致，即使verify进程TMP在工作区也不能移走锁。两项失败范围实际通过后，在同稳定候选、同新库绑定上运行正常完整pnpm verify，记录各实际数量及双构建；再仅UI003两项浏览器，零重试／零跳过／同原key与事实断言。失败即交原Owner修复，不先重复全仓，不在本轮合C／D。此为eb367f0运行前brief，实际结果与后续修复见下节，不再作为当前未执行状态。

### UI003新隔离实例实跑与浏览器support修复（2026-10-15）

以下先记eb367f0及support修复的历史过程；da37f88实际执行及下一次只重验B的回执见本节末尾，不把历史“未执行”当最新状态。

**eb367f0真实全门禁通过，浏览器收集失败。** 原执行Task 01a13e67-4068-778b-a1e9-9d808ecb50e8实际运行干净eb367f05806a6394e3415b65b107c2e694f63cbb／tree1e360de44d2c8557d2aef9362382083273c9ddbf。从既有本工作区backend/.env.test在内存提取测试密码，Compose插值缺失已解决，不运行setup:local、不生成凭据、不读开发／预览密码。新dev-cor-ui003-postgres-test-1、完整ID dbb1cbd29c6d65b5aa4fd85317c96167fbd94310c34946edc033fc4f2f9d3695，固定镜像、healthy、tmpfs、单一127.0.0.1:15437；public初始0表／0迁移，标准空链155项名称及完成态匹配、exit0。原失败两文件聚焦20/20，08:00:37.4118367～08:05:21.0959553 UTC正常pnpm verify exit0：静态、工具11文件92/92、前端116文件1887/1887、后端115 suites1532/1532、双构建通过；Vite大包为非阻断警告。迁移／聚焦／verify／浏览器前后同HEAD/tree、同容器、指纹919d10f4338f5f723f68cf337f91934034b22c56050e9d0ab1629ff65a2312d1。I逐项核acceptance-summary的14日志SHA256全部匹配，并读实际verify／focused／browser日志及JSON退出回执。

UI003浏览器真实exit1，webServer已有输出，但ui003-quick-actions.spec.ts → core-lead-database.mjs → case-judgment-database.mjs:39在模块收集时按默认15433校验拒绝15437；后续No tests found为同一导入失败。suites0、执行0、A/B beforeAll及test body均未执行、trace0，仅.last-run.json，不能因unexpected0冒称通过。运行Task已停止、容器保留、环境恢复，回执原15433未写／持久预览未动／C/D未执行。本轮证据仅属于eb367f0，目录.local/ui003-evidence/acceptance-eb367f0-existing-config-20261015；不覆盖旧fc4失败，也不称后续SHA全量实跑。

**support源修复接纳。** 原环境Owner交a634a583fa13b0f9f45fe77179b54e514dda437e（父39126f3），I核仅scripts/test-environment.mjs、同名test及tests/support/case-judgment-database.mjs三文件后接06674b99b4f9138605ec11130c94499b942c3bc3。新增validateBrowserTestDatabaseUrl先严格隔离URL，再走原capture的完整三变量、Docker实际容器ID／名称／labels／镜像／health／loopback、测试配置／私有根及环境冲突准入，最后比较调用URL与有效DATABASE_URL，默认15433保留；不是无条件allowRandomPort。原fixture清理／SQL／约束和产品源码不变。作者离线RED复现旧import失败、17项聚焦及最终11文件94/94工具通过；元数据为合成，backend／PG构造器被离线测试显式拒绝，未连接数据库。作者声明三文件Lint，但所列browser-support-lint.log实际缺失，I不称其日志已核；由集成根补三文件Lint／格式及根E2E tsc。原累计Reviewer独立核源码、默认／完整绑定与缺绑定／错ID／项目／端口／URL反例及A/B调用链后Spec／Quality C/I/M0，未重复作者测试。

同类扫描五个函数入口及六个迁移support仍在其明确边界；A/B只seedCoreLeadE2eData({reuseExisting:true})及新记录／统计，不调用这些固定函数或reset，因此当前顶层阻塞由本修复覆盖。C b40225a仍调用case-external-entry旧clear／setGrant（固定15433及清理），D a1bfc53仍resetCoreLeadE2eData，不能据本修复放行C/D。父级应回各原Owner补新合成fixture／reuseExisting和最小授权；历史exact67～72／old150迁移探针不机械扩到155，不逐项盲跑发现下一端口错误。

**新冻结与最少失效检查。** I补静态及文档专项后给出最终干净SHA/tree，再由父级恢复原runner：沿用保留15437容器及既有测试配置内存注入，核实际ID／名称／labels／固定镜像／healthy／tmpfs／单一loopback和155迁移历史；完整三变量贯穿各进程，标准capture记录指纹。先正常pnpm test:context（预期94，实际数为准），再正常Jest只选core-nt-006-migration.spec.ts（新共享模块输入关联的真实PG探针），最后标准pnpm test:e2e仅ui003-quick-actions.spec.ts、workers1／retries0／max-failures1，保存JSON／trace／前后SHA/tree与指纹，必须expected2、unexpected／skipped／flaky0、exit0。NT006外层不持同一锁，不重复建空库或从零155迁移，不运行旧hard15433 wrapper。失败停止交原Owner，不混合C/D，不改预览。

本次相对eb367f0的执行性增量仅上述三文件；原后台／前台业务、单元、schema／迁移、依赖锁及构建输入保持，逐组blob核验留ignored交接，因此只限定复用旧产品单元及双构建，不称新tree完整verify通过。I实核后台488／前台258／运行依赖配置9／标准runner锁迁移Compose5／未改UI003浏览器与support5个tracked entry逐blob一致；清单.local/ui003-evidence/support-a634a58-integration/input-comparison.json。08:26:53.1896734～08:27:33.3005048 UTC根正常pnpm三文件Lint／格式、E2E根tsc及diff均exit0，记录同目录static-result.json及三日志，补齐作者Lint证据缺口；无DB／浏览器／新全量执行。工具、共享准入／真实NT006及浏览器输入已变，必须补实际失效范围；C与分栏修复形成新产品组合后Final Review并集中一次所属完整门禁，D择机组合，不能以本次有限复用豁免新产品组合。

**分栏编辑新增缺口与所有权。** 用户明确案件分栏编辑仅修改该栏已登记信息且阶段不变，流程另行办理；新独立01a13ea6-b164-746d-9c69-7f99b23de0c1从C b40225a接手CaseDetail映射及直接测试。原git worktree add因ref lock权限拒绝且未创建；I核目录／分支／锁均无残留后正式require_escalated审批一次创建section-record-edit-fix／codex/section-record-edit-fix exit0，现场干净b402，任务已接手。未改ACL／覆盖C；C后续同页需先协调单文件Owner与增量顺序，I只合独立增量、不写实施代码。验收必须逐栏真实点击、修改、保存、刷新核目标字段及阶段不变，取消无写入，并验证独立办理按钮；未适用栏解释，不仅测开窗。原Task核执行邮寄／立案／结束缺独立更正、开庭correct会改阶段、判决／结案／归档更正受实际阶段限制；二审正式API本已区分second-instance-save和result，先拆前端意图，不据混合面板发明新后端Command。必要后端缺口由父级另派，当前错误未修复验收。Library截图materialize因Windows os.setxattr不可用失败，未产生可读文件，未作截图结论或绕过。C与分栏修复同批真实验收，D可后续组合。

### da37f88真实A通过、B编码断言失败与单文件修复

父级经原通道恢复runner turn01a13eb9-cce3-71fa-94e6-43a3319ed004，08:44:29.6655177～08:46:30.7451039 UTC在干净da37f8873a10c8dea12e3b383f47a2cee256d91f/treebf9704618a9ef47d818c61fd097c7c45f7079ef1实际执行正常工具94/94、NT006真实PG2/2，原同一dbb1cbd2完整容器、155历史、全阶段指纹919d10f4…一致，无重新建库/迁移/构建。浏览器expected1/unexpected1、skip/flaky0、exit1；A在7.6秒实际完成原因只填空/手填保持/清共用不回退/批量归档及刷新重登核原事实，有trace。B在446行要求returnTo全百分号编码的正则失败，实际URL通过标准URL.searchParams.get解码正为/leads?page=2&status=WAITING_PUSH，目标编辑页正确；取消/保存/未知推送和重放尚未执行，不称B产品已验。I核10份日志与A/B两trace的SHA256均匹配，保留完整失败，不把max-failures全局停报当额外产品故障。证据.local/ui003-evidence/acceptance-da37f88-20261015/acceptance-summary.json及browser-artifacts。

原浏览器Owner /root/ca018_frontend 已经原内部任务成功续派，单文件c25987dcc356b88ddf69c7522c8d8a675fd933ba，I只合该增量为d4be97ac5d07b927aa54d535c316c5da0eab21c5。B以expect.poll和标准URL精确核origin、/leads/${editTarget.id}/edit、唯一returnTo键和严格解码值，拒绝错对象/外域/缺参/重复/错页或状态；不是删除语义断言。A正文、共同seed、B后续全部保持，作者版本核对、正常context（仅已知漂移）、根tsc/单文件Lint/格式/diff通过，无DB或浏览器。根源码审确认只有B两条旧URL断言替换，尚不预写B通过。

文档专项后指定新固定SHA/tree，由父级原通道恢复同runner，只运行pnpm test:e2e tests/e2e/ui003-quick-actions.spec.ts --grep 'page-two quick edit preserves its query and an unknown real push replays the frozen command once' --workers=1 --retries=0 --max-failures=1，保留JSON/log/trace及同实例/指纹/前后HEAD/tree，必须expected1且unexpected/skipped/flaky0。A前缀正文/共同helper和产品/环境/工具输入不变，保留da37实际A/94/2及旧eb367产品单元/构建的准确候选证据，不因单文件B断言修复重跑A/全工具/NT006/完整verify，不冒称新树全量。用户最新三列表内办理另为接续范围，不在此修复中重做产品。

分栏e6c4260相对C b402精确23文件（16前端、5E2E、2support），tree9f0e5d7c792498962c56ae6ee2d489afea4e997c干净，未合当前树。原Reviewer完整23增量复审产品源码Spec/Quality C/I/M0；已知执行/开庭/后续历史判决结案缺口保持OPEN。原C的I-UXQ-C01未触及；新增验收阻塞C-SECTION-E2E01：五专项仍接旧clear/reset，external helper TRUNCATE、closure/archive helper SET LOCAL session_replication_role=replica并改stage/version/删事实审计Grant，旧SQL非本次引入但本次测试不得在保留15437直接执行，不可只扩guard端口。315旧组合+最终Closure51为限定局部结果，根开发期审批check:fast通过时源仍变化，不称e6最终固定门禁过。

后端S 01a13eba-6a0b-74af-9ef0-852b446e40c0首v1合同只在section-record-edit-shared。I通过正式审批实际Prisma validate exit1 P1012六处复合自关联唯一关系，generate未执行；原Reviewerv1 Spec/Quality REJECTED C1/I1/M1：除编译问题，还有closure输入缺expectedClosureVersionId的迟到编辑锚、date-only校验口径；hearing undefined推断待实际校验复核，不以猜测改nullable语义。S后报修反向next数组是新证据，尚待复验和I-S01关闭才可代提交schema/DTO/spec小基线给E/H。新增文书关系接MaterialService冻结/删除/恢复/下载及直接测试唯一归S；FK不等于材料权限与读路径已验。根不实施，不混catalog/新迁移或S产品到当前runner树。
