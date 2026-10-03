# 当前开发状态

更新日期：2026-10-03。本文件只保留恢复当前工作的最小事实；历史状态见[历史状态](project-status-history-through-2026-09-18.md)，候选证据与集成事实见[验证记录](spec/v0.1/VALIDATION.md)。

## 当前阶段

CORE-CA-004已通过Level 3验收，待集成；业务能力状态及唯一Current／Next以[功能开发路线图](feature-roadmap.md)为准。

## 当前任务

工作分支：`codex/core-ca-004-complaint-mailing`，基于`main@58e405665ea295890cc949c33854b525d902ba9f`。CA-003已集成；CA-004已验收、未推送／合并。唯一Current为**CORE-CA-005｜提交法院（待领取，先集成CA-004）**，Next为CORE-CA-006正式受理，本轮未开发后续切片。

范围和业务规则仍见[CA-004契约](spec/v0.1/modules/cases.md#core-ca-004-客户盖章邮寄契约)及[实施计划](superpowers/plans/2026-10-03-core-ca-004-complaint-mailing.md)。Task、Final独立Sol Review及两轮helper补审均已接受，未关闭C／I／M均为0；正式候选与完整结果见[验证记录](spec/v0.1/VALIDATION.md)，不在Spec或计划重复维护验收台账。

## 已实现

客户／运营真实邮寄、企业受限案件查询与材料上传下载、内部只读边界和四份前向迁移均已验收。唯一状态变化为诉状待盖章到待提交立案；来源、冻结材料、事实、审计、幂等、并发、撤权和刷新／重登持久化均有真实数据库／浏览器证据。

## 未决与限制

无本Slice未关闭finding或验收阻塞。失效锁已按用户授权清理；测试容器tmpfs重启后需按README先启动再部署迁移，本轮恢复遗漏已补齐，失败与旧探针修复记录均保留于VALIDATION。未操作开发／生产库、持久化卷或发布；生产存储及MVP后续能力仍按原边界，不因本地验收冒称生产可用。

## 最近验证

固定候选`e30f708b3d95285ca085451090dc500f0192a899`、tree`9a4c850549a29a22b2336a261939560333334a9e`于2026-10-03通过完整verify（后端980、前端584、工具73）及隔离PostgreSQL／Chromium全量160/160，均退出0。报告`.local/ca004/e30f708-gate-report.md`及独立原始日志／HTML。此后仅补完成状态、证据及对应已解释快照，执行文档专项检查，不称收口HEAD实跑旧候选门禁。

## 下一步

按授权推送／集成CA-004前核对实际组合tree与证据适用性；未获新授权不推送／合并，本轮也不开始CA-005。后续从更新后的main领取CA-005，再做相应小粒度设计与实施。
