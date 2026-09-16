# 表单配置与动态字段绑定

固定版本、模块编号和解释边界见 [INVENTORY.md](INVENTORY.md)。行号为原文件物理行（1 起）。本附录是全文阅读后的机械漏项索引，不是完整语义提取或已批准需求。

## k 或 key / label 配置对象

源码：[app.js](../../../demo/app.js)。type 是控件类型；required 未声明不等于可选（提交函数可能另行校验），options 是当前配置而非正式枚举全集；完整校验留待模块提取。

| 模块 | 容器             | 行    | 键                   | 标签                                 | 控件             | required | options                                                                                                                   | dflt 或 value                                                                                      |
| ---- | ---------------- | ----- | -------------------- | ------------------------------------ | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| M02  | STAGES           | 1269  | 'matchAt'            | '匹配日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1270  | 'lawyer'             | '律师姓名（从律师库选择）'           | 'lawyer'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1271  | 'lawyerPhone'        | '律师电话'                           | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1272  | 'lawyerFirm'         | '律所名称'                           | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1273  | 'lawyerAddr'         | '律师地址'                           | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1274  | 'lawyerSettleMode'   | '律师结算模式'                       | 'select'         | 未声明   | LAW_SETTLE_MODES                                                                                                          | '全风险'                                                                                           |
| M02  | STAGES           | 1275  | 'lawyerBaseFee'      | '基础费（元）'                       | 'number'         | 未声明   | 未声明                                                                                                                    | '0'                                                                                                |
| M02  | STAGES           | 1276  | 'lawyerSplit'        | '分成比例'                           | 'select'         | 未声明   | PCT_OPTIONS                                                                                                               | '30%'                                                                                              |
| M02  | STAGES           | 1281  | 'draftAt'            | '上传诉状日期'                       | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1282  | 'authDoc'            | '授权委托书 / 起诉状'                | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1283  | 'amount'             | '标的额（元）'                       | 'number'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1287  | 'amount'             | '标的额（元，可修改）'               | 'number'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1288  | 'draftNote'          | '在线预览并修改'                     | 'textarea'       | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1293  | 'sealRecvAt'         | '邮寄日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1297  | 'court'              | '立案法院'                           | 'select'         | true     | COURTS                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1298  | 'submitAt'           | '提交立案日期'                       | 'date'           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1299  | 'amount'             | '标的额（元，同步可修改）'           | 'number'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1300  | 'filingShot'         | '立案截图'                           | 'image'          | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1301  | 'mediateNo'          | '诉调号 / 立案编号'                  | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1302  | 'evidence'           | '证据材料'                           | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1306  | 'formalAt'           | '正式立案日期'                       | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1307  | 'caseNo'             | '案号'                               | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1309  | 'payList'            | '缴费清单'                           | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1310  | 'payDeadline'        | '截止缴费日期（自动生成日历提醒）'   | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1311  | 'acceptNotice'       | '立案受理通知书'                     | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1312  | 'hearingAt'          | '开庭日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1313  | 'serviceDoc'         | '送达文书'                           | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1314  | 'hearingPlace'       | '开庭地点'                           | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1315  | 'judge'              | '承办法官'                           | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1318  | 'discloseInfo'       | '披露数据'                           | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1319  | 'disclose'           | '披露数据附件'                       | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1326  | 'judgeGotAt'         | '收到判决日期'                       | 'date'           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1327  | 'judgeAmt'           | '判决金额（元）'                     | 'number'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1328  | 'paidFee'            | '实缴诉讼费（元）'                   | 'number'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1329  | 'refunds'            | '诉讼退费（可多笔）'                 | 'refunds'        | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1330  | 'judgeDoc'           | '判决书（上传自动识别金额）'         | 'file'           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1335  | 'secondDoc'          | '二审文书'                           | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1336  | 'secondHearingAt'    | '二审开庭日期'                       | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1337  | 'secondHearingPlace' | '二审开庭地点'                       | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1338  | 'secondServiceDoc'   | '二审送达文书'                       | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1339  | 'secondJudge'        | '二审法官'                           | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1344  | 'execDraftAt'        | '上传执行材料日期'                   | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1345  | 'execDoc'            | '执行申请材料'                       | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1349  | 'execConfirmAt'      | '确认日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1350  | 'execDoc'            | '执行申请材料（预览/修改）'          | 'textarea'       | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1354  | 'execMailAt'         | '邮寄日期'                           | 'date'           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1358  | 'execSubmitAt'       | '提交执行立案日期'                   | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1360  | 'execFilingShot'     | '执行立案截图'                       | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1364  | 'execFormalAt'       | '执行正式立案日期'                   | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1365  | 'execCaseNo'         | '执行案号'                           | 'text'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1367  | 'execFormalDoc'      | '执行文书'                           | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1371  | 'closeAt'            | '结案日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1372  | 'closeAmt'           | '结案金额（元）'                     | 'number'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1373  | 'custSettleAmt'      | '客户结算金额（按结算条件自动计算）' | 'settleCalc'     | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1374  | 'lawSettleAmt'       | '律师结算金额（按律师协议自动计算）' | 'settleCalc'     | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1375  | 'payType'            | '付款类型'                           | 'select'         | 未声明   | ['一次性付款', '分期付款']                                                                                                | 未声明                                                                                             |
| M02  | STAGES           | 1376  | 'closeDoc'           | '结案文书'                           | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1377  | 'payments'           | '付款记录（可多笔，自动汇总已付款）' | 'payments'       | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1378  | 'refundsRo'          | '诉讼退费（已登记，仅状态可修改）'   | 'refunds-ro'     | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | STAGES           | 1379  | 'needSettle'         | '是否涉及结算'                       | 'select'         | 未声明   | ['否', '是']                                                                                                              | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1557  | 'cust'               | '客户'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1558  | 'holder'             | '权利主体'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1559  | 'platform'           | '平台'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1560  | 'shop'               | '店铺名'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1561  | 'shopId'             | '店铺ID'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1562  | 'defendant'          | '被告'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1563  | 'lawyer'             | '办案律师'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1564  | 'court'              | '立案法院'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1565  | 'no'                 | '案号'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1566  | 'amount'             | '标的额'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1567  | 'judgeAmt'           | '判决金额'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CASE_COL_DEFS    | 1568  | 'closeAmt'           | '结案金额'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1613  | 'holder'             | '权利主体'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1614  | 'platform'           | '平台'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1615  | 'shop'               | '店铺名'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1616  | 'shopId'             | '店铺ID'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1617  | 'pushTime'           | '推送日期'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1618  | 'buyTime'            | '取证日期'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1619  | 'photos'             | '开箱照片'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1620  | 'notaryNo'           | '公证书编号'                         | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1621  | 'sender'             | '发货人'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1622  | 'senderPhone'        | '发货电话'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1623  | 'senderAddr'         | '发货地址'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1624  | 'feeN'               | '公证费'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1625  | 'investFee'          | '调查费'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M03  | NOTARY_COL_DEFS  | 1626  | 'feeP'               | '样品费'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4345  | 'type'               | '费用类型'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4346  | 'dir'                | '方向'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4347  | 'amount'             | '金额'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4348  | 'status'             | '状态'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4349  | 'date'               | '日期'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4350  | 'platform'           | '平台'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4351  | 'shop'               | '店铺名'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4352  | 'defendant'          | '被告'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4353  | 'no'                 | '案号'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | FEE_COL_DEFS     | 4354  | 'note'               | '备注'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | addFee           | 4670  | 'caseId'             | '关联案件'                           | 'custom'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | addFee           | 4673  | 'type'               | '费用类型'                           | 'custom'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | addFee           | 4675  | 'dir'                | '方向'                               | 'custom'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | addFee           | 4677  | 'amount'             | '金额（元）'                         | 'number'         | 未声明   | 未声明                                                                                                                    | p.amount != null ? p.amount : ''                                                                   |
| M04  | addFee           | 4678  | 'status'             | '状态'                               | 'custom'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M04  | addFee           | 4680  | 'date'               | '日期'                               | 'date'           | 未声明   | 未声明                                                                                                                    | p.date &#124;&#124; today()                                                                        |
| M02  | openPreserve     | 4930  | 'preserveDoc'        | '保全文书'                           | 'file'           | 未声明   | 未声明                                                                                                                    | c.preserveDoc &#124;&#124; ''                                                                      |
| M02  | openPreserve     | 4932  | 'preserveAt'         | '保全日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | dStr(c.preserveAt)                                                                                 |
| M06  | openSettleLaunch | 5812  | 'amt'                | '本次结算金额（元）'                 | 'number'         | true     | 未声明                                                                                                                    | String(remain)                                                                                     |
| M06  | openSettleLaunch | 5816  | 'm'                  | '发起结算日期'                       | 'date'           | 未声明   | 未声明                                                                                                                    | todayStr                                                                                           |
| M06  | openSettleLaunch | 5817  | 'note'               | '备注'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | newCase          | 6251  | 'caseNo'             | '案件单号'                           | 未声明           | 未声明   | 未声明                                                                                                                    | nextCaseNo(prefillClient &#124;&#124; '')                                                          |
| M02  | newCase          | 6253  | 'cust'               | '客户'                               | 未声明           | true     | 未声明                                                                                                                    | prefillClient &#124;&#124; ''                                                                      |
| M02  | newCase          | 6256  | 'client'             | '权利主体'                           | 未声明           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | newCase          | 6258  | 'reason'             | '侵权类型'                           | 'multi'          | 未声明   | INFRINGE_TYPES                                                                                                            | '商标权'                                                                                           |
| M02  | newCase          | 6260  | 'shop'               | '店铺名'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | newCase          | 6261  | 'source'             | '线索来源'                           | 'select'         | 未声明   | SOURCES                                                                                                                   | '线上'                                                                                             |
| M02  | newCase          | 6262  | 'platform'           | '平台'                               | 'select'         | 未声明   | PLATFORMS                                                                                                                 | '淘宝'                                                                                             |
| M02  | newCase          | 6263  | 'defendant'          | '被告'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | newCase          | 6264  | 'type'               | '案件类型'                           | 'select'         | 未声明   | CASE_TYPES                                                                                                                | '民事'                                                                                             |
| M02  | newCase          | 6265  | 'operator'           | '运营'                               | 'select'         | 未声明   | Object.keys(OPERATORS)                                                                                                    | '陈晓敏'                                                                                           |
| M02  | newCase          | 6266  | 'status'             | '初始阶段'                           | 'select'         | 未声明   | STAGE_KEYS                                                                                                                | '案件待匹配'                                                                                       |
| M02  | MERGE_FIELDS     | 6317  | 'cust'               | '客户'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6318  | 'client'             | '权利主体'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6319  | 'defendant'          | '被告'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6322  | 'reason'             | '侵权类型'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6323  | 'type'               | '案件类型'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6324  | 'operator'           | '运营'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6325  | 'archiveAt'          | '归档日期'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6326  | 'archiveReason'      | '归档原因'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6327  | 'shop'               | '店铺名'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6328  | 'platform'           | '平台'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6329  | 'source'             | '线索来源'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6330  | 'amount'             | '标的额'                             | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | MERGE_FIELDS     | 6331  | 'court'              | '立案法院'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CFG              | 6661  | 'status'             | '案件进展'                           | 'select'         | 未声明   | statusOpts                                                                                                                | c.status &#124;&#124; STAGE_KEYS[0]                                                                |
| M02  | CFG              | 6664  | 'cust'               | '客户'                               | 未声明           | 未声明   | 未声明                                                                                                                    | c.cust &#124;&#124; c.client &#124;&#124; ''                                                       |
| M02  | CFG              | 6665  | 'client'             | '权利主体'                           | 未声明           | 未声明   | 未声明                                                                                                                    | c.client &#124;&#124; ''                                                                           |
| M02  | CFG              | 6666  | 'reason'             | '侵权类型'                           | 'multi'          | 未声明   | INFRINGE_TYPES                                                                                                            | normalizeInfringe(c.reason)                                                                        |
| M02  | CFG              | 6668  | 'type'               | '案件类型'                           | 'select'         | 未声明   | CASE_TYPES                                                                                                                | c.type                                                                                             |
| M02  | CFG              | 6669  | 'operator'           | '运营'                               | 'select'         | 未声明   | Object.keys(OPERATORS)                                                                                                    | c.operator                                                                                         |
| M02  | CFG              | 6677  | 'archiveAt'          | '归档日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | dateOnly(c.archiveAt &#124;&#124; '')                                                              |
| M02  | CFG              | 6678  | 'archiveReason'      | '归档原因'                           | 未声明           | 未声明   | 未声明                                                                                                                    | c.archiveReason &#124;&#124; ''                                                                    |
| M02  | CFG              | 6724  | 'platform'           | '平台'                               | 'select'         | 未声明   | PLATFORMS                                                                                                                 | (n.platform && n.platform !== '—') ? n.platform : '淘宝'                                           |
| M02  | CFG              | 6725  | 'shop'               | '店铺名'                             | 未声明           | 未声明   | 未声明                                                                                                                    | (n.shop && n.shop !== '—') ? n.shop : ''                                                           |
| M02  | CFG              | 6726  | 'shopId'             | '店铺ID'                             | 未声明           | 未声明   | 未声明                                                                                                                    | (n.shopId && n.shopId !== '—') ? n.shopId : ''                                                     |
| M02  | CFG              | 6727  | 'docNo'              | '公证书编号'                         | 未声明           | 未声明   | 未声明                                                                                                                    | (n.docNo && n.docNo !== '—') ? n.docNo : ''                                                        |
| M02  | CFG              | 6729  | 'discloseFiles'      | '披露文件'                           | 'file'           | 未声明   | 未声明                                                                                                                    | (Array.isArray(c.disclosures) ? c.disclosures.map(f =&gt; f.name).filter(Boolean).join('、') : '') |
| M02  | CFG              | 6748  | 'court'              | '立案法院'                           | 'select'         | 未声明   | COURTS                                                                                                                    | normBlank(c.court) &#124;&#124; '—'                                                                |
| M02  | CFG              | 6750  | 'filingShot'         | '立案截图'                           | 'file'           | 未声明   | 未声明                                                                                                                    | c.filingShot &#124;&#124; ''                                                                       |
| M02  | CFG              | 6751  | 'mediateNo'          | '诉调号 / 立案编号'                  | 未声明           | 未声明   | 未声明                                                                                                                    | c.mediateNo &#124;&#124; ''                                                                        |
| M02  | CFG              | 6752  | 'submitAt'           | '提交立案日期'                       | 'date'           | 未声明   | 未声明                                                                                                                    | dateOnly(c.submitAt &#124;&#124; logTime(c, '上传诉状'))                                           |
| M02  | CFG              | 6753  | 'formalAt'           | '正式立案日期'                       | 'date'           | 未声明   | 未声明                                                                                                                    | dateOnly(c.formalAt &#124;&#124; logTime(c, '正式立案'))                                           |
| M02  | CFG              | 6754  | 'hearingAt'          | '开庭日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | dateOnly(c.hearingAt &#124;&#124; logTime(c, '开庭'))                                              |
| M02  | CFG              | 6755  | 'hearingPlace'       | '开庭地点'                           | 未声明           | 未声明   | 未声明                                                                                                                    | c.hearingPlace &#124;&#124; ''                                                                     |
| M02  | CFG              | 6756  | 'serviceDoc'         | '送达文书'                           | 'file'           | 未声明   | 未声明                                                                                                                    | c.serviceDoc &#124;&#124; ''                                                                       |
| M02  | CFG              | 6758  | 'caseNo'             | '案号'                               | 未声明           | 未声明   | 未声明                                                                                                                    | c.caseNo &#124;&#124; ''                                                                           |
| M02  | CFG              | 6760  | 'acceptNotice'       | '立案受理通知书'                     | 'file'           | 未声明   | 未声明                                                                                                                    | c.acceptNotice &#124;&#124; ''                                                                     |
| M02  | CFG              | 6761  | 'amount'             | '标的额（元）'                       | 'number'         | 未声明   | 未声明                                                                                                                    | amtVal(c.amount)                                                                                   |
| M02  | CFG              | 6762  | 'judge'              | '承办法官'                           | 未声明           | 未声明   | 未声明                                                                                                                    | c.judge &#124;&#124; ''                                                                            |
| M02  | CFG              | 6764  | 'discloseInfo'       | '披露数据'                           | 未声明           | 未声明   | 未声明                                                                                                                    | c.discloseInfo &#124;&#124; ''                                                                     |
| M02  | CFG              | 6765  | 'disclose'           | '披露数据附件'                       | 'file'           | 未声明   | 未声明                                                                                                                    | c.disclose &#124;&#124; ''                                                                         |
| M02  | CFG              | 6771  | 'authDocs'           | '起诉状'                             | 'file'           | 未声明   | 未声明                                                                                                                    | authDocsOf(c).join('、')                                                                           |
| M02  | CFG              | 6775  | 'filingDocs'         | '调档文件'                           | 'file'           | 未声明   | 未声明                                                                                                                    | (Array.isArray(c.filingDocs) ? c.filingDocs.join('、') : (c.filingDocs &#124;&#124; ''))           |
| M02  | CFG              | 6803  | 'judgeGotAt'         | '收到判决日期'                       | 'date'           | 未声明   | 未声明                                                                                                                    | dateOnly(c.judgeGotAt &#124;&#124; logTime(c, '判决'))                                             |
| M02  | CFG              | 6804  | 'judgeAmt'           | '判决金额（元）'                     | 'number'         | 未声明   | 未声明                                                                                                                    | amtVal(c.judgeAmt &#124;&#124; (c.ov && c.ov.judgeAmt))                                            |
| M02  | CFG              | 6805  | 'paidFee'            | '实缴诉讼费（元）'                   | 'number'         | 未声明   | 未声明                                                                                                                    | amtVal(c.paidFee)                                                                                  |
| M02  | CFG              | 6806  | 'judgeDoc'           | '判决书'                             | 'file'           | 未声明   | 未声明                                                                                                                    | c.judgeDoc &#124;&#124; ''                                                                         |
| M02  | CFG              | 6807  | 'refunds'            | '诉讼退费（可多笔）'                 | 'custom'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M02  | CFG              | 6825  | 'secondDoc'          | '二审文书'                           | 'file'           | 未声明   | 未声明                                                                                                                    | c.secondDoc &#124;&#124; ''                                                                        |
| M02  | CFG              | 6826  | 'secondHearingAt'    | '二审开庭日期'                       | 'date'           | 未声明   | 未声明                                                                                                                    | dateOnly(c.secondHearingAt)                                                                        |
| M02  | CFG              | 6827  | 'secondHearingPlace' | '二审开庭地点'                       | 未声明           | 未声明   | 未声明                                                                                                                    | c.secondHearingPlace &#124;&#124; ''                                                               |
| M02  | CFG              | 6828  | 'secondServiceDoc'   | '二审送达文书'                       | 'file'           | 未声明   | 未声明                                                                                                                    | c.secondServiceDoc &#124;&#124; ''                                                                 |
| M02  | CFG              | 6829  | 'secondJudge'        | '二审法官'                           | 未声明           | 未声明   | 未声明                                                                                                                    | c.secondJudge &#124;&#124; ''                                                                      |
| M02  | CFG              | 6841  | 'execFilingShot'     | '执行立案截图'                       | 'file'           | 未声明   | 未声明                                                                                                                    | (c.execFilingShot &#124;&#124; c.execShot &#124;&#124; '')                                         |
| M02  | CFG              | 6842  | 'execFormalAt'       | '执行正式立案日期'                   | 'date'           | 未声明   | 未声明                                                                                                                    | dateOnly(c.execFormalAt)                                                                           |
| M02  | CFG              | 6843  | 'execCaseNo'         | '执行案号'                           | 未声明           | 未声明   | 未声明                                                                                                                    | c.execCaseNo &#124;&#124; (c.ov && c.ov.execCaseNo) &#124;&#124; ''                                |
| M02  | CFG              | 6844  | 'execFormalDoc'      | '执行文书'                           | 'file'           | 未声明   | 未声明                                                                                                                    | c.execFormalDoc &#124;&#124; ''                                                                    |
| M10  | newCustomer      | 6999  | 'name'               | '客户名称'                           | 未声明           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | newCustomer      | 7000  | 'credit'             | '统一社会信用代码'                   | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | newCustomer      | 7001  | 'category'           | '主营类目'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | newCustomer      | 7002  | 'region'             | '区域'                               | 'select'         | 未声明   | CUST_REGION_OPTIONS                                                                                                       | '华东'                                                                                             |
| M10  | newCustomer      | 7003  | 'settle'             | '结算方式'                           | 'select'         | 未声明   | ['月结 · 30 天', '月结 · 60 天', '季结 · 45 天', '单案结清']                                                              | '月结 · 30 天'                                                                                     |
| M10  | newCustomer      | 7004  | 'manager'            | '客户经理'                           | 'select'         | 未声明   | Object.keys(OPERATORS)                                                                                                    | '陈晓敏'                                                                                           |
| M10  | newCustomer      | 7006  | 'operator'           | '运营'                               | 'select'         | 未声明   | custOperatorOptions()                                                                                                     | '陈晓敏'                                                                                           |
| M10  | newCustomer      | 7007  | 'model'              | '合作模式'                           | 'select'         | 未声明   | ['全风险', '半风险', '固定费用']                                                                                          | '全风险'                                                                                           |
| M10  | newCustomer      | 7008  | 'settleFormula'      | '结算条件（公式）'                   | 未声明           | 未声明   | 未声明                                                                                                                    | DEFAULT_CUST_FORMULA                                                                               |
| M10  | editCustomerCard | 7041  | 'name'               | '客户名称'                           | 未声明           | true     | 未声明                                                                                                                    | c.name                                                                                             |
| M10  | editCustomerCard | 7042  | 'credit'             | '统一社会信用代码'                   | 未声明           | 未声明   | 未声明                                                                                                                    | c.credit &#124;&#124; ''                                                                           |
| M10  | editCustomerCard | 7043  | 'category'           | '主营类目'                           | 未声明           | 未声明   | 未声明                                                                                                                    | c.category                                                                                         |
| M10  | editCustomerCard | 7044  | 'region'             | '区域'                               | 'select'         | 未声明   | CUST_REGION_OPTIONS                                                                                                       | c.region &#124;&#124; '华东'                                                                       |
| M10  | editCustomerCard | 7045  | 'manager'            | '客户经理'                           | 'select'         | 未声明   | custManagerOptions()                                                                                                      | c.manager                                                                                          |
| M10  | editCustomerCard | 7046  | 'operator'           | '运营'                               | 'select'         | 未声明   | custOperatorOptions()                                                                                                     | c.operator &#124;&#124; c.manager                                                                  |
| M10  | editCustomerCard | 7047  | 'model'              | '合作模式'                           | 'select'         | 未声明   | ['全风险', '半风险', '固定费用']                                                                                          | c.model &#124;&#124; '全风险'                                                                      |
| M10  | editCustomerCard | 7048  | 'status'             | '合作状态'                           | 'select'         | 未声明   | ['合作中', '暂停', '已终止']                                                                                              | c.status                                                                                           |
| M10  | editCustomerCard | 7049  | 'coopFrom'           | '合作起始日'                         | 'date'           | 未声明   | 未声明                                                                                                                    | custCoopFrom(c)                                                                                    |
| M10  | editCustomerCard | 7050  | 'coopTo'             | '合同到期日'                         | 'date'           | 未声明   | 未声明                                                                                                                    | custCoopTo(c)                                                                                      |
| M10  | editCustomerCard | 7051  | 'settleFormula'      | '结算条件（公式）'                   | 未声明           | 未声明   | 未声明                                                                                                                    | custFormula(c)                                                                                     |
| M10  | editCustomerCard | 7053  | 'settle'             | '结算方式'                           | 'select'         | 未声明   | CUST_SETTLE_OPTIONS                                                                                                       | c.settle                                                                                           |
| M10  | editCustomerCard | 7054  | 'invoiceType'        | '开票类型'                           | 未声明           | 未声明   | 未声明                                                                                                                    | custInvoiceType(c)                                                                                 |
| M10  | editCustomerCard | 7055  | 'invoiceSubject'     | '开票主体'                           | 未声明           | 未声明   | 未声明                                                                                                                    | custInvoiceSubject(c)                                                                              |
| M10  | editCustomerCard | 7056  | 'taxNo'              | '纳税人识别号'                       | 未声明           | 未声明   | 未声明                                                                                                                    | custTaxNo(c)                                                                                       |
| M10  | editCustomerCard | 7057  | 'bank'               | '开户行'                             | 未声明           | 未声明   | 未声明                                                                                                                    | custBank(c)                                                                                        |
| M10  | editCustomerCard | 7058  | 'contract'           | '合作协议（文件）'                   | 'file'           | 未声明   | 未声明                                                                                                                    | c.contractName &#124;&#124; ''                                                                     |
| M10  | addContact       | 7109  | 'name'               | '姓名'                               | 未声明           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addContact       | 7110  | 'phone'              | '手机'                               | 未声明           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addContact       | 7111  | 'mail'               | '邮箱'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addContact       | 7112  | 'duty'               | '负责事项'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addContact       | 7113  | 'main'               | '是否主要联系人'                     | 'select'         | 未声明   | ['否', '是']                                                                                                              | '否'                                                                                               |
| M10  | editContact      | 7133  | 'name'               | '姓名'                               | 未声明           | true     | 未声明                                                                                                                    | p.name                                                                                             |
| M10  | editContact      | 7134  | 'phone'              | '手机'                               | 未声明           | true     | 未声明                                                                                                                    | p.phone                                                                                            |
| M10  | editContact      | 7135  | 'mail'               | '邮箱'                               | 未声明           | 未声明   | 未声明                                                                                                                    | p.mail                                                                                             |
| M10  | editContact      | 7136  | 'duty'               | '负责事项'                           | 未声明           | 未声明   | 未声明                                                                                                                    | p.duty                                                                                             |
| M10  | editContact      | 7137  | 'main'               | '是否主要联系人'                     | 'select'         | 未声明   | ['否', '是']                                                                                                              | p.main ? '是' : '否'                                                                               |
| M10  | addAsset         | 7155  | 'doc'                | '权属文件'                           | 'file'           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addAsset         | 7157  | 'type'               | '权利类型'                           | 'select'         | 未声明   | ASSET_TYPES                                                                                                               | '商标'                                                                                             |
| M10  | addAsset         | 7158  | 'cat'                | '类别'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addAsset         | 7160  | 'no'                 | '注册号 / 申请号'                    | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addAsset         | 7161  | 'name'               | '名称'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addAsset         | 7162  | 'owner'              | '权利人'                             | 未声明           | 未声明   | 未声明                                                                                                                    | curCustomer() ? curCustomer().name : ''                                                            |
| M10  | addAsset         | 7163  | 'from'               | '注册日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | today()                                                                                            |
| M10  | addAsset         | 7164  | 'to'                 | '有效期至'                           | 'date'           | 未声明   | 未声明                                                                                                                    | (new Date().getFullYear() + 10) + today().slice(4)                                                 |
| M10  | editAsset        | 7186  | 'doc'                | '权属文件'                           | 'file'           | 未声明   | 未声明                                                                                                                    | a.doc &#124;&#124; ''                                                                              |
| M10  | editAsset        | 7188  | 'type'               | '权利类型'                           | 'select'         | 未声明   | ASSET_TYPES                                                                                                               | a.type &#124;&#124; '商标'                                                                         |
| M10  | editAsset        | 7189  | 'cat'                | '类别'                               | 未声明           | 未声明   | 未声明                                                                                                                    | (a.cat && a.cat !== '—') ? a.cat : ''                                                              |
| M10  | editAsset        | 7190  | 'no'                 | '注册号 / 申请号'                    | 未声明           | 未声明   | 未声明                                                                                                                    | a.no &#124;&#124; ''                                                                               |
| M10  | editAsset        | 7191  | 'name'               | '名称'                               | 未声明           | 未声明   | 未声明                                                                                                                    | a.name &#124;&#124; ''                                                                             |
| M10  | editAsset        | 7192  | 'owner'              | '权利人'                             | 未声明           | 未声明   | 未声明                                                                                                                    | a.owner &#124;&#124; c.name                                                                        |
| M10  | editAsset        | 7193  | 'from'               | '注册日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | a.from &#124;&#124; today()                                                                        |
| M10  | editAsset        | 7194  | 'to'                 | '有效期至'                           | 'date'           | 未声明   | 未声明                                                                                                                    | a.to &#124;&#124; ''                                                                               |
| M10  | addHolder        | 7345  | 'name'               | '权利主体'                           | 未声明           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addHolder        | 7346  | 'credit'             | '统一社会信用代码'                   | 未声明           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addHolder        | 7347  | 'address'            | '住所地'                             | 未声明           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addHolder        | 7348  | 'legal'              | '法定代表人'                         | 未声明           | true     | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | addHolder        | 7350  | 'duty'               | '职务'                               | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M10  | editHolder       | 7367  | 'name'               | '权利主体'                           | 未声明           | true     | 未声明                                                                                                                    | h.name                                                                                             |
| M10  | editHolder       | 7368  | 'credit'             | '统一社会信用代码'                   | 未声明           | true     | 未声明                                                                                                                    | h.credit                                                                                           |
| M10  | editHolder       | 7369  | 'address'            | '住所地'                             | 未声明           | true     | 未声明                                                                                                                    | h.address                                                                                          |
| M10  | editHolder       | 7370  | 'legal'              | '法定代表人'                         | 未声明           | true     | 未声明                                                                                                                    | h.legal                                                                                            |
| M10  | editHolder       | 7371  | 'duty'               | '职务'                               | 未声明           | 未声明   | 未声明                                                                                                                    | h.duty                                                                                             |
| M01  | LAWYER_COLS      | 8265  | 0                    | '律师：待写诉状'                     | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M01  | LAWYER_COLS      | 8266  | 1                    | '运营：诉状待确认'                   | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M01  | LAWYER_COLS      | 8267  | 2                    | '客户：诉状待盖章'                   | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M01  | editLeadInfo     | 9012  | 'client'             | '客户'                               | 未声明           | true     | 未声明                                                                                                                    | l.client                                                                                           |
| M01  | editLeadInfo     | 9013  | 'party'              | '权利主体'                           | 未声明           | true     | 未声明                                                                                                                    | l.party                                                                                            |
| M01  | editLeadInfo     | 9014  | 'caseType'           | '案件类型'                           | 'select'         | 未声明   | CASE_TYPES                                                                                                                | l.caseType                                                                                         |
| M01  | editLeadInfo     | 9015  | 'operator'           | '运营'                               | 'select'         | 未声明   | operators                                                                                                                 | l.operator                                                                                         |
| M01  | editLeadInfo     | 9016  | 'source'             | '线索来源'                           | 'select'         | 未声明   | ['线上', '线下']                                                                                                          | l.source                                                                                           |
| M01  | editLeadInfo     | 9018  | 'platform'           | '平台'                               | 'select'         | 未声明   | platforms                                                                                                                 | l.platform                                                                                         |
| M01  | editLeadInfo     | 9019  | 'reason'             | '侵权类型'                           | 'multi'          | true     | INFRINGE_TYPES                                                                                                            | normalizeInfringe(l.reason)                                                                        |
| M01  | editLeadInfo     | 9021  | 'foundAt'            | '线索发现日期'                       | 'datetime-local' | true     | 未声明                                                                                                                    | String(l.foundAt &#124;&#124; '').replace(' ', 'T')                                                |
| M01  | editLeadInfo     | 9023  | 'shop'               | '店铺名'                             | 未声明           | true     | 未声明                                                                                                                    | l.shop                                                                                             |
| M01  | editLeadInfo     | 9024  | 'shopId'             | '店铺ID'                             | 未声明           | 未声明   | 未声明                                                                                                                    | l.shopId === '—' ? '' : (l.shopId &#124;&#124; '')                                                 |
| M01  | editLeadInfo     | 9025  | 'needDisclose'       | '是否需要披露'                       | 'select'         | 未声明   | ['是', '否']                                                                                                              | l.needDisclose === '是' ? '是' : '否'                                                              |
| M01  | editLeadInfo     | 9027  | 'remark'             | '线索备注'                           | 'textarea'       | 未声明   | 未声明                                                                                                                    | l.remark &#124;&#124; ''                                                                           |
| M01  | editLeadInfo     | 9030  | 'shotFiles'          | '侵权截图'                           | 'file'           | 未声明   | 未声明                                                                                                                    | (Array.isArray(l.shotFiles) ? l.shotFiles.join('、') : '')                                         |
| M03  | editNotary       | 10827 | 'shop'               | '店铺名'                             | 未声明           | true     | 未声明                                                                                                                    | clean(n.shop)                                                                                      |
| M03  | editNotary       | 10828 | 'platform'           | '平台'                               | 'select'         | 未声明   | platforms                                                                                                                 | n.platform &#124;&#124; '其他'                                                                     |
| M03  | editNotary       | 10829 | 'shopId'             | '店铺ID'                             | 未声明           | 未声明   | 未声明                                                                                                                    | clean(n.shopId)                                                                                    |
| M03  | editNotary       | 10830 | 'buyAt'              | '取证日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | clean(n.buyAt)                                                                                     |
| M03  | editNotary       | 10831 | 'push'               | '推送日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | clean(n.push)                                                                                      |
| M03  | editNotary       | 10836 | 'recvName'           | '发货人'                             | 未声明           | 未声明   | 未声明                                                                                                                    | clean(n.recvName)                                                                                  |
| M03  | editNotary       | 10837 | 'recvPhone'          | '发货电话'                           | 未声明           | 未声明   | 未声明                                                                                                                    | clean(n.recvPhone)                                                                                 |
| M03  | editNotary       | 10838 | 'recvAddr'           | '发货地址'                           | 未声明           | 未声明   | 未声明                                                                                                                    | clean(n.recvAddr)                                                                                  |
| M03  | editNotary       | 10839 | 'ocr'                | '开箱照片 OCR'                       | 'select'         | 未声明   | ['已识别', '未识别']                                                                                                      | n.ocr ? '已识别' : '未识别'                                                                        |
| M03  | editNotary       | 10840 | 'office'             | '公证处'                             | 'select'         | 未声明   | ['—'].concat(NOTARY_OFFICE_OPTIONS)                                                                                       | clean(n.office)                                                                                    |
| M03  | editNotary       | 10841 | 'docNo'              | '公证书编号'                         | 未声明           | 未声明   | 未声明                                                                                                                    | clean(n.docNo)                                                                                     |
| M03  | editNotary       | 10842 | 'docDate'            | '出证日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | clean(n.docDate)                                                                                   |
| M03  | editNotary       | 10843 | 'feeN'               | '公证费（元）'                       | 'number'         | 未声明   | 未声明                                                                                                                    | String(n.feeN &#124;&#124; 0)                                                                      |
| M03  | editNotary       | 10844 | 'investFee'          | '调查费（元）'                       | 'number'         | 未声明   | 未声明                                                                                                                    | String(n.investFee &#124;&#124; 0)                                                                 |
| M03  | editNotary       | 10845 | 'feeP'               | '样品费（元）'                       | 'number'         | 未声明   | 未声明                                                                                                                    | String(n.feeP &#124;&#124; 0)                                                                      |
| M03  | editNotary       | 10846 | 'feeD'               | '披露费（元）'                       | 'number'         | 未声明   | 未声明                                                                                                                    | String(n.feeD &#124;&#124; 0)                                                                      |
| M03  | editNotary       | 10847 | 'disclose'           | '披露文件'                           | 未声明           | 未声明   | 未声明                                                                                                                    | clean(n.disclose)                                                                                  |
| M03  | editNotary       | 10848 | 'audit'              | '客户审核'                           | 'select'         | 未声明   | ['待审核', '侵权', '不侵权']                                                                                              | n.audit &#124;&#124; '待审核'                                                                      |
| M05  | editEvidenceRow  | 11268 | 'docStatus'          | '公证书状态'                         | 'select'         | 未声明   | doc ? (DOC_STATUSES.indexOf(doc.status) &lt; 0 ? [doc.status].concat(DOC_STATUSES) : DOC_STATUSES) : ['（无关联公证书）'] | doc ? doc.status : '（无关联公证书）'                                                              |
| M05  | editEvidenceRow  | 11274 | 'remark'             | '备注'                               | 未声明           | 未声明   | 未声明                                                                                                                    | initRemark                                                                                         |
| M05  | editEvidenceRow  | 11277 | 'evRows'             | '证物（' + siblings.length + '）'    | 'custom'         | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |
| M06  | createBill       | 11871 | 'no'                 | '账单号'                             | 未声明           | 未声明   | 未声明                                                                                                                    | billNoFor(today())                                                                                 |
| M06  | createBill       | 11873 | 'date'               | '账单日期'                           | 'date'           | 未声明   | 未声明                                                                                                                    | today()                                                                                            |
| M06  | createBill       | 11874 | 'note'               | '账单备注'                           | 未声明           | 未声明   | 未声明                                                                                                                    | 未声明                                                                                             |

## data-* 绑定出现点

排除纯追踪 data-page-node-id；保留字段、导航、状态、选择与上传绑定。动态插值和别名的实体归属 UNKNOWN，按函数上下文复核。

| 文件       | 绑定属性          | 值/表达式                                    | 出现行                         |
| ---------- | ----------------- | -------------------------------------------- | ------------------------------ |
| app.js     | data-fk           | ${esc(key)}                                  | 541                            |
| app.js     | data-k            | ${esc(key)}                                  | 541                            |
| app.js     | data-msel         | ${esc(key)}                                  | 542, 548                       |
| app.js     | data-ph           | ${esc(ph)}                                   | 544                            |
| app.js     | data-k            | ${f.key}                                     | 616, 625, 628, 649             |
| app.js     | data-err          | ${f.key}                                     | 635, 654                       |
| app.js     | data-k            | ' + key + '                                  | 672                            |
| app.js     | data-k            | ' + k + '                                    | 693, 8793, 8802                |
| app.js     | data-name         | ${esc(l.name)}                               | 1211                           |
| app.js     | data-fk           | ' + k + '                                    | 1222, 2051, 2235               |
| app.js     | data-id           | ${c.id}                                      | 1511, 1688                     |
| app.js     | data-sel          | ${c.id}                                      | 1513                           |
| app.js     | data-tip-case     | ${esc(c.id)}                                 | 1521, 12719                    |
| app.js     | data-colk         | ${d.key}                                     | 1594, 1652, 4381               |
| app.js     | data-dk           | kind                                         | 1751, 6561                     |
| app.js     | data-for          | 自然人                                       | 1755, 1767, 6565, 6577         |
| app.js     | data-dk           | name                                         | 1757, 6567                     |
| app.js     | data-for          | 法人/个体                                    | 1759, 1771, 6569, 6581         |
| app.js     | data-dk           | org                                          | 1761, 6571                     |
| app.js     | data-dk           | phone                                        | 1765, 6575                     |
| app.js     | data-dk           | idcard                                       | 1769, 6579                     |
| app.js     | data-dk           | credit                                       | 1773, 6583                     |
| app.js     | data-dk           | addr                                         | 1777, 6587                     |
| app.js     | data-dk           | ' + k + '                                    | 1826, 6614                     |
| app.js     | data-fk           | ${f.k}                                       | 1867, 1868, 1869, 1876         |
| app.js     | data-doc-key      | ' + key + '                                  | 1937, 1938                     |
| app.js     | data-doc-attr     | ' + attr + '                                 | 1937, 1938                     |
| app.js     | data-upload       | 1                                            | 1953, 1955                     |
| app.js     | data-doc-key      | ' + kEsc + '                                 | 1956                           |
| app.js     | data-doc-attr     | ' + aEsc + '                                 | 1956                           |
| app.js     | data-doc-multi    | 1                                            | 1957                           |
| app.js     | data-side         | ${side}                                      | 2067                           |
| app.js     | data-fk           | ${isCust ? 'custSettleAmt' : 'lawSettleAmt'} | 2069                           |
| app.js     | data-settle-hint  | ${side}                                      | 2072                           |
| app.js     | data-slot         | ${side}                                      | 2073                           |
| app.js     | data-fk           | closeAmt                                     | 2092, 5539                     |
| app.js     | data-side         | ' + side + '                                 | 2098, 5669, 5675               |
| app.js     | data-rk           | from                                         | 2160, 2190                     |
| app.js     | data-rk           | amt                                          | 2164, 2184, 2191               |
| app.js     | data-rk           | status                                       | 2165, 2192, 2206, 2672         |
| app.js     | data-fk           | judgeAmt                                     | 2223                           |
| app.js     | data-fk           | paidFee                                      | 2224                           |
| app.js     | data-fk           | ' + f.k + '                                  | 2398, 2644, 2680, 4765         |
| app.js     | data-fk           | secondJudgeGotAt                             | 2467, 2489                     |
| app.js     | data-fk           | secondJudgeAmt                               | 2471, 2498                     |
| app.js     | data-fk           | secondPaidFee                                | 2475, 2499                     |
| app.js     | data-fk           | secondJudgeDoc                               | 2490                           |
| app.js     | data-pk           | proof                                        | 2521, 2530, 2534, 2543         |
| app.js     | data-fk           | payType                                      | 2554, 2572, 2624               |
| app.js     | data-pk           | date                                         | 2593                           |
| app.js     | data-pk           | amt                                          | 2594, 2632                     |
| app.js     | data-pk           | payer                                        | 2595                           |
| app.js     | data-pk           | payee                                        | 2596                           |
| app.js     | data-pk           | ' + k + '                                    | 2654, 3938                     |
| app.js     | data-bfk          | ${k}                                         | 3457                           |
| app.js     | data-bcase        | ' + caseId + '                               | 3464                           |
| app.js     | data-bfk          | ' + k + '                                    | 3466, 3513                     |
| app.js     | data-bcase        | ${esc(c.id)}                                 | 3472                           |
| app.js     | data-bfk          | court                                        | 3474, 3487                     |
| app.js     | data-bfk          | submitAt                                     | 3475, 3488                     |
| app.js     | data-bfk          | amount                                       | 3476                           |
| app.js     | data-bfk          | mediateNo                                    | 3478                           |
| app.js     | data-bcase        | ' + c.id + '                                 | 3511                           |
| app.js     | data-fk           | closeDoc                                     | 3935                           |
| app.js     | data-status       | 全部                                         | 4230, 4236, 10687              |
| app.js     | data-c            | 全部                                         | 4230                           |
| app.js     | data-status       | ${esc(e.status)}                             | 4231, 4237                     |
| app.js     | data-c            | ${esc(e.status)}                             | 4231                           |
| app.js     | data-col          | ${key}                                       | 4564                           |
| app.js     | data-id           | ${esc(c.id)}                                 | 4620                           |
| app.js     | data-k            | preserveDoc                                  | 4929                           |
| app.js     | data-fk           | lawyerSettleMode                             | 5546, 7465                     |
| app.js     | data-fk           | lawyerBaseFee                                | 5547, 7470                     |
| app.js     | data-fk           | lawyerSplit                                  | 5548, 7475                     |
| app.js     | data-se           | formula                                      | 5572, 5614, 5700               |
| app.js     | data-se           | amount                                       | 5577, 5604, 5650, 5663, 5697   |
| app.js     | data-se           | calcline                                     | 5578, 5605, 5661               |
| app.js     | data-se           | mode                                         | 5589, 5620, 5635, 5707         |
| app.js     | data-se           | base                                         | 5594, 5621, 5636, 5708         |
| app.js     | data-se           | split                                        | 5599, 5622, 5637, 5709         |
| app.js     | data-view         | ' + navKey + '                               | 6167                           |
| app.js     | data-tab          | ${panelId}                                   | 6228                           |
| app.js     | data-k            | cust                                         | 6236                           |
| app.js     | data-k            | caseNo                                       | 6237                           |
| app.js     | data-mc           | ${esc(cf.f.k)}                               | 6394                           |
| app.js     | data-mc-in        | ${esc(cf.f.k)}                               | 6399                           |
| app.js     | data-mc           | ${k}                                         | 6428                           |
| app.js     | data-mc-in        | ${k}                                         | 6433                           |
| app.js     | data-collapse-key | ${card}                                      | 6864                           |
| app.js     | data-ef           | name                                         | 6925                           |
| app.js     | data-ef           | amt                                          | 6926                           |
| app.js     | data-ef           | status                                       | 6927                           |
| app.js     | data-ef           | ' + k + '                                    | 6940                           |
| app.js     | data-fk           | lawyer                                       | 7449                           |
| app.js     | data-fk           | lawyerPhone                                  | 7453                           |
| app.js     | data-fk           | lawyerFirm                                   | 7457                           |
| app.js     | data-fk           | lawyerAddr                                   | 7461                           |
| app.js     | data-c            | ${k}                                         | 8163, 10699                    |
| app.js     | data-k            | client                                       | 8621, 8785                     |
| app.js     | data-err          | client                                       | 8622                           |
| app.js     | data-k            | party                                        | 8626                           |
| app.js     | data-err          | party                                        | 8627                           |
| app.js     | data-k            | caseType                                     | 8631                           |
| app.js     | data-k            | operator                                     | 8637                           |
| app.js     | data-k            | source                                       | 8645                           |
| app.js     | data-k            | platform                                     | 8652, 8722                     |
| app.js     | data-err          | reason                                       | 8659                           |
| app.js     | data-k            | foundAt                                      | 8663                           |
| app.js     | data-err          | foundAt                                      | 8664                           |
| app.js     | data-k            | shop                                         | 8669                           |
| app.js     | data-err          | shop                                         | 8670                           |
| app.js     | data-k            | shopId                                       | 8674                           |
| app.js     | data-k            | needDisclose                                 | 8678                           |
| app.js     | data-err          | needDisclose                                 | 8683                           |
| app.js     | data-k            | remark                                       | 8687                           |
| app.js     | data-lk           | url                                          | 8742                           |
| app.js     | data-lk           | title                                        | 8743                           |
| app.js     | data-lk           | qty                                          | 8744, 8754                     |
| app.js     | data-lk           | price                                        | 8745                           |
| app.js     | data-lk           | cmt                                          | 8746                           |
| app.js     | data-lk           | sale                                         | 8747, 8768                     |
| app.js     | data-lk           | ' + k + '                                    | 8766, 8811, 8975               |
| app.js     | data-err          | ' + k + '                                    | 8803                           |
| app.js     | data-k            | no                                           | 9630                           |
| app.js     | data-k            | date                                         | 9632                           |
| app.js     | data-status       | ${esc(k)}                                    | 10691                          |
| app.js     | data-id           | ${(e && e.id) ? esc(e.id) : ''}              | 11130                          |
| app.js     | data-init-status  | ${esc(st)}                                   | 11130                          |
| app.js     | data-f            | code                                         | 11131, 11151                   |
| app.js     | data-f            | loc                                          | 11132, 11152                   |
| app.js     | data-f            | status                                       | 11133, 11141, 11153            |
| app.js     | data-f            | ${k}                                         | 11192                          |
| app.js     | data-tip          | &lt;key&gt;                                  | 11381                          |
| app.js     | data-tip          | ${tk}                                        | 11530, 11559                   |
| app.js     | data-ov           | ${ov}                                        | 12335                          |
| app.js     | data-fkey         | ${key}                                       | 12529                          |
| app.js     | data-collapse-key | ${esc(p.key)}                                | 12646                          |
| app.js     | data-collapse-key | ${key}                                       | 12677                          |
| app.js     | data-tip-settle   | ${esc(c.id)}                                 | 12896                          |
| app.js     | data-ov           | paidBack                                     | 13100                          |
| index.html | data-dm-ref       | 1                                            | 2                              |
| index.html | data-sp-bindable  | database                                     | 2                              |
| index.html | data-view         | leads                                        | 31                             |
| index.html | data-view         | notary                                       | 39                             |
| index.html | data-status       | 全部                                         | 45, 53, 1912, 2912, 3262, 3470 |
| index.html | data-status       | 待取证                                       | 45                             |
| index.html | data-status       | 待取件开箱                                   | 45                             |
| index.html | data-status       | 开箱待审核                                   | 45                             |
| index.html | data-status       | 开箱待确认                                   | 45                             |
| index.html | data-status       | 待出证                                       | 45                             |
| index.html | data-status       | 待退货                                       | 45                             |
| index.html | data-status       | 已归档                                       | 45, 53                         |
| index.html | data-view         | cases                                        | 47                             |
| index.html | data-c            | 全部                                         | 53                             |
| index.html | data-status       | 案件待匹配                                   | 53                             |
| index.html | data-c            | 案件待匹配                                   | 53                             |
| index.html | data-status       | 准备起诉文书                                 | 53                             |
| index.html | data-c            | 准备起诉文书                                 | 53                             |
| index.html | data-status       | 待提交立案                                   | 53                             |
| index.html | data-c            | 待提交立案                                   | 53                             |
| index.html | data-status       | 转正式立案                                   | 53                             |
| index.html | data-c            | 转正式立案                                   | 53                             |
| index.html | data-status       | 待开庭                                       | 53                             |
| index.html | data-c            | 待开庭                                       | 53                             |
| index.html | data-status       | 待判决                                       | 53                             |
| index.html | data-c            | 待判决                                       | 53                             |
| index.html | data-status       | 二审                                         | 53                             |
| index.html | data-c            | 二审                                         | 53                             |
| index.html | data-status       | 准备执行文书                                 | 53                             |
| index.html | data-c            | 准备执行文书                                 | 53                             |
| index.html | data-status       | 待申请执行立案                               | 53                             |
| index.html | data-c            | 待申请执行立案                               | 53                             |
| index.html | data-status       | 强制执行中                                   | 53                             |
| index.html | data-c            | 强制执行中                                   | 53                             |
| index.html | data-status       | 待归档                                       | 53                             |
| index.html | data-c            | 待归档                                       | 53                             |
| index.html | data-c            | 已归档                                       | 53                             |
| index.html | data-view         | settlement                                   | 55                             |
| index.html | data-view         | customers                                    | 65                             |
| index.html | data-view         | evidence                                     | 70                             |
| index.html | data-view         | calendar                                     | 76                             |
| index.html | data-view         | reports                                      | 85                             |
| index.html | data-view         | settings                                     | 94                             |
| index.html | data-col          | cust                                         | 256                            |
| index.html | data-sort         | client                                       | 257                            |
| index.html | data-col          | holder                                       | 257, 2696                      |
| index.html | data-col          | platform                                     | 258, 2697, 3736                |
| index.html | data-col          | shop                                         | 259, 2698, 3736                |
| index.html | data-col          | shopId                                       | 260, 2699                      |
| index.html | data-col          | defendant                                    | 261, 3736                      |
| index.html | data-col          | lawyer                                       | 262                            |
| index.html | data-col          | court                                        | 263                            |
| index.html | data-col          | no                                           | 264, 3736                      |
| index.html | data-sort         | amount                                       | 265                            |
| index.html | data-col          | amount                                       | 265, 3735                      |
| index.html | data-col          | judgeAmt                                     | 266                            |
| index.html | data-col          | closeAmt                                     | 267                            |
| index.html | data-id           | IP-20260315-001                              | 271                            |
| index.html | data-sel          | IP-20260315-001                              | 273                            |
| index.html | data-id           | IP-20260402-003                              | 289                            |
| index.html | data-sel          | IP-20260402-003                              | 291                            |
| index.html | data-id           | IP-20260320-007                              | 307                            |
| index.html | data-sel          | IP-20260320-007                              | 309                            |
| index.html | data-tip-case     | IP-20260320-007                              | 317                            |
| index.html | data-id           | IP-20260218-002                              | 325                            |
| index.html | data-sel          | IP-20260218-002                              | 327                            |
| index.html | data-tip-case     | IP-20260218-002                              | 335                            |
| index.html | data-id           | IP-20260110-015                              | 343                            |
| index.html | data-sel          | IP-20260110-015                              | 345                            |
| index.html | data-tip-case     | IP-20260110-015                              | 353                            |
| index.html | data-id           | IP-20251220-088                              | 361                            |
| index.html | data-sel          | IP-20251220-088                              | 363                            |
| index.html | data-tip-case     | IP-20251220-088                              | 371                            |
| index.html | data-id           | IP-20260305-005                              | 379                            |
| index.html | data-sel          | IP-20260305-005                              | 381                            |
| index.html | data-tip-case     | IP-20260305-005                              | 389                            |
| index.html | data-id           | IP-20260410-012                              | 397                            |
| index.html | data-sel          | IP-20260410-012                              | 399                            |
| index.html | data-id           | IP-DEMO-01-2                                 | 415                            |
| index.html | data-sel          | IP-DEMO-01-2                                 | 417                            |
| index.html | data-id           | IP-DEMO-01-3                                 | 433                            |
| index.html | data-sel          | IP-DEMO-01-3                                 | 435                            |
| index.html | data-id           | IP-DEMO-01-4                                 | 451                            |
| index.html | data-sel          | IP-DEMO-01-4                                 | 453                            |
| index.html | data-id           | IP-DEMO-01-5                                 | 469                            |
| index.html | data-sel          | IP-DEMO-01-5                                 | 471                            |
| index.html | data-id           | IP-DEMO-02-2                                 | 487                            |
| index.html | data-sel          | IP-DEMO-02-2                                 | 489                            |
| index.html | data-id           | IP-DEMO-02-3                                 | 505                            |
| index.html | data-sel          | IP-DEMO-02-3                                 | 507                            |
| index.html | data-tip-case     | IP-DEMO-02-3                                 | 515                            |
| index.html | data-id           | IP-DEMO-02-4                                 | 523                            |
| index.html | data-sel          | IP-DEMO-02-4                                 | 525                            |
| index.html | data-id           | IP-DEMO-02-5                                 | 541                            |
| index.html | data-sel          | IP-DEMO-02-5                                 | 543                            |
| index.html | data-id           | IP-DEMO-03-1                                 | 559                            |
| index.html | data-sel          | IP-DEMO-03-1                                 | 561                            |
| index.html | data-tip-case     | IP-DEMO-03-1                                 | 569                            |
| index.html | data-id           | IP-DEMO-03-2                                 | 577                            |
| index.html | data-sel          | IP-DEMO-03-2                                 | 579                            |
| index.html | data-id           | IP-DEMO-03-3                                 | 595                            |
| index.html | data-sel          | IP-DEMO-03-3                                 | 597                            |
| index.html | data-id           | IP-DEMO-03-4                                 | 613                            |
| index.html | data-sel          | IP-DEMO-03-4                                 | 615                            |
| index.html | data-id           | IP-DEMO-03-5                                 | 631                            |
| index.html | data-sel          | IP-DEMO-03-5                                 | 633                            |
| index.html | data-tip-case     | IP-DEMO-03-5                                 | 641                            |
| index.html | data-id           | IP-DEMO-04-1                                 | 649                            |
| index.html | data-sel          | IP-DEMO-04-1                                 | 651                            |
| index.html | data-tip-case     | IP-DEMO-04-1                                 | 659                            |
| index.html | data-id           | IP-DEMO-04-2                                 | 667                            |
| index.html | data-sel          | IP-DEMO-04-2                                 | 669                            |
| index.html | data-tip-case     | IP-DEMO-04-2                                 | 677                            |
| index.html | data-id           | IP-DEMO-04-3                                 | 685                            |
| index.html | data-sel          | IP-DEMO-04-3                                 | 687                            |
| index.html | data-tip-case     | IP-DEMO-04-3                                 | 695                            |
| index.html | data-id           | IP-DEMO-04-4                                 | 703                            |
| index.html | data-sel          | IP-DEMO-04-4                                 | 705                            |
| index.html | data-id           | IP-DEMO-04-5                                 | 721                            |
| index.html | data-sel          | IP-DEMO-04-5                                 | 723                            |
| index.html | data-tip-case     | IP-DEMO-04-5                                 | 731                            |
| index.html | data-id           | IP-DEMO-05-2                                 | 739                            |
| index.html | data-sel          | IP-DEMO-05-2                                 | 741                            |
| index.html | data-tip-case     | IP-DEMO-05-2                                 | 749                            |
| index.html | data-id           | IP-DEMO-05-3                                 | 757                            |
| index.html | data-sel          | IP-DEMO-05-3                                 | 759                            |
| index.html | data-tip-case     | IP-DEMO-05-3                                 | 767                            |
| index.html | data-id           | IP-DEMO-05-4                                 | 775                            |
| index.html | data-sel          | IP-DEMO-05-4                                 | 777                            |
| index.html | data-id           | IP-DEMO-05-5                                 | 793                            |
| index.html | data-sel          | IP-DEMO-05-5                                 | 795                            |
| index.html | data-tip-case     | IP-DEMO-05-5                                 | 803                            |
| index.html | data-id           | IP-DEMO-06-2                                 | 811                            |
| index.html | data-sel          | IP-DEMO-06-2                                 | 813                            |
| index.html | data-id           | IP-DEMO-06-3                                 | 829                            |
| index.html | data-sel          | IP-DEMO-06-3                                 | 831                            |
| index.html | data-tip-case     | IP-DEMO-06-3                                 | 839                            |
| index.html | data-id           | IP-DEMO-06-4                                 | 847                            |
| index.html | data-sel          | IP-DEMO-06-4                                 | 849                            |
| index.html | data-tip-case     | IP-DEMO-06-4                                 | 857                            |
| index.html | data-id           | IP-DEMO-06-5                                 | 865                            |
| index.html | data-sel          | IP-DEMO-06-5                                 | 867                            |
| index.html | data-tip-case     | IP-DEMO-06-5                                 | 875                            |
| index.html | data-id           | IP-DEMO-07-2                                 | 883                            |
| index.html | data-sel          | IP-DEMO-07-2                                 | 885                            |
| index.html | data-tip-case     | IP-DEMO-07-2                                 | 893                            |
| index.html | data-id           | IP-DEMO-07-3                                 | 901                            |
| index.html | data-sel          | IP-DEMO-07-3                                 | 903                            |
| index.html | data-tip-case     | IP-DEMO-07-3                                 | 911                            |
| index.html | data-id           | IP-DEMO-07-4                                 | 919                            |
| index.html | data-sel          | IP-DEMO-07-4                                 | 921                            |
| index.html | data-tip-case     | IP-DEMO-07-4                                 | 929                            |
| index.html | data-id           | IP-DEMO-07-5                                 | 937                            |
| index.html | data-sel          | IP-DEMO-07-5                                 | 939                            |
| index.html | data-tip-case     | IP-DEMO-07-5                                 | 947                            |
| index.html | data-id           | IP-DEMO-08-1                                 | 955                            |
| index.html | data-sel          | IP-DEMO-08-1                                 | 957                            |
| index.html | data-id           | IP-DEMO-08-2                                 | 973                            |
| index.html | data-sel          | IP-DEMO-08-2                                 | 975                            |
| index.html | data-id           | IP-DEMO-08-3                                 | 991                            |
| index.html | data-sel          | IP-DEMO-08-3                                 | 993                            |
| index.html | data-tip-case     | IP-DEMO-08-3                                 | 1001                           |
| index.html | data-id           | IP-DEMO-08-4                                 | 1009                           |
| index.html | data-sel          | IP-DEMO-08-4                                 | 1011                           |
| index.html | data-id           | IP-DEMO-08-5                                 | 1027                           |
| index.html | data-sel          | IP-DEMO-08-5                                 | 1029                           |
| index.html | data-tip-case     | IP-DEMO-08-5                                 | 1037                           |
| index.html | data-id           | IP-DEMO-09-1                                 | 1045                           |
| index.html | data-sel          | IP-DEMO-09-1                                 | 1047                           |
| index.html | data-id           | IP-DEMO-09-2                                 | 1063                           |
| index.html | data-sel          | IP-DEMO-09-2                                 | 1065                           |
| index.html | data-tip-case     | IP-DEMO-09-2                                 | 1073                           |
| index.html | data-id           | IP-DEMO-09-3                                 | 1081                           |
| index.html | data-sel          | IP-DEMO-09-3                                 | 1083                           |
| index.html | data-tip-case     | IP-DEMO-09-3                                 | 1091                           |
| index.html | data-id           | IP-DEMO-09-4                                 | 1099                           |
| index.html | data-sel          | IP-DEMO-09-4                                 | 1101                           |
| index.html | data-tip-case     | IP-DEMO-09-4                                 | 1109                           |
| index.html | data-id           | IP-DEMO-09-5                                 | 1117                           |
| index.html | data-sel          | IP-DEMO-09-5                                 | 1119                           |
| index.html | data-tip-case     | IP-DEMO-09-5                                 | 1127                           |
| index.html | data-id           | IP-DEMO-10-1                                 | 1135                           |
| index.html | data-sel          | IP-DEMO-10-1                                 | 1137                           |
| index.html | data-id           | IP-DEMO-10-2                                 | 1153                           |
| index.html | data-sel          | IP-DEMO-10-2                                 | 1155                           |
| index.html | data-id           | IP-DEMO-10-3                                 | 1171                           |
| index.html | data-sel          | IP-DEMO-10-3                                 | 1173                           |
| index.html | data-tip-case     | IP-DEMO-10-3                                 | 1181                           |
| index.html | data-id           | IP-DEMO-10-4                                 | 1189                           |
| index.html | data-sel          | IP-DEMO-10-4                                 | 1191                           |
| index.html | data-tip-case     | IP-DEMO-10-4                                 | 1199                           |
| index.html | data-id           | IP-DEMO-10-5                                 | 1207                           |
| index.html | data-sel          | IP-DEMO-10-5                                 | 1209                           |
| index.html | data-id           | IP-DEMO-11-1                                 | 1225                           |
| index.html | data-sel          | IP-DEMO-11-1                                 | 1227                           |
| index.html | data-tip-case     | IP-DEMO-11-1                                 | 1235                           |
| index.html | data-id           | IP-DEMO-11-2                                 | 1243                           |
| index.html | data-sel          | IP-DEMO-11-2                                 | 1245                           |
| index.html | data-tip-case     | IP-DEMO-11-2                                 | 1253                           |
| index.html | data-id           | IP-DEMO-11-3                                 | 1261                           |
| index.html | data-sel          | IP-DEMO-11-3                                 | 1263                           |
| index.html | data-tip-case     | IP-DEMO-11-3                                 | 1271                           |
| index.html | data-id           | IP-DEMO-11-4                                 | 1279                           |
| index.html | data-sel          | IP-DEMO-11-4                                 | 1281                           |
| index.html | data-tip-case     | IP-DEMO-11-4                                 | 1289                           |
| index.html | data-id           | IP-DEMO-11-5                                 | 1297                           |
| index.html | data-sel          | IP-DEMO-11-5                                 | 1299                           |
| index.html | data-tip-case     | IP-DEMO-11-5                                 | 1307                           |
| index.html | data-id           | IP-DEMO-12-1                                 | 1315                           |
| index.html | data-sel          | IP-DEMO-12-1                                 | 1317                           |
| index.html | data-tip-case     | IP-DEMO-12-1                                 | 1325                           |
| index.html | data-id           | IP-DEMO-12-2                                 | 1333                           |
| index.html | data-sel          | IP-DEMO-12-2                                 | 1335                           |
| index.html | data-tip-case     | IP-DEMO-12-2                                 | 1343                           |
| index.html | data-id           | IP-DEMO-12-3                                 | 1351                           |
| index.html | data-sel          | IP-DEMO-12-3                                 | 1353                           |
| index.html | data-tip-case     | IP-DEMO-12-3                                 | 1361                           |
| index.html | data-id           | IP-DEMO-12-4                                 | 1369                           |
| index.html | data-sel          | IP-DEMO-12-4                                 | 1371                           |
| index.html | data-tip-case     | IP-DEMO-12-4                                 | 1379                           |
| index.html | data-id           | IP-DEMO-12-5                                 | 1387                           |
| index.html | data-sel          | IP-DEMO-12-5                                 | 1389                           |
| index.html | data-id           | IP-DEMO-13-1                                 | 1405                           |
| index.html | data-sel          | IP-DEMO-13-1                                 | 1407                           |
| index.html | data-tip-case     | IP-DEMO-13-1                                 | 1415                           |
| index.html | data-id           | IP-DEMO-13-2                                 | 1423                           |
| index.html | data-sel          | IP-DEMO-13-2                                 | 1425                           |
| index.html | data-id           | IP-DEMO-13-3                                 | 1441                           |
| index.html | data-sel          | IP-DEMO-13-3                                 | 1443                           |
| index.html | data-tip-case     | IP-DEMO-13-3                                 | 1451                           |
| index.html | data-id           | IP-DEMO-13-4                                 | 1459                           |
| index.html | data-sel          | IP-DEMO-13-4                                 | 1461                           |
| index.html | data-tip-case     | IP-DEMO-13-4                                 | 1469                           |
| index.html | data-id           | IP-DEMO-13-5                                 | 1477                           |
| index.html | data-sel          | IP-DEMO-13-5                                 | 1479                           |
| index.html | data-tip-case     | IP-DEMO-13-5                                 | 1487                           |
| index.html | data-id           | IP-DEMO-14-2                                 | 1495                           |
| index.html | data-sel          | IP-DEMO-14-2                                 | 1497                           |
| index.html | data-id           | IP-DEMO-14-3                                 | 1513                           |
| index.html | data-sel          | IP-DEMO-14-3                                 | 1515                           |
| index.html | data-id           | IP-DEMO-14-4                                 | 1531                           |
| index.html | data-sel          | IP-DEMO-14-4                                 | 1533                           |
| index.html | data-id           | IP-DEMO-14-5                                 | 1549                           |
| index.html | data-sel          | IP-DEMO-14-5                                 | 1551                           |
| index.html | data-tip-case     | IP-DEMO-14-5                                 | 1559                           |
| index.html | data-id           | IP-DEMO-15-2                                 | 1567                           |
| index.html | data-sel          | IP-DEMO-15-2                                 | 1569                           |
| index.html | data-tip-case     | IP-DEMO-15-2                                 | 1577                           |
| index.html | data-id           | IP-DEMO-15-3                                 | 1585                           |
| index.html | data-sel          | IP-DEMO-15-3                                 | 1587                           |
| index.html | data-tip-case     | IP-DEMO-15-3                                 | 1595                           |
| index.html | data-id           | IP-DEMO-15-4                                 | 1603                           |
| index.html | data-sel          | IP-DEMO-15-4                                 | 1605                           |
| index.html | data-tip-case     | IP-DEMO-15-4                                 | 1613                           |
| index.html | data-id           | IP-DEMO-15-5                                 | 1621                           |
| index.html | data-sel          | IP-DEMO-15-5                                 | 1623                           |
| index.html | data-tip-case     | IP-DEMO-15-5                                 | 1631                           |
| index.html | data-id           | IP-DEMO-16-2                                 | 1639                           |
| index.html | data-sel          | IP-DEMO-16-2                                 | 1641                           |
| index.html | data-tip-case     | IP-DEMO-16-2                                 | 1649                           |
| index.html | data-id           | IP-DEMO-16-3                                 | 1657                           |
| index.html | data-sel          | IP-DEMO-16-3                                 | 1659                           |
| index.html | data-tip-case     | IP-DEMO-16-3                                 | 1667                           |
| index.html | data-id           | IP-DEMO-16-4                                 | 1675                           |
| index.html | data-sel          | IP-DEMO-16-4                                 | 1677                           |
| index.html | data-tip-case     | IP-DEMO-16-4                                 | 1685                           |
| index.html | data-id           | IP-DEMO-16-5                                 | 1693                           |
| index.html | data-sel          | IP-DEMO-16-5                                 | 1695                           |
| index.html | data-tip-case     | IP-DEMO-16-5                                 | 1703                           |
| index.html | data-id           | IP-DEMO-02-4x                                | 1711                           |
| index.html | data-sel          | IP-DEMO-02-4x                                | 1713                           |
| index.html | data-tip-case     | IP-DEMO-02-4x                                | 1721                           |
| index.html | data-id           | IP-DEMO-02-5x                                | 1729                           |
| index.html | data-sel          | IP-DEMO-02-5x                                | 1731                           |
| index.html | data-tip-case     | IP-DEMO-02-5x                                | 1739                           |
| index.html | data-tab          | t-detail                                     | 1777                           |
| index.html | data-tab          | t-files                                      | 1778                           |
| index.html | data-dot          | files                                        | 1778                           |
| index.html | data-tab          | t-costs                                      | 1779                           |
| index.html | data-dot          | costs                                        | 1779                           |
| index.html | data-collapse-key | timeline                                     | 1785                           |
| index.html | data-status       | 合作中                                       | 1913                           |
| index.html | data-status       | 暂停                                         | 1914                           |
| index.html | data-status       | 已终止                                       | 1915                           |
| index.html | data-id           | C-2024-001                                   | 1949                           |
| index.html | data-id           | C-2024-002                                   | 1964                           |
| index.html | data-id           | C-2023-015                                   | 1979                           |
| index.html | data-id           | C-2024-007                                   | 1994                           |
| index.html | data-id           | C-2025-003                                   | 2009                           |
| index.html | data-id           | C-2024-011                                   | 2024                           |
| index.html | data-id           | C-2023-028                                   | 2039                           |
| index.html | data-id           | C-2024-019                                   | 2054                           |
| index.html | data-tab          | c-info                                       | 2126                           |
| index.html | data-tab          | c-assets                                     | 2127                           |
| index.html | data-tab          | c-settle                                     | 2128                           |
| index.html | data-col          | pushTime                                     | 2700                           |
| index.html | data-col          | buyTime                                      | 2701                           |
| index.html | data-col          | photos                                       | 2702                           |
| index.html | data-col          | notaryNo                                     | 2703                           |
| index.html | data-col          | sender                                       | 2704                           |
| index.html | data-col          | senderPhone                                  | 2705                           |
| index.html | data-col          | senderAddr                                   | 2706                           |
| index.html | data-col          | feeN                                         | 2706                           |
| index.html | data-col          | investFee                                    | 2706                           |
| index.html | data-col          | feeP                                         | 2706                           |
| index.html | data-status       | 未交付                                       | 2913                           |
| index.html | data-status       | 在库                                         | 2914                           |
| index.html | data-status       | 已邮寄律师                                   | 2915                           |
| index.html | data-status       | 已销毁                                       | 2916                           |
| index.html | data-tip          | ct1                                          | 3155                           |
| index.html | data-tip          | ct2                                          | 3164                           |
| index.html | data-tip          | ct3                                          | 3167                           |
| index.html | data-tip          | ct4                                          | 3167                           |
| index.html | data-tip          | ct5                                          | 3170                           |
| index.html | data-tip          | ct6                                          | 3170                           |
| index.html | data-tip          | ct7                                          | 3173                           |
| index.html | data-tip          | ct8                                          | 3173                           |
| index.html | data-tip          | ct9                                          | 3176                           |
| index.html | data-tip          | ct10                                         | 3176                           |
| index.html | data-tip          | ct11                                         | 3179                           |
| index.html | data-tab          | cust                                         | 3244                           |
| index.html | data-tab          | law                                          | 3247                           |
| index.html | data-tab          | fee                                          | 3251                           |
| index.html | data-status       | 待发账单                                     | 3263                           |
| index.html | data-status       | 已开票                                       | 3264, 3472                     |
| index.html | data-status       | 已回款                                       | 3265                           |
| index.html | data-status       | 待提交                                       | 3471                           |
| index.html | data-status       | 已打款                                       | 3473                           |
| index.html | data-col          | type                                         | 3735                           |
| index.html | data-col          | dir                                          | 3735                           |
| index.html | data-col          | status                                       | 3735                           |
| index.html | data-col          | date                                         | 3735                           |
| index.html | data-modal-close  |                                              | 3997, 4001, 4033               |
| index.html | data-fk           | lawyer                                       | 4014                           |
| index.html | data-fk           | lawyerPhone                                  | 4018                           |
| index.html | data-fk           | lawyerFirm                                   | 4022                           |
| index.html | data-fk           | lawyerAddr                                   | 4026                           |
