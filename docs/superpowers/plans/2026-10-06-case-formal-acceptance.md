# CORE-CA-006 正式立案登记实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. 模型与独立审查按项目协作路由，高风险Task先审查再集成，普通Task自审与聚焦测试后交接。

**Goal:** 有权运营或真实承办律师登记正式立案，前端、API与PostgreSQL原子进入待开庭，真实材料可后补。

**Architecture:** 复用cases Command、当前账号与承办范围、案锁／CAS、审计／回执和materials私有文件能力。受理事实及冻结版本独立留存，不改旧事实；客户端只延续已有企业投影。模块Spec的CA-006契约及AC-CA-015是验收依据，不在本计划重复维护完成台账。

**Tech Stack:** 既定NestJS／Prisma／PostgreSQL、Vue／Element Plus、Jest／Vitest／Playwright；不新增依赖。

## Global Constraints

- 分支`codex/core-ca-006-formal-acceptance`，起点`7cd6525a77e04b52f5352c9702f2392e69b46ac0`；该领取记录已按授权同步main。
- 仅`WAITING_FORMAL_ACCEPTANCE → WAITING_HEARING`；展示名“待正式立案→待开庭”，动作“登记正式立案”。只必填真实日期及案号，不虚构法院、支付或开庭事实。
- 初始评估Level 2：只增加正常业务节点与非破坏迁移，复用授权／承办／事务机制；若实际需要改变共享机制或历史含义，先升级给主Agent再实施。
- 每个新PowerShell进程先点加载Use-ProjectRuntime并核对锁定版本；数据库仅backend/.env.test的15433独立测试库。不得打印凭据、reset开发库或删除卷。
- 一个checkout一个写入者；本轮Task串行交接，数据库清理／迁移／故障注入不并行。

## 稳定接口

```ts
type RegisterCaseAcceptanceInput = {
  expectedVersion: number;
  idempotencyKey: string;
  acceptedAt: string; // YYYY-MM-DD
  courtCaseNo: string;
  acceptanceNoticeContentVersionIds?: string[];
  paymentListContentVersionIds?: string[];
  serviceDocumentContentVersionIds?: string[];
};
type RegisterCaseAcceptanceResult = {
  id: string;
  stage: 'WAITING_HEARING';
  version: number;
  acceptedAt: string;
  courtCaseNo: string;
  recordedAt: string;
};
```

POST`/api/v1/cases/:id/acceptance-register`及`/api/v1/lawyer/cases/:id/acceptance-register`返回201。详情增加`canRegisterAcceptance`、`canUploadAcceptanceMaterials`、可空`acceptance`及三个按类别分组的可读取受理材料集合；内部操作者ID不得漏到律师／客户投影。最终DTO由Task 1冻结交接，Task 2只做类型同步，不改公共语义。

### Task 1：后端与数据库闭环（6 Sol，高风险Task）

**Files:**

- Create: `backend/src/modules/cases/case-acceptance.dto.ts`、`case-acceptance.service.ts`及直接spec。
- Modify: cases模块／内部与律师Controller、读取DTO／Query、client阶段白名单；Prisma schema、新增前向migration、`scripts/prisma-model-owners.mjs`；现有Action目录及materials公开能力／必要数据库守卫。
- Create: `tests/e2e/case-acceptance-database.spec.ts`、`case-acceptance-migration.spec.ts`与`tests/support/case-acceptance-database.mjs`、必要迁移helper。

**Interfaces:** 产生上面的两POST及详情契约、WAITING_HEARING、三个材料类别／purpose、Action`case.acceptance.register`；复用CaseFilingService、currentLawyerBindingId与MaterialService既有模式。

- [ ] 先写正常／无材料、真实律师、拒绝分支、重放／并发／回滚测试并取得真实RED，不能以编译失败冒充行为RED。
- [ ] 新增CaseAcceptance、CaseAcceptanceVersion、CaseAcceptanceReceipt及严格关系／不可改删／阶段守卫；enum与使用enum的事实分前向迁移，不修改72份已执行链。
- [ ] 实现当前授权先于重放、原事实与原回执保留，精确版本冻结，副作用原子回滚；待开庭补传只走既有材料完成事务，不新建平行业务命令。
- [ ] 开发期先运行权限目录契约与直接cases／materials Jest；迁移先在测试库随机临时schema验证空链、上一支持72份旧数据保留、SQL负向、各份失败原子和向前重试，再部署独立正式测试schema。
- [ ] 跑真实数据库定向测试并保存命令、退出状态与日志；提交仅Task允许文件，报告最终DTO、文件清单、结果及风险。
- [ ] 独立6 Sol只读Task Review及finding关闭后才交给Task 2；不默认复跑Worker聚焦测试。

### Task 2：正式运营／律师页面与真实浏览器主链（6 Luna）

**Files:**

- Create: `frontend/src/modules/cases/CaseAcceptancePanel.vue`及组件spec、`tests/e2e/case-acceptance.spec.ts`。
- Modify: `frontend/src/api/cases.ts`／直接spec、client-cases阶段解码、materials类别类型／直接spec、权限Action类型／契约spec；CaseDetailPage／LawyerCaseDetailPage、列表／侧栏阶段来源及相关fixture。

**Interfaces:** 严格复用Task 1正式DTO及MaterialService上传／版本下载；不修改后端、schema、权限语义或其他业务节点。

- [ ] 写表单必填、可选材料、加载／成功／错误、同一未知请求重试和切换上下文取消的组件反例；确认新行为RED再实现。
- [ ] 接入两正式身份的共享表单与详情记录，新增待开庭单一侧栏节点／计数／筛选，不增加重复阶段条。材料后补与受理冻结版本有区分，不声称付款或开庭安排已实现。
- [ ] 严格解码器与已有fixtures同步；早测Action目录、人员／角色页兼容，不以any、索引签名或放宽断言绕过。
- [ ] 用正常API来源准备案件，浏览器真实密码登录运营→登记→刷新／重登→真实律师登记另一承办案→读取真实文件字节→待开庭补传且不推进；客户登录只读其原允许投影，不用Bearer或预置目标阶段冒充主链。
- [ ] 跑直接Vitest／组件与浏览器定向用例、自审、提交并简报；遇到契约／安全／数据库风险立即停止扩大修改，交主Agent裁决。

### Task 3：集成、独立Final Review与正式门禁（主Agent）

- [ ] 核对Task报告／累计diff及验收覆盖，集中修复；高风险finding须原Reviewer关闭。同步实际业务契约，固定干净候选后独立6 Sol Final Review。
- [ ] 无case scope，按Level 2在固定候选逐项运行适用定向Jest／Vitest、`pnpm check:fast`、受影响格式、`pnpm spec:check`、双端prepared构建、受影响真实数据库／Chromium及迁移专项；匹配0项失败。若升级Level 3，则使用完整`pnpm verify`及风险数据库验收，不用聚焦替代。
- [ ] 正式检查期间候选稳定，不并行写状态。原始日志保存在`.local/case-acceptance/`，既有VALIDATION绑定实际commit／tree与结果。
- [ ] 通过后只补路线图完成态、验证摘要、恢复摘要与已解释快照，执行文档专项；不把模块Spec当“待门禁→通过”动态台账，不因非执行性收口机械重跑完整验收。
- [ ] 本轮只开发CA-006；CA-007仍Next。新的业务合并／推送按当时明确授权执行，不部署或操作生产库。
