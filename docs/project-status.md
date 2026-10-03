# 当前开发状态

更新日期：2026-10-03。本文件只保留恢复当前工作的最小事实；历史状态见[历史状态](project-status-history-through-2026-09-18.md)，候选证据与集成事实见[验证记录](spec/v0.1/VALIDATION.md)。

## 当前阶段

CORE-CA-004按Level 3开发；业务能力状态及唯一Current／Next以[功能开发路线图](feature-roadmap.md)为准。

## 当前任务

工作分支：`codex/core-ca-004-complaint-mailing`，基于已更新`main@58e405665ea295890cc949c33854b525d902ba9f`。CA-003确认诉状已集成`main`；唯一Current为**CORE-CA-004｜客户盖章邮寄（开发中）**，Next为CORE-CA-005提交法院。

CA-004按Level 3处理，涉及单案邮寄流程的客户与运营双身份及受限客户上传／审计身份路径。范围和规则见[CA-004契约](spec/v0.1/modules/cases.md#core-ca-004-客户盖章邮寄契约)及[实施计划](superpowers/plans/2026-10-03-core-ca-004-complaint-mailing.md)。Task 1与Final独立Sol Review均已接受，未关闭C／I／M均为0；首轮完整verify通过，但全量E2E遇旧迁移测试边界错误后中断，整体验收尚未完成。`a73648f8e6580fbb29e438d005b478e6946df83c`仅修复两份迁移测试helper的历史终点，未改业务或已执行迁移；新候选仍须补审及正式验收，不推进Next。

## 已实现

CA-004双身份Command、最小客户查询、精确版本材料边界、双端页面及四份新前向迁移已实现并完成定向验证；只部署独立测试库，未作完整业务验收。工作区交接与审查证据在`.local/ca004/`，正式结果待完整门禁后进入VALIDATION。CA-003已集成`main`，历史结果见[验证记录](spec/v0.1/VALIDATION.md)。

## 未决与限制

CA-004尚未验收，不推进CA-005。首轮E2E中断留下owner PID 39172已退出的共享测试锁，测试子进程已退出、3101／5174无监听；工具策略拒绝自动清理，已请用户仅处理该失效锁，未绕过互斥。测试库禁止重置；CA-003此前按授权执行的测试库reset仅为历史事实，不构成本轮授权。开发／生产环境未迁移，未发布。

## 最近验证

CA-004首轮正式候选`32f01cd529aa50bb2569b2105dae01fafb45d3fd`、tree`103d9284b7482478502250b79aa60ad449b931b3`的完整`pnpm verify`退出0（181.4秒；后端980项、前端584项）。全量E2E在CA-003迁移helper的`Unexpected migration order`后被中断，退出1不代表自然完成的套件结果。日志和报告在`.local/ca004/final-gate-report.md`，原始失败context／trace已保全；两份helper修复的格式、Lint及边界静态核对通过，真实数据库专项待解锁。

## 下一步

完成迁移helper修复补审，解释仅两份helper与本恢复摘要的漂移后记录快照并固定候选；执行新候选完整`pnpm verify`，解锁后自然完成迁移专项及隔离数据库／Chromium全量E2E，再补记完成状态。独立测试库已前向部署64份迁移，未reset；开发／生产环境不迁移。
