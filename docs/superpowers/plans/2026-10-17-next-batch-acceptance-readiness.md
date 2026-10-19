# 下一批最小页面闭环与一次性确认清单

2026-10-19本轮执行已结束：EF真实1/1通过；Lead三业务POST均201，列表／详情／刷新v2与正常退出通过，但最终dispose的CASE_DIFF误报导致正式FAIL。原两页所有登录／业务额度均已耗尽，以下运行命令与预算仅保留为历史，不再构成启动授权。检验器最小单条件修复已获纯25/25和独立双轴C/I/M0；不重跑任何登录／业务操作，不改原失败。新真实操作必须先报告对象、session、请求及伴随写上限，由用户明确批准。现阶段只继续独立CSV纯预览UI准备，公证166不混入验收树。

2026-10-19执行断点：原案EF已在2bf4b14b真实1/1通过，额外1登录和2反馈POST已耗并闭合，不再重复。Lead独立命令在服务前PRESERVED_EF_ROWS拒绝，原H42的1登录／2Lead／3POST未耗。已定位Playwright loader／worker重载配置时本进程argv不含原单文件，旧配置回退同时校验EF；拟固定Lead专用配置，每次重载仍保留全部真实Lead前置，不用环境变量跳过校验。不放宽旧行、不另造基线成功证明。定向验证后只续Lead，仍同环境／原权限／原数据范围、首异常停。EF成功事实及本轮全377物理文件保护作为已封存历史保留，详细证据只见VALIDATION。

修复冻结并审查后，后续唯一页面命令改为 `pnpm test:e2e tests/e2e/lead-batch-push-minimal-page.spec.ts --config playwright.lead-minimal-page.config.ts --workers=1 --retries=0`。不能再用原双kind配置运行本轮Lead，也不能重新执行EF。Lead前基线是已保存的EF成功后完整现场（rows SHA256 `87f3f28c0e61a5e8a44698a62f07c8e603f378473c4f83750d5ec62aa1ae3068`），仅此真实已批准增量；fresh准入、原H42资格及本轮完整文件保护保持，不能靠改写原source proof或放宽差异来进入。

文件集合前提：保护对象含96个已登记CV及当前私有根全部旧物理文件，二者不是等量集合。不得为符合计数删除额外旧文件，也不得把其旧mtime当原时刻封存证明；登记CV逐项匹配和本轮全根before／after、新增0均须保留。此修复前置通过后才续原两页，不增上传额度。

## 日常业务主线与验收映射

用户确认的角色分工是“运营导入线索→运营推送给对应客户→客户审核确认→运营继续公证和案件办理→结束结算归档”。线索来自运营内部采集／导入，不以客户上传或提供线索为前置；关联客户表示业务归属。各段检验真实入口、状态和对象关联、上段信息继承避免重复录入、最终账目与归档可追溯，禁止强造状态跳流程或新增公证处／法院外部角色/API。

| 阶段                     | 已实现或已验子集                                     | 当前待验／缺失                                                  | 继承与追溯要求                                                                   |
| ------------------------ | ---------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 运营导入或录入并关联客户 | 原手工创建及客户／主体关系主线已有验收               | 当前两Lead页面未实跑；CSV独立纯预览模型已领取，完整导入尚未交付 | 同一线索保留运营来源、客户、主体与商品字段；手动新建不算CSV已验                  |
| 运营推送对应客户         | 原单条推送已验，批推源码已有                         | 本轮一次批推页面待验                                            | 沿关联客户与真实版本推送，保存推送人、时间及结果，不重复建线索                   |
| 客户审核确认             | 原客户企业隔离、审核及取证决定主线已有证据           | 新对象／不同组合须独立合法验收                                  | 客户执行确认；运营沿同一线索及不可变审核历史续办，不手改确认结果                 |
| 运营内部送证及公证登记   | 既有NT主线与稳定材料版本已验子集                     | SD61静态已收口，166真实迁移／页面另排                           | 继承线索、客户／主体、材料CV与来源回执；外部办理按已批准内部登记，不假造API送达  |
| 案件办理至结束           | CA001～017主线及CA018有限入口有验收                  | 新资料更正、EF与角色／来源组合按各切片待验                      | 正常主线承接真实公证源，不以历史／外部入口替代正常流程；保留来源、阶段事实和版本 |
| 钱款结算                 | CU008人工台账、Demo A有限内部费用／结算已有真实证据  | 多客户、门户／PRIMARY、并发及其它未验边界仍独立保留             | 原案件、费用、收付方、账单、凭证可联查；人工记录不等于外部到账成功               |
| 信息归档与证物           | 已有业务归档及Demo A有限内部证物流／精确文件下载证据 | 新来源／多角色／实物保管及生产存储恢复另验                      | 客户—线索—公证—案件—费用／账单及材料版本、审计保持可追溯，不删历史               |

本表是已有能力和缺口映射，不声称单一新对象全程已实跑，不增加账号、Grant、数据库、迁移或真实写入额度。优先上述核心闭环；报表全口径、OCR／爬虫、外部自动集成和生产存储等长期增强另列，不阻断独立纯代码开发。

LIVE断点处理顺序（2026-10-19）：已由受保护只读probe定位材料引用case／审计CASE混用；只修helper精确两处和直接回归，原Reviewer关闭finding后更新候选／receipt。原Runner先以同一强制list、无服务／回调方式确认实际前置；成功才独立执行原EF页面，再由其成功收尾决定是否执行Lead。原案及原96文件复用，禁止为消除锚点失败补造引用、Case、文件、权限或重跑来源。

当前执行顺序（2026-10-19前置阻断后）：先冻结安全诊断及定向审查，由原Runner在正常protected入口使用专属ignored配置，强制--list／webServer空／0callback，仅运行preflightOnly只读准入；成功或失败都结束，不进入登录。取得精确失败阶段后定向修复、复审并更新候选／receipt，才按原未消耗额度先EF后Lead。不得用普通Node或伪造pnpm上下文绕过guard，不把未知根因当成可忽略告警，也不自动重复正式页面命令。两次22cd前置失败均未新增session／HTTP／业务写入，不需重新申请同一额外EF登录授权。

2026-10-19额外会话已批准：用户02:01:49 UTC／Sentinel_99b86fc7c7ac81918193c5af43f85438明确回复允许，父级完整转交，原Runner已收到原文。仅增1次EF登录／session用于原Case 6c151c42-3054-466b-9a0e-a8daaf99fbde的2次原剩余反馈业务POST，账号／Grant／Case／文件／上传／来源POST均不增加；H42原1session／2Lead／3POST保留。checkpoint与独立审查、精确候选、今日标准前置仍是运行前提，尚未发GO。以下“待批准”只保留为更早断点，不再重复询问该会话。

本轮EF测试入口收窄为上述已保存原案的专用checkpoint续验：当前spec不再含可调用的fresh建案／上传链，full prepare缺精确mode拒绝。原fresh实现及失败证据完整保留于dadb等Git历史与原证据目录，未来新案测试须另定任务／额度，不能用本轮resume参数解锁。既有配置的EF preflightOnly仍执行固定receipt／证据门槛且只返回窗口，不读取credential或发HTTP；这不等于开放无mode的正式续验。

2026-10-19测试刷新窄修已提交a4bf37923b4162c8aca6369bccd0e648a0306adf：仅原EF页面spec和直接纯测试，4/4及定向类型／Lint／格式通过。该补丁等待新GET请求自身200再查精确案号，不改变产品或预算；ca015未更新。原来源复用checkpoint尚待实现／审查，额外EF登录会话尚未获批，不能据此运行整份spec或重建来源。以下断点续验草案仍非运行指派。

2026-10-19来源保留后的最小续验草案（尚未获新运行授权）：原EF已创建Case `6c151c42-3054-466b-9a0e-a8daaf99fbde`／`CA-20261019-0001` EXECUTING/v3，mailing `edc4c890-0a88-477b-8318-fea0e93586a0`、filing `c1fab17d-d583-45ad-bf36-f3492c5d8b9b`及两43byte CV／原三回执保留，反馈0；不得重造、重传或重放来源。固定受审修复后，先唯一Runner只读核当前身份／旧行文件／165／六EXPIRED及原Case、真实filing、两CV、来源receipt、反馈仍0，以上一轮after为新保护基线，允许旧Case只增加本次精确反馈／更正子事实，Case阶段／v3不变。恢复页面需先点击真实“刷新”并等待由该动作发起的成功列表GET，再按原案号进入，登记feedback revision1→原因更正revision2→刷新保持→退出，业务仅2POST。线索页仍另用原H42登录创建2lead／一次批推3POST。

额度：已用1session／1Case／3来源业务POST／2PDF共86bytes／4上传阶段；反馈写0，原H42页未开始，业务还余5POST，上传与来源对象余额0。原EF session已logout204并撤销，不能复用cookie或将旧会话重新启用。为保留原剩余1个H42会话，**须额外明确批准1次原EF身份登录／1session及其原正常logout或已绑定ID精确fallback**；不增加账号／Grant／Case／文件／来源或业务POST额度，不获批前不运行。resume checkpoint必须由真实原日志与当前只读行／hash证明，区分priorConsumed与本次发送计数，不给未发请求虚计成功、不放宽原预算。每次仍新核真实日期与至多15分钟同日窗口，任何新候选／权限／source漂移先停，未知结果不得自动换键或补量。最终候选／源hash与checkpoint形状另在代码冻结后交Runner，不直接重跑原全spec。

恢复指针（2026-10-19）：用户已恢复原任务并行及本页原未用两页额度；昨日六草稿过期已成功，不再执行。原ca015仍dadb0989，今日尚未新做现场准入。原Runner只修自有ignored证据配置绝对testDir，先原生CLI发现恰2项／callback0，再重新核今日UTC／Shanghai日期、固定候选／R2／165及唯一历史、原身份、旧行／94文件、服务锁和完整硬窗口后台候选。任何新的推进／过期／清理对象不属昨日六行许可，出现即停，不新增Grant或预算。原公证39源纯收口隔离进行，实际公证DB另需独立范围，不混两页。主控原窗口工具恢复后已成功投递Runner续单，准确范围在独立文档树.local/resume-20261019/runner-resume.md；公证格式投递自动审批拒绝、只读替代消息又报AbsolutePathBuf错误，需用户直接恢复。未创建替代Task或绕过。

暂停断点（2026-10-18）：六个指定draft已获用户单独批准且一次精确过期，保留记录／文件，新基线及94份原文件已核。ca015固定dadb0989；原Runner随后因ignored证据配置未固定绝对testDir而发现0项停止，线索命令未启动，页面额度未消耗，未修／未重跑。公证原Task的39文件在独立cfb3d2b3树冻结未提交，508项纯测试和快速静态通过，格式M1及最终context未执行保留。原Runner、公证Task及其子任务均已暂停，服务／会话／标准锁已收尾，R2保留；不启动本清单的后续实施，不混合公证代码，不追加push／迁移。以下为历史批准范围，须收到恢复指令后按当前验证记录及新基线续办，不能重复过期或挪用已耗尽旧额度。

状态：两条页面入口已实现。2026-10-18用户已在原Runner直接批准恢复基础配置、使用官方受保护R2覆盖并继续本页原两页额度；165只读核验通过，尚未登录即因旧EF身份封存不符停止，业务／上传／会话额度均未消耗。精确身份两源候选0901ffac已完成pure11/11／根类型／静态／离线发现和不同Sol两轴ACCEPTED、C/I/M0，最终文档固定后才交原Runner，不重复申请同一额度。以本页替代7ab3e257中的“EF接口首项＋线索八项、11会话”申请，不先跑API块再追加页面额度。远端代码备份仍为 `0b90e9c3e28f7a1a3cf6cd195728f6a6da43cc52`，后续本地准备提交未上传；此前已耗尽旧业务、文件及登录额度不恢复。

## 1. 已核环境及开跑条件

本节前三条保留2026-10-17准备记录，其中“未连接DB／15433配置待定”已由2026-10-18真实只读前置更新：官方capture已通过且实际仅R2，ledger通过，身份旧1／1门槛停止。基础15433模板的含义以本页收口段落及当前验证记录的正式覆盖机制为准，不能据历史描述改成连接15433或把基础文件改15438。

- 本轮仅只读Docker过滤inspect：R2完整CID `45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236` 正在运行、healthy；project `dev-cor-ui003-r2`、service `postgres-test`、`127.0.0.1:15438`、卷 `dev-cor-ui003-r2-pgdata`及固定postgres17.11镜像摘要 `051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0` 匹配。普通令牌访问Docker pipe被拒后，同一过滤inspect经正式审批成功；没有启动容器、服务或读取Config.Env。
- ca015、原EF、test-runtime-stability及frontend-integration现有 `.env.test` 实际均为15433，本轮未改。未来执行单须明确允许唯一Runner正常配置一个固定运行树的R2 URL及本树private-file root，使用标准capture复核两URL/完整tuple，不借进程覆盖绕冲突校验。原文件只核字节；如本树缺文件，先列准确source/key/size/SHA/target清单，未经核准不复制或覆盖，不搬回私密归档。
- 尚未连接DB。healthy不是当前ledger/身份/业务资格证明。未来写入前，在标准锁内READ ONLY核完整source/public165及唯一精确resolved历史、全部旧PK行/安全表/Case/序列和真实文件字节，记录真实数量，不硬编码87案/92CV。Nest启动会立即并每60秒推进到期开庭，材料cleanup立即并每15分钟运行；从启动至本轮硬截止（至多15分钟，且不得跨Shanghai业务日）的旧对象推进、过期、pending清理、物理清理候选须全部为0，否则启动前停下另列影响，不自动处理或禁用后台机制。到截止先停止业务、收尾并退出服务，不延长窗口加量。
- EF resolve原三件已找到，不再resolve：`ef001-integration/.local/ef001-evidence/official-ef001-resolve/receipt.json`（853bytes，SHA256 `162c5ead547631b44a84913abc8a7068191dc2198fb58a420b3f73fa98b3ed1c`）；同目录stdout.log（172bytes，`a51491bda92c3572154b87419a96572b0052ab3a47fe4222a568eca3a3b9ddfe`）、stderr.log（961bytes，`211b3323777fed313dce76ef3c4b17609b34e69a87930c44483b90a18e6f256d`）。接入核原字节及官方proof，不能造替代成功回执。
- 原唯一Runner「验收独立环境快捷操作」`01a13e67-4068-778b-a1e9-9d808ecb50e8` 串行执行，两块各固定候选/证据目录，workers1/retries0/首个非预定失败停业务。下列额度可分别或一并批准，不相互挪用；仅明确的会话收尾和只读保护可在失败后继续。

## 2. 两个实际页面任务，不运行旧API矩阵

### EF：填写一条法院反馈，再带原因更正

仅复用原Runner已封存的activeSource：user `03620738-5f11-49f9-9279-95d51306e32e`、role `cfd6fa11-f04d-4e99-ab3c-2fccc8e22161`。原主role active/v1、同部门membership／原assignment和10个DEPARTMENT Grant保持；2026-10-18只读快照与Demo A授予／terminal回执精确核对，user授权revision已为3，另有固定active assignment指向已停用inactive/v2的Demo A角色。修复后的helper必须实时拒绝该额外角色复活、ID／状态／版本／scope／14个原Grant漂移或第三分配，不把双分配泛化放开。必须live复核其中本片所需7项（case.read、customer.read、case.external-entry.create、case.execution.mail、case.execution.filing.submit、case.execution.feedback.record/correct）及全部原身份/授权行保持。复核失败就停，不恢复旧角色、补权或造新actor。本次新增身份/Grant均0，结束不撤旧source权限。

先由该身份仅用正常HTTP准备一个新HISTORICAL_BACKFILL Case：转入、执行邮寄、执行申请各1次；2个合成PDF各43bytes用于邮寄回执/申请证明，形成真实EXECUTING/v3和本地filing。不能SQL造Case/filing；这3次来源准备不冒称目标页面验收，也不运行原14项接口矩阵。

目标页面固定：正常登录→侧栏“案件”→按本轮真实案号找到新案→详情“执行立案后续资料”→“登记法院反馈”，日期/法院案号留空、填写合成内容→页面提交→看到本轮feedbackId revision1及确认→“更正这条反馈”，填写不同内容及非空原因→“确认更正”→看到同根revision2、原revision1/原因→点页面“刷新”后保持→正常退出。两次EF写必须由真实表单/按钮及其原transport发出，不能用测试request直调替代；提交后GET必须核真实保存内容，不只看点击或toast。

本块新增上界：1 Case/1 trial round/1 external entry，来源3 fact/receipt/audit组（转入Case组三个根按真实schema计）、2 feedback versions/2 EF receipts/2 audit；2 drafts/2 materials/2 CV/2 blobs共86bytes、邮寄/申请各1 typed document/ref；1 session。合计可定位新增关系行28–29：session1＋Case/round/entry/receipt/audit5＋至多新case counter1＋上传6＋邮寄/申请fact/receipt/audit6＋typed/ref4＋EF6。若counter已有则28；Case指针、邮寄/申请阶段/版本、draft/material currentVersion及正常计数器更新另记。EF本身不改Case.stage/version/原filing。无补交、finish、重放、故障或并发，不称这些页面已验。

### 线索：页面新建两条，一次批量推送

仅复用H42 user `edc8bf6f-6660-41f6-8418-f72f87443a1c`、role `51c34a8b-fb00-45b1-ab9f-d077d59d4878`；原42 Grant/credential/membership/assignment保持。live只读核customer.read、lead.read、lead.create、lead.push和既有客户 `50000000-0000-4000-8000-000000000002`、权利主体 `60000000-0000-4000-8000-000000000001`、active CLIENT binding及页面可见资格；缺一即停，不造terminal或补权。

正常登录→侧栏“线索库”→“新建线索”，每条在真实页面选客户/主体，明确案件类型CIVIL、侵权类型仅TRADEMARK、来源ONLINE、平台TAOBAO（先核真实表单字典确有这些合法选项，否则停）；发现时间用本轮真实合法时间，店铺/商品名称为不同的runId合成标记，商品URL空、销量1、单价1.00、评论数0，明确“是否申请披露店铺经营者信息”选否（needDisclose=false），不上传截图。各提交一次→记住两个真实ID/编号→回列表勾选恰好这两条WAITING_PUSH→“批量推送”，核对话框数量2及客户分组，主体由登录响应/本轮会话证明另核（对话框不显示身份）→只提交一次→面板关闭/列表重载→切“线索待审核”、逐条详情/刷新核WAITING_REVIEW/v2→正常退出。现实现无独立成功toast，以实际页面状态及事实对账判定，不依赖前两行或计数器。

本块新增上界：2 lead、2 product、2 infringement、2 create receipt、1 batch receipt、4 audit，共13关系行；另1 session、2次编号分配（若该部门counter尚不存在至多新增1行，否则只更新）。无新账号/Grant/客户/绑定/文件/Case，不撤H42，不跑旧8项、故障DDL或terminal流程。

### 两块一次性总额度

| 范围         | 新申请上界                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 身份/权限    | 新用户、凭据、role、Grant、assignment、客户、主体均0；两既有身份及全部原权限保持，不恢复任何inactive角色。                                                                          |
| 业务对象     | 1新Case及其合法来源链；2新线索/2商品/2侵权类型；2条EF版本。各自成功receipt/audit如上保留。两种counter最多各新1行，已有则正常更新，不回退序列。                                      |
| 文件         | 2份合成PDF/2 drafts/materials/CV/blobs，共86bytes，仅EF来源；原文件不动。                                                                                                           |
| 页面/请求    | EF来源3次＋反馈2次＋线索创建2次/批次1次，共8次正常业务写；上传POST/PUT共4次；正常登录2次/2新session，页面logout各1次。无额外业务重放或补量。                                        |
| 伴随写与结束 | 仅上述新session的lastUsedAt/authorizationRevision及最终revoked_at；本轮新行和明确counter/Case/draft/material更新。所有既存安全/业务行保持。无角色末端改动，无迁移/resolve/故障DDL。 |

页面GET数量随路由/刷新产生，记录实际清单，不冒称“8次业务POST＝全部DB更新”。每块只登录1次，失败/响应未知不自动再登录。失败可能对本轮USERNAME/SOURCE两个auth_throttle键各插入1次，两块最多4次；保留不删。成功登录会delete匹配USERNAME throttle，失败又可能更新SOURCE旧行，所以各次登录前在私密内存计算准确的两个键并证实旧匹配行均0，否则停下另裁；不输出节流密钥或摘要原值。未知业务结果保留原target/body/key，不换键或造替代；此正向块不预留业务重放，收尾后报告断点。

## 3. 每个新session的精确收尾

旧11会话申请整体撤回。新方案只允许上述2个session，逐块结束并收尾，不把关闭context当服务端撤销。

1. 登录前保存旧auth_sessions PK/行摘要；登录后PK差集须恰1，并核user/dept/创建时间窗/expires_at。在私密内存计算本context HttpOnly cookie的SHA256，与该行token_digest相等；普通证据只留ID/比较结果/行摘要，不dump cookie/token/口令。无法唯一绑定就停止，不猜ID、不按actor批量撤销。
2. 正常结束或业务失败后先保留必要pending证据，用真实页面 `[data-test="logout"]` 退出一次（窄屏先开菜单），只读核该新ID的revoked_at。AuthController finally在失败时也清cookie，不能再靠重取cookie重试，不追加登录或getSession证明请求。
3. 页面logout失败/未发出而唯一新ID已证时，至多一次精确fallback：事务内SELECT FOR UPDATE重核id/token_digest/user/dept/created_at/expires_at与绑定一致；已revoked仅读不更新，否则参数化UPDATE仅同id/token_digest/user/dept且revoked_at IS NULL，设置revoked_at，要求rowCount1。0行/任意不符即停。正常logout与fallback择一最终撤销效果，最多2个本轮ID；不delete、不撤旧session、不延长expires_at。
4. 业务首失败后只准此收尾/只读对账，不做第二业务请求或下一块。保留全部新事实/材料/receipt；旧行保持，服务/端口/标准锁结束释放。绑定/守卫失败标为未完成，不制造清理PASS。

本节只规定本批新会话的授权收尾，当前尚未登录或执行撤销。现成EF原测试只dispose、lead full8没有该页面logout，均不直接拿来执行本方案。

## 4. 已落地入口与验证边界

- EF入口：`tests/e2e/execution-feedback-minimal-page.spec.ts`；线索入口：`tests/e2e/lead-batch-push-minimal-page.spec.ts`。两条都由真实页面操作目标业务；EF仅正常HTTP准备已列明来源，不以接口测试替代反馈页面。
- 共用 `tests/support/minimal-page-acceptance.mjs` / `.d.mts` / `.test.mjs` 与 `playwright.minimal-pages.config.ts`；两份 `*-minimal-page.test.mjs` 纯回归核现有Vue选择器及预算接口。导入/构造不做I/O。正式配置在webServer之前同步完成只读准入，复用原protected入口外层锁，不重入；已有32bytes指纹key缺失直接拒绝，不由预检自动创建。私密credential载荷只在普通执行prepare通过前置后读取，预服务分支不读；DB凭据旧行摘要在SQL内计算，只返回摘要。
- 预算在发送前检查真实method/path/body、run标记、固定customer/holder、target/revision、2个43bytes PDF及其SHA、两条线索字段和精确batch IDs；不通过就abort并使测试失败，不返回模拟成功。APIRequest来源准备同样在dispatch前传原body/bytes给预算。最终核Case/Lead完整ID差集、相关来源/receipt/audit/材料typed/ref行数量、旧行SHA、精确counter增量及本根blob；EF不能新增线索，线索不能新增案/材料。该相关表保护不冒称全库所有未跟踪表的通用审计，完整旧行及库外文件保护仍由唯一Runner独立前后核验。
- 已实际完成：两Worker各自根类型、定向Lint/格式、纯3/3且0skip、原生CLI发现各1项；主控组合根类型、架构18模块/164模型、纯回归及两文件同配置发现恰2项。原三项Important和累计未绑定会话收尾finding均由独立原Reviewer关闭，八源两轴ACCEPTED、C/I/M0。没有真正运行这两条页面、数据库或服务，完整verify/NT006本轮未执行。
- 离线发现只用原生Playwright CLI与本配置 `--list`，此模式webServer为空，不执行preflight/private reads/callback；不能为了发现调用会capture的protected脚本。真实运行的唯一允许入口仍是下列受保护命令（本轮未执行）：

```powershell
pnpm test:e2e tests/e2e/execution-feedback-minimal-page.spec.ts --config playwright.minimal-pages.config.ts --workers=1 --retries=0
pnpm test:e2e tests/e2e/lead-batch-push-minimal-page.spec.ts --config playwright.minimal-pages.config.ts --workers=1 --retries=0
```

- 两块各固定候选、runId、证据目录和新session，不挪用额度。先完成本页前置配置/材料核对、live只读和新增预算批准，再由唯一Runner串行执行；不得直接运行原生CLI省略外层锁。失权/前置不符就停，不造actor/恢复权限。成功路径注销必须实际204、回到可见登录页且精确session已撤销；fallback只保护已绑定新session，不能使页面PASS。登录200后若cookie/绑定失败，仍只尝试一次正常页面logout，然后始终SESSION_UNBOUND失败；不猜session ID，不以actor批量撤销，保留原错误和收尾错误。
- 失败trace放用户Temp独占目录，可能包含登录态或口令表单值，按私密材料保护；不上传Git、不复制到普通报告，交接只给路径/hash和脱敏业务请求摘要。它不属于公开代码备份。
- 可复用的原证据仍只覆盖原输入：2ef6a739完整verify139工具/2510前端/2351后端、NT006/双构建、EF14分段API及只读3项、165 owned/官方升级/历史保持。新8测试文件不是新产品完整门禁或真实页面通过；不重复迁移/resolve，不重跑原14或full8 API。PRIMARY/门户、真实24h过期、流中撤权、非current版本、20MiB/50MiB等边界、未知恢复、回滚/terminal等未验项继续保留，不夹入这两条页面。

## 5. 原公证三项建议（后续独立规格已确认）

2026-10-19独立准备已核：d8ab9b3e／tree dfd7bc75的39路径与ca015 dadb、主准备树已提交版本均无文件级重叠改动；这是只读diff结论，尚未实际合入或验证组合。来源parent cfb3d2b3另有11份SD-61规格／状态文档，集成时须同步已批准语义，不能只拿代码而丢掉契约。公证代码及迁移不进入当前严格165两页候选。

来源目录实数166，新SQL原始SHA256为0af29f0bd3ae041e4485d80a3a51f1ec259ea437e588e3f7402cc557f322c5f2。当前两页prepare的FROZEN_SOURCE在capture／PG前要求165源；先合公证源会拒绝。若先应用公证迁移但仍用165源码，则LEDGER要求的165成功＋唯一精确历史行被新账本破坏，也会拒绝。这是源码推论，不是本轮DB实测。实际顺序固定为先收尾当前两页165验收，再独立集成公证、核166新链、申请迁移及业务预算，不能为并行而放宽两页gate。

新增数据库动作仅列申请，不执行：迁移20261018000100_notary_record_corrections增加notary.record.correct枚举和3张不可变更正表，新Action目录无自动Grant。最小验收先只读核两条同范围WAITING_UNBOX事项、一个内部合法开箱／更正身份及一个原已关联外部身份；目前没有已核可用ID／Grant／照片字节，不造对象或恢复旧权限。若可复用这些身份／事项，条件预算为0新事项／账号／角色；需要的精确新Grant须另批。两张照片若无可复用合法CV，则先固定每份SHA／字节，申请2draft POST＋2content PUT，不猜字节数。正常2次opening＋2次更正为4业务POST；若另批受控未知结果及同body/key核实，再加1请求；旧版／异参同键／外部拒绝各1可选负例使上限8。内部／外部各1session共2，全部另用新批准预算，绝不复用当前两页或旧耗尽额度。迁移、未知注入、业务写入和身份Grant变化均须精确批准；没有合法外部关联就保留外部有效读缺口，不临时造关联。真实验证需保留原evidence／opening／费用／Case／文件锚，更正仅新增revision、审计与回执，不推进流程version；仅文件级可合与508纯测试都不代表这些真实证明。

以下保留2026-10-17建议来源；三点已由后续用户确认，最小规格及准确范围以独立提交cfb3d2b3为准，原公证Task当前已恢复并在独立目录实施代码／纯测试。特别是来源授权沿原SELF／TEAM／DEPARTMENT，不从旧建议的TEAM／DEPARTMENT限制排除原SELF；不再等待三点业务答复。其公证schema／API／UI不并入本页冻结运行候选，仍无迁移执行、真实账号／Grant或数据库验收授权。

依据INPUT-016、[当前公证Spec](../../spec/v0.1/modules/notary.md)、[NT002单项开箱设计](../specs/2026-09-24-core-nt-002-unboxing-materials-design.md)及Demo逆向M03。字段更正/跨事项开箱方向已批准，以下资格、阶段与批次语义是新增选择。

| 决定                          | 推荐首片                                                                                                                                                                                                                                                                                                                             | 既有依据/准确影响                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 谁更正哪些资料、冻结/归档边界 | 仅获新 `notary.record.correct` Action的内部操作员，按现有DEPARTMENT/TEAM来源范围；公证处/客户首片不开放，不新增职级门槛或自动Grant。取证日/物流在原取证事实存在后的WAITING_UNBOX、UNBOX_REVIEW、ISSUANCE_DECISION、WAITING_CERTIFICATE、WAITING_RETURN可带原因追加revision；寄件须原开箱事实存在，在后四阶段可改；ARCHIVED首片只读。 | 现取证/开箱为不可变原事实，无独立更正API/版本。仅改变“当前资料”投影；原审核/决定/照片归属/冻结CV/Case及费用锚保持，物流改动不改派照片。证书编号/日期/文件另片。资格和允许阶段是本次选择，不从SD-24或普通record Action推定。                                      |
| 跨事项照片归属、可复用页面    | 内部公证事项列表现有勾选区加独立批量入口，逐事项明确matter ID/version、寄件信息及照片；未知/混包/多匹配保持未提交。首片无ZIP/单号自动分派。                                                                                                                                                                                          | 复用NotaryMatterListPage.vue的selectedIds及NotaryMatterWorkflowPanel.vue单项照片上传/选择；现没有完整跨事项归属面板。每项只WAITING_UNBOX，写时重验notary.unbox.record及来源范围；NOTARY_MATTER owner、1–50张JPG/PNG/WEBP且每张≤20MiB保持，一事项CV不挪另一事项。 |
| 逐项结果还是整批回滚          | 推荐逐项独立事务，显示成功/确定失败/未执行/未知；成功不重做。确定失败/未执行刷新事实和版本后重提；未知只按原body/key核回唯一结果，不当失败换key重试。                                                                                                                                                                                | 单项opening现有事实/引用/审计/回执的原子性可复用；批次聚合/恢复是新合同。NT010整批原子仅限WAITING_RETURN＋NO_ISSUE归档，不能套本片；Demo的ZIP逐组/队列兜底不构成正式依据。                                                                                       |

可整体采用推荐或逐项改动；冻结前不写新Command/schema/按钮/Grant。冻结后只按backend/schema/API与内部UI唯一作者分工，不建通用审批系统、不重复NT008/009/010，不混证书更正/误建删除/终止。源码及旧Owner定位保留在本机ignored notary-scope.md，不再新增路由台账。

## 6. 收口与一次性运行申请

本轮已完成可执行但未运行的两条真实页面入口、共同准入/预算/会话收尾和纯回归；原生发现恰好两文件两项，callback0。八源累计独立源码复审两轴ACCEPTED、C/I/M0，含未绑定会话失败收尾窄修。原静态计划的ACCEPTED不冒充新增源码或真实UI通过。

2026-10-18用户已在原Runner直接授权继续本页两个窄场景，现仍未消耗：0新账号/Grant、1新Case、2新线索、2份PDF共86bytes、2新session、8次业务POST和4次上传阶段请求，必要读取与新session自身更新据实记录；两块各自正常logout一次，失败仅本页明确的精准收尾。旧EF/Demo/API/登录额度全部0，不复用、不挪用。真实页面还未开始，严格身份修复交付后仍须完整前置通过。

官方要求.env.test基础模板为15433，再用受保护DEV_COR_TEST_DATABASE_URL＋project/CID覆盖和capture.childEnvironment确定实际R2 15438，不连接15433、不改guard或凭空消除冲突。原Runner已按此恢复并通过capture；不能把基础15433本身再判为坏配置。执行前仍核本树private root、材料精确缺失copy清单、165 ledger/原resolved回执、既有身份全部授权/客户资格、旧事实和文件及后台候选；任一不满足就在服务启动前停下。公证按独立cfb规格准备而不占本页执行槽，不由此授予其真实Grant或迁移。新本地代码/文档提交不自动追加远端push；备份远端保持原固定0b90e9c3。
