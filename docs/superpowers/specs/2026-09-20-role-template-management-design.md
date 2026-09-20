# 角色模板复制与 Grant 配置闭环设计

日期：2026-09-20

任务：ROLE-TEMPLATE-001

状态：方案 A 已确认，进入实施计划与编码。

## 1. 目标与依据

本 Slice 关闭路线图第 03 项尚缺的角色模板管理闭环：有权管理员在现有“人员与权限”工作区复制当前部门的已有模板，选择代码中已经实现的 Permission Action 与 SELF／TEAM／DEPARTMENT 范围，保存为新模板；也可修改现有模板，并在保存前自动看到会受影响的活动人员。保存成功后，模板的现有活动受让人在下一次请求中使用新 Grant。

设计继续遵守 REQ-SY-004、现有 Grant Boundary、服务端数据范围校验及未知 Action 默认拒绝规则。用户已确认采用方案 A：新增独立 `ROLE_MANAGE` 权限，`ROLE_ASSIGN` 只负责把既有模板分配给人员，不再隐含模板编辑权。前端能力提示不代替后端授权。

## 2. 范围与排除项

本 Slice 包含：

- 当前部门活动角色模板的复制和现有模板编辑。
- 固定 Permission Action 目录、允许范围和人类可读说明。
- 完整 Grant 集合的选择、校验和原子替换。
- 保存前自动预览当前模板的活动受让人及人数。
- 模板乐观版本控制、唯一名称冲突、事务回滚和审计。
- 模板变更后受影响账号的 `authorizationRevision` 递增，使旧会话在下一请求失效。
- 正式 Vue 交互、真实 PostgreSQL、迁移和浏览器验收。

本 Slice 不包含：

- 创建新的 Permission Action、自定义条件表达式、策略语言或任意资源规则。
- 跨部门模板、公司级全局角色、TEAM／SELF 范围的模板管理权。
- 模板删除、停用／恢复、批量分配或角色继承。
- 审批流、修改原因、二次认证、MFA、OIDC 或生产发布。
- 多联系人、客户负责人、案件分派及其他业务模块权限扩展。

## 3. 授权模型

Prisma `PermissionAction` 新增 `ROLE_MANAGE @map("role.manage")`。权限语义明确拆分：

- `ROLE_READ`：读取可见模板及 Grant 摘要。
- `ROLE_ASSIGN`：向合法目标分配已有模板。
- `ROLE_MANAGE`：复制或编辑模板及其 Grant。

模板管理只接受 `ROLE_MANAGE / DEPARTMENT`。TEAM 或 SELF Grant 不提供模板写能力，也不在界面显示保存入口。读取和预览仍限定操作者当前部门；跨部门或不可见模板统一返回 403，不泄漏目标是否存在。

操作者对结果 Grant 的覆盖使用更严格的部门级边界：最终 Grant 集合中的每一个 Action，操作者都必须实际拥有同一 Action 的 `DEPARTMENT` Grant。不能用 TEAM／SELF Grant 创建可被分给整个部门或其他 Team 的模板，也不能借编辑自己已获分配的模板完成自我提权。每次复制和保存都在事务内重新加载操作者授权，前端目录不是授权来源。

模板可以包含 `ROLE_MANAGE`，但只有本身已具有 `ROLE_MANAGE / DEPARTMENT` 的操作者才能配置；同理，任何尚未实现或未进入固定枚举目录的 Action 都无法提交。最终 Grant 集合至少包含一项，不允许创建无作用模板。

## 4. 数据与迁移

现有 `RoleTemplate` 已有部门组合唯一约束、`version`、`active`、`grants` 和 `assignments`；`RoleGrant` 已有模板／Action／Scope 唯一约束。除新增枚举值外不增加模型或依赖。

迁移分两步保持 PostgreSQL 枚举规则和最小授权原则：

1. 独立前向迁移只向 `permission_action` 增加 `role.manage`。
2. 后续前向迁移在事务和引用表锁内，仅为满足既有“引导管理员”结构特征且角色未被其他账号共享的唯一引导关系补充 `ROLE_MANAGE / DEPARTMENT`。不得按角色名称、用户名或“当前看起来像管理员”批量补权。

本地引导服务使用 `Object.values(PermissionAction)` 创建首位管理员 Grant，因此生成客户端更新后会自然包含新动作；已有数据库仍只依赖上述受控迁移。迁移测试必须覆盖共享角色不补权、非引导关系不补权、幂等部署和故障回滚。

## 5. HTTP 与读模型契约

沿用 `/api/v1/organization` 会话、同源和 CSRF 保护：

| HTTP                                                      | 行为                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /organization/management-context`                    | 增加模板管理 capability、模板版本、活动受让人数和固定权限目录          |
| `GET /organization/role-templates/:roleTemplateId/impact` | 返回当前部门内该模板的活动受让人最小投影                               |
| `POST /organization/role-templates`                       | 以 `sourceRoleTemplateId`、新名称和完整 Grant 集合一次性复制并创建模板 |
| `PATCH /organization/role-templates/:roleTemplateId`      | 以名称、完整 Grant 集合及 `expectedVersion` 更新模板                   |

`management-context` 中新增：

- `capabilities.manageRoleTemplates: boolean`；
- 每个角色的 `version` 与 `activeAssignmentCount`；
- `permissionCatalog`，每项只含固定 `action`、显示名称及允许选择的 `scopes`。

复制接口不先生成空草稿；打开复制表单时前端以来源模板预填，用户一次保存才创建完整新模板。更新接口采用全量 Grant 集合，避免增删接口组合造成中间状态。影响预览是便捷读模型，不作为保存授权或并发依据；保存时服务端重新计算真实活动受让人。

## 6. 服务、事务与并发

在访问控制模块内新增聚焦的 `RoleTemplateService`，复用现有操作者上下文、部门序列锁、Grant Boundary、审计和 Prisma 事务约定，不让 Controller 直接访问数据库。复制命令在一个 Serializable 事务中：

1. 锁定当前部门并重新加载操作者、成员关系和实际 Grant。
2. 校验 `ROLE_MANAGE / DEPARTMENT` 和完整结果 Grant 的部门级覆盖。
3. 锁定并确认来源模板属于当前部门且活动。
4. 规范化并校验名称、重复 Grant、未知 Action／Scope和非空集合。
5. 创建模板、全部 Grant 和成功审计；任一步失败整体回滚。

编辑命令使用相同锁顺序，额外锁定目标模板、其 Grant、活动 RoleAssignment 和对应 UserAccount：

1. `expectedVersion` 必须等于当前模板版本，否则返回稳定冲突。
2. 全量替换 Grant，按需更新名称，并把模板版本加一。
3. 对当前部门内所有活动受让账号各递增一次 `authorizationRevision`。
4. 写入同事务审计，记录模板 ID、版本、变更前后 Grant 摘要和受影响人数，不记录跨部门对象或秘密。

事务失败时模板、Grant、版本、授权修订和审计全部不变。并发编辑只有一个版本获胜；失败方收到冲突并重新载入。模板变化通过授权修订让已有会话下一请求失效，重新登录后读取新 Grant，不维持旧权限缓存。

## 7. 错误与审计

至少使用以下稳定错误码：

- `ROLE_TEMPLATE_NAME_ALREADY_EXISTS`（409）
- `ROLE_TEMPLATE_VERSION_CONFLICT`（409）
- `ROLE_TEMPLATE_GRANTS_REQUIRED`（400）
- `ROLE_TEMPLATE_DUPLICATE_GRANT`（400）
- `ROLE_TEMPLATE_GRANT_NOT_COVERED`（403）
- `ROLE_TEMPLATE_SOURCE_UNAVAILABLE`（403）

未知、跨部门或无权模板不返回 404 差异。复制、编辑成功与业务对象同事务审计；自我提权、越级 Grant 和跨部门尝试沿用拒绝型审计，只记录操作种类和稳定拒绝码。权限目录中没有的 Action、非枚举 Scope 或额外字段在 DTO／严格响应解析层直接拒绝。

## 8. 前端交互

在现有 `/settings/people-access` 工作区增加“角色模板”区域，拆为独立组件，避免继续扩大单页职责：

- 列表显示模板名称、Grant 摘要、版本和受影响人数。
- “复制”打开已预填的同一表单；用户修改名称和 Grant 后一次保存，不产生半成品。
- “编辑”使用相同表单；Action 使用复选框，勾选后用单个范围下拉框选择 SELF／TEAM／DEPARTMENT。
- 打开编辑时自动加载并显示受影响人员摘要；无需单独点击预览，也不阻断继续编辑。
- 保存不要求原因、审批或重复输入密码。409 保留输入并提示刷新；403 显示权限不足；网络错误不清空表单。
- 无 `manageRoleTemplates` 时仍可按既有 `ROLE_READ` 规则查看模板摘要，但不显示复制／编辑按钮；服务端始终再次校验。

权限目录由后端返回固定代码值和展示元数据，前端不自行发明动作；前后端都进行严格解析，出现未知 Action 时拒绝整份响应而不是静默忽略。

## 9. 测试与完成标准

本任务属于 Level 3，按 Q2／`ASTRA_THEN_SPARK` 路由实施。测试先行覆盖：

1. Schema／迁移：新枚举、受控引导补权、共享角色不补权、幂等和回滚。
2. 服务与 Controller：复制、编辑、影响预览、固定目录、非空／重复 Grant、名称冲突、版本冲突和严格 DTO。
3. 权限负向：没有 `ROLE_MANAGE`、TEAM／SELF 管理 Grant、跨部门、未知 Action、越级范围、自我提权和并发撤权。
4. 事务与并发：Grant 替换、版本、授权修订、审计共同提交或共同回滚；并发编辑只有一个成功。
5. 前端：能力控制、预填复制、复选框／范围选择、自动影响预览、409 保留输入、未知响应拒绝和无繁琐确认。
6. PostgreSQL／浏览器主路径：管理员复制模板并分配给人员 → 人员登录验证范围 → 管理员编辑模板 → 受影响会话下一请求失效 → 重新登录只获得新权限。

最终固定候选必须通过聚焦测试、迁移测试、`pnpm verify`、适用数据库 E2E 和独立 Level 3 Review。只有 Review 为 `ACCEPTED` 且未关闭 finding 为 0，才可把路线图第 03 项标记完成；本地完成不等于推送、合并、发布或生产迁移。

## 10. 后续

本 Slice 完成后，唯一 Next Slice 为“多联系人及客户关系维护”。角色模板停用／删除、全局角色、自定义策略、跨部门管理和业务域新增 Action 仍需独立设计，不因本任务自动获批。
