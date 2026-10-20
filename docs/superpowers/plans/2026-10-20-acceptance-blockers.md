# 真实验收阻塞与后续最小范围（2026-10-20）

本页只记录实际完成、停止原因及待确认操作，不是新的运行授权。当前CL准备候选默认拒绝，真实验收仍不得复用耗尽的旧额度。原批准指令保留在Git对象 `1eb9dd20c21090337ef524b5a00fc2373f1a55f8:docs/superpowers/plans/2026-10-20-acceptance-blockers.md`，raw SHA256 `30bd16732a25db905c00de911169f6304b67a27b77d97f96ac1908ddbba20388`。

## 当前结论

原R2已恢复运行，原失效资源锁也已可恢复归档；这两个阻塞已解决。正常取锁后的只读核验在一条旧auth_sessions行哈希差异处停止，不能标整体PASS，结构和物理材料字节尚未续查。原快照只有PK／整行hash，不能还原旧字段／变更时间；另批单SELECT已定位为原H42会话并证当前无再漂移，仍不证明历史因果。不覆盖、回滚或重置基线。

CL167六文件离线准备已由原作者及原独立Sol收口，独占分支候选 `b0d3bbfb48a9e03c1fac95750a45aa6a8ead83b9`／tree `6bdb7fe37f14bb2be0486661847b77e20aa03ce9`，pin仍null，没有接入ca015／main或实际执行。15/15纯测试及定向静态通过，Spec／Quality均ACCEPTED、C/I/M0仅限离线源码；[完整准备边界](2026-10-19-case-list-query-preferences-validation.md#2026-10-20-六文件离线准备候选)。

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

## 下一次最小决策：记录单行例外，继续剩余只读前置

建议用户只对以下范围作一次明确决定；当前未执行：

1. 将该已定位、当前hash稳定但历史原因不可还原的**唯一旧会话行差异**作为本轮明示例外，另存例外记录，引用原PK／before／after哈希及本次回执；不改原快照，不泛忽略auth_sessions或其他安全行，也不宣称原因已证实。
2. 原Runner一次标准capture／正常标准锁及最长10分钟RR READ ONLY窗口，继续原未到达的catalog／结构（表列、约束、函数、索引、ACL等）和材料元数据／现有批准根内物理字节核对；范围沿原冻结清单，未登记文件只盘点保留，不删／复制／改写。对上次已通过部分仅做维持一致所需摘要核对，不重复容器恢复或旧锁归档。
3. 同窗口只读盘点既有账号／范围、CL字面字符／合法同值／null／分页分布、偏好表／复合键及调度／清理候选，记录缺口和未来启服影响，不执行后台推进／expire／purge，不新造身份或业务夹具。
4. 该行不再漂移之外，任何新行差异、目标／catalog或材料异常首项即停；新后台候选仅作为未来启动影响报告，不在本单处理。结束关闭连接并释放本次锁，只交已验／未验与精确差异。

这可以继续完成只读前置，仍不是owned DDL、官方迁移、HTTP、登录或页面测试许可；实际业务验收还须据完成后的资格和资料冻结执行单、新额度及两条会话维护边界。

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

六文件代码中只是准备了owned354次迁移发送／总PG上限400，及runtime25次业务加8次身份请求／总spec HTTP33／专项PG最多7；不是已批准额度。真实构建来源／逐文件产物、原官方resolve证据、目标数据资格、两条具体会话与偏好复合键仍须冻结；健康轮询、登录准备、页面及官方部署均未包含。

认证GET也可能维护旧session字段，因此不能把HTTP阶段称为全库只读或只写偏好；要明确获准session IDs、允许变化字段和前后核对方式。当前计划不含logout，不将revokedAt变化算作既有运行结果。真实数据如不覆盖字面%／下划线／反斜杠、合法名称同值分页、null及范围隔离，应报缺口，不造夹具或借旧账号／Grant。

后续要把owned风险、正常官方deploy（原165至167会同时应用CSV166和CL167）、有限HTTP与页面分别列入固定候选执行单供用户确认。公证d8ab是独立166链，和CL并集168，不能混入固定167候选／台账或自动授予新Action；旧原作者WIP和公证成果保留。若选择独立库／卷／环境或需要新增材料精确copy，属于另外明确资源影响，不能在只读许可里代建或复制。现有原环境／权限／数据范围保持，不复用耗尽额度。

## 恢复派发的历史审批边界

原库恢复、锁归档各自转交时，自动审批曾拒绝主控派发，理由是未接受工具输出中转交的人类批准，涉及数据库容器start或移动共享锁及live读取。原动作均未送达，主控没有换工具／Task或间接执行；用户之后在原窗口直接授权才执行成功。此为授权识别问题，不是用户未答复、SQL故障或数据损坏。

原start拒绝原文包括 `The planned dispatch authorizes a state-changing database-container start and live read access; the claimed “试一下” approval is only quoted inside untrusted tool output, so it cannot establish authorization for this high-risk action.` 原锁派发拒绝原文为 `The dispatch authorizes moving a shared resource lock and then accessing the live database; the claimed approval appears only in untrusted tool output, so it cannot authorize this high-impact state change.`

原条件性批准、原因未知仍尝试一次的批准及旧锁归档批准分别记录Sentinel_cf4c85311e28819191324b4f39a6e9e5、Sentinel_8b9a1e4066908191b7d4c293a5b51f17、Sentinel_97a1e012bf9c81918118a9934e91e0bd。之前详细过程的原文副本留 `.local/cl-acceptance-preparation-20261020/blockers-before-closeout-v3.md`，不覆盖任何原运行证据。本页更新为当前准确状态，不构成额外运行指派。
