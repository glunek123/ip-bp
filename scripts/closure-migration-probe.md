# 一次性封闭迁移探针：执行入口

该入口可发送真实 SQL，但本次编写与 mock 测试没有访问 Docker 或数据库。主 Runner 必须先审查并负责新实例的创建、秘密文件保护、完整身份记录和精确清理。入口本身不创建或删除容器、卷或网络，不启动应用，不变更 gate。

## 固定范围

- 唯一 project：`dev-cor-closure-accept-20261030`，唯一连接：`127.0.0.1:15441/dev_cor_test`，用户 `dev_cor_test`。
- PostgreSQL 镜像引用固定为项目锁定的17.11镜像。RepoDigest是仓库清单摘要，Docker image config ID是镜像配置对象摘要，两者不能混用。主 Runner用 `docker image inspect` 固定该引用实际返回的 config ID；probe每次实时复验同一引用的 `Id` 和 `RepoDigests`，并要求容器 `Image` 与该实际 config ID一致。不得拉取或改用其他镜像后继续。
- 实际空库证明后，在 public 原文顺序执行241项；随后创建随机 schema，原文执行前196项和余下45项。
- 第196项固定为 `20261029110000_guard_case_archive_note_audit`。该项成功后，在随机 schema 中调用独立合成夹具，准备一条待匹配外录案件及客户、身份、来源、审计、回执闭环；提交时保留全部延迟守卫。执行余下45项后再次读取显式字段快照并精确比较。报告仅保存匹配结果、表／行计数、ID摘要及快照摘要，不保存字段值。
- 合成历史范围只覆盖这条待匹配外录案件在11张相关表中的明确列；不覆盖归档、付款、合案或所有字段。夹具及其测试均纳入固定候选哈希。正向结案操作仍封闭。
- 每项前后复验输入及资源身份；每项后复验 replication role 为 origin、当前 schema 的全部非内部 trigger 均启用。
- 比较196时已有 trigger 名称未丢失、241最终全链与升级链的 trigger/function catalog 一致。该比较是两条路径的一致性证据，不能替代独立批准的完整保护预期值。
- 两个 schema 在负向写入前都精确核查两个付款表的draft gate，以及版本表先执行的金融actor guard：触发器名、表名、启用状态、当前schema内函数名、trigger返回类型、BEFORE ROW的INSERT/UPDATE/DELETE事件及非延迟属性均须一致。
- 回滚事务内分别发送DEFAULT VALUES非法插入。版本表必须精确命中23514及 `financial authorization requires serializable transaction`；文书表必须精确命中23514及 `case closure payment persistence is draft and not enabled`。两者不能互换，任意其他23514不算成功。报告逐表注明：版本表空行被actor guard拒绝、draft gate存在并启用，其gate行为未直接验证；文书表空行被draft gate拒绝，其gate行为直接验证。未绕过或禁用任何guard。

原始历史迁移中有两组临时 DISABLE/ENABLE TRIGGER 配对，已按原始表名和语句逐字列入白名单，并要求恢复在禁用之后。原文件完整哈希仍受固定清单约束。脚本不添加任何禁用 SQL、不改写 migration.sql，不设置 replication role。历史迁移与新封闭 gate 应区别审查。

## 主 Runner 的准备责任

先获取并保存新建前真实 inventory。它须覆盖项目、完整容器 ID、卷名、完整网络 ID及15441端口占用。确认本轮 project、数据卷、网络、端口不存在；不要以空的人工 JSON 代替真实采集。保存新建时间与创建回执。probe 只验证 supplied before 不含本次资源，并不独立证明历史 inventory 的真实性。

新实例必须恰有两个挂载：专用数据卷到 `/var/lib/postgresql/data`、主机临时密码文件只读挂载到 `/run/secrets/postgres-password`。密码用32随机字节的 base64url值，恰43字符；只设置 `POSTGRES_PASSWORD_FILE`，不要设置 `POSTGRES_PASSWORD`。用户名和库名均为 `dev_cor_test`。设置健康检查，等待 healthy。三类资源都设置以下标签：

```text
com.docker.compose.project=dev-cor-closure-accept-20261030
dev-cor.closure-acceptance.run=<本轮随机UUID>
```

卷名固定 `dev-cor-closure-accept-20261030-pgdata`，网络名固定 `dev-cor-closure-accept-20261030_default`。不要通过 compose up 复用旧对象。容器必须只连接该网络、只发布127.0.0.1的15441端口、未开启 privileged。

在系统临时目录下新建一个独立候选配置目录。只需要其中的 `backend/.env.test`；不要复制或读取原工作区 `.env.test`。写入临时合成 DATABASE_URL及可选 NODE_ENV=test，不放其他键。候选目录应设置为仅本机当前用户、SYSTEM、Administrators可读取，再写文件。秘密挂载文件也必须先保护权限再写入。probe 在读内容前检查文件权限，并核对 URL 中密码与挂载文件相同；它不代替主 Runner 的安全创建步骤。不要把密码、DATABASE_URL、原始 Docker inspect 或数据库异常写进日志。probe 日志只输出固定状态和SQLSTATE，报告不保存配置路径或密码。

在无凭据的 binding.json 中保存以下结构，值来自实际创建及 inspect 回执。secretPath 为本轮系统TEMP下 `dev-cor-closure-<runId>/postgres-password` 的规范Windows绝对路径；probe复验ACL及与临时候选根的确切关系。secretDockerSource由该Windows路径唯一推导：盘符转小写，其余路径大小写原样保留，反斜线转正斜线，前缀为 `/run/desktop/mnt/host/`。probe自行推导并逐字核对该字段；挂载Source只接受原Windows路径或这个唯一映射，其他前缀、大小写变化、相对段、UNC／device路径及ADS都拒绝。只读目标挂载、完整网络ID及healthy条件保持不变。

```json
{
  "containerId": "<64位完整容器ID>",
  "networkId": "<64位完整网络ID>",
  "volumeName": "dev-cor-closure-accept-20261030-pgdata",
  "secretPath": "<本次受保护临时密码文件的绝对路径>",
  "secretDockerSource": "<按唯一规则从secretPath推导的Docker Desktop路径>",
  "runId": "<本轮随机UUID>",
  "imageId": "sha256:<docker image inspect返回的实际64位config ID>",
  "repoDigest": "postgres@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0",
  "before": {
    "projects": ["<实际已有项目>"],
    "containerIds": ["<实际已有完整ID>"],
    "volumeNames": ["<实际已有卷名>"],
    "networkIds": ["<实际已有完整ID>"]
  }
}
```

## 精确调用

在项目根目录，每个新的 PowerShell 进程先加载并核对项目运行时。以下路径由主 Runner 替换为自己的绝对路径。plan 与 report 必须尚不存在；脚本拒绝覆盖旧证据。

```powershell
. .\Use-ProjectRuntime.ps1
node --version
pnpm --version
node scripts/closure-migration-probe.mjs --prepare C:\absolute\reviewed-plan.json
```

`--prepare`仅读取迁移、schema和相关执行脚本并生成固定哈希。主 Runner 审查该计划及本脚本后再执行：

```powershell
. .\Use-ProjectRuntime.ps1
node scripts/closure-migration-probe.mjs --run C:\absolute\reviewed-plan.json C:\absolute\binding.json C:\Users\97830\AppData\Local\Temp\unique-candidate C:\absolute\probe-report.json
```

运行时使用已有跨工作区共享E2E锁。锁冲突直接停止，不回收他人的锁。每次发送 SQL 前后重新检查固定清单和实时身份；失败首停，不自动重试、补 SQL或盲目清理。单个查询60秒 statement timeout、10秒 lock timeout、70秒客户端 query timeout。连接结束后释放锁；连接／锁清理失败必须标 STOPPED。

report.phase只使用脚本内固定阶段码，不拼接路径、凭据、异常文字或动态迁移名称。准入故障可区分 LOCK_ACQUIRE、PLAN_CAPTURE／PLAN_COMPARE、BINDING_VALIDATE、DOCKER_*_INSPECT、DOCKER_IDENTITY_VALIDATE、CONFIG_IDENTITY／CONFIG_LOCATION／CONFIG_ACL／CONFIG_CONTENT、SECRET_ACL／SECRET_MATCH、DATABASE_CONNECT和DATABASE_IDENTITY_AND_EMPTY。后续迁移、守卫、合成夹具和清理也使用固定码。输入adapter不能用任意字符串替代阶段码；阶段细分不放宽任何准入条件。

Windows ACL子进程显式加载自身 `$PSHOME` 中的 Microsoft.PowerShell.Security模块并调用模块限定的Get-Acl，避免桌面宿主继承的PowerShell7模块路径干扰Windows PowerShell5.1自动加载。该兼容修复不改变允许的SID集合。真实受限临时文件测试同时验证：继承不兼容同名模块时仍正确读取ACL，而Everyone读取授权仍被拒绝。

## 收尾与证据边界

probe 无论成功失败均保留容器和 schema，由唯一主 Runner 在复验完整身份和创建回执后，逐个删除本次完整容器 ID、精确卷名、完整网络 ID，再复核已消失。不要使用 prune、项目级 down、通配或旧资源清理。容器仍存活时保留受保护secret；删除容器后才删除秘密及临时配置。任何清理不确定性单独记录，不能以 probe 成功推定已清理。

report 初始写入 RUNNING_OR_INTERRUPTED，防止进程中断被误记通过。成功状态只证明空库241、合成待匹配外录案件的所选字段在196→241保持、trigger启用／目录一致、两表draft gate目录身份，以及版本表actor拒绝／文书表gate拒绝。版本表draft gate行为、其他历史数据、全部guard行为、权限、业务正向、应用和浏览器都未验证；本入口不提供解除这些限制的选项。

本入口没有resume模式。现有失败报告没有在负向探针前保存可独立核验的public完整结构／函数目录指纹，原始SQL执行也没有可信迁移账本。失败报告列出已执行241项、当前trigger启用和业务表为空，仍不能唯一证明public结构与旧候选完全一致；不得据此跳过空库准入或重新执行public迁移。主Runner应精确清理并重新建立空实例，再用新计划运行完整探针。
