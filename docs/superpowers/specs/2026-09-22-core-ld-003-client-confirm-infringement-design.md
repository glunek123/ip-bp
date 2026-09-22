# CORE-LD-003 客户确认侵权设计

## 目标与范围

本切片在 CORE-LD-002 已交付的真实客户账号、企业绑定、登录会话、客户端待审核列表与详情基础上，只完成一次客户动作和一次主要状态变化：企业客户对本企业 `WAITING_REVIEW` 线索确认侵权，线索原子进入 `WAITING_EVIDENCE_DECISION`。客户与运营随后都能读取同一审核结论，运营端出现后续“确认是否取证”的待办状态，但本切片不提供取证决定按钮。

本切片不实现客户判定不侵权、归档、运营取证或不取证、公证移交、批量审核、撤回审核及完整客户门户。

## 方案选择

比较过三种承载审核事实的方案：

1. **专用不可变审核决定与客户命令回执（采用）**：新增一对一的 `LeadReviewDecision` 保存客户审核业务事实，新增 `ClientLeadReviewReceipt` 保存外部客户命令的幂等回执；两者与线索状态更新在同一事务内完成。
2. **放宽通用审计和回执表的内部成员约束（拒绝）**：现有 `AuditEvent` 与 `LeadCommandReceipt` 通过 `DepartmentMembership` 锚定内部操作者。客户账号依法不能拥有内部成员关系；为单个外部动作修改所有既有命令的操作者约束会扩大迁移和回归范围，并削弱身份隔离。
3. **只在线索表保存审核人和时间（拒绝）**：实现较少，但审核事实可随线索更新而被覆盖，不能形成不可变决定，也不能同时满足审计和幂等回放要求。

`LeadReviewDecision` 是本动作的权威业务事实和不可抵赖审计记录；`Lead` 只保存当前状态与版本，避免维护两份审核真相。

## 客户交互闭环

客户端线索入口调整为两个清晰视图：

- `待我审核`：默认视图，只显示本企业 `WAITING_REVIEW` 线索。
- `已处理`：本切片只显示本企业已有有效侵权决定且处于 `WAITING_EVIDENCE_DECISION` 的线索。

客户从待审核详情点击“确认侵权”前，页面明确说明：确认后线索将进入“线索待确认”，由运营决定是否取证，当前入口不能撤回。确认弹窗再次展示该影响；取消不产生任何写入。

提交成功后页面不跳回空列表，而是在原详情显示“已确认侵权”、审核人、审核时间和“等待运营确认是否取证”。刷新、直接再次打开详情或从“已处理”进入时均读取服务端持久化结果。页面不显示“不侵权”、取证或公证移交操作。

## 权限与企业数据范围

- `PermissionAction` 新增 `CLIENT_LEAD_REVIEW`，动作值为 `client.lead.review`。
- 该动作不进入内部角色授权目录，不允许通过 `RoleGrant` 配置，也不参与 `SELF/TEAM/DEPARTMENT` 范围推导。
- 客户审核能力固定来自当前真实会话中的 `CLIENT` 账号和有效 `CustomerAccountBinding`。每次命令都重新读取账号、绑定和客户当前状态，不信任前端隐藏按钮或旧会话缓存。
- 操作者必须仍为有效客户账号，绑定仍有效，绑定客户仍为 `ADMITTED`，线索属于同一客户与部门，且线索已推送。
- 跨企业、未推送及其他不可见线索统一返回 `RESOURCE_NOT_FOUND`，不泄漏对象是否存在。
- 停用账号、撤销绑定或客户退出准入后，下一次读取和审核请求立即失效；已写入的历史决定仍保留。

## 数据模型与迁移

新增 `LeadReviewResult`，本切片只包含 `INFRINGEMENT`。后续 `NO_INFRINGEMENT` 由 CORE-LD-004 以独立前向迁移补充，不在本切片预实现归档字段或原因规则。

新增 `LeadReviewDecision`：

- 稳定 UUID；
- `departmentId`、`leadId`、`customerId`；
- `reviewerUserId`、`customerAccountBindingId`；
- `reviewerDisplayNameSnapshot`；
- `result=INFRINGEMENT`；
- 服务端生成的 `decidedAt`；
- `fromVersion`、`toVersion`；
- 每条线索最多一条客户审核决定。

决定表使用组合外键保持线索、客户和部门一致，审核账号与客户绑定关系明确保存。数据库触发器拒绝对已提交决定执行 `UPDATE` 或 `DELETE`，账号或绑定后续停用不影响历史事实。

新增 `ClientLeadReviewReceipt`：

- `departmentId`、`actorUserId`、`customerAccountBindingId`；
- 固定动作 `client.lead.review`、`idempotencyKey`、请求 `fingerprint`；
- `resultLeadId`、`resultVersion`、`reviewDecisionId`；
- 首次成功响应的不可变 `resultSnapshot`；
- `(departmentId, actorUserId, action, idempotencyKey)` 唯一。

决定、回执和线索状态更新必须同成同败。迁移使用前向迁移，不修改既有迁移；枚举扩展与结构迁移继续遵循 PostgreSQL 的分阶段约束。迁移验证覆盖空库全链和上一支持 schema 升级。

## 审核 Command

新增：

```http
POST /api/v1/client/leads/:leadId/reviews
Idempotency-Key: <1..128 characters>

{
  "result": "INFRINGEMENT",
  "expectedVersion": 2
}
```

服务端在 Serializable 事务中完成：

1. 重新验证 `CLIENT` 账号、当前有效企业绑定和客户准入状态。
2. 计算由线索 ID、`result` 和 `expectedVersion` 构成的稳定请求指纹。
3. 查询同一操作者、动作和幂等键的成功回执；指纹相同返回首次成功快照，指纹不同返回 `IDEMPOTENCY_CONFLICT`。
4. 锁定线索并验证企业与部门范围；不可见资源统一拒绝。
5. 验证状态仍为 `WAITING_REVIEW`、版本等于 `expectedVersion`，且推送事实完整。
6. 条件更新为 `WAITING_EVIDENCE_DECISION` 并递增版本。
7. 写入不可变 `LeadReviewDecision` 和 `ClientLeadReviewReceipt`。
8. 提交后返回审核结论、审核人、审核时间和最新线索版本。

相同幂等键和相同请求重放返回原结果，不重复推进、决定或回执。相同键不同请求返回 `IDEMPOTENCY_CONFLICT`。旧版本返回 `VERSION_CONFLICT`，已被其他请求推进返回 `INVALID_STATE` 或在条件竞争中稳定归一为版本冲突；两个不同幂等键并发时只允许一个成功。

任何状态更新、决定或回执写入失败均回滚整个事务。序列化冲突按现有 Command 模式有限重试，不绕过当前授权、状态或版本校验。

## 查询、附件与运营可见性

- 客户列表接受受限视图参数，只能选择 `WAITING_REVIEW` 的“待我审核”或具有侵权决定的 `WAITING_EVIDENCE_DECISION`“已处理”，后端仍强制企业绑定过滤。
- 客户详情允许读取上述两种状态；`WAITING_EVIDENCE_DECISION` 必须存在本 Slice 产生的有效决定才进入“已处理”。
- 客户响应继续使用独立 DTO，不暴露内部负责人、部门、备注、权限或审计基础设施字段；审核后只新增必要的结论、审核人显示名和审核时间。
- 客户材料读取范围扩展为本企业 `WAITING_REVIEW` 或带有效决定的 `WAITING_EVIDENCE_DECISION` 线索；上传、删除、恢复及其他所有者材料仍拒绝。
- 运营线索列表沿用既有 `WAITING_EVIDENCE_DECISION` 状态和阶段计数。运营详情新增只读“客户审核记录”，展示结论、审核账号显示名和时间，不提供 CORE-LD-005/006 操作。

## 前端行为与错误反馈

- 客户列表使用“待我审核／已处理”两个直接标签，不要求用户理解数据库状态名。
- 详情只在服务端响应可审核且状态为 `WAITING_REVIEW` 时显示“确认侵权”。按钮隐藏不替代后端授权。
- 提交期间按钮禁用并显示加载状态；不做乐观状态伪造，成功后使用服务端响应并重新读取详情。
- `VERSION_CONFLICT` 和 `INVALID_STATE` 提示“线索状态已变化，请刷新查看最新结果”；刷新后若已有决定则进入已处理展示。
- `IDEMPOTENCY_CONFLICT` 明确提示本次操作未执行并生成新的请求键后方可重试；权限、绑定或准入失效使用稳定会话／权限提示。
- 所有必填、影响说明和确认文案继续遵守 SD-38 的快速上手原则。

## 测试与验收

聚焦测试覆盖：

- 正常确认侵权并由同一客户和运营读取同一决定；
- 其他企业客户不可读取或提交；
- 客户不可审核或读取 `WAITING_PUSH`；
- 内部账号、未绑定账号、停用账号／绑定和非 `ADMITTED` 客户拒绝；
- 错误状态、旧版本、相同键重放、相同键不同请求及不同键并发竞争；
- 决定或回执失败时整体回滚；
- 决定记录在数据库层不可修改或删除；
- 撤销账号或绑定后下一请求立即失效，但历史决定仍可由有权运营读取；
- 确认后客户仍可读取允许截图，其他企业和其他所有者材料不可读取；
- 迁移从空库和上一支持 schema 可执行。

真实浏览器验收使用真实账号密码、Cookie 会话、PostgreSQL 和真实材料字节，完成：

```text
运营登录并推送
→ 客户登录并在“待我审核”打开线索
→ 确认侵权
→ 详情显示结论并刷新仍存在
→ “已处理”可重新进入
→ 退出客户账号
→ 运营登录并在线索待确认详情看到相同结论
```

## 非目标与后续边界

CORE-LD-004 以后才增加 `NO_INFRINGEMENT`、必填原因和归档事实；CORE-LD-005/006 以后才提供运营不取证或确认取证并移交。当前设计不创建通用工作流引擎、不改造完整审计平台、不建设完整客户门户，也不为后续状态预置无当前用途的页面或按钮。

不存在阻塞本切片实施的业务未决项。
