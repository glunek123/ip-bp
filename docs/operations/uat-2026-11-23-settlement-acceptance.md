# 2026-11-23 律师结算与客户结算操作验收（线上 bc443bf4）

## 验收对象

用户要求验收「律师结算、客户结算操作是否修好」。线上 `current` → `/srv/ip-bp-uat/releases/bc443bf4`（含全部结算修复提交 975f2de4 / 766dd431 / 0859bce7 / 5cf4c47e / 463376a0），健康 200、db up，服务 active。侧别修复与阻塞提示源码已在该版本中。

## 一、自动化测试

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 前端结算页 | `pnpm --filter @dev-cor/frontend test src/modules/settlements/SettlementPages.spec.ts` | 39 通过 / 4 跳过（43） |
| 后端结算模块 | `pnpm --filter @dev-cor/backend test src/modules/settlements` | 26 套件 / 350 项全部通过 |

关键用例通过：`launches the lawyer settlement from its own summary card`（断言侧别 LAWYER、lawyerId、金额）、`explains why a lawyer settlement cannot start without an assigned lawyer`、`blocks lawyer settlement terms until a lawyer is assigned`、`uses only the actual assigned lawyer and the independent lawyer remaining balance`。

## 二、UAT 线上实测

以 `zhichan`（徐梦梦）登录，案件详情 → 费用管理 → 案件结算双摘要卡。

### 案件 00920261118140（待归档，律师曹月已指派）

初始两侧余额：客户 5600.00、律师 1400.00，均无发起记录，两个「发起结算」按钮均可点击、无阻塞提示。

| 侧别 | 操作 | 复核结果 |
| --- | --- | --- |
| 客户 | 点击客户摘要卡「发起结算」 | 写入 launch `ba7c411d…`，nth=1，5600.00，2026-11-23；客户 launched=5600 / remaining=0；按钮置灰并提示「客户侧已没有待发起金额。」；律师侧余额仍为 1400 不受影响 |
| 律师 | 点击律师摘要卡「发起结算」 | 写入 launch `64fc06c7…`，nth=1，1400.00，2026-11-23，lawyerId=`fe093c6e…`（曹月）；律师 launched=1400 / remaining=0；按钮置灰并提示「律师侧已没有待发起金额。」；客户侧余额不受影响 |

结论：律师侧摘要卡按钮点击后按自身侧别发起并带上真实承办律师，**原「点击无反应」缺陷已修复**；客户侧按既有逻辑正常发起；两侧余额互相隔离。

### 案件 04320261118824（待归档，未指派律师）

律师侧金额 15000.00，但按钮置灰并提示「该案件未指派律师，无法发起律师结算。」——源头校验与前端阻塞提示生效，不发请求；只读观察，未写入。

### 界面

双摘要卡并排布局正常，金额、结算条件、结算日期、发起次数/账单数显示完整；发起后按钮置灰与原因提示可见。截图见 `.local/tmp/settle-accept-00920261118140-*.png`。

## 三、真实写入与撤销

本轮在 UAT 真实写入 2 条结算发起（非合成数据）：

- 案件 `46de890b-06a8-482b-8599-3eb4df0d1b20`（00920261118140）
  - `ba7c411d-9040-4d24-9156-d8fa21bc89a8` 客户侧 5600.00
  - `64fc06c7-5e1f-4c8c-906c-edab00cbfa66` 律师侧 1400.00

如需撤销，删除这两条 settlement_launch 记录后刷新即可恢复两侧 remaining；本轮保留作为验收证据。

## 四、结论与遗留

两侧结算发起操作均验收通过，可放行。遗留测试债：`SettlementPages.spec.ts` 中「双摘要卡」用例仍为 `it.skip`，该路径长期无整组回归覆盖；本轮新增用例已覆盖律师发起关键分支，建议后续恢复该用例为启用状态（不在本轮范围内）。
