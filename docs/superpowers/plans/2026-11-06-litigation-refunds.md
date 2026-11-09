# CORE-OPS-005 诉讼退费实施计划与接口协调

用户2026-11-06已批准实施，只在开发／隔离合成验收环境工作，不推送、不合并main、不部署、不自动授予真实账号权限。基线main `550f2b4867bc5a55f480a2bfe60735f18380c2cd`；根集成分支 `codex/litigation-refunds-20261106`。之前全部优化、281迁移和证据保留。

## 已确认业务

- 结算中心客户结算、律师结算、费用中心之后新增诉讼退费。指定Demo `D:/工作项目/品维and知产/dev_cor/demo/诉讼退费-操作展示.html` 仅作参考，不取D盘旧应用代码。
- 判决后即可在案件内登记明确退费事项；来源为本案有效一审／重审判决或二审结果。支持同案多笔及不同审级，复用原清单和金额，不从所有案件／缴费／申请自动造事项。
- 本页只改状态和逐项跟进备注，原事项说明、应退金额、方式不在跟进中编辑。案件内登记入口可更正已登记资料，必须原因和新版本，不能改旧事实。
- 沿用UNKNOWN及六明确状态；法院不得转成本。SETTLED是客户已收公司未收，RECEIVED是公司已收的登记状态，实际资金事实独立。本批不建部分到账、核销或流水。
- 归档后有权运营可以填写原因更正状态；原归档快照、案件阶段／版本、归档日期保留，不自动解档／新增财务复核或流水。
- 统计按授权范围内全部筛选匹配记录的登记应退金额；未知金额不当0。未退合计PENDING+SUBMITTED，待结算RETURNED_UNSETTLED，筛选合计包括全部状态；记录数按退费笔数，不冒称去重案件数。
- 合案原账仍按原caseId/itemId，不复制到主案。来源缺失或撤销显示真实状态，不猜配，不删除历史。新清单版本不能丢失原有效来源关联。

## 唯一写集与依赖

采用独立工作区；每个工作区一个写入者。Backend Sol独占backend（schema／新迁移／权限／病例退费服务／XLSX／OpenAPI／后端测试）、本轮PG E2E与support；Center Luna独占前端api/litigation-refunds、api/organization目录同步、结算中心新面板和SettlementCenterPage/AppShell接入及相应测试；Case UI Luna独占案件登记面板、CaseDetailPage接入和源关联读投影及其测试。根独占计划、Spec／Decision／状态／路线图／快照、统一数据库／构建／浏览器验收和集成。

高风险源码／迁移由未参与实施的Sol独立审查。后端契约如需变动先报根协调，前后端不各自加兼容层。所有DB／端口操作由根串行，worker不操作共享库或测试服务器。Worker只跑本工作区聚焦单元、组件和静态检查，保存真实命令与结果，不重跑无关全套。

## 统一接口契约（相对/api/v1）

接口归cases退费域，避免结算模块直接写病例私有表；原结算context契约保留，新模块使用独立context。状态取现有7个英文值；金额为已规范两位小数字符串或null。remark可空，description仍为原事项说明。

`RefundRow`：

```ts
{
  caseId: string; itemId: string; inventoryVersionId: string;
  caseNo: string; plaintiff: string; defendant: string;
  courtNo: string | null; lawyer: string | null;
  party: 'COURT' | 'DEFENDANT'; amount: string | null;
  status: RefundStatus; description: string; remark: string | null;
  archived: boolean; archiveStatus: RefundStatus | null;
  canFollow: boolean; canRecord: boolean;
  source: null | {
    type: 'JUDGMENT' | 'SECOND_INSTANCE_RESULT'; id: string;
    trialRoundId: string; label: string; valid: boolean;
  };
}
```

列表来源按原case/item最新有效清单，精确历史保留inventoryVersionId；不把UUID截断当业务单号。

- `GET /cases/litigation-refunds/context` → `{read, record, follow, export}`四布尔能力，不凭角色名称放行。
- `GET /cases/litigation-refunds`：`plaintiff, defendant, courtNo, lawyer, status, page, pageSize`；文本AND、trim、忽略大小写，默认20／页、最多100。返回`{items,total,page,pageSize,summary,asOf}`；summary为`{unrefundedAmount,unrefundedCount,pendingSettlementAmount,filteredAmount,unknownAmountCount}`。三个金额字符串是已知金额合计，unknownAmountCount>0时界面明确“另有N笔金额待定”，不把它们冒称全部准确金额。
- `GET /cases/litigation-refunds/export`：同文本／状态筛选，无分页，真实XLSX九列，固定默认字段顺序；不随勾选或隐藏列改变。不能静默截断。实现容量保护时必须明确超限错误，不能声称导出全部却只写当前页。
- `GET /cases/litigation-refunds/:caseId/workspace` → `{caseId,inventoryVersionId:string|null,canRecord,canFollow,sources,items}`。sources为本案可登记的有效来源`{type,id,trialRoundId,label,courtNo}`数组，items为RefundRow数组。无有效判决不伪造来源。
- `GET /cases/litigation-refunds/:caseId/items/:itemId` → 当前RefundRow，重新核授权。
- `POST /cases/litigation-refunds/:caseId/items`：`{itemId,expectedInventoryVersionId:string|null,sourceType,sourceId,party,amount:string|null,description,reason,idempotencyKey}`。新明示事项初始PENDING；不自动确认全案清单完整。
- `POST /cases/litigation-refunds/:caseId/items/:itemId/corrections`：登记资料更正，字段同上但itemId在URL；保存原因，重校来源，金额／对象／说明改变沿原完整性规则恢复待确认，不允许在第四板块改金额。
- `PATCH /cases/litigation-refunds/:caseId/items/:itemId/follow-up`：`{expectedInventoryVersionId,status,remark:string|null,reason:string|null,idempotencyKey}`。归档案件reason必填。只改此项status和独立remark，复制同案其他事项并重验最新清单版本，保留原金额／对象／说明／完整声明。
- 上述三写命令返回`{commandId,inventoryVersionId,item:RefundRow}`。
- `GET /cases/litigation-refunds/:caseId/requests/:key`：回查当前身份的写回执，返回同一命令结果；无回执404，权限／归属变更不能泄露旧结果。

接口JSON拒未知字段，409表示版本或同key异body冲突。500／超时先读回执，再用原body/key恢复，不自动换键。新receipt保留原退款JSON协议，不将note塞入旧精确投影。

## 权限

新增CASE_REFUND_READ(case.refund.read)、CASE_REFUND_RECORD(case.refund.record)、CASE_REFUND_FOLLOW(case.refund.follow)、CASE_REFUND_EXPORT(case.refund.export)。读取／导出支持DEPARTMENT，登记／跟进支持SELF与DEPARTMENT，无TEAM；通过现有角色授予边界控制，不自动回填Grant。

普通运营查看本部门、本人负责办理；DEPARTMENT写必须明确对应新动作授权。case.department.proxy、fee.update、case.refund.application.record均不隐式授予此模块能力；外部账号不自动开放。列表／统计／详情／导出同一范围，写入重新检查内部有效身份、部门、当前负责人／授权版本，重放也重新核权。

## 数据实施约束

- 保留原case_refund_inventory_versions/items作为唯一应退金额和状态事实。稳定逻辑身份caseId+itemId，精确引用含版本，防止删除后复用ID串历史。
- 新建最小独立命令回执／逐项备注／明确来源关联，允许复用一张不可变命令表表达；不得复制金额或造另一套退款台账。旧CaseSupplement REFUND_SOURCE_LINK仍有效可读，新版本可追溯延续；不得改旧补录行。
- 原stage和同事务父结算更新guard需要新增前向迁移打开严格限定的新命令路径，不能删除全局校验或伪造旧父回执；原结算更新及归档准备规则照常运行。
- 归档历史snapshot继续引用当时精确版本；当前跟进版本可变新，不修改旧归档事实，不改案件version。判决前无有效来源拒登记，金额更正不自动收付款。
- XLSX复用现有lead-workbook.ts的fflate/OOXML封装，九列字符串按文本、金额按两位小数数值。必要的小型共用封装可以提取，但须复验原线索模板73列；不新增无必要依赖或导出平台。

## 分批验收

1. 数据／独立命令：先聚焦纯规则、权限、DTO和服务单测；真实PG空链／281保留升级、前驱漂移失败回滚、SQL绕过、源审级／撤销、同案多项并发、回执失败原子回滚、未知结果原body/key恢复、归档snapshot不变。
2. 页面：14条Demo预期统计（未退95400／9笔、待结算11500、总118800），四筛选、清选择／重置差别、列显隐、真实分页／全量XLSX、保存刷新、UNKNOWN/null/零、法院转成本拒绝、归档原因及权限。
3. 集成：真实API登记判决后未结案事项，两个审级多项不串，状态备注不改结案／费用／付款，后续原结算更新能继续、归档前核查仍严格，归档后更正留史。两入口病例页与原三板块、线索模板回归；1440/1280/窄窗截图。

既有8807等结果仅在输入仍适用时复用；新增金融权限和迁移必须实际PG验证。完整终态旧cleanup故障保留，不能盲目重试或为验收清空原手测库。最终稳定候选按项目风险门禁集中执行，失败只补受影响范围。
