# 三列表原位流程表单：可派发 brief（2026-10-15）

用户已明确同意：一个明确下一节点主按钮，在列表抽屉中填写真实表单；同一步多条合法去向在表单内明确选择，初值不默认，条件字段随选择变化，提交文案写实际结果。方向未定可先保存已有资料；资料编辑独立且不推进阶段。批准的是交互，不是新增任意状态切换、跳过权限、材料或伪造受理事实。

主控只做契约、集成、验收和权威文档。以下是拟新建的四个可见独占 Task，尚无 task ID，不宣称已派发。模型按 docs/ai-coding.md：公共上下文及未知请求契约 Owner 用 Sol，普通模块接线用 Luna；遇业务/权限/并发契约差异停止扩围交主控，必要时转 Sol。

## 基线、顺序与所有权

- 共享 Owner 可立即从冻结 fa16b9d2aab2f4cb98bd86cf7506dd4143a9d758 新建独立工作区；不写 A/B 验收目录。先交 props/events/context 精确微合同及最小可编译提交，再由三个模块 Owner 基于此提交开始。
- Lead/Notary 的详情抽取须等待 D 对其三详情文件停写、交接及 findings 关闭；D 当前 a1bfc535f2403c132f5dc995440748f2c1b72125 仍有 I-UXQ-D01，不能直接标为接纳。可先做列表/新 Panel，禁止与 D 同时改详情。
- CaseList 必须交接 C，现 b40225a467a53ae492ace0f60773baf8ccf3691f 仍有 I-UXQ-C01；Case Panels 必须交接分栏 e6c4260a6fb15431ac360b2645a3ad910ee5e35d。e6 产品源码复审通过不等于累计/真实浏览器验收通过；不得直接用旧清理夹具跑保留实例。
- 不要求等全部后台 S/E/H 才做既有流程表单；执行/开庭/历史资料更正的新入口必须等待对应合同和实现真实可用，不用流程 API 冒充资料保存。

## W：共享抽屉与上下文 Owner（Sol）

唯一白名单（四个新文件）：frontend/src/app/ListWorkflowDrawer.vue、ListWorkflowDrawer.spec.ts、list-workflow-context.ts、list-workflow-context.spec.ts。

Goal：仅提供受控抽屉、record/actor/action/title 上下文、打开时 fresh detail GET 的加载/失败/撤权槽、Abort/generation 及成功/关闭事件。模块传入真实 Panel，不建全业务注册中心，不嵌整页详情，不改 router/AppShell/global CSS/API。

先交微合同：上下文精确对象ID和身份、动作key、加载generation、可见/忙碌/未知状态；模块持有原Command body/key及pending恢复，不由壳生成新的写请求。迟到 GET/POST 不串行对象或账号；未知结果保留原body/key，仅允许既有精确恢复方式，不能关闭后默默新发。明确 shell 与模块谁可取消哪个请求、何时销毁、何时刷新，避免双层 Abort 或双 POST。

Tests：取消/迟到/换对象/换账号、加载失败/撤权、成功只发一次、未知结果不能重复建key；仅相关组件/类型/格式。无 DB、无共享配置。

## L：线索列表 Owner（Luna，详情待 D 交接）

白名单：frontend/src/modules/leads/LeadListPage.vue、LeadListPage.spec.ts、LeadQuickActionsPanel.vue、LeadQuickActionsPanel.spec.ts；交接后 LeadDetailPage.vue、LeadDetailPage.spec.ts；新 Lead*WorkflowPanel.vue 及同名 spec（仅本模块流程表单）。tests/e2e/lead-list-workflow.spec.ts（只编写；若需新 support 先登记唯一所有权）。不改 LeadEditPage/返回URL合同、shared/app 文件、backend/API。

从现有 LeadDetail 抽取真实 transfer/withdraw/evidence/push 表单，详情和列表复用。操作列明确下一节点，不只写“办理”；编辑仍独立。保留 B 现有 WAITING_PUSH 真实getLead、query返回、unknown push sessionStorage 恢复合同，不回退为跳详情。LeadSummary 无 capabilities，按钮可依据已知状态命名候选，打开时必须 fresh GET 并核真实能力才展示可提交表单；若要求列表打开前即精准隐藏无权动作，报告需要最小只读 scoped capabilities 投影，由主控另指派 Sol，不自行改权限/造 can*。

## N：公证内部/公证处列表 Owner（Luna，详情待 D 交接）

白名单：frontend/src/modules/leads/NotaryMatterListPage.vue 及现有直接 spec；交接后同目录 NotaryMatterDetailPage.vue 及直接 spec；frontend/src/modules/notary/NotaryPortalListPage.vue 及直接 spec、交接后 NotaryPortalDetailPage.vue/NotaryPortalPages.spec.ts；各自目录新 Notary*WorkflowPanel.vue 及同名 spec。tests/e2e/notary-list-workflow.spec.ts（只编写，support 先登记）。不写 A 批填 Panel、shared/app、backend/API。

内部列表现有 matterActions/capabilities 可复用，但点击须原位表单。抽取 Detail 的 opening/returnArchive/issuanceDecision/openingReview/evidence；Portal 复用其 opening/certificate。内部、公证处 DTO/角色/材料范围各自保留，不合成万能表单。NO_ISSUE/出证等分支按正式能力明确选择，不能参考 Demo 直接切 stage。PortalSummary 无 capabilities 时同 L：打开 GET 核验，若需前置精确隐藏则单报只读投影差距。

## C2：案件列表 Owner（Luna，先交接 C 与分栏 Panel）

白名单：frontend/src/modules/cases/CaseListPage.vue、CaseListDisplay.spec.ts 及现有列表直接 spec；新 CaseListWorkflowPanel.vue/同名 spec；交接后确需调整的既有 Case*Panel.vue/同名直接 spec，具体文件在开工回执列出供主控确认。case-workspace-actions.ts/spec 仅在 C 明确停写交接后可接。不改 CaseDetailPage、S/E/H backend、API decoder/organization 或共享壳。tests/e2e/case-list-workflow.spec.ts 只编写，support 先登记。

复用 CaseSummary 现有精确 canRegisterJudgment/canChooseJudgmentNextStep 等与 fresh getCase；不能用任意can*合成泛办理。列表主动作按真实阶段/事实命名，drawer 装载原 Case*Panel，不把 b402 enterAction 跳详情当完成。判决登记和下一步选择两Command保留：可先保存判决仍 WAITING_JUDGMENT，后续方向初始空，选 APPEAL/EXECUTION 后显示该路径所需字段，文案说明实际去向；APPEAL 不等于二审已受理。二审 progress-save 与 result 分离，资料保存不推进。独立编辑/撤销/归档入口仍受原能力和前置约束，主节点待归档也须明确可用动作，不因此删掉合法归档入口。

## 共同交付与真实验收

1. 当前页/筛选从原 route query 保持，成功调用原 load() 重查当前页/行，不乐观猜新stage。对象离开筛选正常移除；空最后页沿现有分页规则修正并说明，不任意回第1页。失败保留用户输入与精确原请求恢复能力；无业务成功不得发成功提示。
2. 每列表真实密码+cookie/CSRF：第2页/带筛选点明确主按钮→抽屉核真实预填/材料→选合法分支填必填→真实 POST 201→原列表刷新核同一对象/阶段/分页query→刷新/重登仍在；不只按钮/GET/弹窗测试。补取消无POST、失败不推进、分支缺必填拒绝、双击单次、未知结果同key/body恢复、撤权/换对象/账号与迟到结果。资料保存另证stage不变；判决只登记/以后再选、二审未受理仍空为关键反例。
3. 当前状态机已支持判决先登记再择路、二审进展保存而不登记结果；未发现需要跨节点通用草稿。其他表单若没有合法独立保存API，Task列精确字段/当前API/最小差距交主控，保留已批准交互目标，另拆 Sol 的独立资料保存合同；不得以本地假保存或空字段advance代替。
4. Worker只运行相关离线组件/类型/Lint/格式；真实PG/浏览器由唯一runner在后续审定组合上执行。15437 保留实例不清库、不TRUNCATE/reset/禁trigger，不碰5186/3206/15436/旧15433/生产，不增真实Grant。浏览器 fixture 必须独立追加唯一合成事实，重跑不覆盖既有事实。
5. 当前 A/B 冻结 fa16b9d/tree a56a62978404d435e9edfe0605dbad47acf7f7a0 仅重跑 B，四任务不进入其运行树。分别交SHA/完整文件清单/实际测试/未验证边界，按公共契约与最终组合风险Review和正式门禁。

图像范围：两Library引用已 prepare/read 元数据，尚未取得实际可查看像素，不以 caption/OCR 冒充已看截图。Demo app.js 的 runCaseCta/本地advance仅参考交互，正式门槛以 Living Spec 为准。
