# 结算／费用 Demo 实施矩阵与微合同

依据：冻结的完整对齐合同；实际 `demo/app.js`、`demo/index.html`；M04/M06 仅作索引。最新人工授权覆盖旧 ST 文档中暂缓公式的范围。本文件记录待交付全量，不把当前源码进度视为完成。

| 功能         | 源字段／函数与控件                                                                        | 输入边界、可见结果                                                                                             | 直接验证                                   |
| ------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 案内客户条件 | `custFormula`、`pctFromFormula`、`settleFigures`；客户公式／金额编辑、应用／保存          | 真实 `case.customerId`；0–100% 比例；结案额显式 0；自动额取整数元，手调保留来源；修改本案不改客户档案          | 三种金额来源、0／未知、跨案隔离、非法公式  |
| 案内律师条款 | `lawAgreementOf`、`lawAmountOf`；模式／基础费／比例联动                                   | 全风险基数×比例且基础费0；半风险基础费＋基数×比例；固定仅基础费；手调与自动分开；不能缺律师时选默认律师        | 三模式、比例边界、手调、无律师             |
| 双侧分次     | `settleLogOf`、`settleRemainOf`、`openSettleLaunch`、`pushSettleRecord`；金额／日期／备注 | 两侧独立、默认余额、正额不超余额、日期合法、次数递增；发起记录、中心明细同源，未回填时实收／打款日未知         | 余额并发、重复键、两侧不串、次数、0额拒绝  |
| 中心明细     | `renderSettlementSplit`、`settleFiltered`、`toggleBillSel`                                | 客户／律师两页签、状态／阶段／主体筛选、KPI、空态、案件链接；稳定源行跨筛选保留；已入单不再选                  | 过滤交集、选择保持、跨客户可见范围、空列表 |
| 合并账单     | `openCreateBill`、`createBill`；勾选、账单日／备注／编号                                  | 同侧多来源合计；可跨不同收付方，每项留真实主体／案件／次数；日期与单号唯一、原子占用来源                       | 多主体、重选、编号并发、重复提交           |
| 查看／撤销   | `viewBill`、`cancelBill`；查看、原确认                                                    | 按稳定账单 ID 查；撤销保历史并逐源 ID 清占用，原发起次数／余额不变，可重选                                     | 行重排后精确恢复、重复撤销、历史保留       |
| 费用筛选／列 | `feeFiltered`、`toggleFeeSel`、`toggleAllFeeSel`、列设置                                  | 类型／状态／方向／日期筛选；当前集合全选，跨筛选单选保留；列偏好仅界面状态                                     | 筛选、当前全选、列偏好、空态               |
| 费用源与汇总 | `pushFeeFromSource`、`syncExpenseFromFee`、`mergeSampleFeeRows`、`renderFees`             | 中心与案内明细同一稳定费用 ID；14类型、收入／支出；样品费－退款仅展示净额且不吞别类；真实日期／来源            | 同源更新、净额、0净额、不相关行保留        |
| 费用增改删   | `addFee`、`setFeeStatus`、`bulkLaunchFee`、`bulkDelFee`、案内多行编辑与凭证／备注         | 真实案件、正额、日期、状态；批量发起仅未发起，内部状态表示请求，不冒称财务已接收；删除中心与明细同源且审计保留 | 单条状态、批量混态、同源删除、凭证版本     |

## 固定微合同（首批计算和 DTO 已编码，持久化接线按此落地）

- 金额 JSON 为十进制字符串；`null` 表示未知，`0.00` 是确定零。计算基数先取当前有效结案金额（含 0）；只有未登记结案来源（UNRECORDED）时回退真实诉请金额。已登记但金额待定（PENDING）保持未知，不回退诉请金额。只对合法非负输入在 Demo 的显示点以十进制 `ROUND_HALF_UP` 取整元；发起金额保留分。`customerPercentFromFormula` 读公式中的比例，不执行任意表达式。
- `CaseSettlementTerms` 一案一份、独立 `version`。客户公式为案内快照；律师模式／基础费／比例为案内条款；两侧手调金额 nullable；计算来源 `AUTOMATIC`／`MANUAL` 明示。无律师时律师发起不可用；不选默认律师。案件 `customerId` 为唯一客户关联。
- `CaseSettlementLaunch` 是发起的唯一源行：UUID、`caseId`、`departmentId`、`side`、`nth`、`amount`、`launchDate`、`note`、实际 `customerId` 或 `lawyerId`、创建人／时间、可空当前 `billId`。同案同侧次数唯一。余额按该表原发起金额累计；账单撤销不减少累计。尚无财务回填，实际收付／开票日期为 `null`。
- `SettlementBill` 用 UUID 身份和独立唯一业务 `billNo`；`SettlementBillItem` 保存每个稳定 `launchId`、真实收付方、案件、次数、金额快照。账单撤销保 `cancelledAt`／原因与 items，原 launch 的当前 `billId` 清空；不按列表位置恢复。
- `FeeRecord` 用 UUID、真实案件与部门、14类之一、方向、状态、金额／日期、来源、备注、凭证材料版本及删除／发起时刻。案内和中心读同一行；费用“发起”是本地请求状态，外部财务成功／真实支付仍未知。
- 已登记 Action `settlement.read`、`settlement.terms.update`、`settlement.launch`、`settlement.bill.create`、`settlement.bill.cancel`、`fee.read`、`fee.create`、`fee.update`、`fee.launch`、`fee.delete`。仅登记权限目录与严格枚举；无角色默认 Grant。
- 路由前缀 `/api/v1/settlements`：`GET /cases/:caseId`、`PUT /cases/:caseId/terms`、`POST /cases/:caseId/launches`、`GET /launches`、`GET /bills`、`POST /bills`、`GET /bills/:billId`、`POST /bills/:billId/cancel`。费用 `/api/v1/fees`：`GET`、`POST`、`PATCH /:feeId`、`POST /launch`、`POST /delete`。结算条件、发起、账单、费用创建/批次与凭证命令带原请求键；费用状态/备注使用版本CAS，结果未知时只读刷新核对。新增 `GET /bill-number-preview`、`POST /fees/case-entries`、`POST /fees/:feeId/proof`。HTTP与数据库实际验收尚未执行。

共享模型、权限及费用来源/凭证已分批审查提交；迁移按稳定目录名与raw哈希识别，部署序号另行记录。证物后端已由原Owner接入，AppModule注册EvidenceModule；证物前端路由/菜单待其固定候选。旧客户结算台账 CU008 不迁作发起累计，律师发票门户 REQ-ST-005 不由费用凭证代替。

## 2026-10-17 本地候选与验收边界

- 已编码完整结算/费用本地范围：案内双侧条款与精确试算/手调、分次发起、中心全量筛选集合/跨页选择、同侧多主体账单及精确撤销；中心/案内同源费用、14类型/独立方向/状态、样品净额、列偏好、单行备注/移除、多行原子新增、真实精确CV凭证与文件名。
- KPI沿实际Demo：当前侧/当前案所有记录统计；筛选只限制列表、匹配计数和全选。真实财务开票、收付与日期未知保持null，不推断外部成功；费用凭证不等于律师账单发票门户。
- 原请求在浏览器会话按账号+部门+对象保存；响应不明时恢复原body/key并再次由后端授权。费用来源UUID与账单来源UUID稳定，保存/撤销不使用数组位置。旧CU008台账与原案件事实保持。
- 当前证据为定向单元、真实组件挂载、运行时DTO/API decoder、类型/Lint/构建；实际PG约束、授权并发、迁移回放、真实blob/浏览器点击均未执行。不能用前述证据称完整产品已验收。
- 当前候选基线包含已审共享、证物后端与原notary双initializer；本轮不修改原notary/EvidenceBackend/EF模块源。最终组合仍需主控接稳定证物前端及EF修复并交唯一Runner验收。
