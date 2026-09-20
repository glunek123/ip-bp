# Team 与管理授权最小架构设计

## 目标与边界

本次只关闭人员账号、部门成员与角色分配 Slice 开工前的两个阻塞：把裸 `teamId` 收口为正式 Team 主数据，并为管理操作建立固定 PermissionAction 与服务端 Grant Boundary。不实现完整人员管理 UI、角色模板 Grant 编辑、客户准入状态机或任何 Lead、Case、File、Fee、Settlement、Report 表。

## Team 模型

`Team` 只包含 `id`、不可变的 `departmentId`、`name`、`ACTIVE | INACTIVE` 状态和时间戳，不增加 code、父团队或矩阵组织。Team 与 Department 使用数据库外键；`DepartmentMembership`、`RoleAssignment`、`Customer` 保留各自 Department 外键，并以 `(teamId, departmentId) -> Team(id, departmentId)` 组合外键保证同部门引用。

Team 不提供物理删除路径，数据库引用使用 `RESTRICT`。停用只禁止新建、重新绑定或恢复绑定，不清空历史引用，也不阻止未改变 Team 绑定的客户普通编辑。历史对象的可见性仍取决于当前有效成员关系和 Grant，不因历史引用永久放行。

## 迁移

迁移拆为有序的两步：第一步在独立显式事务中只扩展既有 `permission_action` 枚举并提交；第二步在显式事务中锁定三个引用表，建立 Team、回填裸 UUID、增加组合外键并执行受控补权。

第二步为每个现有 `(旧 teamId, departmentId)` 建立 ACTIVE 兼容 Team。若同一个旧 UUID 被多个部门复用，按 `departmentId` 排序后第一个部门保留旧 UUID，其余部门生成确定性的新 UUID；三个引用表共用同一映射。`NULL` 不回填。迁移在加约束前验证无悬空引用，任何失败回滚第二步全部数据变化；第一步已提交的枚举值保留，恢复方式是修正数据后前向重跑。

现有数据库没有可证明的“初始化角色来源”字段，因此迁移不按角色名称批量猜测补权。新库初始化会授予全部当前 Action；现有部署的补权由预检确认的唯一初始化关系限定：部门内恰有一个本地账号、该账号只有一个活动部门级角色分配、角色包含全部旧客户 Action，且该角色模板从未分配给其他账号。只有满足该结构的角色才补六个 DEPARTMENT 管理 Grant，并递增受影响账号的 `authorizationRevision`；共享角色或其他不满足条件的部署保持未补权并由运维显式处理。

## 管理 Action 与对象范围

新增 `user.read`、`user.manage`、`team.read`、`team.manage`、`role.read`、`role.assign`。管理动作沿用固定代码目录，不允许配置创造未知动作。

- `team.manage`：新建及启停 Team 均要求 DEPARTMENT；TEAM 范围留给后续已明确的团队内维护动作，SELF 对 Team 主数据默认拒绝。
- `role.assign`：对象是目标部门成员。DEPARTMENT 可覆盖本部门其他成员；TEAM 只覆盖同一活动 Team 的其他成员；SELF 不允许向他人授予角色，且禁止自分配／自恢复。
- 未定义的管理 Action／Scope 组合默认拒绝。

## Grant Boundary

角色分配服务在同一事务中锁定操作者、目标成员、目标角色、Team 和已有分配，再重新加载当前 Grant。操作者必须拥有覆盖目标成员的 `role.assign`，且目标角色的每一个 Grant 都必须被操作者同 Action 的实际范围覆盖。

覆盖不是简单的 Scope 数值比较：DEPARTMENT 可覆盖本部门同 Action 的 DEPARTMENT、TEAM、SELF；TEAM 仅能覆盖绑定同一 Team 的 TEAM。由于当前客户模型不能证明目标用户 SELF 数据一定属于其当前 Team，TEAM 不覆盖 SELF；操作者 SELF 与目标用户 SELF 也不是同一范围，因此不允许向他人转授 SELF。管理 Grant 同样逐项检查。

新建、恢复或改变 RoleAssignment 绑定都执行同一边界。TEAM Grant只有在操作者当前成员Team为ACTIVE且分配Team与成员Team一致时有效。调队时若成员仍有任何活动且绑定Team的RoleAssignment，则拒绝调队，要求先显式处理分配。授权写入、审计与目标账号 `authorizationRevision` 递增保持原子；部门序列锁与账号、成员、角色、Grant、Team及分配行锁共同避免并发停用、调队、撤权或恢复绕过检查。客户新建也在写事务内共享锁定Team并重检ACTIVE，和Team停用形成确定顺序。

## 验证

单元测试覆盖有权、无权、跨部门、跨 Team、SELF 转授、TEAM 转授 SELF、缺失管理 Action、恢复／改绑旁路与事务失败。数据库测试覆盖有效 Department、悬空 Team、跨部门 Team、停用后历史引用、新绑定拒绝、跨部门 UUID 冲突回填、第二步回滚及新旧初始化路径。客户既有 TEAM／SELF 数据库查询测试继续作为最终 Scope 证据。

`CustomerProfileStatus` 保持 `DRAFT`。正式准入继续按“文件能力 → 完整性规则 → 准入规则 → 状态机 → Command → Audit”顺序单独实施。
