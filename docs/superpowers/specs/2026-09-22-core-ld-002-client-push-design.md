# CORE-LD-002 运营推送至真实客户端审核设计

## 目标与范围

本切片完成唯一主状态变化 `WAITING_PUSH → WAITING_REVIEW`，并交付可由管理员正式创建、绑定和停用的企业客户账号，以及真实账号密码登录后的最小客户只读端。客户只能读取绑定企业已推送的线索和允许的线索截图；客户审核 Command、批量推送、完整门户和后续状态不在本切片。

## 方案选择

考虑过三种实现：

1. **共享认证、区分账号类型、独立企业绑定（采用）**：复用 `UserAccount`、`LocalCredential`、`AuthSession` 和密码策略；新增 `INTERNAL/CLIENT` 账号类型及客户企业绑定。内部授权仍要求有效部门成员与角色，客户读取只认当前有效企业绑定。
2. **把客户账号建成内部部门成员（拒绝）**：改动少，但会使客户身份落入 `SELF/TEAM/DEPARTMENT` 推导，违反企业数据范围边界，并可能因角色误配获得运营权限。
3. **另建客户认证与会话体系（拒绝）**：隔离直观，但重复密码、会话、CSRF、限速与撤权能力，形成平行架构，不符合复用约束。

## 身份、模型与迁移

- `UserAccount.accountType` 新增 `INTERNAL | CLIENT`，历史账号前向迁移为 `INTERNAL`。
- 新增 `CustomerAccountBinding`：稳定 UUID、`userId` 唯一、`customerId + departmentId` 组合外键、`active`、`version` 和时间戳。一个客户可绑定多个账号，一个客户账号只锚定一个企业。
- 数据库触发器阻止 `CLIENT` 账号拥有 `DepartmentMembership` 或 `RoleAssignment`，也阻止 `INTERNAL` 账号建立客户绑定；服务层同时校验，避免只靠应用约定维持身份隔离。
- `AuthSession.departmentId` 继续保存会话所属数据分区：内部账号取登录部门，客户账号取绑定客户的部门。会话视图新增 `principalType`，内部返回部门信息，客户返回企业信息；客户页面不展示内部部门。
- `ActorContext` 增加只由服务端真实会话解析得到的 `clientCustomerId`。内部服务仍必须通过成员关系和角色授权；客户 Query 必须要求该字段且重新读取当前有效绑定。停用账号或绑定后，下一请求立即失效并撤销已有会话。
- `Lead` 新增 `pushedAt`、`pushedByUserId`，两者必须同时为空或同时非空；仅推送 Command 写入。
- `PermissionAction` 新增 `lead.push` 和 `client.lead.read`。`lead.push` 进入内部角色 Grant 目录并支持现有三种内部范围；`client.lead.read` 不进入可分配内部角色目录，由有效客户绑定固定承载，避免把外部企业范围误配成内部组织范围。
- 新增前向迁移；只对满足现有“单一 bootstrap 管理角色”安全识别条件的角色补 `lead.push@DEPARTMENT`，不向任意自定义角色扩大授权。

## 管理入口

客户详情页增加“客户账号”面板：

- `POST /api/v1/customers/:customerId/client-accounts` 使用现有用户名、密码和显示名规则，在一个事务内创建 `CLIENT` 用户、凭据、企业绑定和审计。
- `GET /api/v1/customers/:customerId/client-accounts` 返回本客户账号最小列表，不返回密码散列、会话或其他企业信息。
- `PATCH /api/v1/customers/:customerId/client-accounts/:userId/status` 原子切换账号与绑定有效性、递增授权修订、撤销会话并审计。
- 管理操作同时要求操作者拥有 `USER_MANAGE@DEPARTMENT`，且 `customer.read` 当前范围覆盖目标客户；客户必须仍为 `ADMITTED`。用户名冲突返回稳定错误。

## 推送 Command

`POST /api/v1/leads/:id/push` 要求 `Idempotency-Key` 请求头和 `{ expectedVersion }` 正文。服务端在 Serializable 事务中按顺序完成：

1. 重新读取当前账号授权修订、成员关系和 `lead.push` Grant，并确认范围覆盖目标线索。
2. 锁定线索并检查状态为 `WAITING_PUSH`、版本匹配、客户仍为 `ADMITTED`、至少一项有效商品、至少一个 `active` 绑定且关联账号也 `active`。
3. 同一幂等键若已有成功回执：指纹相同返回不可变首次快照，指纹不同返回 `IDEMPOTENCY_CONFLICT`。
4. 条件更新状态、`pushedAt`、`pushedByUserId` 和版本；写 `lead.pushed` 成功审计及 `LeadCommandReceipt(action=push)`。

审计、状态更新和回执同成同败。错误状态返回 `INVALID_STATE`，旧版本或并发竞争返回 `VERSION_CONFLICT`，无客户账号返回 `CLIENT_ACCOUNT_UNAVAILABLE`，越权统一为 `ACTION_FORBIDDEN`。响应含推送时间和操作者标识，运营详情据此显示“线索待审核”和推送记录。

## 客户只读 Query 与附件

- `GET /api/v1/client/leads` 只查询 `customerId = actor.clientCustomerId AND status = WAITING_REVIEW`，稳定按 `pushedAt desc, id asc` 分页。
- `GET /api/v1/client/leads/:id` 使用相同企业和状态条件，跨企业、待推送及不可访问对象统一返回 `RESOURCE_NOT_FOUND`。
- 客户响应使用单独 DTO，只暴露业务号、状态、案件/侵权类型、来源/平台、发现时间、店铺、商品、权利主体名称、推送时间和当前允许截图；不返回部门、团队、运营负责人、内部备注、创建渠道、外部导入引用、审计操作者或内部 capability。
- 现有材料读取/下载服务增加客户只读授权分支：只接受 `LEAD` 所有者，且线索必须属于绑定企业并处于 `WAITING_REVIEW`。上传、删除、恢复及客户证件材料接口仍拒绝客户身份。内容继续通过私有存储 Adapter 流式下载，不暴露永久地址。

## 前端

- 登录页继续使用同一账号密码入口；登录成功后按 `principalType` 跳转运营端或 `/client/leads`。
- 路由元数据区分 `internal` 与 `client`，守卫阻止客户进入运营路由、也阻止内部账号进入客户路由。
- 共享壳层按身份显示运营导航或最小客户导航；客户侧只显示“待审核线索”和当前企业。
- 运营线索详情仅在 `WAITING_PUSH` 且服务端 capability 为真时显示“推送至客户”，包含提交中禁用、成功反馈及稳定错误映射；不做乐观状态伪造，成功后重新读取服务端结果。
- 客户列表和详情使用现有卡片、表格、状态、空态与错误态视觉语言；详情支持下载允许截图并在刷新后保持服务端状态。

## 测试与原子性

- 单元/契约测试先行覆盖账号类型隔离、真实登录分流、账号管理授权、推送全部前置条件、幂等重放/冲突、版本竞争、错误状态、审计或回执失败回滚、客户企业范围和材料读取范围。
- PostgreSQL E2E 覆盖正常推送并由正确客户读取、跨企业/待推送不可见、停用账号或绑定下一请求失效、迁移约束及并发推送竞争。
- 迁移专项从空库执行全链，并从上一支持 schema 合成升级数据；验证身份隔离触发器和字段约束。
- Playwright 使用真实管理员/运营/客户账号、同源 Cookie 会话、真实截图字节和数据库，完成运营登录→推送→退出→客户登录→查看/下载→刷新。

## 非目标与未决

本设计不定义客户审核结论、后续状态机、客户自助账号管理、生产对象存储、批量推送或完整客户门户。不存在阻塞本切片的业务未决项。
