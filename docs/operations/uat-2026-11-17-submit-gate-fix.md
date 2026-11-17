# 2026-11-17 二审提交被判冲突：根因与修复（`64e7395d`）

| 项目     | 值                                                                       |
| -------- | ------------------------------------------------------------------------ |
| 程序候选 | `64e7395d`                                                               |
| 切换     | 2026-11-17 11:46（北京时间），`current` → `releases/64e7395d`            |
| 结论     | 前端请求 schema 未同步退费字段，导致提交在本地被拒，旧文案误报为版本冲突 |

## 根因

`CaseListWorkflowPanel` 在提交前把请求编码成恢复记录，`decodeCaseListRequest` 用 `shape()` 做**严格键集校验**：

```ts
const shape = (schema) => (value) =>
  record(value) &&
  Object.keys(value).every((key) => Object.hasOwn(schema, key)) && ...
```

上一轮为二审结果加入 `refunds` 后，`schema.result` 没有同步：

| 环节                    | 结果                                              |
| ----------------------- | ------------------------------------------------- |
| 面板提交                | input 含 `refunds`                                |
| `decodeCaseListRequest` | 发现未知键 → 返回 `null`                          |
| `submit()`              | `!stored` → 抛 409                                |
| 面板 catch              | 按「版本冲突」处理 → 提示「案件版本或轮次已变化」 |
| 网络                    | 无请求（请求根本没发出）                          |

因此这是**上一轮退费改动引入的 bug**，此前「既有流程问题」的判断不成立，本文件替代 `uat-2026-11-17-second-instance-submit-diagnosis.md` 的结论。

## 修复

| 位置                           | 改动                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `CaseListWorkflowPanel` schema | `schema.result` 增加 `refunds`（最多 20 笔，校验 party / amount / 可选 status）                                                                |
| 本地门禁错误码                 | 拆分为 `WORKFLOW_SESSION_STALE` / `RECOVERY_STORAGE_UNAVAILABLE` / `ORIGINAL_REQUEST_PENDING` / `ACTION_NOT_ALLOWED`，不再复用 `INVALID_STATE` |
| 面板 catch                     | 本地门禁单独分支，显示真实原因，不进入冲突态                                                                                                   |
| 冲突文案                       | 改为「案件状态已变化，本次请求未被接受。请重新读取资料后重试」                                                                                 |
| 提交门禁可见                   | 新增 `submitBlockedReason`，非空时禁用保存/提交并说明原因                                                                                      |
| 会话判定                       | `submit()` 改用 `props.session.isCurrent()`，不再比较 session 对象引用（抽屉复用时旧实现会永久拒绝提交）                                       |
| 原请求恢复                     | 提示区条件放宽为存在 `pending`，新增「放弃原请求并重新填写」                                                                                   |
| 底部操作                       | Teleport 目标改为元素引用 + 无目标时回落原位（测试环境不再崩溃）                                                                               |

## 端到端验收

案件 `00120261026011`，操作账号知产运营：

| 步骤                     | 结果                                                          |
| ------------------------ | ------------------------------------------------------------- |
| 选择已有裁判文书 + 勾选  | 通过（10 个候选）                                             |
| 选「维持原判」+ 收到日期 | 通过                                                          |
| 底栏提交                 | 通过，请求正常发出                                            |
| 提交结果                 | `stage=WAITING_EXECUTION_DOCUMENTS`，`version 27→28`          |
| 二审结果退费             | 落库 1 笔：法院 / 111.00 / 待退，描述「二审结果登记应退金额」 |
| 详情回传                 | `secondInstance.currentResult.refunds` 返回该笔               |
| 撤销结果                 | 201，`stage` 回到 `SECOND_INSTANCE`，`version=29`             |

## 自动化测试

| 层                                                  | 结果                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `CaseListWorkflowPanel` + `CaseSecondInstancePanel` | 91 项通过                                                                       |
| 新增用例                                            | 带 `refunds` 的二审结果请求可被 `decodeCaseListRequest` 解码（修复前返回 null） |
| 后端 `modules/cases`                                | 1897 项通过（1 项环境依赖未计）                                                 |

## 遗留

撤销二审结果不会回滚退费库存（追加式记录）。本次验收产生的 1 笔「法院 / 111.00 / 待退」保留在诉讼退费中，需要时在退费模块按状态处理。
