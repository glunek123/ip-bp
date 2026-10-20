# CORE-LD-008｜线索批量不取证归档（UXQ-03-B）

用户2026-10-20确认开发本片代码、纯测试及独立复审（Sentinel_f2e2d1c542e08191bc827bc45a0cbfe2）。仅把已批准CORE-LD-005单条“不取证”归档规则用于明确选中的1～20条线索；不包含删除、撤销、重开、案件归档、客户代审、新权限或真实运行。

## 既有规则和原子语义

- 当前INTERNAL逐项具备lead.evidence.decide原SELF／TEAM／DEPARTMENT范围。每条必须仍为WAITING_EVIDENCE_DECISION，activeReviewDecisionId精确指向原客户有效INFRINGEMENT决定，expectedVersion匹配；不以状态、列表可读或全局目录代替授权。
- 每项原因沿单条reason.trim()及Unicode码点1～5000；单条的客户、版本、来源、操作者实名快照、原审核决定、leadEvidenceDecision、审计和evidence_decide命令回执都保留。每条成功仅ARCHIVED及version+1，不产生公证／费用／文件事实。
- 一个Serializable事务覆盖全部项、必要单条事实与批次回执。按规范化UUID排序取得行锁，响应按原请求顺序；不逐项调用会各自提交的公开单条API。任一非法／撤权／旧版／来源不符或必要写入失败整批回滚，不跳过、不拆批、不部分成功。
- 当前身份及每条原保存对象的真实范围重验先于原批次成功回执；同key同规范化有序请求返回首次真实结果，无重复事实／审计。原成功可在合法后续状态重放；无回执的新请求才核初始状态／版本。异参／增删／顺序不同的同key冲突，错误actor／跨部门不泄漏回执。结果不明只显式原body／key核实，不自动重发或换key。
- 单条decideEvidence及批推／CSV行为不改；允许仅抽取事务内共用执行步骤，原单条直接回归须覆盖。批次专用不可变回执可沿既有LeadBatchPushReceipt模式新增，避免通用批处理框架；为满足现有事实守卫，逐项原typed回执仍按同事务真实事实关联保存，不弱化旧SQL。

## 冻结HTTP与前端接口

- POST /api/v1/leads/batch-no-evidence，正常INTERNAL认证／CSRF，Idempotency-Key必需且沿单条校验，成功201。body仅{items:[{leadId,expectedVersion,reason}]}；1～20，UUID身份大小写去重，expectedVersion为1..2147483646，给成功+1保留INTEGER空间；拒空、重复、超限、result/status/actor/department等异锚或未知字段。
- response仅{items:LeadEvidenceDecisionResult[]}，每项复用原单条完整结果：id/leadId/status=ARCHIVED/version/result=NO_EVIDENCE/reason/decidedByDisplayName/decidedAt/archiveType=NO_EVIDENCE/archivedAt；条数及顺序精确对应请求，无伪造成功、部分结果或额外ID。
- 新frontend/src/api/lead-no-evidence-batch.ts/.spec.ts，导出LeadNoEvidenceBatchInput、LeadNoEvidenceBatchResult和decideLeadNoEvidenceBatch(input, options?:RequestOptions)。key沿RequestOptions.headers传入，原有序body／文本与原key快照；严格decoder按真实DTO，POST禁自动业务／CSRF重试，不写共享http.ts或既有leads.ts。
- 原列表使用当前明确选择，打开时逐项fresh getLead核真实capabilities.evidenceDecide、版本及原审核状态；非法项明确指出且整批不可提交。展示业务可读编号／名称、每项原因及归档后果；不从全局catalog、职级或read推写权限。
- 批次表单／未知恢复与原单条、批推、CSV入口互斥；提交前持久化原请求，双击互斥。取消／换对象／身份／授权revision／路由变化使旧异步失效；未知时保留原body/key，不能新建批次绕过。仅真实同上下文成功才清待核对记录并刷新原列表筛选／分页，不触发逐条保存的假批次。
- 原列表选择、查询／分页、单项办理、批推和CSV未知恢复保持。不给列表增加通用批任务中心；不自动选择全部或归档未确认线索。

## 单一作者和验证

- 后端唯一作者：原case-list-csv-export-backend目录，branch codex/lead-no-evidence-batch-backend，base7bef339f。新lead-no-evidence-batch.dto／response.dto／controller及直接spec，lead.service.ts及其直接／evidence-decision／batch-no-evidence直接spec、lead.module.ts；必要core-ld-openapi.spec.ts。schema.prisma／scripts/prisma-model-owners.mjs只本批回执，唯一新迁移20261020100000_lead_no_evidence_batch；旧169迁移和运行helper不改。先冻结DTO／公开签名的小清单供前端，不以WIP假通过。
- 前端唯一作者：原case-list-csv-export-frontend目录，branch codex/lead-no-evidence-batch-frontend，base7bef339f。新API两文件、LeadNoEvidenceBatchPanel.vue/.spec.ts、lead-no-evidence-batch-recovery.ts/.spec.ts、既有LeadListPage.vue/.spec.ts。不写后端、schema、leads.ts/http.ts、shared Drawer、公证或旧CL页面脚本。
- 主控独占正式文档、精确Git与最终组合；原独立Reviewer保持未参与实现角色，优先gpt-6.1-sol，检查事务／权限／幂等／不可变历史与跨端累计，不逐普通任务增设Reviewer。
- 仅直接fake-DB／DTO／HTTP契约（进程内mock）、Vitest组件／状态／API、prepared类型、Lint／格式／架构／Spec。Prisma仅validate／generate；新170只编写，不执行。禁止fullverify／NT006、capture、Docker／DB／真实HTTP／登录／页面、Grant、reset、服务或push。
- 同时获批的169新隔离数据库由原Runner在独立case-list-csv-export-acceptance目录固定7bef339f执行；本批作者／新170绝不进入该运行目录，不扩大其一次迁移额度。已有R2恢复／v5资格证据复用，不重采。
