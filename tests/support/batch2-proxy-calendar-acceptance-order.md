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
node "$batch2Env/run.mjs" build:prepared
```

在完整 190 个迁移落到这一个新空库后，root 只执行一次客户编号 cutover，将 `customer_business_number_counters` 单例 `last_value` 从 `-1` 初始化为 `0`。I fixture 通过正式分配器继续取号；不得在 fixture 或每次验收前重置计数器。

不得从旧测试库复制 schema 或账号。准备每套独立合成 fixture，核验唯一随机部门、实际业务源版本、相应角色授权与身份后，再在对应 READY flag 下执行下列单套命令；当前 P/C fixture 缺口见下节，**尚不能直接执行 P/C 命令**。

```powershell
node "$batch2Env/run.mjs" test:e2e tests/e2e/batch2-username.spec.ts
node "$batch2Env/run.mjs" test:e2e tests/e2e/batch2-case-consolidation.spec.ts
$env:BATCH2_IMPORT_E2E_READY = '1'
node "$batch2Env/run.mjs" test:e2e --config tests/support/batch2-lead-import.config.ts tests/e2e/batch2-lead-import.spec.ts
# 仅在下述 P/C fixture 阻断解除后：
node "$batch2Env/run.mjs" test:e2e tests/e2e/batch2-proxy-calendar.spec.ts
```

Playwright 配置在加载 spec 前启动 app，所以前置探针不能用 Playwright migration spec 代替。I 套必须显式使用上述独有 config，只启动覆盖图片传输的受控 Nest app；默认 config 会启动真实下载 worker，不能执行 I 套。I 套需 `BATCH2_IMPORT_E2E_READY=1`；P/C 套需 `BATCH2_ACCEPTANCE_READY`；M/U 套需 `DEV_COR_OPS_BATCH2_READY=1`。最终 `verify` 和定向复验按 root 的整体计划执行，并在各命令后清除不再需要的临时 READY 变量。

wrapper 固定要求 `NODE_ENV=test`、`DEV_COR_TEST_DATABASE_PROJECT=dev-cor-ops-batch2-20261027`、完整容器 ID、`DATABASE_URL=DEV_COR_TEST_DATABASE_URL=postgresql://dev_cor_test:<隐藏密码>@127.0.0.1:15440/dev_cor_test`，并接管 3101/5174 应用端口。P/C helper 还要求 `BATCH2_ACCEPTANCE_READY=batch2-ops-20261027-approved`；U/M 要求 `DEV_COR_OPS_BATCH2_READY=1`。真实密码不写日志或命令行；`run.mjs` 从受控 `.env.test` 注入。所有 flag 只在对应命令的 PowerShell 进程内设置。

## P/C/R 当前 fixture 缺口（执行前必须补齐）

`tests/e2e/batch2-proxy-calendar.spec.ts` 目前引用 `coreLeadFixtures.tokenA/tokenSelf`。这只是技术 Bearer 测试 token 常量；新空库没有相应用户/部门/角色，且 `core-lead-database.mjs` 的 `seedCoreLeadE2eData` 会写固定 ID 并执行共享清理，不适合本批唯一随机部门。**所以即使 P/C JSON 环境变量齐全，当前 P/C spec 也不能直接执行成功。** 不得把 U 套真实账号密码登录视作 P/C 的真实浏览器验收。建议在独立随机部门内建立两名内部账号及所需角色，再用真实 cookie/CSRF HTTP 登录（或经过守卫的专用技术 token）替代这两个 core token；须先完成 fixture helper/Review。

当前 P/C spec 还要求以下预备数据；它只做事后断言，**不会创建这些事实**：

| 输入                                                                                | 必须由隔离 fixture 产生的当前事实                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BATCH2_REFUND_SOURCE_ID`, `BATCH2_REFUND_SOURCE_TYPE`, `BATCH2_REFUND_OWNER_TOKEN` | 本批随机部门的案件负责人；一审/重审 `REGISTER` fact 或二审有效结果的真实 `recordedAt`；负责人有 `case.read` 与显式 `case.refund.application.record` scope grant。仅附件或判决书落款日期不够。                                                                                                                                                                                          |
| `BATCH2_PROXY_REVIEW_FIXTURES`                                                      | JSON 数组两条，分别是外部账号存在/不存在的 `WAITING_REVIEW` 线索。字段 `leadId, expectedVersion, operatorToken, operatorUserId, externalAccountExists`；运营角色显式有 `lead.read` 和 `lead.review.proxy`，token 对应同一真实内部 actor。                                                                                                                                              |
| `BATCH2_PROXY_WITHDRAW_FIXTURE`                                                     | JSON 对象 `leadId, applicationId, expectedVersion, operatorToken, operatorUserId`；有效且待客户确认的撤回申请，同部门运营显式有 `lead.withdraw.confirm.proxy` 与原读取 scope。                                                                                                                                                                                                         |
| `BATCH2_PROXY_CERT_FIXTURE`                                                         | JSON 对象 `matterId, operatorToken, operatorUserId, body`；`WAITING_CERTIFICATE` 且已有真实材料版本的公证事项。`body` 要有 `expectedVersion, certificateNo, certificateDate, contentVersionIds, needDisclose, disclosureContentVersionIds, fees`；运营显式有 `notary.certificate.issue.proxy` 和该模块原读取/办理 scope。费用、证物初始化依赖有效案件/线索/公证来源，不可只填任意 ID。 |

上述变量不得存成持久明文 token 文件或输出到日志；root 的实际验收 driver 应在受控进程内生成并传给该次 Playwright 子进程。存在/不存在外部账号均只是在隔离合成部门的业务状态；不能假装没有账号，也不能把 `CLIENT`/`NOTARY` grants 授给运营。C/R 还缺浏览器级右上角自动展开、已读和跳转的真实交互：现有 P/C spec 主要验证 HTTP 与 SQL，前端组件测试不能代替浏览器结果。
