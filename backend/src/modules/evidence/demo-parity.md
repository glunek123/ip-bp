# 证物 Demo 对齐矩阵与共享微合同

基线：`e48760d24ea7d93a54c52f0b98ca739488318dc8`。行为源：`demo/app.js` 与 `demo/index.html`（对齐合同所列 raw SHA）。本文件是证物 Owner 给共享 schema／注册 Owner 的精确接线请求；不代表迁移或真实数据库已执行。

| 控件／字段                   | Demo 函数／位置                                               | 正式输入与结果                                                                                                                      | 直接验证                                 |
| ---------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 四个状态 pill、全部          | `renderEvidence` 10923–10992                                  | `status` 可单选；计数叠加其他筛选，空台账保持空                                                                                     | 状态筛选与计数同源                       |
| 案件进展多选、清除、分项计数 | `evOkStage`, `evStageCountOf` 3722–3787                       | `stages[]`；分项计数按规范化案件 ID 去重，状态／日期／律师共同约束                                                                  | 公证转案来源也能命中阶段；多件只计一案   |
| 开庭与结案时间区间／清除     | `evDateInRange`, `applyEvDateFilter` 3740–3755、11090–11119   | 四个 `YYYY-MM-DD` 端点、含边界；缺日期在设置区间时不命中；当前 SECOND_INSTANCE 只取二审日期，其他阶段只取一审日期；缺失不回退       | 边界、显式空值、双日期按当前阶段选择     |
| 办案律师搜索                 | `evOkLawyer` 3758–3766                                        | `lawyerQuery` 去空格、不区分大小写、子串匹配；来源同列表列                                                                          | 混合大小写和空值                         |
| 11 列表头                    | `index.html` 2952                                             | 选择、操作、店铺、案件进展、律师、公证书编号／纸本状态、证物编号／货架／状态、备注；多本纸本不能压成首本，行提供明确书 ID／多本提示 | 列值与详情来源一致                       |
| 行查看                       | `viewCaseEvidence` 12000–12094                                | 按稳定证物 ID 解析规范化案件；展示平台、店铺、案号、阶段、律师、备注、同案全部证物和全部纸本记录；无件时保留真实空态                | 跨挂载键、两本、空集合                   |
| 行勾选、全选／反选           | `toggleEvSel`, `toggleAllEv`, `syncEvSelUI` 10993–11036       | 客户端 `Set<UUID>`；全选只作用当前匹配集，切筛选保留既有选择，删除后清理失效 ID                                                     | A 筛选选中后切 B；全选再反选             |
| 导出清单                     | `exportSelectedEvidenceCSV` 11037–11054                       | 未选提示；仅所选稳定 ID，服务端再次校验可见范围；CSV 九列按 Demo 顺序，UTF-8 BOM；多本纸本按书展开明确行，绝不默取首本              | 选中不等于当前页；越权 ID 拒绝；多本展开 |
| 批量更改状态                 | `bulkEvStatus` 11066–11088                                    | 证物四态、纸本两态，各自“不修改”；明确 `evidenceIds[]`、`paperCertificateIds[]`，预览实际对象；无变化提示，原子事务与审计           | 同案多件、两本只改所选、无变化、越权     |
| 编辑只读块、公证书状态、备注 | `editEvidenceRow` 11125–11288                                 | 规范化案件信息；纸本逐本选择；备注与不可改来源分开；按 Demo 保留空备注、空编号、空货架提交前的已有值                                | 不改纸本／只改第二本；空输入保留原值     |
| 同组多行编号、货架、状态     | `readEvRows`, `editEvidenceRow` 11181–11366                   | `expectedGroupVersion` + 全量草稿行；已有行稳定 ID，新行无 ID；整行空白跳过，局部填写允许；保存比较后无变化不写                     | 多行新增、编辑、无变化、并发版本         |
| 新增／移除／取消             | `addEvRow`, `removeEvRow` 11181–11186、11289–11350            | 本地草稿操作；取消不写；保存时移除行从当前台账隐藏并留审计；清空组后列表仍空                                                        | 取消、全删不重播种、历史仍在             |
| 自动在库／手动优先           | `syncEvRowStatus`, `markEvRowManual` 11125–11165、11325–11344 | 原状态未交付，编号和货架填齐，至少一项原本空，且本次未手动选态才自动在库；新增行两项填齐同理                                        | 补齐、手动未交付、手动其他状态           |
| 实物／纸本／电子分离         | 9449–9487、10372–10402、12000–12094                           | 证物记录、纸本记录、电子内容版本分别表达；“已销毁”只是台账状态，不删除材料或证明物理销毁                                            | 状态改变后引用文件不变                   |

## 已消费共享 schema（独占 Owner 写）

`EvidenceItem`：`id UUID` 主键；`departmentId UUID`；`caseId UUID?`；`sourceNotaryMatterId UUID?`；`sourceKind CASE|NOTARY_MATTER` 和 `sourceId UUID`（带类型的不可变来源身份）；`displayCode String?`、`name String?`、`kind String?`、`collectedOn Date?`、`provenance String?`、`shelfLocation String?`、`keeperUserId UUID?`、`status UNDELIVERED|IN_STOCK|MAILED_TO_LAWYER|DESTROYED`、`remark String?`、`version Int`、`removedAt DateTime?`、创建／更新审计字段。`caseId` 可在转案时补上，原来源不改；按 department + case／来源、状态建索引；关联必须同部门，`displayCode` 不作为 ID。

`EvidencePaperCertificate`：独立 `id UUID`，`departmentId`、`caseId?`、`sourceNotaryMatterId?`、`sourceCertificateId?`、`number String?`、`issuedOn Date?`、`officeName String?`、`pages Int?`、`contentVersionId UUID?`、`status NOT_ISSUED|MAILED_TO_LAWYER`、`version`、`removedAt?`、审计字段。不得按 matter 唯一限制纸本本数；每本单独 ID，引用准确不可变文件版本。

`EvidenceGroupVersion`：`caseId` 或 typed notary source 的组身份、`departmentId`、`version Int`，同组草稿比较使用 CAS。`EvidenceAuditEvent`：不可变 `id`、`departmentId`、`actorUserId`、`operation`、`itemId?`、`paperCertificateId?`、前后值 JSON、`createdAt`；移除和状态变化留历史。也可复用项目既有等价审计模型，但须满足上述字段与原子事务。

恢复时只读核对共享草稿：`EvidenceGroupVersion.id UUID`、`EvidenceItem.groupId UUID`、`EvidencePaperCertificate.groupId UUID` 均已具备；纸本另有 `contentMaterialId UUID?` 与 `contentVersionId UUID?` 配对引用，服务按这两个字段一起核对。输入 DTO 不允许改来源、部门、创建人或电子版本，只允许本合同所列编辑字段。模型可空字段与 DTO 的空字符串提交是两层含义：空字符串保留已有编号／货架／备注；新行缺编号或货架时存 null，不伪填系统 ID。

共享固定模型已提供 `EvidenceCommandReceipt`：`id UUID` 主键、`departmentId UUID` 非空、`actorUserId UUID` 非空、`command String(30)` 非空（`EDIT_GROUP`／`BULK_STATUS`）、`idempotencyKey String(128)` 非空、`requestFingerprint Char(64)` 非空、`resultSnapshot Json` 非空、`createdAt timestamptz` 非空；唯一键 `(departmentId,actorUserId,idempotencyKey)`，回执内核对 command。回执与业务／组版本／审计同事务写入，重复键比较操作及摘要并重新授权后重放，异操作／异参返回冲突。该模型由唯一共享 Owner 写，证物树不写 schema 或迁移。

## Action／DTO／route 请求

- Action：`evidence.read`、`evidence.edit`、`evidence.bulk-status`、`evidence.export`。只登记权限目录和严格枚举，不写 Grant。所有查询和写入在服务端先校验 actor、department、关联案件／公证源范围；批量逐 ID 校验后同事务写入。
- `GET /api/v1/evidence`: `page,pageSize,status?,stages?,hearFrom?,hearTo?,closeFrom?,closeTo?,lawyerQuery?`；`{items,total,page,pageSize,counts:{statuses,stages}}`。排序稳定：创建时间降序、ID 升序；计数基于同一个过滤口径。
- `GET /api/v1/evidence/groups` 列出真实来源（含无 item／全删组）；`GET /api/v1/evidence/groups/:groupId` 按独立组身份读取，返回 `{groupId,groupVersion,sourceKind,sourceId,sourceVersion,case,items,paperCertificates}`；纸本数组保留多本和稳定 ID。`GET /api/v1/evidence/items/:itemId/group` 仅作所选 item 的只读定位器。完整来源／空组路由以 [补充合同](source-entry-contract.md) 为准，旧 `:itemId/group` 写路由废弃。
- `GET /api/v1/evidence/matching-ids`: 与列表相同筛选（无分页），返回 `{ids: UUID[]}`，全选／反选作用于该请求时刻整个授权匹配集合，不能只选当前分页。
- `PUT /api/v1/evidence/groups/:groupId`: `{expectedGroupVersion,rows:[{id?,displayCode,shelfLocation,status,manualStatus}],remark?:string,paperCertificates?:[{id,status}]}`；完整组草稿、单事务比较与应用；空备注／空编号／空货架按 Demo 保留已有值，新空行跳过；返回组 DTO、`changed`。`Idempotency-Key` 必填。首次来源入口 `GET/PUT /api/v1/evidence/sources/:sourceKind/:sourceId/group` 独立校验 source version 与 groupVersion=0，空草稿不创建组。
- `POST /api/v1/evidence/bulk-status`: `{evidenceIds:UUID[],paperCertificateIds:UUID[],evidenceStatus?: enum,paperStatus?: enum}`；两种状态均省略为无变化；返回分别实际更改数与版本；`Idempotency-Key` 必填。
- `POST /api/v1/evidence/export`: `{evidenceIds:UUID[]}`，仅授权且仍存在的已选 ID；返回 CSV（或同字段 DTO 供客户端生成），多本纸本展开时显式 `paperCertificateId` 避免混淆。

前端 API 与 UI 使用上述业务 DTO；共享模块注册、公共 router/menu、schema 和 migration 仅共享 Owner 写。已消费共享固定提交并完成真实模型持久层实现与本域直接测试；共享注册及真实运行验收仍分开交付，当前不作数据库验收声明。
