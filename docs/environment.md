# 开发环境与版本报告

检查日期：2026-09-15。范围：第一步复核、第二步版本选择与对齐、第三步工程环境实测。第三步验收结果见 [工程验收报告](engineering-verification.md)。

## 1. 第一步验收

| 验收项                                 | 结果                                             |
| -------------------------------------- | ------------------------------------------------ |
| 前后端、数据库、配套工具有唯一技术基线 | 通过，见 architecture.md                         |
| 目录止于模块层，业务模块按审核结果新增 | 通过，模块规划已落实为技术骨架，业务模块尚未创建 |
| 模块依赖、AI 回填和业财对接边界清楚    | 通过，未虚构供应商或业务协议                     |
| 接口、金额、日期、迁移和测试规范明确   | 通过，见 conventions.md                          |
| 未决的登录、权限、部署等有实施边界     | 通过，仅限制依赖该决定的工作                     |
| AI 读取入口及架构变更规则存在          | 通过，AGENTS.md 保留用户 CodeGraph 指引          |
| 文档本地链接和代码块闭合               | 自动检查通过                                     |

结论：第一步“技术基线文档定稿”已完成。第三步已进一步将相关工具规则落实为配置和可执行检查脚本。

## 2. 本机实际状态

| 项目           | 观测结果                                                                     | 判断                                                     |
| -------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------- |
| 系统           | Windows 10.0.26200，X64                                                      | 当前开发宿主                                             |
| Node.js        | 项目入口启用后 24.21.0                                                       | 已对齐；Codex 默认命令环境仍可能优先使用自带 24.19.0     |
| pnpm           | 11.27.0                                                                      | 已对齐，在项目 Node 环境下实测可用                       |
| npm            | 随项目 Node 分发                                                             | 项目依赖统一使用 pnpm                                    |
| Git            | 2.54.0.windows.1                                                             | FND-002 已初始化本地 main；无远程                        |
| Docker CLI     | 29.5.3                                                                       | 客户端可用                                               |
| Docker Compose | 5.1.4                                                                        | 客户端可用                                               |
| Docker 引擎    | Linux Server 29.5.3                                                          | 引擎连接成功，已创建项目开发与测试 PostgreSQL 容器       |
| PostgreSQL     | PATH 未找到 psql；未发现匹配的 Windows 服务、所查常见安装目录或 5432 监听    | 未确认可用数据库；不代表磁盘其他位置一定没有安装         |
| 外部元数据     | npm registry、Node 官方发布页、PostgreSQL 官方版本页和 Docker Hub 标签可访问 | 完成版本查询；一次长响应连接中断后改用精简元数据重试成功 |

本次收尾安装了用户目录下的项目专用 Node 24.21.0，并复核此前已升级的 pnpm 11.27.0。项目入口仅调整当前 PowerShell 的 PATH，不修改系统或用户永久 PATH，不替换 Codex 内置运行时。第三步已创建数据库；FND-002 已初始化本地 Git，基线提交 046f8be，无远程或托管 CI。

## 3. 版本基线

完整且唯一的准确包版本、Node engines 和 peerDependencies 检查结果见 [environment-lock.json](environment-lock.json)。它是版本选择及核对证据；实际安装锁文件为根 pnpm-lock.yaml。第三步已验证 48 项直接依赖声明与版本清单、实际安装版本一致（同一依赖在不同包中分别计数）。

CMP-01 保持 Vue/Element Plus/TypeScript 版本，前端显式增加已存在于依赖树的 @types/web-bluetooth 0.0.21。Element Plus 2.14.5 使用版本绑定、仅修改声明的 pnpm 补丁；实际包身份以锁文件 patchedDependencies 为准，补丁 SHA-256 和新增类型包依据写入版本清单 compatibility 节。安装与回归方法见 [组件兼容报告](component-compatibility.md)。

| 核心项                                         | 选定版本                           |
| ---------------------------------------------- | ---------------------------------- |
| Node.js                                        | 24.21.0 LTS                        |
| pnpm                                           | 11.27.0                            |
| Vue / TypeScript                               | 3.5.42 / 5.9.3                     |
| Vite / Vue 插件                                | 7.3.6 / 6.0.9                      |
| Vue Router / Pinia / Element Plus              | 4.6.4 / 3.0.4 / 2.14.5             |
| NestJS core、common、platform-express、testing | 11.2.4，保持同版                   |
| NestJS CLI / config / swagger                  | 11.0.24 / 4.0.4 / 11.4.7           |
| Prisma CLI、Client、PostgreSQL adapter         | 7.10.0，保持同版                   |
| PostgreSQL                                     | 17.11                              |
| ESLint / Prettier                              | 9.39.5 / 3.9.6                     |
| Vitest / Jest / ts-jest / Playwright           | 4.1.11 / 30.5.1 / 29.4.12 / 1.63.0 |

选择理由：固定成熟主版本内的稳定发布，保留 NestJS 11、Vue Router 4、Pinia 3、Vite 7 和 Prisma 7 的组合；TypeScript 5.9.3 同时满足 typescript-eslint 和 ts-jest 的声明范围。Node 24.21.0 为已核实的 LTS 补丁线发布。PostgreSQL 17 仍受官方支持，17.11 为该主版本当前修订版，不采用 beta。

查询发现不能直接使用 latest：本次 prisma 标签指向 8.0.0-rc.15；TypeScript latest 为 7.0.2，而 typescript-eslint 要求 `<6.1.0`，ts-jest 要求 `<7`。所选组合已避开这些声明冲突。

额外配套包均服务于既定工具：pg 和 Prisma adapter 连接数据库；reflect-metadata、rxjs 服务 NestJS；类型包服务 TypeScript；Vue 编译器与服务端渲染包满足 Vue 测试依赖并保持与 Vue 同版；jsdom 提供组件测试 DOM；解析器及插件落实 ESLint；ts-jest 连接 Jest 与 TypeScript。不是新增业务框架，也不是现在全部安装的要求。

本地数据库默认计划使用已有 Docker 工具运行独立 PostgreSQL 容器，仅用于开发，不决定生产部署方式。已核实 `postgres:17.11-bookworm` 标签存在且包含 amd64；镜像摘要保存在版本清单，现已按该摘要拉取并启动开发与测试容器。Docker 不可用时先定位引擎问题，不擅自换成 SQLite 或指定生产数据库。

## 4. 核对证据及已落盘约束

- 官方 npm registry 查询 46 个包的稳定准确版本，排除预发布版本。
- 用 npm 自带 semver 对选定 Node 版本和所选包间的 peer 范围执行 66 项比较，全部通过；缺失的必需 peer 为 0。
- 第二步检查仅覆盖引擎与 peer 声明；第三步已补充实际依赖安装、构建、浏览器、Prisma 生成和真实数据库连接验证。业务迁移尚无 schema，未执行。
- `.node-version` 写入 24.21.0，供版本管理工具使用；它不会自动升级或切换当前 PowerShell 的 Node。
- `.npmrc` 固定准确保存版本、严格引擎检查和严格 peer 检查；后续实际安装需使用项目根目录配置。
- 根 package.json 已固定 packageManager、engines，前后端包使用准确依赖版本；根 pnpm-lock.yaml 已生成并验证冻结安装。本地 Git 基线已保存；后续提交与验证见 [开发状态](project-status.md)。

## 5. 第三步落实结果

- pnpm workspace、前后端包、根检查命令和单一安装锁文件已建立。
- NestJS 与 Prisma Client 均按 CJS 编译；空业务 schema 可生成 Client，健康检查通过 Prisma 执行只读查询。
- 开发/测试 PostgreSQL 采用独立服务、账号、端口和存储。随机本地密码写入忽略文件，重复配置保持内容不变。
- 类型、Lint、格式、26 项单元/契约测试、构建与 2 项 Chromium 跨端测试结果见 [工程验收报告](engineering-verification.md)。
- 项目只交付技术骨架；业务模型、迁移、登录权限、真实 AI、业财对接和生产部署继续遵守待确认边界。

来源：[Node 24.21.0 发布说明](https://nodejs.org/en/blog/release/v24.21.0)、[PostgreSQL 支持周期](https://www.postgresql.org/support/versioning/)、[npm registry](https://registry.npmjs.org/)、[PostgreSQL 镜像标签](https://hub.docker.com/v2/repositories/library/postgres/tags/17.11-bookworm)。

## 6. 环境对齐收尾与使用方法

原系统路径 `D:\Program Files\node_js\node.exe` 已不存在。此前检测到的 24.19.0 来自 Codex 自带运行时，并非项目目标 Node。现在使用独立官方 Windows x64 分发包，存放于 `%LOCALAPPDATA%\dev-cor-runtime\node-v24.21.0-win-x64`。

在项目根目录，每个新的 PowerShell 会话先执行（开头的点和空格不可省略）：

```powershell
. .\Use-ProjectRuntime.ps1
node --version
pnpm --version
```

实测输出为 `v24.21.0` 与 `11.27.0`。后续自动化命令也应在同一个 PowerShell 调用内先加载入口，再执行安装、构建等操作。仅写入 `.node-version` 不会自动切换 Node。

安装来源为官方 [Windows x64 ZIP](https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip)，与官方 [SHA-256 清单](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt) 比对一致：`158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`；解压后 `node.exe` 的 Authenticode 状态为 `Valid`。

复核 Docker Server 为 29.5.3，Compose 为 5.1.4。第三步已完成项目依赖安装、容器启动、构建与数据库闭环验证。

换机器时需按上述来源下载并校验 ZIP，解压到同样的用户目录结构；运行入口在文件缺失或版本不符时会明确报错。
