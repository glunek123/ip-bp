# KL 日历与日期事件

日历表达业务来源事件，不提供未经确认的法定期限、自动撤诉、自动续约或通知承诺。主链自动推进由REQ-CA-008负责。

依据：[固定事实](../../../demo-reverse/v158/modules/M07-calendar.md)、[候选](../../../demo-reverse/v158/modules/M07-calendar-candidates.md)、[决定](../../../demo-reverse/v158/DECISIONS.md)和[纠偏](../../../demo-reverse/v158/CORRECTIONS.md)。字段见[领域模型](../DOMAIN.md)，B/T/E见[缺口](../GAPS.md)，通用技术设计见[TD-BASE-05／TD-TRACE-UX-01](../TECHNICAL-DESIGN.md)。SD-53批准下述真实来源读取切片，已完成本地组合验收、已集成main；实际证据与边界见[验证记录](../VALIDATION.md#日历与人工台账组合2026-10-13本地验收完成待集成)，不需要新表或迁移。提醒与手工节点仍未完成。

## REQ-KL-001 事件来源、变更与取消

- 状态：真实开庭／协议到期读取按SD-53已本地验收；其他来源待审核。来源：K-C01 K-C02 FIX-05 FIX-25。字段组：KL01/CA05/CA08。
- 目标／动作与结果：自动事件明确关联来源与案件，日期修改／清空同步更新／移除该来源事件及派生触发，其他事件保留。事件跳转使用明确关联，不用案号或标题猜首案；缺展示信息保留未知。
- 异常、边界及待决：历史快照或当前档案展示、手工事件维护、过期事件和推进后更正见BQ-08/BQ-11；提醒调度由T04设计。
- 依赖：BQ-08/BQ-11/T01/T04；所有操作者和数据范围受REQ-XM-001约束，失败／批量／重复处理结合REQ-SH-004。
- AC-KL-001：**给定／操作**：同案已有自动开庭事件D及非该来源事件，将开庭日D改E后再清空。**预期**：D自动事件消失，E再被移除；旧推进触发也失效，非该来源事件不变；不会按同名案件跳错。

## REQ-KL-002 提醒和统计范围

- 状态：可见日期事件统计按SD-53已本地验收；提醒范围仍待审核。来源：K-C03 K-C04。字段组：KL01/RP01。
- 目标／动作与结果：SD-13确认客户可看本企业案件日历、律师可看本人负责案件日历；运营按当前有效Grant。已确认规则派生的下一步、缺件和提醒在原案件详情或日历／待办入口展示，保留来源日期／规则和责任人；同一来源去重，案件转派时未完成事项随新责任人更新。提醒与阶段、任务、材料齐备和资金状态分别表达。
- 异常、边界及待决：没有明确来源日期或批准规则时不猜期限；不新增第二套工作台、流程状态或日报。是否新增通知渠道／接收人及统计口径见BQ-08/BQ-11，未确认项不阻断其他就地提示。
- 依赖：BQ-03/BQ-08/BQ-11/T03/T04；所有操作者和数据范围受REQ-XM-001约束，失败／批量／重复处理结合REQ-SH-004。
- AC-KL-002：**给定／操作**：同一来源产生重复提醒后转派案件；另查看没有可靠截止日的种子式逾期文字。**预期**：同一来源只保留一个未完成提醒并转给新责任人；不猜截止日期，不声称已发送通知或执行撤诉，案件阶段不因提醒改变。

## CORE-KL-001 当前来源读取合同（SD-53）

本轮仅投影当前有效来源：`Case.currentHearingArrangement`的一审日期、`Case.currentSecondInstanceProgress`的二审日期及`CustomerAgreement.currentVersion`中FIXED且非空的`effectiveTo`。同案一审／二审分别以来源类型与事实ID去重；旧版本不作为并列现行日程。日期为空时无事件，清空一条来源不移除其他来源。协议事件只有customerId，没有caseId；未知时间、法院、法官、费用等字段用null，不按Demo种子或文件名补造。

内部案件来源复用当前`case.read`部门读取授权；律师仅当前启用账号、绑定及有效PRIMARY承办案件；客户仅本人启用且ADMITTED企业、同部门且诉状确认非空的既有可读案件。公证处拒绝访问日历。协议来源只供同时拥有`customer.read`和`customer.agreement.read`的内部账号，查询取两权限scope交集并排除已删除客户；律师／客户及缺权内部账号的协议类别为FORBIDDEN。客户案件提示仅含已批准的客户最小可读字段，不带内部法院／法官／案情／金额等额外详情。每次请求重验当前授权，汇总前完成来源筛选。

接口为`GET /api/v1/calendar?month=YYYY-MM`与`GET /api/v1/calendar/summary`。月份必须是真实1～9999年月份且不接受其他查询字段。响应固定`today`（上海日期）、`timeZone=Asia/Shanghai`、`window={from:today,through:today+30}`及五个`metrics`（next30/court/pay/contract/other）；月接口另有month和events。指标`AVAILABLE`时count为非负整数、nearestDate为最早不早于today的来源日或null；`FORBIDDEN`／`NOT_CONNECTED`时两值均null。court／contract分类数量来自全部当前授权来源，不随月份切换；next30只计同一可见且已接入集合的窗口内事件，始终AVAILABLE，不表示尚未接入或无权类别的完整待办总数。pay／other本轮固定NOT_CONNECTED，显示“未接入”而不是0。

事件具有唯一`eventKey=sourceType:sourceId`，sourceType为FIRST_INSTANCE_HEARING、SECOND_INSTANCE_HEARING或CUSTOMER_AGREEMENT_EXPIRY；date为真实YYYY-MM-DD，type分别court／contract。包含title、nullable sub、caseId、customerId以及nullable courtDetails／caseDetails。月列表只含请求月份，按date再eventKey稳定排序。案件链接使用原caseId，按身份跳转原案件详情；无caseId的协议事件不得猜案跳转。前端严格校验未知响应，切换月份或身份时取消并忽略旧响应，401／403清除敏感旧投影；失败不伪装空列表。

- AC-KL-003：**给定／操作**：当前一审／二审同案不同源，协议有效期当前版为FIXED；切换月份并修改／清空一个来源。**预期**：仅正确月份显示各当前源；五卡分类总数稳定，下一次读取仅替换／移除对应源，旧版不重复。
- AC-KL-004：**给定／操作**：跨部门、非当前律师、其他企业客户、停用／撤权账号及协议scope不相交账号读取月份与统计。**预期**：不可读案件不可泄露事件／数量；无权协议类别保持FORBIDDEN/null，pay／other保持NOT_CONNECTED/null，客户不收到内部提示字段。
- AC-KL-005：**给定／操作**：上海当天、30日后和31日后各有可见事件，包含空日期、没有未来事件及快速月／身份切换。**预期**：窗口两端计入、31日后排除；最近日期只取当前未来来源；null不当0，旧请求不覆盖新月份／身份，错误可重试，精确caseId链接不猜案。
