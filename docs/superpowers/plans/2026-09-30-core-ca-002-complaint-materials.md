# CORE-CA-002｜起诉材料实施计划

依据：[案件Spec](../../spec/v0.1/modules/cases.md)、[材料契约](../specs/2026-09-21-core-flow-field-material-contract.md)、[决定](../../spec/v0.1/DECISIONS.md)。本计划只覆盖`WAITING_COMPLAINT`（待写诉状）到诉状待确认的一次确认提交，不替代后续CA-003确认、CA-004邮寄或批量上传。

## 已确认的边界

- 上传与确认推进分离：复用现有私有材料上传，起诉状`COMPLAINT`与授权材料`AUTHORIZATION`各1～10份，单文件不超过50MB，后端按真实内容及允许格式PDF/DOC/DOCX校验；上传后刷新仍可读取，上传本身不推进。
- 确认提交时，标的额选择`KNOWN`并填写非负精确金额，或选择`PENDING`并填写原因；不得以0冒充未知。后端同事务重查内部身份、`case.complaint.submit`授权及案件范围、当前阶段、`expectedVersion`、两个类别的有效内容版本，然后冻结所选精确版本、推进、记服务端时间／操作者、审计和幂等回执。重放只返回原结果，撤权后不重放。
- 案件列表、详情及侧栏只增加本切片真实阶段；只读者能查看获准附件但不能提交，客户与公证处不因材料入口获得内部案件权限。当前CA-001匹配能力保持不变。
- 本切片扩展共享材料服务的CASE归属及授权路径，触及共享访问控制边界，整体按Level 3；schema／权限／并发／材料Task按项目协作路由由Sol独立审查。稳定候选须完成完整`pnpm verify`和真实PostgreSQL／Chromium验收，不以模拟上传替代。

## Task 1：后端材料、迁移与Command

修改现有`backend/prisma/schema.prisma`及新增前向迁移；在`backend/src/modules/materials/`增加CASE归属、两种类别及真实MIME验证；在`backend/src/modules/cases/`增加提交DTO/Service/Controller、读取投影和测试；同步`backend/src/access-control/`权限目录及默认Grant。避免修改CA-001旧迁移和旧回执。

先写并运行聚焦RED：合法提交、他人/跨部门/外部身份拒绝、缺文件或金额错误、已删除版本、旧版本、错误状态、同键重放与异参冲突、并发竞争、审计或回执失败回滚、授权撤销下一请求失效、迁移空库和上一支持schema。随后最小实现、聚焦GREEN与后端typecheck。

## Task 2：前端真实入口

只修改`frontend/src/api/cases.ts`、`frontend/src/api/materials.ts`、案件详情/列表和直接测试，以及侧栏阶段映射所需文件。列表与详情显示“诉状待确认”；有权人先上传起诉状和授权材料，再明确选择金额状态并确认提交；上传与提交分别显示加载、错误和成功；超时保留输入和幂等键，状态冲突刷新最新事实；只读者只下载获准文件。遵守现有Demo对齐视觉和快速上手规则。

先补API解码、上传校验、表单交互RED，随后实现并运行聚焦前端测试／typecheck。不得新增CA-003按钮或客户端办理入口。

## Task 3：集成验收与收口

独立审查高风险后端Task和集成候选，关闭finding。开发期运行`pnpm check:fast`及受影响单元／契约；稳定候选运行完整`pnpm verify`、迁移专项、隔离测试库真实数据库及Chromium流程：运营登录、CA-001匹配、上传两类真实文件、确认、只读账号下载、刷新重登仍可见。记录真实commit/tree及证据后才更新完成态并推进Current／Next。任何未验证项明确保留未完成。
