# 当前开发状态

更新日期：2026-10-03。本文件只保留恢复当前工作的最小事实；历史状态见[历史状态](project-status-history-through-2026-09-18.md)，候选证据与集成事实见[验证记录](spec/v0.1/VALIDATION.md)。

## 当前阶段

CORE-CA-004按Level 3开发；业务能力状态及唯一Current／Next以[功能开发路线图](feature-roadmap.md)为准。

## 当前任务

工作分支：`codex/core-ca-004-complaint-mailing`，基于已更新`main@58e405665ea295890cc949c33854b525d902ba9f`。CA-003确认诉状已集成`main`；唯一Current为**CORE-CA-004｜客户盖章邮寄（开发中）**，Next为CORE-CA-005提交法院。

CA-004按Level 3处理，涉及单案邮寄流程的客户与运营双身份及受限客户上传／审计身份路径。范围和规则见[CA-004契约](spec/v0.1/modules/cases.md#core-ca-004-客户盖章邮寄契约)及[实施计划](superpowers/plans/2026-10-03-core-ca-004-complaint-mailing.md)。Task 1与Final独立Sol Review及两轮helper补审均已接受，未关闭C／I／M均为0。恢复测试库后全量E2E为158／160，CA-004真实流程均通过，剩余两处旧迁移探针已由`a2482310dc96930415df852c624b4bdef49b6183`最小修复并通过定向回归；新候选正式验收尚待完成，不推进Next。

## 已实现

CA-004双身份Command、最小客户查询、精确版本材料边界、双端页面及四份新前向迁移已实现，真实数据库与客户／运营浏览器路径通过；尚未取得全量绿色门禁，不作完成声明。工作区交接与审查证据在`.local/ca004/`，正式结果待完整门禁后进入VALIDATION。CA-003已集成`main`，历史结果见[验证记录](spec/v0.1/VALIDATION.md)。

## 未决与限制

CA-004尚未验收，不推进CA-005。按用户新授权重新核验后，仅清除了owner PID 39172已退出的失效锁。测试容器使用tmpfs，重启后public为空；恢复时漏执行README既有迁移准备步骤导致一轮初始化失败，已用受控入口部署64份前向迁移，未reset。两处旧探针只固定历史57份终点，保留原计数、授权、约束及回滚断言；禁止修改已执行迁移、重置测试库或操作开发／生产库。未发布。

## 最近验证

候选`c2846bf8b22a804c4f4b65ebbce36dd9032251f6`、tree`975475c5a9b782cce3cf2e54b8700a71fa9e6c54`的完整verify通过（178.7秒；后端980、前端584、工具73），迁移专项2／2。恢复schema后的全量E2E为158／160，失败仅为CORE-LD与NT-010历史探针；两份新helper修复定向2／2、Lint及格式通过。报告在`.local/ca004/c2846bf-migrated-gate-report.md`与`legacy-probe-fix-report.md`；各失败日志、HTML、context及trace已保全，旧候选结果不冒充新tree正式通过。

## 下一步

两处历史探针修复已通过独立补审，解释两份helper与恢复摘要差异后标准记录快照并固定候选，集中执行完整verify和隔离数据库／Chromium全量E2E。全部通过才补记完成状态与文档专项检查；不自动推送／合并CA-004，也不开始CA-005。独立测试库已部署64份迁移，未reset；开发／生产环境不迁移。
