# CORE-NT-009 公证办理清单导出实施计划

> 执行：subagent-driven-development，串行写入当前目录；Sol实施并独审权限／迁移Task，Luna实现方向已定的UI及真实浏览器验证，主Agent集成并派独立Sol终审。完成状态只在路线图维护。

**Goal：** 内部账号明确选定事项或当前阶段，预览数量后下载实际获权的五列CSV，后端留存成功生成审计。

**Architecture：** 扩展现有leads公证列表，不新增导出平台或存储Provider。Action复用现有Grant、Actor和数据范围，导出与读取范围取交集；沿用现有事务、审计和HTTP错误。仅新增两个前向迁移，先提交枚举，再补既有部门角色管理员Grant。

**依据：** [已批准公证Spec](../../spec/v0.1/modules/notary.md#core-nt-009-受权批量导出办理清单)，基线`main@346d531`，分支`codex/core-nt-009-list-export`。

## Global Constraints

- 只做NT-009；不实现批量归档、终止、附件打包、详细取证表、通用导出平台或生产部署。
- 不改已执行迁移、共享权限计算或部门边界；不打印凭据；数据库测试只用backend/.env.test的隔离库，迁移草稿先在随机schema验证。
- 不引入依赖，不使用any，不删除测试、弱化断言或扩大环境权限。PowerShell运行Node／pnpm前加载Use-ProjectRuntime.ps1并核对锁定版本。
- 测试先RED再GREEN；Worker聚焦测试，Reviewer只按finding补验，主Agent最终固定候选门禁，不重复同一tree的全量验证。

## Task 1: 后端授权、导出与前向迁移（Sol）

**Allowed files：** backend/prisma/schema.prisma及两个新迁移`20260930030000_add_notary_list_export_action`、`20260930031000_add_notary_list_export_admin_grants`；backend/src/access-control/{access-control.service,prisma-access-control.store,permission-catalog}及直接契约测试；backend/src/modules/leads/notary-list-export.{dto,service,controller}及直接测试；lead.module.ts；core-ld-openapi.spec.ts；frontend/src/api/organization.ts及其契约测试（仅同步Action）；tests/support/notary-list-export-migration.{mjs,d.mts}及tests/e2e/notary-list-export-migration.spec.ts。确需修改其他文件先报主Agent，不自行扩大。

**Contract：** 严格执行公证Spec NT-009实施契约。Action为NOTARY_LIST_EXPORT／notary.list.export；两个POST路径为`/notary-matters/exports/preview`与`/notary-matters/exports`，前者返回count／maxRows，后者返回CSV附件，expectedCount必填。最大1000条；输入只包含SELECTED唯一UUID列表或FILTERED可选stage；选中不存在／越权ID整批拒绝。CSV固定五列，审计使用现有AuditEvent，action=`notary.list.export.generated`，resourceType=`notary-list-export`、resourceId为服务端UUID，details保存mode、stage／选中范围、actualIds、count，不保存CSV全文。

**Implementation：** 在transaction内校验活跃INTERNAL账号并通过当前reader读取两种scope；notaryMatter的departmentId及sourceLead的两scope同时限制。预览无审计；最终一次稳定查询最多1001行、核对expectedCount、构造CSV并写审计，事务失败不发送。Controller在事务完成后设置text/csv;charset=utf-8及附件文件名，不接受前端字段值。新增静态Controller必须先于`:id`详情路由；不改变现有偏好／列表契约。管理员新Grant按已有角色管理边界迁移模式，只补DEPARTMENT role.manage角色，不为普通lead.read角色补；更新实际受影响账号revision，不依赖用户名／角色名特判。当前bootstrap若枚举固定Actions须同步最小增量并补直接测试。

- [ ] 先建立RED：无导出Grant403、交集范围、外部主体拒绝、未知／重复／混合输入400、空／超限、阶段筛选、expectedCount过期409、稳定顺序／五列／BOM、公式及引号换行转义、审计失败不返回。

```ts
await expect(
  service.export(actor, {
    mode: 'SELECTED',
    matterIds: [matterId],
    expectedCount: 1,
  }),
).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
// 有权路径须验证生成的CSV字节、实际ID与条数，并使auditEvent.create失败后整个请求拒绝。
```

- [ ] 运行新服务／HTTP测试记录RED，再实现最小DTO、Service、Controller、module装配、枚举映射与目录；生成Prisma后跑GREEN。
- [ ] 使用现有权限目录、organization、RoleTemplate前端契约测试，确认新增Action可解码／正式分配，拒绝外部Action；检查新增目录对现有测试的真实影响，不放宽数量断言。
- [ ] 迁移专项覆盖空库56份全链、上一支持schema保留旧账号与历史事项、仅管理员角色补Grant／revision、普通角色不自动获权、真实Prisma失败回滚／重试。enum新增和新值使用分两个已提交事务；复制NT-008安全临时schema模式，禁止额外外层事务伪造Prisma原子性。
- [ ] 聚焦Jest、权限契约、后端typecheck及受影响格式通过，提交Task；报告真实RED／GREEN、commit、changed files、contract changes、self-review和known risks。独立Sol Task Review通过后才能交给Task 2。

## Task 2: 前端明确选择、预览下载及数据库浏览器验收（Luna）

**Allowed files：** frontend/src/api/http.ts及http.spec.ts（仅按既定契约新增postBlob复用executeRequest与文件解析，不重构请求层）；frontend/src/api/notary-list-export.{ts,spec.ts}；frontend/src/modules/leads/NotaryMatterListPage.{vue,spec.ts}；tests/e2e/notary-list-export.spec.ts及tests/support/core-lead-database.mjs（仅增量fixture）。不得改schema、权限计算、backend业务实现或公共契约；遇到冲突立即升级主Agent。

**Consumes：** Task 1的两个POST路径及Spec严格范围。新增HTTP公开函数`postBlob(path: string, body: JsonValue, options?: RequestOptions): Promise<{ blob: Blob; filename: string; mimeType: string }>`，使用JSON正文、同源Cookie、CSRF、既有超时／错误解析，GET getBlob保持兼容，下载不自动重试；API封装校验JSON预览与CSV MIME，不用fetch绕开请求层。

**UI：** 保留列设置；新增固定选择列（不能被偏好隐藏／换序）、本页全选与逐项勾选、选中数量／清空选择、批量导出入口。同一账号／部门／阶段翻页保留稳定ID，切阶段／身份清空。导出面板有明确“已勾选事项”／“当前阶段筛选结果”选择，不将未勾选默认为全库；说明只导出五列、不含附件和内部费用。调用后端preview展示范围和count，确认下载时传expectedCount；加载禁重复、取消、成功、权限／数量变化／超限错误提示完整。范围变化使旧预览无效；身份变化及卸载取消请求，旧响应不得触发文件下载。Object URL用后及时revoke。

- [ ] TDD API／组件覆盖明确范围、跨页稳定选择／清空、固定选择列与个人列偏好兼容、预览前不能下载、取消／失败不假成功、403／409／超限、重复点击、身份／阶段变更丢弃旧预览和下载响应。

```ts
expect(wrapper.find('[data-test="export-confirm"]').exists()).toBe(false);
// 选择范围 -> preview成功 -> 再确认，断言POST body不含行字段且expectedCount来自预览。
// 切身份后resolve旧下载，断言URL.createObjectURL未被调用。
```

- [ ] 聚焦Vitest及前端typecheck／受影响格式；普通任务自审，不再开独立Task Reviewer。
- [ ] 真实PG fixture仅放独立测试库；有两个部门、SELF范围及不同阶段、超过20条跨页记录、恶意公式公证处名；用真实账号密码登录并操作。证明两页所选CSV和明确当前阶段导出值正确、不含他部门／范围外数据，列隐藏不影响五列，刷新及重登后数据与偏好保持。
- [ ] 浏览器／直接会话请求验证未登录、客户／公证处、无Grant、撤权／停用下一请求、伪造ID、超限／空、expectedCount变更；注入审计失败不下载且不留成功审计，成功审计与CSV条数一致。
- [ ] 受控E2E前先重建backend dist，使用现有`pnpm test:e2e:full tests/e2e/notary-list-export.spec.ts`入口；共享数据库／迁移串行，不用测试Bearer冒充浏览器账号。
- [ ] 提交并报告聚焦结果、文件清单、已执行浏览器命令、风险。主Agent只审报告及diff摘要；风险出现才展开，不完整重做。

## Task 3: 集成、终审与最终门禁（主Agent）

- [ ] 全部实现集成后固定候选，经独立Sol Final Review关闭全部finding；业务／契约修改补审后才冻结。
- [ ] Level 2：固定候选执行后端／前端影响聚焦单测、check:fast、spec:check、受影响Prettier、双端build:prepared、严格上下文以及受控迁移／导出／既有列表范围E2E；无NT-009 scope，逐项记录，不新建选测系统。不能限定影响或发现共享机制改变则升级并运行完整verify。
- [ ] 门禁前同步真实最终契约及必要文档、解释diff后context:record；不预写通过。候选保持稳定，日志放.local/logs／现有报告，凭据脱敏。
- [ ] 门禁通过后在VALIDATION保存实际候选／tree／结果，路线图将NT-009完成、NT-010 Current、CA-003 Next，project-status只留恢复摘要。只补状态／证据及已解释快照，核对累计收口diff并执行文档专项，不机械重跑业务门禁。
- [ ] 本地提交并报告固定版本、实际证据、未运行项／限制及Git状态；无新授权不推送、合并或开发NT-010。
