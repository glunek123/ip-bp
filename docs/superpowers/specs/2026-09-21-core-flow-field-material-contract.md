# 核心业务字段、附件与存储契约

日期：2026-09-21

任务：CORE-FIELD-CONTRACT-001

状态：依据现有Demo反向文档、正式Spec、Decision和BR-03回件收口，并已获用户确认进入实施；列为`BLOCKED_BY`的动作不得由实施AI补猜。本文所列技术默认值是本设计固定的首期实现基线，不再留给实施AI二次选择；改变它们必须先修改本文并复核。

## 1. 权威范围与使用规则

本文是`CORE-LD-001～006`、`CORE-NT-001～006`和`CORE-CA-001～017`的字段、附件及持久化契约。它把以下既有来源合并为一处可编码输入：

- `DOMAIN.md`中的CU／LD／NT／CA／MT字段词典。
- `modules/leads.md`、`notary.md`、`cases.md`中的动作、状态和守卫。
- `TECHNICAL-DESIGN.md`的T01～T06、材料版本、下载网关、幂等、并发和审计规则。
- `DECISIONS.md`的SD-01～37，尤其SD-06／13／14／22／23／25／26／30／32～34／37。
- `BR-03-return-2026-09-16.xlsx`“案件阶段门槛”工作表中已由SD-23整体采用的16阶段最低门槛。

冲突优先级：后续明确Decision＞本文＞模块Spec＞DOMAIN字段词典＞Demo事实。本文没有关闭BQ-03／04以及GAPS中的B08／10／11／13／15／16／18／20／21或E02～04；凡动作表标注`BLOCKED_BY`，只阻断对应动作，不阻断此前可独立完成的Slice。

实施AI不得：增加未列字段作为必填、用文件名代替文件、把展示字符串当外键、把未填金额写成0、把保存当推进、让OCR／爬虫直接写业务表、为绕过阻塞项自行选择业务规则。

## 2. 数据放在哪里

### 2.1 PostgreSQL

以下内容全部存PostgreSQL：

- 客户、主体、线索、商品、公证事项、物流、案件、当事人、律师承办、阶段动作和费用等结构化字段。
- `departmentId`、责任人／团队、业务对象稳定UUID、展示业务号、外部来源标识、状态、乐观锁`version`、创建／更新时间。
- 材料逻辑身份、内容版本元数据、业务对象引用、上传草稿、删除／恢复／作废状态和审计事件。
- 幂等回执、请求指纹、动作前后状态、实际操作者、业务发生时间`occurredAt`和系统记录时间`recordedAt`。

文件二进制不进入PostgreSQL普通业务列，不使用文件名、浏览器临时URL、本地绝对路径或对象存储URL充当业务引用。

### 2.2 私有二进制存储

文件字节只通过`PrivateBlobStorage`端口保存：

```text
put(uploadDraftId, byteStream, metadata) -> opaqueStorageKey
open(opaqueStorageKey) -> byteStream
delete(opaqueStorageKey) -> void
health() -> ready | unavailable
```

- 开发／测试使用`LocalPrivateBlobStorage`，根目录由`PRIVATE_FILE_ROOT`显式配置；当前后端进程运行在宿主机，因此分别使用仓库已忽略的`.local/private-files/development`和`.local/private-files/test`目录，不虚构无法由宿主进程直接访问的Compose命名卷。未来后端容器化时才把同一配置指向容器私有命名卷；目录不得位于前端静态目录，不提交Git，也不返回给浏览器。
- 内部存储键由服务端生成，逻辑形状为`departmentId/materialId/contentVersionId`；用户文件名不参与定位。
- 生产使用`ObjectStoragePrivateBlobStorage`，provider、bucket、凭据、加密、备份恢复和安全扫描继续由E02决定。替换Adapter不改变业务表、DTO或材料引用。
- 浏览器预览／下载只调用应用层`FileAccessGateway`；每次按材料、对象范围和当前授权重新校验，不返回永久公开地址。

### 2.3 材料数据模型

| 模型                | 必须字段                                                                                                                                                                 | 规则                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UploadDraft`       | `id`、`departmentId`、`actorUserId`、预期`ownerType/ownerId`、`category`、`purpose`、`originalFilename`、`declaredMimeType`、`pendingStorageKey?`、`status`、`expiresAt` | JSON元数据先持久化；`pendingStorageKey`只是服务端孤儿清理线索；状态`OPEN/FINALIZED/EXPIRED`；只能由创建人或当前目标的获授权人员完成；切换目标后不能复用 |
| `Material`          | `id`、`departmentId`、`ownerType/ownerId`、`category`、稳定`purpose`、`currentVersionId?`、`status`、`version`                                                           | 稳定逻辑身份；purpose供后续Command按内容版本校验，不从文件名或顺序猜测；状态`ACTIVE/DELETED`；业务对象与部门使用组合外键或等价数据库约束                |
| `ContentVersion`    | `id`、`materialId`、`storageKey`、`originalFilename`、`mimeType`、`sizeBytes`、`sha256`、`uploadedBy`、`createdAt`、`derivedFromVersionId?`、`status`                    | 内容不可变；状态`AVAILABLE/DELETED/PURGED`；新版本不覆盖旧版本                                                                                          |
| `MaterialReference` | `id`、`departmentId`、`resourceType/resourceId`、`purpose`、`materialId`、`contentVersionId`、`actionEventId?`、`createdAt`                                              | 流程动作冻结精确`contentVersionId`；有有效引用的版本不得普通删除                                                                                        |

上传顺序：JSON创建草稿并持久化`purpose/originalFilename/declaredMimeType`→在模块内取得storageKey单键协调锁→写Blob前条件持久化服务端`pendingStorageKey`→`application/octet-stream`原始请求体流式写入Adapter并计算真实MIME／大小／SHA-256→以声明MIME做伪装校验→数据库事务完成带稳定purpose的`Material`和`ContentVersion`并清除pending key→草稿`FINALIZED`→释放单键锁。失败时在锁内完成补偿delete或保留pending后才释放。cleanup对锁前候选不作最终判断，取得同一锁后重新锁行核对draft仍拥有该key且无ContentVersion，才执行delete和pending CAS。本地Adapter用`sha256(storageKey)`稳定派生同根`.tmp`的不透明临时文件，`delete(storageKey)`按temp再final的顺序尝试清理两条路径，只有两者都确认不存在才允许清除pending key。PUT不重复携带purpose或文件元数据，`ContentVersion.originalFilename`来自草稿，`mimeType`保存真实检测值。写入失败不得产生可用版本；数据库提交失败或进程中断的孤立Blob由pending key驱动后台重试清理，但不得显示上传成功。该协调器只是开发/测试Local adapter的单后端进程边界，不支持多个后端进程共享同一`PRIVATE_FILE_ROOT`，不声称跨进程互斥；生产对象存储语义仍由E02 adapter负责。

生命周期固定如下：

1. `UploadDraft`创建后24小时过期；过期或数据库提交失败的Blob由后台清理任务重试删除，清理失败只告警，不把草稿变成可用材料。
2. 未被任何有效`MaterialReference`引用的材料允许有权人员软删除，进入`DELETED`后保留90天；期间可恢复，90天后仅系统管理员清除并把内容版本标为`PURGED`。
3. 已被流程动作引用的材料不能普通删除或覆盖；更正时新增`ContentVersion`，旧版本可标记作废但继续供历史动作读取。当前详情默认展示新版本，历史动作始终打开其冻结版本。
4. 同一`sha256`只用于提示本次对象内重复上传，不跨部门查重、复用或暴露存在性；即便字节相同，每个部门和业务对象仍保持自己的授权关系。
5. E02未关闭前，内部MVP只承诺受控格式、真实MIME、大小和哈希校验，不声称已完成病毒扫描、生产加密、备份或灾难恢复。
6. 每个部门内的同一owner最多保留10个`CUSTOMER_IDENTITY`或20个`LEAD_SCREENSHOT`活跃材料；finalize和restore必须在数据库事务内取得完全相同的owner／category串行锁，重新计数ACTIVE材料后再执行创建或恢复CAS，不允许删除后补上传再恢复或并发绕过。

新业务对象上传使用服务端预留身份，不允许浏览器自行生成正式业务ID：客户材料必须提交已有`customerId`；新线索第一次创建`UploadDraft(ownerType=LEAD_DRAFT)`时由服务端同时生成`reservedOwnerId`，同一操作者可在当前部门继续使用该ID创建其余截图。`CreateLeadCommand.reservedLeadId`消费该预留ID后，把材料owner原子改为`LEAD`并建立精确版本引用；未消费的`LEAD_DRAFT`及Blob按24小时过期规则清理。没有预上传截图时，创建Command由服务端直接生成线索ID。

## 3. 通用字段和校验类型

除已有代码使用更严格限制外，新字段统一采用下表；实施AI不得自行改宽或改窄。

| 类型             | DTO限制                          | PostgreSQL       | 规则                                                           |
| ---------------- | -------------------------------- | ---------------- | -------------------------------------------------------------- |
| `Id`             | UUID                             | `uuid`           | 只由服务端或受控关联选择器提供                                 |
| `BusinessNo`     | 1～100字符                       | `varchar(100)`   | 展示号，唯一但不作为技术主键；法院案号、诉调号、执行案号分别存 |
| `Name`           | trim后1～200字符                 | `varchar(200)`   | 不用名称建立跨聚合关系                                         |
| `Code`           | trim后1～100字符                 | `varchar(100)`   | 号码规范化值另存；空串转`null`                                 |
| `ShortText`      | 最多500字符                      | `varchar(500)`   | 地址可使用此类型                                               |
| `LongText`       | 最多5000字符                     | `text`           | 原因、备注、说明；空串转`null`                                 |
| `Url`            | 最多2048字符；只接受`http/https` | `varchar(2048)`  | 不自动请求或抓取                                               |
| `Phone`          | 6～30字符且含6～20位数字         | `varchar(30)`    | 沿用现有客户联系人规则                                         |
| `Email`          | 最多254字符并通过邮箱校验        | `varchar(254)`   | 存原值；比较时小写规范化                                       |
| `Count`          | 0～2147483647整数                | `integer`        | 负数、NaN、小数拒绝，不取绝对值                                |
| `Money`          | 最多16位整数、2位小数            | `numeric(18,2)`  | 人民币；非负；`KNOWN`时必填，`PENDING`时必须为空               |
| `Percent`        | 0～100，最多2位小数              | `numeric(5,2)`   | 不解析任意百分号字符串                                         |
| `BusinessDate`   | `YYYY-MM-DD`                     | `date`           | 表达业务日期，不代替操作时间                                   |
| `BusinessTime`   | ISO 8601                         | `timestamptz(3)` | 服务端统一转UTC，页面按Asia/Shanghai显示                       |
| `Version`        | 正整数                           | `integer`        | 更新及推进必须提交`expectedVersion`                            |
| `IdempotencyKey` | 1～128字符                       | `varchar(128)`   | 创建、移交、转案和阶段推进必填；同键不同请求指纹返回409        |

所有字符串拒绝仅空白。DTO拒绝未知字段。`departmentId`、操作者、责任人默认值、系统时间、状态和计算字段不得由客户端伪造。

### 3.1 首期受控字典

受控字典在数据库／代码中保存稳定Code，页面显示下表中文标签。首期表单只能提交表内Code；旧Demo自由文本只能由未来历史补录Command保存，不能混入普通创建。增加选项须先更新本文或后续Decision，再增加数据库种子／代码字典和测试，实施AI不得看到字符串就临时放行。

| 字典               | 稳定Code与页面标签                                                                                                                                                                                                                                                                                                                                                     | 联动／兼容规则                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 客户主体类型       | `ENTERPRISE`企业、`SOLE_PROPRIETOR`个体工商户、`NATURAL_PERSON`自然人、`PUBLIC_INSTITUTION`事业单位、`SOCIAL_ORGANIZATION`社会组织、`OTHER_ORGANIZATION`其他组织                                                                                                                                                                                                       | 不提供自由文本“其他”                                                                                   |
| 身份证件类型       | `BUSINESS_LICENSE`营业执照、`VERIFIED_E_BUSINESS_LICENSE`已核验电子营业执照、`NATIONAL_ID`居民身份证、`PASSPORT`护照、`OTHER_VALID_ID`其他有效身份证明、`ORGANIZATION_REGISTRATION_CERTIFICATE`组织登记证书                                                                                                                                                            | 企业／个体仅前两项；自然人仅身份证／护照／其他有效身份证明；事业单位／社会组织／其他组织仅组织登记证书 |
| 案件类型           | `CIVIL`民事、`CRIMINAL`刑事、`ADMINISTRATIVE`行政、`INVESTIGATION`调查、`NOTARIZATION`公证、`HEARING_REPRESENTATION`代开庭                                                                                                                                                                                                                                             | 直接承接Demo统一`CASE_TYPES`；首期线索创建不接受枚举外值                                               |
| 侵权类型           | `TRADEMARK`商标权、`SOFTWARE_COPYRIGHT`软件著作权、`ART_COPYRIGHT`美术作品著作权、`AUDIOVISUAL_COPYRIGHT`视听作品著作权、`TEXT_COPYRIGHT`文字作品著作权、`INVENTION_PATENT`发明专利权、`DESIGN_PATENT`外观设计专利权、`UTILITY_MODEL_PATENT`实用新型专利权、`UNFAIR_COMPETITION`不正当竞争、`NETWORK_DISSEMINATION`信息网络传播权、`PORTRAIT_RIGHT`肖像权、`OTHER`其他 | 多选去重，至少一项；数据库用关系表或数组等可查询结构保存Code，不保存顿号拼接串                         |
| 线索来源           | `ONLINE`线上、`OFFLINE`线下                                                                                                                                                                                                                                                                                                                                            | 这是侵权发现来源，不是OCR／爬虫创建渠道                                                                |
| 线上平台           | `TAOBAO`淘宝、`TMALL`天猫、`PINDUODUO`拼多多、`JD`京东、`DOUYIN`抖音、`ALIBABA_1688`1688、`XIAOHONGSHU`小红书、`KUAISHOU`快手、`XIANYU`闲鱼、`WECHAT`微信、`OTHER`其他                                                                                                                                                                                                 | 仅当`source=ONLINE`可选                                                                                |
| 线下平台／对象来源 | `MEITUAN`美团、`DIANPING`大众点评、`MAP`地图、`OTHER`其他                                                                                                                                                                                                                                                                                                              | 仅当`source=OFFLINE`可选；首期仍使用字段名`platform`，不另造第二字段                                   |
| 创建渠道           | `MANUAL`人工录入、`OCR`OCR采用、`CRAWLER`爬虫采用、`CSV`CSV采用、`HISTORICAL`历史补录                                                                                                                                                                                                                                                                                  | 当前普通创建端点只生成`MANUAL`；其他值只能由对应受控Command生成                                        |

`NATIONAL_ID`材料必须覆盖正反两面：允许一份包含两面的PDF并使用`MaterialReference.purpose=IDENTITY_FULL`，或两张图片分别使用`IDENTITY_FRONT/IDENTITY_BACK`；其他证件使用`IDENTITY_FULL`。身份证件号规范化只做trim、统一拉丁字母大小写和移除明确展示分隔符，不做模糊纠错。

现有草稿字符串的前向迁移只允许确定映射：大小写不敏感的`enterprise`→`ENTERPRISE`，`credit-code`／`CREDIT-CODE`→`BUSINESS_LICENSE`；其他旧值原样保留在迁移报告并维持`DRAFT`，由有权人员在准入前更正，迁移不得按名称或号码形状猜类型。

公证处不是硬编码枚举。`notaryOfficeId`只能从当前部门可用的`NotaryOffice(status=ACTIVE)`主数据选择；首期开发／测试种子可使用Demo的七个公证处名称，但业务关系只存UUID，停用项只保留历史引用且不能新选。法院同样使用可用`Court`主数据UUID，不保存下拉中文名称作为关系。

## 4. 文件类别和默认限制

| 类别                                                    | 允许格式                      | 单文件／单动作上限 | 首次使用Slice       | 是否推进必需                                             |
| ------------------------------------------------------- | ----------------------------- | ------------------ | ------------------- | -------------------------------------------------------- |
| `CUSTOMER_IDENTITY`                                     | PDF、JPG/JPEG、PNG            | 20MB／10个         | CORE-LD-001支撑子集 | 客户准入至少1个有效版本                                  |
| `LEAD_SCREENSHOT`                                       | JPG/JPEG、PNG、WEBP、PDF      | 20MB／20个         | CORE-LD-001         | 创建线索可选；移交时冻结本批选择版本                     |
| `NOTARY_OPENING_PHOTO`                                  | JPG/JPEG、PNG、WEBP           | 20MB／50个         | CORE-NT-002         | 至少1个                                                  |
| `NOTARY_DISCLOSURE`                                     | PDF、JPG/JPEG、PNG            | 50MB／10个         | CORE-NT-005         | `needDisclose=true`时至少1个，或填写获准的结构化披露信息 |
| `NOTARY_CERTIFICATE`                                    | PDF、JPG/JPEG、PNG            | 50MB／10个         | CORE-NT-005         | `BLOCKED_BY B10/B21`确定是否必须及多本规则               |
| `COMPLAINT`、`AUTHORIZATION`                            | PDF、DOC、DOCX                | 50MB／各10个       | CORE-CA-002         | 推进到诉状待确认前必须有获准的起诉状和授权材料           |
| `MAIL_RECEIPT`                                          | PDF、JPG/JPEG、PNG            | 20MB／10个         | CORE-CA-004／013    | 客户邮寄动作至少1个                                      |
| `FILING_EVIDENCE`                                       | PDF、DOC、DOCX、JPG/JPEG、PNG | 50MB／50个         | CORE-CA-005         | 至少1个起诉及证据材料版本集合                            |
| `FILING_SCREENSHOT`                                     | JPG/JPEG、PNG、PDF            | 20MB／10个         | CORE-CA-005         | 可选；不能代替法院、日期和起诉证据                       |
| `PAYMENT_LIST`、`ACCEPTANCE_NOTICE`、`SERVICE_DOCUMENT` | PDF、JPG/JPEG、PNG            | 50MB／各10个       | CORE-CA-006         | 受理推进只强制实际受理日期和法院案号；其余可随后补充     |
| `JUDGMENT`、`APPEAL_DOCUMENT`                           | PDF、JPG/JPEG、PNG            | 50MB／各10个       | CORE-CA-008／010    | 结果确认至少1个对应裁判文书                              |
| `EXECUTION_APPLICATION`                                 | PDF、DOC、DOCX                | 50MB／10个         | CORE-CA-011         | 至少1个                                                  |
| `EXECUTION_FILING_PROOF`、`EXECUTION_DOCUMENT`          | PDF、JPG/JPEG、PNG            | 50MB／各10个       | CORE-CA-014／015    | 申请执行推进至少1个立案材料；执行更新材料可追加          |
| `CLOSURE_DOCUMENT`、`PAYMENT_PROOF`                     | PDF、JPG/JPEG、PNG            | 50MB／各10个       | CORE-CA-016         | 结案文书至少1个；付款凭证仅随真实付款记录                |

所有格式以服务端检测的真实MIME为准，不只看扩展名；拒绝加密PDF、压缩包、可执行文件和未知格式。批量ZIP、视频和超出上表限制的专门能力不属于核心Slice，必须另立设计。

## 5. CORE-LD字段与动作契约

### 5.1 CORE-LD-001：客户最小准入支撑

沿用现有Customer字段和长度。准入Command输入：`customerId`、`expectedVersion`、`customerType`、`name`、`identityType`、`identityNumber`、`issuingCountryOrRegion?`、`identityValidFrom?`、`identityValidTo?`、`identityValidityMode(FIXED/LONG_TERM/NOT_STATED)`、`admissionContactName`、`admissionContactPhone?`、`admissionContactEmail?`、`identityDocumentContentVersionIds[1..10]`、`idempotencyKey`。

门槛：联系人姓名必填且电话／邮箱至少一项；证件类型与客户类型匹配；证件材料均属于当前客户、当前部门、状态可用；固定有效期时`identityValidTo`必填且不早于开始日；部门内同证件类型＋规范化号码唯一。成功后`profileStatus=DRAFT→ADMITTED`，冻结证件内容版本并与审计同事务。

### 5.2 CORE-LD-001：线索和商品

| 聚合    | 字段                                                    | 类型／必填                                  | 写入规则                                                                                        |
| ------- | ------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Lead    | `id`、`departmentId`、`businessNo`、`status`、`version` | 服务端                                      | 初始`WAITING_PUSH`；业务号`LD-YYYYMMDD-NNN`，用数据库并发安全序列生成                           |
| Lead    | `customerId`、`rightsHolderId`                          | Id／必填                                    | 客户必须`ADMITTED`；主体必须与客户存在当前有效关联并同部门                                      |
| Lead    | `responsibleUserId`、`teamId`                           | 服务端                                      | 从当前操作者和有效部门成员关系确定；不能由表单覆盖                                              |
| Lead    | `caseType`                                              | Code／必填                                  | 只接受3.1案件类型Code；未知值拒绝                                                               |
| Lead    | `infringementTypes`                                     | Code数组／至少1项                           | 多选独立保存，不拼接成单个`reason`字符串                                                        |
| Lead    | `source`                                                | `ONLINE/OFFLINE`／必填                      | 与创建渠道分开                                                                                  |
| Lead    | `platform`                                              | Code／必填                                  | 必须属于3.1中当前`source`的选项；`OTHER`仍是受控Code，不额外强制备注                            |
| Lead    | `foundAt`                                               | BusinessTime／必填                          | 只校验ISO时间及可表示范围；现有规则没有批准“不得晚于当前时间”，因此普通创建不得擅加未来时间限制 |
| Lead    | `shopName`                                              | Name／必填                                  | 不作为关联键                                                                                    |
| Lead    | `shopExternalId`                                        | Code／可选                                  | 空串转`null`                                                                                    |
| Lead    | `needDisclose`                                          | boolean／必填                               | 不用空值表达“否”                                                                                |
| Lead    | `remark`                                                | LongText／可选                              | 不存敏感文件正文                                                                                |
| Lead    | `creationChannel`                                       | `MANUAL/OCR/CRAWLER/CSV/HISTORICAL`／服务端 | 当前只允许`MANUAL`；其余渠道由未来适配器在获准后使用                                            |
| Lead    | `externalSourceRef`                                     | Code／条件可选                              | MANUAL必须为空；其他渠道与`departmentId+creationChannel`组合唯一                                |
| Product | `id`、`leadId`、`position`                              | 服务端                                      | 每条线索至少1项，position从1连续                                                                |
| Product | `url`、`title`                                          | Url／Name，至少一个必填                     | 两者都空拒绝；不自动抓取URL                                                                     |
| Product | `quantity`、`commentCount`                              | Count／必填，默认0                          | 负数、小数和非法值拒绝                                                                          |
| Product | `unitPrice`                                             | Money／必填                                 | 允许0，不允许负数                                                                               |
| Product | `estimatedAmount`                                       | Money／服务端计算                           | `quantity>0 ? quantity : commentCount`乘`unitPrice`，最终按分四舍五入；不冒充交易流水           |

创建Command另含`reservedLeadId?`、`leadScreenshotContentVersionIds[0..20]`和`idempotencyKey`；提供`reservedLeadId`时，所有版本必须来自同一操作者、当前部门和该`LEAD_DRAFT`预留身份。编辑仅允许`WAITING_PUSH`状态，提交`expectedVersion`；不允许编辑身份、部门、业务号、状态、操作者和计算结果。删除不在本Slice。

线索业务号按Asia/Shanghai业务日使用全库并发安全日序列生成：格式固定为`LD-YYYYMMDD-NNN`，当日从`001`递增到`999`且全局唯一；第1000条明确返回`LEAD_NUMBER_EXHAUSTED`，不得回绕、随机补号或复用已删除号码。

### 5.3 CORE-LD-002～006动作

| Slice／动作          | 前置                                                                            | 输入字段／附件                                                                                                                                       | 原子结果                                                                                               |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| LD-002推送           | `WAITING_PUSH`；客户仍`ADMITTED`；至少1项有效商品；存在绑定该企业的有效客户账号 | `expectedVersion`、`idempotencyKey`                                                                                                                  | `WAITING_REVIEW`；服务端写`pushedAt/pushedBy`；客户端企业范围立即可见                                  |
| LD-003客户确认侵权   | `WAITING_REVIEW`；操作者绑定目标企业                                            | `result=INFRINGEMENT`、`expectedVersion`、`idempotencyKey`                                                                                           | `WAITING_EVIDENCE_DECISION`；写审核人／时间和不可变决定事件                                            |
| LD-004客户判定不侵权 | 同上                                                                            | `result=NO_INFRINGEMENT`、`reason`必填LongText、`expectedVersion`、`idempotencyKey`                                                                  | `ARCHIVED`；`archiveType=NO_INFRINGEMENT`，归档时间服务端写入                                          |
| LD-005运营不取证     | `WAITING_EVIDENCE_DECISION`                                                     | `result=NO_EVIDENCE`、`reason`必填LongText、`expectedVersion`、`idempotencyKey`                                                                      | `ARCHIVED`；`archiveType=NO_EVIDENCE`                                                                  |
| LD-006确认取证       | `WAITING_EVIDENCE_DECISION`；客户仍可开展正式业务                               | `selectedProductIds[1..n]`、`selectedContentVersionIds[0..n]`、`notaryOfficeId`、`evidenceMode=ONLINE_PURCHASE`、`expectedVersion`、`idempotencyKey` | 同事务创建`NotaryMatter(stage=PENDING_EVIDENCE)`及来源快照；线索保留并停止普通编辑；重复请求返回原事项 |

## 6. CORE-NT字段与动作契约

公证事项固定保存：`id/businessNo/departmentId/sourceType/sourceLeadId/customerId/rightsHolderId/responsibleUserId/notaryOfficeId/stage/version`；来源选择的商品和材料以关系及精确内容版本保存，不复制成无关联字符串。

| Slice／动作    | 必填结构化字段                                                                                                                                     | 必填附件                           | 结果／阻塞                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| NT-001取证物流 | `evidenceAt`；`sampleFeeState(KNOWN/PENDING)`及条件金额；至少1条物流，每条`companyState/value?`与`trackingState/value?`必须分别为`PRESENT`或`NONE` | 无                                 | `PENDING_EVIDENCE→WAITING_UNBOX`；`NONE`不参与匹配；公司／单号不能一个未表态                                                 |
| NT-002开箱材料 | `senderName?`、`senderPhone?`、`senderAddress?`；人工修改识别单号时保存原值、改后值、原因                                                          | `NOTARY_OPENING_PHOTO`至少1个      | `WAITING_UNBOX→UNBOX_REVIEW`；未知字段保持空，不生成模拟发货人                                                               |
| NT-003开箱审核 | `result=INFRINGEMENT/NO_INFRINGEMENT`；不侵权时`reason`必填                                                                                        | 无                                 | 侵权：`UNBOX_REVIEW→ISSUANCE_DECISION`；不侵权：同事务归档并记录原因；归档后的撤销／重开`BLOCKED_BY BQ-03`，普通入口不得提供 |
| NT-004出证选择 | `decision=ISSUE/NO_ISSUE`、`decidedAt`                                                                                                             | 无                                 | ISSUE→`WAITING_CERTIFICATE`；NO_ISSUE→`WAITING_RETURN`；保存草稿不推进                                                       |
| NT-005出证转案 | `certificateNo`、`certificateDate`、公证／样品／调查／披露各费用的`KNOWN/PENDING`及条件金额；需披露时有结构化信息或披露材料                        | `NOTARY_CERTIFICATE`和条件披露材料 | 多本、真实材料门槛和更正规则`BLOCKED_BY B10/B21`；关闭后同事务归档事项、生成案件待匹配、保留全部原费用身份                   |
| NT-006退货归档 | `returnChoice(RETURN/KEEP/REFUND_ONLY)`、退款和运费金额状态、归档类型／原因／日期                                                                  | 条件凭证                           | 归档准入、累计退款口径、收付方、分步和原子边界`BLOCKED_BY B08/B11/B18`                                                       |

## 7. CORE-CA字段与动作契约

案件固定保存稳定`id`、业务号、部门、客户、主体、来源公证事项、负责人、当前阶段和`version`。法院案号、诉调号和执行案号分别可空，实际取得后录入，永不拿业务号代填。

下表“至少具备”来自BR-03并由SD-23采用；实施AI不得使用Demo中缺少`required`的表单绕过它。

| Slice／当前阶段      | 推进前至少具备的结构化字段                                                                 | 必须冻结的附件版本                              | 结果／阻塞                                                           |
| -------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| CA-001案件待匹配     | 至少1名被告：`kind/name`必填，证件／电话／地址可空；至少1名主办律师；`matchedAt`           | 无                                              | →待写诉状；主办／协办细则外的复杂分工后置                            |
| CA-002待写诉状       | `amountState=KNOWN`及非负`amount`，或`PENDING`及`pendingReason`                            | 至少1个`COMPLAINT`和1个`AUTHORIZATION`          | →诉状待确认                                                          |
| CA-003诉状待确认     | `confirmedComplaintContentVersionId`、确认后的金额状态；若更换版本或金额则`changeNote`必填 | 确认的诉状精确版本                              | →诉状待盖章                                                          |
| CA-004诉状待盖章     | `mailedAt`                                                                                 | `MAIL_RECEIPT`至少1个                           | →待提交立案；客户只可操作本企业案件，运营按授权也可登记              |
| CA-005待提交立案     | `courtId`、`submittedAt`                                                                   | 起诉及证据材料至少1组；截图可选                 | →转正式立案                                                          |
| CA-006转正式立案     | `acceptedAt`、`courtCaseNo`                                                                | 受理通知可随后补充；缴费清单、送达文书条件可选  | →待开庭；开庭信息可随后补充，保存缴费不推进                          |
| CA-007待开庭         | 有效`hearingAt`                                                                            | 无                                              | Asia/Shanghai开庭次日00:00→待判决；推进后延期`BLOCKED_BY B16`        |
| CA-008待判决         | `judgmentReceivedAt`                                                                       | `JUDGMENT`至少1个                               | 登记判决仍停留待判决，随后由独立动作选择上诉或执行                   |
| CA-009判决后续选择   | `next=APPEAL/EXECUTION`                                                                    | 无                                              | 多轮、权限和改判金额规则`BLOCKED_BY B13`；不得在未关闭时实现正式分支 |
| CA-010二审           | 上诉人稳定身份；确认结果时`result`和`resultReceivedAt`                                     | 二审材料；确认结果至少1个二审裁判文书           | 轮次、发回重审历史和结果更正`BLOCKED_BY B13`                         |
| CA-011待写执行材料   | 无额外结构化必填                                                                           | `EXECUTION_APPLICATION`至少1个                  | →执行材料待确认                                                      |
| CA-012执行材料待确认 | `confirmedAt`、`confirmedExecutionContentVersionId`                                        | 确认的执行材料精确版本                          | →执行材料待盖章                                                      |
| CA-013执行材料待盖章 | `mailedAt`                                                                                 | `MAIL_RECEIPT`至少1个                           | →待申请执行立案；客户／运营按各自范围操作                            |
| CA-014待申请执行立案 | `submittedAt`                                                                              | `EXECUTION_FILING_PROOF`至少1个                 | →强制执行中                                                          |
| CA-015强制执行中     | 保存更新至少含实际`executionCaseNo`或立案信息；保存不等结束                                | 执行文书可追加                                  | 结束动作及重启规则`BLOCKED_BY B13`                                   |
| CA-016待归档结案信息 | `closedAt`、`closeReason`；未完成财务事项须`financePending=true`及说明                     | `CLOSURE_DOCUMENT`至少1个；付款记录各自引用凭证 | 保存仍待归档；结案金额、实际付款和结算分别记录                       |
| CA-017最终归档       | 满足CA-016并通过终结守卫                                                                   | 冻结结案文书版本                                | 归档原因、重开／更正／删除和付款门槛`BLOCKED_BY B15/B20/B21`         |

每个阶段Command统一输入`caseId`、`expectedVersion`、`idempotencyKey`、本行动字段和精确内容版本ID；服务端写动作前后阶段、操作者和系统时间。保存草稿Command不得修改阶段。

## 8. OCR、爬虫和导入接口边界

正式创建Command不依赖HTTP表单形状：运营页面、人工确认后的OCR候选和爬虫候选映射为同一`CreateLeadCommand`或历史案件补录Command。

- 当前数据库为业务记录保留`creationChannel`和`externalSourceRef`；MANUAL必须无外部标识，非MANUAL在部门＋渠道内唯一。
- OCR／爬虫未来新增`IngestionBatch`、`IngestionCandidate`和Adapter，不在当前业务表保存未确认原始字段。
- 候选包含原始来源、解析字段、字段级置信度、重复候选和错误；人工采用后才调用正式Command。
- 历史案件导入必须走独立补录Command并填写真实业务日期、来源和原因；不得直接设置普通案件阶段。
- 任何导入重复、超时或重试都由批次／候选幂等处理，不能通过跳过唯一约束或直接SQL解决。

## 9. 错误、事务与测试契约

所有动作至少稳定区分：`VALIDATION_ERROR`、`ACTION_FORBIDDEN`、`RESOURCE_NOT_FOUND`（含越范围）、`INVALID_STATE`、`MATERIAL_VERSION_INVALID`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`STORAGE_UNAVAILABLE`和`DEPENDENCY_RULE_BLOCKED`。

- 单聚合写入、审计和幂等回执同一数据库事务；跨模块移交／转案的全部数据库事实同成同败。
- Blob写入与数据库提交使用上传草稿和补偿清理，不宣称跨存储原子事务。
- 真实PostgreSQL测试覆盖数据库约束、重复请求、旧版本冲突、跨部门和事务回滚。
- 浏览器测试必须上传真实字节、刷新后下载并校验内容；只有文件名或Mock URL不算通过。
- 每个Slice计划只引用本文对应行；标有`BLOCKED_BY`的行在阻塞项关闭前不得生成实现任务。
