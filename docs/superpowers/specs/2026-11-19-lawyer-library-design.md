# 律师库（律师资源管理）设计草案

日期：2026-11-19

任务：LAWYER-LIBRARY-001

状态：**设计草案，待评审；未获编码、schema、迁移、页面或真实数据授权。** 本文只陈述现状、方案选项与待拍板决策，不代表任何功能已实现或已批准实施。

## 1. 目标与依据

在现有"律师账号 + 案件指派 + 律师本人办案"体系之上，建设一个可独立维护的律师资源库：运营可维护一份律师名录（含联系方式、执业信息、专长领域、结算偏好），案件匹配/指派时可从名录检索选人并带入资料，并可查看律师的承办业绩。

设计继续遵守 SD-03／04（案件可见范围）、SD-28～33（授权与部门隔离）、AUTH-LOCAL-001（本地账号与会话），以及 [人员账号与角色分配设计](2026-09-20-personnel-access-management-design.md) 的事务与深模块原则。前端只呈现服务端判定的能力，不承担最终授权。

**硬约束（沿用用户约定）**：不改现有字段名、字段值、校验规则、接口字段与数据库结构；本方案的"新增字段"仅针对新实体或对 `LawyerProfile` 的**新增列**，现有 `fullName`／`lawFirm`／`phone`／`address` 的语义与取值一律不动；律师账号体系与 `CaseLawyerAssignment` 不改造。

## 2. 现状事实（只读核对，作为设计基线）

| 项 | 现状 |
|---|---|
| 档案实体 | `LawyerProfile`（schema 2671-2688）：`id`、`departmentId`、`boundUserId?`、`fullName`、`lawFirm?`、`phone?`、`address?`、`createdAt`；`@@unique([id, departmentId])`。**无 `version`、无 `updatedAt`、无独立 CRUD、无字段审计。** |
| 账号绑定 | `LawyerAccountBinding`（1236-1259）：`profileId` 唯一；数据库触发器强制账号为 LAWYER 类型、不可跨部门、至少 1 绑定、身份不可变（`20261004021000` 迁移）。 |
| 现有能力 | `lawyer-account.service.ts`／controller：账号创建、档案绑定、账号与绑定启停、改密；`case-lawyer-assignment.service.ts`：指派/改派（乐观锁 + 幂等 + 审计）；`lawyer-case.controller.ts`：律师本人办案。 |
| 档案产生方式 | 仅两处被动生成：创建律师账号时连带建档案；案件匹配时按纯姓名建档案（`case-match.service.ts`）。`unboundProfiles()` 只返回"有历史指派记录"的遗留档案。 |
| 前端 | `frontend/src/modules/organization/LawyerAccountsPage.vue`（律师账号管理页）；案件侧 `CaseLawyerAssignmentBatchPanel.vue`／`CaseLawyerReassignPanel.vue`；demo 有静态 `LAWYER_BOOK` + `lawyerMenu` 检索交互样板。 |
| 权限 | `lawyer.account.manage`（仅 DEPARTMENT）、`case.lawyer.assign`（SELF/TEAM/DEPARTMENT）、`case.match`；部门隔离统一按 `departmentId = actor.departmentId`。 |
| 业绩数据源 | `CaseLawyerAssignment`（含 `role`／`startedAt`／`endedAt`／结算字段）+ `CaseSettlementTerms`（结算金额）；按 `lawyerId` 关联。 |
| 领域枚举 | 无"专长/领域"枚举；可参考 `LeadCaseType`（案件类型）、`InfringementType`（侵权类型）。 |

一句话基线：**底座厚（账号/指派/授权/审计齐备），档案层薄（无版本、无审计、无维护入口），律师库所缺的是"档案可独立增删改查 + 字段级版本审计 + 名录维护页 + 检索选择 + 业绩投影"。**

## 3. 范围与排除项

包含：

- 律师档案的列表、详情、新建、编辑、启停、检索（供匹配/指派选人并带入资料）。
- 档案扩展信息：执业信息、专长领域、结算偏好、备注；字段级版本与审计。
- 律师业绩的只读投影（从现有指派与结算数据聚合，不新建业务写入）。
- 遗留姓名档案与新名录的去重/归并策略。
- 服务端授权、部门隔离、并发控制、审计与迁移回归。

排除（本草案不建议纳入，除非评审明确纳入）：

- 改造律师账号体系、`LawyerAccountBinding` 触发器或登录链路；档案与账号保持松耦合。
- 修改 `CaseLawyerAssignment` 与案件指派的阶段门槛、幂等回执语义。
- 业绩金额的重算、冲销或财务对账；业绩为只读视图，不回写案件。
- 律师自助维护档案、外部律师注册、移动端、批量导入导出、附件上传。
- 生产迁移、真实账号授权变更与部署。

## 4. 待拍板的决策点（阻塞精算与编码）

| 编号 | 决策点 | 选项 | 建议 |
|---|---|---|---|
| D-01 | 档案与账号边界 | A. 档案独立于账号，账号绑定为可选增强；B. 档案必须依附账号 | **A**。否则无法收纳无登录账号的外部/合作律师，也会碰触发器强约束 |
| D-02 | 业绩口径 | A. 承办案件数；B. 承办数 + 结案数；C. 再加涉案/结算金额 | **B** 起步，金额口径待结算模块稳定后再加；业绩只读不落库 |
| D-03 | 专长领域数据源 | A. 固定枚举；B. 可维护字典表 + 多对多 | **B**，符合"库可维护"诉求；枚举需改代码，不满足运营自助维护 |
| D-04 | 权限模型 | A. 复用 `lawyer.account.manage`；B. 新增 `lawyer.profile.read/manage` | **B**，区分"管名录"与"管登录账号"；A 改动小但权限粒度过粗 |
| D-05 | 删除策略 | A. 仅启停（status=INACTIVE）；B. 物理删除 | **A**，档案被绑定/指派引用，物理删除会踩外键 Restrict |

D-01、D-02 决定复杂度上限，建议优先拍板；D-03～D-05 可在切片 1 冻结前定。

## 5. 数据模型设计（提案；现有列不动）

### 5.1 扩展 `LawyerProfile`（只加列）

| 新增列 | 类型 | 说明 |
|---|---|---|
| `version` | Int @default(1) | 乐观锁，配合 `withVersionConflict()` |
| `updatedAt` | DateTime | 变更审计时间 |
| `status` | enum `LawyerProfileStatus`（ACTIVE/INACTIVE） | 档案启停，独立于账号状态 |
| `source` | enum `LawyerProfileSource`（MANUAL/ACCOUNT_CREATE/LEGACY_MATCH） | 去重与归并依据 |
| `practiceYears` | Int? | 执业年限 |
| `barNumber` | String? | 执业证号 |
| `email` | String? | 邮箱 |
| `notes` | String? | 备注 |

结算偏好不新建字段：复用 `LawyerSettlementMode`（FULL_RISK/HALF_RISK/FIXED_FEE），作为档案上的默认偏好，指派时仍以案件 `CaseSettlementTerms` 为准，不自动覆盖。

### 5.2 新增实体

| 实体 | 关键字段 | 说明 |
|---|---|---|
| `LawyerExpertise`（专长字典） | `id`、`departmentId`、`name`、`active`、`version` | D-03=B 时新建；部门隔离 |
| `LawyerProfileExpertise`（档案—专长） | `lawyerId`、`departmentId`、`expertiseId` | 多对多，`@@unique([lawyerId, expertiseId])` |
| `LawyerProfileAudit`（档案字段审计） | `id`、`profileId`、`actorId`、`action`、`before`、`after`、`createdAt` | 字段级变更留痕；`before/after` 只存变更字段，脱敏联系方式可选 |

### 5.3 业绩投影（只读，不建业务表）

以 `CaseLawyerAssignment` 为事实源，按 `lawyerId` + `role='PRIMARY'` 聚合：承办案件数、在办数、结案数（按 `Case.stage` 或结案记录判定，口径待 D-02 冻结）；金额口径仅在 D-02=C 时从 `CaseSettlementTerms` 取，并明确"结算金额归属"的归属规则后再做。

## 6. HTTP 契约（提案）

统一 `/api/v1`，沿用会话、同源、CSRF 与 `X-Request-Id`。

| HTTP | 行为 | 权限要求 |
|---|---|---|
| `GET /lawyer-profiles` | 分页列表、筛选、服务端部门范围裁剪 | `lawyer.profile.read / DEPARTMENT` |
| `GET /lawyer-profiles/:id` | 档案详情（含专长、结算偏好摘要） | `lawyer.profile.read` |
| `POST /lawyer-profiles` | 新建档案（MANUAL），事务内写审计 | `lawyer.profile.manage / DEPARTMENT` |
| `PATCH /lawyer-profiles/:id` | 编辑档案字段，`expectedVersion` 乐观锁 | `lawyer.profile.manage` |
| `PATCH /lawyer-profiles/:id/status` | 启停档案 | `lawyer.profile.manage` |
| `GET /lawyer-profiles/search` | 检索选择（姓名/律所/电话），返回最小投影供表单带入 | `case.match` 或 `case.lawyer.assign` |
| `GET /lawyer-profiles/:id/performance` | 业绩只读投影 | `lawyer.profile.read` |
| `GET /lawyer-expertises` | 专长字典列表 | `lawyer.profile.read` |
| `POST/PATCH /lawyer-expertises` | 专长字典维护 | `lawyer.profile.manage` 或更高 |

`search` 端点独立于管理列表：只返回选人所需字段（id/姓名/律所/电话/地址），不暴露业绩与审计，避免把名录查询变成全部数据导出。

## 7. 事务、并发与授权

- 新建、编辑、启停各自开启 Serializable 事务，复用 `lawyer-account.service.ts` 的 `withVersionConflict()` 与部门授权模式：锁定操作者账号 → 校验 `lawyer.profile.manage` → 锁定目标档案 → 校验 `version` → 写入 + 审计，任一步失败整体回滚。
- 部门隔离：所有查询与写入按 `departmentId = actor.departmentId` 过滤；专长字典同样按部门。
- 前端按钮与菜单由服务端能力投影控制，但隐藏按钮不替代后端拒绝；直接访问路由由 API 返回 403。
- 幂等：编辑类命令使用 `expectedVersion` 防覆盖；不需要 `caseLawyerAssignmentReceipts` 那类业务幂等键（档案写非阶段推进）。

## 8. 前端设计

- 新增"律师库"页面（组织模块下，与 `LawyerAccountsPage` 并列）：列表 + 筛选 + 新建/编辑弹层 + 启停；沿用现有抽屉/表格视觉令牌，不新增第二套样式体系。
- 详情页：档案资料（只读）+ 专长 + 结算偏好摘要 + 业绩卡片。
- 案件侧：`CaseLawyerAssignmentBatchPanel`／`CaseLawyerReassignPanel` 的律师输入改造为检索选择器，接入 `GET /lawyer-profiles/search`，选人后带入电话/律所/地址（demo `lawyerMenu` + `pickLawyer` 交互为样板）。带入值仅作表单预填，不自动写库、不覆盖案件已有资料。

## 9. 迁移与去重策略

- 迁移只加列与加表，不改现有列、不重建 `LawyerAccountBinding` 触发器。
- 遗留档案（`source=LEGACY_MATCH`）先打标、不自动合并：新建名录时按 `fullName + departmentId` 提示疑似重复，由运营人工确认归并；归并只把遗留档案的 `assignments` 关联改指到目标档案，保留历史回执可读，不做数据删除。
- 迁移升级需专项验证：现有账号绑定、指派回执、审计链路在迁移前后行为一致。

## 10. 实施切片（每期独立验收）

| 期 | 内容 | 粗估 | 门禁 |
|---|---|---|---|
| 1 | 档案底座：加列 + CRUD + 检索 + 审计 + 权限 + 去重打标 | 6–9 人日 | Level 2 显式切片 + 安全复核（权限/部门隔离） |
| 2 | 扩展信息与维护页：专长字典 + 档案详情 + 律师库页面 + 表单选择器接入 | 6–9 人日 | Level 2 显式切片 + 浏览器验收 |
| 3 | 业绩投影：聚合查询 + 详情业绩卡片（金额口径按 D-02） | 5–8 人日 | 数据口径专项 + 回归 |

整体作为 Level 3：先 Review 与修复，稳定候选集执行完整 `pnpm verify`、数据库 E2E 与迁移专项；不因分期而降低最终门禁。

## 11. 风险登记

| 编号 | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R-01 | 档案与账号/指派引用耦合，误删或改绑破坏办案链路 | 高 | D-01=A、D-05=A；不物理删除；不碰触发器；迁移专项回归 |
| R-02 | 业绩口径未冻结导致返工（尤其金额归属） | 高 | D-02 先拍板；业绩只读；金额后置 |
| R-03 | 新名录与遗留姓名档案重复 | 中 | `source` 打标 + 疑似重复提示 + 人工归并；不自动合并 |
| R-04 | 权限粒度过粗，名录维护被当作账号管理放权 | 中 | D-04=B 独立权限；管理上下文投影能力 |
| R-05 | 检索端点变成变相全量导出 | 中 | 最小投影 + 部门裁剪 + 不暴露业绩/审计 |
| R-06 | 带入字段被误写回案件、覆盖已有资料 | 中 | 仅表单预填，服务端写入仍走原指派/匹配命令 |
| R-07 | 档案无版本底座，并发编辑互相覆盖 | 中 | 新增 `version` + 乐观锁 + 审计 |

## 12. 验收标准（草案）

1. 部门 A 运营只能看到/维护本部门档案，跨部门 ID 直接访问返回 403；律师账号登录后不能调用管理端点。
2. 新建→编辑→启停→检索全链路有字段级审计；并发两次编辑仅一次成功，另一次返回版本冲突。
3. 匹配/指派表单选人后正确带入电话/律所/地址，且不自动写库、不覆盖案件已有资料。
4. 业绩投影口径与 D-02 一致，抽样案件与指派记录逐条对得上；不产生任何业务写入。
5. 迁移升级后，既有律师账号绑定、指派回执与审计链路行为不变。
6. 前端全量检查、`vue-tsc`、`eslint`、相关 Jest/Vitest/Playwright 与完整门禁通过。

## 13. 下一步

1. 拍板 D-01、D-02（其余可在切片 1 冻结前定）。
2. 据决策修订本文并转正式 Spec，再拆实施计划与任务编号。
3. 本草案同步登记至[后续设计清单](../../deferred-design.md)前不视为授权；生产迁移、真实数据与部署另行准入。
