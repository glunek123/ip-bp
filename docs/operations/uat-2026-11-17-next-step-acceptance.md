# 2026-11-17 二审抉择逻辑验收（补测试数据）

| 项目     | 值                                                         |
| -------- | ---------------------------------------------------------- |
| 环境     | UAT `111.231.164.248`，程序 `107244e0`                     |
| 测试案件 | `00120261026011`（`885b5b44-df1b-4928-8e5a-20db51a01b09`） |
| 操作账号 | 知产运营（zhichan）                                        |

## 造数据方式

线上没有「待判决」案件，通过业务接口把该案件从「二审」撤销回「待判决」：

```
POST /cases/:id/judgment-next-step-revoke
→ stage: WAITING_JUDGMENT，canChooseJudgmentNextStep: true
```

全程走业务接口，不直接改库。

## 验收结果（11/11）

| 检查                         | 结果                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| 「上诉人」替代原描述         | 通过                                                        |
| 顶部「不修改一审判决」已移除 | 通过                                                        |
| 执行准备说明已移除           | 通过                                                        |
| 二审路径提交                 | 通过：`stage=SECOND_INSTANCE`，`next=APPEAL`                |
| 二审选择撤销                 | 通过：回到 `WAITING_JUDGMENT`                               |
| 执行路径提交                 | 通过：`stage=WAITING_EXECUTION_DOCUMENTS`，`next=EXECUTION` |
| 执行选择撤销                 | 通过：回到 `WAITING_JUDGMENT`                               |
| 恢复原路径                   | 通过：`SECOND_INSTANCE` + `APPEAL`                          |

截图：`.local/preview/ui-audit/48-next-step-appeal.png`、`49-next-step-execution.png`

## 数据还原情况

| 字段                    | 原值              | 现值 |
| ----------------------- | ----------------- | ---- |
| stage                   | `SECOND_INSTANCE` | 一致 |
| next                    | `APPEAL`          | 一致 |
| plaintiffRightsHolderId | `0e1e0b0e…`       | 一致 |
| plaintiffName           | 澄禾家居设计中心  | 一致 |
| defendants              | `[]`              | 一致 |
| version                 | 11                | 25   |

审计历史新增 8 条选择记录与 7 条撤销记录（含验证过程中的重复往返），业务状态等价，历史可追溯。如需清理这些测试记录，应通过数据库脚本并在审计留痕后执行，当前未处理。
