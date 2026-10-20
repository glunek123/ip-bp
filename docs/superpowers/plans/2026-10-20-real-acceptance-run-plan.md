# CSV／CL真实验收准备与下一次只读资格单

状态：2026-10-20离线准备；**本页不是运行许可**。原独立Reviewer已确认固定资格包v5的Spec／Quality均C/I/M0，可提交一次明确的只读资格批准。真实账号、数据和后台资格尚未查询，后续完整运行仍不能直接GO。公证及其他新功能不在本片，旧耗尽额度不恢复。

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

## 给用户的一次具体确认及原窗口提示

当前只可提出以下批准：

> 允许原“验收独立环境快捷操作”任务在原ca015和精确R2执行已审v5只读资格包一次：一capture／一标准锁／一个RR READ ONLY事务，最多11条固定SELECT、每句5秒／整体10分钟，仅核账本、已有身份及数据资格、后台候选和96CV元数据。缺项或首异常停；不登录、起服务、测试、迁移、写库、改权限或复制文件；只保存本地脱敏证据及资格／路径计划。固定manifest SHA为8299aa8c25d799c8c5b18022b2d04a4a191dcbc54c520e297da40fa49d6b783b。

用户尚未给此批准，不派发执行。获批后原窗口只允许固定wrapper，不扩至后续阶段。完成后根据真实Missing给下一份具体运行确认，不逐项试探、补造fixture、读新凭据或恢复旧额度。原Review、v1–v4失败、会话历史差异及各时点证据保留；已执行只读边界见[阻塞交接](2026-10-20-acceptance-blockers.md)。
