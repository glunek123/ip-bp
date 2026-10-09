# CORE-CU-008 真实人工结算台账实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户详情可按实际事实逐笔登记、更正和查看人民币结算台账，列表与顶部统计共用全部当前版本，未知与零分开。

**Architecture:** CustomerSettlementRecord/Version/Receipt属于现有customers模块，复用当前授权范围、actor事实锁、客户父锁、审计和幂等基础。通用CustomerDetail只增加三个Boolean能力位，敏感金额仅由专用API返回。页面本地composable持有唯一列表/统计读取状态，子面板处理登记、更正和版本历史，不增加全局财务store。

**Tech Stack:** Node24.21.0、pnpm11.27.0、NestJS、Prisma7.10.0、PostgreSQL17.11、Vue3/TypeScript、Jest/Vitest/Playwright；不新增依赖。

## Global Constraints

- 正式基线为CU007收口69e13d4cef52cdb4809f3ba96d223c27d67f0f55/tree e68c604016f5ae1505dabad8dab21352f1b95c64；实际CU007业务证据仍绑定76c0506/tree d9c68a0，不称收口HEAD重跑旧门禁。
- 业务依据SD-47/48、REQ-CU-004和[正式台账契约](../specs/2026-10-10-customer-settlements-contract.md)。只有负责运营，没有客户经理；不套比例公式、不付款或外推、不自动回填旧台账，不增加附件、冲销或物理删除。
- Level3：资金精度、独立敏感授权、不可变更正与SQL守卫。Task A和高风险集成由Sol实现，另一非实现Sol审查；普通Task B由Luna自审，公共契约变动升级Root。外部异模型Review不可用时按三级规则标注独立性不足/Pending，不冒称外部通过。
- 单一tracked写者及Node/DB owner串行。新PS点加载Use-ProjectRuntime并核版本；DB只用backend/.env.test15433，E2E5174/3101；旧人工5181/3201/15434不改，禁止reset/drop公共schema或数据卷，已执行SQL102～108不改。
- 金额输入为严格十进制字符串0..9999999999999999.99；原始第三位、Number、指数、符号、空格均拒绝；null不当0。采用已实际probe通过的无参数Decimal @db.Decimal/无typmod NUMERIC，CHECK/trigger独立验证，精确存储与计算按正式契约，不用NUMERIC(18,2)静默舍入。
- 读/登记/更正三个动作各自与当前customer.read范围取交集，不自动Grant；登记/更正不隐含ledger.read。暂停/终止可按现有维护边界登记旧事实，已删除客户拒绝。
- 结果未知先保存原body/key，存储失败不POST；403/404清敏感投影但保留未知，同客户其他写冻结。已确认成功后读取失败只读刷新。

## Task A：后端完整台账、DDL及真实PG（Sol，独立Sol Review）

**Files:** 新建backend/src/modules/customers/customer-settlement.dto.ts、customer-settlement.response.dto.ts、customer-settlement.controller.ts、customer-settlement.service.ts及直接.spec.ts；修改customer.module.ts、customer.service.ts、customer-lifecycle.service.ts及直接测试。修改backend/prisma/schema.prisma与新增109起前向迁移；backend/src/access-control/permission-catalog.ts、access-control.service.ts、prisma-access-control.store.ts及直接测试；frontend/src/api/organization.ts及相关严格解码测试、frontend/src/api/customers.ts及能力位测试。新增tests/support/customer-settlement-database.mjs/.d.mts、customer-settlement-migration.mjs/.d.mts，tests/e2e/customer-settlements.spec.ts、customer-settlement-migration.spec.ts；必要fixture只改依赖清理顺序，不削弱生产守卫。scripts/prisma-model-owners.mjs加入3模型主责。

**Interfaces:** 专用list/detail/versions/register/correct五路由、完整五事实及响应以正式契约为准；新增PermissionAction三项CUSTOMER_SETTLEMENT_READ/REGISTER/CORRECT与对应customer.settlement.read/register/correct。CustomerDetail仅capabilities.settlement三个严格Boolean。前端普通Task消费本Task通过审查的实际响应，不另扩元数据端点。

- [ ] 先写DTO/服务判别测试，运行聚焦Jest确认目标行为失败，再实现。金额原样校验后规范两位；真实公历日期拒绝0000和不存在日期。更正独立DTO，三个nullable事实必须显式出现，不能继承登记的optional校验而吞掉undefined。

```ts
const accepted = ['0', '0.0', '1.23', '9999999999999999.99'];
const rejected: unknown[] = [
  1.23,
  '-1',
  '+1',
  ' 1',
  '01',
  '1e2',
  '1.001',
  '1.230',
  '10000000000000000',
];
const correction = {
  settlementDate: '2026-10-01',
  settlementAmount: '100.00',
  invoiceAmount: null,
  receivedAmount: '0.00',
  receivedDate: null,
  reason: '核对原始登记后更正',
  expectedCustomerVersion: 2,
  expectedRecordVersion: 1,
};
```

- [ ] 新enum先提交，再结构/守卫事务。无历史台账回填。复合FK闭合客户/部门/record/current/receipt；REGISTER原因null、CORRECT非空；version/receipt不可改删，AuditEvent OLD/NEW action/resourceType及已被version引用ID不可改；稳定head单调且当前=max(version)，延迟守卫同时覆盖新增version。保留108最新删除资格及102联系人/曾准入条件，加入所有台账关联，零元同样阻断删除。
- [ ] 先在随机临时schema测试空链、108合成旧联系人/协议/开票与原receipt升级、失败原子与修复重试；原SQL102～108 checksum不动。再以统一测试入口前向部署测试public。原始INSERT/UPDATE第三位、非有限、负数、上界以及非法跨客户指针/篡改审计/版本/head必须拒绝，合法v1→v2→v3及旧key返回v1同时成立。
- [ ] 写事务沿用lockCustomerActorFacts→初次范围→Customer FOR UPDATE→当前范围/deleted→原receipt/fingerprint→仅新写CAS/record锁→version/audit/receipt/客户CAS原子提交。相同原key/body重放旧结果；异体409，当前撤权不重放。锁争用有界BUSY且保留原key。新增与删除竞争不能悬挂关联。
- [ ] list/count/stats在一个真正REPEATABLE READ事务或一个CTE读取全部当前版，items稳定按结算日期DESC/record ID DESC分页。SUM输出可超过单笔上限；金额小计+未知计数，只有全部回款已知才算待回款/率。局部Decimal上下文精度按聚合位数取足；百分率按整数分的商/余数HALF_UP，不通过浮点或中间近似除法改变边界。

| 判别                                                         | 预期                                               |
| ------------------------------------------------------------ | -------------------------------------------------- |
| 两笔同月，一笔received=null，一笔0.00                        | 两笔均保留；已知小计0.00、未知1；pending/rate=null |
| total=0.00，全部回款已知                                     | pending按实差额，rate=null                         |
| total=100.00，received=120.00                                | pending=-20.00，rate=120.00；显示超收              |
| 20×9999999999999999.99+0.21，received合计2010000000000000.00 | total=200000000000000000.01，rate=1.00             |
| 上例最后一笔改0.20                                           | total=200000000000000000.00，rate=1.01             |

- [ ] 真实PG覆盖三独立能力组合（register-only无GET/KPI、correct-only持合法精确id/version仍可更正）、SELF/TEAM/DEPT、跨部门、CLIENT/LAWYER、撤权/转派后旧receipt、audit失败回滚、不同key同CAS竞争、删除竞争、分页同快照。普通客户history无结算动作/金额，专用版本历史有原因/actor/时刻。回款日期与金额独立，可预收早于结算。
- [ ] 运行聚焦Jest/权限目录及前端organization/customers严格解码；准备Prisma一次，prepared类型/architecture/目标lint与格式。DB命令为`pnpm test:e2e tests/e2e/customer-settlements.spec.ts tests/e2e/customer-settlement-migration.spec.ts --workers=1`，不得插多余`--`。保存真实日志、commit/tree与Task A报告，停止写入；非实现Sol Review读取diff/源码/证据，finding修复后由原审查者关闭，才进入Task B。

## Task B：正式页面、单状态源及原请求恢复（Luna，自审）

**Files:** 新建frontend/src/api/customer-settlements.ts/.spec.ts、frontend/src/modules/customers/CustomerSettlementsPanel.vue/.spec.ts、use-customer-settlements.ts/.spec.ts、customer-settlement-pending.ts/.spec.ts、customer-settlement-money.ts/.spec.ts；修改CustomerDetailPage.vue/.spec.ts及必要customers能力位fixture。所有新增文件留在现有customers模块，不改共享Auth/store/HTTP。

**Interfaces:** API模块导出listCustomerSettlements、getCustomerSettlement、listCustomerSettlementVersions、registerCustomerSettlement、correctCustomerSettlement，消费Task A受审响应并严格解码。useCustomerSettlements是父页创建的一份本地状态，唯一持有列表/stats分页GET；面板只读取该状态并请求同一owner刷新，单记录与版本历史使用对应GET。pending按userId/departmentId/customerId/kind存原body/key/recordVersion，actor授权revision只用于当前代次隔离，不进入稳定身份或幂等正文。

- [ ] 先写API拒绝非Boolean/非规范金额/混入敏感额外键、组件未知与零/两笔同月/版本历史、single fetch owner、register-only零列表GET/无KPI、read+correct入口的测试；运行Vitest确认RED。接口和响应名必须与Task A受审版本一致，不重新定义权限或统计口径。
- [ ] 接通结算页签与顶部4项真实KPI。无数据以真实空态；有未知的回款显示“已知回款小计，N笔未录入”；待回款未知/率分母0显示“—”；负待回款显示超收，率>100按真实文本且只夹视觉条宽度。金额显示用本模块BigInt分，输入保留原字符串，nullable使用显式“未录入/已知”选择而非空串当0。
- [ ] 页面首次有read、身份/授权代次变化、分页、只读刷新或确认命令成功时由唯一owner GET；不叠加customer.version watch重复拉取。任何失权/GET失败/切客户立即清敏感状态并abort/generation隔离旧响应。register-only从普通customerVersion空白登记，成功只刷新普通详情；不读列表/统计/历史。
- [ ] 实现登记与完整事实更正、原因和分页版本历史。发送前可靠存原请求；未知按原body/key恢复，403/404不删key，409保留草稿等待人工比对；确定成功后的GET失败只读刷新不再POST。结算unknown/stale加入父页同客户维护冻结，其他子模块false事件不能清它；恢复入口不被本模块自身pending永久堵住；旧客户/旧actor事件忽略。
- [ ] 运行新增API/Panel/composable/pending/money与现有Detail组件Vitest，以及prepared类型、目标lint/格式；保留失败历史，不为普通Task增加独立Reviewer。提交后自审报告接口未越界、实际测试/commit/tree及Sol关注项，停止写入。

## Task C：真实会话集成、八片累计终审及固定门禁（Sol/Root）

**Files:** 新建tests/e2e/customer-settlement-ui.spec.ts，必要修改直接fixture与受影响客户面板/测试；不扩大共享授权/迁移基础设施。正式业务契约变动先Root裁决。

- [ ] 使用真实密码cookie/CSRF及显式Grant：同月两笔→未知回款→真实零→更正/旧版→刷新/重登；KPI/list同响应、撤权清金额、响应丢失原key重放、成功后GET失败只读恢复、跨客户/代次迟到响应、register-only无敏感GET、read+correct正式入口。协议/开票资料不能当实际开票金额来源，无付款/外部请求。
- [ ] 对最终稳定候选做一次非实现Sol Final Review，范围覆盖8a8fe11至本候选的客户001～008累计diff与实际8契约、权限、同快照、SQL不变量及原请求恢复；同时满足008与八片组合终审，不对相同输入机械重复审查。同模型隔离独立性不足/外部Pending如实记录。所有C/I/M关闭后冻结候选与环境。
- [ ] 固定干净commit/tree运行完整`pnpm verify`和`pnpm test:e2e --workers=1`；全库已包含本片迁移专项时不重复运行同输入。逐项前后核候选/统一环境HMAC、保存真实退出码；失败保留，修复形成新候选后只重跑失效输入，最终完整门禁按规则完成。该一次完整门禁同时覆盖008与八片组合，不把007旧结果当008通过。
- [ ] 在全部业务门禁通过的实际候选上，用已准备的.local/manual-test-cu008-20261009/prepare.ps1创建全新5182/3202/15435、独立DB/卷/账号/数据；先核端口与目标，复制实际验证构建并记录源hash，真实cookie/CSRF人工环境浏览器冒烟后交付URL/私有凭据文件获取方式和优先流程。保留旧5181环境，不借用E2E账号/端口/DB，不输出凭据。
- [ ] 最后按非执行性收口规则补完成状态/真实验证记录/上下文，执行受影响文档检查并明确业务候选与收口tree边界。无推送、合并、部署或CA-009领取；完整外部财务、OCR及生产存储不由本片关闭。
