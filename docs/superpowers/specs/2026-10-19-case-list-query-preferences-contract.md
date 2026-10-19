# CORE-CL-001（UXQ-04A）内部案件列表查询与列偏好

依据用户持续要求的 Demo 对齐、简单操作及 2026-10-19 接续实施指派，冻结可独立实施的首片。基线为开发集成树 c00de1f72ec286d708ea30ee00e1b72856471fc7；人工服务 ca015 不变。本文是后续新增合同，不回写 CA-016 原验收范围。

## 现有能力与本片差异

- 正式系统已有 mine/department、16 个阶段/两个阶段组、20 条分页、服务端 total/counts、真实 14 列摘要及列表原位办理，不重复开发。现查询只接受分页/范围/阶段，排序固定 createdAt desc、id asc；案件没有账号列偏好表或接口。
- Demo app.js 的 FILTER/filteredCases/openColPrefs（约1394–1655行）有关键词、行内高级筛选、排序和每流程独立列显隐；其 localStorage 不能满足 UXQ-04 明确的实际账号保存要求。现有公证服务端偏好为实现参考，不改该表或模块。
- 首片只覆盖下面的有限查询/排序及现有列设置。案件类型/运营人员新目录、平台店铺来源查询、法院/律师查询、开庭/结案日期及金额范围/金额排序、阶段多选、统计 KPI、导出、批量归档、删除或合并仍是后续片，不在本片宣称 Demo 全量完成。

## 查询、排序与分页

现有 GET /api/v1/cases 新增可选参数；原 page/pageSize/view/stage/stageGroup 语义及 stage 与 stageGroup 互斥保持。

| 参数             | 冻结规则                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| q                | trim 后非空才生效，最多200字符；按字面、不区分大小写的包含匹配 businessNo、courtCaseNo、customer.name、rightsHolder.name、defendants.name，五字段 OR。提示文案明确“编号、案号、客户、权利主体、被告”。不搜索 UUID、材料或内部原因。 |
| customerName     | trim 后最多200字符；客户名称字面包含。                                                                                                                                                                                              |
| rightsHolderName | trim 后最多200字符；权利主体名称字面包含。                                                                                                                                                                                          |
| courtCaseNo      | trim 后最多200字符；正式 courtCaseNo 字面包含；null 不命中非空条件。                                                                                                                                                                |
| sortBy           | createdAt / businessNo / rightsHolderName 白名单；缺省 createdAt。                                                                                                                                                                  |
| sortDirection    | asc / desc；缺省 desc。没有指定 sortBy 时仍可合法使用默认 createdAt，单独指定 sortBy 时沿 desc 默认；UI每次显式发送配对值。                                                                                                         |

- 文本条件彼此 AND；q 内部五字段 OR。空白条件省略；用户 `%`、`_`、反斜杠不得成为 SQL LIKE 通配符。参数化/ORM 白名单构造，禁止用户输入成为 SQL 标识符或排序表达式。
- 所有列表读取先保留现有部门/账号/数据范围条件，再组合文本与阶段条件；必须在数据库分页前过滤、排序，不能先取一页再本地筛选。
- 排序均追加 id asc 作为稳定同值顺序。编号按已存字符串排序；rightsHolderName 按真实关联名称排序，不用展示占位/UUID，不给金额强加0。数据库现有文本排序规则保持，不新增拼音/自然数排序。
- total 使用授权范围+文本条件+阶段/阶段组；counts 使用授权范围+同一文本条件、排除当前阶段筛选，保留导航阶段分布含义。没有新条件时输出与原合同一致。不把本片 counts 当新增财务/月份统计。
- 本片新查询能力仅内部人员；共享服务的律师原读取/当前PRIMARY范围保持，新内部查询参数不得打开外部账号范围。客户/公证端不新增入口。
- 前端 cases.ts 导出 CaseListQuery（仅上述六种可选查询属性及其字面联合类型），现有 listCases(page,pageSize,options) 仅将它并入原 options，不改方法名、原返回或业务写入口。
- UI使用显式“查询”/回车应用与“清除筛选”，不每键请求。改变查询/排序/范围/阶段回第1页；分页、详情往返和办理后刷新保留合法查询。URL仅使用白名单标量，重复/数组/非法枚举明确报错，不静默扩成全范围。

## 列设置与保存合同

保留当前14列及当前来源/金额三态。键顺序默认如下：

```text
businessNo, stage, customerName, rightsHolderName, platform, shopName,
shopExternalId, defendants, lawyers, court, courtCaseNo,
claimAmount, judgmentAmount, closureAmount
```

- businessNo 表示原“操作／案件编号”整列，stage 表示案件进展，前两列固定顺序且不可隐藏；剩余12列可显隐、通过上下移按钮调序。不新增批量选择列、拖拽依赖或通用表格框架。
- 首次默认全部显示，沿当前正式顺序；名称展开、长文本、金额来源说明及原办理按钮/权限不改。可只保留两固定列；空态 colspan 与 colgroup 跟随实际列数。
- 每个当前账号、当前部门、流程桶独立保存；桶是 all、单个阶段值、两个阶段组值之一，枚举集合互斥且有限。mine/department 共用同一流程桶；文本条件/分页/排序不进入列偏好或账号存储。流程切换分别读写，不把 Demo 的阶段独立记忆降成全局一套。
- 新增 GET/PUT /api/v1/cases/list-preferences/:bucket。bucket 从上述19个合法值取一；无账号/部门ID参数。PUT完整 body仅 {order,hidden}；order 为14键完整唯一排列、前两键固定，hidden 为12个可选键的唯一子集。缺项/未知/重复/固定列隐藏/额外字段均400。
- 响应严格仅 {order,hidden}。GET无保存行返回默认值。对已有存储中未来/损坏键在服务内按白名单去重、固定列归位、补齐缺列；不能把请求验证也放宽。重置默认先修改对话框草稿，点击“保存”才 PUT；取消不写。
- 前端独立 case-list-preference.ts 冻结公开 CaseListColumn、CaseListOptionalColumn、CaseListPreferenceBucket、CaseListPreference、defaultCaseListPreference，及 getCaseListPreference(bucket,options?:RequestOptions)、saveCaseListPreference(bucket,preference,options?:RequestOptions):Promise<CaseListPreference>；两方法各自固定 GET/PUT，不按会话猜前缀。
- 服务只接受当前active INTERNAL及原 case.read 授权，不新增Action或复制Grant；userId/departmentId只取当前Actor。无权/失权时403，不先查询或返回旧偏好。旧律师/客户/公证端不借此入口读写。
- 存储为新 CaseListPreference 模型，复合键(userId,departmentId,bucket)，columnOrder/hiddenColumns/updatedAt；绑定真实部门成员关系（Restrict），不接受外部任意账号。只存列键，不存案件、关键词、材料或登录状态。并发保存采用完整替换、最后提交生效；不是业务Command，不建业务回执/审计，不改Case.version/stage。
- 新migration文本唯一目录 backend/prisma/migrations/20261019120000_case_list_preferences/，只增本表/FK/必要CHECK及索引，不改旧SQL或旧用户/Grant/业务行；本次不执行。开发树含CSV166，加入后是该独立链167；公证独立166不自动混入。旧CSV专项目标166不放宽，继续在其原候选执行。
- UI保存成功仅在相同账号、部门、授权代次、流程桶的当前请求有效时应用；换人/同用户重登/切流程/卸载后旧响应丢弃。失败或未知保留草稿、明确“未确认保存”，不显示已保存；下次GET确认服务端状态。无 localStorage 降级冒充账号保存。
- 沿用原Drawer canLeave/unknown互斥；查询/排序导致路由变化时不能绕过未确认业务写入。列设置不产生办理命令，不清既有pending或变更原body/key。

## 唯一文件所有权与交付顺序

根主控只维护本文、cases Living Spec、roadmap/status/VALIDATION及已检查快照，不写子任务业务源。

| Owner              | 独占文件                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后端/共享合同，Sol | case-read.dto.ts/controller.ts/service.ts及其直接controller/service spec；新case-list-query.ts/.spec.ts；新case-list-preference.dto.ts/service.ts/controller.ts及各直接.spec.ts；case.module.ts；backend/prisma/schema.prisma；上述唯一新migration.sql；scripts/prisma-model-owners.mjs；core-ld-openapi.spec.ts。均在 backend/src/modules/cases 下，除已列根路径。 |
| 严格前端API，Luna  | frontend/src/api/cases.ts/.spec.ts；新frontend/src/api/case-list-preference.ts/.spec.ts。只追加已冻查询/偏好类型、路由和decoder，不改http/auth。                                                                                                                                                                                                                    |
| 页面/列设置，Luna  | frontend/src/modules/cases/CaseListPage.vue、CaseListDisplay.spec.ts；新CaseListPreferencesPanel.vue/.spec.ts、case-list-query.ts/.spec.ts（仅确需提取的纯路由解析/序列化）。不改WorkflowPanel、Drawer、业务adapter或全局样式。                                                                                                                                     |

先发布DTO/偏好键与查询参数可编译小基线，再同步API，页面可据本文编写mock契约但不得借WIP伪称真实联调完成。后端实现与普通UI可以并行；同一文件不得双Owner。任何新共享路径/实质业务歧义先报告，普通技术细节自行落实；不以“等待CSV人工输出”为停工理由。

## 定向验证与尚未执行

- 后端纯DTO/HTTP/OpenAPI、查询构造及服务mock：文字字面转义、AND/OR、同值跨页稳定、null/空白、pageSize边界、非法字段/枚举、view/部门/律师旧scope与total/counts；偏好账号/部门/桶隔离、完整替换/重置、请求严拒与存储归一化分离、失权前置、零业务写。
- 前端API纯mock：URL白名单/编码/空值、原list响应严格decoder保持、prefs exact shape/固定列/排列、错误传播、信号与输入快照、无自动假成功。
- 页面纯组件：查询/清除/回第1页、排序切换/保留上下文、乱序响应丢弃；14列默认/2固定/12显隐调序/取消/重置待保存/失败未知/流程桶/身份重登隔离；Drawer未知写入仍阻止导航；当前金额三态/真实来源与办理回归保持。
- 各Owner运行直接相关纯测试、所需prepared类型、白名单Lint/格式/architecture/diff；新增Prisma模型仅validate/generate，不连接DB。schema/迁移和读取范围由另一Sol在固定候选独立复审，集成后按风险安排最终门禁。
- 本片有真实偏好写入和查询隔离行为，后续必须另给固定候选的真实PG/E2E、空链/旧数据升级与有限页面预算，不能以mock或verify代替。现在不capture、不Docker、不DB、不HTTP、不浏览器、不启动第二服务、不运行完整verify/NT006，不消耗或复用旧额度，不部署、不push、不合运行树。
