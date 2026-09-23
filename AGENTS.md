# 项目开发指引

本项目为知产案件管理系统。默认策略是“风险分级＋按需上下文＋自动化门禁”；当前阶段和未决项以[开发状态](docs/project-status.md)为准，具体验证强度只由[三级开发与集成规则](.cursor/rules/verified-feature-integration.mdc)定义。

## 最小启动与恢复

- 新任务先读开发状态，检查`git status`和已有差异，再只读当前模块的Spec、源码和直接测试。上下文压缩／中断恢复、快照漂移、跨会话任务或流程治理时再读[AI开发规范](docs/ai-coding.md)；聊天记忆不能替代现场。
- 加载下节运行环境并执行`pnpm context:check`。普通模式报告漂移，由任务结合`git status`／diff判断是否重叠；Level 3、Merge、Release与完整门禁使用`pnpm context:check:strict`阻断未解释漂移。不直接刷新快照、回退代码或套用旧验证。
- Level 1短任务无需开工／收口两次改状态。只有Level 3、跨会话／可中断任务、阶段变化、业务／架构决定或需要他人恢复时更新开发状态；其余任务以Git差异和验证结果交付。
- 用户需求明确时直接分析、实现和验证。只有产品方向分叉、不可逆数据影响、关键架构变化、与已批准规则冲突或缺少不可合理推断的业务信息时暂停询问。

## 按需上下文

- 新增模块、依赖或调整目录时读[技术基线](docs/architecture.md)；准备环境、安装或生成工程时读[环境报告](docs/environment.md)。
- 修改正式代码、接口、数据库或测试时，只读[开发规范](docs/conventions.md)的相关章节；真实数据、访问控制、共享迁移或发布必须再读安全／迁移／上线章节。
- 新字段、规则或流程改变时读对应Living Spec和最近Decision；收到外部字段／规则文档时再读[后续设计清单](docs/deferred-design.md)。纯实现细节、小型重构、文案和样式不扩写业务设计文档。
- 修改Demo时读`demo/DESIGN.md`。Demo仅是审核参考，不代表正式业务规则获批。
- Skills按问题触发：复杂设计用设计类，真实故障用调试类，浏览器验证用测试类，高风险验收用验证类；普通开发不叠加方法论Skills。按可独立验收的任务边界使用子Agent，大范围审查或高风险发布前Review可交给独立子Agent；避免多个Agent重复研究或实现同一问题。
- Agent模型分工：主Agent和独立Reviewer，以及架构、高风险Command、并发、迁移审查使用`gpt-6-sol`；边界清晰的子Agent任务（跑测试、分析失败日志、补简单Spec、同步API类型、更新文档、查漏项）使用`gpt-6-luna`。

## PowerShell运行环境

每次新建PowerShell进程并执行Node、pnpm、安装、生成、构建或检查命令前，在项目根目录点加载：

```powershell
. .\Use-ProjectRuntime.ps1
```

随后核对`node --version`与`.node-version`、`pnpm --version`与`docs/environment-lock.json`中的`runtime.pnpm`。入口失败或版本不符时停止相关命令，不回退到默认Node继续。

## 实施与安全边界

- 保留并区分用户、其他任务和本轮改动；不覆盖、丢弃或混入无关差异。破坏性Git、持久化数据删除、数据库重置、生产写入、推送和发布只按明确授权范围执行。
- 业务实现以用户确认的Spec／Decision为依据；仅暂停依赖未决事项的部分。后端承担权限与数据范围校验，前端隐藏不构成授权。
- 复用现有模块和工具。新增依赖需说明现有能力为何不足；框架替换、同类工具或独立服务先给出影响与迁移方案。
- Element Plus继续按需导入并遵守[组件兼容报告](docs/component-compatibility.md)；不以`skipLibCheck`、`any`或开放索引签名绕过检查。
- 开发库与测试库由`compose.yaml`管理；数据库测试只使用`backend/.env.test`的独立测试库，不打印或提交凭据。

## 验证与交付

- 开发循环运行直接相关测试；快速静态门禁使用`pnpm check:fast`。稳定候选直接运行所属正式门禁，不在tree未变化时紧邻重复门禁已经包含的检查。普通Level 2使用显式切片门禁，不默认完整`verify`、完整数据库E2E或独立Review；Level 3先Review和修复，再在稳定候选集中执行最终门禁。`pnpm verify`用于Level 3、未验证的新组合tree、Release、核心架构变更或跨模块回归怀疑。最终tree与可信证据完全一致时复用；没有可靠依赖图时不自动推导affected范围。
- 没有可靠依赖图时不伪造`test:affected`；直接用workspace过滤和测试文件／名称选择器运行相关Jest、Vitest或Playwright。
- 相同候选和输入的可信结果直接复用。失败后只重跑被修改输入影响的聚焦检查，最终稳定候选再执行所属层级门禁。
- 收口同步真正受影响的Spec、Decision、架构或运行说明。最终报告只列完成内容、实际验证、已知风险和必要下一步，不输出命令流水账。
- 工作区按三级规则选择和收尾：同一任务及单人串行新任务优先复用合适目录，只有并行、现场冲突或环境不兼容时新建临时worktree；可复用目录保留，临时目录才在远端核实后安全清理，脏现场先保全。

<!-- CODEGRAPH_START -->

## CodeGraph

存在根`.codegraph/`时，理解或定位代码先用`codegraph_explore`或`codegraph explore`；不可用、过期或不完整时说明限制并回退到`rg`和源码。没有`.codegraph/`时直接搜索，不自行建索引。

<!-- CODEGRAPH_END -->
