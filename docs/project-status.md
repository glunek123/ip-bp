# 当前开发状态

更新日期：2026-09-23。本文件只保留恢复当前工作的最小事实；截至2026-09-18的流水见[历史状态](project-status-history-through-2026-09-18.md)，各候选的详细历史证据见[验证记录](spec/v0.1/VALIDATION.md)。两者均按需读取，不是新任务默认上下文。

## 当前阶段

开发流程治理：业务能力范围、完成状态、依赖顺序和唯一Current／Next只由[功能开发路线图](feature-roadmap.md)维护；本文件不再复制业务完成态。

## 当前任务

**CORE-LD-004｜客户判定不侵权并归档（路线图唯一Current，代码及聚焦数据库／浏览器测试已完成，Final Review与Level 3正式门禁待完成）**：工作位于`codex/core-ld-004-client-no-infringement-archive`分支；CORE-LD-003完成证据见[验证记录](spec/v0.1/VALIDATION.md)。按SD-40，CORE-LD-004之后的唯一Next为CORE-LD-007纠错闭环，再进入CORE-LD-005；顺序以[功能开发路线图](feature-roadmap.md)为准。

## 已实现

- 全部业务实现状态和完成证据索引见[功能开发路线图](feature-roadmap.md)；本节只保留该唯一来源指针，不重复列举能力。
- `ROLE-TEMPLATE-001`代码候选`d542c31`、tree`cae336d`已通过完整Level 3门禁、数据库型浏览器验收和独立终审；其可配置Grant底座供核心业务Action复用。
- `CORE-LD-001`已实现`customer.admit`与`lead.read/create/edit`、ADMITTED准入约束、材料／内容版本／冻结引用、线索／商品／侵权类型／日编号／幂等回执，以及正式运营端页面。详细证据见[验证记录](spec/v0.1/VALIDATION.md)。
- `CORE-LD-002`已实现真实企业客户账号绑定、密码会话、`WAITING_PUSH → WAITING_REVIEW`原子推送、`lead.push`内部授权、客户固定企业范围、幂等／版本／审计，以及运营推送和客户端只读列表／详情／附件页面。详细证据见[验证记录](spec/v0.1/VALIDATION.md)。
- 登录后共享壳层及运营／客户端页面已按Demo共享视觉层级对齐；客户确认侵权及CORE-LD-004不侵权归档已有真实API和正式页面候选，后者仍待Final Review与Level 3正式门禁；后续取证动作仍未实现。

## 未决与限制

- SD-22／30正式准入门槛保持有效；客户资料准入不是线索阶段，CORE-LD-001只补正式线索所需的最小准入和本地／测试私有存储Adapter，不冒充生产E02完成。
- CORE-LD-002已交付最小真实客户端，CORE-LD-003已由真实企业客户完成侵权确认闭环；CORE-LD-004继续使用该客户身份，CORE-LD-005／006由运营以自身真实身份办理，不代录客户结论，也不提前建设完整客户门户。
- 多联系人、资产协议、CSV／批量、完整外部端、费用结算和报表后置。OCR与爬虫当前只保留领域Command、幂等和来源追踪缝隙，候选暂存、批次、供应商和协议到对应功能时设计。
- 历史验证只写入独立测试库和随机临时schema；未授权发布、生产数据库操作或持久化卷删除。契约中标记`BLOCKED_BY`的后段动作必须等待对应业务决定，不得由实施AI补猜。

## 最近验证

- Node v24.21.0、pnpm 11.27.0与项目锁定环境一致；使用锁定PostgreSQL 17.11镜像、随机本地端口和显式隔离测试DSN，不降级到开发库。
- `CORE-LD-001`最终全分支总审结论为`APPROVED`，Critical 0／Important 0／Minor 0；其材料并发边界和事务修复结论保持有效。
- `CORE-LD-002`固定代码候选`6be15b2`、tree`f71f44e4db09699f310e608e135254204ea3679e`的完整`pnpm verify`通过：工具71项、后端499项、前端253项，以及规范、架构、类型、Lint、格式和生产构建全部成功；完整数据库型Chromium E2E 76/76通过。
- 同一tree的正式`verify:slice:core-ld` Evidence v2通过：后端308项、前端147项、架构／类型／ESLint、Slice格式、后端构建及真实PostgreSQL／Chromium 18/18均成功。空测试库从零应用24份前向迁移；上一支持schema升级和失败阶段回滚由迁移专项通过。独立终审为`ACCEPTED`，Critical／Important／Minor均为0。证据位于Git common目录`dev-cor-validation-evidence/f71f44e4db09699f310e608e135254204ea3679e.json`。
- CORE-LD-002快速上手UX硬化代码候选`667da39`、tree`4fe53798ef755ca7cab59ff3b0427f833a60a6fb`的`verify:slice:core-ld`通过：后端309项、前端155项及真实PostgreSQL／Chromium 18/18全部成功；Evidence v2位于`dev-cor-validation-evidence/4fe53798ef755ca7cab59ff3b0427f833a60a6fb.json`。独立UX复审为`ACCEPTED`，Critical／Important／Minor均为0。本轮不改变CORE-LD-003为唯一Current、CORE-LD-004为Next。
- 记录上述证据后的收口候选`d20675d`、tree`03ac4e412281e1c736973536509b3d5add847887`完整`pnpm verify`通过：工具71项、后端500项、前端268项，以及上下文、规范、架构、类型、Lint、格式和双端生产构建全部成功。
- CORE-LD-003最终审查与测试修正分别在`ab57a6f`和`dc27c37`获独立`ACCEPTED`，均为Critical／Important／Minor 0。完整`pnpm test:e2e:full`在`8d4742d`／tree`3b24dcd`通过80/80；固定候选`9167b22`／tree`1d3d9813c2c4c449505867937536a121826b7ee6`的`pnpm verify`和同tree `pnpm verify:slice:core-ld`均通过。完整门禁包含工具71项、后端552项、前端296项；Slice门禁包含后端359项、前端183项及PostgreSQL／Chromium 22/22，其Evidence v2位于`dev-cor-validation-evidence/1d3d9813c2c4c449505867937536a121826b7ee6.json`。迁移011000／012000／013000为前向迁移，空库、上一支持Schema升级及失败回滚均已验证。

## 下一步

下一步按已确认的[CORE-LD-004小粒度设计](superpowers/specs/2026-09-23-core-ld-004-client-no-infringement-archive-design.md)和[实施计划](superpowers/plans/2026-09-23-core-ld-004-client-no-infringement-archive.md)开发、Review并验证客户不侵权归档；CORE-LD-007为Next，后接CORE-LD-005。CORE-LD-004不冒充归档后撤回已可用；只有CORE-LD-007的运营申请→原客户确认→重新审核通过真实浏览器和数据库验收，才称客户审核与纠错闭环完成。上一阶段已合并并推送至`origin/main@0cbf548`；未上线、未执行生产迁移。
