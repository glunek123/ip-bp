# 2026-11-23 律师结算「发起结算」无响应（已部署 975f2de4）

## 现象

案件详情 → 费用管理 → 案件结算：律师结算摘要卡的「发起结算」点击无任何反应；客户结算摘要卡正常。

## 根因

`CaseSettlementPanel.vue` 的两张摘要卡共用同一个 `launch()`，而 `launch()` 读的是侧别状态 `side`（默认 `CUSTOMER`），按钮没有把所属侧别传进去。点击律师卡时实际仍在用客户侧别：

- `canLaunch` 按 `CUSTOMER` 计算，与律师侧金额无关；
- 律师侧自己的金额／律师选择从未装载，`side === 'LAWYER'` 相关校验直接短路。

因此表现为「点了没反应」，而不是报错。

## 修复

- `launch(targetSide?: SettlementSide)`：显式接收侧别；非字符串参数（表单 submit 的事件对象）回落到当前侧别。
- 侧别变化后 `await nextTick()`，等 `watch(side, syncSide)` 把金额与律师填好，再走原有守卫与提交。
- 两张摘要卡改为 `@click="launch(summarySide)"`；操作区表单改为 `@submit.prevent="launch()"`。

## 验证

- 新增用例：`launches the lawyer settlement from its own summary card`，断言 `launchSettlement('case', { side: 'LAWYER', lawyerId: 'real-lawyer', amount: '30.00' })`。
- `src/modules/settlements` 65 通过 / 5 跳过；`vue-tsc`、ESLint、Prettier 通过。
- 线上 `current` → `/srv/ip-bp-uat/releases/975f2de4`，健康 200。

## 测试债

同文件「双摘要卡」用例原本是 `it.skip`，所以这条路径长期没有回归覆盖；本轮新增的律师发起用例已覆盖关键分支，但它仍应在后续把整套双摘要卡用例恢复为启用状态。

## 验收执行记录（C：律师结算发起）

### 原案 00320261118799 无法发起

以 `zhichan`（徐梦梦）登录调用 `POST /settlements/cases/{id}/launches`：

```
400 {"code":"INVALID_PAYEE","message":"收付方与案件不匹配"}
```

原因：该案 `case_lawyer_assignments` 记录数为 **0**，律师侧没有收付方；结算上下文里 `lawyers` 为空数组。前端守卫 `canLaunch` 要求 `lawyers.length > 0`，于是点击后直接 `return`，既不请求也不提示——这才是「按了没反应」的完整原因（侧别传丢 + 无律师静默拦截）。

### 改在 00320261111001 执行成功

- 案件：`00320261111001`（`6139037c-268b-469b-9c0c-e4ebd82b9b85`），阶段 `WAITING_ARCHIVE`，律师「顾言」，`termsVersion=36`，律师侧待发起 66.00
- 请求：`{"side":"LAWYER","amount":"66.00","launchDate":"2026-11-23","lawyerId":"68a6e12f-…","expectedTermsVersion":36,"idempotencyKey":"…"}`
- 响应：`201 {"id":"805594e9-8e20-406b-abd5-16b208177a9f","nth":1,"amount":"66.00"}`
- 复核：`lawyerBalance.launched=66.00`、`remaining=0.00`，`launches` 出现 `LAWYER / nth=1 / 66.00 / 2026-11-23`

### 补充修复（766dd431，已部署）

摘要卡按钮在不可发起时不再静默：新增 `launchBlocker()`，按「无权限 / 阶段不符 / 未指派律师 / 无待发起金额」给出具体原因，按钮置灰并显示提示；新增用例覆盖「未指派律师 → 按钮禁用 + 提示 + 不发请求」。

线上 `current` → `/srv/ip-bp-uat/releases/766dd431`，健康 200。
