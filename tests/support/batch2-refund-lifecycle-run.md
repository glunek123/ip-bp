# 第二批 R 生命周期独立验收

仅在 root 固定并审查最终组合候选、完成新 `dev-cor-ops-batch2-20261027`／`127.0.0.1:15440/dev_cor_test` 的 184–190 迁移、空库编号初始化且保留完整容器 ownership 收据后运行。本脚本会生成自己的随机部门、真实合成本地账号和客户；不会复用 P/C 的业务 ID。`BATCH2_ACCEPTANCE_READY` 与 `DEV_COR_TEST_DATABASE_PROJECT`、完整容器 ID、数据库 URL 由已有新环境 wrapper 核对。

在最终候选根目录点加载运行时并核 Node `v24.21.0`、pnpm `11.27.0`，然后执行：

```powershell
$batch2Env = 'C:/Users/97830/.codex/worktrees/batch2-import/dev_cor/.local/batch2-environment-20261027'
$env:BATCH2_ACCEPTANCE_READY = 'batch2-ops-20261027-approved'
node "$batch2Env/run.mjs" test:e2e tests/e2e/batch2-refund-lifecycle.spec.ts
```

脚本核二审结果首次正式登记的服务端 `recordedAt` 北京日期 +15 天、结果撤销后的来源失效和新 `resultId`、发回后空子轮撤销及新重审轮次的一审 `REGISTER`、更正附件不重算、提前归档后待申请来源仍在，以及已读、已申请、财务实际退款三个独立事实。09:00 边界在同一新库的真实来源上直接调用生产提醒服务，**只控制测试进程的 `Date.now`**；不更改应用、PostgreSQL 或机器时钟。该边界不是浏览器恰在 09:00 的实测。

现有接口没有独立的一审正式登记撤销命令；`judgment-next-step-revoke` 仅撤销下一步选择，不能当作判决撤销。本脚本只通过真实 `second-instance-result-revoke` 使二审结果和空发回子轮失效。财务核验只证明本合成案件在本脚本未生成诉讼退费费用记录与实际退款核销；不推断真实案件资格。
