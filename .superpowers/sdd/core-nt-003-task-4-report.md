# CORE-NT-003 Task 4 交接

- Task：双端审核 API 与页面接线、客户端多批次入口、公证阶段列表同步。
- Model：gpt-6-luna。
- Commit：`21ff51e`（Task 4 实现与测试；本报告单独提交）。未 push。
- Changed files：`backend/src/modules/leads/notary-list.dto.ts`、`backend/src/modules/leads/notary-list.service.spec.ts`、`frontend/src/api/notary.ts`、`frontend/src/api/notary.spec.ts`、`frontend/src/api/client-notary.ts`、`frontend/src/api/client-notary.spec.ts`、`frontend/src/modules/leads/NotaryMatterDetailPage.vue`、`frontend/src/modules/leads/NotaryMatterDetailPage.spec.ts`、`frontend/src/modules/leads/NotaryMatterListPage.vue`、`frontend/src/modules/leads/NotaryMatterListPage.spec.ts`、`frontend/src/modules/client/ClientNotaryListPage.vue`、`frontend/src/modules/client/ClientNotaryDetailPage.vue`、`frontend/src/modules/client/ClientNotaryPages.spec.ts`、`frontend/src/modules/client/ClientLeadDetailPage.vue`、`frontend/src/modules/client/ClientLeadDetailPage.spec.ts`、`frontend/src/app/AppShell.vue`、`frontend/src/app/AppShell.spec.ts`、`frontend/src/app/router.ts`。

## Result / contracts

- 运营详情严格解码并展示 `reviewOpening`、已保存决定和审核后阶段；只有服务端 capability 为 true 且处于 `UNBOX_REVIEW` 才显示审核表单。结论不预选，不侵权原因必填；提交会锁定表单，使用稳定幂等键，并在成功后重读已保存事实。原开箱材料登记、开箱记录和照片下载保留。
- 新增客户端待审核列表和最小详情页，使用 Task 3 的客户端 DTO/下载授权与 Task 2 的审核 Command。默认列表读取待审核事项；`sourceLeadId` 列表展示该线索多个处理状态的批次。线索详情、侧栏与路由新增可发现入口。客户端页面只读取 DTO 中的线索摘要、选中商品、冻结开箱照片与审核事实。
- `ISSUANCE_DECISION`、`ARCHIVED` 已加入运营阶段筛选、侧栏计数和后端计数 DTO。未来阶段只呈现状态，没有新增办理动作。
- 运营与客户端结论响应均按角色、阶段、版本、结果和决定一致性解码；客户端详情对未知字段 fail closed。稳定映射版本/状态冲突、幂等冲突、无权限/不可见、网络/超时反馈；网络不确定时保留请求键及表单内容供安全重试。
- Contract changes：无。两个审核 POST 与各读取 GET 均使用 Task 2/3 冻结契约；没有修改 schema、后端权限、事务或 API response DTO。

## RED / GREEN

- RED：`notary.spec.ts` 的新状态计数与审核后详情被旧解码器拒绝，审核 API 缺失；客户端 API/页面测试因模块或组件尚不存在而失败；运营详情新审核行为测试因表单/记录不存在而失败；后端 `notary-list.service.spec.ts` 因计数只含三个阶段而失败。失败原因均指向缺失功能或旧 contract，而非测试环境错误。
- GREEN：最终目标 Vitest 7 suites／87 tests 通过；`notary-list.service.spec.ts` 1 suite／3 tests 通过；`pnpm check:fast` 通过（架构、前后端 typecheck、ESLint）；目标改动文件 Prettier 检查通过；`git diff --check` 通过。

## Self-review / risks / Requires Sol attention

- 自审确认内部审核按钮使用独立 `reviewOpening` capability，不推断自 `lead.read`；客户端列表与详情调用专用 client DTO，不投影运营物流或寄件字段；照片下载继续传精确 `materialId` 和 `contentVersionId`；提交成功以后端重读结果作为展示事实。幂等键随相同请求在网络不确定后保留，明确版本/状态或幂等冲突会提示刷新。
- 已知验证边界：本 Task 未运行 PostgreSQL／浏览器型主链或完整 `pnpm verify`；真实双身份、材料字节隔离、刷新/重登录等集成验收由 Task 5 负责。
- Requires Sol attention：Task 4 为普通 UI/API 接线，无逐 Task Reviewer 要求。最终集成 Review 可检查双端审核页面与真实身份/持久化浏览器链路的一致性。
