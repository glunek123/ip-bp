# 第三步：工程底座实施计划

**目标：** 将已批准的技术基线落实为可安装、可构建、可验证的前后端与本地数据库闭环。

**架构：** pnpm workspace 管理 frontend、backend；Vue/Vite 通过开发代理访问 NestJS `/api/v1/health`；NestJS 使用 Prisma CJS Client 和 PostgreSQL adapter 执行只读连接检查。数据库不可用返回 503，页面显示失败并允许重试。

**技术栈：** 准确版本来自 `docs/environment-lock.json`；不重新选型。

## 全局约束

- 每次 PowerShell 项目命令先点加载 `Use-ProjectRuntime.ps1` 并核对 Node、pnpm。
- Demo、业务表、登录权限、AI 和业财对接不在本次实现范围。
- 数据库仅绑定本机，独立 Compose 项目及卷；开发与测试分库、分容器。
- 只提供技术健康检查，无业务数据写入、迁移或生产发布。
- 根入口提供 dev、build、typecheck、lint、format:check、test、test:e2e。

## 任务与验收

- [x] 工程配置：根 `package.json`、`pnpm-workspace.yaml`、ESLint/Prettier，前后端 package/tsconfig；严格安装生成单一锁文件，冻结安装可复现。
- [x] 后端：`backend/src/app.module.ts`、`main.ts`、`common/`、`database/`、`health/`、`backend/prisma/schema.prisma`。先用 Jest/Supertest 定义健康、数据库失败、未知路由和请求编号契约，再实现。统一错误响应与输入校验；配置缺失启动失败；Prisma 生成并按 CJS 编译。
- [x] 前端：`frontend/src/app/`、`api/`、`styles/`。先用 Vitest 定义 fetch 错误处理与健康页面成功/失败/重试行为，再实现。复用 Demo 颜色和排版约定，仅提供工程连接页。
- [x] 本地数据库：`compose.yaml`、`.env.example`、`scripts/setup-local.mjs`。随机本地凭据写入忽略文件，启动 PostgreSQL 17.11 开发与测试容器。真实查询 `SELECT 1` 验证连通性。
- [x] 跨端：`playwright.config.ts`、`tests/e2e/health.spec.ts`。专用端口启动测试前后端，使用真实测试 PostgreSQL，验证成功、接口失败和重试；完成浏览器实测。
- [x] 交付：更新 `AGENTS.md`、技术基线状态、环境报告及 `README.md`，记录所有实际命令和验证结果。

## 执行与检查

配置先行；行为测试先观察失败，再实现并验证通过。按依赖顺序在当前工作区执行，复用已批准设计，不重复请求设计确认。

```powershell
. .\Use-ProjectRuntime.ps1
pnpm install
pnpm setup:local
pnpm db:up
pnpm --filter @dev-cor/backend db:generate
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
pnpm test:e2e
pnpm install --frozen-lockfile
```

最终审查覆盖原始验收范围、配置/秘密边界、错误分支、锁定版本、数据库隔离和真实浏览器证据；无业务 schema，迁移只提供命令，待确认业务实体后创建首个迁移。
