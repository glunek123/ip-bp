# 知产案件管理系统

Demo 位于 `demo/`，正式工程位于 `frontend/`、`backend/`。当前工程提供连接检查页与数据库健康接口，业务功能按部门确认的需求逐项加入。

## 恢复开发上下文

先阅读 [当前开发状态](docs/project-status.md) 和 [AI 开发规范](docs/ai-coding.md)。加载下方运行入口后执行 `pnpm context:check`；它会指出与最近核对快照不同的源码、配置或文档。

每次交付同步状态和相关文档，再显式执行 `pnpm context:record`、`pnpm verify`。前者仅记录已核对的文件，后者执行本地交付检查；语义审查与真实测试结果仍须如实记录。历史报告只对其当时版本有效。

收到 Demo 字段或规则文档时，按 [后续设计清单](docs/deferred-design.md)核对输入和待补能力。本地 Git 已建立，代码、文档和快照一起提交；未设置远程仓库或托管 CI。组件兼容、声明补丁及升级复验方法见 [组件兼容报告](docs/component-compatibility.md)。

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
pnpm dev
```

打开 [连接检查页](http://127.0.0.1:5173)。本地后端为 `http://127.0.0.1:3000`；健康接口为 `/api/v1/health`，OpenAPI 为 `/api/docs`（JSON 为 `/api/docs-json`）。前端开发代理转发 `/api`。

`setup:local` 生成随机本地密码，写入根 `.env`、`backend/.env` 与 `backend/.env.test`，文件均被 Git 忽略。重复运行保留已有配置；发现不一致会报错，不会覆盖。示例文件仅包含占位值。数据库端口为 55432，专用测试库为 55433，均仅绑定 `127.0.0.1`。凭据只用于本地工程，生产配置另行确认。

## 开发与检查

| 命令                | 用途                                                             |
| ------------------- | ---------------------------------------------------------------- |
| `pnpm dev`          | 并行启动 Vite 与 Nest 源码编译监听                               |
| `pnpm build`        | 生成 Prisma Client、检查前端类型并构建两端                       |
| `pnpm typecheck`    | 前后端严格 TypeScript 检查                                       |
| `pnpm lint`         | ESLint 检查，警告也阻断                                          |
| `pnpm format:check` | Prettier 格式检查                                                |
| `pnpm format`       | 修正正式工程和文档格式，跳过 Demo                                |
| `pnpm test`         | Vitest 文档同步检查器与前端行为测试、Jest/Supertest 后端契约测试 |
| `pnpm db:stop`      | 停止开发数据库，保留数据卷                                       |

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

当前 schema 仅定义 PostgreSQL 与 CJS Client 生成器，无业务模型或迁移。最后一条命令仅在确认业务模型、修改 schema 后执行。生成代码位于 `backend/src/generated/prisma`，由工具管理并忽略入库。不得手改生成文件，也不以 `db push` 代替迁移链。

## 依据与阶段结果

- [技术基线](docs/architecture.md)
- [开发规范](docs/conventions.md)
- [环境及版本报告](docs/environment.md)
- [第三步实施计划](docs/superpowers/plans/2026-09-15-engineering-foundation.md)

登录、权限、业务字段、附件存储、AI 和业财对接、生产部署仍按基线中的待确认事项推进。
