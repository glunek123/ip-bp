# CORE-CL-001 验证准备与运行边界

本记录对应[冻结合同](../specs/2026-10-19-case-list-query-preferences-contract.md)。当前交付目标是固定源码候选、独立复审和不连接数据库的组合检查；不是部署或真实页面验收。

## 2026-10-20 六文件离线准备候选

最新固定提交为 `aa0e33d76ed4b482687783c1b34eef46c03cfa90`／tree `7966e1b9da97cee7e9db5d6469a39f83689c83cd`，parent `b0d3bbfb48a9e03c1fac95750a45aa6a8ead83b9`；独占`case-list-query-acceptance`／`codex/case-list-query-acceptance`，clean。相对b0仅六文件：原配置、runtime spec、helper／类型／纯测试五份修改，加原UI作者唯一新增页面步骤；原owned spec不变，累计七份准备文件。主控逐raw匹配后精确提交，未接ca015／main、未push；批准pin仍null，不是完整Level3验收。

原后台作者把preflight移至受保护标准锁内整个run一次、最多7条直接只读PG，配置与worker只做静态准入；正常managed服务成功后在唯一runtime内登录两次，不再要求起服务前已有cookie。页面步骤在原33次API后复用同一primary内存cookie，不落storageState文件。两个APIContext与逐get／post／put均maxRedirects:0，收到非预期3xx停止；原独立Sol按最终六raw关闭I-CL-REDIRECT，累计Spec／Quality均ACCEPTED、C/I/M0，仅限离线源码。

页面文件raw为bf01cccb76f132e286f301e50e0b0fe7946bf91ca1423e00df5605094c83ddd6；详情允许null followups但不接真实filing命令分支；默认createdAt排序与合法同名过滤ASC精确接线，不放宽businessNo唯一约束。page fixture期望来自未来真实只读资格，缺数据不造Case。

最新完整纯测试18/18，定向TypeScript／ESLint／Prettier／diffcheck通过；最终测试日志SHA b6abb9825bd03ed8996fcaf6d7a5f28036d038c357e28162e5b5b6e2017f47f2。原15项、随后17项和本次18项分开留证，不相加。原本树实际正常pnpm build:prepared通过；最后仅测试与配置变动，874份backend/dist再次核hash匹配，构建未重跑。当前清单SHA378dd94488e0e4bd579d8e93d1f25216765095f508b3b758a5d9ca7e5d0671c6，执行输入aa1764187beb28068c5e245d0390665bd5807ea153dc9f21fc2933d6bc56bf50。完整verify／NT006、PG、HTTP、发现和浏览器均未执行，不能用构建或fake测试冒充真实验收。

主控普通回执及原Reviewer最终输出留开发集成树`.local/cl-acceptance-preparation-20261020/runtime-page-increment-v2-committed.json`和`review-source-and-qualification-v5-accepted.json`。较早b0六新增文件及15/15、三轮源码审和17条实际工具记录仍按原输入保留；曾发现数据库入口绕准入、完整输入绑定、历史失败、日志隐私及不可行夹具，均返原Owner修复，未抹去失败。新固定输入核对不重复未变测试。

| 阶段            | 准备的有限范围                                                                                                   | 尚未批准／证明的边界                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| owned           | 两schema；空167和166→167各177发送，共354／总PGcap400；手工部门／用户／成员各2及偏好1，另列旧目录数据；保留不DROP | 新运行额度、精确schema及阶段收据；旧public和材料保持，不自动清理                                        |
| 原API           | 案件GET17、偏好GET3／PUT5（1合法、4预期400）、身份GET8，共33                                                     | 两既有账号／获准凭据引用、真实期望及批准空复合键；不得新增Grant或补造数据                               |
| 页面及登录      | 正常登录2＋页面GET22／23，合原33为程序API上限58；页面所有非GET拒绝                                               | backend健康／静态资源不在58内；不能泛称全网络上限；不验证页面保存／取消／重置或业务Drawer               |
| preflight与认证 | 整run标准锁内一次、直接PG最多7；两次成功登录最多2session及2个username throttle键正常清除                         | 健康ping／API ORM另计；认证维护新session lastUsedAt／授权代次，首失败停，不称安全行完全只读；不含logout |

未来仍须真实批准收据绑定完整源码／配置／依赖、167原字节链及前166的176段、原精确resolved失败与官方回执、自有构建清单；owned／runtime不同收据、阶段12分钟期限。pin保持null，本轮不生成假成功收据，不把纯输入当现场资格。

原CSV目录已安全对齐已有clean9c04e68a（严格166，166迁移及4harness raw全同），用户人工发现1项已过，不再Agent发现。R2恢复、单会话定位和结构／材料只读各独立许可已用毕；原会话历史原因未知、多窗口非原子及281孤立文件保留。原Runner固定资格包v5已获原Reviewer两轴0：11条固定SELECT、一capture／锁／RR READ ONLY连接、每句5秒／总600秒，尚未执行、需具体批准。下一次准确范围及后续NT006／风险专项／官方deploy／认证／页面分段见[真实验收执行单](2026-10-20-real-acceptance-run-plan.md)；CL167仍不混公证独立166。

## 本轮可执行检查

- 各原作者的直接 Jest／Vitest、prepared 类型、受改文件 Lint／格式及架构检查；主控在组合候选验证 API、页面、原列表办理和会话隔离的相关纯测试。
- Prisma 只允许 schema 校验和 Client 生成，不执行迁移。新增目录 `20261019120000_case_list_preferences` 仅为迁移文本；开发链预期 167 项，不能因此放宽旧 CSV 的严格 166 项运行准入。
- 独立 Sol 在固定文件与原始哈希上审查后端、API、页面的累计差异。mock 结果不能证明真实 PostgreSQL 的 LIKE 转义、排序、会员外键、权限变化或保存持久性。
- 组合树稳定后记录实际通过、失败和未运行项。完整 `verify` 含当前未批准的 NT006 边界，本轮不执行，不将切片检查称为完整 Level 3 门禁。

## 后续真实验证的独立准入

下面是待另行批准的覆盖清单，不是运行指派，也没有新增测试额度：

1. 固定最终 worktree、HEAD／tree、运行配置和迁移原字节；重新核对隔离数据库、已有账本、事实与文件基线，明确旧数据和账号保护范围。
2. 对空链与上一支持链升级验证新增表、真实会员外键和旧行保持；官方迁移入口与 owned SQL 风险探针分开记证据，不能相互替代。
3. 真实数据查询覆盖授权范围内外、部门／mine、文本 AND／OR、字面 `%`／`_`／反斜杠、同值跨页排序、null、阶段 total 与文本 counts。测试数据来源和允许新增的对象必须先明确。
4. 偏好验证限定批准账号、部门和流程桶，事先列出允许写入的精确偏好行及前后比较规则；核对 GET 默认、PUT 全量替换、重新登录后的持久读取、无权前置以及不同账号／部门／桶隔离。不能修改旧角色或借此增加 Grant。
5. 页面覆盖显式查询、清除／回第 1 页、详情往返和办理后刷新保留、14 列默认与固定列、隐藏／排序／取消／重置待保存、未知保存结果及跨会话迟响应；原 Drawer 未确认写入仍阻止导航。

任何未来执行单都须单列页面与写入额度、目标对象、首异常停止条件和证据位置。已耗尽的旧额度不恢复；当前 CSV 两次策略拒绝也不会因本片开发、连接恢复或沙盒修复而解除。本轮不连接 DB、不 capture、不启动服务、不执行 HTTP／浏览器／迁移，不合入 ca015、不推送或部署。

## 原验收任务离线准备单读回（2026-10-19历史，未授权测试）

原“验收独立环境快捷操作”任务已完成只读准备，不再是“仅送达、未取得执行回执”。文件为本树 `.local/case-list-query-preferences/runtime-readiness-plan.md`，SHA256 `5a35c711cd325adba7dfabfce7b54433c9909f8c5a0834f50c8add3106756e1b`；主控读回原哈希及其中五个源码锚点均匹配。它没有运行脚本、capture、连接数据库、检查容器／端口或调用发现入口，不能据此记验收通过。详细计划保留为ignored证据，以下只同步准确阻塞：

- **完整verify是写库边界。** 根verify包含递归test；后端Jest收录 `core-nt-006-migration.spec.ts`，该测试通过execFileSync运行真实probe。probe调用capture、连接PG、取标准锁，创建自有schema、回放旧迁移、插入fixture并最终删除自有schema。即使预期public不变也不是零数据库动作；当前没有这项新运行授权，不能跳过NT006再称完整verify通过。
- **目标与链须先选定。** 旧人工证据是public165，当前live未查；从165以CL167源正常部署将同时应用CSV166和CL167，不是只跑167。公证d8ab的166是独立分支。CSV helper仍要求其原完整166源、public165及精确历史失败记录，不能改成167或借CL目录剪裁真实准入来兼容。选择独立验证环境，或明确允许原R2升级，都须另有固定目标及保护规则；计划没有创建资源。
- **尚无可直接执行的CL专项。** 缺少专属受审PG／迁移helper、E2E spec、精确testMatch/config、fixture清单及分阶段执行单。旧 `case-list-display.spec.ts` 引用resetCoreLeadE2eData及多种clear夹具；旧workflow专项会准备身份／角色，不能加grep便当作本片保留数据验收。本次没有新建或运行这些专项。
- **新预算和资格须明确。** 最小化目标是使用已有active INTERNAL及case.read，新增账号／Grant目标为0，但当前真实资格未查。必须先列明具体账号、偏好复合键、GET／PUT、登录、fixture／schema及失败保留预算；如要改权限、引入第二账号／部门、验证Drawer业务写未知，须单列动作，不能暗借H42或旧额度。旧已耗会话不恢复，不读取私密凭据载荷。
- **后台及人工事实受保护。** 服务启动前另获授权的fresh只读检查应覆盖调度／清理候选、账本、账号、事实与文件，候选变化先停报；不能自动expire／purge、改clock或禁timer来通过。既有人工快照不是当前live原子基线，不回滚用户增改。

本节保留原准备单和恢复早期的缺口，不是最新运行单。客户详情已离线收口于e27628a0，CL六文件后续已固定b0d3bbfb并经原独立源码补审，准备上限与剩余资料见本页最新节；pin仍null。CSV用户人工发现已成功，Agent原拒绝不再重试。原库165账本已核，旧会话差异经单SELECT定位、原因未知仍保留；后续结构／材料只读PASS，CL数据资格未查。CL167与公证独立166并集168，仍不混用。完整verify的NT006写库边界不变；当前只准备合并执行单，准确事实见[验收阻塞交接](2026-10-20-acceptance-blockers.md)。
