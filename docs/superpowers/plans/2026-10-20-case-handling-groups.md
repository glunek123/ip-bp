# CORE-CG-001｜案件合并办理组首片

用户已要求先合并推送全部已完成开发，再继续系统并行开发。前一阶段固定06eb56a0已完整verify通过、正常快进main并普通推送；远端main／开发分支均为该SHA，CI workflow runs／check runs／commit statuses均0，不称服务器CI通过。本片从该main开始，复用原任务和干净目录。

## 业务边界

唯一依据为案件Spec REQ-CA-006／AC-CA-006及SD-27：同一客户的案件建立可解除办理组，主管／本团队小组长的对应权限和完整源案范围均由后端校验。不得增加同主体、同被告、案由或阶段一致要求；不创建替代主案，不改源案编号、主体、被告、材料、费用、外部引用、阶段或Case.version。组内只聚合查看，逐案施加当前读取权限；入组不获得其他源案访问权，不显示不可读成员的资料或隐藏成员计数。操作前后成员集合留痕，解除后原案及历史仍完整。

首片只做建立组、读取组／源案归属聚合、解除组和原请求恢复；不做组内批量推进、支付、文件复制、跨客户组合、移除源案、导出或通用批处理平台。确实未冻结的规则不借本片解除；必要新Action只入目录，不写任何实际Grant。源Case的日期／状态／财务约束保持。

## 并行分工和最小接口

- 原后端Task独占新case-handling-group DTO／service／controller／read及直接测试、CaseModule接线、Prisma模型和新迁移文本、permission-catalog及模型主责登记。不得改旧170份迁移；若追加既有Action enum，按既有已提交边界拆出enum前置文本，禁止同事务未提交enum误用。先交可编译DTO／Action／read小基线与精确文件清单，主控再接稳定SHA给UI，不取WIP。
- 原前端Task独占新API及严格decoder、纯创建／详情／解除Panel和直接测试、独立组页面、router和案件列表最小入口。只补新Action枚举解码，不从全局组织catalog推断当前有效能力。先按下述注入接口实现纯组件，稳定后端合同交付后再真实接线；不向假API或宽松decoder降级。
- 原独立Reviewer不参与实现，先核Spec／接口边界，稳定组合再做两轴补审。主控独占本计划、权威文档、Git和最终集成。

内部API以`/api/v1/case-handling-groups`为独立资源，外部角色不增加写入口。创建输入为`{groupId,caseIds,idempotencyKey}`（稳定UUID、2～20条不同源案的请求技术界限）；解除为`POST /:id/dissolve`，输入`{expectedRevision,idempotencyKey}`，目标groupId只在route。Command结果最小为`{id,revision,status,recordedAt}`，ACTIVE初次revision1、解除DISSOLVED revision2。只读成员最小为`{caseId,businessNo,customerId,customerName,stage}`，组详情含`id/revision/status/createdAt/members/canDissolve`。

首个作者微合同发布`GET /capability -> {canCreate}`、`GET /candidates`分页选案、根分页组列表和`GET /:id`详情，分页默认20／上限100。创建成员视为集合，UUID小写去重排序，锁／指纹使用一致规范化结果；前端保存原body／key供核对。key不自动trim，而是要求原输入无首尾空白、Unicode码点1～128。不得默加“一案只能一组”或同阶段／主体／被告限制。该微合同纯测4套57项通过；I-CG-READ-01查询范围问题已由原Owner修为v2，仅read及直接spec变化，原窗口待补审，不能先记为ACCEPTED或可部署。首片材料／费用仍链接原源案视图，完整跨案材料／费用聚合AC尚未关闭。

所有写入重验当前身份／Action／全部源案范围，授权先于旧成功回执；版本／成员锁按既有串行规则，原key只认同完整body和同身份，未知结果保留原请求。原source／Case版本不写，组事实、成员、审计、typed回执在同一事务内；先列对应并发／直接SQL／失败原子风险，源单测不冒充PG证据。

## 当前所有权和验证

后端原Task `01a15384-ba4a-7902-8d44-b206731d58b3`，目录`case-list-csv-export-backend`，分支`codex/case-handling-groups-backend`；前端原Task `01a15385-5820-7511-96ed-ce69daf42633`，目录`case-list-csv-export-frontend`，分支`codex/case-handling-groups-frontend`。两目录已核旧成果clean后从06eb建立分支，原分支保留。独立Reviewer沿`01a1544b-f5f2-7e21-a2ec-bd9137c05e50`复用；三窗当前turn_context实际模型均已主控只读核实为gpt-6.1-sol，证据在ignored`.local/git-delivery-20261020/model-evidence.json`，未抽取其他私密内容或切模型。

后端必要共享接线追加归同Owner：`access-control.service.ts`的新Action联合类型、`prisma-access-control.store.ts`的枚举映射、`backend/src/access-control/organization.service.spec.ts`的目录数量夹具；不改原授权语义。前端08:51UTC开工回报一度等待工具审批；用户同意后原消息已实际发送成功，原窗口activeFlags为空，现已新增API及三个组件共5份源文件。该等待没有取消开发，也未重发原消息或创建替代作者；前后端按原分工继续，只读核实的消息结果不解释为新增DB／Grant授权。

作者只做聚焦纯测试、类型、Lint／格式和正常Prisma validate／generate；不连接DB、执行迁移、capture／Docker／HTTP／登录／服务／浏览器，不改实际Grant或测试账号，不跑完整verify。真实验收须另列精确运行范围，不能复用已耗尽额度。其他目录的客户详情2份及案件列表原6份／页面步骤WIP保留，不合入或覆盖。本文件是开工边界，不是实现、独立复审或真实验收完成记录。
