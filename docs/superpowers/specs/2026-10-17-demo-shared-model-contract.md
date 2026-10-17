# 结算与证物共享模型首小合同

此候选供两个领域 Task 编译和接线，不代表完整产品验收。基线为 `e48760d24ea7d93a54c52f0b98ca739488318dc8`；业务范围沿用主控冻结的 2026-10-16 Demo 完整对齐合同。共享文件由结算 Owner 停写后交主控代提交，领域 Task 只消费固定提交。

## 证物模型

| 模型                       | 固定字段与约束                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EvidenceGroupVersion`     | UUID `id`；`departmentId`；`sourceKind: CASE / NOTARY_MATTER`；`sourceId`；可空 `caseId/sourceNotaryMatterId/sourceInitializedAt`；`version=1`；`updatedAt`。部门＋类型＋源 ID 唯一。来源身份不改；公证转案只可补上与该公证源匹配的真实案件。                                                                                                                                              |
| `EvidenceItem`             | UUID `id`，同组 `groupId`，上述 typed source 和部门；可空 `displayCode/name/kind/collectedOn/provenance/shelfLocation/keeperUserId/remark/removedAt`；状态 `UNDELIVERED / IN_STOCK / MAILED_TO_LAWYER / DESTROYED`，默认 `UNDELIVERED`；`version=1`；必填 `createdByUserId/updatedByUserId` 和创建／更新时刻。创建／更新人关联真实用户，允许原公证处出证操作者；库管人使用同部门成员关联。 |
| `EvidencePaperCertificate` | 每本独立 UUID、`groupId`、typed source、部门、可空 `caseId/sourceNotaryMatterId/sourceCertificateId/number/issuedOn/officeName/pages/removedAt`；`contentMaterialId + contentVersionId` 成对可空；状态 `NOT_ISSUED / MAILED_TO_LAWYER`，默认 `NOT_ISSUED`；版本与审计字段同实物。不按公证事项唯一限制本数。                                                                                |
| `EvidenceAuditEvent`       | UUID、部门、真实 `actorUserId`、`operation`、可空 `internalActorUserId/notaryOfficeAccountBindingId`、可空 `groupId/itemId/paperCertificateId/beforeSnapshot/afterSnapshot`、创建时间。审计行不可更新或删除。                                                                                                                                                                              |
| `EvidenceCommandReceipt`   | UUID、部门、同部门 `actorUserId`、`command: EDIT_GROUP / BULK_STATUS`、非空 `idempotencyKey`、64 位十六进制 `requestFingerprint`、`resultSnapshot`、创建时间。部门＋操作者＋key 跨 command 唯一，回执不可更新或删除。                                                                                                                                                                      |

组与子行的 typed source 用复合外键对应。SQL 校验实物、纸本与真实案件／公证源处于同部门，转案关联必须指向该公证源。每次更新的 `version` 必须恰加 1，稳定 ID 与创建身份不可替换。状态 `DESTROYED` 不删除文件或证明物理销毁。

组与实物／纸本的 `caseId` 必须一致，包括双方都是 null 的情形。Prisma 定义组案件复合唯一键和两类子行的案件关联；SQL 使用可延迟的复合外键及 null-safe 约束触发器，在事务结束时检查组和全部子行（含已移除历史）。组从 null 补为真实公证转案时，必须在同一事务同步全部子行并分别递增版本；只改组、只改子行、错案或已有案件改绑均拒绝。

有 `sourceNotaryMatterId` 的案件一律使用原 `NOTARY_MATTER` 组，数据库拒绝平行 CASE 来源。组的 `sourceInitializedAt` 一旦非空不可清除或替换，移除全部件不影响组入口。内部编辑／批量审计填写 `internalActorUserId=actorUserId` 且公证处绑定为 null；真实出证初始化／历史转换填写 `notaryOfficeAccountBindingId`，内部身份为 null，绑定必须与该组实际 NotaryCertificate 的原出证人及部门一致。证物 Owner 的公开初始化函数只供受信出证事务调用，不注册 HTTP 事实写入口，不要求出证账号取得内部 evidence Grant。

纸本文件必须为同部门、同案件或同公证源的 `NOTARY_CERTIFICATE` 材料。`contentMaterialId + contentVersionId` 指向准确版本；已有非空版本不可替换。来源公证书使用 `sourceCertificateId + sourceNotaryMatterId + departmentId` 复合外键。已有准确文件引用继续服从材料模块的版本、可用性与读取授权。

证物 Owner 必须在旧成功回执读取前核对当前授权和实际来源范围；同 key 比较 command 与 fingerprint，不同动作或请求体返回冲突。保存组、批量状态、审计与回执在同一事务完成，回执只在成功结果确定后插入。共享 schema 不实现这些服务流程，也不替代服务层测试。

初始空表与全删后入口由证物 Owner 通过稳定 group 或 typed source 路由接入真实 Case／NotaryMatter 来源。GET 不写演示种子、不恢复已移除项，不依赖虚构的首 item。

1300 准备一次历史真实来源转换：只从实际 `NotaryCertificate + NotaryMatterEvidence + Case + Lead/NotaryOffice` 生成新组、一件未交付实物、一本未出纸质证台账及 `IMPORT_NOTARY_SOURCE` 审计。名称取实际店铺，日期取实际采集日及出证日，未知证物编号／货架／保管人／页数保持 null；纸本公证书号取实际 certificate_no，缺失才 null。原出证审计必须恰一份，完整 `NOTARY_CERTIFICATE` 冻结文件集合必须为 1–10 份；不完整时整段事务失败，不能拿第一份代替全部。迁移只写新表，原事实、审计、文件和引用保持原样。两份新迁移均显式事务提交，当前仅准备代码，不执行迁移。

`electronicFiles:[{materialId,contentVersionId,filename}]` 由原出证审计的准确冻结引用完整读取，排除披露资料。纸本 singular 文件字段仅供明确单文件引用，历史转换保持 null，不取首份。新来源初始化审计使用 `INITIALIZE_NOTARY_SOURCE`，应保存同样完整来源集合和原出证身份；初始化标记与子行、审计在同一事务完成。

## 权限和模块依赖

新目录动作：`evidence.read/edit/bulk-status/export`；`settlement.read/terms.update/launch/bill.create/bill.cancel`；`fee.read/create/update/launch/delete`。对应 Prisma、后端动作映射、内部权限目录和前端 organization 严格枚举已同步。本候选只登记 `DEPARTMENT` 范围，不写默认 Grant。前端同时补齐基线后端已存在但前端遗漏的三个执行资料更正枚举，不改变其原有三种范围。

模型归属 registry：六个结算／费用模型归 `settlements`；五个证物模型归 `evidence`。本首小候选不包含 AppModule、router/menu 或未稳定领域模块；这些接线由唯一共享 Owner 在领域接口固定后加入。

结算发起、账单和费用批量回执的 `actorUserId` 同时关联真实 `UserAccount` 和该部门的 `DepartmentMembership`，均不可空；手工费用同样必须有这两种关联。自动来源费用的操作人和幂等键保持 null，不把公证处来源操作者填成内部金融操作人。Prisma 关系及 SQL 外键同步，不以应用层校验代替关系完整性。

## 结算金额精度与前向边界

结算和费用请求金额沿用最多 16 位整数、2 位小数。新增金额列为 `Decimal(30,2)`，能容纳整数元取整后的进位、半风险的两项相加与账单合计。律师比例接受 0–100、最多 16 位小数，列为 `Decimal(20,16)`，不静默压成两位比例小数。计算使用独立 36 位 Decimal；只有 Demo 指定的自动值与手调显示点取整元，发起与账单累计保留分。严格输入边界仍由领域 DTO 和 service 承担。

前向文件身份是 `20261016120000_settlement_demo_alignment/migration.sql` 与 `20261016130000_evidence_demo_alignment/migration.sql` 及各自 raw SHA256。前置 0950 由原 S Owner 独占，ordinal 由主控统一核算，不改旧 SQL。两文件新增 permission enum 值后仅登记值，不在同一迁移消费新 permission 值或写 Grant；各自新建的业务 enum 可用于同文件新表。

实际验证限于 schema validate／Client generate、后端类型、权限与金额纯测试、前端纯测试、相关 Lint／格式。迁移链、SQL trigger、真实部门越权、事务竞争、恢复与浏览器行为等待主控安排固定候选实跑；不能把这些静态结果称为已部署或产品完整验收。
