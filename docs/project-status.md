# 当前开发状态

更新日期：2026-10-03。本文件只保留恢复当前工作的最小事实；历史状态见[历史状态](project-status-history-through-2026-09-18.md)，候选证据与集成事实见[验证记录](spec/v0.1/VALIDATION.md)。

## 当前阶段

CORE-CA-004按Level 3开发；业务能力状态及唯一Current／Next以[功能开发路线图](feature-roadmap.md)为准。

## 当前任务

工作分支：`codex/core-ca-004-complaint-mailing`，基于已更新`main@58e405665ea295890cc949c33854b525d902ba9f`。CA-003确认诉状已集成`main`；唯一Current为**CORE-CA-004｜客户盖章邮寄（开发中）**，Next为CORE-CA-005提交法院。

CA-004按Level 3处理，涉及单案邮寄流程的客户与运营双身份及受限客户上传／审计身份路径。范围和规则见[CA-004契约](spec/v0.1/modules/cases.md#core-ca-004-客户盖章邮寄契约)及[实施计划](superpowers/plans/2026-10-03-core-ca-004-complaint-mailing.md)。双端实现固定于`bc7546c50d50e2b22b6cae3a14e5f4e4cddbc364`，Task 1与Final独立Sol Review均已接受，未关闭C／I／M均为0；正式Level 3整体验收尚未完成，不推进Next。

## 已实现

CA-004双身份Command、最小客户查询、精确版本材料边界、双端页面及四份新前向迁移已实现并完成定向验证；只部署独立测试库，未作完整业务验收。工作区交接与审查证据在`.local/ca004/`，正式结果待完整门禁后进入VALIDATION。CA-003已集成`main`，历史结果见[验证记录](spec/v0.1/VALIDATION.md)。

## 未决与限制

CA-004尚未验收，不推进CA-005。测试库禁止重置；CA-003此前按授权执行的测试库reset仅为历史事实，不构成本轮授权。开发／生产环境未迁移，未发布。

## 最近验证

CA-003集成提交为`58e405665ea295890cc949c33854b525d902ba9f`，tree为`9bb941e90703a22a73682ccf77f47b0511218857`；集成态文档preflight及严格上下文检查通过，业务证据仍绑定原固定候选，详见[验证记录](spec/v0.1/VALIDATION.md)。

## 下一步

核对已解释差异并记录上下文，固定候选执行完整`pnpm verify`和隔离数据库／Chromium `pnpm test:e2e:full`；全部通过后再补记完成状态。独立测试库已前向部署64份迁移，未reset；开发／生产环境不迁移。
