# CORE-NT-010 合法批量归档实施计划

> 执行：subagent-driven-development；当前目录串行写入。Sol实施Command／schema／真实数据库风险测试，独立Sol审查后Luna接入已定UI／API和浏览器主链；主Agent集成并派独立Sol终审。完成状态只由路线图维护。

**Goal：** 有权运营明确选择1～50项合法待退货事项，分别记录实际退货／退款事实，一次原子归档；真实刷新／重登可读取，失败不能部分完成。

**Architecture：** 扩展leads现有单项归档事务内路径及公证列表，复用当前身份、范围、版本、审计、错误与请求层。只增一个批次回执模型和非破坏前向迁移，不扩建权限／批次平台，不改费用核心不变量。

**依据：** [已批准Spec](../../spec/v0.1/modules/notary.md#core-nt-010-合法批量归档)；基线`main@85b5bc5`，分支`codex/core-nt-010-batch-return-archive`。本切片Level 2（使用而不改共享底座）；实际改变共享机制、隔离或财务不变量时升级Level 3。

## Global Constraints

- 只实现NT-010；仅WAITING_RETURN且NO_ISSUE可归档。每项独立选择RETURN／KEEP／REFUND_ONLY、事实金额／待定、收付方和原因；不预设零、不发起支付、不改原费用／旧决定，不提前实现CA-003、终止／撤销。
- 操作者为有效内部账号，既有notary.return.archive授权覆盖每项；同部门不能替代数据范围。客户／公证处拒绝，重放也重查当前身份与授权。
- 一个事务all-or-nothing；expectedVersion及Idempotency-Key必填，稳定锁序，原结果重放不重复审计。同键异参冲突，撤权下一请求失效。
- 不修改已执行迁移、共享授权计算、全局事务／审计设施、依赖、CI／选测逻辑；不用any，不删除／弱化测试，不用重试掩盖失败。确需扩围先报主Agent。
- PowerShell运行Node／pnpm前加载Use-ProjectRuntime.ps1并核对锁定版本。只用backend/.env.test独立测试库和其经核对随机schema；不打印凭据，不操作开发／生产库或持久卷。
- TDD保留实际RED／GREEN；Worker聚焦验证，Reviewer只按必要finding补验；最终固定候选集中正式门禁，日志保存.local/logs，报告真实退出状态。

## Task 1: 原子批次Command、回执迁移及风险验证（Sol）

**Allowed files：** backend/src/modules/leads/notary-return-archive.service.ts及原直接测试（保持单项兼容）、新增notary-return-archive-batch.{dto,service,controller}及直接测试、lead.module.ts、core-ld-openapi.spec.ts；backend/prisma/schema.prisma及新迁移20261002010000_add_notary_return_archive_batch_receipt；scripts/prisma-model-owners.mjs（仅主责映射）；tests/support/notary-return-archive-batch-{database,migration}.{mjs,d.mts}和tests/e2e/notary-return-archive-batch-{database,migration}.spec.ts。确需更新既有fixture只做增量并报告，不重写无关模块。

**Contract：** 严格实现Spec路径、1～50个唯一UUID、规范排序、逐项NT-006 DTO、稳定错误及batchId/items响应。成功每项仍使用原ReturnArchiveResult。批次表以部门／actor／key唯一并限制FK；指纹和resultSnapshot不可改删，审计逐项＋一次批次，resourceType为notary_archive_batch、resourceId为batchId，details只保留actualIds／count。新表主责leads。

**Implementation：** 从既有NotaryReturnArchiveService抽出事务内归档及重放快照校验，单项包装保持原指纹、回执、错误、响应与bounded serialization retries兼容；batch不能循环调用公开archive()。先规范请求、身份检查，事务按规范ID锁定；逐项通过现有access.authorizeLead与当前INTERNAL身份校验，查批次回执并校验原快照／不可变事实，再决定重放或新写。新写逐项CAS、归档／事实、审计和最终批次审计／回执全部同事务，复用现有三次序列化冲突处理。无授权或不存在ID整批拒绝，不静默丢弃。

- [ ] 写RED覆盖有效两项不同费用、非法／重复／超限／未知输入、无Action／SELF越界／外部身份、阶段／NO_ISSUE不符、旧版本、退款上限及未知原费用、同键同请求／异参、倒序等价请求、损坏回执；验证单项兼容。

```ts
const input = { items: [first, { ...second, expectedVersion: staleVersion }] };
await expect(service.archive(actor, key, input)).rejects.toMatchObject({
  response: { code: 'VERSION_CONFLICT' },
});
// 真实PG验证first仍WAITING_RETURN，归档／金额／成功审计／批次回执均无新增。
```

- [ ] 实现并跑GREEN：`pnpm --filter @dev-cor/backend test src/modules/leads/notary-return-archive.service.spec.ts src/modules/leads/notary-return-archive-batch.service.spec.ts src/modules/leads/notary-return-archive-batch.controller.spec.ts src/core-ld-openapi.spec.ts`；DTO测试独立文件则加入准确选择器，匹配0项失败。Prisma生成后prepared typecheck及受影响格式。
- [ ] 真实数据库风险验证： mixed越权／跨部门／错误阶段／已归档／旧版本整批无写，停用／撤权后重放拒绝，费用原值及每项不同事实分别保留，审计／回执失败整体回滚，同键竞争仅一次成功审计、不同键版本竞争只有一批成功，单项与批次交叉竞争无部分推进。
- [ ] 迁移草稿先随机临时schema：空库全部57份迁移、上一56份schema合成旧归档／金额／单项回执升级不变、约束绕DTO负向输入、真实Prisma故障回滚与排除故障后重试。通过后才部署独立测试库正式schema；不得用额外外层事务伪造迁移原子性。
- [ ] 数据库测试复用受控入口：backend build:prepared后`pnpm test:e2e:full tests/e2e/notary-return-archive-batch-migration.spec.ts tests/e2e/notary-return-archive-batch-database.spec.ts`。共享数据库顺序执行，fixture/故障注入只在隔离测试目标。
- [ ] self-review、提交并保存简洁报告含Task／Model／Commit／Changed files／Tests+退出结果／Contract changes／Self-review findings／Known risks／Requires Sol attention。独立Sol Task审查（Spec＋质量）无未关闭finding后交Task 2。

## Task 2: 列表逐项表单、严格API及真实浏览器（Luna）

**Allowed files：** frontend/src/api/notary-return-archive-batch.{ts,spec.ts}、frontend/src/api/notary.{ts,spec.ts}（仅复用现有输入／响应guard最小导出）；frontend/src/modules/leads/NotaryReturnArchiveBatchPanel.{vue,spec.ts}、NotaryMatterListPage.{vue,spec.ts}；tests/e2e/notary-return-archive-batch.spec.ts及Task 1 fixture类型的增量正常主链帮助。不得改后端／schema／权限／公共契约，冲突立即升级。

**Consumes：** Task 1稳定POST和回执契约；既有getNotaryMatter(id,{signal})读取当前version/capabilities/evidence。复用requestJson、Cookie／CSRF／稳定错误，不直接fetch，不自动重试写命令。API验证请求以及batchId、严格items、返回ID集合、version+1、每项完整归档事实。

**UI：** 复用NT-009跨页选中ID，新增批量归档入口，不增重复阶段筛选。集中独立面板逐项读取真实详情和能力；最多50项，未知费用不填假零。每项明确选择、适用金额、收付方和原因，红星标必填；提交按钮说明数量、一起归档／一起失败、只记事实不付款。读取／提交加载禁重复；账号／部门／阶段变化、卸载取消旧读取，冻结选择，迟到响应丢弃。未知提交结果保留同body/key并锁输入，仅显式原请求重试，清楚提示未确认；确定拒绝提示重新读取，成功清选择并刷新列表与数量。

- [ ] TDD API／组件测试：真实请求形状、输入／响应异常、无选择／超限／不合法事项、每项不同费用、必填与待定、原费用说明、重复点击、400/403/404/409拒绝、500/网络未知结果同键同body重试、取消和身份／阶段变更丢弃迟到结果，不假成功／部分成功。
- [ ] `pnpm --filter @dev-cor/frontend test src/api/notary-return-archive-batch.spec.ts src/api/notary.spec.ts src/modules/leads/NotaryReturnArchiveBatchPanel.spec.ts src/modules/leads/NotaryMatterListPage.spec.ts`、frontend typecheck及受影响Prettier；self-review，不增普通Task独审。
- [ ] 真账号密码Chromium主链：两项实际待退货、不同样品费→列表勾选→分别选择和填事实→一次确认→已归档→逐项详情→刷新／重登录仍相同。混入不合法事项页面拒绝而DB不变；错误／未知响应不假成功。客户仅见允许结论、不见内部费用，外部身份不能批量归档；使用Task 1获权夹具，不人工改库冒充操作。
- [ ] build:prepared后受控`pnpm test:e2e:full tests/e2e/notary-return-archive-batch.spec.ts`，保留真实输出；旧单项／列设置／导出行为由集成定向回归覆盖。提交并按Task 1报告格式交接，报告完整留.local/nt010/task-2-report.md。

## Task 3: 集成终审、稳定候选门禁及收口（主Agent）

- [ ] 核对各Task报告、changed files与diff摘要；普通Luna任务无风险不完整重做。全部集成后一次独立Sol Final Review掌握85b5bc5到候选完整diff和业务约束；修复补审关闭finding后冻结。
- [ ] 最终契约／计划和必要文档在门禁前同步，逐项解释context漂移后context:record/strict，固定commit/tree，门禁期间停止修改。不提前写通过或完成。
- [ ] 暂无NT-010 scope，Level 2在固定候选逐项运行：相关后端公证单测／API组件、check:fast、spec:check、受影响格式、双端build:prepared、strict context；受控新批次风险／迁移／浏览器及受影响NT-006单项、列表偏好／导出回归。不能证明范围或实质改共享机制时升级完整verify。不伪造Evidence v2。
- [ ] 门禁成功后VALIDATION记录实际候选／tree／结果与.local日志，路线图NT-010完成、CA-003 Current、CA-004 Next，project-status最小恢复摘要。仅状态／证据＋解释后的快照收口，核对候选到收口累计diff并做文档专项；未通过则明确未完成，不提前推进。
- [ ] 本地提交、报告固定版本／证据、未运行项／限制及Git状态。本轮NT-009推送合并已完成；无NT-010新推送授权不推送／合并，不部署。
