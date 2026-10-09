# CORE-CU-007 协议与开票资料实施计划

固定代码前态：`75acd3c9a7d73257bdbe5ab40d4614d73bef6ec6`/tree`8807b8d56c2e3c3855b71dcfbcb46950c468a6e3`。CU006实际业务候选`db33bf6c717e98829ba2728a6a9455cf1d886eaf`完成Level3（verify74/802/1134、全库259/259、102迁移），随后75acd3仅五份完成态文档/快照；累计diff及文档门禁已核。CU007尚未实现或验收。本计划执行用户批准的客户总计划，正式规则见[实施契约](../specs/2026-10-09-customer-agreements-invoice-contract.md)、REQ-CU-004及SD-12/20/45/47/48。每客户唯一协议，协议版本真实期限，独立开票资料；不绑定Lead/Case、不自动赋新权限、不开财务支付或比例公式。风险Level3：敏感类别进入共享Material入口、独立动作/部门范围、不可变版本和新迁移。唯一tracked writer及Node/DB owner串行交接。

## Task A — 高风险后端/Schema/真实 PG（Sol，独立 Sol Reviewer）

1. 先在 固定CU006验收tree 复核 `AGENTS.md`、`docs/project-status.md`、CU004/005/006 正式 Spec/Decision 与 CU006 实际 `Customer`、联系人/合作状态、`CustomerLifecycleService`、admission/maintenance 命令、CU005 同序锁。对比正式契约及 Material 全入口；若实际行为冲突，先将具体差异交 Root，不沿用旧 Temp 的 Customer→actor 锁顺序。
2. 最小 schema/前向 migration：`backend/prisma/schema.prisma`与最少前向迁移；沿用现有权利资产枚举/结构两段迁移模式，先提交新增权限及Material类别枚举（purpose仍为既有字符串并由矩阵约束），再在后续单事务迁移安装表、指针、守卫与删除资格；两个稳定实体/不可变版本/命令 receipt、复合 owner/department FK、每客户唯一、版序号、current pointer、SQL 不可变/引用验证和删除父锁。改 CU004 最新删除资格函数及 `backend/src/modules/customers/customer-lifecycle.service.ts` 的关联计数，仅纳入新增依赖；不改旧 migration。入库迁移前后在独立 test DB 临时 schema 演练空库与合法SQL合成旧客户/材料/receipt，非法直接 SQL 负例、失败回滚/重试、旧客户无协议/发票保持空态。
3. `backend/src/access-control/permission-catalog.ts`、`access-control.service.ts`、`prisma-access-control.store.ts`、PermissionAction enum/迁移及相应直接 tests：新增四动作及 SELF/TEAM/DEPARTMENT 映射，不增默认 grant、不改共享 scope 算法。核后台动作目录与 `frontend/src/api/organization.ts` 严格 action decoder/相关测试；历史角色/用户升级后四项均未被自动赋予。`CustomerService.get` 在已有 `customer.read` 范围内给 `CustomerDetail.capabilities` 增 `agreement:{read,edit}`、`invoice:{read,edit}` Boolean，edit 包含对应 read；无实体 ID/版本/文件名/计数/敏感事实，不增能力服务或元数据发现端点。专用 GET 的 `canEdit` 同源但业务请求每次重查。
4. `backend/src/modules/materials/material.dto.ts`、`material.service.ts`、必要 controller/直接 tests：加入 CUSTOMER_AGREEMENT category+purpose、复用既有私有存储、签名允许类型和限额；覆盖上传草稿、finalize、owner list `items/total`、精确下载、软删/恢复、内部 availability/freeze。将新的敏感权限同时施加在元数据和字节路由，保留旧类别语义。固定CU006验收基线 的 `createUploadDraft` CUSTOMER 事务约 329–345 行与 `finalizeUpload` CUSTOMER 最终事务约 508–528 行**两处**均先锁 Customer 后授权；仅新协议类别局部改为 actor/Grant 同序锁与初查→Customer 父锁→复查，旧类别共享流程不重写。`assertAvailableVersions` 约 702–840 行未核 `material.purpose`，协议命令逐项核协议 purpose，新增 SQL 引用守卫阻断错误 purpose 的直接写入；空附件版跳过拒绝空 facts 的 `freezeReferences`。Reviewer 核两入口互斥图及 SQL 负例。
5. 新 `backend/src/modules/customers/` agreement/invoice DTO/controller/service/response 和 `customer.module.ts` 注册；按契约固定 201/200 装饰器、当前 read/edit/deleted 范围→receipt/fingerprint→新写 CAS/附件选择。协议创建省略文件为空、修订省略继承、显式 [] 清空；开票省略保持/显式 null 清空。每版冻结历史及最小 audit，结果/receipt 同事务写；未知结果原键可恢复。审计优先以独立资源类型+对应实体 ID 使用既有 AuditEvent，固定基线中确认真实字段；通用 `CustomerDetail.history` 不能泄漏新敏感动作，专用授权版本历史显示 actor/时间；不支持独立资源类型时报告局部过滤选项，不改共享审计机制。不得把敏感事实加到旧 CustomerSummary/Detail。由真实 PG 聚焦测 current 权限撤销后旧 key/旧文件拒绝、同键同体、异体、不同 key CAS、失败原子、SQL 直接非法写、跨部门/SELF/TEAM、外部身份、删除与新增并发。
6. 修正直接 SQL/Prisma fixture 所有者：至少 `tests/support/customer-database.mjs`、`customer-database.d.mts`、`core-lead-database.mjs`、`core-lead-database.d.mts`，按 CU006 实际变更核必要 auth/案件 DB helper。枚举所有合法 Customer 合成 seed、range cleanup；新增客户样例满足 CU006 联系人/准入快照与 CU007 可空协议/发票约束，清理按 receipt→version/reference→stable entity→Customer 的真实 FK 次序。若延后 FK/循环指针需复用现有**受保护测试事务**中的 trigger 临时禁用/恢复模式，只限 fixture；不放宽生产 guard，不用 replica 绕过，不打印凭据/PII。仅修 CU007/CU006 约束直接影响的 fixture，不泛修无关测试。聚焦跑 reset、客户真实主链、Material 旧类别回归与相关迁移；测试仅用 `backend/.env.test` 独立库。

Task A 独立 Reviewer 对权限泄漏矩阵、锁序死锁、SQL 不可变/迁移回滚、fixture 清理和历史文件一致性逐项审查并关闭 finding；不要与唯一 tracked writer 并行写同文件。

## Task B — UI/严格解码（Luna，自审）

CU007 Task A 完成并通过审查后，在 `frontend/src/api/` 新增 agreement/invoice typed API、`materials.ts` category/purpose/响应严格 decoder、`organization.ts` 动作严格 decoder；`frontend/src/api/customers.ts` 严格解码 `capabilities.agreement.{read,edit}` 与 `invoice.{read,edit}` Boolean。客户详情模块新增两个独立卡片，只有相应 read 为 true 才拉专用 GET/显示敏感内容，专用 GET 可返回 `canEdit`；协议卡片仅一份稳定协议，编辑新版本、真实期限/未知、精确历史文件；协议与开票各用独立版本分页路由（默认 20、上限 100、`version DESC,id DESC`），不内嵌无界 history。开票卡片单 `bank` 自由文字，未建档/全未知区分；空文件显示“未附协议文件”。未知结果保存原 body/key，并接 CU006 及既有同客户跨业务未知维护锁，冻结其他写与取消路径；已知写成功但 GET 失败只读刷新。409 保留草稿供刷新对照，客户 A→B 的晚返回不能污染 B。直接 Vitest/组件测试覆盖能力位严格类型/范围/撤权、普通历史不泄漏、专用 canEdit、权限隐藏、省略/显式清空、分页、历史下载 ID、跨业务冻结和撤权后响应处理，自审交接。不得引入 Lead/Case 自动选协议或 CU008 实际开票。

## Task C — 真实会话整合验收（Sol）与非实现Sol最终审查

在 A/B 稳定 tree 做独立审查：与固定基线逐入口比对 owner/category/list/total/get/download/upload/finalize/delete/restore/replay，确认旧 CUSTOMER_IDENTITY、CUSTOMER_RIGHT_EVIDENCE 语义未变。真实密码账号、cookie、CSRF 浏览器走创建草稿→上传→登记协议→修订→旧版精确下载、刷新/重登；开票未知→有值→清空；无权限账号尝试通用 Material 元数据/total/文件名/字节、协议和税号银行。确认撤权后旧 key 与旧下载都拒绝。Root 收 Level 3 Review finding、修复后在固定候选运行 `pnpm verify`、相关真实 PG/E2E/迁移专项；只记录实际通过的命令与 commit/tree，不把 `verify` 当浏览器 E2E，不复用 CU005/CU006 gate 当 CU007 证据。同步真正受影响的 Spec、状态和验证记录。CU007 Task A/B 未闭环前不得声称已实现。

## 固定基线定位清单与待核点

| 入口/拥有者                                                         | 固定基线文件                                                                                                                                              | 固定基线中要核对                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Material 6 个 HTTP 路由、DTO                                        | `backend/src/modules/materials/material.controller.ts`, `material.dto.ts`                                                                                 | 是否新增 metadata/get 或 category filter；若有全部纳入权限矩阵。       |
| upload/finalize/list/total/open/delete/restore、owner/category 判权 | `backend/src/modules/materials/material.service.ts`, `material.service.spec.ts`                                                                           | finalize 二阶段 actor 与 Customer 锁顺序；list 的过滤和 total 同谓词。 |
| 权限目录与映射                                                      | `backend/src/access-control/permission-catalog.ts`, `access-control.service.ts`, `prisma-access-control.store.ts`; `frontend/src/api/organization.ts`     | CU006 实际新 action、严格解码、默认角色模板与迁移，不新增自动 grant。  |
| 删除资格/父锁                                                       | `backend/src/modules/customers/customer-lifecycle.service.ts`, `backend/prisma/migrations/20261009010000_customer_lifecycle_receipt_guards/migration.sql` | 固定基线中最新 `OR REPLACE` 函数与父锁触发器；新增表计数。             |
| 历史文件约束                                                        | `backend/prisma/schema.prisma`, `backend/prisma/migrations/20261008035000_freeze_customer_right_evidence/migration.sql`                                   | 右证据专用约束不可直接套协议；新 category/source 需独立 SQL 负例。     |
| fixture/reset                                                       | `tests/support/customer-database.mjs`/`.d.mts`, `core-lead-database.mjs`/`.d.mts`，必要 auth/案件 helper                                                  | CU006 新约束及循环 FK 已如何处理；新增关系清理顺序与合法最小 seed。    |
| 产品/API                                                            | `frontend/src/api/materials.ts` 与 `materials.spec.ts`，客户详情模块/直接测试                                                                             | category/purpose/动作严格 decoder、旧类别和未授权敏感字段回归。        |

## 公共锁与固定基线接线

Root批准最小中立公共helper：将现有`customer-contact-locks.ts:lockCustomerContactActor`的纯actor/Grant事实锁函数移至`backend/src/access-control/customer-actor-facts-lock.ts`，原路径兼容重导出；不改SQL、锁序、参数或scope算法。MaterialService注入AccessControlModule已导出的OrganizationService，不导入CustomerModule，不建新服务或循环依赖。新协议类别uploadDraft/finalize以及softDelete/restore均在持Customer/Material行锁前取得actor/Grant锁；预读类别仅作不可暴露提示，正式事务重读并复查当前权限。旧类别不扩大改写。

当前102已经替换客户删除资格函数并计入所有Contact，生命周期service也已计入；新迁移必须基于102追加全部协议/开票实体、版本、receipt等，不覆盖回101。`lockVisibleCustomerForRoutineEdit`硬编码旧动作，禁止套用。MaterialReference.resourceType和purpose均为String，新协议引用需自身owner/department/版本/audit复合约束和SQL守卫；不能把权证的assetVersionId校验视为自动保护协议。所有102以前已执行SQL不变，103+最少采用新增enum先提交、结构守卫后事务的两段布局。

Task A仅跑聚焦单元/真实PG/迁移和必要类型静态；高风险非实现Sol审查通过后Task B普通UI自审，再Task C真实密码cookie/CSRF集成。最后非实现Sol最终组合审查、finding关闭、Root锁干净固定候选执行Level3完整verify及显式数据库E2E/迁移专项。按实际输入复用证据，不给每个普通UI Task增设Reviewer，不在同tree重复门禁。独立性不足/外部Pending按现行三级规则如实记录。

Task C接线补充：父页持有稳定身份绑定的仅内存资产未知恢复快照，验证同页失权卸载、恢复授权、原body/key重放和未知证明的精确下载后人工选用；不扩展旧资产跨整页刷新/退出持久化。联系人新组件读取成功后同步父级投影状态，未知pending不受影响；单笔/批量登记打开时刷新当前权利主体。纳入组合终审，旧资产/联系人直接回归与真实会话证据分别记录。
