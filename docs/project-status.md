# 当前开发状态

更新日期：2026-09-21。本文件只保留恢复当前工作的最小事实；截至2026-09-18的流水见[历史状态](project-status-history-through-2026-09-18.md)，各候选的详细历史证据见[验证记录](spec/v0.1/VALIDATION.md)。两者均按需读取，不是新任务默认上下文。

## 当前阶段

开发流程治理：业务能力范围、完成状态、依赖顺序和唯一Current／Next只由[功能开发路线图](feature-roadmap.md)维护；本文件不再复制业务完成态。

## 当前任务

**CORE-LD-001（内部集成完成）**：最小客户准入、真实私有材料字节、运营新建／查看／编辑待推送线索及四阶段计数已实现；修复候选独立Q2复审`APPROVED`（Critical／Important均为0），保持LD-001为Current的固定候选已通过正式`verify:slice:core-ld`。[功能开发路线图](feature-roadmap.md)据此将唯一Current推进至`CORE-LD-002｜运营推送至真实客户端审核`，唯一Next为`CORE-LD-003｜客户确认侵权并进入待确认`。状态提交形成的新tree仍按流程重新绑定正式门禁证据，不改变已完成业务范围。

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

- Node v24.21.0、pnpm 11.27.0与项目锁定环境一致。固定测试端口55433被Windows系统排除，本轮在锁定PostgreSQL 17镜像上使用随机本地端口和显式隔离DSN，不降级到开发库。
- `test:unit:core-ld`后端226/226、前端71/71，`test:context` 67/67，`check:fast:prepared`的架构、全仓类型和ESLint通过。`test:e2e:core-ld` 9/9通过，覆盖8组业务场景和1组迁移探针；空库完整22迁移、上一schema映射／保留／补权和两个故障阶段回滚均已真实执行。
- 开发期E2E暴露并修复两个实现缺陷：计数器999后先触发数据库CHECK而返500，以及Prisma adapter的`P2010/40001`未进入既定可串行化重试。修复后第1000号返409 `LEAD_NUMBER_EXHAUSTED`，并发成功编号无重复，重试耗尽返回稳定`VERSION_CONFLICT`。
- 首轮独立Q2固定`c60bd18`后报告Critical 0／Important 4／Minor 1。当前修复已禁止PostgreSQL连接query覆盖，随机端口必须绑定唯一健康测试容器和锁定17.11镜像，迁移探针证明4次补权INSERT后才在授权修订UPDATE失败并整体回滚；ADMITTED负例只保留主体／证件类型不兼容。修复后上下文69/69、CORE-LD E2E 9/9及`check:fast`通过，仍待固定提交与独立复审。
- 修复候选`fe2ba4e`独立复审已`APPROVED`，Critical 0／Important 0；唯一Minor是状态文档把路线推进写在正式门禁之前，本次只纠正执行顺序，不改变业务实现或范围。
- 时序修复候选`d4063f0`、tree`57021801a858033ce4f4befc3be0f2b5808b5073`的正式`verify:slice:core-ld`通过并生成Evidence v2：后端226项、前端71项、架构／类型／ESLint／Slice格式、后端构建及真实PostgreSQL／Chromium 9/9均通过。门禁后工作树保持干净。

## 下一步

在状态推进后的最终干净tree上重新运行并绑定`verify:slice:core-ld` Evidence v2；成功后从CORE-LD-002开始推送与最小真实客户端切片。不自动推送、发布或操作生产数据库。
