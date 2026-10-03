# 当前开发状态

更新日期：2026-10-04。本文件只保留恢复当前工作的最小事实；历史状态见[历史状态](project-status-history-through-2026-09-18.md)，候选证据与集成事实见[验证记录](spec/v0.1/VALIDATION.md)。

## 当前阶段

CORE-CA-005提交法院已通过独立终审及正式Level 2验收，尚未推送／合并。此前CA-001～004已集成main；业务能力状态及唯一Current／Next以[功能开发路线图](feature-roadmap.md)为准。

## 当前任务

本轮分支`codex/core-ca-005-court-filing`，基线main为`b28e0f35fa8de21f752145e43177b7defe450341`。唯一Current为**CORE-CA-006｜正式受理（待领取）**，Next为CORE-CA-007开庭后推进；先按授权集成CA-005并核对组合tree，再从更新后的main领取，本轮未开始CA-006。

本轮范围见[CA-005契约](spec/v0.1/modules/cases.md#core-ca-005-提交法院契约)及[实施计划](superpowers/plans/2026-10-03-core-ca-005-court-filing.md)。复用既有身份／数据范围／材料／审计机制，按Level 2；核心Command与迁移Task及集成候选均已独立审查。

## 已实现

CA-005增加真实法院目录入口、提交Command／不可变事实、三份前向迁移、运营表单及待正式立案导航；只推进待提交立案到待正式立案，客户不获取内部提交事实／文件。已集成的CA-004保持原验收结论。

## 未决与限制

正式首候选的3项lint错误已修复、补审关闭并由新候选复验；没有当前未关闭的审查或门禁阻塞，不代表没有任何未知缺陷。Task1 Command未先取得行为RED、部分中间输出仅留工具记录的证据边界仍保留。未实现CA-006、金额更正或外部案件补录；本轮只操作独立测试库，开发／生产迁移、推送／合并／部署均未执行。

## 最近验证

实际业务候选`b33462401fa128742dc2b427c8375682454fe05e`、tree`ea684d26264c064022025617b5d11c7f08eecc43`通过正式Level 2逐项门禁：后端316/316、前端161/161、快速静态／格式／Spec／严格上下文、双端构建及隔离PostgreSQL／Chromium27/27，含迁移专项和既有案件前段回归。Task与Final独立Sol Review及修复补审均ACCEPTED，C／I／M均0。完整摘要和证据边界见[VALIDATION](spec/v0.1/VALIDATION.md)，原始日志、HTML与Review在`.local/ca005/`。后续仅补完成态、证据与对应快照，文档专项检查不冒称收口HEAD实跑旧候选业务门禁。

## 下一步

按授权推送／集成CA-005、核对实际组合tree；随后领取CA-006。不得把本轮Level 2定向结果表述为完整verify或全仓E2E。
