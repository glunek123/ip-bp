# 第二批一次性环境：185/186/187/188 前置探针与 P/C/R 验收顺序

本文件只记录源码审查所得的执行顺序，**没有运行**数据库、应用或浏览器。执行 checkout 是最终合成候选 `C:/Users/97830/.codex/worktrees/batch2-username/dev_cor`，不是本工作树。环境 wrapper 位于 `C:/Users/97830/.codex/worktrees/batch2-import/dev_cor/.local/batch2-environment-20261027`；其 `start.mjs` 必须在最终候选提交固定后运行，因为 ownership 收据绑定源码提交。命令中的 `run.mjs` 均指该 wrapper 的绝对路径。

## 固定准入与先后

PowerShell 先在最终候选目录执行 `. .\Use-ProjectRuntime.ps1`，确认 Node v24.21.0 / pnpm 11.27.0。root 在源码及脚本 Review 通过后按下列顺序执行；不要从本文件自动启动。

```powershell
$batch2Env = 'C:/Users/97830/.codex/worktrees/batch2-import/dev_cor/.local/batch2-environment-20261027'
. .\Use-ProjectRuntime.ps1
node --version
pnpm --version
node "$batch2Env/start.mjs"
node "$batch2Env/run.mjs" prepare:prisma
node "$batch2Env/run.mjs" --filter @dev-cor/backend build:prepared
$env:DEV_COR_OPS_BATCH2_READY = '1'
$env:BATCH2_ACCEPTANCE_READY = 'batch2-ops-20261027-approved'
node "$batch2Env/run.mjs" exec node tests/support/batch2-proxy-calendar-pre-app.mjs
```

`start.mjs` 只创建唯一新容器和候选 `.env.test`；核 ownership 收据完整 64 位容器 ID。前置 helper 会引入已编译 auth/Prisma；此时仍未启动 app。前置脚本按 185 → 186/187 → 188 顺序直接调用三个原 helper，逐项核原 spec 的结果；`DEV_COR_OPS_BATCH2_OWNED_CONTAINER_ID` 由脚本从 wrapper 已捕获的完整容器 ID 同值设置。**这一步必须先于 public 首次迁移和任何 Playwright。** 如失败，停在当前阶段排查，不能跳过。

等原 I 作者的 189/190 空链/约束探针完成并经 Review 后，在同一前 app 阶段运行其精确命令；其入口尚未固定，本文件不猜命令。随后执行：

```powershell
node "$batch2Env/run.mjs" db:test:migrate:deploy
node "$batch2Env/run.mjs" exec node tests/support/batch2-proxy-calendar-numbering.mjs
node "$batch2Env/run.mjs" build:prepared
```

不得从旧测试库复制 schema 或账号。P/C spec 的专用 fixture 在执行时生成随机部门、真实本地账号、已准入客户与权利主体；其余业务 ID 由正式 HTTP 创建/推送/登记取得。各套验收在对应 READY flag 下执行：

```powershell
node "$batch2Env/run.mjs" test:e2e tests/e2e/batch2-username.spec.ts
node "$batch2Env/run.mjs" test:e2e tests/e2e/batch2-case-consolidation.spec.ts
$env:BATCH2_IMPORT_E2E_READY = '1'
node "$batch2Env/run.mjs" test:e2e tests/e2e/batch2-lead-import.spec.ts
node "$batch2Env/run.mjs" test:e2e tests/e2e/batch2-proxy-calendar.spec.ts
```

Playwright 配置在加载 spec 前启动 app，所以前置探针不能用 Playwright migration spec 代替。I 套需 `BATCH2_IMPORT_E2E_READY=1`；P/C 套需 `BATCH2_ACCEPTANCE_READY`；M/U 套需 `DEV_COR_OPS_BATCH2_READY=1`。最终 `verify` 和定向复验按 root 的整体计划执行，并在各命令后清除不再需要的临时 READY 变量。

wrapper 固定要求 `NODE_ENV=test`、`DEV_COR_TEST_DATABASE_PROJECT=dev-cor-ops-batch2-20261027`、完整容器 ID、`DATABASE_URL=DEV_COR_TEST_DATABASE_URL=postgresql://dev_cor_test:<隐藏密码>@127.0.0.1:15440/dev_cor_test`，并接管 3101/5174 应用端口。P/C helper 还要求 `BATCH2_ACCEPTANCE_READY=batch2-ops-20261027-approved`；U/M 要求 `DEV_COR_OPS_BATCH2_READY=1`。真实密码不写日志或命令行；`run.mjs` 从受控 `.env.test` 注入。所有 flag 只在对应命令的 PowerShell 进程内设置。

## P/C/R 合成来源与范围

`batch2-proxy-calendar-fixture.mjs` 仅在上述完整新环境 guard 通过后写 public 中**新的随机部门**：运营、同部门同事、外部门人员、绑定在一名客户上的外部客户账号、两名已准入客户及权利主体。账号密码随机生成，只在 Playwright 进程内用于正式 `/auth/login`；各角色各自 cookie 和 CSRF。运营角色只获本套显式必要 scope grant，客户与公证处原有权限**不**授给运营。没有使用 `coreLeadFixtures`、固定技术 Bearer token、旧库 reset 或批量删除。

V6 的新空库把客户编号单例设为 `-1`，正式线索与外录案件创建要求编号已就绪。root 在 public 190 全链迁移后、任何 suite 创建客户前调用 `batch2-proxy-calendar-numbering.mjs` 一次。它仅在本次获批新容器且 `public.customers` 为 0、编号单例仍为 `-1` 时把单例置 0，并在 `.local/batch2-calendar/numbering-receipt.json` 留下容器与前后状态收据；否则硬失败。fixture 自身不初始化，使用后端 `allocateCustomerBusinessId` 在合成客户事务内分配真实纯数字编号。该准备步骤不执行生产历史编号切换草稿，也不写旧库。

P 套由正式 HTTP 创建、推送两名客户各一条线索，然后走运营代客户审核、撤回申请/代确认及并发原客户审核的同版本竞争。另一条线索经审核、转公证、取证、真实材料上传、开箱、开箱审核、出证决定，再由运营代办公证处出证；分别建立有、无外部公证员账号的两套，核材料下载、审计 actor/binding、证物与费用。浏览器额外点击一次线索列表“代办客户审核”。

C 套通过本人 HTTP 创建昨天事项，再以真实浏览器晚登录核右上角内容、查看跳转、标记已读及刷新持久；同部门另一人和外部门均不能改。R 套通过正式 `cases/external-entries` 建立 `WAITING_JUDGMENT` 当前阶段，真实上传判决 PDF 并调用 `judgment-register`；按服务端 `recordedAt` 的北京时间日期 +15 天核退费日历。合成案件负责人随后 A→B→A 两次变更，检查 epoch +2 与来源转移；正式更正换附件后原 REGISTER 日期不重算。最后登记真实已申请日期并核相同请求/冲突、已申请状态。它没有伪造附件日期作为正式登记。

无账号推送的产品修复位于独立候选 `fef81434`：仅当操作者同时具有同一线索范围的 `lead.push` 和 `lead.review.proxy` 时允许进入 `WAITING_REVIEW`，后续仍需真实审核结论。源代码与脚本 Review 通过且该修复合入最终候选后，再运行本套正式 HTTP 链。不要靠直接改线索状态、伪造推送收据或绑定临时客户账号让测试变绿。

脚本写好但尚未在新 PostgreSQL/HTTP/UI 上执行。R 本轮真实纵向只覆盖一审首次正式登记及更正；二审、重审、轮次撤销、归档后财务待办与已到期历史源的真实 PG/HTTP 反例仍须在 root 的最终验收清单里追加或明确记为未验收。09:00 边界已有纯函数/组件测试；真实时钟边界也尚未实测。脚本 Review 通过后若新环境出现 schema 前置冲突，只修本套合成数据，不绕过约束或默认增权。
