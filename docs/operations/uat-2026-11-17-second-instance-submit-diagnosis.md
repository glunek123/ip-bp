# 2026-11-17 二审结果提交被判冲突的排查结论

| 项目 | 值                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------- |
| 现象 | 点「确认登记」后无网络请求，面板立即显示「存在冲突，请先核对后再登记」「案件版本或轮次已变化」 |
| 案件 | `00120261026011`（SECOND_INSTANCE，可登记）                                                    |
| 结论 | 本地状态校验拒绝了提交，但被错误归因为「版本/轮次冲突」；不是裁判文书勾选问题                  |

## 实测证据

| 观察                     | 结果                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| 勾选裁判文书后复选框状态 | `checked=true`，等待 3 秒、上传后仍保持，未丢失                     |
| 上传后案件 version       | 始终 27，未被重置                                                   |
| 提交按钮                 | 可用（`disabled=false`）                                            |
| 点击确认后网络           | 无 `POST /cases/:id/second-instance-result`，只有材料上传与详情读取 |
| 点击后提示               | 立即出现「存在冲突」「案件版本或轮次已变化」                        |
| sessionStorage           | 打开前为空，清空后重试仍失败                                        |

## 代码定位

`CaseListWorkflowPanel.submit()`：

```ts
if (
  !current() ||
  storageBlocked.value ||
  (!recovery && (!allowed.value || pending.value))
)
  throw new ApiError('请先核对原请求及当前操作权限', 409, 'INVALID_STATE');
```

本地不满足条件时直接抛 409，不会发请求。面板 `send()` 的 catch 把 409 统一映射为：

```
案件版本或轮次已变化。旧请求不会改用新版本，请刷新并核对后重新填写。
+ conflictNeedsReview = true（提交按钮随之进入冲突态）
```

已排除的项：

| 候选原因           | 结论                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| 裁判文书勾选未生效 | 排除：勾选状态稳定，且勾选后按钮可用                                                 |
| 轮次不匹配         | 排除：`judgmentNextStep.current.trialRoundId === secondInstance.currentTrialRoundId` |
| 权限不足           | 排除：`canRegisterSecondInstanceResult=true`，且 `resolveCaseDetailActions` 条件满足 |
| 本地待确认记录残留 | 排除：`sessionStorage` 为空，清空后重试一致                                          |
| 服务端 409         | 排除：无请求发出                                                                     |

剩余可能（二者之一，需加日志确认）：

1. `beginSubmit()` 返回 false —— 抽屉 `requestState` 不是 `idle`（例如处于 `submitting`/`unknown`）
2. `pending.value` 非空 —— 面板挂载时恢复了未完成的请求记录

## 性质判断

**设计缺陷 + 文案缺陷，非单点 bug**

| 类型         | 说明                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| 双状态机耦合 | 抽屉持有 `requestState`，二审面板另有 `pendingUnknown` + `secondInstanceCommandAttempt`，两套状态都参与提交门禁 |
| 错误归因     | 本地拒绝与服务端版本冲突共用同一句文案，把「还没发请求」说成「版本已变化」                                      |
| 无自助恢复   | 文案让用户「刷新并核对后重新填写」，但刷新后状态依旧，形成死循环                                                |

## 建议修复

1. 本地拒绝单独给错误码与文案（例如「上次提交尚未确认，请先用原请求重试」），不进入 `conflictNeedsReview`
2. 提交前显式检查抽屉 `requestState`，非 `idle` 时禁用按钮并说明原因
3. 面板提供「放弃上次请求并重新填写」入口，作为 `unknown` 状态的自助出口

工作量：前端 2 个文件（`CaseSecondInstancePanel.vue`、`CaseListWorkflowPanel.vue`）+ 测试。

## 与本次退费改动的关系

无关。退费写入走服务层测试覆盖（35 项，含 `registerSecondInstanceRefunds` 调用与金额校验），提交门禁是既有流程。
