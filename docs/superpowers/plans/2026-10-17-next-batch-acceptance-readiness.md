# 下一批验收前置与一次性确认清单

状态：待确认的执行申请，不是执行授权。依据既有CORE-EF-001／UXQ-03合同及2026-10-17接续要求；源码准备基线为本地 `0565acbc88a3d01aeb70ba5176df179e0fa6bee1`。该提交尚未推送，远端备份仍为 `0b90e9c3e28f7a1a3cf6cd195728f6a6da43cc52`；新提交的公开上传范围另行确认。下列数量来自源码静态核对，未查询实时数据库，也未运行HTTP或浏览器。

## 1. 共同前置：先核环境和原证据，不重做成功操作

- 唯一拟用数据库仍为本机隔离R2：project `dev-cor-ui003-r2`，完整container ID `45addc0179e929dd1dcd4f835b6c6c14c36c2ac4aed5e6cd5842648bf5db5236`，`127.0.0.1:15438/dev_cor_test`、schema `public`。期望165份成功迁移，加唯一已正式resolved的原EF失败行；不创建新数据库、不部署、不再次resolve或迁移。
- 当前主控、原EF和旧运行树的 `.env.test` 实际指向15433；它们不能直接执行固定R2 helper。本单没有改配置或执行capture。执行前由唯一Runner正常准备获准R2配置及本树private-file root，检查两URL、真实container／卷／数据库身份；不得仅覆盖进程变量以绕过冲突校验。实时healthy、ledger和现有对象均待核，不把历史记录当现状。
- EF resolve三件原文件已找到，来源为原 `ef001-integration/.local/ef001-evidence/official-ef001-resolve/`：receipt.json 853bytes／SHA256 `162c5ead547631b44a84913abc8a7068191dc2198fb58a420b3f73fa98b3ed1c`；stdout.log 172bytes／`a51491bda92c3572154b87419a96572b0052ab3a47fe4222a568eca3a3b9ddfe`；stderr.log 961bytes／`211b3323777fed313dce76ef3c4b17609b34e69a87930c44483b90a18e6f256d`。原1832d991候选的普通Resolve-result、实际validator proof及post-deploy摘要相互对应。只核了日志字节hash，没有输出正文；无需重做已成功resolve。当前目录缺的是同一ignored路径接入，未来可按原字节和hash核定接入，不能补造成功回执。
- 原唯一执行任务为「验收独立环境快捷操作」`01a13e67-4068-778b-a1e9-9d808ecb50e8`；来源Task信息依据主控受信交接，不冒称回执JSON自带该字段。当前无向其发送新运行指令。
- fresh只读预检应记录所有起点旧PK行、全安全表、账本、Case、序列和真实文件hash，不把历史87案／92CV等数量硬编码为当前数量。盘点到期WAITING_HEARING与认证清理期限；如启动Nest会合法改动旧案或清理旧行，必须先列精确对象另裁，不能伪装成迁移或本批业务变化。未获明确许可不得启动服务。
- 正常完整verify含NT006真实数据库专项，本申请不默认重跑。产品及构建输入可证明与已有可信候选相同才限定复用；不能证明时先补相应门禁申请，不静默跳过。旧owned161／165专项、本批API以及真实页面是不同证据范围。

## 2. EF最小块：只选原14项中的首项

准确场景：`tests/e2e/case-execution-filing-followup.spec.ts` 的 `two internal operators append all four facts, preserve original filing/workflow and recover exact old keys after finish`。只证明内部API／数据库路径，不是写入式真实页面、PRIMARY律师、真实24h过期、流中竞争或完整14项。

| 类别         | 新申请硬边界                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 既有对象     | 复用经现场核准的合成部门、客户及权利主体；既存Case业务写入0，不恢复任何旧inactive角色，不改原权限。                                                                                                                                                                                                                                                                                    |
| 新身份       | source和operator各1个新UUID账号：用户、凭据、membership、role、assignment各2；新Grant共15，均DEPARTMENT。source为case.read＋EF四动作＋customer.read、case.external-entry.create、case.execution.mail、case.execution.filing.submit、case.execution.finish（10项）；operator仅case.read＋EF四动作（5项）。无新部门、客户、律师或企业绑定。                                              |
| 新业务对象   | 1个合成HISTORICAL_BACKFILL Case；正常external entry、execution mail、filing submit、finish各1次。原filing同键重放1次，不新增第二事实。Case由WAITING_EXECUTION_STAMP/v1，经正常邮寄/申请，到WAITING_ARCHIVE/v4；不结案、不归档。                                                                                                                                                        |
| EF事实       | 初次反馈／反馈更正／初次补交／补交更正各1次，共4条追加版本事实、4成功回执、4成功审计；补交2 typed documents＋2精确材料引用。EF本身不改Case版本、stage或原filing。四命令各有完成前原键重放、同键异body拒绝、finish后原键重放、新键拒绝。                                                                                                                                                |
| 文件         | 4个upload drafts、4个materials、4个CV，4份合成PDF总168bytes（43×3＋39），无大文件。原邮寄/申请各1个typed document及ref，另加上述补交2份，合计typed4／ref4；2次内容GET核原字节。                                                                                                                                                                                                        |
| HTTP与会话   | 首项显式40次请求：32预期成功、8预期409，含3次正常登录、2详情GET、2下载GET及8次上传阶段请求；新增auth_sessions至多3。任何非预定失败停止，不改key续跑或补额。                                                                                                                                                                                                                            |
| 数据库伴随写 | 成功路径最多75新增行（当天Case计数器已有则74），明细由上述身份25、session3、Case/工作流及审计回执/计数器至多15、EF16、上传及原typed/ref16构成。还须允许一次当天case_number_counters upsert、Case指针及三次阶段更新、4个draft状态和4个material currentVersion更新、上述3个新session的正常使用时间／授权revision更新；40次HTTP绝不等于40次DB写。若旧节流记录会被成功登录删除，先停另裁。 |
| 结束状态     | 保留全部新事实／文件／回执。另申请最多2次本批新role停用（active=false、version1→2，assignment保持），以及精确3个本批新session的revoked_at更新；不得按actor清除旧会话。现首项不会登出，末端步骤必须先固定为可审Runner步骤，未补齐不得开始。                                                                                                                                             |

## 3. 线索块：完整原八项HTTP测试，单独计额

准确文件为 `tests/e2e/lead-batch-push.spec.ts`。八项涉及整批成功、20项边界、旧版本整批拒绝、同请求并发共回执、丢响应原请求恢复、精确回执故障回滚、terminal撤权重放拒绝和不存在对象的安全错误。没有页面操作或文件上传；不得称真实UI已验。

| 类别       | 新申请硬边界                                                                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 既有主身份 | 仅原H42：user `edc8bf6f-6660-41f6-8418-f72f87443a1c`、role `51c34a8b-fb00-45b1-ab9f-d077d59d4878`，原42 Grant及身份关联不改。复用经现场核准的ADMITTED客户、权利主体及active CLIENT binding；缺失就停，不补旧Grant或造替代来源。                                                                                              |
| 新terminal | 若现场证实所有固定UUID均不存在，且另获本项批准，至多新增user/credential/membership/role/assignment各1，及customer.read、lead.read、lead.create、lead.push四项DEPARTMENT Grant。user `eecec2c7-068c-4515-b737-0846aedc2bb1`、role `4ab4e231-9e37-4f89-a745-66406623f2be`，其余ID由原helper固定。不新建第二terminal或修改H42。 |
| 业务写入   | 32个新lead，每条1个product，共32product；32个create receipt、32条lead.created audit；5个不同成功batch receipt、28次推送及lead.pushed audit。正常lead_number_counters递增32及updated_at变化单列。结束28条WAITING_REVIEW/v2、4条WAITING_PUSH/v1，所有事实保留。                                                                |
| 请求与会话 | 32次lead创建POST、8次正常登录、12次batch POST，共52显式HTTP请求。batch状态为201×7、400×1、409×2、预定500×1、撤权后403或409×1。新增session最多8，仅这些新session允许正常同行更新；已有节流行的删除须先单列裁定。                                                                                                              |
| 故障／文件 | 仅一组本轮新H42两线索、原key，临时sequence/function/trigger各1，精确命中一次，finally只清同三个对象；不允许全局disable trigger或清旧fault。文件0、Case0、迁移0、原EF请求重放0。                                                                                                                                              |
| 结束状态   | terminal自己的新assignment撤销1次，不恢复；H42不撤权。另申请精确8个本批新session的revoked_at更新，不清旧会话。新账号／Grant／业务行保留，故障对象无残留，服务／端口／标准锁释放。                                                                                                                                            |

### terminal回执不能倒填

固定 `.local/uxq03-evidence/lead-batch-push-terminal-creation-receipt.json` 在已查目录及workspace精确文件名搜索中未找到；原e48760d运行单只是未来创建计划，没有实际创建证明。原source Task的独立ID／标题尚无可靠资料，不能用原线索列表Task冒名；未来创建职责仍应交唯一Runner。

现v1回执模板声明创建时161，并要求candidateCommit等于当前运行HEAD。在当前public165新建身份后填写此模板会伪造创建时事实。技术前置是增加独立v2新建证明：记录真实165／十个pin、实际创建candidate/runId、全目标原不存在的before、精确新增对象及差异hash；保留旧v1不可变证明的原校验，不能改写或追制。如目标旧对象已存在但没有可信原证明，必须BLOCKED，不能补缺后声称全新创建。此改动只是验收代码准备，不创建任何对象或回执。仅做H42两线索最小正向也会被现prepare的terminal门槛阻断，不通过删校验来减额度。

## 4. 一次性确认的完整范围

可分别批准EF块、线索块或两者；实际仍由同一Runner串行。若两块都批准：至多3个新身份集合、19个新Grant、11次登录／11个新session、1新Case、32新lead／32product、4份168bytes文件；EF40＋lead52共92次显式HTTP。另有前后只读保护、两新EF role停用、terminal assignment撤销及11个精确新session撤销。常规认证同行更新、两种编号计数器及限定故障DDL也必须包含，不把“业务写入数量”当全库总更新次数。旧预算不结转，任何额外登录、账号、Grant、文件、重试或新场景均停止另报。

这不是请求批准迁移、旧数据删除、权限恢复、PRIMARY／门户、新客户或任意后续公开上传。真实写入式UI需要另一份含具体页面步骤的新预算；本单两个API块不能代替它。

## 5. 公证UXQ-02的最小待决与归属

INPUT-016只确认先带原因更正取证日／物流／寄件、出证后证书更正另片，以及跨事项独立批量开箱方向。现有NT001／002只有一次登记事实和单项Command；未冻结独立更正或跨事项批次的完整提交语义。因此本轮已启动独立范围核查，未派产品实现，避免让实现者自行新增规则。

需要最小明确三点：

1. 更正是否首片只给获权内部运营，允许到哪些阶段；后续审核／出证／转案已存在时，是否仅追加资料revision并保留原办理、照片归属、Case和费用锚。证书编号／日期／文件不含本片。
2. 批量开箱首片是否仅由操作者逐事项明确配图，未知／混包／多匹配不提交，不含ZIP识别或自动单号分派。
3. 批次采用整批回滚还是逐项独立提交；逐项模式须明确成功／确定失败／未执行／未知并按原body/key恢复，不能把未知当失败换key。NT010整批原子不自动适用于本片。

原公证列表Owner为「实现公证列表流程办理」`01a13ef4-c67e-70c6-9886-6ab55e035008`，范围不含新的资料保存API。原共享抽屉Owner为「实现列表办理共享抽屉」`01a13ee0-f72c-71a1-b033-bf5ca55d4012`，D为「补齐跨模块流程交接」`01a13e59-b7fb-71f0-8f13-a802319830ea`。冻结后主控应重新分配notary API、lead-notary/notary-opening service及DTO、schema／迁移、内部列表／详情／WorkflowPanel、公证门户的唯一作者；V0 read与V1 display既有交付不代表共享文件可抢写。本轮未联系或唤醒这些原Task，也未发生派发拒绝或绕路。

## 6. 本轮实际启动的独立任务

- `ef165_readiness`：回执追溯与EF记录级预算，已完成，只写ignored报告。
- `lead165_readiness`：固定回执追溯／八项预算已完成；真实public165新建回执v2的纯代码／反例13/13及独立受限补审C/I/M0已完成，不执行创建。
- `notary_scope_readiness`：已完成合同与Owner核查；等待上述业务决定，不占产品文件。
- `readiness165_review`：已独立核静态请求预算并指出v1/161的创建时事实冲突；v2受限补审ACCEPTED、C/I/M0，只是代码准备通过，真实创建／运行仍受前置与授权约束。

详细已有证据定位在本机ignored `.local/next-batch-preparation/`，不上传私密回执、credential或原trace。主控只协调、审查、集成与维护本清单；没有执行数据库、HTTP、权限或迁移动作。
