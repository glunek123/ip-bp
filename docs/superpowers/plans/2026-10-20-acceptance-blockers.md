# 真实验收阻塞与最小人工交接（2026-10-20）

用户已恢复项目推进并要求优先解决验收卡点。当前只完成本地文件／Git／文档检查，没有新增数据库、迁移、登录、HTTP、浏览器或权限操作授权；CSV原命令的两次策略拒绝仍有效，不作第三次或换路重试。

## 已恢复且不重复开发

- 开发根minimal-page-actor-admission仍为clean `e27628a006855819d8bcf4ba526bc93460935dfc`／tree `ba557c9800aa59d9fe8db7469bd16848f74ee6ec`。客户详情及CL的离线源码／审查／切片证据保留；1340文本context核对通过，Node24.21.0／pnpm11.27.0符合锁定值。
- 原CL后台19、API4、UI6及客户详情2份WIP仍在各自原目录，没有覆盖、reset或重新实施。公证原树clean d8ab9b3e，ca015仍clean f6e3a82f；未把开发候选接入运行树。
- 原CL后端任务已完成专属执行件只读微合同，现已分配独占case-list-query-acceptance／codex同名分支（基线e27628a0）纯源码准备；不能把送达或active计为代码实现完成。其压缩后误查主目录Git ignore读取警告，已在原任务纠正回明确开发根／既有合同；没有改ACL或持久配置，不把可选全局ignore读取拒绝当业务阻塞。

## 可自主处理的技术准备

CL167缺少专属受审helper、spec、固定配置、数据清单及请求预算。原任务先收敛准确文件与可静态枚举的查询／偏好请求，再由主控分配独占路径做离线源码与纯反例、独立审查；不执行其真实入口。现有旧列表reset／clear夹具、旧身份准备和CSV strict166 helper不能直接改名或加grep作为CL验收。

本次六文件白名单为tests/support/case-list-query-preferences-acceptance.mjs、.d.mts、.test.mjs，tests/e2e/case-list-query-preferences-migration.spec.ts、case-list-query-preferences-runtime.spec.ts及playwright.case-list-query-preferences.config.ts。只允许代码／纯正反例／类型／静态检查，不运行包括CL在内的Playwright发现或任何真实入口。原作者提出的17次案件GET、8次偏好请求及浏览器业务1PUT＋1GET尚须逐项编号、核算全部实际网络和数据前置，当前不是已冻结／已批准预算；登录、CSRF、自动读数和失败核实不能漏计。代码未来也必须在未有精确有效阶段授权回执、数据manifest或对象资格时，于capture前拒绝，不能用环境开关、假账号或旧批准解锁。

现有账号、案件是否覆盖字面百分号／下划线／反斜杠、同值跨页、null和范围隔离，必须先获准只读盘点，不能猜测已满足；新增Case／账号／Grant／上传目标为0，但尚不是live核实结果。待测偏好行及GET／PUT／session数量须绑定具体复合键和场景，不能用耗尽的旧额度，也不把尚未冻结的示意数当上限。

已静态重核迁移边界：CL独立源167项；公证独立源166项，唯一额外目录为20261018000100_notary_record_corrections。二者目录并集168项，且公证时间戳早于CSV和CL。公证39源虽已审，仍应独立排队；不能在CL167固定执行件中混入后继续宣称167，也不能将公证新Action当作已有Grant。现有公证readiness-v2的POST数只是未含完整准备的示意下界，不是可执行预算。

完整pnpm verify仍会通过递归后端Jest启动core-nt-006-migration-probe，真实capture／PG连接／owned schema DDL、fixture和删除均在源码中；public预期不变不等于没有数据库写入。没有新授权就不运行，也不skip后称完整verify成功。

## CSV：确需用户的只是测试发现，不是真实验收

今天只读重新核实原人工脚本及七份绑定源码raw hash全部匹配，脚本SHA256仍为`dac041c2d86e95ef9f1f570f9dc37edbc1583655961306dea72342d3ffe1b638`。原lead-csv-import-batch为HEADa22b2ba1，四份冻结专项WIP保留，源链166，node_modules及本地Playwright CLI均存在。没有执行脚本、import测试模块、创建Temp配置或调用发现。

原任务名为“实施线索CSV原子导入服务”。两次自动审批只给出blocked by policy，未提供可针对修复的具体条件；连接已恢复不代表该决定被撤销。目前没有已核实的新正式工具审批路径可代替这一决定，不推荐再说一次“允许”、改ACL／执行策略／Full Access或换Task。

用户可审阅[原人工交接](2026-10-19-csv-discovery-manual-check.md)，在普通Windows PowerShell自行选择执行这一行：

```powershell
& 'D:\工作项目\品维and知产\dev_cor\.local\worktrees\minimal-page-actor-admission\.local\csv-owned-review-followup\manual-csv-discovery.ps1'
```

这不是让Agent执行，也不是关闭安全控制。脚本先校验七项哈希和运行时，创建仅一个无覆盖Temp配置，保留--list、无webServer／globalSetup／globalTeardown、自带line reporter；只应发现1文件1测试。不执行测试回调，不迁移、连接PG、登录或启动浏览器。依赖加载仍会创建进程和普通缓存，不称零本地写入。若本机策略拒绝或输出非1项则停，不Bypass／提权／改策略／重复执行；仅返回测试标题、Total和退出码，失败返回无秘密错误，不发.env或token。

即使发现成功，也只解除“该测试能否加载／列举”这一卡点；owned-schema回放、真实CSV导入、事务回滚和页面操作仍未验，须单独冻结执行件和新预算。

## 下一次合并批准应先限于只读前置

原“验收独立环境快捷操作”任务是唯一真实Runner。以下是待用户批准的提示词，不是已下发运行单：

> 允许原“验收独立环境快捷操作”任务，仅对原R2（project dev-cor-ui003-r2、完整CID45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236、127.0.0.1:15438/dev_cor_test）做一次标准capture及必要的只读实例／服务槽核验，并在单次标准锁内做至多10分钟的REPEATABLE READ READ ONLY快照：核真实迁移账本、既有授权账号资格、CL查询所需数据分布、偏好表是否存在，以及调度／清理候选与保护基线。只输出脱敏ID／数量／摘要；不读私密凭据载荷，不登录、不发业务HTTP，不启动或停止服务／容器，不创建身份／Grant／fixture，不复制或改写材料，不运行迁移、NT006、CSV发现或真实测试。目标、服务槽或候选不符即停报。完成后只交准确数据与有限运行预算，不自动进入下一阶段。

这一个前置许可可同时确定CL数据、原库是否适合继续及公证隔离需求；真实写入额度尚无法从文件推断。后续应把owned迁移、官方部署、精确偏好PUT、登录和页面动作一起列成固定执行单后再一次申请，不能先给笼统“全部允许”。若选择独立CL数据库／卷，创建资源与配置属于另一明确影响，不能在上述只读许可里代建。当前未查任何live状态，不把历史public165当作今天实况。
