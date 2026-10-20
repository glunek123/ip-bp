# 真实验收阻塞与后续最小范围（2026-10-20）

本页只记录实际完成、停止原因及待确认操作，不是新的运行授权。当前CL准备候选默认拒绝，真实验收仍不得复用耗尽的旧额度。原批准指令保留在Git对象 `1eb9dd20c21090337ef524b5a00fc2373f1a55f8:docs/superpowers/plans/2026-10-20-acceptance-blockers.md`，raw SHA256 `30bd16732a25db905c00de911169f6304b67a27b77d97f96ac1908ddbba20388`。

## 当前结论

原R2已恢复运行，原失效资源锁也已可恢复归档；这两个阻塞已解决。最初只读核验在一条旧auth_sessions行哈希差异处停止；另批单SELECT定位原H42会话并证当前无再漂移，随后获批的剩余结构与材料只读已PASS。原快照只有PK／整行hash，不能还原历史字段或请求因果；单行例外继续明示保留，不覆盖、回滚或重置基线，也不把不同窗口合称整体原子快照。CL数据资格、完整verify／NT006、迁移和真实页面仍未执行。

CL最新离线候选为`aa0e33d76ed4b482687783c1b34eef46c03cfa90`／tree`7966e1b9da97cee7e9db5d6469a39f83689c83cd`，parent b0d3bbfb。只提交原五准备文件修改及原UI新增页面步骤，原owned spec不动；pin仍null、clean，未接ca015／main。18/18纯检查及定向类型／静态通过，原Reviewer关闭重定向finding，累计Spec／Quality ACCEPTED C/I/M0。本树此前正常build已过，874份backend/dist仍精确匹配、未重跑；未执行完整verify／NT006、PG、HTTP、发现或页面。准确日志和范围见[专项准备记录](2026-10-19-case-list-query-preferences-validation.md#2026-10-20-六文件离线准备候选)。

## 原环境恢复及只读事实

唯一Runner是原“验收独立环境快捷操作”任务 `01a13e67-4068-778b-a1e9-9d808ecb50e8`。目标保持project `dev-cor-ui003-r2`、完整CID `45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236`、锁定PostgreSQL17.11镜像、原卷 `dev-cor-ui003-r2-pgdata`、`127.0.0.1:15438/dev_cor_test`。原ca015保持clean f6e3a82f；没有合入CL或公证源码。

| 实际步骤                               | 结果与限制                                                                                                                                                                                                                                                            | ca015既有证据及SHA256                                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次实例／服务槽只读核验               | exited／255，身份／卷／端口配置匹配，3101／5174无监听；capture和PG前停止                                                                                                                                                                                              | `.local/manual-test/r2-readonly-20261020-stopped/summary.json`，23ad115fb2c16e97c8afc8833261c7452f803807493a9d849d8998f06beeb5eb                                                          |
| 有限退出日志                           | 120行未覆盖最后退出时刻；OOMKilled=false、State.Error空，未见有限损坏标记，不证明完整或退出原因                                                                                                                                                                       | `r2-exit-diagnostic-20261020/summary.json`，95225f9db008d882ebb7f5cdf805962a0432adcb986c180415c98d7ce3d482bb；assessment 668dce1b74ca1a45adbe9ff6691a26a4c17b98aca56ffc65d38ecaa8df217d8a |
| 原窗口直接人工许可后正常start一次      | exit0、healthy，PG自身redo／checkpoint后ready；没有循环重启、修库或业务服务                                                                                                                                                                                           | `r2-approved-recovery-20261020/outcome.json`，ad0ed91936a6dc16b87ff77a1fb4538cdfcb7e0b60470e1f1d8034d13c767c29                                                                            |
| 原资源锁身份只读诊断                   | 昨日serve owner已结束，今日PID27964被Copilot复用；原backend2616／frontend41764及launcher均无。不杀进程、不绕互斥                                                                                                                                                      | `r2-lock-identity-20261020/conclusion.json`，6ea4b7259be25b99e530e4107a1711b11cab6b4de31add667156c0b9c6dbe097                                                                             |
| 原窗口直接人工许可后精确归档／正常取锁 | 原owner100字节及hash保留，唯一旧锁移到同根 `.stale-UTC-UUID`；Copilot和其它锁未动。随后RR READ ONLY快照165表5711行，164表PK／行hash一致；auth_sessions109条中同一旧行变化1、无增删；165成功迁移和唯一resolved历史失败／序列一致。首差异停止，连接关闭、本次锁正常释放 | `r2-lock-archive-readonly-20261020/outcome.json`，ef369b21200381330bad7371e5dacfcbdf791f38a7c13401c6cdaa471a596158                                                                        |

表内首项以后的证据目录均位于ca015 `.local/manual-test/`；主控读回上述摘要原hash匹配。原日志及归档保持各自私密／安全位置，未搬回开发服务根。最近一次快照是2026-10-20 02:25:05.410694 UTC，原比较快照是2026-10-19 08:50:20.112083 UTC，不将两个时点混为同一原子现场。

## 单会话差异：补查已完成，原差异仍保留

原Runner仅离线检查已保存资料，未新开PG；诊断为 `r2-session-difference-offline-20261020/diagnostic.json`，SHA256 `cf6ce5d59606756ac1485a901b9e510b856f016709c6ec890e2eb9c709d832b5`。原文件只保存pk_sha256和row_sha256，没有旧last_used_at、authorization_revision或revoked_at值；快照时间不能代替旧字段，不假定旧revoked_at=null。没有可据此归因的已保存登出／维护事件，不把变化自动说成正常或损坏。

主控只读核ca015与开发树auth.service.ts原字节相同（SHA256 a5b58b4c0915385d5c43ab9e8445359ccaf178efd98d098697c00f76e7aca060）：resolveSession会维护lastUsedAt与存储授权代次，logout另设revokedAt。这只是现有行为的依据，不证明该行实际变化原因。

用户于2026-10-20 02:40:13 UTC明确“允许”（Sentinel_6f6d397850bc8191ac002b2d714d6bd9），原Runner已完成该独立补核：仅1条SELECT、1行，识别为原H42会话，当前已过期、未撤销、授权版本与既有记录相符，整行仍匹配前次after哈希，无再次漂移。详细非秘密ID／时间只留本地ignored回执，不复制登录状态到项目文档。结果 `.local/manual-test/r2-single-session-readonly-20261020/result.json`，SHA256 `cf3999548dbfbbd62a9beabdfe77110f21cd5ba0cae8a342d002b16c9dba8a29` 已读回匹配；连接关闭、标准锁释放，未写库／调用认证服务。原对照文件没有旧字段，不能由此证明当时仅哪个字段变化或具体请求因果，原差异不改判整体PASS。

这一次已执行的批准范围仅为原已保存 `r2-session-difference-offline-20261020/future-single-session-select.sql`，不循环复用：

- 原R2一次capture、一把正常标准锁、一个只读连接／REPEATABLE READ READ ONLY事务；整体最多60秒、SQL statement timeout5秒。
- 仅一条SELECT，用已保存PK hash精确定位，参数为旧PK hash及上轮after整行hash；期望恰一行。
- 只返回session／user／department非秘密ID、授权代次、创建／到期／撤销／最后使用时间及“仍匹配上次after整行hash”的布尔值。hash在PG内部计算，不返回或复制token、cookie、token_digest、csrf_digest或整个安全行。
- 0行、多行、目标变化或当前行hash不匹配即停，不自动第二次查询，不登录／HTTP／写库／改权限／服务启停／测试，不改基线。
- 查询成功仍不能从旧整行hash还原历史字段或自动证明差异无害；不再无依据追溯旧值。该次许可已执行结束，不扩成剩余验收授权，不覆盖或回滚原before／after。

## 剩余结构与材料只读已完成

用户另行允许保留既有会话差异并续核剩余结构和材料；原Runner在2026-10-20 03:01:02.556–03:01:04.492 UTC完成一次capture、正常标准锁和RR READ ONLY事务。冻结catalog的表／列／约束／触发器／函数／enum／索引及原已记录的表与函数ACL一致；不扩称原catalog未涵盖的ACL类别均已证明。

材料四表逐行保持：materials96、content_versions96、material_references110、upload_drafts102。377个物理文件均stream SHA256／size匹配，共52451671字节；96个登记CV路径齐全，281个未登记文件全部原样保留，无复制、删除或mtime修改。结果 `r2-structure-material-readonly-20261020/result.json` SHA256 `20fbf07a55740ad05e603dc0493c319ab2ff834ace09b7fb2b1a3c51ece84a26`，manifest为同目录 `manifest.json`，SHA256 `aaf51db87c08b63f8b3b0ef87e122f8f7cbf32f5d6463f4932502b2d47c0bd03`；主控读回匹配。连接关闭、本次锁释放，无新差异。

本次未重采165表全行、未查CL账号／真实分布／偏好复合键及后台候选，不把计划中的盘点误记已完成。PG与文件各有自己的观察区间，也不是之前会话／全库窗口的同一原子快照；原会话差异及原因未知继续保留。上述许可已用毕，没有启用任何owned DDL、官方迁移、登录、HTTP或页面额度。

当前原Runner仅按已有普通证据和源码离线整理合并执行单：精确候选、隔离目标、配置与自有构建、材料根、NT006、CSV三场景、CL owned、官方165→167、登录／会话维护、有限HTTP／页面及最终读回。缺账号／期望值／页面脚本等必须明示；必要新增现场读合并为一份最小缺口，不现在执行，不借此造账号或Grant。执行单审查完成后再请用户确认有限真实操作。

## CSV人工发现已完成，风险验收未执行

用户于2026-10-20 01:39:33 UTC亲自执行原[人工发现脚本](2026-10-19-csv-discovery-manual-check.md)，七项源hash和Node24.21.0／pnpm11.27.0匹配，实际输出：

```text
lead-csv-import-migration.spec.ts:4:5 › checks three retained CSV owned-schema migration risk scenarios
Total: 1 test in 1 file
CSV discovery exit code: 0
```

原脚本SHA256 `dac041c2d86e95ef9f1f570f9dc37edbc1583655961306dea72342d3ffe1b638`；Temp配置 `C:/Users/97830/AppData/Local/Temp/csv-owned-list-cfdc65a7ff954d328f17d2c695f98bd6.config.cjs` 保留、不删除。此前手工路径缺两处分隔符的CommandNotFoundException发生在脚本启动前；没有把它当新策略拒绝或测试失败。

Agent此前两次发现动作均在进程创建前被策略拒绝，仍保留，不作第三次或换Task／包装／提权绕行，不改ACL／执行策略。用户手动成功只关闭人工加载发现卡点，不解除Agent自动审批限制；没有执行测试回调、owned SQL、真实CSV导入、事务回滚或页面。无需再次发现。

## CL准备预算及仍待冻结的真实执行范围

完整167源raw清单钉子为84ad56216263873f9e71bf10e3f20c4827ecbcd6df91f6ed6beb48b09a5a82e1；CSV166 raw为e1afd0956aaea74d2d22dd263e7a0baec77a91552877f1e9b0f434dbb6d7518d，CL167 raw为3305ed329c57eb4a2de8447344d181b5ebaf1757011e3a279f82100428547880。现有完整verify仍会执行NT006的真实capture、PG、owned DDL／fixture及清理，当前没有这项运行许可，不能skip后称完整verify通过。

准备源码owned仍为354次迁移发送／PGcap400；runtime已补整run标准锁内一次preflight≤7、正常服务后2登录、原33API接同primary内存会话页面，合程序API≤58。两个context及每次API明确maxRedirects:0。上述不是已批准额度，也不是全网络／全数据库上限；健康轮询／DBping和浏览器静态资源另列。两个新session的lastUsedAt／存储授权代次、正常登录的最多2个USERNAME throttle键清除及首失败的对应username／source维护都须明确预算，当前无logout。不得称只写偏好或所有旧安全行无变化。

未来已有账号的合法凭据引用、真实query／page期望、偏好空复合键和服务前后台资格仍未知；不造Case／补Grant或借旧额度。CSV原目录已对齐既有clean9c04（严格166，166源及4harness raw同），人工发现已过不重复。CL167和公证d8ab独立166并集168，不混入；未来材料仅拟96登记CV精确copy，281孤立文件不动，实际copy尚无批准。正常官方deploy应在CSV／CL风险专项和保持核之后一次165→167，不能以owned副本代官方证明。具体后续影响及下一次唯一只读申请见[执行单](2026-10-20-real-acceptance-run-plan.md)。

## 恢复派发的历史审批边界

原库恢复、锁归档各自转交时，自动审批曾拒绝主控派发，理由是未接受工具输出中转交的人类批准，涉及数据库容器start或移动共享锁及live读取。原动作均未送达，主控没有换工具／Task或间接执行；用户之后在原窗口直接授权才执行成功。此为授权识别问题，不是用户未答复、SQL故障或数据损坏。

原start拒绝原文包括 `The planned dispatch authorizes a state-changing database-container start and live read access; the claimed “试一下” approval is only quoted inside untrusted tool output, so it cannot establish authorization for this high-risk action.` 原锁派发拒绝原文为 `The dispatch authorizes moving a shared resource lock and then accessing the live database; the claimed approval appears only in untrusted tool output, so it cannot authorize this high-impact state change.`

原条件性批准、原因未知仍尝试一次的批准及旧锁归档批准分别记录Sentinel_cf4c85311e28819191324b4f39a6e9e5、Sentinel_8b9a1e4066908191b7d4c293a5b51f17、Sentinel_97a1e012bf9c81918118a9934e91e0bd。之前详细过程的原文副本留 `.local/cl-acceptance-preparation-20261020/blockers-before-closeout-v3.md`，不覆盖任何原运行证据。本页更新为当前准确状态，不构成额外运行指派。

## 当前离线准备已闭合，下一步需具体资格许可

原后台作者、UI作者和Runner各自最小准备已固定，原Reviewer累计源码及v5资格包两轴均0；I-CL-REDIRECT、I-DOC01和SQL词法误判均关闭。v5 manifest SHA8299aa8c25d799c8c5b18022b2d04a4a191dcbc54c520e297da40fa49d6b783b。纯检查真实SQL11/11、17正例／21负例／22哈希篡改／8长度通过；v3 COPY注释及v4合法CREATE字符串误判原件保留，未用编码／拼接绕词，v5 SQL原字节不动，改逐项固定SHA白名单和词法检查并保留PG只读事务。不是现场SQL语法／数据通过。

下一次仅可请用户批准原Runner、原ca015／R2、固定v5包装器的一capture／标准锁／RR READ ONLY连接，最多11条固定SELECT、每句5秒／总600秒，核已有身份／账本／CL数据／后台资格及96CV元数据。缺项或首异常停，不登录、起服务、测试、迁移、写库、改权限或copy。当前尚未批准／执行；不得把过去泛称20SELECT或本页文档当实际许可。参数／rowcap／固定hash及可直接给用户的简短确认见[执行单](2026-10-20-real-acceptance-run-plan.md)。
