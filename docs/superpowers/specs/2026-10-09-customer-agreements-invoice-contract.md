# CORE-CU-007 协议与开票资料实施契约

2026-10-09；固定前态`75acd3c9a7d73257bdbe5ab40d4614d73bef6ec6`，实际通过业务候选`db33bf6c717e98829ba2728a6a9455cf1d886eaf`及102迁移。规则来源：用户批准的客户总计划、REQ-CU-004及SD-12/20/45/47/48；本文确定CU007实现边界，不能据本文声称已实现或验收。具体切片见[实施计划](../plans/2026-10-09-customer-agreements-invoice.md)。

## 业务对象与投影

- 每客户最多一条稳定 `CustomerAgreement`，按 `(customerId,departmentId)` 唯一。创建、续签和修改均形成不可变 `CustomerAgreementVersion`；当前指针只指向该协议的一版。协议只独立维护，不自动绑定 Lead/Case，也不回填旧案件。
- 协议版：`id/agreementId/customerId/departmentId/version/title/model?/settlementMethod?/validityMode/effectiveFrom?/effectiveTo?/contentVersionIds[]/recordedByUserId/recordedAt/auditEventId`。`title` 必填、最多 200；`model` 最多 100；`settlementMethod` 最多 200。期限为 `FIXED | LONG_TERM | UNKNOWN`；FIXED 需要真实 `effectiveTo`，另两类必须 `effectiveTo=null`；已知起止按公历校验且起日不得晚于止日。未知起日保持 null，录入时刻不得充当生效日。`contentVersionIds` 是按提交顺序冻结的精确内容版本 ID；空数组允许，UI 显示“未附协议文件”，不推断已签署或法律效力。
- 每客户最多一条 `CustomerInvoiceProfile`，按 `(customerId,departmentId)` 唯一；每次修改产生不可变版。版本仅有 `invoiceType?`（100）、`invoiceSubject?`（200）、`taxNo?`（100）、`bank?`（500）及真实录入人与时刻、审计。四项都允许未知；trim 后空值存 null。`bank` 是单个自由文本“开户银行及账号”，不拆分、不填默认值；`invoiceSubject` 不从客户名称或权利人推导。“从未建档”与“已建档且四项未知”是不同响应状态。这里不表示实际开票事实。
- 敏感字段仅在独立协议/开票响应与明确授权的协议 Material 响应出现；通用 CustomerSummary/Detail、客户列表/导出及普通历史日志不增加上述字段、文件名、税号或银行。
- 通用 `GET /customers/:id` 的 `CustomerDetail.capabilities` 只新增当前授权计算的 Boolean：`agreement: {read,edit}`、`invoice: {read,edit}`。不得在能力位内放实体 ID、版本、文件名、数量或敏感事实。`agreement.edit`/`invoice.edit` 各要求对应 `read` 与 `customer.read` 同客户范围；专用 GET 可返回 `canEdit`，仍逐请求重新授权。前端 `frontend/src/api/customers.ts` 对新增 Boolean 做严格解码；无需新增能力服务或元数据发现路由。
- 协议/开票审计优先用既有 `AuditEvent` 的独立资源类型与对应实体 ID；固定CU006验收基线已核其真实字段/约束。专用授权版本历史呈现 actor/时刻；通用 `CustomerDetail.history` 不得暴露新敏感动作或事实。若基础设施不支持独立资源类型，先向 Root 报告局部授权过滤方案，不改共享审计机制。

## HTTP 契约（DTO、响应与OpenAPI必须一致）

| 路由                                                                             | 成功 | 请求与响应要点                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /customers/:customerId/agreements`                                          | 200  | 单协议空态 `{agreement:null}` 或稳定 id 与 currentVersion；不内嵌无界历史。                                                                                                              |
| `POST /customers/:customerId/agreements`                                         | 201  | `Idempotency-Key`、`expectedCustomerVersion`、版字段及可省略 `contentVersionIds`；省略即 `[]`。返回新协议 id/current 版、更新后的 Customer version。Nest 显式 `@ApiCreatedResponse`。    |
| `GET /customers/:customerId/agreements/:agreementId`                             | 200  | id 必须属于该客户及部门；返回稳定实体与当前版。不同 id 统一无范围 404。                                                                                                                  |
| `GET /customers/:customerId/agreements/:agreementId/versions?page=1&pageSize=20` | 200  | 独立历史分页，默认 20、上限 100，按 `version DESC,id DESC` 稳定排序；`items/total` 同权限同范围，每条给精确 materialId/contentVersionId 与真实期限。                                     |
| `POST /customers/:customerId/agreements/:agreementId/revisions`                  | 200  | `expectedCustomerVersion/expectedAgreementVersion`、版字段、可省略材料数组。省略继承上一版精确 ID 数组；显式 `[]` 清空新当前版，历史不变。Nest 显式 `@HttpCode(200)`、`@ApiOkResponse`。 |
| `GET /customers/:customerId/invoice-profile`                                     | 200  | `{profile:null}` 或稳定 id/currentVersion；不内嵌无界历史，不向通用客户响应混入敏感字段。                                                                                                |
| `GET /customers/:customerId/invoice-profile/versions?page=1&pageSize=20`         | 200  | 独立历史分页，默认 20、上限 100，按 `version DESC,id DESC`；未建档时返回空 `items/total=0`，不得暴露其他客户。                                                                           |
| `POST /customers/:customerId/invoice-profile`                                    | 201  | `Idempotency-Key`、`expectedCustomerVersion`、四个可空字段；缺省均为 null。显式 `@ApiCreatedResponse`。                                                                                  |
| `POST /customers/:customerId/invoice-profile/revisions`                          | 200  | `expectedCustomerVersion/expectedInvoiceVersion`；省略字段保留前版，显式 null 清空，历史不变。显式 `@HttpCode(200)`、`@ApiOkResponse`。                                                  |

所有新协议/开票命令的Idempotency-Key为1..200字符，receipt使用相同上限；前端生成原键并按原键恢复，不改变旧模块键限制。严格 DTO 拒绝未知键、非法日期、重复内容版本 ID、跨 owner/department/category/purpose、不为 AVAILABLE 的内容版本和超过 10 个附件。协议文件沿用 `GET /materials/:materialId/versions/:versionId/content`，按历史给出的精确二元组下载；不按 Material 当前指针重新取。400 为 DTO/日期/内容形式错，404 为客户或协议不在当前范围，409 为版本冲突、key 同值异体或当前材料不可选择；权限拒绝沿用既有项目响应约定，不能让存在性泄漏。所有写成功只返回本次版的不可变快照，不由最新指针重新组装。创建/修订的 idempotency fingerprint 只取规范化原请求体和路由/action，不纳入“修订省略附件时的当前解析值”。未知结果保留原 body/key 重试；先以当前权限、客户未删和动作范围重查，再查旧 receipt/fingerprint，匹配则返回原结果；仅新写分支检查 expected version 与附件当前资格。撤权后旧成功也不能重放；后来换版或材料状态变化不得拒绝已授权的历史成功重放。

## 权限与 Material 精确入口矩阵

动作是 `customer.agreement.read/edit` 与 `customer.invoice.read/edit`，均使用已有 SELF/TEAM/DEPARTMENT 资源范围；新动作不自动赋予现有角色/用户。协议读取必须同时有当前 `customer.read` 与 `customer.agreement.read` 的本客户范围；协议写、上传及精确材料选择再加 `customer.agreement.edit`。开票读为当前 `customer.read ∩ customer.invoice.read`，写再加 `customer.invoice.edit`。前端 capabilities 只控制显示；每个服务端入口、receipt 重放和撤权后下一次请求都重查。外部 CLIENT/NOTARY/LAWYER 不因此获得内部敏感信息。保留旧 CUSTOMER_IDENTITY/RIGHT_EVIDENCE 权限语义。

| 固定基线入口                                                           | owner/category 来源与暴露物                                                                 | CUSTOMER_AGREEMENT 必须执行                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /materials/upload-drafts`                                        | DTO 提交 CUSTOMER + category/purpose；响应含 draft id、category、文件名                     | 限定 CUSTOMER_AGREEMENT purpose/类型/大小；创建前及事务内当前权限 `customer.read ∩ agreement.read ∩ agreement.edit`，且客户未删。不得经 `customer.admit` 或 `edit-routine`。                                                   |
| `PUT /materials/upload-drafts/:id/content`                             | 持久 draft 的 owner/category/purpose，写 blob 并返回 Material/ContentVersion 元数据         | 在读 draft 后及最终数据库写入前重新校验三项权限、actor/tenant/客户未删；两次校验与本次 CU005/CU006 锁序兼容。既有 draft 不给撤权者补传。失败清理 blob。                                                                        |
| `GET /materials?ownerType=CUSTOMER&ownerId=…`                          | 查询参数仅有 owner；当前代码聚合所有 category，返回文件名/mime/size/hash/version 与 `total` | 先校验 customer.read；服务端查询/计数对无 agreement.read 的当前 actor 排除 CUSTOMER_AGREEMENT，`items` 和 `total` 使用同一过滤谓词。禁止靠 UI 隐藏或取出后仅滤 items。无 agreement.read 时不可从 category、排序或 count 泄漏。 |
| `GET /materials/:materialId/versions/:versionId/content`               | Material 行提供 owner/category，ContentVersion 为精确版本；响应包含文件名 header 与字节     | 在流/文件名之前按该行 category 查 customer.read+agreement.read；历史版本同样重查当前权限。禁止先按 ID 返回元数据再授权。                                                                                                       |
| `DELETE /materials/:materialId`、`POST /materials/:materialId/restore` | Material 行提供 owner/category；改变状态，返回元数据                                        | 三项权限、客户未删、expected Material version；引用中的历史版不能因软删丢字节。保留已有被引用材料限制；restore 不可绕过客户删除门槛。                                                                                          |
| 内部 `assertAvailableVersions` / `freezeReferences`                    | 命令提交的 contentVersionIds；前者当前只按 category 做 read 授权                            | 协议命令自身先要求三项权限；再逐个验证 CUSTOMER owner/同客户/同部门/CUSTOMER_AGREEMENT/purpose/AVAILABLE/精确 ID；事务内冻结版清单和引用。不可把 helper 的 read 校验误作 edit 授权。                                           |
| 协议 list/get、旧版详情及 receipt replay                               | Agreement/Version/Receipt 中的历史文件 ID、文件名投影                                       | 两项读权限；重放写结果还须 agreement.edit。历史详情不得间接绕过 Material 下载权限。                                                                                                                                            |

固定基线 `material.controller.ts` 没有单独 `GET /materials/:id` 元数据路由；元数据目前经 owner list、草稿/finalize/删除/恢复响应和协议新详情曝光。新增路由若出现，纳入同一 category 权限矩阵。`listOwnerMaterials` 现在只传 owner read，`openVersion` 虽传 category 但 CUSTOMER read 分支未区分，写分支对非 RIGHT_EVIDENCE 一律走 `customer.admit`；这三点必须改。Material 上传本身没有通用幂等 receipt；未知 finalize 结果不能盲目重新上传，应在当前权限下用已知 draft/材料状态或列表核实。协议/开票命令 receipt 才按原请求恢复。CU006 及既有删除/合作/资产等未知命令形成同客户跨业务维护锁；协议或开票未知结果须冻结同客户其他写及取消路径，保留原 body/key。已知写成功但随后 GET 失败仅重试读取，绝不重提交或生成新键。

固定CU006验收基线复核补充：`material.service.ts:createUploadDraft` 的 CUSTOMER 事务分支约 329–345 行和 `finalizeUpload` 的 CUSTOMER 最终事务分支约 508–528 行都先锁 Customer 再 `authorizeOwner`。CU007 **仅对新 `CUSTOMER_AGREEMENT` 类别**在这两个入口局部实现部门 advisory→actor/Grant `FOR SHARE NOWAIT`→初查权限→Customer 父锁→复查；旧类别共享流程不在本片重写。`assertAvailableVersions` 约 702–840 行只按 owner/category/AVAILABLE 取内容，返回 material.purpose 却没有比对协议 purpose；协议命令必须逐项验证 `purpose === 'CUSTOMER_AGREEMENT'`，新 SQL 引用守卫也要拒绝错误 purpose 的直接写入，不能只靠上传 DTO 的 category/purpose matrix。无文件版本跳过拒绝空 facts 的 `freezeReferences`。以上是本片必须实现和验证的接入边界，当前尚未实施。

能力位聚焦测试：仅 `customer.read` 全部新位 false；仅 CU007 edit 而无对应 read 时 edit=false；read+edit 同范围 true；SELF/TEAM/DEPARTMENT 转派及撤权后响应刷新；`CustomerDetail` 新增字段全为 Boolean，严格 decoder 拒绝缺失/错误类型/额外敏感键；专用 GET 的 `canEdit` 与当次范围一致且 POST 重新授权；普通 `CustomerDetail.history` 不泄漏协议/开票审计动作，专用版本历史仍显示真实 actor/时间。

## 结构与迁移不可变性

新增表及 enum；同客户唯一稳定实体、版序号唯一、复合 `(id,customerId,departmentId)` 外键、currentVersion 指向自身版且 customer/department 相同、receipt `(departmentId,actorUserId,action,idempotencyKey)` 唯一。版本字段及冻结内容 ID/MaterialReference 禁 UPDATE/DELETE；SQL 验证引用 Material、ContentVersion 的 CUSTOMER owner/同客户部门/category/purpose/AVAILABLE，不依赖 DTO。Customer 删除资格函数须计入协议/开票实体、版本、receipt 和已有材料/草稿关系；新增关系的父锁与删除相序。前向迁移只加新表/约束，不改旧迁移、不伪造旧协议/开票、不回填 Case/Lead。应用命令不得通过自设GUC或replica模式跳过守卫；数据库管理员DDL特权不在应用守卫防护范围；若迁移需要延后 FK/check，应限在明确受控迁移事务并验证恢复。

命令锁序按固定CU006验收基线复核：复用 CU005 已批准的部门 advisory、相关账号/成员/角色/Grant `FOR SHARE NOWAIT` 稳定顺序，核当前 scope 后再锁 Customer，锁后复核 scope/未删，再处理 receipt；新写才 CAS 与材料选择。不能采用旧 Temp 提案的 Customer 先锁再查 actor，也不能扩大共享权限设施。NOWAIT/竞争仅有界重试，失败返回 BUSY 且原请求/键保持；不得声称尚未证实的线性一致性。

合作状态不增加协议/开票资料维护门槛：SD-12 与正式 CU005 已将 PAUSED/TERMINATED 的新增业务阻断具体落在新 Lead 创建；有当前权限且未删除的客户仍可维护真实协议/开票历史，旧 Lead 禁入规则保持。分别验证 PAUSED/TERMINATED 状态下有权正常维护、无权拒绝，且 `CUSTOMER_AGREEMENT` Material 上传/下载不偷加 COOPERATING 条件。

迁移布局技术边界：已有20261008030000_add_customer_right_asset_enums与20261008031000_add_customer_right_assets提供枚举扩展先提交、后续结构单事务的模式。CU007新增既有permission_action/material_category标签（purpose仍为既有VarChar字符串）时，采用同样最少两段前向迁移，避免在新增枚举值尚未提交的事务内使用它。后续结构/守卫事务失败须完整回滚，枚举段可安全保留、无新Grant、无业务数据且可重试；专项分别验证102→枚举中间态→完整态的真实账本，不将已提交枚举声称为整体回滚。布局以本固定CU006验收tree及本片真实迁移专项确认，不改已执行SQL。

## 公共helper与未知请求存储

仅提取现有纯actor事实锁至`access-control/customer-actor-facts-lock.ts`并由原contacts路径兼容重导出，不改变共享scope/组织锁算法。新协议Material写入四入口均按actor/Grant→Customer/Material→当前授权复查，禁止Material→actor反序；详情/历史/下载只读每次重查当前权限。

协议与开票未知请求必须显式选择持久化userId/departmentId/customerId/action及原body/key，不能spread运行时Actor或将authorizationRevision加入持久身份；revision仅用于活跃请求的迟到响应隔离。存储失败不发命令，403/404/BUSY不证明原提交未发生，保留原请求；读取失权先清可见敏感投影。普通数据库调用不设置自定义GUC或replica来跳过守卫；管理员DDL权限不属于应用层守卫可防护的范围，专项不得作更强声明。
