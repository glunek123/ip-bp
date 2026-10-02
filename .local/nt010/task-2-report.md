# NT-010 Task 2 completion report

Task: 列表逐项表单、严格批次API客户端及真实账号/数据库浏览器验收。
Model: gpt-6-luna（工具显式派发模型；前端执行Task）。
Commit: `52e062c` (`feat(notary): add batch return archive UI`)，基于Task 1提交 `662b187`。
Status: PASS；本地提交，未推送／合并／部署。

Changed files:
- `frontend/src/api/notary.ts`：仅导出已有归档响应及金额输入guard供批次API复用。
- `frontend/src/api/notary-return-archive-batch.{ts,spec.ts}`：批次请求输入验证、禁自动CSRF写重试、严格验证批次回执、排序/ID集合、版本与逐项金额/状态/收付方投影。
- `frontend/src/modules/leads/NotaryReturnArchiveBatchPanel.{vue,spec.ts}`：最多50项的逐项表单、详情与能力读取、已知/待定费用及party/reason必填校验、重复提交锁、未知结果冻结相同body/key显式重试、确定拒绝/取消/卸载及身份/部门/阶段失效处理。
- `frontend/src/modules/leads/NotaryMatterListPage.{vue,spec.ts}`：接入既有跨页选择；成功后清空选择、刷新列表并通知工作流一次。既有导出1000项能力和列设置未改。
- `tests/e2e/notary-return-archive-batch.spec.ts`：由正式API创建真实流程事项及可解码JPEG照片；真密码运营/客户登录；验证不同样品费、逐项不同退款/运费和party、数据库状态、重登录及客户可见范围、客户批量写入拒绝、非法混选前端拒绝且数据库不变。

Tests (project runtime Node 24.21.0 / pnpm 11.27.0; 每次尝试单独保存在 `.local/logs/nt010-task2-*.log`)：
- TDD RED：批次API初始有效断言骨架 `pnpm --filter @dev-cor/frontend test src/api/notary-return-archive-batch.spec.ts` exit 1、3 failed（`nt010-task2-api-red-2.log`）；面板骨架 `pnpm --filter @dev-cor/frontend test src/modules/leads/NotaryReturnArchiveBatchPanel.spec.ts` exit 1、3 failed（`nt010-task2-panel-red-1.log`）。首轮API import-resolution失败保留于 `nt010-task2-api-red-1.log`，不计有效RED。
- GREEN：`pnpm --filter @dev-cor/frontend test src/api/notary-return-archive-batch.spec.ts src/api/notary.spec.ts` exit 0、2 files/17 tests（`nt010-task2-api-green-2.log`）。组件及页面聚焦套件逐步扩展：最终边界运行 `pnpm --filter @dev-cor/frontend test src/api/notary-return-archive-batch.spec.ts src/api/notary.spec.ts src/modules/leads/NotaryReturnArchiveBatchPanel.spec.ts src/modules/leads/NotaryMatterListPage.spec.ts` exit 0、4 files/55 tests（`nt010-task2-boundaries-6.log`）。覆盖无选择/超50、不可归档事项、适用事实/待定及必填、重复点击、身份/阶段/卸载迟到结果、400/403/404/409与未知500/网络冻结同body/key、成功一次刷新、失败不刷新。
- Browser: `pnpm test:e2e:full tests/e2e/notary-return-archive-batch.spec.ts` 最终 exit 0、2/2（`nt010-task2-e2e-4.log`，14.6s）。前几次失败原样保留：`e2e-1/2` 定位器标签假设及`data-test`属性约定不匹配；`e2e-3` 暴露数据库金额返回顺序不同，修正断言为按kind归一化后通过。均未提高120秒超时、重试测试或放宽照片校验。最终有真实页面POST成功和逐项事实核对，无正式API权限/状态失败。
- Typecheck: `pnpm -r --parallel typecheck:prepared && tsc --noEmit` exit 0（`nt010-task2-typecheck-3.log`）。
- Build: `pnpm build:prepared` exit 0（`nt010-task2-build-1.log`）；只有既有Vite大chunk警告。
- Formatting: `pnpm exec prettier --check tests/e2e/notary-return-archive-batch.spec.ts` 最终exit 0（`nt010-task2-format-check-final.log`）；此前所有相关文件检查/格式化记录也分别保留。
- Earlier panel/page/API focused GREEN: 4 files/43 tests（`nt010-task2-focused-3.log`）；最终边界版55 tests覆盖其后增加用例。

Contract changes: 无服务端、schema、权限或公共契约变更。客户端严格消费Task 1批次POST/回执，逐项核对输入及事实投影；不自动重试写操作。KNOWN/PENDING null字段按真实DTO检查。

Self-review: 选择上限只限制归档面板，不改变已有导出1000项上限；保留客户过滤和冻结照片校验。正式API生成浏览器起点，照片为完整JPEG字节，不使用直接数据库伪造的事项来声称真实主链。错误或过期响应不刷新、不清空选择；未知提交冻结原请求体和幂等键。Task 2仅自审，无额外独立Sol审查要求。

Known risks: 浏览器测试数据库会输出现存pg并发query deprecation警告；构建有既存大chunk提示。批次验证仅在本地受控PostgreSQL与Chromium/password流程运行。初次浏览器尝试耗时约252秒，超时原因与修复证据、原日志和trace均保留；最终正确选择器运行通过。

Requires Sol attention: NO。Task 1后端高风险部分已通过独立Sol Review；Task 2无后端/安全/事务/Schema/公共契约改动。
