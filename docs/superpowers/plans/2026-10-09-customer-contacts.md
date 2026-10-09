# CORE-CU-006 多联系人实施计划

> **For agentic workers:** 使用subagent-driven-development执行Task A/B/C；模型、审查和Level3门禁按项目协作路由与三级规则。用户已授权按切片开发，CU005已本地验收；仅依赖真实未决事项的部分暂停，不重复请求计划批准。

**Goal:** 在 CU004/005 真实前态上交付可维护多联系人、最多一位主要、可无主要、结束留史，并无损保留旧建档/PATCH/准入及历史回执。

**Architecture:** Contact 当前行和不可变版本是联系人关系权威；Customer 旧三字段只投影一位明确锚定的活动联系人，独立冻结准入时资料。客户父锁/CAS 串行新旧命令，SQL 约束和延后校验拦截绕过 DTO 的写入。迁移只用现有 Prisma/PostgreSQL 与测试框架，不加依赖。

**Tech Stack:** NestJS、Prisma Migrate、PostgreSQL、Vue/Element Plus、Jest/Vitest/Playwright。

## Global Constraints

- 以 docs/spec/v0.1/modules/customers.md REQ-CU-001/002/005/006/007、DECISIONS.md SD-46/48 和 docs/superpowers/specs/2026-10-09-customer-contacts-contract.md 为契约源；本实施契约细化已批准规则，不扩大本片业务范围。
- 分类 Level 3：旧字段及准入历史含义重新解释，并增加历史迁移和 SQL 边界。先 Review/关闭 finding，再固定候选完整 pnpm verify 与风险专项。CU005 已通过门禁，其结果不能替代 CU006 证据。
- 不改旧 customer_admission_receipts.request_fingerprint/result_snapshot 原值；旧无 ID 准入仍走原 canonicalizeForFingerprint/fingerprint。不得生成姓名/电话/日期或按同名同号合并。
- 不显示“兼容联系人”、compatibility_contact_id、legacy_contact_pending。正式页面只有一套联系人编辑入口；准入选择明确的活动联系人，不复制录入表单。
- 不自动建 UserAccount/CustomerAccountBinding，不扩大 CLIENT/LAWYER 权限；仅负责运营 responsibleUserId，不增加客户经理。
- 不碰独立人工环境 5181/3201/15434、开发/生产数据，不推送/合并/发布。测试仅用 backend/.env.test 独立库，按项目运行时要求先加载 Use-ProjectRuntime.ps1、核对 Node/pnpm，再执行 pnpm context:check:strict。

---

## 开工交接与文件边界

CU005已在4922f9f完成显式Level2正式门禁，非执行性收口3cc60d1/tree6a8e312仅状态/证据/快照。root已按该实际代码前态复核并落盘本文及联系人契约，REQ-CU-006与技术基线已同步。开工仍核对HEAD/tree和已有差异，只认当前源码/Spec及真实验证；后续只同步真实变化，不预写通过。

| 文件                                                                                                                                                                                   | 职责                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| backend/prisma/schema.prisma、backend/prisma/migrations/<新时间戳>_customer_contacts/migration.sql                                                                                     | 新表、列、组合 FK、部分唯一、CHECK、延后投影/快照守卫、CU004 删除资格与父锁扩展、原子回填                                                         |
| backend/src/modules/customers/customer-contact.service.ts、customer-contact.controller.ts、customer-contact.dto.ts、customer-contact-response.dto.ts、customer-contact-locks.ts        | 当前/历史查询、联系人命令、DTO/OpenAPI、公开响应与 CU005 同序的局部 actor/组织锁；权限范围只调用现有 AccessControl，不复制 scope 计算             |
| backend/src/modules/customers/customer-contact.service.spec.ts、customer-contact.controller.spec.ts                                                                                    | 权限、CAS、重放、同名不同人、审计/回滚等聚焦单测                                                                                                  |
| backend/src/modules/customers/customer.service.ts、customer-admission.service.ts、customer-admission.dto.ts、customer-lifecycle.service.ts、customer.controller.ts、customer.module.ts | 旧字段桥接、准入显式选择、冻结快照、恢复迁入、模块接线；不得再有另一套联系人权威                                                                  |
| backend/src/modules/customers/customer.service.spec.ts、customer-admission.service.spec.ts、customer-lifecycle.service.spec.ts                                                         | 旧 create/PATCH/flat admission 兼容、旧指纹/JSON、deleted 恢复                                                                                    |
| tests/support/customer-contact-migration.mjs、tests/e2e/customer-contacts.spec.ts                                                                                                      | 临时 schema 空链/旧链/回滚与真实 PG 并发/SQL 负例；真实密码 cookie/CSRF 旧新流程                                                                  |
| tests/support/customer-database.mjs、customer-database.d.mts、core-lead-database.mjs、core-lead-database.d.mts                                                                         | 现有客户/认证/主链测试 seed 与 reset 的直接 Customer 写入/清理拥有者；CU006 的合法最小 seed、Contact/Version/Receipt 清理和声明同步在 Task A 处理 |
| tests/support/case-judgment-database.mjs、case-hearing-database.mjs、customer-right-asset-database.mjs 及实际受影响的直接案件 DB helper                                                | 只核对其直接 SQL Customer seed、清理与受保护测试事务；有触发的新约束才定点调整，不泛修案件业务测试                                                |
| frontend/src/api/customers.ts、frontend/src/modules/customers/CustomerContactsPanel.vue、CustomerContactsPanel.spec.ts                                                                 | 严格解码、冻结未知请求、联系人面板及聚焦测试                                                                                                      |
| frontend/src/modules/customers/CustomerDetailPage.vue、CustomerAdmissionPanel.vue、CustomerEditPage.vue、CustomerNewPage.vue 及直接 .spec.ts                                           | 一个编辑入口、准入选人、旧字段仅 API 桥接、刷新/重登和迟到响应处理                                                                                |

如现有实现提供更合适的拆文件边界，改计划并由 root 核对后再实施；不改共享权限/审计/事务基础设施或引入依赖。

## Task A：后端、迁移与真实 PostgreSQL（高风险，gpt-6-sol）

**产出接口：** ContactSummary={id,customerId,name,phone,email,duty,isPrimary,endedAt,endReason,version,origin,createdAt,updatedAt}；ContactVersion={id,contactId,version,action,before,after,actor,occurredAt}，before/after 的快照精确含 name/phone/email/duty/isPrimary/endedAt/endReason，CREATED.before=null，actor 为 HUMAN(userId) 或 LEGACY_MIGRATION(userId:null)；CustomerContactCommandResult={contact,customerVersion,primaryContactId}。结束原因由已结束 ContactSummary/Version 读取；CustomerDetail 只增 admissionContactSnapshot 和 primaryContactId，原 CustomerSummary 不强加历史字段。联系人 list/versions 均返回 {items,total,page,pageSize}。精确类型、请求、状态码和错误码见[联系人实施契约](../specs/2026-10-09-customer-contacts-contract.md)，Task B 不自行推断字段。Task C 用固定候选真实主链验收。

- [ ] 先读上表源文件、对应直接测试及 docs/conventions.md 的接口/安全/迁移章节；核对 CU005 gate 后 tree。列一份迁移前数据断言：DRAFT/ADMITTED/deleted、旧三字段完整性、receipt 多候选/无效数及旧指纹样本；不得打印个人资料。确认实际最后迁移序号后取新时间戳，不改旧迁移。
- [ ] 在写生产 schema 前先预检合法 Customer 合成 seed/范围清理拥有者：tests/support/customer-database.mjs 的 resetLocalAuthE2eData、resetCustomerE2eData、resetPersonnelAccessE2eData 及直接 Prisma/SQL 客户构造；tests/support/core-lead-database.mjs 的 admittedCustomer→resetCoreLeadE2eData/createMany、clearDatabase、临时 schema 升级 seed；核对各自 .d.mts 声明。检查 tests/support/case-judgment-database.mjs 的直接客户 INSERT/DELETE，特别是其 SET LOCAL session_replication_role=replica 后的 Customer INSERT：将合法最小 DRAFT 父客户创建移到正常约束下并补齐必要成员事实，replica 仅限既有特定合成负例的其他表；另核对 case-hearing-database.mjs 与 customer-right-asset-database.mjs 的直接客户引用/清理。其余 auth/案件 DB helper 仅当 rg 显示直接 Customer 写入或共享 reset 时纳入。区分预 CU006 schema 的迁移探针与新 schema 的运行时 seed，以及故意构造的 SQL 负例，不把无关测试批量改写。
- [ ] 先给 core-lead-database.mjs 的合法 ADMITTED createMany seed 增新 snapshot_name/phone/email/source/frozen_at，并在受保护同一事务内为每个旧三字段完整的合成客户创建一个与客户/部门一致、primary=false 的 Contact 后设置兼容指针；新 DRAFT 空联系人 seed 保持全空。其他在新 schema 下直接写完整旧三字段的合法 seed 同样走“Customer→Contact→指针”事务桥接；迁移前态探针仍由 CU006 迁移本身回填。Customer 的 ADMITTED CHECK 在 INSERT 即要求完整冻结快照，不依赖延后触发器补救。不要把旧业务回执补成虚构准入时事实，也不要用 session_replication_role=replica 绕过新客户约束。
- [ ] 设计 Customer↔Contact 外键与 reset 配套清理顺序：新 customer_contact_command_receipts → customer_contact_versions → Customer 内部指针/Contact → Customer；实际循环 FK 采用仅在受保护测试事务内可完成的延后 FK，必要时在同一事务里暂禁/恢复新不可变/投影 USER triggers，沿用当前 customer-database.mjs 与 core-lead-database.mjs 对固定表清单的临时禁用模式。事务提交后触发器必须恢复，错误回滚也不留禁用状态；仍保持部门/数据库名/NODE_ENV 等既有防线，不扩展到人工/开发库。core-lead clearDatabase 现分多事务，Contact 与 Customer 删除必须按新 FK 边界收拢到同一受保护事务；LocalAuth/Personnel reset 对所属客户同理。生产迁移/服务不得设置 replica、放宽 guard 或提供应用可调用的绕过开关。声明文件只同步公开 helper 形状，不公开重置内部函数。
- [ ] 在进入大门禁前做聚焦 reset/主链回归：先用独立测试库分别调用现有 auth、customer、core-lead 的 reset→seed→reset，核对 Contact/Version/Receipt/Customer 范围零残留且其他部门数据不动；再运行 tests/e2e/auth.spec.ts、customers.spec.ts 的旧建档/准入路径、core-leads.spec.ts 与 cases.spec.ts 的现有已准入客户主链、customer-lifecycle.spec.ts 的删除/恢复，以及 case-hearing.spec.ts/case-judgment.spec.ts 中直接使用 core-lead seed 的聚焦用例。匹配 0 项视为失败，记录实际候选和结果；发现属于其他模块的 fixture 失败才追到其 owner，不等完整 pnpm verify 暴露大量 FK/CHECK 错误。
- [ ] 先写聚焦失败测试：旧 create 三字段→一行同 ID 投影、旧 PATCH 单字段连续修改→同一 Contact 增版本、旧 PATCH 非联系人字段不变、结束后旧 PATCH 不复活、同名同电话两 ID 并存；旧准入有指针复用、无联系人只建一行、无指针有其他活动行要求选择、新显式 ID 不多建；旧 receipt replay 在当前授权下返回旧 resultSnapshot/旧 fingerprint，不因新字段失败。分别跑对应 Jest 文件确认新行为尚未存在。
- [ ] 在 schema/migration 建 Contact/Version/Receipt 和 Customer 新列。为 Contact 设 (id,customer_id,department_id) 唯一、(customer_id,department_id) 组合 FK、活动主要 partial unique、结束行非主要 CHECK、姓名/联系方式 CHECK；Version/Receipt 设唯一和不可变触发器。Customer 指针设组合 FK，旧三字段 CHECK 保留，ADMITTED CHECK 改看冻结快照。延后约束触发器校验事务最终投影和快照；快照 UPDATE 守卫拒绝已准入后改变。触发器不能依赖普通连接可 SET 的标志。先在测试库临时 schema 跑空链探针及合法旧数据升级，不在 public 试错。
- [ ] 在同一迁移事务内按 customer id 回填：只接受 result_snapshot.profileStatus === 'admitted'、JSON id/departmentId/version 与 receipt 的关联三列一致、姓名非空且电话/邮箱至少一项的有效候选；按 receipt.created_at,id 取最早合法原始值→RECEIPT，frozen_at 取该 receipt.created_at。后续不同版本/时间值不同是正常历史；同客户同 result_customer_version 候选相互矛盾或可信来源无法确定时整体失败，只报 ID/数量，不打印 PII。没有可信 receipt 的 ADMITTED 用旧三字段→FALLBACK_CURRENT，frozen_at 取迁移时间；无法满足最低准入资料也整体失败。未删除且旧三字段完整才建 LEGACY_BACKFILL，一客户一行、primary=false、origin_key 固定；迁入 Contact.created_at、初始 Version.occurred_at 均取迁移时间，created_by_user_id/Version.actor_user_id 为 null 且 Version.source=LEGACY_MIGRATION，不用 Customer.responsibleUserId 冒充创建者，不把旧 admittedAt 当交往开始，不造受限 SYSTEM AuditEvent。deleted 跳过并保留旧三字段/pending。恢复旧标量是当前用户在恢复事务内的真实创建，Contact/Version 记当前 actor 和现在时间；旧建档/准入真实创建也记真实 actor。核对逐字旧值、未改原 receipt JSON/指纹、已准入当前行与历史快照可能不同、重复探针不多行、错误 DDL/异常数据全回滚。相关 helper 按 tests/support/customer-lifecycle-migration.mjs 的临时 schema 安全模式实现，勿连人工/开发库。
- [ ] 扩展 customer-lifecycle.service.ts 删除 associations SQL 和当前迁移定义的 customer_draft_deletion_guard：任何 Contact（含 ended）阻止草稿删除；在 customer_contacts 的 INSERT/UPDATE 挂现有 customer_draft_association_guard，先锁父客户再查 deleted。恢复物化联系人会写 actor 外键/审计，事务入场先走下述组织/actor 锁，随后才 Customer FOR UPDATE，不能形成 CU005 已修复的锁反序。状态翻转后、生成 audit/receipt 前，仅 pending 且无任何关系的旧完整标量物化固定 origin_key 行并消 pending；新行不得触发第二次 Customer.version 自增。若恢复前已有 ended，保持无活动行并清理过渡标记，不复活。延后校验使恢复事务完成时投影一致。测试删除/新增联系人竞争及 SQL 绕过。
- [ ] 实现 contact service/controller/dto 和局部 customer-contact-locks.ts：每个新命令 Idempotency-Key 必填。调用现有 OrganizationService.lockDepartment，再按 CU005 customer-cooperation.service.ts 的稳定 ID 序，对当前 actor 的 user_accounts、department_memberships、role_assignments、role_templates、role_grants、teams 取 FOR SHARE NOWAIT；用 AccessControl 初核当前 read/edit 范围，再锁同一 Customer FOR UPDATE，锁后重查当前范围/deletedAt。此后先查原 key 的 receipt/指纹；命中旧结果即返回，不检查旧联系人是否已结束、旧版本或当前同态。仅新写分支检查 expectedCustomerVersion/expectedContactVersion、精确 ID/部门/活动、同态，再做客户 CAS、Contact.version、Version、脱敏 AuditEvent、Receipt 一事务。设主要时旧主 PRIMARY_UNSET 和新主 PRIMARY_SET 各记历史；结束主要时清标记并记 ENDED。新建不暗改旧投影指针。局部锁冲突/死锁/序列化冲突有界重试，耗尽 409 CUSTOMER_CONTACT_BUSY，保留原正文/key；不复制权限 scope 算法，也不宣称未实测的线性化。版本冲突/越权/同键异正文映射稳定错误码，列表/历史服务器分页默认20上限100，按时间和 ID 稳定排序。DTO 拒绝未知字段，OpenAPI 同步：create 用 201/@ApiCreatedResponse，primary/end 的 POST 显式 @HttpCode(200)+@ApiOkResponse。单测覆盖结束后旧 key replay、任一步失败回滚及撤权后 key replay 不能泄露。
- [ ] 调整 CustomerService.createDraft/updateDraft：旧 POST 完整三字段原事务建一行并锚定；旧 PATCH 会写联系人时先走与新命令一致的组织/actor 锁和初核授权，再锁同一父 Customer、重查范围/deletedAt，然后字段合并并维持原 DTO/响应，联系人和客户字段共一次客户版本 CAS，修改同一联系人/历史/审计；无指针且有历史关系拒绝猜人，非联系人 PATCH 可独立保存。旧 PATCH 无 key，未知结果按原 expectedVersion GET 对账，不能自动更换版本重提；不因新增父锁再次引入 Customer→AuditEvent actor 外键的反序。CustomerService.get/toSummary 保持旧 summary 字段；详情增加历史快照/主要 ID，而产品不收到技术指针文案。新旧命令并发按 Customer.version 单胜。
- [ ] 调整 AdmissionService：旧 flat 输入/指纹序列化不变；若带 admissionContactId，DTO 允许省略 flat 三字段并用版本化指纹，指纹仅由固定顺序的规范化原请求生成（版本标记、customerId、显式 ID/flat、其他准入字段），绝不从当前 Contact 值回算。入事务先取同序组织/actor 锁与当前 admit 范围初核，锁父客户后重查当前授权/deletedAt，再查原 admission receipt/指纹；命中旧回放时不解析现时选中行、不要求其仍活动。仅新写时校验 expectedVersion/活动 ID 并从选中行取本次值；若同时带 flat，必须一致。旧 flat 有活动锚就更新同一行，无任何活动行才建新行；无锚且有活动行返回选择冲突。选人/建人、旧投影、冻结快照、客户准入、原 receipt 同一 Serializable 事务；现有材料/身份门槛维持。单测加入新 ID 准入成功后联系人更新/结束仍同 key 同 hash 回放、同 key 改显式字段冲突；另覆盖旧 pre-CU005 和 CU005 receipt 形状、错误重试和跨部门 ID。
- [ ] 真 PG 专项跑在独立测试库：第二主要、跨客户/部门指针、结束行主要、直接写漂移投影、改冻结快照、更新/删除 Version/Receipt、deleted 父项写 Contact 均被 SQL 拒绝；并发设主/结束/旧 PATCH/删除与建人只一方成功且无半条历史。核对无 UserAccount/Binding 新行、审计脱敏。Task A 自审并提交单独报告；随后非实现 gpt-6-sol Reviewer 审迁移旧数据、回执指纹、父锁与普通 DML 守卫，所有 finding 修复并由原 Reviewer 关闭后交 Task B/C。

## Task B：正式页面和严格解码（普通，gpt-6-luna）

**依赖：** 使用 Task A 的公开接口/错误码；不得直接用旧平铺字段推断主要 ID 或从姓名/电话推断人。Task B 只改前端上表文件，必要契约变化先报 root。

- [ ] 先写 Vitest：详情活动/已结束分页可见、主要取消后显示“未指定”、同名同电话独立；结束唯一联系人后详情旧三字段空但准入历史只读；准入只提交明确选择的 admissionContactId；编辑联系人只走面板一次命令；路由切换清草稿、迟到响应不覆盖新客户、409 保留输入并刷新、未知结果原请求/key 冻结。验证新测试失败。
- [ ] customers.ts 定义 Contact/版本/分页/命令响应严格 decoder；加入 GET/POST/PATCH/primary/end 函数，写请求使用现有 requestJson 和 Idempotency-Key。扩展 CustomerDetail 的 primaryContactId、admissionContactSnapshot；旧 CustomerSummary 三字段仍必有且可 null，历史 receipt 成功后的当前 GET 不与旧快照混写。
- [ ] 新建 CustomerContactsPanel：分页活动及结束列表、姓名/电话/邮箱/负责事项编辑、显式设/取消主要、结束（原因可省）、历史只读。仅一位主要/可无主要文案真实呈现，不显示内部 pointer/pending/origin 枚举词；迁入日期显示“系统记录时间”，不称实际交往起始日。写入失败留原正文/key，确认成功后刷新面板和详情版本；成功后 GET 失败冻结写操作仅允许只读刷新。
- [ ] 按实施契约的页面交叉维护段接线联系人独立pending；联系人未知冻结其他业务入口、其他维护未知冻结新联系人写，原命令恢复入口始终保留。补详情页聚焦反例覆盖联系人未知、合作未知、当前GET失败和成功只读恢复；事件带来源客户ID并丢弃迟到结果，不因同面板pending卸载其恢复入口。操作者/系统迁入来源用自然文案，不在产品直接展示内部枚举或UUID。
- [ ] Detail 在基本信息嵌入联系人面板并以诚实来源文案显示只读准入快照。EditPage/NewPage 保留旧 API 兼容但正式 UI 联系人编辑统一导航到面板；新客户建档可继续最小联系人三字段并在建档成功后显示为一行真实关系。AdmissionPanel 移除重复的联系人三输入，改为选择活动 Contact；没有活动行时引导先在面板新建，保存回来刷新版本后再准入。切换客户取消迟到请求，草稿/选择不串客户。暂停/终止不禁联系人维护。
- [ ] 跑对应 Vitest、前端 typecheck/format 受影响检查并自审，报告实际结果、未决 UI 问题及 tree；不额外设逐 Task Reviewer。

## Task C：真实主链与最终集成（gpt-6-sol）

- [ ] 在 Task A/B 合并后的候选上补/跑 tests/e2e/customer-contacts.spec.ts：真实密码登录、cookie/CSRF，从旧 POST 建档/旧 PATCH/旧 flat 准入到新多联系人、明确选择、设主/取消、结束、刷新与重登；另从新建客户联系人到准入。测试历史回执不改、旧 key 回放/撤权后拒绝、其他客户和部门猜 ID 不泄露、CLIENT/LAWYER 未获管理权、负责人仅 responsibleUserId 且 CU005 合作状态不影响联系人维护。所有 E2E 只指向测试库及 5174/3101。
- [ ] 运行 Task A 迁移专项：确认空链、上一支持 schema 的合成旧数据升级、已删除旧草稿与恢复、合法 SQL 父锁负例、失败原子性/重试；单独记录数据构造和实际前态迁移数。不能用 FK 失败冒充父锁通过。原 receipt 指纹/JSON 做前后比较；不以测试样例虚称生产数据已迁。
- [ ] root 安排一次独立最终 gpt-6-sol Review 覆盖最终组合 tree，核对正式 Spec/Decision、CU004/005 不回归、错误映射、历史读授权及全部发现；由 Reviewer 明确 ACCEPTED/REJECTED 与 C/I/M 未关闭数，修复后由原 Reviewer 确认关闭。同步真正受影响的正式 Spec/技术设计/OpenAPI及必要状态。固定干净候选后按项目运行时点加载 Use-ProjectRuntime.ps1，核对 node/.node-version、pnpm/environment-lock；运行 pnpm context:check:strict、完整 pnpm verify、真实 PG/迁移专项与相关密码 cookie/CSRF 浏览器测试。候选和输入未变的可信结果可复用，失败修复需按影响重验，不把 CU005 证据冒充 CU006。
- [ ] 只写实际验证到 docs/spec/v0.1/VALIDATION.md，更新 roadmap/project-status 的真实 Current/Next 与完成态，核对收口 diff/快照及适用文档检查。推送、合并、人工环境升级或生产迁移均不属于本计划的自动执行范围。

## 自审检查

- [ ] 将 REQ-CU-006、REQ-CU-005 恢复/删除、REQ-CU-001 准入门槛和 SD-46/48 逐条映射到 A/B/C；确认无遗漏或越出已批准规则。
- [ ] 检查迁移列名、HTTP 字段、错误码、前端解码和测试期望逐项一致；检查旧 flat 准入指纹及 JSON 路径未变化；检查计划没有写成已执行结果。
- [ ] 实施只按本计划获授权Task范围执行；同一工作区仅一名tracked writer，人工环境保持旧构建和数据，最终结果不超出实际证据。
