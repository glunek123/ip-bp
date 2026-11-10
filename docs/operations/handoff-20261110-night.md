# 交接单：2026-11-10 夜间（沙箱故障中断）

> 本文件用途：会话因 WorkBuddy 沙箱故障（`SandboxError 0xFFFFF826 center 规则快照不可用`）无法执行命令而中断。
> 新会话请先读本文件，再按「恢复步骤」继续；不要重做已完成项。

## 一、现场状态

| 项                 | 值                                                                        |
| ------------------ | ------------------------------------------------------------------------- |
| 仓库               | `D:/工作项目/品维and知产/dev_cor`                                         |
| 已提交且部署的版本 | `0c90dcf3`（远端 main 同步）                                              |
| 测试环境           | `https://111.231.164.248`，`current → releases/0c90dcf3`，迁移 **297** 项 |
| 未提交改动         | `frontend/src/modules/cases/case-workspace-actions.ts`（见下）            |
| 沙箱状态           | 命令通道不可用；文件读写正常                                              |

## 二、未提交改动（已完成编码，未验证）

文件：`frontend/src/modules/cases/case-workspace-actions.ts`

1. 删除 `add(current.canScheduleHearing || current.canCorrectHearing, 'hearing');`
2. 删除 `stageCommands` 中的 `WAITING_HEARING: 'hearing',`

目的：运营要求**待开庭阶段不提供任何操作**。此前只改了详情页上传入口（已提交），
漏了列表页的动作装配，导致列表仍有「补录／更正开庭日期」按钮。

注意：删除后开庭日期在系统内**没有入口**；若将来需要在判决阶段补录，需单独加。

## 三、恢复步骤（新会话照做）

```powershell
. .\Use-ProjectRuntime.ps1
git status --short          # 确认只有 case-workspace-actions.ts 变更
pnpm --filter @dev-cor/frontend test src/modules/cases
```

预期会有一条用例失败（断言待开庭主操作是 `hearing`，或断言 `canScheduleHearing` 会产出按钮）。
定位后按新语义改断言，然后：

```powershell
pnpm context:record
git add -A
git commit -m "fix(cases): leave 待开庭 without any action"
pnpm verify
```

`pnpm verify` 退出 0 后部署（流程见第五节）。

## 四、剩余待办（用户已确认要做）

1. **待正式立案卡片**：新增 开庭日期、开庭地点、承办人、披露数据、披露附件（需 Prisma 迁移 + 接口 + 卡片）。
2. **准备起诉文书三步骤**：按钮顺序改为 上传诉状 → 确认诉状 → 邮寄，字段按用户截图对齐
   （涉及 `CaseComplaintSubmissionForm`、`CaseComplaintConfirmationPanel`、`CaseComplaintMailingPanel`，纯前端为主）。

## 五、部署流程（已验证可用）

```bash
# 1. 打包并上传
H=$(git rev-parse --short HEAD)
git archive --format=tar --prefix=source/ -o .local/deploy/src-$H.tar HEAD
scp -i ~/.ssh/ip-bp-uat-111.231.164.248-ed25519 -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=~/.ssh/ip-bp-uat_known_hosts .local/deploy/src-$H.tar ubuntu@111.231.164.248:/home/ubuntu/
```

服务器侧（ssh 同上密钥）：

```bash
NEW=/srv/ip-bp-uat/releases/$H
sudo mkdir -p /var/backups/ip-bp-uat/case-$H
sudo bash -c "set -a; . /etc/ip-bp-uat/backend.env; set +a; pg_dump \"\$DATABASE_URL\" -Fc -f /var/backups/ip-bp-uat/case-$H/db-before.dump"
sudo mkdir -p "$NEW" && sudo tar xf /home/ubuntu/src-$H.tar -C "$NEW" --strip-components=1
sudo chown -R ubuntu:ubuntu "$NEW" && cd "$NEW"
export PATH=/opt/ip-bp-uat/bin:/opt/ip-bp-uat/node-v24.21.0/bin:/usr/bin:/bin
export NODE_OPTIONS=--max-old-space-size=2304
pnpm install --frozen-lockfile --prefer-offline
DBURL=$(sudo -n bash -c 'set -a; . /etc/ip-bp-uat/backend.env; set +a; printf %s "$DATABASE_URL"')
cd backend && sudo -n env PATH=/opt/ip-bp-uat/node-v24.21.0/bin:/usr/bin:/bin DATABASE_URL="$DBURL" \
  /opt/ip-bp-uat/node-v24.21.0/bin/node node_modules/prisma/build/index.js migrate deploy
cd .. && pnpm prepare:prisma && pnpm build:prepared
sudo chown -R root:root "$NEW" && sudo chmod -R a+rX "$NEW"
sudo ln -sfn "$NEW" /srv/ip-bp-uat/current.next && sudo mv -Tf /srv/ip-bp-uat/current.next /srv/ip-bp-uat/current
sudo systemctl restart ip-bp-uat && sleep 6 && systemctl is-active ip-bp-uat
curl -sk -o /dev/null -w "health:%{http_code}\n" https://127.0.0.1/api/v1/health
```

部署后提醒用户**强制刷新**（产物哈希会变）。

## 六、环境与凭据位置

- 测试库/服务：`111.231.164.248`，`/etc/ip-bp-uat/backend.env`
- UAT 登录账号密码：`.local/server-uat-20261026/credentials.private.json`
- UI 自动化脚本样例：`.local/qa/sim/*.mjs`（Playwright，`ignoreHTTPSErrors: true`）
- 推送远端：`github.com:443` 被拦，需临时部署密钥 + `ssh.github.com:443` 别名（用完即删，当前密钥数应为 0）

## 七、本日已完成（勿重做）

- 结算重复保存 500 → 方案 B：放行 `CASE_CLOSURE_DOCUMENT` 的引用唯一索引 + 每版本一条引用
- 退费重复声明 500 → 409 `REFUND_INVENTORY_CHANGED`
- 结算 409 文案（一次性付款限额等）
- 校验错误返回 `details.fields`
- 公证：提前归档从抽屉拆出 + 修复“点了没反应”（按可用动作集合判断）+ 公证费自动补两位小数
- 公证：「取证与物流」只读卡片移除
- 公证：开箱待确认按钮「确认」+ 卡片三要素（审核结果/审核日期/确认结果）+ 提交确认
- 案件：匹配律师卡片新增结算模式/基础费/分成比例，候选带出电话/律所/地址（迁移 297）
- 权限：给「UAT知产运营」授予 case.refund.* 与 notary.certificate.issue.proxy
