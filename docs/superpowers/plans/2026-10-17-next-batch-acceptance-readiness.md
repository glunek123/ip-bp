# 下一批最小页面闭环与一次性确认清单

状态：静态执行方案，尚未批准新增验收。以本页替代7ab3e257中的“EF接口首项＋线索八项、11会话”申请，不先跑API块再追加页面额度。远端代码备份仍为 `0b90e9c3e28f7a1a3cf6cd195728f6a6da43cc52`，后续本地准备提交未上传。旧业务、文件及登录额度均为0。

## 1. 已核环境及开跑条件

- 本轮仅只读Docker过滤inspect：R2完整CID `45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236` 正在运行、healthy；project `dev-cor-ui003-r2`、service `postgres-test`、`127.0.0.1:15438`、卷 `dev-cor-ui003-r2-pgdata`及固定postgres17.11镜像摘要 `051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0` 匹配。普通令牌访问Docker pipe被拒后，同一过滤inspect经正式审批成功；没有启动容器、服务或读取Config.Env。
- ca015、原EF、test-runtime-stability及frontend-integration现有 `.env.test` 实际均为15433，本轮未改。未来执行单须明确允许唯一Runner正常配置一个固定运行树的R2 URL及本树private-file root，使用标准capture复核两URL/完整tuple，不借进程覆盖绕冲突校验。原文件只核字节；如本树缺文件，先列准确source/key/size/SHA/target清单，未经核准不复制或覆盖，不搬回私密归档。
- 尚未连接DB。healthy不是当前ledger/身份/业务资格证明。未来写入前，在标准锁内READ ONLY核完整source/public165及唯一精确resolved历史、全部旧PK行/安全表/Case/序列和真实文件字节，记录真实数量，不硬编码87案/92CV。Nest启动会立即并每60秒推进到期开庭，材料cleanup立即并每15分钟运行；从启动至本轮硬截止（至多15分钟，且不得跨Shanghai业务日）的旧对象推进、过期、pending清理、物理清理候选须全部为0，否则启动前停下另列影响，不自动处理或禁用后台机制。到截止先停止业务、收尾并退出服务，不延长窗口加量。
- EF resolve原三件已找到，不再resolve：`ef001-integration/.local/ef001-evidence/official-ef001-resolve/receipt.json`（853bytes，SHA256 `162c5ead547631b44a84913abc8a7068191dc2198fb58a420b3f73fa98b3ed1c`）；同目录stdout.log（172bytes，`a51491bda92c3572154b87419a96572b0052ab3a47fe4222a568eca3a3b9ddfe`）、stderr.log（961bytes，`211b3323777fed313dce76ef3c4b17609b34e69a87930c44483b90a18e6f256d`）。接入核原字节及官方proof，不能造替代成功回执。
- 原唯一Runner「验收独立环境快捷操作」`01a13e67-4068-778b-a1e9-9d808ecb50e8` 串行执行，两块各固定候选/证据目录，workers1/retries0/首个非预定失败停业务。下列额度可分别或一并批准，不相互挪用；仅明确的会话收尾和只读保护可在失败后继续。

## 2. 两个实际页面任务，不运行旧API矩阵

### EF：填写一条法院反馈，再带原因更正

仅复用原Runner已封存的activeSource：user `03620738-5f11-49f9-9279-95d51306e32e`、role `cfd6fa11-f04d-4e99-ab3c-2fccc8e22161`。原证据记录其active/v1、同部门有效membership/唯一assignment、10个DEPARTMENT Grant及受保护credential引用；没有读取私密载荷。必须live复核其中本片所需7项（case.read、customer.read、case.external-entry.create、case.execution.mail、case.execution.filing.submit、case.execution.feedback.record/correct）及全部原身份/授权行保持。复核失败就停，不恢复旧角色、补权或造新actor。本次新增身份/Grant均0，结束不撤旧source权限。

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

本节是新执行申请，不是本轮已撤销。现成EF原测试只dispose、lead full8没有该页面logout，均不直接拿来执行本方案。

## 4. 入口准备及有效证据复用

- 最小页面入口须先编写/审查，再发正式GO：EF独立page spec采用现有真实来源HTTP配方，复用上述固定旧source，不调用旧createActor；线索独立strict165/H42 page spec/helper，不调用full8 terminal prepare，也不删/绕其guard。两入口及精确session收尾先过实际函数纯反例、类型/Lint/格式、离线发现恰各1项/callback0、独立审，固定候选后执行。它们目前仅有静态设计，不能声称已实现或已运行；这部分代码准备不需要真实额度。
- 可复用：2ef6a739原业务候选正常verify139工具/2510前端/2351后端、NT006及双构建；旧EF14分段内部API、旧只读3页面、165 owned/官方部署/历史保持各只证明原范围。不重新resolve、迁移、重做原14或线索full8 API矩阵。构建复用仍逐raw核产品/依赖/生成/构建输入与原manifest，不能只凭路径未改。
- 165组合必须新验：实际source/applied ledger/tuple/合法对象；新增窄helper/fixture/logout的纯/静态/发现；固定运行tree上的上述2条真实页面、实际POST结果与GET读回/刷新历史、精确session撤销、全部旧行和文件保持。旧完整verify不冒新tree全绿；若需要完整门禁，另明确其中NT006真实DB动作，不静默开跑。
- 不覆盖：EF补交写入式UI、PRIMARY/门户、真实24h、流中争用；线索20项边界、旧版本整批拒绝、并发、未知恢复、故障回滚、terminal撤权。这些保留待验，既有API证据不替代真实页面，本次页面正向也不代替协议反例。

## 5. 公证三项最简推荐：一次决定，未实施

依据INPUT-016、[当前公证Spec](../../spec/v0.1/modules/notary.md)、[NT002单项开箱设计](../specs/2026-09-24-core-nt-002-unboxing-materials-design.md)及Demo逆向M03。字段更正/跨事项开箱方向已批准，以下资格、阶段与批次语义是新增选择。

| 决定                          | 推荐首片                                                                                                                                                                                                                                                                                                                             | 既有依据/准确影响                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 谁更正哪些资料、冻结/归档边界 | 仅获新 `notary.record.correct` Action的内部操作员，按现有DEPARTMENT/TEAM来源范围；公证处/客户首片不开放，不新增职级门槛或自动Grant。取证日/物流在原取证事实存在后的WAITING_UNBOX、UNBOX_REVIEW、ISSUANCE_DECISION、WAITING_CERTIFICATE、WAITING_RETURN可带原因追加revision；寄件须原开箱事实存在，在后四阶段可改；ARCHIVED首片只读。 | 现取证/开箱为不可变原事实，无独立更正API/版本。仅改变“当前资料”投影；原审核/决定/照片归属/冻结CV/Case及费用锚保持，物流改动不改派照片。证书编号/日期/文件另片。资格和允许阶段是本次选择，不从SD-24或普通record Action推定。                                      |
| 跨事项照片归属、可复用页面    | 内部公证事项列表现有勾选区加独立批量入口，逐事项明确matter ID/version、寄件信息及照片；未知/混包/多匹配保持未提交。首片无ZIP/单号自动分派。                                                                                                                                                                                          | 复用NotaryMatterListPage.vue的selectedIds及NotaryMatterWorkflowPanel.vue单项照片上传/选择；现没有完整跨事项归属面板。每项只WAITING_UNBOX，写时重验notary.unbox.record及来源范围；NOTARY_MATTER owner、1–50张JPG/PNG/WEBP且每张≤20MiB保持，一事项CV不挪另一事项。 |
| 逐项结果还是整批回滚          | 推荐逐项独立事务，显示成功/确定失败/未执行/未知；成功不重做。确定失败/未执行刷新事实和版本后重提；未知只按原body/key核回唯一结果，不当失败换key重试。                                                                                                                                                                                | 单项opening现有事实/引用/审计/回执的原子性可复用；批次聚合/恢复是新合同。NT010整批原子仅限WAITING_RETURN＋NO_ISSUE归档，不能套本片；Demo的ZIP逐组/队列兜底不构成正式依据。                                                                                       |

可整体采用推荐或逐项改动；冻结前不写新Command/schema/按钮/Grant。冻结后只按backend/schema/API与内部UI唯一作者分工，不建通用审批系统、不重复NT008/009/010，不混证书更正/误建删除/终止。源码及旧Owner定位保留在本机ignored notary-scope.md，不再新增路由台账。

## 6. 收口与真正阻塞

本轮只完成静态页面缩片、2个session的正常/失败收尾设计、R2容器/配置只读核对及公证最简提案，没有写库、登录、改配置或启动服务。readiness165_review独立两轴ACCEPTED、C/I/M0，表单必填与对话框显示精度finding已闭合；此审查只证明计划边界，不当页面PASS。

静态方案可以收口，正式运行不能GO：窄页面入口及固定候选尚须工程准备/审查；现有配置与R2不符；live ledger/现有两身份/客户/后台清理候选尚待只读核实；本页2session/1Case/2线索/2文件/精确session撤销尚无新额度。若现有身份失效，停止并另报，不自动切新账号/Grant。公证产品实施等上表三项决定。旧11会话和两API块撤回，不消耗其任何数据；新本地提交公开上传不在原固定备份中。
