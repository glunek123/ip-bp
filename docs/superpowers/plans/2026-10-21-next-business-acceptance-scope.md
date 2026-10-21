# CG／EF 两案最小真实验收批准范围（待用户批准）

## 已有证据与目标

完整工程门禁仅绑定741a4b0e／treefc962826：5656项与双构建通过，不重复verify。b4eeee7c／tree756e6fc9只读资格核验正常完成7条SELECT，public170，案件／外部转入／EXECUTING立案均0；关联账号／PRIMARY／材料／费用未查，不能推断全库不存在。16份普通证据hash已核。以下直接申请合成来源，不重复盘点、复用H42／旧额度或扩大R2权限。

唯一原Runner、同一已审源码组合；执行前固定实际HEAD／tree和对象／原请求manifest。仅既有project dev-cor-csv-export-acceptance、127.0.0.1:15439/dev_cor_test、CID d9a68d83abb972297d6af23a00a3e491c3b402fb3cd684c38e1a25f9f090e446、卷dev-cor-csv-export-acceptance-pgdata、原锁定PostgreSQL17.11。原本树测试私密文件根不改；不操作R2／生产／演示，不新增环境密钥或长期凭据。

本单取**一个组G：建立一次、同键重放一次、解除一次、同键重放一次**，删除前端提案的第二组G2；文件取较小的每份1KiB上限。后端56次API提案与前端189次提案不叠跑，统一成下述188次页面＋必要同源API预算。

## 待批准的有序操作

1. **owned风险专项**：仅cg_core_empty_<16hex>、cg_core_upgrade_<16hex>两schema，后缀开始时各生成一次并登记，search_path仅自身、无public回退。empty原172文件各执行一次；upgrade先原1～170、6行合成旧元数据（部门／INTERNAL用户／成员／ADMITTED客户／主体／关联各1）、171一次。upgrade内创建确切冲突表case_handling_group_receipts(probe integer)，172预期42P07后ROLLBACK，核6旧行／Case0不变、无半建表和cases约束、171枚举保留；只删该冲突表后原172字节重试一次。总计345次迁移文件调用，不冒充345条SQL语句。
2. 同upgrade只做3个绕DTO负例：ACTIVE／revision2、ACTIVE1无成员提交、成员引用未创建Case，分别预期23514／deferred23514／23503并回滚。不SQL造Case／历史，不声称完整并发或旧Case升级证明。成功后仅回收登记的两schema；清理前核public摘要／跨schema依赖，不能证明只影响自有对象时保留现场，不按prefix或无条件CASCADE删除。
3. 专项通过后，按现有capture／标准锁与run-test-migration.mjs调用方式，**一次正常官方Prisma migrate deploy**，只应用20261020110000_add_case_handling_group_actions（171）及20261020110100_case_handling_groups（172）。旧170账本／原行保持；不重入锁、resolve、reset、换URL或自动再跑。
4. 部署独立核验通过后，一个受控事务只新增下述25行fixture，再以两个正常合成会话完成两案、CG及内部补交页面。
5. 收尾只撤销本轮至多2个精确session、停用2个新用户并令authorization_revision＋1；保留记录、文件和Grant，关闭本轮服务／连接／锁。旧账号／凭据／权限零改，不恢复撤权。

171 raw SHA256：a1508d4b35930bcdae6532153ff746a387fc43750349ec41499916123570a9f2；172：c4454079aee5d4d6afa4412acf19cdacebb7176cb39a2072f450c621dd061645。owned≤10分钟、官方部署≤5分钟、业务≤20分钟、收尾≤5分钟。执行器／helper先按本范围固定复核，未就绪不能发GO；本单不是未经审核脚本的运行授权。任一非计划内错误／超时停止下一阶段，保留实际状态，不自动重试。

## 25行基础fixture与11条Grant

仅本轮唯一ID：部门1、INTERNAL用户2、正常hash登录凭据2、部门成员2、角色2、角色绑定2、Grant11、客户1、主体1、客户主体关联1，合计25行。不借旧身份，不SQL插Case、filing或业务历史。

客户是明确申请的合成ADMITTED初始元数据，非客户准入功能验收：NATURAL_PERSON／OTHER_VALID_ID、唯一合成身份号、NOT_STATED、admitted_at／ever_admitted及冻结联系人snapshot完整（合成name、fixture.invalid邮箱、FALLBACK_CURRENT、frozen_at）；当前联系人投影及compatibility_contact_id全null，符合既有deferred projection guard。责任人新W、同新部门D，与主体H真实关联；不添准入receipt／联系人历史／身份材料。

W的唯一主写profile共10项，**均DEPARTMENT**：customer.read、case.read、case.external-entry.create、case.execution.mail、case.execution.filing.submit、case.execution.supplement.submit、case.execution.supplement.correct、case.group.create、case.group.dissolve、fee.read。R仅case.read: DEPARTMENT。无用户／角色管理、feedback、finish、archive、费用写或其他Action；CASE_READ不扩TEAM／SELF。

口令只在内存随机生成，数据库只存正常hashPassword结果。密码／cookie／CSRF不写env、文件、普通日志、trace或Git，不导出storageState；结束丢弃明文。正常logout之外，失败也只对归属明确且已提交的本轮2用户／至多2精确session执行失效收尾；不按prefix扫旧账号。收尾连接失败即留具体残留，不声称凭据已失效，不改旧对象。记录保留，但不作为长期可登录凭据。

## 两案与真实页面范围

W用**同一浏览器会话**发两次POST /api/v1/cases/external-entries，均EXTERNAL_TRANSFER、同C／H、合成来源和各1个合成被告，known九键显式null。A初始WAITING_EXECUTION_STAMP、B初始WAITING_COMPLAINT；日期取本轮上海日，不跨日悄改原请求。

A先普通MAIL_RECEIPT的POST /materials/upload-drafts＋PUT内容，再POST /cases/A/execution-mail（expectedVersion1、expectedConfirmationId=null）；再普通EXECUTION_FILING_PROOF同型上传和POST /cases/A/execution-filing-submit（expectedVersion2、真实mailingId）。由正常返回取得A EXECUTING／version3及filing F，B保持version1，不直改stage或伪造申请根。

A详情实际预填／取消为0写入；专用POST /cases/A/execution-filings/F/supplements/S/upload-drafts分别绑定expectedRevision0／1，再原PUT内容。页面登记补交revision1、更正revision2，核current／history及原新精确文件。更正原body／key同W显式重放1次；不新增第三版、不改原Case头／mailing／filing。

CG页面建立G=[A,B]并原body／key同W重放1次；核不同stage可入组、真实列表／详情／材料、公证摘要及完整费用账。W有fee.read时空账true／empty，R无fee.read为false／null；两external来源的公证摘要应为空，不能伪造非空费用。页面解除G一次并原body／key重放1次，G DISSOLVED／revision2，原案／CV／费用身份保持。W只做一次同session整页刷新，不另登录重登。

R正常登录后可读G／材料／A补交历史，写能力false；只发3个预定403：W原建组、原解除、原EF更正body／key各一次，核当前授权先于回执、零新增。无故意丢响应／CSRF故障、额外组、换key／root／CV或自动业务重试。

基础25行之外，成功API事实预计52行，含Case2、external entry2／receipt2／被告2／trial round1、mailing及filing各1＋各receipt1、EF版本2／document2／receipt2、组1／成员2／事件2／receipt2、audit8、draft／material／CV／reference各4、session2；合计77行。当天case_number_counters只允许同一个键增量2，新增0或1行，因此新行上限78；该counter是正常API允许的旧行变化，其余旧对象保持。重放／403不增加业务事实。2成功迁移账本及owned临时对象另记，不混算。

## 单一硬预算：188 HTTP／2会话／4文件

全局GET≤160、POST≤24、PUT≤4，总≤188；已发后取消／失败／自动Shell请求均计。W主要页面GET≤98、同session刷新≤32、R≤30；health一次纳入W及全局GET，不轮询。单路由、阶段、全局上限同时生效，发送前阻断超额，余量不能换端点／对象。预算是上限，不保证恰发；不另跑56次API版本。

以下省略/api/v1，仅manifest中的A／B／G／F／S及4个material／CV；参数顺序可规范化，不能放开新filter或owner。

| GET白名单                                                                                                    |    上限 |
| ------------------------------------------------------------------------------------------------------------ | ------: |
| /auth/session（包括结束后旧cookie核401）                                                                     |       6 |
| /case-handling-groups/capability；组列表page1／pageSize20                                                    |   10；8 |
| /case-handling-groups/candidates（打开＋同客户重核，仅page1）                                                |       2 |
| /case-handling-groups/G；G/materials；G/fees（资源page1／pageSize20）                                        | 9；5；6 |
| /cases/A或B；/materials?ownerType=CASE&ownerId=A                                                             |   14；8 |
| /materials/{批准material}/versions/{批准CV}/content                                                          |      10 |
| /cases/external-entry-options                                                                                |       2 |
| /calendar/summary；/organization/management-context；/lawyer-accounts?page=1&pageSize=1；/notary-offices     |     各4 |
| /settlements/context；/evidence?page=1&pageSize=1                                                            |   12；6 |
| /leads?page=1&pageSize=1&view=LIBRARY；/notary-matters?page=1&pageSize=1；/cases?page=1&pageSize=1&view=mine |    各14 |
| /health                                                                                                      |       1 |

Shell探测其他模块可能按原权限403，不为消除探测增Grant；只容许列明探测的既定拒绝。未知GET／额外query／非预期响应仍停。摘要与ledger按钮分别读fees，隐藏文件页也可能挂载材料池，均计额。

| POST／PUT白名单                                                    |    上限 |
| ------------------------------------------------------------------ | ------: |
| POST login；POST logout（正常2＋至多2已发的通用CSRF分支重试）      |    2；4 |
| POST external-entries；A/execution-mail；A/execution-filing-submit | 2；1；1 |
| POST普通source upload-drafts；PUT其内容                            |    2；2 |
| POST case-handling-groups（W新建／重放＋R403）                     |       3 |
| POST G/dissolve（W解除／重放＋R403）                               |       3 |
| POST专用supplement upload-drafts；PUT其内容                        |    2；2 |
| POST supplements初记；POST S/corrections（W新更正／重放＋R403）    |    1；3 |

登录成功响应提供CSRF，不另造csrf GET；CG／EF及专用上传关闭自动重试。普通通用分支已发的刷新／重试也计入上限；遇CSRF_INVALID停止业务，不借预留继续。两个browser context只各登录一次；必要API均复用同context cookie，不隐含第三session。

恰4份合法合成PDF（mail、filing、补交原／新），每份≤1KiB、上传总≤4KiB；生成后、运行前固定bytes／SHA，补交原新不同。最多4draft／4material／4CV／4新blob；10次下载总≤10KiB，附件网络总≤14KiB。保留文件／记录，不软删、恢复、换版或清旧文件。只存脱敏路由／状态／requestId／body hash和文件校验，登录数据不落trace。

## 停止、保留与准确未验边界

前后核目标、完整账本、旧行摘要／序列、有限安全摘要及本轮对象／文件；不展示旧凭据或读取无关业务正文。非计划内错误、未知响应、越权、scope／revision／bytes不符、额外请求、超时／超额即停；不重试业务、补权限、重建对象、清历史或自动恢复。仅本单新账号失效、会话撤销、自有schema及本轮服务／锁／连接收尾可继续，收尾失败留证不能掩盖首失败。

本片不关闭PRIMARY／律师正向与脱敏、公证／SAMPLE非空费用及known0／pending、跨部门／TEAM全矩阵、真实锁竞争、旧Case历史升级、真正24h／流中竞争、合法非current CV、UI丢响应恢复或新会话重登。无另一个已冻结业务切片可独立增写，不扩CA019、支付、OCR或外部集成。本单待批准，以上迁移／fixture／Grant／业务／页面均未执行。

源方案：原后端minimum-runtime-plan-20261021.md SHA21cfc3ba25d2af04d69e86a6a4603dd6783acabaded42611c74fe292850daf2c；原前端同名方案SHAfff7bbd8d9fdd9a084391c4fdd547d1c38f98f8defb7e57bf4c5b8514c430185。Root只收缩为一个组、每PDF1KiB，删一条新组POST得188总额；health及结束session核验纳入已有GET上限，不叠加第二轮。
