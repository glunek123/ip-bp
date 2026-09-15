# 第三步工程验收报告

> 历史验收：本报告适用于下方记录的第三步候选版本。后续改动与最新验证以 [当前开发状态](project-status.md) 为入口；本报告的通过结论不会自动覆盖新版本。

日期：2026-09-15。状态：**VERIFIED（本地工程底座）**。

## 交付范围

- pnpm workspace 管理独立 Vue/Vite 前端和 NestJS 后端，单一安装锁文件。
- 前端连接检查页通过统一 fetch 接口层访问 `/api/v1/health`，包含加载、成功、失败和重试；组件按需使用 Element Plus，设计变量来自 Demo。
- 后端通过 Prisma PostgreSQL adapter 执行 `SELECT 1`，成功返回 `{ status: 'ok', database: 'up' }`，数据库不可用返回 503。
- 明确的启动配置校验、请求编号、统一错误结构、输入白名单和 OpenAPI；日志只记录安全的诊断类型/错误码，不输出原始连接串。
- PostgreSQL 17.11 使用锁定镜像摘要，开发与测试为独立容器、账号和端口，均仅监听本机。开发数据使用独立卷，测试使用临时内存文件系统。
- 本地随机凭据初始化脚本、环境示例、开发编译监听、检查入口和启动文档。

范围以 `architecture.md`、`conventions.md` 和用户批准的第三步为准。Demo 未改动；当前无业务表、迁移、登录/权限、AI 或业财真实对接，也没有生产部署。

## 实际验证

所有项目命令均先在同一 PowerShell 中点加载 `Use-ProjectRuntime.ps1` 并核对 Node 24.21.0、pnpm 11.27.0。

| 验证                                         | 结果 | 证据与边界                                                                         |
| -------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| `pnpm install`                               | PASS | 完整依赖安装及安装脚本完成                                                         |
| `pnpm install --frozen-lockfile`             | PASS | 锁文件保持有效，无需修改依赖解析                                                   |
| 清单/实际版本对比                            | PASS | 48 项直接依赖声明与选型清单、实际安装版本一致；重复包按声明位置计数                |
| `pnpm setup:local` 重复执行                  | PASS | 三个本地环境文件前后 SHA-256 相同，现有配置未覆盖                                  |
| Compose 开发库与测试库启动                   | PASS | 两服务 healthy，分别执行 `SELECT 1` 返回 1                                         |
| `pnpm --filter @dev-cor/backend db:generate` | PASS | 空业务 schema 成功生成 Prisma 7.10 CJS Client                                      |
| `pnpm --filter @dev-cor/backend db:validate` | PASS | schema 有效                                                                        |
| `pnpm typecheck`                             | PASS | 前后端及 Playwright 配置/测试严格类型检查；未开启 skipLibCheck                     |
| `pnpm lint`                                  | PASS | 零错误、零警告                                                                     |
| `pnpm format:check`                          | PASS | 所有匹配文件通过；Demo、生成文件和锁文件按配置排除                                 |
| `pnpm test`                                  | PASS | 前端 9 项；后端 17 项                                                              |
| `pnpm build`                                 | PASS | 两端构建完成；前端主 JS 约 121 kB（gzip 约 47 kB）                                 |
| `pnpm dev`                                   | PASS | 首次编译启动成功；源码修改触发重新编译和后端重启；经 Vite 代理访问健康接口返回 200 |
| `pnpm test:e2e`                              | PASS | Chromium 2 项通过，连接真实测试 PostgreSQL，验证 OpenAPI、失败展示与重试恢复       |
| 桌面/手机截图检查                            | PASS | 1280 桌面与 390 手机宽度下布局清晰，无横向溢出；浏览器无 pageerror                 |

测试报告：根 `playwright-report/`；截图：`test-results/connection-desktop.png`、`test-results/connection-mobile.png`。这些运行产物不入库。测试应用由 Playwright 自动退出；验收结束后已停止测试数据库，开发数据库保留。

## 测试与审查覆盖

先在最小骨架上观察健康契约、输入校验、错误结构和页面状态测试失败，再实现并验证通过。配置校验与 fetch 成功路径先通过 Node 原生断言复现缺失行为，再由 Jest/Vitest 覆盖完整行为。

测试覆盖数据库失败 503、请求编号生成、响应脱敏、非法字段/类型/边界、网络/代理错误、超时、取消、错误响应结构、重试恢复。真实数据库成功路径由浏览器跨端测试验证；数据库失败分支使用受控替身，不声称进行过生产故障测试。

独立只读审查发现并关闭：

1. 开发入口原先只监听构建结果；改为基线中的 Nest CLI 编译监听，实测源码变化后重启成功。
2. 代理 502 曾被误认为后端响应；新增失败回归测试，并要求后端错误契约中的请求编号和错误码。
3. 数据库失败诊断丢失；保留异常 cause，记录白名单诊断字段，并验证密码不会进入日志或响应。

最终复审结论：无剩余阻断项。

## 依赖与实施说明

没有增加技术基线以外的直接依赖。Nest CLI 用于真实开发编译监听；Prisma adapter、pg、编译器与各测试工具均来自第二步清单。金额等尚未使用的基线依赖按功能需要再安装。

pnpm 安装脚本按包明确允许或拒绝：允许 Prisma 引擎、esbuild、原生 watcher/resolver 的必要安装，拒绝 Scarf 安装统计、Nest 安装提示和 Prisma Client 隐式生成（使用明确的 `db:generate`）。保留严格 engines、peer 和安装检查；`verifyDepsBeforeRun: error` 要求依赖不一致时显式安装，避免运行测试时隐式修改依赖。

pnpm 对已批准的五个准确版本生成了发布时间例外，已保存在 workspace；`minimumReleaseAgeStrict: true` 保留后续新增版本的门禁。安装过程出现网络重试，最终成功。ESLint 9.39.5 和间接依赖 glob 10.5.0 有上游弃用提示，本次遵循既定版本，不擅自更换框架或跳过检查；后续工具链升级单独评估。

Element Plus 全量入口包含未使用组件的声明兼容问题；当前按需导入实际按钮组件与样式，通过完整类型检查。以后增加组件时需实测其类型与运行行为。

## 未实施事项与下一阶段

- 未创建任何业务表或业务迁移；按已确认实体增加首个 Prisma migration，届时再验证迁移与数据一致性。
- 登录、权限、附件存储、业务流程、AI、业财及生产部署仍按技术基线的未决边界处理。
- 当前目录尚未初始化 Git 仓库，没有 commit、远程、CI 托管或生产部署配置；本报告对应本地工作区文件。
- 资源路径为单写入 Agent + 独立只读审查；Spark Worker 当前不可用。实际 Token、额度及费用不可观测，记为 unknown。

启动与复验步骤见 [README](../README.md)。

## 候选源码指纹

源码、测试、脚本与工程配置共 53 个文件的 SHA-256 汇总：

`4ec83d83082fea3b65f89cd56115ab3926802f725f704c20b041dbab97b318b2`

算法：相对路径排序，对每个文件内容计算 SHA-256，再按“路径 + NUL + 文件哈希 + LF”连接计算 SHA-256。包含 AGENTS.md 与运行入口，排除生成代码、依赖目录、运行结果、秘密文件和说明文档。
