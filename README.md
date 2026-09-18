# 品维·知产业务管理系统

Demo 位于 `demo/`，正式工程位于 `frontend/`、`backend/`。当前工程提供连接检查页与数据库健康接口，业务功能按部门确认的需求逐项加入。

## 恢复开发上下文

新任务先阅读[当前开发状态](docs/project-status.md)，检查Git现场并只加载相关模块的Spec、源码和测试；上下文压缩／中断恢复、快照漂移或流程治理时再读[AI开发规范](docs/ai-coding.md)。加载下方运行入口后执行`pnpm context:check`，它会指出与最近核对快照不同的源码、配置或文档。

开发任务按[三级开发与集成规则](.cursor/rules/verified-feature-integration.mdc)选择Level 1／2／3。开发循环优先定向测试和`pnpm check:fast`；`pnpm verify`只在Level 3、完整业务切片、合并`main`前、核心架构变更或怀疑跨模块回归时运行。数据库E2E按风险单独触发，相同候选不重复全量验证。

收到 Demo 字段或规则文档时，按 [后续设计清单](docs/deferred-design.md)核对输入和待补能力。GitHub远端已配置，代码、文档和快照一起提交；当前未见托管CI强制证据。组件兼容、声明补丁及升级复验方法见 [组件兼容报告](docs/component-compatibility.md)。

## 本机准备

每个新的 PowerShell 会话在项目根目录先执行：

```powershell
. .\Use-ProjectRuntime.ps1
node --version
pnpm --version
```

版本必须与 `.node-version` 和 `docs/environment-lock.json` 一致。入口安装方式见 [环境报告](docs/environment.md)。

首次安装与配置：

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
pnpm db:up
pnpm db:migrate:deploy
pnpm auth:bootstrap-local --department "知产部" --username admin --display-name "系统管理员" --expected-db-host 127.0.0.1 --expected-db-port 55432 --expected-db-name dev_cor
pnpm dev
```

初始化命令会在终端中安全读取密码，不接受密码参数，也不会显示密码。命令要求操作者显式填写预期数据库的 host、port 和 database；程序会将三项逐一与实际 `DATABASE_URL` 比对，并且只允许 `development`／`test` 模式下的本机 PostgreSQL。任一项不符都会在读取密码或写库前终止。它只允许在没有任何本地账号或部分初始化痕迹时运行一次；后续人员账号管理属于下一切片。完成后打开[登录页](http://127.0.0.1:5173/login)。本地后端为 `http://127.0.0.1:3000`；健康接口为 `/api/v1/health`，OpenAPI 为 `/api/docs`（JSON 为 `/api/docs-json`）。前端开发代理转发 `/api`。

若页面显示“无法连接服务”，先确认 Docker Desktop 已启动，再依次运行 `pnpm db:up`、`pnpm db:migrate:deploy` 和 `pnpm dev`。未登录访问客户页面会转到登录页，不再把 HTTP 401 显示为连接失败；只有浏览器确实连不到后端时才显示连接错误。

`setup:local` 生成随机本地密码，写入根 `.env`、`backend/.env` 与 `backend/.env.test`，文件均被 Git 忽略。重复运行保留已有配置；发现不一致会报错，不会覆盖。示例文件仅包含占位值。数据库端口为 55432，专用测试库为 55433，均仅绑定 `127.0.0.1`。凭据只用于本地工程，生产配置另行确认。

**首次启动或本地环境异常**（后端启动时报 `NODE_ENV`、`DATABASE_URL` 或 `AUTH_THROTTLE_SECRET` 校验失败）：

```powershell
pnpm setup:local
```

`setup:local` 是本地环境的唯一初始化入口：缺失的 `AUTH_THROTTLE_SECRET` 会自动生成（32 随机字节、hex 编码），已有配置不会被覆盖，且不打印任何秘密值。**不要手工复制真实 Secret**，也不要提交真实 `.env`。

## 开发与检查

| 命令                        | 用途                                                             |
| --------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                  | 并行启动 Vite 与 Nest 源码编译监听                               |
| `pnpm db:migrate:deploy`    | 将仓库内已有迁移安全应用到本地开发库                             |
| `pnpm auth:bootstrap-local` | 一次性创建首位本地管理员（还需显式确认数据库 host/port/name）    |
| `pnpm build`                | 生成 Prisma Client、检查前端类型并构建两端                       |
| `pnpm typecheck`            | 前后端严格 TypeScript 检查                                       |
| `pnpm lint`                 | ESLint 检查，警告也阻断                                          |
| `pnpm check:fast`           | 普通开发的快速静态门禁：类型检查＋Lint                           |
| `pnpm format:check`         | Prettier 格式检查                                                |
| `pnpm format`               | 修正正式工程和文档格式，跳过 Demo                                |
| `pnpm test`                 | Vitest 文档同步检查器与前端行为测试、Jest/Supertest 后端契约测试 |
| `pnpm verify`               | context、Spec、类型、Lint、格式、单元／契约测试及前后端构建      |
| `pnpm test:e2e`             | 独立启动当前候选应用并对专用PostgreSQL执行Playwright；verify不含 |
| `pnpm context:record:light` | 仅为已核对的Demo／前端样式改动记录轻量快照；其他路径会拒绝       |
| `pnpm db:stop`              | 停止开发数据库，保留数据卷                                       |

后端启动需要显式配置 `NODE_ENV`、`PORT`、`DATABASE_URL`；默认只监听本机。健康接口执行 Prisma `SELECT 1`，数据库不可达返回 503 和统一错误结构；成功仅表示本次检查通过。每个请求生成内部请求编号，并返回 `X-Request-Id`。

端到端测试先启动独立测试库和安装浏览器：

```powershell
pnpm db:test:up
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

测试使用后端 3101、前端 5174 和 `backend/.env.test`；不会复用已经启动的应用。测试包含真实 PostgreSQL 连通性、失败展示及重试恢复。HTML 报告位于 `playwright-report/`，截图和失败追踪位于 `test-results/`。测试库使用临时内存文件系统；可用 `docker compose --profile test stop postgres-test` 停止测试库。应用测试进程由 Playwright 管理。

## Prisma 与数据

```powershell
pnpm --filter @dev-cor/backend db:generate
pnpm --filter @dev-cor/backend db:validate
pnpm --filter @dev-cor/backend db:migrate --name approved-change
```

普通本地启动使用根命令 `pnpm db:migrate:deploy` 应用仓库内已批准的迁移。只有开发新的已批准 schema 变更时才使用最后一条 `db:migrate --name` 命令生成迁移。生成代码位于 `backend/src/generated/prisma`，由工具管理并忽略入库。不得手改生成文件，也不以 `db push` 代替迁移链。

## 依据与阶段结果

- [技术基线](docs/architecture.md)
- [开发规范](docs/conventions.md)
- [环境及版本报告](docs/environment.md)
- [第三步实施计划](docs/superpowers/plans/2026-09-15-engineering-foundation.md)

本地正式账号登录第一切片已实现；人员账号管理、密码重置、MFA、外部 OIDC、附件存储、AI、业财对接和生产部署仍按基线中的待确认事项推进。
