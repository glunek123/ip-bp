# 通用底座完善验收

日期：2026-09-15；任务 FND-002。用户批准范围为通用 HTTP、健康 API 分离、安全诊断、组件兼容检查、本地 Git 和后续设计清单。基线提交：046f8be。当前阶段与最新证据见 [开发状态](project-status.md)。

本报告保留 FND-002 原始组件失败证据；后续 CMP-01 声明修复和复验见 [组件兼容报告](component-compatibility.md)，当前待办状态以 deferred-design.md 为准。

## 实现与接口

- requestJson 接受 GET/POST/PUT/PATCH/DELETE；写请求可带 JsonValue，声明 JSON Content-Type；未提供 body 时不发送该头。204 返回 undefined，其余成功响应要求有效 JSON。getJson 保留原入口，沿用 30 秒默认超时、调用方取消和 ApiError；写请求不自动重试。
- getHealth 返回经过运行时验证的 HealthStatus，页面仅处理交互与状态；无新业务接口、模型或迁移。
- 请求日志增加注册路由模板，未匹配路由为 UNMATCHED；错误日志增加方法及安全位置。位置仅提取项目 src/dist 下存在文件的路径和行列，无法确认时省略。日志不返回异常正文、完整堆栈、查询参数、请求正文或认证头。
- 保留既有数据库错误类型/码与请求编号；本轮未设计业务审计或生产日志平台。
- 本地 Git 使用 main 与现有身份，先保存既有已验证基线。真实 .env、node_modules、generated、构建和测试产物被忽略；无远程推送或托管 CI。

## Element Plus 兼容检查

在 frontend/.local/compat 中建立临时 probe.ts，内容为导入目标入口并导出引用；临时 tsconfig 继承前端 tsconfig，仅包含 probe.ts。逐项执行 `pnpm --filter @dev-cor/frontend exec vue-tsc --noEmit -p .local/compat/tsconfig.json`。保持 strict，未设置 skipLibCheck。临时材料被忽略，日志不作为正式代码。

| 入口                  | 严格类型结果 | 范围                                                                        |
| --------------------- | ------------ | --------------------------------------------------------------------------- |
| button                | PASS         | 既有页面实际使用，另有页面及跨端验证                                        |
| form                  | PASS         | 仅声明可用性检查，不代表业务表单完成                                        |
| input                 | PASS         | 仅声明可用性检查                                                            |
| date-picker           | PASS         | 仅声明可用性检查                                                            |
| select                | FAIL         | VueUse 蓝牙全局类型缺失；select-v2 的 GlobalComponents 约束冲突             |
| table                 | FAIL         | table-header 声明要求 GlobalComponents 满足组件索引约束，实际类型无索引签名 |
| element-plus 全量入口 | FAIL         | 包含上述类型问题及 dropdown 等声明冲突                                      |

版本保持 Vue 3.5.42 / Element Plus 2.14.5 / TypeScript 5.9.3。错误来自已安装依赖声明；不使用 any、全局宽泛索引签名或 skipLibCheck 掩盖。纯导入/现有项目配置调整不足以解决组件约束；依赖升级或补丁需要独立评估。处理项 CMP-01 及触发条件见 [后续设计清单](deferred-design.md)，本轮不声称全量组件兼容。

## 验证记录

- 测试先行：新前端用例发现 requestJson/getHealth 缺失；新后端用例发现 method/route/location 缺失。实现后工具 12、前端 22、后端 18 项测试通过。
- 最终冻结安装：pnpm install --frozen-lockfile --offline 退出 0；无依赖版本变更。
- 最终 pnpm verify 退出 0：文档一致性、类型、Lint、格式、工具 12 + 前端 24 + 后端 23 项测试（59 项）和前后端构建通过。
- pnpm test:e2e 使用独立 PostgreSQL 测试库，2 项 Chromium 用例通过，覆盖真实健康链路与失败重试；保留 Node 控制台颜色环境变量警告，不影响测试结果。
- 独立只读代码审查无阻断项；追加响应体读取时超时/取消、请求正文脱敏、多行异常与非法代码路径测试，均纳入最终验证。
- 验证后仅更新本报告和状态结果，重新格式化、记录并检查快照；代码、文档和快照在同一本地交付提交保存。最终提交可由 git log 核对；本报告不嵌入自身提交号。

## 文档接续

deferred-design.md 是后续事项唯一清单；AGENTS 和 AI 规范要求接收字段/规则文档时核对输入条件，建立需求到设计/实现/测试的映射。只有实际验证完成才关闭事项；登录、供应商、存储、部署和 CI 的外部条件独立记录。
