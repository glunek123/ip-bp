# AI开发与上下文恢复规范

## 目标与单一事实源

默认采用“风险分级＋按需上下文＋自动化门禁”：减少重复阅读、确认、文档和全量验证，同时保留正式系统必需的安全与质量证据。三级模式和测试强度只在[三级开发与集成规则](../.cursor/rules/verified-feature-integration.mdc)定义，本文件只负责上下文、恢复和文档同步。

| 信息                                           | 唯一来源                                                  | 何时读取／更新                   |
| ---------------------------------------------- | --------------------------------------------------------- | -------------------------------- |
| 全部Slice实现状态、依赖顺序和唯一Current／Next | [feature-roadmap.md](feature-roadmap.md)                  | 能力状态实质变化时更新           |
| 当前任务指针、恢复事实、当前限制和下一动作     | [project-status.md](project-status.md)                    | 长任务、阶段或恢复信息变化时更新 |
| 业务规则与验收                                 | 对应Living Spec／Decision                                 | 相关功能或语义变化时             |
| 实际验证候选、结果和证据边界                   | [VALIDATION.md](spec/v0.1/VALIDATION.md)                  | 有真实新证据时增量记录           |
| 当前Slice的实施任务                            | 对应开发计划                                              | 实施边界变化时更新，不作完成台账 |
| 技术边界与待决架构                             | [architecture.md](architecture.md)                        | 新模块、依赖、目录或架构分叉时   |
| 开发、安全、迁移和上线规范                     | [conventions.md](conventions.md)                          | 只读本任务相关章节               |
| 环境与版本                                     | [environment.md](environment.md)、`environment-lock.json` | 安装、生成、环境异常或升级时     |
| 实际依赖、schema和命令                         | 源码、配置、`package.json`、锁文件                        | 直接查看，不在文档复制清单       |
| 已核对文件版本                                 | `context-snapshot.json`                                   | 核对真实差异后显式记录           |

用户确认的需求决定“应该做什么”，源码和当次验证说明“已经做成什么”。历史报告只对其候选有效，不能替代当前现场。

## 按需加载

1. 新任务读取根`AGENTS.md`、开发状态，检查`git status`和已有diff；随后只读当前模块的Spec、源码和直接测试。
2. 上下文压缩／中断恢复、快照漂移、跨会话任务或流程治理时才通读本文件。模块边界、环境、安全、迁移和发布文档按`AGENTS.md`触发，不做全量预读。
3. 用户范围明确即直接执行；不把需求重复拆成设计确认、计划确认和编码确认。只有产品方向分叉、不可逆影响、关键架构变化、规则冲突或关键业务信息缺失时询问。
4. Skill只在对应问题出现时加载；方法论、审查和浏览器工具不是普通任务的固定仪式。
5. 一个独立业务Slice尽量保持一个连贯任务会话；新Slice按现场和必要文件启动，不持续携带整个项目的对话历史。后续优先读取变更diff、相关段落和失败日志，完整输出留在已有本地报告或CI产物中。

## 多 Agent 协作路由

只在任务可独立验收且并行或交接确有收益时派发子Agent；主Agent负责全局契约、风险裁决、集成和最终质量。Agent模型路由与Level 1／2／3验证分级分别判断：普通前向迁移可以是Level 2，但migration Task仍按下表使用Sol和独立审查。

| Task性质                                                                                                                                 | 执行模型与交接                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 架构裁决、跨模块公共契约、核心Command／状态机、schema／migration、权限／安全／企业隔离、事务／并发／锁／幂等、不可逆操作                 | `gpt-6-sol`执行；聚焦测试后由另一名`gpt-6-sol`独立Review，通过后集成。  |
| 方向已定的普通实现、简单Spec／DTO／API类型同步、fixture／helper、普通UI接线、测试与普通失败修复、文档／roadmap／progress、格式和静态检查 | `gpt-6-luna`执行；自审、聚焦测试、简报交接，默认不设独立Task Reviewer。 |

Luna遇到架构或公共契约变更、schema／migration、权限或安全边界、事务／并发／幂等、业务语义不明、Brief与现场冲突，或必须明显扩围时，立即停止扩大修改并升级主Agent；由主Agent裁决或改派Sol，不让Luna自行重构。

派发Brief只含Goal、允许文件、相关接口／契约、验收条件、必要测试、禁止改动和关键业务约束；以文件指针或局部摘要交接，不复制项目历史、完整设计讨论和其他Task报告。每个子Agent按下列字段简报；普通Luna报告为PASS、无风险且公共契约未变时，主Agent核对报告、文件清单、diff摘要和测试结果即可集成；出现越界、缺证据、失败或契约风险再展开源码／完整diff，不重做同一Task。

```text
Task:
Model:
Commit:
Changed files:
Tests executed:
Result: PASS / FAIL
Contract changes:
Self-review findings:
Known risks:
Requires Sol attention: YES / NO
```

测试分层：Worker运行本Task聚焦测试及必要的类型／构建检查；高风险Reviewer只按finding补针对性验证，不默认复跑Worker测试；主Agent在阶段集成后运行集成测试和快速门禁。所有Task集成为固定候选后，由独立`gpt-6-sol`做一次Final Review，修复并关闭finding后再运行Level 3完整门禁及适用数据库E2E／迁移专项。同一tree及输入的可信结果直接复用；Level 3已运行完整`verify`与对应E2E时，不为重复覆盖额外运行Slice门禁，除非该Slice证据是明确交付要求。普通技术失败由Luna在原Task内修复；首次暴露上述高风险或语义冲突即升级Sol。

既有实施计划或方法Skill若要求每个Task都配独立Reviewer，普通Task按本节风险路由执行；高风险Task与集成后Final Review仍不可省略。

## 状态与检查点

- Level 1同会话短任务不改开发状态。Level 2只在业务状态变化、跨会话或需要恢复时更新；Level 3、阶段切换、业务／架构决定和阻断必须留下简短检查点。
- 状态只写任务、范围、依据、真实验证和未决项；命令流水、反复尝试和详细审查留在既有验证记录或Git，不新建重复台账。
- 开工执行`pnpm context:check`；它报告漂移但不因普通文件漂移失败，当前任务必须结合列出的文件、最近提交和工作区判断是否重叠。Level 3、Merge、Release和完整`verify`使用`pnpm context:check:strict`，未解释漂移会失败。两种模式下都不得通过刷新快照掩盖未知改动。
- 已检查最终diff且差异仅位于`demo/`或`frontend/src/styles/`时，可使用`pnpm context:record:light`记录快照；工具会拒绝源码、配置、治理、Spec和其他路径。其余任务在核对真实差异后使用标准`pnpm context:record`。标准记录不再机械要求状态文件同时变化；是否更新状态只由阶段、活动Slice、阻断、重要风险、架构、Merge／Release或跨会话恢复信息的语义变化决定。
- 快照是文件一致性检查，不是测试或批准。候选冻结、门禁及门禁后的记录顺序和非执行性文档例外，只按[三级规则](../.cursor/rules/verified-feature-integration.mdc#文档skills与review)执行；不能把旧候选证据标成新tree实际执行，也不能仅凭文件扩展名省略验证。

### 状态对齐顺序

阶段或活动Slice变化时按以下顺序维护，避免多个入口分别推进：

1. 先以当前代码、Git提交／tree和真实Evidence确定“已经做成什么”，历史候选不得覆盖较新的合并候选。
2. 只在`feature-roadmap.md`设置唯一Current／Next及能力状态；`project-status.md`的“当前任务”只引用同一个Current并记录恢复所需边界，不再维护竞争顺序。
3. 实际验证候选、结果和证据边界写入`VALIDATION.md`；模块Spec只维护业务契约与AC，项目状态只保留最新可复用证据摘要，不复制完整流水，开发计划不更新动态验收状态。
4. 最后执行标准`context:record`并运行`context:check:strict`。检查器会拒绝项目状态当前任务与路线图Current Slice编号不一致、Current／Next相同或标题不唯一；通过只表示文本和指针一致，不替代业务验证。

## 文档同步

只有以下变化更新对应Spec／Decision：业务规则、字段语义、状态机、Workflow、权限、API契约、数据结构或重要架构决定。纯实现细节、小型重构、文案、样式和局部交互只在代码与测试中表达。

收到外部字段／规则文档时读取[后续设计清单](deferred-design.md)，登记版本／来源／确认依据并只更新受影响映射。Demo观察、外部文档到齐和测试通过都不自动代表业务批准或生产准入。

## 分级验证入口

- 开发循环可在有本任务未提交修改的工作区直接运行定向单元／契约、过滤E2E和`check:fast`，不要求提前提交、创建evidence或额外worktree。正式`verify:slice:*`才要求干净固定候选并生成证据。
- 正式scope的命令与Level以`package.json`、`scripts/validation-scopes.mjs`为准；已配置的Slice入口组合一次Prisma准备、定向单元／契约、prepared静态检查、Slice格式、prepared后端构建及对应数据库E2E。若某个Level 2 Slice暂无对应scope，按[三级规则](../.cursor/rules/verified-feature-integration.mdc#紧凑执行循环)在固定候选上逐项验证并记录，不临时编造scope或降级；规则／字段语义／公共契约变化时另运行`pnpm spec:check`，普通迁移另运行迁移专项。
- 开发期按需运行最小相关测试；稳定候选直接运行所属正式门禁，不在tree未变化时紧邻重复门禁已经包含的检查。Level 3先Review和修复，再在稳定候选集中执行最终门禁；最终验证失败后的修复形成新候选，重新判断失效范围，不复用不匹配的旧结果。
- `pnpm verify:slice:auth`和`pnpm verify:slice:core-ld`只提供Level 3聚焦候选证据，不替代完整`pnpm verify`、适用数据库风险专项与Review。
- 数据库入口以`package.json`的`test:e2e:*`为准；过滤入口缩小范围但仍使用同一隔离测试库保护和Playwright runner。Jest、Vitest与Playwright匹配0项时必须失败。
- Slice入口通过固定配置执行；runner在首项前保存`running`，每项命令前后核对同一干净HEAD／tree和统一测试环境快照，全部成功后原子发布`success`。Evidence v2只认同一tree、scope、有序检查集合、环境指纹及最新成功尝试；同键重跑一旦开始，旧成功不再可复用，失败、中断、v1与损坏记录均拒绝。环境指纹包含测试配置的有效值、运行时／平台、相关工具控制变量、实际PostgreSQL镜像摘要和锁定Playwright浏览器清单；不散列整个`process.env`或数据库内容。秘密输入使用Git common directory中的本地随机HMAC密钥生成指纹，原值不入证据；密钥缺失或变化时旧证据自然失配。证据和验证键锁位于Git common directory，同仓库worktree共享；E2E只对同一主机用户下的共享测试库和固定端口互斥，普通单元、类型和格式检查不被全局串行。锁异常残留时不按超时自动删除，须先确认原进程及子进程结束再人工恢复。可用`pnpm evidence:check --scope <name>`核对；Auth focused证据不能冒充完整Level 3证据，新的组合tree不做自动affected推断。

## 恢复与交付

- 中断恢复先看状态、Git和快照漂移；保留用户及其他任务改动。只恢复当前授权范围，不自行启动下一阶段。
- 恢复同一任务时优先回到原工作区；确认属于该任务的未提交修改是恢复现场，不因跨会话而另建worktree或自动清理。单人串行新任务按三级规则复用合适目录并从已核实的本地`main`建立新分支；依赖和生成环境只在相关输入变化或缺失时准备。
- 检查失败保留输出供诊断；修复后只重跑失效范围，最终稳定候选再执行所属Level门禁。真正启动同一验证键的新尝试会先使旧成功失效；仅查询证据不会改变状态。
- 完整日志保留在既有本地报告或CI产物；对话只报告命令、真实退出状态、关键结果和失败片段，不用消息数或耗时冒充Token用量。已取得的调用／用量数据如实记录，取不到就写“未取得”。
- 最终差异必须与用户范围一致，不提交真实`.env`、凭据或运行产物。工程检查通过不等于上线获准；发布仍遵守开发规范。
- 最终汇报保持四项：完成内容、实际验证、已知风险、必要下一步。没有风险或下一步时直接说明“无”，不输出内部推理和命令流水。

## `context:check`边界

检查器跟踪项目文本和Demo文本资产，排除依赖、生成结果、秘密环境和本地临时目录，并核对简单行内本地链接。它不判断自然语言是否真实，不测试业务，不验证锚点，也不监控服务。新增文件类型或生成目录时才复核跟踪范围。
