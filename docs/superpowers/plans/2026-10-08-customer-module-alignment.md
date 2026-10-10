# 客户模块对齐 Demo 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 项目AGENTS.md风险路由优先；普通Task不逐项增加Reviewer，高风险Task与最终集成Review独立完成。

**Goal:** 按真实业务动作补齐客户详情、权利资产、真实材料、受控生命周期及合作资料；不复制演示假数据。

**Architecture:** 复用Customer Module、AccessControl、Material与共享审计。客户作为访问与并发锚；资产/协议保存不可变版本；客户删除采用可恢复软删除。本轮建立客户实际结算事实台账，列表与汇总共用唯一来源；不计算比例公式或生成支付。

**Tech Stack:** 现有Vue3/TypeScript/Element Plus按需组件、NestJS、Prisma/PostgreSQL、Jest/Vitest/Playwright，无新增依赖。

## Global Constraints

- 依据[设计](../specs/2026-10-08-customer-module-alignment-design.md)及现有Living Spec；删除/识别的推荐规则及多联系人、真实人工结算范围已由2026-10-08本聊天明确接受。
- 每次新PowerShell进程先点加载Use-ProjectRuntime.ps1，核对Node24.21.0/pnpm11.27.0；开工context:check，不盲目刷新快照。
- 单工作区单写入者；高风险gpt-6-sol及独立Reviewer，普通UI gpt-6-luna；不把模型切换作为授权。源码、公共契约和迁移任务串行集成。
- 不reset数据库、不改旧迁移、不写开发/人工/生产库；保留5181/3201/15434人工服务，E2E仍只使用5174/3101/15433。
- 写入校验、权限、事务、审计、版本冲突和幂等均由服务端承担；无any/开放索引签名/skipLibCheck绕过。
- 确认草稿删除需检查主体关联及全部资料/业务关联，不能只检查案件；被删除客户的所有入口必须一致拒绝。
- OCR不实施；仅人工登记与真实文件。用户已批准结算金额及开票/回款事实人工台账，不计算结算比例公式、不发起支付或外部推送。

## 切片顺序和可独立验收结果

| Slice       | 独立结果                                                   | 依赖                            | 风险                      |
| ----------- | ---------------------------------------------------------- | ------------------------------- | ------------------------- |
| CORE-CU-001 | 客户详情三个页签；已有基本信息/主体/准入/账号/历史持续可用 | 现有客户API                     | Level2，无新业务写入      |
| CORE-CU-002 | 人工登记/修订/查看权利资产与版本，未知日期准确展示         | 001                             | Level3，模型/版本/范围    |
| CORE-CU-003 | 资产真实文件上传、精确下载/换版、批量人工登记              | 002、Material                   | Level3，敏感文件/引用     |
| CORE-CU-004 | 无关联草稿软删除/恢复；已删除客户所有入口拒绝              | 002/003关联纳入检查             | Level3，生命周期/并发     |
| CORE-CU-005 | 合作暂停/终止/恢复、负责人转派及新增业务门槛               | 004及现有LD/账号                | Level2，局部动作/普通迁移 |
| CORE-CU-006 | 多联系人、最多一位主要标记与关系结束，原联系人无损保留     | 用户规则已确认                  | Level3，数据迁移          |
| CORE-CU-007 | 协议版本及开票资料真实维护，无财务计算                     | 005、字段确认                   | Level3，敏感资料/版本     |
| CORE-CU-008 | 人工结算登记、实际开票/回款与统一统计                      | 用户已批准本范围；不做公式/支付 | Level3，资金事实          |

001不显示假的资产登记/删除/账单按钮；002/003完成后接通真实能力。计划编号是任务边界，不表示后续规则已全部获批。

## Task 1 / CORE-CU-001：详情页面组织

**Files:** 修改frontend/src/modules/customers/CustomerDetailPage.vue、CustomerDetailPage.spec.ts及直接相关客户组件；如有必要新增customer-detail-tabs.ts及其聚焦测试。仅本页样式，避免全局样式扩围。

**Interfaces:** 消费getCustomer/CustomerDetail与现有CustomerRightsHolderPanel、CustomerAdmissionPanel、CustomerAccountPanel。不改变API、数据库或capabilities；输出三个有可访问名称的tab/tab-panel。

- [x] 先在CustomerDetailPage.spec.ts新增测试：初始“基本信息”有客户资料及原面板；点击“权利资产”只显示尚未交付说明；点击“结算记录”说明未接通且没有数字金额/账单按钮；切回基本信息保留面板状态。
- [x] 执行`pnpm --filter @dev-cor/frontend test src/modules/customers/CustomerDetailPage.spec.ts`确认测试能在旧页面失败。
- [x] 用原生button role=tab/aria-selected/aria-controls与稳定panel id组织页签；使用v-show保留已有子面板，不能每次切换销毁上传草稿。保持错误/缺失/重试和原capability控制。
- [x] 路由客户变化时取消旧请求、重置tab和客户数据，防止旧客户渲染；新增A→B与迟到A返回的测试。页面标题和资产主体称谓准确，不把权利人变成权利资产。
- [x] 执行本页及直接相关Vitest、前端typecheck:prepared、改动文件Prettier检查；自审并提交普通UI候选。
- [x] 固定候选运行现有客户Level2 scope，真实浏览器创建客户→详情→切换页签→编辑/刷新，必要追加customers.spec.ts过滤用例；记录候选而非声称整个客户完成。

## Task 2 / CORE-CU-002：资产人工登记与版本

**Files:** backend/prisma/schema.prisma、新前向迁移；backend/src/modules/customers/right-asset.{dto,controller,service,response.dto}.ts及.spec.ts；customer.module.ts；frontend/src/api/right-assets.ts及.spec.ts、modules/customers/CustomerRightAssetsPanel.vue及.spec.ts；tests/support/customer-right-asset-database.mjs/.d.mts和tests/e2e/customer-right-assets.spec.ts。

**Interfaces:** 已有customer.read/customer.edit-routine完整Grant及客户Query范围。路由/命令见设计第5节。输出RightAssetSummary/RightAssetDetail，响应含assetId/customerId/departmentId/version/fields/validity/capabilities/history；不投影其他客户关系。

- [ ] 测试先覆盖创建→修订→旧版本只读；未知号码/日期不生成默认值；长期必须明确；主体关联不匹配、跨部门和权限撤回稳定拒绝。
- [ ] 设计CustomerRightAsset、不可变Version、幂等Receipt及客户/主体/版本组合外键；确认同客户锁下版本CAS、防重和成功审计；新增枚举与表分离前向迁移。
- [ ] 在随机测试schema先验证空链、91份旧schema升级、错误DDL/输入失败与重试，再部署测试public；不触碰开发/人工库。
- [ ] 实现人工登记/修订/列表/详情，前端就地编辑和未知结果重试；核心输入例为`{type:'TRADEMARK',name:'测试商标',number:null,validityMode:'UNKNOWN',validTo:null}`，其余必需主体与版本来自真实上下文，不造UUID。
- [ ] 撤下采用独立权限和历史版本保留；不能把撤下写成物理删除；未获对应权限不提供动作。
- [ ] 定向Jest/Vitest＋真实数据库/浏览器与迁移专项通过后，由独立Sol核对Spec/数据范围/并发/不可变历史；修复后固定候选执行Level3正式门禁。

## Task 3 / CORE-CU-003：文件与批量人工登记

**Files:** material.dto.ts/material.service.ts和直接测试；新增资产证明类别前向迁移；现有MaterialService公开接口及资产版本引用；frontend/src/api/materials.ts及客户资产表单/批量组件；资产数据库与E2E测试。

**Interfaces:** 复用CreateUploadDraft→真实上传→不可变ContentVersion→AssertAvailableVersions→FreezeMaterialReferences；owner为客户且category为资产证明，所有引用同时校验客户/部门/类别/AVAILABLE及精确版本。

- [ ] 测试真实PDF/JPEG/PNG、错误字节签名/伪装类型/越大小、他客户材料、越权下载、换版后历史仍下载原字节。
- [ ] 上传失败保留输入；上传成功未登记显示独立状态，不生成证号或有效期；明确“未识别，人工填写”。
- [ ] 批量逐条上传/人工核对/显式选择；无选0次写入。每条幂等键独立，成功和失败逐条显示；仅重试失败项，不重放成功项为新对象。
- [ ] 引用与版本/审计同事务；Blob失败补偿复用现有协调器；不让普通删除释放被冻结历史引用。
- [ ] 定向Material/资产Jest、前端Vitest、真实文件E2E及独立Sol审查；固定组合候选Level3门禁。

## Task 4 / CORE-CU-004：客户草稿删除与恢复

**Files:** Customer字段及新迁移、customer-lifecycle.service/controller/dto及测试；AccessControl动作目录/Grant守卫及测试；所有Customer Query/Command及涉及客户的Material/Lead/Account/主体/资产入口；frontend/src/api/customers.ts、列表/详情/已删除草稿页及测试；customer-lifecycle数据库并发和E2E。

**Interfaces:** 明确soft-delete/restore命令，expectedVersion/idempotencyKey。列表显式deleted筛选，普通详情404；恢复使用原ID和唯一证件约束，不新建客户。

- [ ] 先写无关联草稿删除→普通列表消失→已删除列表可见→恢复原ID/资料；曾准入/主体关系/材料/上传草稿/企业账号/资产/线索/案件各自存在时删除拒绝。
- [ ] 同客户锁测试删除与编辑/准入/上传/新业务/资产并发，只允许满足门槛的一方完成；不能出现先count再关联导致悬挂。
- [ ] 在授权范围内增加独立动作权限，保持Grant Boundary和外部身份拒绝；需要补权限来源时写清迁移复制的明确基准，不按角色名称特判。
- [ ] 保留原值和证件唯一约束；恢复不恢复其他资源；成功审计/回执/CAS同事务，不自动清除。
- [ ] 普通所有入口排除deleted，独立恢复Query重查原数据范围；新草稿与软删除客户相同证件仍判重并指向恢复入口，不静默复用或泄露不可读客户。
- [ ] 迁移专项、直接测试、真实数据库并发和浏览器、独立Sol复审、稳定候选Level3门禁。

## Task 5～7：其他客户能力的独立计划

这些子项目各自写具体实施计划后开发，不用本总计划猜测未确认业务细节。005具体任务见[负责运营与合作状态计划](2026-10-09-customer-cooperation.md)，006见[多联系人计划](2026-10-09-customer-contacts.md)。005按现行三级规则定为Level2：新增局部业务Action、状态与普通非破坏迁移，复用既有Grant、部门范围、审计、事务及公开组织锁；schema/权限/锁Task仍由Sol实现并独立审查，组合补Final Review及真实数据库/E2E。若实际修改共享权限计算、隔离、锁或事务基础设施，立即升级Level3。

- [ ] 005：按SD-48保留独立的客户经理资料字段，不要求绑定登录账号、不建立经理角色或访问关系；负责运营沿用responsibleUserId和现有客户范围。客户经理资料录入／读取需补最小实现与验证，不混入转派或合作状态Command，不视为已交付；细化可配置独立转派/合作状态权限；暂停/终止原因、审计和恢复；只阻断新线索/新主业务，存量公证转案及案件推进继续。前置规则来自SD-12；不改变企业账号身份。
- [ ] 006：按已确认的最多一位主要联系人与结束关系规则，无损迁移准入联系人，原表单/准入校验保持兼容；主要变更与结束关系在客户锁下处理，历史可读且无联系人账号权限。
- [ ] 007：协议真实字段、起止/长期/未知、不可变版本、生效期、历史引用；开票资料不预填、不公开给外部账号；金额公式不计算。字段更新与敏感权限明确后独立设计。
- [ ] 每个子项目均写字段/动作/权限/并发/迁移/直接测试/E2E/回归边界，再按仓库级别执行，不把独立子项目当作一片大CRUD。

## Task 8 / CORE-CU-008：真实人工结算台账

**Files:** customer-settlement.dto/controller/service及直接测试、schema及独立前向迁移；frontend/src/api/customer-settlements.ts和CustomerSettlementsPanel.vue及测试；数据库/真实浏览器结算专项。

**Interfaces:** `GET/POST /customers/:id/settlements`及`POST .../:recordId/corrections`；金额均Decimal字符串，开票/回款支持真实未知；更正需expectedVersion、idempotencyKey、reason，创建与更正均锁客户/记录并记不可变版本。

- [ ] 测试同月两笔均显示、真实0不变演示值、未知不落假0、精确金额、并发CAS、重复请求一次审计、越权/跨部门和更正旧值保留。
- [ ] 实现逐笔实际结算日期/金额、实际开票/回款金额与回款日期；当前有效版本作为统计唯一来源，不以协议比例计算，不生成支付或外部任务。
- [ ] 列表/明细和累计统计共享同一读取范围与口径；未知项显式计数，不假称完整累计；0基数率显示“—”，超收如实提示。
- [ ] 前端接通真实页签；录入和更正遵循独立财务记录权限，不按管理员角色名称放行。稳定候选在独立审查之后执行Level3门禁及真实数据库/浏览器。

## 最终收口

- [ ] 同步真正受影响的Living Spec/Decision、路线图唯一Current/Next和恢复状态；已批准规则不写成“建议”，未批准规则不写成已经实现。
- [ ] 业务候选先完成独立终审及finding关闭，再集中执行所属正式门禁；最终组合tree变化不得冒用先前CA-008或UI切片证据。
- [ ] 记录真实commit/tree、测试和审查边界；保留人工环境。未获明确推送/合并/部署授权不执行这些操作。
