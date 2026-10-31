# 一次性本机合成验收：离线准备

状态：DRY_RUN_ONLY_EXECUTION_BLOCKED。本方案不授权创建容器、访问数据库、运行迁移或解除 gate。当前只交付 manifest 生成器和离线准入检查；不是可执行的完整验收器。

## 已检查的现有保护

`test-environment.mjs` 的显式 managed binding 会核对完整容器 ID、Compose project/service/序号、唯一 loopback 端口、固定镜像 ID、账号/库名和健康状态。默认 15433 路径仍允许旧名称/label 身份，未来本次验收必须拒绝默认路径，始终提供新 project 和完整 ID。

`captureTestEnvironment` 会读取现有 `.env.test`，数据库 override 仍要求密码与该文件相同，并会持久化 HMAC key。因此本方案只复用纯函数 `selectTestDatabaseContainer`，不调用 capture、migration runner 或 E2E runner。现有 `run-test-migration.mjs` 在取得共享互斥锁后直接运行 deploy，没有审查过的有序 manifest 核对；不能原样作为本次执行器。

## 本次交付能证明什么

- CLI 只读取迁移 SQL，按目录名排序，输出每份文件 SHA-256 和有序清单整体 SHA-256；不读取 `.env.test`、凭据或 Docker。
- `admitFreshClosureInstance` 仅检查调用方提供的离线 inventory：新专用 project、完整容器 ID/labels、唯一 loopback 映射、账号/库名、固定镜像 ID/引用、唯一专用卷和网络，并输出精确清理身份。
- mock 测试验证拒绝已有资源、错误身份、公开/重复端口、错误账号/库、镜像和资源映射。

离线输入可以被伪造，准入通过不证明真实环境安全，也不证明库为空。CLI 没有执行选项，输出始终标明执行阻塞。不得将 mock 通过标为数据库验收通过。

## 后续执行器必须另行审查的步骤

1. 固定 commit/tree、脏差异归属、完整有序 migration manifest 及其哈希；由审查者批准预期值。执行前、每次迁移前后重新比对，发生漂移即停止。还须绑定 schema、生成输入与被测脚本的候选哈希，不能只核 SQL。
2. 获得明确的一次性本机合成库授权后，先获取既有共享资源互斥锁，直接采集新建前完整项目、容器、卷、网络清单和端口占用。不得接受用户手写清单作为真实环境证明。新 project 使用 `dev-cor-closure-acceptance-<唯一标识>`，端口使用经核实未占用的新 loopback 端口；不得复用旧项目、数据库、卷或快照。
3. 生成一次性随机合成密码，通过权限受限的临时 secret 文件和只读 `POSTGRES_PASSWORD_FILE` 挂载传递；不打印、不提交，不把密码放进命令参数或日志。Windows 文件 ACL 或其他宿主权限机制必须在写入 secret 之前验证。Docker inspect 原始输出不得写入证据。现有 Compose/runner 尚不满足该流程，不能直接运行或通过编辑 `.env.test` 绕过。
4. 创建后直接采集并重新验证完整 ID、labels、镜像、端口、卷及网络；连接前再次核对目标身份。只在这个新实例中查询账号、库名和空库状态；空库证明及新建时间绑定当前运行。此步骤没有在当前任务执行。
5. 在同一候选上分别设计空库迁移、合成历史业务升级、失败回滚和并发/撤权验证。升级基线必须单独确定前缀 manifest 与合成 fixture 哈希；不得用空库成功代替升级成功。每组记录真实执行结果，日志必须脱敏。
6. 全程保留所有 gate 和永久守卫。不禁用 trigger，不改 replication role，不自动替换 gate。先验证封锁及反例；当前被 gate 阻断的业务正向链标 BLOCKED，只有目标设计与替代迁移另行批准后才能重设计正向验收。
7. 完成或失败后，先重新核对当前资源身份及本次创建记录，再逐项清理准入返回的完整容器 ID、精确卷名、完整网络 ID。另列本次文件/进程的精确身份；不使用通配、prune、自动项目 down 或已有资源删除。保留无凭据的 manifest、结果和清理核对记录。准入返回值仅是清单，不执行删除。

最值得人工复核的是：执行器是否真的从本次新建前后采集 inventory 并证明空库，而非拿一份可伪造的离线 JSON 当成授权和新建证据。

## 封闭阶段编排草稿（2026-10-30）

`closure-acceptance-executor.mjs` 新增可注入 adapter 的封闭编排及 mock 测试；没有 CLI，也没有默认 Docker／数据库 adapter。缺少已审查的 secret 生命周期 adapter 时直接返回 `BLOCKED_ADAPTER_NOT_REVIEWED`，不获取锁或创建资源。adapter 的布尔声明仅是编程接口，不是实际权限、安全性或授权的证明。

编排顺序为共享锁、固定候选／manifest、项目和端口不存在、新 secret 文件、新卷／网络／容器、实际完整 ID 与资源标签复验、空库及账号检查、有序原文件迁移、逐份前后候选／资源复验、完整 public trigger/function catalog 哈希比较、付款 gate 的预定义负向事务探针，以及按创建记录精确清理。随机密码仅交给 adapter 写受限 secret 文件，随后清零缓冲；容器必须恰好挂载独立数据卷和该只读 secret 文件。guard catalog 预期哈希必须另行审查获得，不能当场把实际值自动批准为预期值。

此阶段不执行任何业务正向命令，也不宣称覆盖所有 gate 的行为反例。catalog 覆盖实际 public trigger 的名称、表、启用状态、延迟属性、完整定义及函数定义；付款负向探针只证明其精确拒绝信息。迁移原文件仍必须整体审查，简单的 bypass 关键字拒绝规则不是完整 SQL 安全分析。adapter 应让每次数据库命令独占干净连接、使用精确容器 ID 和 `ON_ERROR_STOP` 等价机制，不允许连接池继承会话配置或转发任意额外 SQL。

创建中断或无法证明资源身份时停止，报告已知完整 ID、精确卷名及未确认创建阶段；不猜测删除。成功清理前复验身份，清理只使用创建记录，不使用通配或项目级 down。若容器可能仍存在，保留权限受限 secret 文件供后续核查；报告不包含文件路径、密码或 adapter 原始错误。

**尚缺的实际执行依据：** Windows 受限文件创建／ACL 复验、固定镜像拉取或本地核验、实时 Docker 完整 inventory、精确新建与失败回报、共享锁连接、独占 PostgreSQL 发送边界，以及 cleanup adapter 都未实现或实测。这些接口只经 mock 验证；不得仅设置 `reviewedSecretFileLifecycle=true` 就认为真实 adapter 已获审查。真实运行、空库迁移、升级、并发、浏览器和全部业务正向验收继续阻塞。
