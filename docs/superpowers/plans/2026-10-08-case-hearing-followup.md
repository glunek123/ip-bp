# CORE-CA-007 开庭后自动推进与受控纠错实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. 模型、Task审查及集成终审按项目协作路由；不再次询问已批准的业务边界。

**Goal:** 有权运营／承办律师登记真实开庭日期，服务端到期自动推进并重启补跑；有权运营可留痕纠正未发生后续正式办理事实的自动推进。

**Architecture:** 复用cases Command、案锁／CAS、授权、幂等及共享AuditEvent。持久化当前安排与不可变安排／推进／纠错历史；共享审计增加受限SYSTEM路径，真人路径不放宽。调度在cases内实现启动补扫及可重入扫描，不新建队列、日历平台或任意状态编辑器。

**Tech Stack:** 既定NestJS／Prisma／PostgreSQL、Vue／Element Plus、Jest／Vitest／Playwright；不新增依赖。

## Global Constraints

- 分支`codex/core-ca-007-hearing-followup`，业务基线main`6ca3786491e18c0b1253bdee0995df7d59bf06ae`；2026-10-08用户确认最小纠错随本切片交付。
- 唯一业务契约为[REQ-CA-008及AC-CA-008](../../spec/v0.1/modules/cases.md#req-ca-008-开庭次日自动推进)，字段见[核心字段契约§7](../specs/2026-09-21-core-flow-field-material-contract.md#7-core-ca字段与动作契约)。本计划不复制完整业务规则，不维护动态完成台账。
- 风险Level 3：新增准确系统审计需要修改共享AuditEvent的schema和身份触发器；不能以复用事务为由降级。保留高风险Task独立Sol Review、集成Final Review、完整verify、真实数据库／浏览器和迁移验证。
- 日期为`YYYY-MM-DD`，时点为带时区ISO 8601，业务时区`Asia/Shanghai`；不以执行机器时区或固定UTC偏移推导历史日期，不新增人工实际开庭确认门槛。
- 仅实现一审安排、自动`WAITING_HEARING → WAITING_JUDGMENT`及获准最小纠错。已有后续正式事实的纠错不在本切片；CA-008引入真实判决模型时必须补齐同案锁下的阻断和竞争验证。
- 客户仅延续既有企业范围的案件阶段投影，不增加内部开庭事实、纠错原因、人员身份或审计正文。律师仅当前承办案正常安排，不获得异常纠错权。
- 每个PowerShell进程先加载`Use-ProjectRuntime.ps1`并核对锁定Node／pnpm。数据库仅`backend/.env.test`独立测试库；不输出凭据、不改开发／生产库、不修改已执行迁移、不删除卷。
- 一个checkout一个写入者，Task串行交接；共享数据库清理、迁移和故障注入不并行。实现、测试和收口不默认推送、合并或部署。

## 接口与事实边界

```ts
type SaveCaseHearingInput = {
  expectedVersion: number;
  idempotencyKey: string;
  hearingAt: string | null; // 显式日期或清除，不能省略后误判为清除
};
type CorrectCaseHearingInput = SaveCaseHearingInput & {
  reason: string; // trim后1～500字符
};
type CaseHearingCommandResult = {
  id: string;
  stage: 'WAITING_HEARING' | 'WAITING_JUDGMENT';
  version: number;
  arrangementId: string;
  hearingAt: string | null;
  recordedAt: string;
};
```

- 正常保存：`POST /api/v1/cases/:id/hearing-schedule`及承办律师的`/api/v1/lawyer/cases/:id/hearing-schedule`，201；调用`CaseHearingService.schedule(actor, caseId, input)`。
- 受控纠错：仅内部`POST /api/v1/cases/:id/hearing-correct`，201；调用`CaseHearingService.correct(actor, caseId, input)`。不允许客户端提交目标阶段、操作者或执行时间。
- 对应内部Action为`CASE_HEARING_SCHEDULE / case.hearing.schedule`、`CASE_HEARING_CORRECT / case.hearing.correct`；自动动作`case.hearing.auto_advanced`不是可授予PermissionAction或HTTP状态切换入口。
- 正常登记授权可从`CASE_ACCEPTANCE_REGISTER`原同范围Grant复制并失效受影响授权版本。纠错是独立授权，不从正常登记或读取范围推导。现有RoleTemplate仅有可编辑名称，无可靠主管／组长内建标识，不按岗位名称授予权限。
- 存量授权初始化复用既有管理Action迁移模式：仅为同一活跃模板已同时持有`CASE_MATCH DEPARTMENT`与`ROLE_MANAGE DEPARTMENT`的管理模板新增`CASE_HEARING_CORRECT DEPARTMENT`；不跨模板拼接，不自动授予其他SELF／TEAM模板。只对实际新增Grant的模板增加version，并使其活跃分派的活跃账号authorization_revision失效。获权管理员随后在正式角色页显式配置本部门／本团队异常管理模板，仍受既有授予边界限制。新库沿用既有全部Action初始管理员入口。
- 存量升级前核对是否有可用的上述管理模板及活跃账号；缺失时先由有权管理员在既有角色入口配置并绑定获批模板。无法满足时报告部署阻塞并保持拒绝，不偷偷扩大授权或用人工改库完成验收。迁移及浏览器验收覆盖资格交集、零资格安全拒绝、授权即时生效、正式角色入口配置和普通SELF未获权拒绝。
- 使用`CaseHearingArrangement`保存日期版本；`CaseHearingAdvance`保存一次实际自动推进及唯一安排／审计关联；`CaseHearingCorrection`保存原因、前后安排／阶段及原推进关联；`CaseHearingReceipt`保存同部门／操作者／动作／幂等键、请求摘要与原响应。Case只保留当前安排／有效推进指针；指针更换不删除任何旧事实。主责声明进入现有Prisma model owners。
- 详情增加`canScheduleHearing`、`canCorrectHearing`及当前安排、实际自动推进和纠错历史的`hearing`投影；历史来自业务事实，不反推审计是否存在。律师不获得内部操作者ID／原审计正文，客户不增加hearing投影。Task 1固定精确DTO及可空字段后交接Task 2，若调整公共接口必须先由主Agent同步该契约。

### Task 1：共享系统审计及案件后端／数据库（6 Sol）

**Files:**

- Create: `backend/src/modules/cases/case-hearing.dto.ts`、`case-hearing.service.ts`、`case-hearing-date.ts`、`case-hearing-scheduler.service.ts`及各自直接spec。
- Modify: `backend/prisma/schema.prisma`、新增前向migration、`scripts/prisma-model-owners.mjs`；`backend/src/modules/cases/case.module.ts`、`case-read.controller.ts`、`lawyer-case.controller.ts`、`case-read.dto.ts`、`case-read.service.ts`、`client-case.service.ts`、`client-case.response.dto.ts`；`backend/src/access-control/access-control.service.ts`、`permission-catalog.ts`、`prisma-access-control.store.ts`及这些文件的直接测试。
- Modify: `backend/src/modules/customers/customer.service.ts`及直接spec，仅处理AuditEvent账号字段可空后的真人历史窄化，不改变客户历史公开契约。
- Create: `tests/e2e/case-hearing-database.spec.ts`、`case-hearing-migration.spec.ts`、`tests/support/case-hearing-database.mjs`及`.d.mts`、`case-hearing-migration.mjs`及`.d.mts`；按需扩展既有明确测试账号的清理helper，不降低正式不可变约束。

**Interfaces:** 产生上述两Command、详情DTO与WAITING_JUDGMENT阶段。内部`CaseHearingService.advanceDue(now: Date)`仅从真实持久化安排选择并推进；`CaseHearingSchedulerService`在Nest启动和持续扫描时调用，关闭时停止本实例计时器。测试时钟仅通过服务依赖注入，不暴露HTTP时间参数或生产环境任意时钟覆盖。

- [ ] **Step 1：先取得日期和状态行为RED。** 在`case-hearing-date.spec.ts`写北京时间边界与null反例，不把缺失文件／编译错误当行为RED：

```ts
import { hearingIsDue } from './case-hearing-date';

it('在北京时间日期次日零点才到期', () => {
  expect(hearingIsDue('2026-10-08', new Date('2026-10-08T15:59:59.999Z'))).toBe(
    false,
  );
  expect(hearingIsDue('2026-10-08', new Date('2026-10-08T16:00:00.000Z'))).toBe(
    true,
  );
  expect(hearingIsDue(null, new Date('2026-10-08T16:00:00.000Z'))).toBe(false);
});
```

运行`pnpm --filter @dev-cor/backend test src/modules/cases/case-hearing-date.spec.ts`，记录有效失败后实现并转绿。有效业务日期已由DTO校验；实现按北京时间日期比较，不引入本地时区偏移：

```ts
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function hearingIsDue(hearingAt: string | null, now: Date): boolean {
  const parts = formatter.formatToParts(now);
  const part = (kind: 'year' | 'month' | 'day') => {
    const value = parts.find((item) => item.type === kind)?.value;
    if (value === undefined) throw new Error('Shanghai date part unavailable');
    return value;
  };
  return (
    hearingAt !== null &&
    hearingAt < `${part('year')}-${part('month')}-${part('day')}`
  );
}
```

- [ ] **Step 2：补事务／调度反例。** 分别测授权先于幂等重放、日期下限、明确null、原因、旧版本／错误阶段、同键异参、非自动来源；改期／清除与自动扫描竞争、两实例竞争、纠错后新安排再次到期、已到期更正不新增推进，以及安排／推进／纠错／审计／回执故障整体回滚。
- [ ] **Step 3：实施前向迁移与准确系统审计。** 枚举新增和使用该枚举的事实拆开迁移。AuditEvent增加默认HUMAN／受限SYSTEM；SYSTEM必须无真人账号和四类身份路径，仅CASE自动推进，核对同案／部门／安排及推进事实；HUMAN仍强制真人路径，不能使用系统专属动作。更新共享身份触发器的SYSTEM分支而不改变upload_drafts及其他真人分支；把新成功事件和事实纳入不可变保护。客户历史显式筛选HUMAN并对不可空账号作局部完整性检查，不以空字符串、伪造账号或非空断言掩盖异常。
- [ ] **Step 4：实现同案锁下的两Command与可重入自动推进。** 正常保存追加安排、真人审计、回执并更新当前指针；提交成功后唤醒补扫，补扫失败仍由持久化条件重试，不假报已推进。调度事务重读当前安排／阶段，CAS版本并原子保存推进及SYSTEM审计，安排唯一约束拒绝重复。受控纠错绑定原自动推进，追加原因和历史，按Spec决定回到待开庭或保持待判决；不得创建空泛的设置阶段方法。
- [ ] **Step 5：真实数据库与迁移专项。** 在独立测试库随机临时schema先测空迁移链、上一支持schema的真实旧事实／回执升级、失败原子与向前重试；然后正常测试schema。覆盖管理Grant初始化交集、不同模板不拼权、零资格仍拒绝及实际新增授权才失效版本。直接SQL反例覆盖SYSTEM关联真人／其他动作／其他资源／跨部门、HUMAN无账号／伪作系统动作、事实与审计错配、历史修改／删除、日期下限、旧安排推进和重复推进。保持旧真人、外部绑定、冻结材料约束。
- [ ] **Step 6：证明启动补扫而非手工调用。** 真实DB持久化安排后关闭服务实例，新建实例执行Nest启动钩子；验证补跑、重复启动、两个实例、部分失败后再扫描及最新日期变更。服务测试可注入确定时钟，不能将此结果冒充浏览器真实日期操作。手工时间轴记录与其他来源日程不受更改影响。
- [ ] **Step 7：聚焦测试、提交与独立审查。** 跑cases／customers及直接access-control／materials身份路径Jest；数据库通过既有`pnpm test:e2e`运行新增数据库／迁移文件，workers=1、不额外重试。报告DTO、文件、实际命令／退出状态和风险；独立6 Sol核对迁移、授权、系统身份、锁／幂等／回滚，finding关闭后才交Task 2，不让Reviewer默认复跑全量测试。

### Task 2：正式页面／类型同步与真实浏览器（6 Luna）

**Files:**

- Create: `frontend/src/modules/cases/CaseHearingPanel.vue`及组件spec、`tests/e2e/case-hearing.spec.ts`。
- Modify: `frontend/src/api/cases.ts`、`client-cases.ts`、`organization.ts`及直接spec；`frontend/src/modules/cases/CaseDetailPage.vue`、`LawyerCaseDetailPage.vue`及相关组件spec；`frontend/src/app/AppShell.vue`、`AppShell.spec.ts`及直接阶段／路由fixture。

**Interfaces:** 严格消费Task 1固定DTO、正常安排及内部纠错端点；不改后端、迁移、权限含义或阶段门槛。内部和律师复用共享日期表单；纠错入口仅按当前服务端能力显示，隐藏不是授权。

- [ ] **Step 1：先同步并早测Action／阶段契约。** 更新严格组织解码器、人员／角色页、案件阶段及计数fixture；运行`pnpm --filter @dev-cor/frontend test src/api/organization.spec.ts src/modules/organization/PeopleAccessPage.spec.ts src/modules/organization/RoleTemplateEditor.spec.ts src/modules/organization/RoleTemplatePanel.spec.ts`。不以any、开放索引、删断言或接受未知Action绕过。
- [ ] **Step 2：页面行为RED→实现。** 覆盖真实过去日期、下限、保存前完整影响提示、清除影响、纠错原因、加载／成功／稳定错误。已自动推进后的普通修改冲突应读最新数据并引导受控纠错；未知POST保留原键与请求，原键重放明确裁决，GET不能替代本次成功判定。完成后读当前案件，不把旧回执阶段当最新状态；切案／迟到响应不得污染新案。
- [ ] **Step 3：共享导航与历史展示。** 待判决作为单一侧栏阶段节点；不增加页面重复筛选条。“待判决”不显示为法院已判决；时间轴区分原安排、系统推进和真人纠错，业务日期与实际录入／执行时点分开。律师不显示异常纠错按钮，客户只增加阶段识别。
- [ ] **Step 4：真实浏览器主链。** 正式角色页授权纠错→运营／律师真实密码登录→从正常API来源办理到正式立案→登记合规已到期日期→后端自动补跑→刷新／重登读取待判决→有权运营填写原因改为未来或未定→刷新保持待开庭及旧历史→再录已到期合规日期→一次新的自动推进。另一案件覆盖更正已到期日期保持待判决；无权人员、其他企业／律师不可办理。前序实际业务日期须合法按序录入，不能改库、预置待判决或用Bearer冒充浏览器验收。
- [ ] **Step 5：聚焦测试与简报。** 运行cases／client-cases API及cases组件Vitest、受影响AppShell／路由测试和新浏览器文件；自审后提交并报告，不另开普通Task Reviewer。发现公共契约、数据库、身份／权限或并发风险，停止扩大修改并交主Agent裁决。

### Task 3：集成终审、稳定候选与正式门禁（主Agent＋独立6 Sol）

- [ ] 核对报告、实际累计diff和Spec覆盖；修复需要原高风险Reviewer确认，新增实质风险补审。实施前后不重复确认已批准方案，不提前将CA-007标完成。
- [ ] 所有Task集成后同步实际契约，固定干净候选commit／tree；独立6 Sol Final Review覆盖跨Task状态与时间、真实系统审计、动态权限、回执和历史投影，未关闭finding归零后才运行正式门禁。
- [ ] 固定候选运行完整`pnpm verify`，不额外紧邻重复其已包含的相同单元／快速静态检查。共享审计影响既有身份路径，运行`pnpm test:e2e:full --workers=1`及其中新的迁移专项；受控runner和隔离测试库保护保持，不加重试或弱化断言。没有case scope，不编造`verify:slice:case`。
- [ ] 完整原始日志、真实退出状态、HTML及Review留在`.local/case-hearing/`；正式候选、实际结果及失败复跑原因只记入现有VALIDATION。候选期间停止代码、测试和状态文档并行修改。
- [ ] 全部通过后才更新路线图完成态和恢复摘要；核对累计收口diff，解释漂移后标准context记录及严格检查。只有符合现有非执行性收口条件时复用业务证据，不因新文档tree机械重复全量门禁。
- [ ] 本计划只交付CA-007；CA-008接入真实判决时补后续事实阻断校验，不在本计划预建判决／上诉／执行或后续事实更正。推送／合并继续按当时明确授权执行。
