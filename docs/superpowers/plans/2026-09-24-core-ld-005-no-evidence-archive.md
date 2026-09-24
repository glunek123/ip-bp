# CORE-LD-005 运营不取证归档实施计划

> 本计划执行已批准的[核心主线设计](../specs/2026-09-21-core-business-mainline-roadmap-design.md)与[字段契约](../specs/2026-09-21-core-flow-field-material-contract.md)，不另立业务规则。采用项目三级门禁与多 Agent 风险路由；勾选只反映实施进度，验证结论以 VALIDATION 为准。

**目标：** 运营在客户确认侵权后的待确认线索上填写不取证原因，原子归档并让双方按授权回看决定与历史。

**边界：** 仅 `WAITING_EVIDENCE_DECISION → ARCHIVED`；不实现取证、公证移交、批量、其他归档撤回。请求包含 `result=NO_EVIDENCE`、必填原因、`expectedVersion`、`Idempotency-Key`。权限为内部 `lead.evidence.decide`，仍须覆盖目标线索。

**文件与任务：**

- [x] 后端风险任务：在 `backend/prisma/schema.prisma` 和新前向迁移中追加 Action 与不可变运营不取证决定事实；在 `backend/src/modules/leads/` 及现有授权目录增加 DTO、Command、读模型和客户端安全投影。先写聚焦失败测试，再实现；验证授权、状态、版本、幂等、并发、回滚、历史及跨企业读取。新 Action 的迁移与 Grant 初始化同序可执行，旧迁移不改。
- [x] 前端普通任务：在 `frontend/src/api/leads.ts`、`frontend/src/api/client-leads.ts` 和运营／客户端详情页增加契约、就地表单、后果说明、加载与稳定错误、已处理结果回看；先写相关 API／组件失败测试，再接线。保留输入，409 不清空原因。
- [x] 集成：运行聚焦测试、`pnpm check:fast`，检查现有审核／撤回路径不回归；高风险任务独立审查及集成候选 Final Review 后固定候选。
- [x] 正式验证：按三级规则在独立测试库运行迁移空库和上一支持 Schema 升级、真实数据库 API 反例、运营与企业客户双账号浏览器链（刷新后仍归档）。同步 Spec／状态／VALIDATION；未通过前不标记完成或推进 Current。

**不变量：** 后端每次重查真实内部身份、Grant、目标范围、当前状态和版本；同键同请求返回原回执，同键异参冲突；审计／决定／回执失败整事务回滚；不可覆盖客户原审核决定；客户端只能按企业绑定读取，不泄漏内部字段。
