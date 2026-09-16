# M01／M02 模块提取验证记录

日期：2026-09-16；源码指纹沿用 [INVENTORY](INVENTORY.md)。这是第二人工检查点的提取证据，不是全部 Demo、正式业务或生产验收。阶段 0 记录 [VALIDATION](VALIDATION.md) 保留原范围，不覆写为本轮结果。

## 静态提取与可追溯性

五文件在阶段 0 已完整阅读，连续区间在 [COVERAGE](COVERAGE.md)。本轮先复核 M01 的配置、编号、过滤、创建／导入、审核确认、归档、移交、编辑全部相关函数，再串行复核 M02 的阶段表、字段提交、批量文书、被告／律师、一二审／执行、归档、合并、编辑、删除、展示和跨模块调用。AST 索引用作遗漏补查，不代替全文阅读。

事实文档、候选输入物理分离。domain-modeling 技能用于区分客户／权利主体、业务单号／法院案号、案件阶段／二审进展等概念；未把未决词义写入已批准领域模型。确定性修订：ENTITIES 中 LEAD_STAGES 原抄写值修正为 `待推送、线索待审核、线索待确认、线索已归档`，对应 A:L7814–7819，Demo 不变。

## 隔离浏览器执行

已有 Playwright 1.63.0、Chromium 153.0.8010.12；Node 24.21.0、pnpm 11.27.0 与项目锁定一致。通过 file:// 打开 Demo，无服务端口；每个场景全新 browser context，时区 Asia/Shanghai，阻断所有 HTTP(S) 请求。只操作种子／测试数据，不使用真实案卷或用户现有浏览器。两个脚本结束都关闭浏览器，最终进程退出码 0；未安装依赖，脚本只在系统临时目录，不修改 Demo。

采用 webapp-testing 方法，但用项目已有 Node Playwright。执行脚本输出观察值，由本轮逐项对照源码，不冒称有 20 条自动断言或完整产品测试。

| 批次 | UTC 时间／本地时间                 | 场景与结果                                              |
| ---- | ---------------------------------- | ------------------------------------------------------- |
| 线索 | 2026-09-16T01:56:50.020Z／09:56:50 | LT01～LT08 共8个，结果逐项见 M01 §6；每项 pageerror=[]  |
| 案件 | 2026-09-16T02:02:07.861Z／10:02:07 | CT01～CT12 共12个，结果逐项见 M02 §6；每项 pageerror=[] |

### 关键原始观察值摘录

| 场景 | 实际输出                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------- |
| LT01 | count=9, open=true, bad=[client,party,reason,shop,needDisclose]                                |
| LT02 | count=10, url='', title=只有名称, qty=2, price=1.5, cmt=0, sale=3；输入qty=-2                  |
| LT03 | before待推送=2, after待推送=0, filter=必定没有匹配                                             |
| LT04 | blocked=true, remaining=false, notaryAdded=1, id=N-2026-009, links=0, fromLead=LD-20260901-002 |
| LT05 | count=11；新数组头第二行店、第一行店；client/party='—'，needDisclose=''，商品url/title=''      |
| LT06 | label=未选择文件, count=10, shop=旧缓存店                                                      |
| LT07 | 线索已归档 → 线索待确认                                                                        |
| LT08 | 0销量／3评论／0.1单价=0.30000000000000004；numOf('-2')=2                                       |
| CT01 | count=81, status=已归档, defendants=2, expenses=8, links=3, archiveAt=null（原对象缺字段）     |
| CT02 | id=IP-20260320-007；caseNo和caseNoOf=（2026）测试法院001号；no仍（2026）京01民初5678号         |
| CT03 | status=已归档, archiveReason='', timeline新增阶段修改                                          |
| CT04 | before=强制执行中, after=强制执行中, saveOnly返回true                                          |
| CT05 | hearingAt=''，旧event.date=2026-10-01，autoToJudgeAt=2026-10-02                                |
| CT06 | status=诉状待确认, logDelta=0, timelineDelta=1                                                 |
| CT07 | requested=不正当竞争, reason=商标权, sources=2, removed=true, notaryAdded=2, caseCountDelta=-1 |
| CT08 | caseExists=false, notaryExists=true, calendarExists=true                                       |
| CT09 | status=待判决, autoToJudgeAt=2026-01-02                                                        |
| CT10 | 案件待匹配 → 待写执行材料                                                                      |
| CT11 | ok=true, status=待写诉状, lawyer='', defendants=0                                              |
| CT12 | hasSecondInstance({status:二审,secondInstanceBy:原告})=false；仅secondResult时=true            |

执行方式区别：LT01/05/06、CT01/02/03 为界面表单／文件操作（部分弹窗用函数打开）；LT02 注入表单测试值后点击提交；CT08 注入测试关联后点击删除确认；其余主要直接调用本地函数。**不以直接函数测试证明正常 UI 能操作、越权攻击成立或后端权限已实现**。

失败与修正：线索临时脚本首次把 `LEAD_SELECTED` 误写为 `LEAD_SELECTION`，在 LT03 中断，退出1；核对源码后修正并整批重跑，以上最终8场景来自重跑，未将失败首次算通过。取证函数参数顺序也按 L8478 校正后运行；没有为满足观察修改 Demo。

## 未执行及限制

- LS09～12、CS13～18 是源码推导，不是实测。尚未穷举真实文件类型、ZIP、边界时区、全部取消恢复、批量部分失败、付款及结算全流程。
- 未调用真实 HTTP 公证／财务服务，未验证正式鉴权、数据库事务、幂等、并发或权限范围；这些实现不在 Demo 本轮工作范围。
- 未运行项目正式代码测试、构建或 E2E；本轮只改文档，不能复用旧包测试数字称本轮通过。
- 最终全新上下文子代理审查尚未到达，REVIEW.md 尚未生成。先停在第二次人工抽查点，不能把这次自核对当独立审查。

## 文档交付核对

已执行并通过：五文件 SHA256 与固定指纹逐项一致；文档格式化、pnpm context:record、pnpm context:check（101 个文本文件，含相对文件链接检查）、pnpm format:check、git diff --check、git diff --cached --check。暂存区为空；既有 Demo 相对 HEAD 差异保留，本轮没有新增 Demo 字节变化。Git 的 LF/CRLF 提示保留，未转换 Demo 换行。回填本段与项目状态后再次格式化、记录并检查快照。未知／待决项保留，不修复 Demo；未提交、推送或发布。
