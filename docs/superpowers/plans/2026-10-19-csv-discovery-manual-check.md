# CSV 测试发现的人工核查交接

2026-10-19。这里只准备人工操作说明，主控没有代跑。原“实施线索CSV原子导入服务”任务（`01a152ae-0eae-79a2-b438-82aaf0a3bbb2`）的命令及用户批准后的一次重试，均在进程创建前被策略拒绝：`blocked by policy`。没有临时配置、测试发现或回调执行。该项仍为 **BLOCKED**，不再由 Agent 换窗口、包装命令或申请额外权限重试。静态补审通过不能替代测试发现。

## 已核对的执行边界

原命令只应运行 `pnpm exec playwright test --config <临时配置> --list`。临时 CJS 配置是完整独立配置，不导入根配置：固定一个绝对 `testDir`、一个 `testMatch`，`webServer: []`、无 `globalSetup/globalTeardown`，只用内置 `line` reporter。不能改用 `pnpm test:e2e`，不能去掉 `--list`；去掉它会进入会创建 owned schema 的真实迁移专项。

已只读审查 spec、CSV helper、其传递依赖 EF helper 和 `scripts/test-environment.mjs`，并用 TypeScript AST 枚举函数体外调用；审查器只读取源码，没有 import 这些模块。顶层行为为注册一个测试、计算路径/常量、分配 Map/Set、生成内存 UUID，以及加载本地 `pg` 的连接参数模块。连接参数模块装载读取默认用户名环境值并定义解析器/类；没有实例化连接。数据库 Client 构造、capture、Docker 发现、文件证据读取、SQL 及 schema 操作位于未执行的函数体，专项入口仅在测试回调中调用。没有顶层 await、服务启动或 SQL 执行。`--list` 会实际加载模块，因此仍可能暴露模块解析错误，不能称它完全没有顶层行为。

`Use-ProjectRuntime.ps1` 会读取版本文件、检查本地 Node，并仅改变当前 PowerShell 的 PATH。pnpm/Playwright 会创建进程并读取现有依赖和测试模块，可能写自己的普通加载缓存；不承诺零本地文件写入。不需要读取或输出 `.env`、凭据、数据库 URL、登录状态，也不安装依赖。

以下原工作树输入的 SHA256 是人工步骤的绑定；任一不符即停，不自行换候选。证据保留在主控 `.local/csv-owned-review-followup/`，含原拒绝原文及只读 AST 审查器。

## 用户可选择在普通 Windows PowerShell 执行

这不是要求关闭安全控制或绕过组织策略。若本机同样拒绝，保留错误并停止；不切管理员、不改权限策略。先执行这一段，只核对运行时及源码：

```powershell
Set-Location -LiteralPath 'D:\工作项目\品维and知产\dev_cor\.local\worktrees\lead-csv-import-batch'
$ErrorActionPreference = 'Stop'
. .\Use-ProjectRuntime.ps1
if ((node --version).Trim() -ne 'v24.21.0') { throw 'Node version mismatch' }
if ((pnpm --version).Trim() -ne '11.27.0') { throw 'pnpm version mismatch' }
$csvExpected = @{
  'tests/e2e/lead-csv-import-migration.spec.ts' = 'A3815FF3D5AC68DCB5F7BFA5E1CD148D4425211FA0B711AE050C6C157599A856'
  'tests/support/lead-csv-import-migration-database.mjs' = 'B8B82B2B221D8D27A1E4A35C138BE4F24939C018C4315338B1DB327B2A94EA9C'
  'tests/support/case-execution-filing-followup-database.mjs' = 'C1111864769171BF4F122F2FD86C494AF32E0F19DE5F230622031374C61F179B'
  'scripts/test-environment.mjs' = 'A3E7863B1B02F2BD629A4EC882CFD26E1F7BFC7264FA3ABD62F534CD57A1CC27'
  'Use-ProjectRuntime.ps1' = '1142DC29CDE8ACB5D1CEEAE54556BFAF073457840DBA2BC13766C8F5B03E7369'
  'package.json' = '1882FC9062F487872C41F59D5B08AFEA91A607B81270D335AAB67DD6B57242EA'
  'pnpm-lock.yaml' = 'B75DEC2A4DB8560D1E6DBEF262AAF35BD9BEC766120121F3D32A9FAA436A4145'
}
foreach ($csvEntry in $csvExpected.GetEnumerator()) {
  if ((Get-FileHash -LiteralPath $csvEntry.Key -Algorithm SHA256).Hash -ne $csvEntry.Value) {
    throw ('Source hash mismatch: ' + $csvEntry.Key)
  }
}
'Runtime and source hashes match'
```

仅在上段成功后，创建一个新的临时配置并查看内容：

```powershell
$csvListConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('csv-owned-list-' + [Guid]::NewGuid().ToString('N') + '.config.cjs')
$csvListSource = 'module.exports = { testDir: "D:/工作项目/品维and知产/dev_cor/.local/worktrees/lead-csv-import-batch/tests/e2e", testMatch: "lead-csv-import-migration.spec.ts", webServer: [], globalSetup: undefined, globalTeardown: undefined, reporter: "line", workers: 1, retries: 0 };'
New-Item -Path $csvListConfig -ItemType File -Value $csvListSource -ErrorAction Stop | Out-Null
Get-Content -LiteralPath $csvListConfig
```

这个临时文件只含公开路径和测试选择器，不含凭据。独立配置避免装载项目默认 webServer 或自定义 reporter，绝对 `testDir` 避免把 Temp 当测试根。GUID 文件名和 `New-Item` 的无覆盖行为避免改已有文件。确认显示内容一致后，仅做发现：

```powershell
pnpm exec playwright test --config $csvListConfig --list
$csvListExit = $LASTEXITCODE
'CSV discovery exit code: ' + $csvListExit
```

成功预期：退出码 **0**，恰好 **1 个文件、1 项测试**，标题为 `checks three retained CSV owned-schema migration risk scenarios`。不会出现测试通过计数、迁移回放、SQL 或浏览器运行结果；这些都不在本操作范围内。结果为 0 项、多项、错误或出现服务/连接行为时立即停，不重试。请返回该测试标题、Total 行、退出码；失败只返回不含秘密的错误/堆栈和拒绝时刻。不要返回环境变量、`.env` 或私密 trace。

保留结果后，可在同一个 PowerShell 中单独删除本次配置。删除的仅是刚创建的单个 Temp 文件；不删测试、证据、schema、材料或任何目录。它不是测试运行必需步骤，可以先留存待核查。

```powershell
# 先核对显示的是本次 csv-owned-list-<GUID>.config.cjs 路径。
$csvListConfig
# 只在确认后执行；不要替换成目录、通配符或递归删除。
Remove-Item -LiteralPath $csvListConfig -ErrorAction Stop
```

若 PowerShell 关闭或变量丢失，不使用模糊搜索批量清理；按创建时的精确路径核对后再决定是否删除。原 Agent 命令的 finally 原本承担同一单文件清理，策略未给出具体拒绝原因，不能归因于删除步骤。

## 权限排障与证据状态

父级已核对官方 [Agent security](https://learn.chatgpt.com/docs/enterprise/agent-security) 与 [Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review)：云端协调审批和本机执行限制存在分层，不能承诺修改本机 config.toml 可解除当前 Task 限制。一次重试仍可能被拒；本次已用尽，不再推荐重复批准。不要盲改 Full Access、组织策略或关闭安全控制。

如用户希望向官方支持排查，可自行提供最小无秘密信息：任务 ID、上述准确 cwd/命令、拒绝时刻/`blocked by policy` 原文、进程未创建、应用版本。当前回执没有更具体政策原因，也没有读取到足以确认的“一键修复”路径；主控不自动向外部发送诊断。

人工发现即使成功，也只补 discovery 证据；真实 owned-schema、PG 取消/回滚、迁移、HTTP、浏览器和后续验收预算保持未执行、需单独准入。
