# CSV／CL真实验收准备与下一次只读资格单

状态：2026-10-20离线准备；**本页不是运行许可**。原独立Reviewer已确认固定资格包v5的Spec／Quality均C/I/M0，可提交一次明确的只读资格批准。固定检查随后按另批许可完成，结果Missing见末节；不追加盘点，核心用例和边界数据分开处理，后续完整运行未获批准。公证及其他新功能不在本片，旧耗尽额度不恢复。

## 已固定的候选与离线证据

- 唯一未来执行者：原“验收独立环境快捷操作”任务。原ca015保持clean `f6e3a82f4455b38a63c6037250262bb14514752f`／tree `a65851c3b800586b09cf127304e32c2616c87edf`，不在运行中checkout。
- R2保持project `dev-cor-ui003-r2`、CID `45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236`、`127.0.0.1:15438/dev_cor_test`、原卷 `dev-cor-ui003-r2-pgdata`及锁定PostgreSQL17.11镜像。身份变化、容器退出、其他Owner占槽即停，不自动start／换库。
- CL原六文件候选是`b0d3bbfb48a9e03c1fac95750a45aa6a8ead83b9`。原后台作者后续补整次preflight、正常服务后登录及页面接线，原UI作者只新增页面步骤。最终固定提交为`aa0e33d76ed4b482687783c1b34eef46c03cfa90`／tree`7966e1b9da97cee7e9db5d6469a39f83689c83cd`，原Reviewer累计Spec／Quality均ACCEPTED、C/I/M0；见[专项准备记录](2026-10-19-case-list-query-preferences-validation.md)；批准pin仍null，未接ca015／main、未push。页面raw `bf01cccb76f132e286f301e50e0b0fe7946bf91ca1423e00df5605094c83ddd6`。原15项与最终18项纯检查分开记录，不相加冒称同轮执行。
- CL本树实际正常`pnpm build:prepared`通过；之后仅test／helper／config变化，874份backend/dist仍逐字节匹配。最新构建清单SHA `378dd94488e0e4bd579d8e93d1f25216765095f508b3b758a5d9ca7e5d0671c6`，执行输入摘要`aa1764187beb28068c5e245d0390665bd5807ea153dc9f21fc2933d6bc56bf50`；不是最后测试修复后重跑构建，也不是完整verify通过。
- CSV原目录`lead-csv-import-batch`已保全原分支并对齐既有clean `9c04e68aecfcc94afd085b6e92e5b8d14a9116e5`／tree `62a668d627de7463012995f2ec390526074ac390`；166份迁移及4份专项raw均匹配，没有新实现／提交／测试／环境变化。`d3b7e3a`只是更早文档收口。用户人工发现1文件1项exit0已完成，Agent原拒绝保留，不再发现。
- public当前165份成功迁移及唯一精确resolved旧失败。CSV166 raw `e1afd0956aaea74d2d22dd263e7a0baec77a91552877f1e9b0f434dbb6d7518d`、CL167 raw `3305ed329c57eb4a2de8447344d181b5ebaf1757011e3a279f82100428547880`，完整167原字节清单`84ad56216263873f9e71bf10e3f20c4827ecbcd6df91f6ed6beb48b09a5a82e1`；公证独立166不混入。

## 下一次需要批准的唯一具体操作

原ca015加载`Use-ProjectRuntime.ps1`并核Node24.21.0／pnpm11.27.0后，仅运行：

```text
node .local/manual-test/acceptance-run-plan-20261020/qualification-wrapper-v5.mjs --run-readonly-qualification
```

参数不是批准。固定普通证据均在ca015 `.local/manual-test/acceptance-run-plan-20261020/`：

| 文件                                   | SHA256                                                             |
| -------------------------------------- | ------------------------------------------------------------------ |
| `qualification-final-manifest-v5.json` | `8299aa8c25d799c8c5b18022b2d04a4a191dcbc54c520e297da40fa49d6b783b` |
| `qualification-readonly-v5.md`         | `0cc9cb5b5f9df7a66b61c187d3fda395abbc0f8e7a25fb7f7dcf22482c4d8cfd` |
| `qualification-readonly-v5.sql`        | `1169b7c59a591bc5257cfc13a0a4b8624b331ab42278c0da873d5924ee33978b` |
| `qualification-wrapper-v5.mjs`         | `7c8a4933821083988627c2234a88b809c721d22182835923f36f4c5611d91781` |
| `qualification-search-term-v4.mjs`     | `bbccdf1a7cec8c5281c7e5e0fcfd92632f4e7b98e8eb5f5094b788c5036d638e` |

仅一次正常capture、一把标准锁、一个REPEATABLE READ READ ONLY连接／事务；整体600秒、每句5秒。事务控制只有BEGIN／COMMIT及错误时ROLLBACK；连接只读／超时参数不增加业务SELECT。**最多11条固定SELECT S01–S11，无备用查询**；字段／参数／逐项SHA／行上限均已冻结，数据不足可少发，不补查。

| SELECT | 精确用途与返回上限                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| S01    | 1行：DB／schema／只读与隔离、T0及D=T0+15min、Shanghai日期、standby                                                                |
| S02    | 165成功及唯一旧resolved失败的完整固定账本；167行哨兵拒额外历史，不返回logs正文                                                    |
| S03    | 原H42准确user／department／role、有效成员和assignment、84条原Grant、role／authrev2及credential存在性；不读口令、digest或session行 |
| S04    | 至多20个同部门有效INTERNAL、有credential且无任何有效case.read的候选ID／资格；有credential不等于已有获准登录引用                   |
| S05    | 当前DB角色CREATE、public owner／ACL及default ACL元数据；不做DDL或改权限                                                           |
| S06    | 偏好relation存在性和未来H42／department／all复合键前提；165不应已有新表，不查询不存在的表                                         |
| S07    | 固定部门最多200案的数量及五文本字段资格、字面字符、同名rightsHolderName；只有合法trim后长度≤200的term进入下一句                   |
| S08    | 原Q01–Q17及页面三组预期，至多20组／400个ID；初页20、第二页1–20且跨页无重复，详情锚在同名过滤ASC第二页                             |
| S09    | E／P／L／D四清理分支在T0和D的8组摘要，各至多20个ID；非零立即停，不expire／purge                                                   |
| S10    | 调度资格保守超集计数及至多20个ID；非零记Missing并停，不调度或改日期                                                               |
| S11    | 仅冻结96登记CV的ID／status／size／SHA／storage_key，97行哨兵拒漂移；匹配旧proof后只生成路径计划，**不读物理bytes／copy**          |

term正文及storage_key仅留ignored本地fixture／路径计划，不入聊天或正式文档。不读私密凭据载荷、token／cookie／digest。缺项记Missing，不建账号／Grant／Case／Lead／偏好或假成功回执。首异常、超时、漂移或后台候选非零即停，关闭自身连接并释放自身锁，不循环、kill、归档别人的锁或自动恢复。原H42单会话差异原因未知继续保留，不新查其行。

v5 SQL与v4原字节相同。原粗禁词检查误判COPY注释和S05合法`'CREATE'`字符串；修复为11条精确SHA白名单加局部词法检查，区分代码、字符串、标识符、注释，DB只读事务保持。实际纯检查11/11真实SQL、17正例、21写入／多语句等负例、22逐条篡改拒绝、8长度边界及node语法均通过；不是PG语法或现场资格证明。原Reviewer固定hash两轴0，原失败保留。

## 资格之后的顺序与尚未批准的影响

以下是后续批准材料，**不随本次只读启用**。T0+15min不能跨verify／构建与长阶段；业务服务启动前还须另给精确有限fresh后台核验。

| 顺序 | 动作                                      | 范围及停止点                                                                                                                                                                                                                 |
| ---- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 核资格与固定阶段收据                      | 两个合法既有账号／获准凭据引用、真实query／page期望、偏好空键和文件清单齐备后再申请；不足Missing                                                                                                                             |
| 2    | 本树环境／材料准备                        | PRIVATE_FILE_ROOT为本树`.local/private-files/test`，不借别树dist。CSV DB-only无需材料；CL仅拟copy登记96文件52,436,764bytes，原377和281孤立文件不动。missing-only COPYFILE_EXCL、双端SHA／size／无reparse／冲突停仍须实际批准 |
| 3    | 稳定CL正常`pnpm verify`一次               | 含NT006真实owned DDL／fixture／自身清理；不能skip后称全过。准确对象／限定故障按NT006原代码冻结，不授全库清理权                                                                                                               |
| 4    | CSV原strict166唯一迁移风险spec            | 受保护入口workers1／retries0，人工发现不重做；public165，empty／upgrade／fault三个新owned schema，每场2min／总6min，保留schema与upgrade17行；仅预定fault原字节retry一次，无额外DROP／public写                                |
| 5    | CL唯一owned迁移spec                       | 原配置拒`--list`；两新schema，空167及166→167各177发送，共354／PGcap400；手工部门／用户／成员各2及偏好1，与原目录数据分列；保留不DROP                                                                                         |
| 6    | 正常官方`pnpm db:test:migrate:deploy`一次 | 风险专项与保持核通过后才165→167，仅CSV166和CL167；失败不retry／resolve／改SQL／自动回滚，owned不代官方证明                                                                                                                   |
| 7    | 正常managed服务及唯一runtime              | 服务后两次登录、原33API及同一primary内存会话页面；程序APIcap58见下节。仅一个合法偏好PUT，无业务办理／真实CSV导入／新权限                                                                                                     |
| 8    | 保持核及退出                              | 保存实际变化／未知结果，保留测试事实和原材料；仅关本次服务／连接／锁，不自动登出／撤销session或清理schema／文件／数据                                                                                                        |

CL pin仍null；未来owned／runtime分别需要真实批准收据、完整执行摘要、原官方resolve证据、自有构建清单和12分钟阶段期限，只改唯一pin形成固定提交，收据不可互换。本轮不激活pin或造成功收据。

## 后续API、页面与认证边界

- **程序业务/API最多58次**：登录2＋原33（案件GET17、偏好GET3／PUT5、身份GET8）＋页面至多23。两个APIContext及逐request均`maxRedirects:0`，3xx不自动跟随、非预期状态停；不是全网络／全数据库cap。
- 页面GET20／21：案件8、external-entry-options8、all偏好2、详情1、精确CASE材料1及可选来源Lead1；初次导航／刷新另各auth/session1，总22／23。覆盖查询清除、分页、同名过滤排序、详情往返、偏好显示／刷新；不以未过滤Q15代同名过滤。页面所有非GET拒绝，不借片验证按钮保存／取消／重置或Drawer命令；合法偏好保存由此前API一次PUT完成。
- 两次成功登录最多新增2session；现有正常成功路径还会删除两个规范化username的USERNAME throttle键，最多2键，SOURCE不删。失败可能维护该username／source的计数、窗口和blockedUntil，首失败停不再试口令。认证请求可维护新两session的lastUsedAt和stored authorizationRevision；不能称所有旧安全行无写。无logout／revokedAt变化。
- 双webServer各30秒、reuseExistingServer=false、绝对cwd。锁定PW1.63正常无重定向路径backend健康至多34、前端root／404fallback至多68，共102；backend相应至多34个DatabaseService.ping。底层健康HTTP重定向没有硬总cap，102不是无条件全网络上限，非预期重定向停、不改共享PW。静态资源／有限导航另列。
- preflight在标准锁内整个run仅一次、至多7条直接只读PG；配置／worker不各重给7。API内部ORM、健康ping、官方迁移及保持核另有用途，不冒充在7条内。

## 2026-10-20 只读资格实查：Missing，不阻塞无关业务

用户04:51:17 UTC明确批准原固定v5（Sentinel_485a59d3a3ec81918ea1b2514dcbadae）。原Runner04:54:03.626–04:54:06.581 UTC实际一次完成，wrapper exit2、QUALIFICATION_MISSING，无SQL异常；实发10 SELECT，S08因预定数据条件不足跳过。一次capture／标准锁／RR READ ONLY事务；read_only=on、repeatable read，事务结束、自有锁与连接释放。登录／服务／业务写入／迁移／权限／材料bytes读取或copy均0。

满足：原R2／165成功及唯一resolved历史账本、H42 active／84原Grant／role与authrev2及原assignment、96登记CV元数据和路径hash均匹配；本次T0至T0+15min清理／调度候选0。这只证明该观察窗，不自动覆盖未来服务启动。原H42旧会话差异原因未知仍保留。

缺项只有两组：3个现存forbidden候选没有已批准可用凭据引用；部门23案（mine3）court_case_no全部null，字面%、_、反斜杠匹配均0，dataReady=false，未生成S08完整query／page期望。不能把S08跳过写成查询失败或核心列表不可用，也不因此阻塞公证等无关模块。停止后不补查空字段、不更改留存案或造账号／Grant；核心用例与边界用例应分开安排，后者可在独立合成测试环境补齐，再单独批准必要资源／写入。

证据位于原ca015 `.local/manual-test/acceptance-run-plan-20261020/qualification-runs/2026-10-20T045403624Z-d1c54985-61da-4944-ac00-66e69e436f66/`。summary SHA256 `8b09db001c96a3213c93426b0109408cfd35ed71f10d55def148d36432a21687`，manifest SHA256 `939d6506aae086a1826d34fb74987a4cfbeb8fbdca88ae094c9e314439df9245`；主控仅本地回读14项artifact的bytes／SHA均相符，没有额外查询。许可已用毕，不自动重跑或进入CL真实验收。

下一步仅整理可先验的核心功能与隔离合成数据最小方案，不再增加资格盘点／框架。特殊字符和法院号正样本可后置，不能通过改旧案／补权限让全套gate勉强通过；未批准任何新凭据、资源或写库。原公证并行离线集成派发未送达（AbsolutePathBuf路由错误），独立业务准备已核既有计数／结算／证物不重做，受权清单导出需先明确权限、字段及快照上限。

## 2026-10-20 新15439环境结果与批量不取证归档后续申请草案

本节与上文R2资格／CSV166／CL167执行单分开。用户随后批准固定7bef339f新建隔离169库；原Runner已经完成，不能再按“准备”重复执行。本节后续业务预算仍未获批准，不恢复旧耗尽额度。

新目标为project `dev-cor-csv-export-acceptance`，CID `d9a68d83abb972297d6af23a00a3e491c3b402fb3cd684c38e1a25f9f090e446`，`127.0.0.1:15439/dev_cor_test`，独占卷 `dev-cor-csv-export-acceptance-pgdata`，锁定PostgreSQL17.11。固定acceptance目录仍为7bef339f／treef040f723，未接入本批新170。一次正常官方`pnpm db:test:migrate:deploy`退出0，169份名称／checksum／finished全部匹配、rollback0；容器healthy并保留。业务账号／凭据／角色／Grant／session及业务事实均0；Postgres初始化的DB连接角色不等于业务账号。未连接或复制R2数据，没有启动应用服务、登录、测试或真实导出／归档。

普通证据在acceptance树`.local/csv-export-acceptance-169-20261020/continuation/`，summary SHA `1c3e2d676e2ec8803525c5c7dcfe96987b1bd57186e78f99f4065ee3bd153f04`、47份普通artifact manifest SHA `e85873f6a03c67ce06fe3df42c6ac4770427b5ca1cce7329a11ddb869853aa7b`。主控已逐份回读bytes／SHA，未为收口再发Docker／PG请求。初次context在安装前因依赖准备顺序停止的记录保留；一次正常离线安装后才续办，真正deploy仅1次。Runner模型参数请求6.1-sol，durable实际模型不可核实；不以参数冒称实际模型。两作者及独立Reviewer的宿主turn_context则已核gpt-6.1-sol。

### 下一次最小真实纵向范围（未批准、未执行）

仅建议先验证CORE-LD-008，不把案件导出、公证或旧CSV真实验收拼入。需由原Runner结合最终源码／脚本，固定对象manifest、Action、上传bytes、每条payload／原key和请求上限，再提交独立运行申请；本页数值是可审阅草案，不是可执行准入。

| 项目       | 建议最小范围与必须披露的影响                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据库     | 对已保留的新15439库另批一次169→170官方部署；169额度已消耗，不重建空库。170空链／保留升级、真实回滚／锁／触发器风险仍缺PG证据；如需owned专项或完整verify中的NT006，另列DDL／fixture／清理范围，不能夹在纯测试中执行。                                                                                                                                                                                             |
| 新身份     | 1部门、3个合成业务身份：INTERNAL主操作员、INTERNAL只读反例、绑定唯一合成客户的CLIENT；仅创建其必需credential／membership／assignment。2个内部角色，拟共7条DEPARTMENT Grant。不存在可直接登录的新库旧账号，不借R2账号或旧口令。                                                                                                                                                                                   |
| 精确Action | 主角色6项：`customer.read`、`customer.admit`、`lead.read`、`lead.create`、`lead.push`、`lead.evidence.decide`；只读角色仅`lead.read`。CLIENT仅正常客户主体绑定。此有限身份fixture本身须批准；若改走正常账号管理API，则先核额外`user.manage`需求，不自动加权。                                                                                                                                                    |
| 合成源     | 明确拟用有限fixture仅INSERT：1个DRAFT客户及1联系人、1权利主体／关联，逐项ID和字段列入待批准manifest；不通过未预算的客户创建／编辑API，不授customer.create-draft或customer.edit-routine。1份≤1KiB固定合成CUSTOMER_IDENTITY PDF，未来先钉bytes／SHA。通过真实客户admission，不SQL伪造ADMITTED。2条新Lead、各1商品、截图数组为空；正常批推后由CLIENT对两条分别真实INFRINGEMENT审核，不SQL伪造审核、归档或成功回执。 |
| 准备请求   | 上传draft POST＋content PUT共2次；客户admission POST1、Lead create POST2、batch-push POST1、client review POST2，共6次源业务POST。准确route与payload须以最终正常Controller／DTO和冻结脚本复核。                                                                                                                                                                                                                  |
| 核心归档   | 拟4次batch POST：混入一个旧version的整批拒绝；页面正确提交；同原body／key显式核实（可在首成功后丢响应）；只读身份直接程序POST403，核服务器零写；页面fresh capability会提前阻止新提交，不把它冒作页面已发403，也不借主操作员pending或预置客户端恢复记录。分别核零部分写、两项真实事实／审计／typed回执／批次回执、重复请求零新增和原列表状态。                                                                    |
| 登录与读取 | 拟至多3次正常登录／3次退出；披露新session及正常节流维护。程序GET拟上限30，必须由最终页面步骤核实后冻结。草案业务POST10＋上传2＋认证6＋GET30＝48次程序HTTP；静态资源及正常受管health检查另行列项，不能冒称纳入48或无限放行。                                                                                                                                                                                      |
| 服务与保持 | 最终匹配源码正常生成／构建；仅获批时由protected入口启动3101／5174，冲突就停，不换端口或关人工服务。启动前有限核后台清理／调度资格；原R2、ca015、H42、旧事实／文件全部不动。保留本批新事实，不reset、回滚成功业务、删文件或恢复撤权。                                                                                                                                                                             |

20／21上限、跨部门、真实并发／故障回滚、动态撤权等其余边界单列后续缺口，纯测试不冒PG证明。案件CSV导出的CASE_EXPORT、新公证Action与所需合法源不在上述7Grant或48请求内；要真实验证时另批有限切片。本草案未创建任何身份、权限或源事实，也未启动服务、登录、上传或测试。

## 2026-10-20 LD008最小核心验收固定提案（待用户一次确认）

本节取代上一节的3身份／48请求草案；只准备提案与本地合成材料，**尚未获准执行**。目标是一次真正的“两条线索整批不取证归档＋原键复核”，不加入额外反例、公证、CSV导出、旧R2或其他模块验收。不需要用户提供任何真实个人资料、既有业务账号或口令；唯一需要用户补充的是是否批准本节完整范围。

### 固定候选与隔离目标

- 固定业务代码 `c92ad7ae347417548fa282131001f8d2ace16066`／tree `5254bb354916978193fe86185db79e64054fed3b`，19源已累计独立复审0；本提案新增内容仅文档／本地材料，不改变代码。
- 原acceptance目录当前仍7bef339f；获准后仅将其正常更新到上述固定候选，复用既有锁定依赖和环境，正常Prisma生成／prepared双构建；不复用别树dist，不运行完整verify／NT006或新owned风险工程。
- 唯一目标 `dev-cor-csv-export-acceptance`／CID `d9a68d83abb972297d6af23a00a3e491c3b402fb3cd684c38e1a25f9f090e446`／`127.0.0.1:15439/dev_cor_test`／卷 `dev-cor-csv-export-acceptance-pgdata`。镜像、CID、端口、卷、169账本及空业务基线须现场匹配；退出／不健康／端口或锁冲突就停，不自动启动数据库、另建库、换端口或动R2。
- 正常官方`pnpm db:test:migrate:deploy`仅1次，169→170。170为`20261020100000_lead_no_evidence_batch`，raw SHA `27dddb50de8dbeb164fbfc0f0d4b30ac4fdf0e4b25f666ba8206abc7bff531bd`；仅新增专用批次回执表、唯一键／外键、不可变与事实／逐项typed回执／audit一致性守卫。原169字节不变，不手工改账本、不重跑169；失败或结果不明即停，不resolve／retry／改SQL。
- 本提案直接在无业务历史的新169库验证该增量和核心流程；不冒称覆盖170全新空链、带历史升级、故障注入／并发或完整正式门禁。

### 身份和主数据：最多18行有限fixture，分两次事务

本地固定对象manifest为`.local/lead-no-evidence-batch/minimal-core-proposal/fixture-and-material-manifest.json`，runId `9e3e6ad9-746a-4985-8bc6-642d2762e7d7`；该manifest raw SHA 8daa58104a30db09d65b2ac307959c1c9a5d2f5108ffa31c1ff5ed68949b5a13；全部UUID／名称／动作及材料hash已在其中列明，只有API返回的Lead／CV／回执ID在运行时按本批来源登记。不使用“发现其他可用身份”的备用方案。

| 有限fixture关系                              | 最多新行 | 创建时点与限制                                                                                                   |
| -------------------------------------------- | -------: | ---------------------------------------------------------------------------------------------------------------- |
| departments                                  |        1 | 唯一合成部门，不建team                                                                                           |
| user_accounts                                |        2 | 1 INTERNAL主操作员、1 CLIENT；active，authorizationRevision=1                                                    |
| local_credentials                            |        2 | 每身份1条；批准后才在内存生成两个新合成口令，调用现有password helper；仅用户Temp私密交接，不输出／提交口令或hash |
| department_memberships                       |        1 | 仅主操作员，teamId=null                                                                                          |
| role_templates／role_assignments             |     1＋1 | 唯一主操作角色及其INTERNAL绑定，version=1，不给CLIENT内部角色                                                    |
| role_grants                                  |        6 | 精确DEPARTMENT：customer.read、customer.admit、lead.read、lead.create、lead.push、lead.evidence.decide           |
| customers                                    |        1 | 合成DRAFT、version1、主操作员负责；不预置准入身份、冻结快照、联系人兼容投影或ADMITTED                            |
| rights_holders／customer_rights_holder_links |     1＋1 | 合成主体及同部门／同客户唯一关联                                                                                 |
| customer_account_bindings                    |        1 | 仅真实admission成功后，绑定本批CLIENT到本批唯一客户                                                              |

启动应用前第一次事务仅INSERT其中15行（不含CLIENT的user／credential／binding）；真实客户准入后，第二次事务仅INSERT后3行。合计最多18，不upsert、不UPDATE／DELETE任何既有身份或Grant，不生成虚假业务audit。CLIENT无需user.manage或其他管理权限，本有限fixture创建本身纳入本次申请。任何已占用UUID／用户名或额外既有业务数据均停止，不换对象重建。

客户类型用OTHER_ORGANIZATION，证件类型ORGANIZATION_REGISTRATION_CERTIFICATE，号码仅`SYNTHETIC-LD008-<runId>`，有效期NOT_STATED；联系人名为合成值，邮箱`ld008-contact@example.invalid`，不使用真实电话。联系人不直接fixture插入，由真实admission首次创建：最多1 customer_contact及1初次contact_version，并正常建立兼容投影／冻结快照。

### 已固定的唯一文件与合法业务来源

纯合成PDF已在本地生成：`.local/lead-no-evidence-batch/minimal-core-proposal/synthetic-customer-identity.pdf`，**684bytes**，1页，SHA256 `ad7a4f6a311d0f909da88e023094068f6e881e0c9506de11101758c1d8e1a74b`。页面只含“SYNTHETIC TEST ONLY”“NOT VALID FOR IDENTIFICATION”等ASCII测试字样，无真人资料、签章、JavaScript或外部资源。已固定PDF1.4原字节，不是实际身份证明，也未上传。

合法源仅按正常API形成：

1. INTERNAL一次正常登录。以CUSTOMER／本客户ID、CUSTOMER_IDENTITY／IDENTITY_FULL、application/pdf创建一个upload-draft，再PUT上述684bytes；最多1 draft／material／CV和1物理文件。
2. POST本客户admission一次：expectedVersion1、上述合成组织身份、联系人姓名／邮箱、唯一真实返回CV；不传admissionContactId，由正式服务创建首联系人。成功客户version2／ADMITTED，最多1 admission_receipt及正式引用／audit。
3. 插入前述CLIENT三行fixture，再由CLIENT正常登录；两次POST /leads，各建1条、各1商品。caseType=CIVIL、infringementTypes=[TRADEMARK]、source=ONLINE、platform=OTHER、foundAt=本阶段开始ISO时间；两合成店铺；每商品quantity1／unitPrice1.00／commentCount0，无外部URL、截图或真实商户资料。
4. INTERNAL一次POST /leads/batch-push提交这两条version1；CLIENT分别一次POST /client/leads/:id/reviews，expectedVersion2、result=INFRINGEMENT且无reason。得到两条真实WAITING_EVIDENCE_DECISION／version3源，不直接SQL造审核、推进、归档、成功回执或Case。

正常API派生的商品快照、审核、audit、typed回执／批推回执与编号计数，仅限这两条Lead及本客户；正常编号计数至多涉及两个Shanghai业务日期键、合计递增2（覆盖跨日边界），不手工修改。禁止增加第三条线索、文件、公证、费用或Case。

### 核心页面与有限HTTP：最多44次

原Runner复用既有protected入口、正常CSRF／session和预算记录方式，不新增通用执行器；workers1、retries0、程序请求不自动跟随redirect。两个身份只各登录一次，各持自己的内存cookie；主操作员页面复用本轮自己的已认证上下文，不读旧storageState。只打开一次正常线索列表 http://127.0.0.1:5174/leads?page=1，选择上述两条，逐项fresh详情／能力后填写两条固定合成原因（原字符串含首尾空格）；取消一次应零command，再重新打开确认整体后果并真正保存。两次打开均仍绑定同两条及当前版本，不换对象。

| 程序请求类别           | 上限 | 精确用途                                                                                                                                                                   |
| ---------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 源业务POST             |    6 | customer admission1、Lead create2、batch-push1、CLIENT reviews2                                                                                                            |
| batch-no-evidence POST |    2 | 页面原请求一次201；随后同一INTERNAL在内存会话中以捕获的完整原body／Idempotency-Key程序重放一次201，结果逐字段一致且零新增事实                                              |
| 上传                   |    2 | upload-drafts POST1（201）＋原content PUT1（200），唯一684bytes PDF                                                                                                        |
| 登录／退出             |    4 | 两身份各POST login1／logout1；最多2个新session，正常退出及既有节流键维护如实记录，不另行删除session或清理节流表                                                            |
| 普通业务GET            |   30 | 本批auth/session、Lead列表／form-context／精确两条详情、CLIENT两条读取及客户本对象的必要读取；含主布局正常导航／计数能力探测和归档后列表回读，不再全页reload或巡游其它模块 |
| 合计                   |   44 | 8业务POST＋2上传＋4认证＋30GET；其中业务新增成功写主要为6源命令和1归档命令，第二归档请求只能重放，不新增归档事实                                                           |

主布局对未授权组织管理／律师／公证／案件／证物等入口的正常GET探测可返回403，作为已知隐藏能力结果记录，不补Grant；结算／日历允许正常空能力／空计数响应或其现有授权403；只限主布局初始化探测。这些属于30 GET内，不主动访问相关业务页面。核心路径任一403、500、契约不符、超额或redirect均为异常立即停。2次batch请求不制造丢响应／unknown；网络未知时保留原body/key并停，不消费第二次额度作盲目重试。

成功判定为：两条均ARCHIVED／version4，原客户INFRINGEMENT审核保持；新增恰2个不取证决定、2份原typed evidence_decide回执和1份批次回执及对应真实audit，原因等于原输入trim，页面显示真实成功后以原筛选分页回读；第二同键结果与首次逐字段一致，前述计数／版本／历史完全不再变化。任一步未成立就FAIL，不把HTTP201当整条通过。拒绝旧版本、只读403、20／21上限、跨部门／撤权／并发等额外反例本次全部后移。

### 普通只读保持核、服务期限与结束方式

- 只用原Runner既有capture／锁及普通REPEATABLE READ READ ONLY快照；最多4个阶段快照、每阶段至多32 SELECT，合计128，每句5秒、每阶段2分钟。这里限制独立验收SQL，不把正常Prisma／HTTP内部SQL冒充额外手工额度。
- S0部署前核固定CID／URL／schema／169全ledger及无额外失败／未完行、空业务基线、无清理／调度候选；S1在170＋首15 fixture后核170精确名称／checksum／完成状态及18行计划中的当前15行、旧ledger不变；S2在真实源准备和CLIENT三行fixture后核18行归属／6Grant、两Lead v3、真实客户审核和唯一材料；S3在两POST及正常退出后核前述终态／零重复／身份权限保持、684bytes实文件SHA／size、正常session维护、无意外候选／owned schema。
- 只读关系限账本／本批安全身份和本批客户／联系人／主体关联、两条Lead及其商品／审核／决定／receipt／audit、单文件draft／material／CV／reference、正常auth_sessions／节流及至多两个日期编号键；不读取密码／token／cookie明文，不扫描R2、全磁盘或私密备份。不造一套全库验收工程。
- 固定应用后端3101、前端5174，仅loopback；端口占用就停，不停止人工服务或更换端口。启动前准备（代码／正常生成构建／单次170／首fixture及核验）最多15分钟。**从启动第一个应用进程到两服务、页面／API上下文与本批检查连接全部结束最多30分钟**，包含登录、业务、退出、S2／S3和正常health等待；整个业务执行最多45分钟。到期终止自身运行、保存结果，不延长、不增加重试。
- 静态JS／CSS／页面、favicon以及既有managed health检查只限本次两个loopback服务、同一30分钟生命周期、一次线索页面核心流程；不为每个静态资源新建计数器，不加载外部站点或开展额外页面。现有test env／PRIVATE_FILE_ROOT保持本acceptance目录，不复制R2材料／口令／登录态。
- 保留新库／卷、18行fixture、全部真实业务、正常认证维护及唯一文件；不reset、DROP、回滚成功业务、删文件、撤销／恢复Grant。结束仅正常logout与关闭自身服务／连接／锁；原始含凭据的trace／响应仅用户Temp私密目录，普通报告只脱敏字段及路径／SHA。异常／不确定写入时立即停并保留，不自动重做、补角色、换key或造备用数据；必要的正常退出／关闭属于结束额度，不能继续业务。
- 本提案不含新数据库start、owned DDL、故障注入、完整verify／NT006、导出、公证、生产／预览、push或应用发布；唯一待批测试迁移仅为上文169→170。没有必须由用户另给的个人信息／凭据／业务规则；只待对本完整最小范围的新批准。
