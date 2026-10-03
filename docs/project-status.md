# 当前开发状态

更新日期：2026-10-04。本文件只保留恢复当前工作的最小事实；历史状态见[历史状态](project-status-history-through-2026-09-18.md)，候选证据与集成事实见[验证记录](spec/v0.1/VALIDATION.md)。

## 当前阶段

CORE-CA-004已集成main，CORE-CA-005前后端开发候选已通过独立Final Review，准备固定正式门禁候选，尚未正式验收；业务能力状态及唯一Current／Next以[功能开发路线图](feature-roadmap.md)为准。

## 当前任务

已核对干净的本地／远端main基线`b28e0f35fa8de21f752145e43177b7defe450341`并创建`codex/core-ca-005-court-filing`。唯一Current为**CORE-CA-005｜提交法院（开发中）**，Next为CORE-CA-006正式受理；本轮只实现提交法院，不开始正式受理。

本轮范围见[CA-005契约](spec/v0.1/modules/cases.md#core-ca-005-提交法院契约)及[实施计划](superpowers/plans/2026-10-03-core-ca-005-court-filing.md)。复用既有身份／数据范围／材料／审计机制，按Level 2；核心Command和普通前向迁移仍按Sol Task独立审查，多Agent集成后一次Final Review。不得把旧CA-004结果写成本轮已验收。

## 已实现

已集成的CA-004保持原验收结论。CA-005开发候选`9c4fa60e80b726691468e1db6b042add71b9f3b5`增加真实法院目录入口、提交Command／不可变事实、三份前向迁移、运营表单及待正式立案导航；只推进待提交立案到待正式立案。开发期定向结果见本轮Task报告，不能代替Final Review与正式门禁。

## 未决与限制

CA-005尚未正式验收。后端Task和整体Final独立Sol审查均已接受，未关闭C／I／M为0；OpenAPI成功码及未知结果分类缺陷已修复并有定向验证。Task1 Command未先取得行为RED及长输出仅留工具记录的证据边界见`.local/ca005/task-1-report.md`，不得冒称全程test-first或全部中间日志已落盘。本轮不默认推送、合并或部署；只操作独立测试库，不操作开发／生产库或持久化卷。

## 最近验证

固定候选`e30f708b3d95285ca085451090dc500f0192a899`、tree`9a4c850549a29a22b2336a261939560333334a9e`于2026-10-03通过完整verify（后端980、前端584、工具73）及隔离PostgreSQL／Chromium全量160/160，均退出0。报告`.local/ca004/e30f708-gate-report.md`及独立原始日志／HTML。此后仅补完成状态、证据及对应已解释快照，执行文档专项检查，不称收口HEAD实跑旧候选门禁。

## 下一步

关闭Final Review全部finding后解释累计diff／快照漂移、固定干净候选，执行Level 2定向门禁、真实数据库／Chromium及迁移专项；全部通过才补完成状态。证据与开发期报告均保留`.local/ca005/`，Next仍为CA-006，未授权启动。
