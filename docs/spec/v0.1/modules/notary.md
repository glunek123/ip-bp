# NT 公证

2026-10-27第二批补充合同（SD-66）：客户/权利主体搜索选择及店铺模糊筛选作用于当前阶段与获权数据，候选、分页/总数/导出同范围。运营可按独立业务权限代办公证处外部节点，已有外部账号也可办理，记录真实运营actor及代办动作；必要真实日期、出证材料/费用事实及版本/幂等不取消。既有内部开箱/审核等能力复用，出证后的材料、证物与费用源同样保留真实身份；不自动授予权限。全节点与验收见[第二批整合稿](../../../superpowers/specs/2026-10-27-operations-batch2.md)及实施契约，实现状态另记。

2026-10-18 SD-61：用户已确认已登记资料带原因更正、跨事项逐一确认照片、逐项独立提交与未知结果先核实。以下为 UXQ-02 首片实施合同，不再等待这三项业务选择；尚不表示代码或真实验收完成，不授权测试账号、Grant、数据库部署或写入额度。

### SD-61 首片接口与保持项

- 更正仅限当前有效、具有新 `notary.record.correct` 操作及来源线索范围的内部账号，按既有 SELF／TEAM／DEPARTMENT Grant判断；不依据职级／角色名称放行，不自动给任何角色加权。客户和公证处首片不能提交更正。取证事实已存在时，取证日期／物流可在 `WAITING_UNBOX`、`UNBOX_REVIEW`、`ISSUANCE_DECISION`、`WAITING_CERTIFICATE`、`WAITING_RETURN` 更正；原开箱已存在时，寄件资料可在后四阶段更正。`ARCHIVED` 全部拒绝首次新更正，不开放重开。
- `POST /api/v1/notary-matters/:id/evidence-corrections`：body仅 `{ expectedVersion, expectedRevision, correctionReason, evidenceAt, logistics }`。日期及物流沿原 `RecordNotaryEvidenceDto` 的真实日期、至少一条、公司／单号PRESENT或NONE与200／100字符规则；不新增today／先后关系门槛，不接收样品费或附件。`POST /api/v1/notary-matters/:id/opening-sender-corrections`：body仅 `{ expectedVersion, expectedRevision, correctionReason, senderName, senderPhone, senderAddress }`，三个寄件值均显式可为null，长度沿原200／100／500；不接收照片／出证字段。
- 两命令均用既有 `Idempotency-Key` header（1～128字符），route唯一注入matter ID，拒绝未知字段和body异锚。`expectedVersion`是当前事项流程version，`expectedRevision`是本资料组revision（原事实为0）；原因去首尾空白后1～500字符，同一规范化值用于指纹／事实／审计，不改客户端原key。成功201返回 `{ matterId, correctionId, kind, revision, recordedAt }`，kind分别为 `EVIDENCE`／`OPENING_SENDER`，revision恰为expectedRevision+1。更正不推进stage或增加事项流程version。
- 在原事项同事务锁内重新校验当前身份、Action与来源范围，授权后先核原成功回执，再对新写入核阶段／原事实／两个预期版本，追加不可变值版本、成功审计及回执；失败整体回滚，并发仅一个新revision胜出。原成功key同参在当前授权仍有效时返回首结果，异参409；不能因后来归档或流程version变化把旧成功当新写。不得UPDATE原Evidence／Logistics／Opening、照片、审核决定、证书、费用或Case锚；新物流版本行使用真实不可变UUID，不伪造或移用原物流ID。
- 原有获准业务字段的当前投影与列表摘要采用effective值，保留原API字段形状、样品费用、原登记时间及冻结照片。内部详情新增独立 `recordEdits.evidence`／`recordEdits.openingSender`（原事实不存在为null），分别给出 `canCorrect`、当前revision、original、effective及升序更正history（真实correctionId／原因／操作者／时间／原新值）；不把history当新的操作步骤。已有客户／公证处只对其原本获准字段读取effective，不增加原因／操作人／内部history可见性。新字段缺席兼容旧响应，有字段时严格解码。
- 跨事项批量开箱只增加内部列表勾选后的逐事项表单和结果汇总，复用现有 `POST /api/v1/notary-matters/:id/opening` 及单项payload／response／Action，逐项串行独立事务；不增加服务器批次表、后台job或新批量endpoint。每项自行上传／选择该owner的1～50个 `NOTARY_OPENING_PHOTO` CV，JPG／JPEG、PNG、WEBP且每张≤20MiB；上传准备成功不等于opening提交成功。不从快递号、文件顺序或其他事项推定归属。
- 每项保存明确区分未提交、提交中、成功、确定失败、结果未知；已知失败和未执行项独立处理，不重发成功项。未知项持有原actor／department／matter／expectedVersion／完整body／key，阻止编辑该项后换键盲重试；显式核实仅复用原请求，当前重新授权后以原回执证明结果。沿现有sessionStorage pending和抽屉互斥模式实现，不另建通用状态／审批系统。身份切换／关闭／迟响应不污染其他事项，abort不证明未提交。

代码文件归属与当前启动阻塞统一见[实施安排](../../../superpowers/plans/2026-10-17-next-batch-acceptance-readiness.md#7-公证最小实施契约与独占文件)。

2026-10-15 SD-58列表交互：内部公证列表与公证处入口按各自真实能力，在列表抽屉打开原开箱／取证／出证等适用表单，不只跳详情锚点。内部与公证处的DTO、角色、材料和最小投影保持分别校验；同一步有合法分支时在表单选择，条件字段与提交文案对应真实去向。方向未定的资料保存须有独立正式Command；不能把NO_ISSUE误指向出证或自动创建案件。成功重查原行并保持筛选分页，未知结果沿原body／key恢复。共同合同与真实点击验收见[共享合同](shared.md#三模块列表流程表单sd-58)；本段不表示已实现或验收。

线索取证来源与合并归档来源分开。普通办理候选：待取证→线上物流／线下报告→开箱待审核→开箱待确认→待出证→归档并转案；不出证转退货。线下确认可直接提诉的保留范围待审核。

依据：[固定事实](../../../demo-reverse/v158/modules/M03-notary.md)、[候选](../../../demo-reverse/v158/modules/M03-notary-candidates.md)、[决定](../../../demo-reverse/v158/DECISIONS.md)和[纠偏](../../../demo-reverse/v158/CORRECTIONS.md)。字段只在[领域模型](../DOMAIN.md)维护；B/T/E编号见[缺口](../GAPS.md)，通用技术设计见[TD-BASE-05／TD-TRACE-UX-01](../TECHNICAL-DESIGN.md)。CORE-LD-006提供来源线索移交、待取证事项及公证处主数据；CORE-NT-001仅登记线上取证日期、样品费用状态及逐字段明确的物流，原子推进待取证到待开箱。CORE-NT-002仅处理明确选择的单个待开箱事项：有权内部人员上传1～50张真实JPEG／PNG／WEBP照片（单张不超过20 MB），可填写有来源的寄件人信息，提交时校验版本及照片归属并原子保存不可变开箱事实、冻结附件引用、审计与幂等回执，事项进入开箱审核；详情及下载按来源线索权限过滤。识别匹配和批量核对仍属后续动作，下列未覆盖AC不能据此认定已验收。

正式侧栏“公证阶段”以公证事项为计数对象，不用已移交线索数替代批次数。`GET /api/v1/notary-matters` 提供分页、阶段 `PENDING_EVIDENCE`／`WAITING_UNBOX`／`UNBOX_REVIEW`／`ISSUANCE_DECISION`／`WAITING_CERTIFICATE`／`WAITING_RETURN`／`ARCHIVED` 筛选及同一可见范围的分阶段计数；`items`、`total`、`counts` 均限当前部门及 `lead.read` 对来源线索的授权范围，排序为创建时间降序、ID 升序。每项只含事项编号、阶段、创建时间、公证处及来源线索的 ID／编号；未知阶段返回 400。尚未实现的 Demo 公证节点和“我的案件”不作为正式可点击入口。

SD-41确认公证各节点的目标办理角色。CORE-NT-003只办理单事项开箱待审核的运营／来源客户企业双身份决定：侵权进入`ISSUANCE_DECISION`（开箱待确认），不侵权必填原因并同事务进入`ARCHIVED`；审核人、时间、结论、审计、幂等与冻结照片保持可追溯。客户仅按有效企业绑定读取本企业事项的最小审核摘要和开箱事实中精确冻结的照片，不读取运营完整详情；撤权后下一请求失效。已归档普通重开仍待BQ-03。CORE-NT-007为公证处提供固定绑定单一公证处的真实账号和最小待开箱入口，复用NT-002开箱Command；外部账号不获得内部部门成员或运营角色，只能读取本公证处事项的开箱必要字段、上传本人待提交照片并在提交后读取冻结照片。运营入口保留，公证处账号或绑定撤销后下一请求失效；不把运营代办称为公证处正式入口。

CORE-NT-004只办理单个开箱审核已确认侵权、处于`ISSUANCE_DECISION`的事项。当前有效且覆盖来源线索的内部运营账号须具备`notary.issuance.decide`，提交`ISSUE`或`NO_ISSUE`、`expectedVersion`和幂等键；服务端重新校验身份、权限、审核事实、阶段及版本。`ISSUE`原子进入`WAITING_CERTIFICATE`，`NO_ISSUE`原子进入`WAITING_RETURN`，同时保留不可变决定、服务端决定时间、操作者、成功审计和回执；同键同参重放，异参冲突，并发仅一方成功，审计或回执失败整体回滚。客户仅可按来源企业绑定查看决定的最小摘要；客户待审核列表只含仍需开箱审核的事项，关联线索的批次历史可查看已决定事项。两种结果均不代表已出证、已退货、已转案或已归档，相应办理动作仍由后续切片交付。

CORE-NT-005的已确认最小门槛：每个`WAITING_CERTIFICATE`事项本切片只登记一本公证书，当前有效且明确绑定该事项公证处的真实账号须提交真实证书编号、出证日期及至少一份有效的PDF／JPEG／PNG公证书文件；需披露时提交真实披露材料。服务端同事务冻结所选版本、保留费用来源、归档事项并创建唯一来源的`PENDING_MATCH`案件，法院案号留空。多本和出证后更正留给后续切片；本段不关闭B10／B21的其他问题，也不把保存草稿当作出证。

## REQ-NT-001 来源与取证记录

- 状态：部分确认（SD-14）＋纠偏约束。来源：N-C01 N-C02 FIX-12 FIX-14。字段组：NT01/NT02/NT03/NT06。
- 目标／动作与结果：按明确来源进入事项；线上维护取证日、物流及样品费用。提交流转时快递公司和单号均须明确选择，可选择“无”；“无”不作为真实值参与匹配。线下维护调查日、报告及调查费用。保存草稿不等于确认办理，业务信息不从展示串猜测；调查费不得同时增加样品支出。
- 异常、边界及待决：线下调查和直接诉讼门槛仍属B10；零费适用范围B17；合并归档不得当成普通待取证自动办理。
- 依赖：BQ-03/BQ-04/BQ-05/BQ-09/T01/T02；正式操作者与数据范围统一受REQ-XM-001约束。相关批量、失败和重复控制见REQ-SH-004，未定策略不视为已批准。
- AC-NT-001：**给定／操作**：原样品费0的线下事项提交调查费100和报告。**预期**：调查费为100，样品费不因该调查增加；来源可追溯；进入审核的材料门槛以B10最终确认表为准。
- AC-NT-006：**给定／操作**：原线上取证／开箱事实已登记，当前有效且覆盖来源范围的内部人员具备 `notary.record.correct`，在允许的非归档阶段以当前事项版本、目标资料revision、原幂等键及非空原因更正取证日期／物流或寄件资料。**预期**：仅追加资料版本、审计和回执，原值及历次更正可查；事项阶段和流程version、样品费用、开箱照片／审核／出证／案件锚均不变。归档、跨范围、撤权、旧revision及同键异参拒绝；原成功键在当前重新授权后可返回原回执，不因后续流程版本变化重复写入。

## REQ-NT-002 开箱核对与审核确认

- 状态：纠偏约束＋待审核。来源：N-C03 FIX-13。字段组：NT03/NT04/MT01。
- 目标／动作与结果：单条和批量按同一物流关联核对本批各包裹，未知或不匹配进入人工待处理，不按队列猜案。识别单号无法匹配时提供手工修改入口；修改后的值仍须重新匹配。开箱材料与识别候选分开；审核与详情读取同一结论。侵权确认后的出证／不出证／线下提诉分支须按合法动作表办理。
- 异常、边界及待决：混包和取证异常见BQ-04；手工改号角色、原值留痕和错误更正见BQ-03/04；识别未读到单号不能当作自动确认归属，SD-09要求人工审核候选；不侵权后取消归档时已生效范围见BQ-03；不伪造发货人。
- 依赖：BQ-03/BQ-04/SD-09/T02/T05；正式操作者与数据范围统一受REQ-XM-001约束。相关批量、失败和重复控制见REQ-SH-004。
- AC-NT-002：**给定／操作**：事项A有两个物流单号，上传含A和B单号的混包；再查看审核详情。**预期**：不得只核首包就全部归A；不能确认的组标待处理，不生成模拟发货人；审核展示与实际保存结果一致。
- AC-NT-007：**给定／操作**：在内部列表明确勾选多个事项，各自确认寄件资料及仅属于该事项的有效照片后批量开箱。**预期**：每项仍走 NT-002 原Command、Action、版本及材料校验和独立事务，显示成功、确定失败、未执行、结果未知；成功项不重发，确定失败项独立处理，未知项保留原主体／目标／完整body／key，仅显式核实原结果。不跨事项移动CV，不按单号或队列猜照片归属，不将一项失败回滚其他已成功项，不套用 NT-010 的整批归档事务。

## REQ-NT-003 出证及转诉讼

- 状态：确认方向（BD-12）＋纠偏约束；流程细则待审核。来源：N-C04 BD-12 FIX-14 FIX-17。字段组：NT01/NT05/NT06/CA01/FE01/EV01/EV02。
- 目标／动作与结果：确认出证须保存真实出证资料及需要的披露信息；转案保留客户、主体、原业务来源与实际已有信息，不虚构法院案号。原各项费用完整关联并保留来源，不重复生成，包括调查／披露等；线下直接提诉若获准也适用此保留要求。
- 异常、边界及待决：出证与台账更新原子边界T02；重复、更正、多本和材料门槛B10/21；未转案费用支付B11。保留同笔身份不等于物理复制一套费用。
- 依赖：B10/B11/B21/T01/T02/T06；正式操作者与数据范围统一受REQ-XM-001约束。相关批量、失败和重复控制见REQ-SH-004，未定策略不视为已批准。
- AC-NT-003：**给定／操作**：事项已有公证100、样品200、调查300、披露400四笔来源费用，完成转案。**预期**：四笔均可从案件追溯原费用及来源，总额1000且无重复费用；客户与主体不丢失，法院案号不得生成示例值。

## REQ-NT-004 退货、退款与普通归档

- 状态：NT-006单事项退货归档边界已确认（SD-43）；其他普通归档类型、重开／更正及完整财务规则仍待审核。来源：N-C05、CORE-NT-006设计。字段组：NT06/NT07/FE01。
- 目标／动作与结果：仅对已有`NO_ISSUE`决定且处于`WAITING_RETURN`的事项，由具备事项范围权限的内部运营账号一次提交`RETURN`、`KEEP`或`REFUND_ONLY`选择、适用退款／退货运费金额事实及去空白后必填的归档原因；同一事务写入费用事实和归档事实并推进至`ARCHIVED`。三种选择分别映射对应归档类型；归档日期和操作者由服务端生成。客户仅读取本企业最小归档结论，不读取退款、运费或收付方。
- 金额与边界：适用金额分别采用`KNOWN`或`PENDING`；`KNOWN`须有非负金额，真实`0`不生成支付／结算指令，`PENDING`不得写假零。`KEEP`不生成退款或退货运费事实；`REFUND_ONLY`不生成退货运费事实。正金额须明确收款方／承担方（客户、我方、商家／平台或其他；其他须填名称），零金额及待定金额不猜测收付方。已知正退款关联原取证样品支出，同一原支出累计退款不得超过已知原支出；原支出待定时不得登记已知正退款。退货退款和运费只是业务费用事实，不发起支付／退款，不覆盖原费用，不创建案件或公证书；本切片不要求退货物流或退款截图作为必传凭证。
- 异常、边界及待决：授权、并发、幂等、审计和归档原子性按NT-006设计执行；金额或分支校验失败时不得归档。BD-06继续保护已发起费用。其他归档准入、原因、重开／更正及完整费用类别、支付发起、实际回执与后续更正仍分别受B08/B11/B18/E03约束，不由NT-006关闭。
- 依赖：SD-43、T02；正式操作者与数据范围统一受REQ-XM-001约束。相关批量、失败和重复控制见REQ-SH-004；本切片不实现付款、退款执行或待定金额后续更正。
- AC-NT-004：**给定／操作**：事项有`NO_ISSUE`决定并处于`WAITING_RETURN`，运营提交合法选择、适用金额状态及归档原因。**预期**：费用事实与归档事实原子写入，事项一次推进至`ARCHIVED`；缺少原因、负金额、已知正退款累计超出原样品支出或原样品支出待定时拒绝且不产生归档。零金额保留事实但不产生支付／结算指令；客户只能看到最小归档结论。

## REQ-NT-005 批量归档不改费用

- 状态：确认方向（BD-04）。来源：N-C05 BD-04 FIX-17。字段组：NT06/NT07。
- 目标／动作与结果：批量归档不覆盖所选事项各自已有的费用；若合法归档分支须新增退款／运费事实，则按该分支逐项明确记录，不能把原费用或不同事项的金额默认统一为0。修改原费用须另外明确操作。
- 异常、边界及待决：同阶段／跨阶段和已归档重复操作见BQ-03；批量共用单条校验并明确选择（SD-07/08）；独立费用修改遵守BD-06。
- 依赖：BQ-03/BQ-09/SD-07/08；正式操作者与数据范围统一受REQ-XM-001约束。相关批量、失败和重复控制见REQ-SH-004。
- AC-NT-005：**给定／操作**：两事项公证费分别100和200、样品费分别30和40；执行允许的批量归档且未发起费用修改。**预期**：归档后仍分别为100、200、30、40；已有调查、披露及退款事实也不被改写，合法分支新增的退款／运费另行逐项留存。

## 公证事项列表增强（CORE-NT-008～010）

以下三个切片只扩展内部运营的公证事项列表，不把 Demo 的本地数据操作当作正式接口，也不扩大客户或公证处账号的读取、导出及归档范围。现有单事项审核、出证转案和退货归档规则保持不变；其他阶段需要提前结束时另设计终止／撤销，不通过列表“归档”跳过节点。

### CORE-NT-008 列设置

- 用户调整的是公证事项**列表列**的显示与前后顺序，不是业务录入表单的字段顺序。首版列键对应当前正式列表的事项编号、阶段、来源线索编号、公证处、创建时间五项；事项编号／详情入口及阶段保持可见，有批量入口时选择列也固定，其余三列可显示／隐藏及调整顺序。后续新增列须先有正式记录来源和获权投影，不为 Demo 尚未记录的字段显示假值。
- 偏好绑定当前内部账号并由服务端持久化，刷新、退出后重新登录及换浏览器仍生效；只影响本人展示，不改变事项数据、他人偏好或后端可读范围。提供恢复默认；未知、重复或已下线的列键不能破坏列表，新获准列按默认规则补入。权限撤销后偏好不能使已无权读取的数据重新出现。
- 验收：两名内部用户分别调整显示与顺序，重新登录后各自保持；恢复默认只影响本人；伪造未知列键、撤销读取权限及切换账号均不能暴露额外字段。
- 接口：`GET`／`PUT /api/v1/notary-matters/list-preference` 均返回 `{ order: string[], hidden: string[] }`。`order` 固定以 `businessNo`、`stage` 开头，后接 `sourceLead`、`notaryOffice`、`createdAt` 的完整无重复排列；`hidden` 只能是后三项的无重复子集。PUT 是本人偏好的全量替换；非法键、重复键、隐藏固定列及额外字段返回 400。仅有效内部账号且具备实时 `lead.read` 授权可读写；无记录时显示全部默认列。

### CORE-NT-009 受权批量导出办理清单

- 2026-10-23用户明确批准按Demo20列补齐，替代原五列最小范围；只导出正式已记录、当前获权的真实事实。用户须明确选择“已勾选事项”或“当前阶段筛选结果”，提交前展示范围与数量；未勾选不隐式导出全库。导出按后端当次身份、独立导出权限与事项数据范围重新查询，跨页选择也以稳定事项 ID 校验，不信任前端传来的字段值或总数。
- CSV固定顺序：公证编号、权利主体、平台、店铺名、店铺ID、案件进展、推送日期、取证日期、发货人、发货电话、发货地址、公证费、调查费、样品费、披露费、快递公司、快递单号、公证处、公证书编号、出证日期。内部读取`lead.read`与`notary.list.export`范围取交集，不新增金额权限或扩大外部账号读取。披露费和公证费／调查费取本事项真实出证费用事实；金额已知零输出`0.00`，未登记／待定留空，不能假填0。取证、发货与物流使用最新有效更正；物流按原位置稳定配对，在单格换行，不拆成错配记录。个人列偏好不改变导出字段或授权。
- 验收：跨部门、不同阶段及跨页事项时，下载CSV只含明确范围内获权记录，20列值与正式来源及有效更正一致；无导出权限、撤权及伪造事项ID均拒绝；金额未知和零可区分，恶意公式文本不能执行。原五列验收证据保留，不能自动覆盖本次新字段或宣称20列已真实验收。
- 实施契约：新增可分配Action `NOTARY_LIST_EXPORT`（`notary.list.export`），支持既有SELF／TEAM／DEPARTMENT范围；读取范围与`lead.read`取交集，不修改权限计算。普通读取角色不自动获得导出权；为使现有部门角色管理员可以按Grant Boundary正式分配新Action，前向迁移只为已具备DEPARTMENT `role.manage`的角色补DEPARTMENT导出Grant并刷新受影响账号授权修订号。生产连接、地址或密钥不进入业务代码。
- 迁移仅提升实际新增Grant的角色模板版本，旧版本编辑请求必须拒绝，普通角色不变；Grant、版本和有效账号授权修订同事务提交，失败回滚、排除故障后重试不重复增版。
- `POST /api/v1/notary-matters/exports/preview`接受`{ mode: 'SELECTED', matterIds: string[] }`或`{ mode: 'FILTERED', stage?: NotaryListStage }`，返回`{ count: number, maxRows: 1000 }`。选中模式须为1～1000个唯一UUID且不能携带stage；筛选模式不能携带matterIds，省略stage只在明确选择“当前全部可见事项”时表示全部。无权／不存在的选中ID整批403，不静默丢弃。无记录400 `EXPORT_EMPTY`、超过1000条400 `EXPORT_LIMIT_EXCEEDED`，未知字段／非法组合400。
- `POST /api/v1/notary-matters/exports`接受同一明确范围及必填`expectedCount`（1～1000），当次重查范围及数量，不接受前端行数据；与预览数量不同时409 `EXPORT_SCOPE_CHANGED`，提示重新预览。有效内部账号、读取权限和导出权限均由当次后端校验，外部客户／公证处拒绝。复用事务生成CSV并写既有AuditEvent；审计失败不返回文件，详情记录导出人、服务端时间、范围、实际事项ID和条数，不记录文件全文。审计表示服务端生成成功，不冒称用户已保存文件；本动作不推进阶段，不引入业务幂等回执。
- CSV采用UTF-8 BOM、CRLF和标准双引号转义；阶段使用正式中文标签，时间点按上海业务日期展示，日期字段保留原业务日期。所有文本（包括前导空白／制表符／换行后的`= + - @`）防公式注入，不打包附件或客户证件。排序与正式列表一致。跨页勾选只在同一账号、部门和阶段内保留，切换账号／部门／阶段或离开页面即清空并取消旧预览／下载；导出前展示明确范围、后端预览条数和20列说明，默认不导出全库。审计保持真实生成记录，不将下载事件冒充用户已保存文件。

### CORE-NT-010 合法批量归档

- 首版仅对明确勾选、均处于 `WAITING_RETURN` 且已有 `NO_ISSUE` 决定的事项批量办理现有 NT-006 退货归档。当前有效且覆盖每个事项的内部运营账号须具备 `notary.return.archive`；每项分别提交适用的 `RETURN`／`KEEP`／`REFUND_ONLY` 选择、退款／运费事实、归档原因及预期版本，批次携带幂等键。页面预先说明归档后果、展示逐项输入与待提交数量，不默认替用户填零或把不同费用统一成一个值。
- 后端复用单项业务校验并在同一事务中采用 **all-or-nothing**：任一事项越权、阶段／决定不符、金额无效或版本过期则整批不写；成功时逐项留存不可变归档、费用事实与审计，并保存批次回执。同键同请求返回原结果，不重复归档；同键异参及并发竞争稳定拒绝。归档不改写任何事项原有公证费、样品费、调查费、披露费或既有退款；已知零与待定仍按 NT-006 区分。已归档、待出证及其他阶段不能由本入口再次或提前归档。
- 验收：混入越权、已归档、跨阶段或旧版本事项时整批保持原状；两项原费用不同、退款／运费输入不同仍分别保留，审计或回执失败整体回滚；重复请求、并发竞争、跨部门隔离及真实浏览器刷新／重登录后结果均通过。其他阶段提前结束另设终止／撤销切片，不由本切片推定权限和原因。
- 实施契约：`POST /api/v1/notary-matters/return-archive-batches`，请求为`{ items: [{ matterId, returnChoice, refund?, freight?, archiveReason, expectedVersion }] }`，必填`Idempotency-Key`（1～128字符）。首版一次1～50项唯一UUID，未知字段、重复ID及非法组合400；ID规范化并按ID稳定排序，同一组逐项事实重排不改变请求指纹。退款／运费输入及校验完整复用NT-006，不新增权限Action。成功返回`{ batchId, items }`，items为按规范ID排序的既有单项归档结果快照，不是前端自行推算的结果。
- 事务与回执：一个Serializable事务锁定本部门事项并按稳定ID顺序处理，复用单项归档的事务内校验／写入路径，不循环调用多个独立事务。逐项保留`notary.return.archive.succeeded`审计，并写一次`notary.return.archive.batch.succeeded`批次审计（服务端batchId、事项ID与数量）；任一审计／回执失败整批回滚。新增不可变`NotaryReturnArchiveBatchReceipt`，以部门＋操作者＋幂等键唯一，保存指纹和原成功快照；不借用要求单一resultMatterId的原单项回执，不建立通用批次平台。重放先重新验证当前内部身份及每项授权，再核对回执与不可变事实；撤权／停用下一请求拒绝。错误沿用现有400／403／404／409／500契约，同键异参`IDEMPOTENCY_CONFLICT`，旧版本`VERSION_CONFLICT`，错误阶段`INVALID_STATE`；服务内部损坏回执为`RECEIPT_CORRUPT`，HTTP依既有过滤器返回500／`INTERNAL_ERROR`。
- 页面：复用列表明确勾选，批量归档仅针对已勾选ID，不默认全库；通过正式详情读取逐项当前版本及归档能力。逐项填写选择、适用退款／运费及原因，提交前说明全部一起成功或一起失败、归档后只读、不发起付款；必填标记和金额待定提示沿用共享视觉语言。身份／部门／阶段变化取消旧读取并清空，迟到响应不能提交或提示成功。网络超时、断连或服务端未知结果时保留冻结请求及原幂等键，明确提示结果未确认并只允许原请求重试；不得换键或改输入后冒充同一次提交。确定性拒绝则提示刷新事实后重新填写，成功清空选择并刷新实际列表与阶段数量。

### 2026-10-13 运营列表与详情投影冻结（本批待实现）

依据SD-08及用户Demo字段／列表布局对齐要求，本批仅扩内部获权读取、列偏好与真实呈现。沿原lead.read范围、同部门与当前有效内部身份；外部响应、状态机、出证／归档Command、材料授权计算和五列导出不变，无schema迁移。主数据名称是当前精确关联名称，不宣称冻结历史名称。

列表原有六项id／businessNo／stage／createdAt／sourceLead／notaryOffice保留，增加以下显式字段（详情增加同名字段，原证据／开箱／审核／归档字段保留）：

- sourceSummary：{ customer: {id,name}, rightsHolder: {id,name}, platform, shopName, shopExternalId: string|null }。只取本事项sourceLeadId及customerId／rightsHolderId的精确同部门关联；不按同店铺猜配。platform复用LeadPlatform。姓名关系缺失属于源完整性错误，不填UUID或演示名称。
- transferredAt：YYYY-MM-DD，事项createdAt转换Asia/Shanghai业务日；不取Lead.pushedAt。evidenceAt：YYYY-MM-DD|null，取本事项Evidence业务日期。
- openingSummary：null|{photoCount: 非负安全整数, senderName: string|null, senderPhone: string|null, senderAddress: string|null}。仅计本事项Opening成功事件冻结的精确照片引用，不计未提交／失效或另一事项照片；照片具体版本继续从现有详情opening.photos读取。
- certificateSummary：null|{id,certificateNo,certificateDate:YYYY-MM-DD,issuedAt:UTC ISO,needDisclose:boolean}。本事项真实Certificate，无证书时null。
- fees：{notary,investigation,sample}，各项为{state:'UNRECORDED'|'PENDING'|'KNOWN',amount:string|null}；UNRECORDED／PENDING要求amount=null，KNOWN要求非负两位小数Decimal字符串，真实0为'0.00'。公证／调查沿该CertificateFee NOTARY／INVESTIGATION；样品沿本事项Evidence。未登记不能变0，不能计算代替原费用事实。
- linkedCase：null|{id,businessNo,stage}。先独立用当前case.read和既有案件读取范围判定，且源为本事项同部门真实关联Case；不可见和不存在均null，不另泄漏存在标记。null显示“暂无可见案件”；获权显示“已流转诉讼”及真实阶段，可跳精确案件。不能用lead.read拼接案件读取权；不得新增role-name绕过。当前内部case.read是部门读取，复用既有AccessControlService.authorizeDepartmentAction语义，不新造SELF案件读取机制。
- capabilities：现有getMatter五个boolean同名recordEvidence／recordOpening／reviewOpening／decideIssuance／archiveReturn，来源身份、Action范围和真实前序门槛与详情一致；列表只导航现有详情锚，不直接推进或替运营新增公证处出证权。

详情额外certificateFiles：精确四项materialId／contentVersionId／originalFilename／mimeType加purpose:'NOTARY_CERTIFICATE'|'NOTARY_DISCLOSURE'。仅调用既有MaterialService.listFrozenCertificateFiles及现行下载接口，不返回storageKey／URL、当前版本替代或新下载授权。未出证为[]；归档结论复用既有reviewDecision／returnArchive／certificateSummary，不造额外成功事实。

列偏好继续GET／PUT本人{order,hidden}。完整19个键：businessNo,stage,rightsHolder,platform,shopName,shopExternalId,transferredAt,evidenceAt,openingPhotos,certificateNo,senderName,senderPhone,senderAddress,notaryFee,investigationFee,sampleFee,sourceLead,notaryOffice,createdAt。businessNo／stage固定前两项、不可隐藏；选择列和操作列在偏好外固定，businessNo在操作单元格次行展示，不额外占主列；stage列标题为案件进展，同时保留事项真实阶段。其余17键可排／隐藏。无偏好时按以上顺序，hidden默认sourceLead／notaryOffice／createdAt，形成Demo17个运营列。旧五键存储读取时：插入新14键于stage后，再保留旧三个可选键的相对顺序和hidden；不得写回覆盖用户设置。新版PUT要求完整19键无重复排列、hidden仅可选键，无未知字段；旧存储兼容不意味着放宽非法新请求。恢复默认仅影响本人。

验收：旧五列记录／无记录／两账号独立／恢复默认／撤权，未登记／待定／真实0／正数费用；同事项来源、冻结照片与证书／披露版本；出证归档／不侵权归档／退货归档，转案有权与无case.read时最小投影；列表／total／counts同范围、原分页和阶段不变。真实浏览器在相同视口核Demo与正式页、窄窗口横滚和错误／空／加载态，不以单元测试代替视觉验收。
