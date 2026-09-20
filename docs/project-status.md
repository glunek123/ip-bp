# 当前开发状态

更新日期：2026-09-20。本文件只保留恢复当前工作的最小事实；此前的实现与验证流水见[历史状态](project-status-history-through-2026-09-18.md)，详细验证仍以各候选和[验证记录](spec/v0.1/VALIDATION.md)为准。

## 当前阶段

首批正式业务开发：认证与客户最小主数据链路已形成内部闭环，正在实施开发流程分级与门禁优化。业务路线和完成判定以[功能开发路线图](feature-roadmap.md)为准；生产交付能力与业务Slice分开管理。

## 当前任务

**GOV-FLOW-GATES-003（实现与审查完成，待决定集成方式）**：隔离分支`codex/dev-flow-gates`已落实“L2轻量、L3严格、Merge按最终Git tree复用、Release最完整”。范围仅含治理规则、上下文工具、显式Slice验证入口、tree evidence、门禁去重、状态／历史分离及其测试；未修改业务功能、Prisma schema、迁移、依赖版本、生产配置或真实数据。

当前实施顺序：

1. 修正规则，解耦`context:record`与状态文件，并增加strict检查。
2. 为现有客户、权利主体和认证路径增加少量显式Slice／E2E入口及零测试防护。
3. 增加只支持完全相同Git tree、可跨同仓库worktree复用的本地轻量验证证据。
4. 消除完整`verify`中重复的Prisma generate和`vue-tsc`，再执行所属Level门禁。

## 已实现

- 系统统一名称为“品维·知产业务管理系统”，同一系统服务品维部与知产部，服务端承担部门数据隔离与授权。
- 本地账号登录、会话、CSRF、限速，以及客户草稿建档／维护、一位准入联系人和权利主体最小关联已形成明确范围内的内部闭环。
- 工程已有Node/pnpm锁定运行时、上下文与Spec检查、类型／Lint／格式／单元／契约／构建门禁及独立测试库Playwright。
- 普通context检查现报告漂移但不阻断，strict模式继续阻断；标准记录已与状态文件机械更新解耦。客户／权利主体／认证已有显式Unit和数据库E2E入口，0测试匹配会失败。
- Slice runner拥有固定的命令与规范化检查ID，在首项检查前锁定干净tree、末项检查后确认tree未改变，全部成功后才自动记录evidence，调用者不能自报检查集合；证据位于Git common directory，只记录干净固定候选，并以Git tree、环境和精确检查集合在同仓库worktree间复用。同一tree可保留多个范围，commit变化但tree相同仍可复用，新的组合tree仍需完整门禁。
- 完整`verify`已改为只生成一次Prisma Client、只运行一次`vue-tsc`，保留strict context、Spec、类型、Lint、格式、工具／前后端测试和双端构建。

## 未决与限制

- 当前下一业务Slice“人员账号、部门成员与角色分配闭环”会修改RBAC和部门隔离，仍属于Level 3；本治理任务不启动该业务Slice。
- E01后续人员管理／MFA／找回密码／OIDC、E02私有对象存储、生产环境与CI仍按[后续设计清单](deferred-design.md)和路线图分别推进。
- 项目没有可靠依赖图；本轮不实现自动affected验证或自动文件归属。新的组合tree仍须在最终tree执行一次完整工程门禁。
- 生产备份、正式迁移、部署、真实回滚和生产数据操作不在本任务授权范围。

## 最近验证

- 2026-09-20：隔离worktree在生成Prisma Client后基线通过，工具22项、后端148项、前端125项；首次未生成Client的失败属于新worktree准备步骤，不是代码回归。
- TDD新增context、Slice配置、固定runner和tree evidence回归；工具现为35项，包含检查期间HEAD切换到不同tree时拒绝落证据。Jest、Vitest、Playwright的无匹配范围均实测退出非0；显式Unit范围通过：客户后端／前端31／31、权利主体30／44、认证46／40。
- 独立测试库从空库应用11份迁移；权利主体数据库E2E 11／11、认证数据库E2E 4／4通过。该证据验证新入口范围，不代表业务功能发生新变化。
- 审查前候选完整`pnpm verify`退出0，用时80.04秒；首轮修复后为66.59秒；加入候选tree前后锁定后的最新完整`pnpm verify`再次退出0，用时65.47秒，覆盖strict context、Spec、工具35项、后端148项、前端125项及双端构建。同机旧等价流程曾退出0、用时89.24秒，去重效果得到保留。
- 固定候选`20f890a`的`verify:slice:right-holder`退出0，用时37.46秒，包含定向Unit、快速静态门禁、Slice格式、后端构建和隔离数据库E2E 11／11；evidence核对命中tree `a57526719c4590ded95b01761054365aa9f5f55e`。
- `project-status.md`由约42KB缩至约3.2KB，原历史完整迁至[历史状态](project-status-history-through-2026-09-18.md)。首轮独立审查`REJECTED`（Critical 0／Important 2／Minor 2）的4项均已关闭；第二轮`REJECTED`（Critical 0／Important 1／Minor 0）的候选tree竞态也已修复；第三轮最终复审`ACCEPTED`，Critical／Important／Minor均为0，未发现新问题。本任务尚未集成或推送。

## 下一步

决定是否将`codex/dev-flow-gates`集成到`main`；如集成，按三级规则先获取远端并核对最终组合tree。业务侧唯一下一Slice仍为“人员账号、部门成员与角色分配闭环”，不因治理任务自动获得编码或发布授权。
