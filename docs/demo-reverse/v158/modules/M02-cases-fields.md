# M02 案件字段与关联字典

仅记录 v158 Demo 运行时形状，主流程见 [M02-cases](M02-cases.md)，正式候选见 [M02-cases-candidates](M02-cases-candidates.md)。`A:Lx–Ly` 均对应固定指纹的 [app.js](../../../../demo/app.js)；完整出现点／动态配置在 [FIELD-INDEX](../FIELD-INDEX.md) 和 [FORM-INDEX](../FORM-INDEX.md)。分组是阅读组织，不是已确定的表拆分。

## 类型与空值通则

Demo 没有数据库 schema；下表的 string/number/object/array 不是数据库类型。字段常在阶段操作后才追加，缺失、空串、`—`、零并存；日期多数为字符串，金额同时有 number、原始输入 string 和 `¥` 格式 string。最大长度、精度、时区、币种、唯一约束、外键、版本号均 UNKNOWN，不凭种子推断。共享 `numOf` 去掉负号，阶段 `Number` 则保留负数（A:L400、2682–2684）。

## 核心、参与者与关联

| 字段                                           | 源码含义／类型／校验                                                                                                                      | 证据                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| id / caseNo / no / mediateNo / execCaseNo      | string；新建 id=caseNo 为生成单号，no 空；但阶段及一审编辑把“案号”写 caseNo；一审展示却把 caseNo 当诉调号、no 当案号；执行独立 execCaseNo | A:L6270–6279、1307、6751/6758、6778、12867–12909 |
| title                                          | 权利主体 vs 店铺 + 侵权类型派生，新建／合并生成；后续编辑不保证重算                                                                       | A:L6273–6277、6473、6693                         |
| cust / client                                  | 客户／权利主体 string；新建必填，自由输入；旧案客户回退 client；编辑可清空                                                                | A:L6253–6257、6280–6282、6664–6693               |
| type / typeTag                                 | 案件类型及展示标签；默认民事；配置 CASE_TYPES，不是从样例枚举                                                                             | A:L11、6264、6283                                |
| reason                                         | 侵权类型，主要顿号 string，兼容历史 array；新建默认商标权且未标 required                                                                  | A:L6258–6259、6322、6484、6666                   |
| operator / opInitial / opColor                 | 运营人名与 UI 样式；默认陈晓敏；不是账号或数据范围权限                                                                                    | A:L6265、6289–6290                               |
| status / stageCls / statusClass / updated      | 16 个阶段；样式历史两种键并存；updated 可能日期或“刚刚”；新建可选任意初始阶段                                                             | A:L65–313、1266–1382、6266、6291、4023–4026      |
| defendant / defendants[]                       | 前者旧字符串，后者结构化数组；列表优先后者；姓名非空即可通过 hasDefendantInfo                                                             | A:L6263/6284、2783–2787、2820–2822               |
| defendants[].kind/name/idno/phone/addr/extra   | 自然人／法人个体切换；补充入口要求姓名、证件、电话、住所非空，不做真实性校验；卡片编辑仅跳过空名，可保留其余空值；没有被告 ID             | A:L1741–1848、6545–6627                          |
| defendants[].org/idcard/credit                 | 编辑兼容旧键，收集后统一写 name/idno；不是三套新实体                                                                                      | A:L6549–6551、6579–6583、6619–6624               |
| shop / shopId / platform / source              | 店铺、标识、平台、来源 string；可能来自案件、被告解析、公证、线索的不同回退；新建不要求店铺，平台下拉不随来源联动                         | A:L6260–6262、6285–6286、6724–6735、12747–12848  |
| notaryId（案件）／caseId（公证、证物、公证书） | 公证先按 notaryId、caseId，再店铺包含回退；线索直接按店铺匹配。公证 fromLead 属于 M01 移交字段，不冒充此处案件键；M03/M05 继续核对创建端  | A:L12747–12848、6710                             |
| mergedFrom[] / mergedCaseNos[]                 | 来源案件 JSON 深拷贝快照／原单号列表；不是活动案件外键；来源被移出 STATE.cases                                                            | A:L6492–6526                                     |
| mergedInto（公证侧）                           | 指向新合并案件 id；新增 N-MERGE 归档记录承载来源客户／主体／店铺等                                                                        | A:L6506–6520                                     |

## 阶段字段（下列每个键均为实际配置或写入字段）

星号只表示对应阶段提交代码的 required，不表示全局不可空；卡片编辑、批量入口另有规则。

| 阶段／数据组   | 字段与业务标签                                                                                                                                                                                              | 默认、形状和约束／证据                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 律师匹配       | matchAt 匹配日；lawyer 姓名；lawyerPhone 电话；lawyerFirm 律所；lawyerAddr 地址；lawyerSettleMode 模式；lawyerBaseFee 基础费；lawyerSplit 分成                                                              | 单条配置全部未 required；全风险／0／30% 默认。批量要求律师非空、全风险基础费强制 0。A:L1267–1277、7435–7501                                                   |
| 起诉材料       | draftAt 上传日；authDoc 单文件兼容值；authDocs[] 多文件名；draftNote 预览修改文本；amount 标的额                                                                                                            | 初始 amount='¥ 0'；单值阶段编辑与数组卡片／ZIP 写入并存；批量上传同步两键。A:L1279–1288、3123–3129、6287、6788–6790                                           |
| 邮寄           | sealRecvAt 单案标签“邮寄日期”；mailAt 批量邮寄日期；confirmDisclose 批量确认是否披露下载                                                                                                                    | 不同键，未统一；批量日期与披露选择必填，单条 sealRecvAt 不 required。A:L1290–1294、3158–3182、3261–3280                                                       |
| 提交立案       | court* 立案法院；submitAt* 提交日期；amount 标的额；filingShot 立案截图；mediateNo 诉调号；evidence 证据材料                                                                                                | 文书／截图仅文件名值；单条 required 检查 trim，批量 normBlank 法院检查更严格。A:L1295–1303、2641–2646、3514–3521                                              |
| 正式立案／开庭 | formalAt 正式日期；caseNo 案号；payList 缴费清单；payDeadline 截止日；acceptNotice 受理通知；hearingAt 开庭日；serviceDoc 送达文书；hearingPlace 地点；judge 法官；discloseInfo 披露数据；disclose 披露附件 | 均未 required；不是与公证 n.discloseInfo/n.disclose 共用的数据。A:L1304–1320、12871–12874                                                                     |
| 调档／披露文件 | filingDocs[] 调档文件名；disclosures[]{name,ext,size,status} 披露材料元数据                                                                                                                                 | 卡片上传／删除或编辑；披露默认已上传、首个待确认，size 为 —；不含二进制。A:L6736–6739、6775/6793–6795、12875–12881                                            |
| 自动开庭推进   | autoToJudgeAt 开庭次日；CAL_EVENTS 的 date/type/autoCourt/caseId/title/sub/time/place/judge                                                                                                                 | 同案件旧自动开庭事件替换；清空开庭日直接返回，不删旧事件。A:L2744–2777、4033–4046                                                                             |
| 一审判决       | judgeGotAt*收到判决日；judgeAmt判决额；paidFee实缴诉讼费；judgeDoc*判决书；judgeReady布尔分支标记                                                                                                           | 金额Number转换后假值回退0，无正数约束；二次确认才保存；卡片编辑不要求日期／文书。A:L1324–1331、2232–2272、6798–6819                                           |
| 诉讼退费       | refunds[]{from,amt,status}；refundTotal                                                                                                                                                                     | from 被告／法院；amt 只保存 >0；五个状态待退、已提交、已退未结算、已结算、已回款；无行 ID。A:L2151–2205、2262–2266                                            |
| 二审选择       | secondInstanceBy 展示文本；secondInstanceAppellants{role,names[]}                                                                                                                                           | role plaintiff／defendant，后者至少选一被告名；名字不是被告 ID；原告 names 为空。A:L2318–2376                                                                 |
| 二审过程       | secondDoc 文书；secondHearingAt 日期；secondHearingPlace 地点；secondServiceDoc 送达文书；secondJudge 法官                                                                                                  | 无必填，保存不流转；日历另用 autoSecondCourt 标记。A:L1333–1340、2392–2436、2763–2777                                                                         |
| 二审结果       | secondResult；secondJudgeGotAt*；secondJudgeDoc*；secondJudgeAmt；secondPaidFee；secondRefunds[]                                                                                                            | 结果发回重审／改判／维持原判；另派生二审进行中。改判才填金额；仅原告上诉显示退费，其他清空数组。A:L2379–2387、2440–2512                                       |
| 执行准备       | execDraftAt 上传日；execDoc 申请材料；execConfirmAt 确认日；execMailAt* 邮寄日                                                                                                                              | execDoc 在文件名、textarea、批量识别前 2000 字之间漂移；确认日空默认今天。A:L1342–1355、1864、3353–3357                                                       |
| 执行立案       | execSubmitAt 提交日；execFilingShot 截图；execShot 历史回退键；execFormalAt 正式日；execCaseNo 执行案号；execFormalDoc 执行文书                                                                             | 均未 required；强制执行 UI 仅保存，不自动转待归档。A:L1356–1368、1884–1911、6841–6848                                                                         |
| 保全           | preserveDoc 文书；preserveAt 日期；preserve 历史种子展示字段                                                                                                                                                | 登记无必填；保全费／保费只读汇总费用明细，不另写本对象金额。A:L65–313、4913–4947                                                                              |
| 结案           | closeAt 结案日；closeAmt 结案额；closeDoc 文书；payType 一次性／分期；needSettle 是／否                                                                                                                     | 阶段无 required；批量结案金额为 string，阶段为 number；详情结案日却读 logTime，金额先读 ov。A:L1369–1379、3942–3948、13066–13110                              |
| 收付款         | payments[]{date,amt,payer,payee,proof}；paidTotal                                                                                                                                                           | 任一字段非空就留行，不要求金额正数；阶段 amt 为 number，批量为 string；一次性选择会裁掉第二行起，但初次打开保留旧多行。A:L2514–2675、3936–3946                |
| 结算派生／覆盖 | custSettleAmt/custSettleManual；lawSettleAmt/lawSettleManual                                                                                                                                                | 从 settleFigures 派生，手工标记可保留调整；整数舍入，零金额可回退 amount。完整公式／账单在 M06 继续，不能凭已归档判定真实结清。A:L2687–2692、5497–5516、13110 |
| 归档           | archiveAt 日期；archiveType 类型；archiveReason 原因                                                                                                                                                        | 归档对话框原因 trim 必填，日期／类型可回退；编辑跳已归档不要求这些值。A:L3881–4015、6677–6700                                                                 |

## 嵌套明细、展示派生与临时数据

- `expenses[]{name,amt,status,proof}`、`links[]{title,url,qty,price,cmt}`、`log[]{state,time,actor,title,desc}`、`ov{}` 在 `caseExtras` 生成（A:L949–1031）。**真实新建也调用它**，所以新案可能自动拥有模拟被告、费用、商品、时间轴；不能视为实际发生的业务或正式默认值。
- 费用增删、STATE.fees 关联和业财状态属于 M04，结算公式／人工覆盖／BILLS 属于 M06；本模块只登记调用和使用字段。全量字段出现点仍保留在 FIELD-INDEX，不将跨模块缺口当已解决。
- `timeline[]{t,d}` 由 pushCaseTimeline 写入（A:L3978–3981）；页面时间轴却读 `log`（L4950–4959）。pushLog 追加并重置 active（L6889–6895），手动沟通记录另写 log（L4972–5017）。不是统一可靠审计日志。
- `ov` 为概览覆盖／历史派生域，判决、执行和结案读取有回退：`judgeAmt,execCaseNo,closeAmt,paidBack,payType`（A:L6804、6843、13067–13101）；不能因同标签出现就合并字段。其他覆盖键的完整出现点见 FIELD-INDEX，语义不足为 UNKNOWN，后续 M06/M08 核对金额归属。
- `SECOND_UPDATE_PENDING[id]` 为二审提交到选择结果之间的内存草稿；`CUR_STAGE_CASE_ID`、`SELECTED`、`FILTER` 和列设置为界面状态，不是业务实体。FILTER 包含关键词、阶段／阶段组、运营、类型和高级过滤，见 A:L1394–1505；弹窗取消／重开对草稿的完整恢复行为尚未实测。
- `FILE_OF` 与动态文件目录按文书字段生成，真实存储并未统一；生成下载内容见 A:L12394–12617。旧文件名、自动演示文件和新选文件必须区别记录，不能导出后就声称原文被保存。
