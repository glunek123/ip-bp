# 当前开发状态

更新日期：2026-09-21。本文件只保留恢复当前工作的最小事实；截至2026-09-18的流水见[历史状态](project-status-history-through-2026-09-18.md)，各候选的详细历史证据见[验证记录](spec/v0.1/VALIDATION.md)。两者均按需读取，不是新任务默认上下文。

## 当前阶段

开发流程治理：业务能力范围、完成状态、依赖顺序和唯一Current／Next只由[功能开发路线图](feature-roadmap.md)维护；本文件不再复制业务完成态。

## 当前任务

**CORE-LD-001（内部集成完成）**：材料生命周期最终修复已统一删除／恢复／清理与引用冻结的 PostgreSQL 并发边界，并以显式响应DTO封闭内部字段。最终全分支总审`APPROVED`，Critical／Important／Minor均为0；固定修复候选`18ee49fc36a69da948aed90eec36711c5c60a43b`、tree`d742a1b6caeb04d2b7f9f18ab7186bb77b2368f0`已通过正式`verify:slice:core-ld`。路线图据此推进为唯一Current `CORE-LD-002｜运营推送至真实客户端审核`、唯一Next `CORE-LD-003｜客户确认侵权并进入待确认`。

## 已实现

- 全部业务实现状态和完成证据索引见[功能开发路线图](feature-roadmap.md)；本节只保留该唯一来源指针，不重复列举能力。
- `ROLE-TEMPLATE-001`代码候选`d542c31`、tree`cae336d`已通过完整Level 3门禁、数据库型浏览器验收和独立终审；其可配置Grant底座供核心业务Action复用。
- `CORE-LD-001`已实现`customer.admit`与`lead.read/create/edit`、ADMITTED准入约束、材料／内容版本／冻结引用、线索／商品／侵权类型／日编号／幂等回执，以及正式运营端页面。详细证据见[验证记录](spec/v0.1/VALIDATION.md)。

## 未决与限制

- SD-22／30正式准入门槛保持有效；客户资料准入不是线索阶段，CORE-LD-001只补正式线索所需的最小准入和本地／测试私有存储Adapter，不冒充生产E02完成。
- CORE-LD-002开始交付最小真实客户端；不再用运营代录客户审核，也不提前建设完整客户门户。
- 多联系人、资产协议、CSV／批量、完整外部端、费用结算和报表后置。OCR与爬虫当前只保留领域Command、幂等和来源追踪缝隙，候选暂存、批次、供应商和协议到对应功能时设计。
- 本轮只对独立测试库和随机临时schema执行迁移／fixture与故障注入；未授权推送、发布、生产数据库操作或持久化卷删除。契约中标记`BLOCKED_BY`的后段动作必须等待对应业务决定，不得由实施AI补猜。

## 最近验证

- Node v24.21.0、pnpm 11.27.0与项目锁定环境一致；使用锁定PostgreSQL 17.11镜像、随机本地端口和显式隔离测试DSN，不降级到开发库。
- 最终全分支总审结论为`APPROVED`，Critical 0／Important 0／Minor 0。材料删除在Serializable事务内完成当前授权、material/current-version facts、引用重查、CAS与审计并支持`P2034`及`P2010/40001`整事务重试；恢复与cleanup共享material→current content version锁顺序，真实交错不产生`ACTIVE + PURGED`。
- 固定候选`18ee49fc36a69da948aed90eec36711c5c60a43b`、tree`d742a1b6caeb04d2b7f9f18ab7186bb77b2368f0`的正式`verify:slice:core-ld`通过并生成Evidence v2：后端228项、前端71项、架构／类型／ESLint、Slice格式、后端构建及真实PostgreSQL／Chromium 13/13均通过。证据位于Git common目录`dev-cor-validation-evidence/d742a1b6caeb04d2b7f9f18ab7186bb77b2368f0.json`。

## 下一步

状态推进提交形成的新tree按既定流程重新绑定同一`verify:slice:core-ld` Evidence v2；随后从CORE-LD-002开始推送与最小真实客户端切片。不自动推送、发布或操作生产数据库。
