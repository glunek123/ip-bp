# 线索 CSV 完整导入最小实施合同

基线：`4885c3340f0123e7fca786242cc19c1445cb9935`。依据已批准 Demo 完整导入范围、REQ-LD-001／002、REQ-SH-004、SD-08、T02／T07。运营导入并关联客户，然后由运营另行推送、客户审核确认；导入不自动推送，不增加客户供线索入口、角色、权限或业务状态。

## 字段与名称

- 基础表头沿 Demo 固定17列、顺序一致：客户、权利主体、案件类型、运营、线索来源、平台、侵权类型、线索发现日期、店铺名、店铺ID、是否需要披露、线索备注、商品链接、商品名称、销量、单价、评论数。拒绝缺列、重复或未知表头及不等宽行，不猜列。
- 一行始终是一条线索，不按店铺名或相邻行自动合并。额外商品可在基础列后追加连续完整的五列组：商品2链接、商品2名称、商品2销量、商品2单价、商品2评论数，依次至商品100；全空额外组忽略，部分有值时按同一商品规则校验。既有17列模板保持有效。
- 客户及权利主体只从本次新取的 `LeadFormContext` 解析：trim后完整名称精确唯一匹配，客户必填，主体必须属于该客户；主体空且唯一时可按手工表单带出，多项或重名必须报该行错误。名称映射失败不能以UUID或“—”代替。预览显示解析后的业务名称，缺映射显示明确不可用并禁止选择。
- 运营列为空或等于当前实名内部操作者displayName；不按CSV文案转派他人。真正responsibleUserId、部门、团队由后端当前actor／membership确定。
- 枚举用当前form-context字典的中文label或完整value精确映射，侵权类型以顿号分隔并去除重复，拒绝未知值或不匹配来源的平台；不把未知值回落为OTHER。是否披露必须明确“是”或“否”。
- 发现时间接受严格有效的 `YYYY-MM-DD`、`YYYY-MM-DD HH:mm[:ss]`（均明确按Asia/Shanghai解释）或带明确offset的ISO时间点；逐项校验日历，不接受溢出、推断本机时区或空值补today。
- 文本、URL、数量、价格、估算和商品至少URL／名称一项沿手工创建／DTO的范围。销量和评论数空白仍使用手工新商品的0默认；单价必须填写，空单价逐行报错“单价不能为空；已知为零请填0或0.00”。明确输入0或0.00是有效零价。非空非法数、负数、小数count、超限、货币分组及非法URL逐行报错，不能静默归零。价格保持十进制字符串，估算复用既有逻辑。此规则仅调整CSV单价语义，不改数据库schema或迁移。
- 商品URL遵既有`LeadProductDto`的http／https、主机、认证及端口规则；不因`new URL`会自动编码而把原含空白地址标为有效，也不把localhost当作满足现有DTO。保留合法域名及IP，不改写原URL来掩盖失败。
- CSV数量／评论的纯数字前导零在词法适配中归一为同一number（例如001为1），不改变后端整数范围；原手工输入正则不在本片修改。单价仍遵既有十进制字符串规则，不沿用count的前导零归一化。
- CSV不上传附件，创建输入中截图数组固定空，禁止reservedLeadId。保留备注的合法换行。疑似重复只标明本文件中完整规范业务输入相同的行，不静默去重，也不宣称查询了全库。
- 技术资源界限：UTF-8文件最多2MiB；最多1000条数据记录（含表头最多1001条records）；最多512列（17＋99×5）。空物理行可明确忽略，含部分值的行不得丢弃。语法／表头错误为整文件失败；业务错误保留为不可选行，允许只选择有效行。

业务适配器固定公开接口：

```ts
type LeadCsvMappingContext = Readonly<{
  formContext: LeadFormContext;
  operatorDisplayName: string;
}>;
parseLeadCsvPreview(bytes: Uint8Array, context: LeadCsvMappingContext): readonly LeadCsvParsedRow[];
createLeadCsvTemplate(context: LeadCsvMappingContext): string;
```

适配器复用既有纯lexer，不包含File／FileReader、HTTP或业务写。读取File和AbortSignal生命周期由宿主负责。模板只输出准确中文17列表头；填写说明放页面，不能往CSV加入必删说明行或自动填入当前客户、实名账号、凭据。

## 原子提交与前端接口

新唯一内部接口 `POST /api/v1/leads/csv-import`，必填 `Idempotency-Key`，CSRF及内部身份沿现有守卫，不新增Action。请求：

```ts
type LeadCsvImportInput = Omit<CreateLeadInput, 'reservedLeadId' | 'leadScreenshotContentVersionIds'> & {
  leadScreenshotContentVersionIds: readonly [];
};
type LeadCsvImportItem = Readonly<{ rowNumber: number; input: LeadCsvImportInput }>;
type LeadCsvImportResult = { items: Array<{ rowNumber: number; lead: LeadBusinessResult }> };
importLeadCsvBatch(items: readonly LeadCsvImportItem[], key: string, options?: RequestOptions): Promise<LeadCsvImportResult>;
```

- 一次明确选择1～20行，rowNumber为2～2097153内唯一整数（物理起始行，允许引号内换行使行号大于记录数），按展示／请求原顺序返回。不自动全选、分批或重试，不以Promise.all单笔create替代事务；超过20明确提示重新选择。
- 单次序列化请求JSON `{items}` 的真实UTF-8字节最多90KiB（92160bytes），前端在HTTP前、后端在事务前明确拒绝超限并提示减少选择条数或内容；这与2MiB文件预览界限分开，不把文件解析成功当全部一次可交。沿用现有共享JSON解析设置，不扩大全局body parser，也不按UTF-16字符数误算中文容量。
- 201表示全部创建成功。单个Serializable事务内复用既有创建授权、客户准入／主体关系、membership／team、标准字段规范、编号、商品／侵权、`lead.created`审计；全部新Lead为WAITING_PUSH、version1、creationChannel=CSV，无推送／确认／客户绑定／附件副作用。
- 使用独立不可变批次回执 `LeadCsvImportReceipt`（部门＋actor＋key唯一），保存完整有序请求、指纹和有序成功快照；不能塞假Lead或借用单条回执行伪装批次。必要新schema／前向migration仅本片所有，不修改已存在SQL或公证migration。
- 首次执行在所有校验通过后才写；任一项、编号／审计／回执失败均整批回滚。安全业务拒绝409 `CSV_IMPORT_REJECTED`，details `{failures:[{index,rowNumber,code}]}`；不可用目标统一NOT_AVAILABLE，不输出外部ID、名称或阶段。DTO结构失败400，认证／权限沿原语义，同键异参409 IDEMPOTENCY_CONFLICT。
- 重放先按保存的原始范围重验当前actor权限及创建结果的精确部门／responsible／team范围，然后比较指纹；同键同请求返回原201快照，不受后续正常阶段变化影响，不重复编号或审计。不能靠修改body删除原请求的失权项。结构损坏回执拒绝；冲突重试只沿既有限次规则，不把未知结果当未写。
- API入口严格校验请求和unknown响应、rowNumber顺序／唯一、lead数量／ID／CSV来源及初始快照锚；成功投影必须包含后端真实新建字段evidenceDecision:null，缺项、额外项和非null值均拒绝。捕获输入／header快照；写请求禁止自动业务／CSRF重试。
- 请求body的金额、文本、时间及侵权顺序保持原值；成功回执按既有后端规范化后的业务等值核对（金额精确到分、时间点毫秒、NFKC.trim文本、无重复侵权集合），不能把合法的格式规范化误判成未知响应。商品和行的对应顺序仍须精确。

## 宿主与正式页面

复用唯一 `LeadCsvPreviewSession` 和既有面板。正式LeadListPage新增“批量导入”和独立未知请求恢复入口，与原单条／批推办理互斥；保留当前query／分页。打开先取真实form-context；actor／授权代次或上下文变化立即abort并失效解析和旧事件。预览用名称而不是UUID，每次明确提交就在本session内重新取selection并调用isCurrentSelection，随后同步冻结原items／key／稳定actor。

宿主只增加技术提交状态：处理中、明确失败、结果待核对；不建审批中心、后台任务或第二业务工作流。成功201才提示真实导入数量并emit imported让列表重取一次；取消提交前零写、失败不清选择。网络／abort／未知响应不清原body/key，只能用户显式原样重放；持久化最小pending到本地既有模式，恢复严格解码并绑稳定actor，拒绝损坏／跨身份。身份或授权变化不接纳旧迟成功，不自动刷新／关闭／产生新key；不保存原CSV字节、File或凭据。路由离开、换文件和重开不得使旧选择或未知请求混入新批次。

宿主props固定为`open/contextKey/formContext/operatorDisplayName/actorIdentity/authorizationGeneration/submitAttempt`；可保留可选的异步`parseFile`测试seam，默认正式实现仍是File读取＋纯adapter，不绕上下文和actor检查。面板同步重验selection后冻结`{actorIdentity,idempotencyKey,items}`，把捕获的context／授权代次和独立signal交页面回调。回调在首个await前核当前身份并写pending，才调用API；返回created／rejected／unknown技术判别。仅首次提交且可确认整体未写入时，明确400 VALIDATION_ERROR、409 CSV_IMPORT_REJECTED等拒绝才可结算pending；401／403／IDEMPOTENCY_CONFLICT、500、解码失败及身份变化均保留原请求，不据此自动换键。恢复请求使用原body／原key，任一400／403／409／500或未知拒绝都不能证明原批次未创建，必须保留原请求和互斥；只有当前身份／授权代次／路由一致并确认真实成功快照后才结算一次。恢复不要求重传CSV，也不用新context改写原items，最终当前权限由后端裁决。

## 唯一文件所有权与执行限制

| Task             | 允许实施文件                                                                                                                                                                                                                                                                               | 禁止争写                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| 原解析Task 5530  | 新 `lead-csv-adapter.ts`／`.spec.ts`                                                                                                                                                                                                                                                       | lexer／model／UI／API／backend  |
| 原预览Task 9784  | `LeadCsvPreviewPanel.vue`／spec；`frontend/src/api/leads.ts`／spec                                                                                                                                                                                                                         | adapter／host／page／backend    |
| 原宿主Task b4e5  | `LeadCsvImportPanel.vue`／spec；新`lead-csv-import-recovery.ts`／spec；`LeadListPage.vue`／spec                                                                                                                                                                                            | preview／adapter／API／backend  |
| 独立批量服务Task | `schema.prisma`；唯一新`20261019090000_lead_csv_import_receipts/migration.sql`；model-owner registry；`lead.service.ts`；新`lead-csv-import.{dto,controller,response.dto}.ts`及dto／controller／service直接spec；`lead.module.ts`；`http-exception.filter.ts`及新直接spec仅CSV错误安全投影 | 公证／旧SQL／frontend／正式文档 |
| Root             | 合同、状态／路线图／验证文档、独占Git、集成与复审                                                                                                                                                                                                                                          | 不代写上述业务实现              |

各Task先核实际基线及差异，Root安全保全旧成果并同步后才写。只运行相关纯单元／组件／HTTP替身合同、静态类型和正常Prisma validate／generate（不连接DB）；迁移仅SQL文本和纯断言。全verify含NT006真实PG，当前禁止。禁止capture、Docker、DB、登录、真实HTTP／浏览器／服务、Grant、迁移执行、ca015／公证更动及push；严禁删除、移动或重建依赖目录／缓存来绕权限。受阻时报告准确动作／目标／错误／是否执行，不换入口冒成功。

本合同记录已批准方向的最小技术实现，实际门禁及数据库／页面验收仍待固定候选。真实验收须另列有限登录、业务行、请求、文件、失败收尾范围给用户明确批准；本轮额度为0。

## 后续有限验收草案（未授权、不得执行）

代码候选完成后，先登记最终HEAD／tree、迁移原字节hash与全部前序账本，不用当前实现进度代替准入。以下是下一单的申请边界，不恢复任何已耗额度，也不是本轮运行指派。

1. 迁移另单：先核当前真实测试库账本和备份／文件保护，再申请隔离owned schema中的空链、旧行保留、失败回滚及原字节重试；通过后才申请一次正常官方部署及独立旧行／权限／文件／sequence对比。不得混入公证迁移、resolve／reset或自动恢复。真实事务回滚／同键竞争需单列有限故障点与请求数；纯单元替身不能顶替。
2. 页面最小单：拟复用经现场证明仍有效的一个既有内部actor及一个既有可见客户／主体，不新建账号、角色、Grant、客户或权利主体。若现有身份不满足当前lead.create范围，先列精确缺口另行确认，不借他人身份或补权继续。
3. 拟申请一次正常登录及退出、一个本地CSV文件含两条有效线索（每条一个商品、一个侵权类型、无截图），先预览／取消零写，再明确选择两条。仅两个批量POST：首次成功201及同body／同key显式重放201。预期仅新增2个Lead、2个商品、2个侵权关联、2条lead.created审计、1条不可变批回执和1个最终正常撤销的session；相关编号计数只增2，不推送、不进入客户确认、不创建Case或服务端文件。
4. 页面证据核对可读客户／主体、原选择顺序、真实列表及详情、刷新后的WAITING_PUSH／v1／CSV与原key快照；重放不得再增编号、Lead、商品、侵权、审计或回执。保留原query／分页。网络未知／丢响应及跨权限场景尚不在此最小额度内，若需要另给有界方案。
5. 运行前由唯一runner把实际对象ID、当前权限、精确请求／文件hash、旧行与全部安全／物理文件基线封入准入证据。任何非预定异常立即停，不重试、不删合成事实、不恢复权限；仅做获准只读收尾并正常退出自己的服务／会话。此草案不授权capture、连接数据库、部署、登录、HTTP或浏览器启动。
