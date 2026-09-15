# 项目开发指引

本项目为知产案件管理系统。当前阶段与未完成工作以 [开发状态](docs/project-status.md) 为准。

## 开始、恢复与交付（必须执行）

- 每个新任务及上下文压缩/中断恢复后，先读取 [开发状态](docs/project-status.md) 和 [AI 开发规范](docs/ai-coding.md)，再核对相关源码；聊天记忆不能替代这些文件。
- 按下节加载运行环境后执行 `pnpm context:check`。缺失或漂移表示需要检查真实改动、恢复检查点；不得直接刷新快照、回退代码或沿用旧验收结论。
- 开工与有效检查点更新开发状态；同次交付同步受影响文档、实际验证和未决项。文档核对并格式化后显式 `pnpm context:record`，执行 `pnpm verify`；涉及跨端行为再执行 `pnpm test:e2e`。记录快照不等于测试通过。
- 当前只允许通用底座维护、规范完善和用户明确授权的工作。用户指定 Demo 反向整理后，先区分已确认需求、Demo 观察和推断，再按获准需求开发业务模块；不自行将 Demo 转成业务表、角色权限或外部协议。
- 收到字段或规则文档时，必须读取 [后续设计清单](docs/deferred-design.md)，登记输入版本、来源及确认依据，逐项检查触发条件，建立需求—设计—实现—测试映射。文档到齐不等于业务已实现；外部条件分别确认，只有设计、实现及验证齐全才能关闭事项。

## 按任务读取

- 搭建工程、选择依赖、增加模块或调整目录前，读取 [技术基线](docs/architecture.md)。
- 准备运行环境、安装依赖或生成工程前，读取 [环境报告](docs/environment.md)，使用其中链接的准确版本清单。
- 编写或修改正式系统代码、接口、数据库、测试及外部对接前，读取 [开发规范](docs/conventions.md) 中相关章节。
- 修改 Demo 页面前，读取 `demo/DESIGN.md`。Demo 作为审核参考，正式系统与其分目录维护。
- 业务实现以用户确认的需求为依据；Demo 的字段、流程、角色和演示数据不等于已批准需求。

## PowerShell 项目运行环境（必须执行）

执行项目的 Node、pnpm、依赖安装、工程生成、开发、构建或检查命令前，先在项目根目录的同一 PowerShell 会话中加载：

```powershell
. .\Use-ProjectRuntime.ps1
```

- 使用点加载（开头的点和空格不可省略），让项目 Node 路径进入当前会话的 PATH。随后再执行项目命令。
- Codex 每次新建 PowerShell 进程或发起独立 shell 工具调用时，都必须在该次调用内先加载入口；不能假定上次调用的 PATH 会保留。在子目录执行时，使用项目根目录下入口脚本的绝对路径。
- 加载后核对 `node --version` 与 `.node-version`、`pnpm --version` 与 `docs/environment-lock.json` 中的 `runtime.pnpm` 一致，再继续。Codex 默认环境可能优先使用其自带 Node，`.node-version` 本身不会切换运行时。
- 入口缺失、加载失败或版本不符时，停止依赖该运行时的命令，按 [环境报告](docs/environment.md) 修复并重新验证；不得回退到默认 Node 继续安装或构建。

## 工作约束

- 技术选择遵循技术基线；查找并复用已有实现后再新增能力。
- 未决事项按技术基线中的处理边界执行，仅暂停依赖该决定的工作，继续其他已授权工作。
- 新增依赖需在交付说明中解释现有工具为何不足；替换框架、增加同类工具或独立服务，先提出影响和迁移方案。已有明确用户授权时直接执行并同步文档。
- 目录先确定到模块层；按已确认需求增加具体业务模块，不批量生成待审核业务代码、表结构或空接口。
- 检查命令以实际 `package.json` scripts 和工具配置为准：`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build`。跨端测试先 `pnpm db:test:up`、`pnpm build`，再 `pnpm test:e2e`；首次需安装 Playwright Chromium，详见 [启动说明](README.md)。
- 新增 Element Plus 控件按需导入实际组件和样式。CMP-01 使用版本绑定的声明补丁；全量 ESM/CJS 入口持续纳入前端类型检查，说明见 [组件兼容报告](docs/component-compatibility.md)。升级依赖时复核补丁与交互，不以 `skipLibCheck`、any 或开放全局索引签名绕过问题。
- 本地开发库与测试库由根 `compose.yaml` 管理。测试必须使用 `backend/.env.test` 中的独立测试库；保留已有 `.env` 文件和开发数据卷，不打印或提交凭据。
- 每次交付说明改动、实际验证结果和未完成事项。规则与配置冲突时查清原因并同步修正，不能靠关闭检查掩盖问题。

<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
