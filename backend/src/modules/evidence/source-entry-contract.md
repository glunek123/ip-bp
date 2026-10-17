# 证物真实来源与空组入口：最小补充合同

主控2026-10-17已批准 group／typed-source 与 sourceInitializedAt 方向；现有出证 service／spec 的最小 hook 由证物 Owner 唯一写，其余共享文件所有权保持。模型与迁移仍只消费共享固定 SHA。

## 已核实的源码事实

- Demo `toEvidenceFromNotary`／`toNotaryDocFromNotary`（app.js 10372–10402）在实际出证动作中生成一条未交付证物和一条未出纸质证台账；不是列表读取时生成。
- 正式 `NotaryCertificateService.issue` 已在同一个 Serializable 事务内创建 `NotaryCertificate`、真实 `Case`、出证审计及冻结材料引用。它要求实际 `NotaryMatterEvidence`，证物模式目前只允许 `ONLINE_PURCHASE`。
- 正式一次出证可引用 1–10 个电子文件。因此纸本一本与电子文件一个不是同义关系，不能按 `.find` 或取第一份文件关联。
- 已移除最后一件后，组身份必须继续存在。只保留 `:itemId/group` 入口无法再次编辑合法空组。

## 推荐：组与件分开，来源首次写入与后续草稿保存分开

1. 保留独立 UUID `EvidenceGroupVersion.id`。规范化来源是 `NOTARY_MATTER + matterId`（所有由该公证生成的案件共用原来源），或没有公证来源的 `CASE + caseId`。不以可编辑证物编号、列表下标或未加类型的 ID 作为组身份。
2. 新出证在现有 `NotaryCertificateService.issue` 创建真实 Case 后调用证物公开 `initializeNotaryEvidence(tx, facts)`，与出证同事务提交。`facts` 仅传实际 matter/case/certificate 身份、出证操作者、真实采集日期、平台／店铺和原冻结文件版本集合。调用不要求公证处账号取得内部 evidence Grant，权限依据仍为原出证 Command；公开函数只允许同事务受信源调用，不能注册成可由 HTTP 直接传事实的接口。
3. source 初始化仅在组 `sourceInitializedAt IS NULL` 时执行一次：创建一件 `UNDELIVERED` 证物、按实际 certificate 创建纸本台账 `NOT_ISSUED`，记录来源审计，并写初始化标记。编号／货架／保管人未知保留 null；名称来自真实产品／店铺，未知保留 null；日期只用真实 `NotaryMatterEvidence.evidenceAt`；纸本编号／出证日来自实际 certificate。移除证物永不清除初始化标记，重新打开组不能复活原行。
4. 对历史已出证事项，1300 只准备一次明确的源数据转换：由实际 `NotaryCertificate + NotaryMatterEvidence + Case` 建立组和上述初始台账，来源与转换审计可追溯。它不是空列表兜底；之后任何 GET 都不写。若主控不采用 SQL 转换，可用一次明确授权的数据转换 Command；不能让日常 GET 隐式补表。当前仅准备源码，不运行迁移或转换。
5. 在原证物页增加一个“选择案件编辑证物”入口，直接打开同一个多行编辑弹窗。该来源选择器读取真实来源组，包括没有 item 和已全删的组；已有列表行“编辑”也改用 `groupId`。这是空组和首次手工登记的就地入口，无新增审批／流程页。无公证来源的 Case 首次保存时可创建组和用户实际填写的行，不能自动生成纸本或实物。

## 精确接口调整

- `GET /api/v1/evidence/groups?page=1&pageSize=20&query=` → `{items:[{groupId:UUID|null,sourceKind:'CASE'|'NOTARY_MATTER',sourceId:UUID,sourceVersion:number,groupVersion:number,caseId:UUID|null,businessNo:string,shopName:string|null,activeItemCount:number}],total,page,pageSize}`。未建立持久组时 `groupVersion=0`，GET 不创建。
- `GET /api/v1/evidence/groups/:groupId` → 原 `EvidenceGroup` DTO，加 `{sourceKind,sourceId,sourceVersion}`；组内 items 可以空，纸本仍逐本返回。
- `GET /api/v1/evidence/items/:itemId/group` 仅作为批量所选 item 的只读定位器，返回其实际组；它不是空组入口。写入统一使用明确 group 或 typed-source 路由。
- `PUT /api/v1/evidence/groups/:groupId` → 原 `SaveEvidenceGroupDto`（版本必须 ≥1）、原幂等键，原子保存组草稿。以组身份进行授权与原请求重放，移除 item 不影响组入口。
- `GET /api/v1/evidence/sources/:sourceKind/:sourceId/group` → 相同组 DTO；未持久化时 `groupId:null,groupVersion:0,items:[]`，只展示真实源投影。
- `PUT /api/v1/evidence/sources/:sourceKind/:sourceId/group` → `{expectedSourceVersion:number,expectedGroupVersion:0,rows:[原草稿行],remark?:string}`＋幂等键；事务锁定真实源、核对部门／当前源版本／权限后创建组与非空草稿行。并发已建组返回冲突，不能另建重复组。没有真实源返回404；全空新草稿返回无变化，不建空记录。
- 保持 item 列表／matching-ids／批量状态／所选导出合同。已有 `:itemId/group` 尚未上线，可移除为上述明确组路由；前端已有行从 `item.groupId` 进入。
- 电子文件响应使用 `electronicFiles:[{materialId,contentVersionId,filename}]`，逐个返回原出证审计事件冻结的 `NOTARY_CERTIFICATE` 引用，排除披露资料。现纸本 singular `contentMaterialId/contentVersionId` 可保留兼容但不得取第一份当全部。下载继续使用现有精确版本 API，材料共享 Owner 补证物来源授权投影。

## 最小共享字段与唯一所有权请求

- `EvidenceGroupVersion.sourceInitializedAt DateTime? @db.Timestamptz(3)`，只由真实源初始化事务或明确历史转换写；记录移除不改它。组已有 typed source 唯一键保持。
- 共享固定模型已采用真实 UserAccount 创建／更新人，以及 EvidenceAuditEvent 的 `internalActorUserId`／`notaryOfficeAccountBindingId` 身份分支。初始化填写真实原出证 actor 与原绑定，普通编辑填写 internalActorUserId。原 sourceActionEventId 存在不可变来源审计的 `originalAuditEventIds`，不新增 schema 字段；initializer 核对原事件的部门、actor、事项、certificateId、完整 contentVersionIds 和冻结 MaterialReference。
- 无 Nest Provider 注入的事务 helper 签名固定在 `evidence-source-contract.ts`：`initializeNotaryEvidence(tx:Prisma.TransactionClient, facts:InitializeNotaryEvidenceFacts):Promise<{groupId:string,created:boolean}>`。原出证审计与冻结引用完成后调用；facts 含真实 department/matter/case/certificate/sourceActionEventId/actor/证书号与日期/采集日期/公证处名/可空店铺平台以及全部准确 files。helper 不提交独立事务、不注册 HTTP，也不改变出证原回执。
- 持久回执已采用 command／dept／actor／key／fingerprint／resultSnapshot；唯一身份为部门＋actor＋key，回执内核对 command，异操作／异body冲突；重放前重新授权原组和原所选 IDs。
- 当前组／item／paper 的 UUID、typed source、部门复合关联及版本字段已够空组编辑，不再新增平行台账或工作流。
- 历史转换、schema/1300、catalog/AppModule/router/menu/material 仍由现共享 Owner 写。主控已锁定 `notary-certificate.service.ts/.spec.ts` 由证物 Task 唯一接第2项 hook；LeadsModule 不改。公开入口是 evidence/index，内部事务 helper 不注入 Nest Provider。
- 主控已准许证物目录实现只读来源投影；`evidence-source-read.ts` 仅查询同部门真实源和有效资料更正，不写其它域事实，也不跨私有源码路径导入。只读 GET 不创建组、不补证物、不伪造公证书。

## 材料下载共享接线的精确合同

响应固定为 `paperCertificates[].electronicFiles: Array<{materialId:string,contentVersionId:string,filename:string}>`，保留 1..10 完整原出证文件。UI 调用现有 `downloadMaterialVersion(materialId,contentVersionId)`，使用现有受保护 `GET /api/v1/materials/:materialId/versions/:contentVersionId/content`，无新 context 参数或免鉴权开关。

来源 proof：本部门 NOTARY_MATTER 组 → `sourceCertificateId` 匹配实际 NotaryCertificate → 唯一原 `notary.certificate_issued` AuditEvent（部门、事项、certificateId、真实 actor/binding）→ 原事件 contentVersionIds 全集合与精确 MaterialReference（同部门／同事项／actionEventId／NOTARY_CERTIFICATE purpose/category）→ 实际 materialId/contentVersionId。initializer 逐项验证并写不可变 EvidenceAuditEvent 的完整 electronicFiles；历史转换采用相同集合。披露资料不进入该数组。下载端仍应独立检查当前内部身份、evidence.read 部门范围、准确原引用与材料／版本生命周期，不仅凭 UI 传入的 ID 或证物审计 JSON 放行。

初始化审计保存文件历史不等于当前文件可下载；已删除／作废版本保持历史信息，protected 下载返回真实受限结果。共享材料唯一 Owner 负责该授权分支；本 Task 只消费现有下载 API。

## 针对验收

历史真实源转换后有初始未交付台账；新出证原事务生成一次；重复出证回执不重复建；移除全部后 items=[] 且 groupId／初始化标记不变；来源选择器可再次进入并新增；读列表／读空组前后写次数0；外部 Case 首次手工录入不生成纸本；两本纸本分别按 ID 改态；同一本的多电子文件全部保留准确版本；跨部门／源版本变化／重复键异操作均拒绝。
