# M00 共享运行机制：源码事实

A=[app.js](../../../../demo/app.js)。固定版本与5文件全文覆盖见 [INVENTORY](../INVENTORY.md)、[COVERAGE](../COVERAGE.md)。本模块复核L1–63、L391–1196、L1926–2039、L2885–2950、L3008–3070、L4803–4854、L6113–6233、L7568–7576、L7644–7813、L8254–8284、L9665–9700、L12308–12332、L13196–13215；共享函数的业务调用归各模块。

## 运行边界与配置

单HTML入口引用CSS及普通JS，11个DOM视图；showView切换active、不更新URL；fees兼容导航转结算中心fee Tab，详情映射主导航。传入不存在视图时先清active再提示，可能留下空白视图（L6113–6176）。五文件未发现HTTP服务端路由；全app.js检索fetch/XMLHttpRequest/WebSocket未命中。外部字体／示例商品链接不是业务API。已确认部门隔离和四端方向单独见 [INPUT-001](../../../deferred-design.md)，不能从role文案认定授权已实现。

| 常量／共享状态                                             | 实际用途／限制                                                                                     | 位置                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| CASE_TYPES、INFRINGE_TYPES、SOURCES、平台、法院、OPERATORS | 下拉／渲染配置；运营名单仅姓名配色，不是账号。线索平台与案件平台集合有差异；正式全集UNKNOWN        | L11–63                             |
| STATE                                                      | 仅cases/customers/fees；currentCaseId/currentCustomerId另行声明为全局当前选择变量，不属于STATE     | L1091–1104                         |
| SK、SAVE_VER                                               | ipcase_demo_v2／25；主存档版本与导出包__version=2不同                                              | L702–703、L1107–1175               |
| 三类列偏好                                                 | ip_col_prefs_v1、ip_notary_col_prefs_v1、ip_fee_col_prefs_v1；独立localStorage键，重置SK不删除它们 | L1571–1603、L1629–1661、L4357–4390 |
| MODAL_OK、MODAL_NO_ESCAPE、MODAL_FILE_HOOKS                | 当前弹窗提交回调、关闭策略及字段识别回调表，不是业务任务／审批状态                                 | L425–482、L587–590、L667–688       |
| DEMO_DEFAULTS                                              | 9个扩展集合出厂拷贝；restore按原地数组回填，空源也退种子                                           | L9665–9695                         |
| LAWYER_TASKS／COLS                                         | 8条旧律师待办种子及3栏配置；只发现已无挂载的看板引用，不能列为已实现律师端                         | L8254–8268、L9230                  |

## 存取、初始化与失败

- save JSON包含STATE及leads/notary/evidences/notaryDocs/calEvents/custBills/lawBills/bills/docTemplates；localStorage异常被吞，没有向调用者返回失败，因此toast保存成功不能证明持久化（L1107–1122）。
- load版本不等25移除存档返回false；state缺失／cases非数组或空，仅返回false，该分支不移除存档；七个扩展键缺失／非数组才移除存档并返回false。案件按id保留首个；客户空数组退默认、缺费用退种子；缺明细／日志／律师条件补样例，侵权旧值按关键词归并，无法归并丢弃；公证调查费缺失补种子。异常只返回false，不保证回滚已改内存（L1124–1175、L522–532）。
- restoreExtras的put将合法空数组与缺失同样回退种子；浅放回种子项，不能当成可验证备份恢复。init还按阶段补演示案件、补业务号、save/render；恢复成功再次save。因此刷新会主动改写数据，不是纯读取（L9678–9695、L13196–13215；fillStageDemoCases详见M02）。
- renderAll逐模块try/catch记录console.error并继续；pageerror=0不意味着渲染没有被捕获的异常。客户列表调用两次；客户详情默认第一客户（L4827–4849）。

## 表单、事件与字段

formModal收集普通字段.trim字符串，required只拦第一个空字段，custom直接read并跳过通用必填；number/date的业务范围须各提交函数自己校验。提交返回false保留弹窗，否则关闭。f.value用`|| ''`使数值0初始显示为空。openModal复用同一DOM，异步文件识别回调读取当前modal-body，没有本次弹窗身份核对（L587–698）。

全局click负责弹窗、Tab、勾选、排序、各模块筛选；input负责案件／客户搜索；focusout把editable的data-ov动态写入当前案ov并save，无字段级业务校验；Enter在弹窗内统一触发确定，Escape遵守noEscape，Ctrl/Cmd+K聚焦搜索（L7644–7801）。UI索引枚举出现点，不保证全部路径可达；动态键语义未知项仍属U18。

## 文件与格式工具

- 文件字段通常只保留名称（数组或顿号字符串），删除只删名称，docDownload仅toast。点击选择走识别回调；拖拽仅取名称写入，不运行相同识别链。多文件选择才追加，单次单文件会覆盖formFilePicked旧值；控件multiple不能当作永久追加保证（L668–688、L1930–2036）。
- ZIP输出store不压缩、UTF8路径及CRC32；读取中央目录，method0直接读，method8依赖DecompressionStream，失败／不支持标skipped；没有完整归档安全校验或大小上限。正文金额取匹配“元／万元”中的最大值并四舍五入，不是AI语义识别（L2890–2947、L3008–3067）。
- 通用CSV双引号包围／双引号转义、BOM、换行；未在L7568–7576发现公式前缀处理，是否产生表格公式风险需后续目标软件验证，不宣称已执行漏洞验证。
- today使用UTC日期；stamp拼接UTC日期和本地小时分钟；calToday用本地年月，plusDays用本地午夜。这些不是统一业务时区策略。daysTo以UTC日期差向上取整。numOf删掉非数字／点并Number||0，负号／非法文本可能丢失或变0。money保留2位但结算Math.round见M06；显示精度不是存储约束（L395–401、L880–881、L12326–12331）。
- caseExtras/customerExtras/caseLog/castOf是演示派生，可生成当事人、费用、商品、日志、联系人、协议等。费用种子计算不当成已确认法律／财务规则；非种子流程调用造成假数据见M02/M10。normBlank统一占位，normalizeInfringe迁移会丢未知旧值（L762–1083、L12308–12318）。

## 场景（源码推导）

| 编号 | 前置／操作                                         | 可观察结果                                                             |
| ---- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| XS01 | localStorage.setItem抛异常，业务动作调用save       | save不抛也不报告失败，内存可能改变而刷新不保留；L1107–1122             |
| XS02 | 存档扩展数组合法为空，恢复                         | 回种子而非保持空；L9682–9695；证物ET03仅验证render回种路径             |
| XS03 | 上海本地00:30、UTC前一天，调用today/stamp/calToday | 日期工具与本地月份／小时语义不一致；L397–398、L11373–11376             |
| XS04 | 多文件字段已有A，仅新选B一份                       | formFilePicked覆盖为B；拖拽B在multiple控件却追加；L675–681、L2007–2013 |
| XS05 | 旧侵权值“专利侵权”，执行normalizeInfringe          | 因不能确定子类返回空，不保留原文；L509–532                             |

共享修正方向和待定业务规则见 [M00候选](M00-shared-candidates.md)。
