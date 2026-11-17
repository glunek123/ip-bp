# 2026-11-17 撤销二审结果回滚退费（`5c180ce5`）

| 项目     | 值                                                            |
| -------- | ------------------------------------------------------------- |
| 程序候选 | `5c180ce5`                                                    |
| 切换     | 2026-11-17 12:44（北京时间），`current` → `releases/5c180ce5` |

## 实现方式

退费库存是**只追加的版本快照**，且带财务审计触发器：

| 约束                                               | 影响                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| `case_refund_inventory_items` 禁止 UPDATE / DELETE | 不能物理删除退费行                                                         |
| `case_refund_inventory_versions` 只允许 INSERT     | 回滚只能追加新版本                                                         |
| `assert_case_financial_actor`                      | 写库存要求操作人是案件负责人、审计带 `authorizationRevision`、阶段在白名单 |

因此回滚采用「跟进」通道（`case.refund.follow`）：撤销二审结果时，把该结果的每一笔退费置为 `UNKNOWN` 并写入备注，历史版本仍完整可追溯。

| 位置                                           | 改动                                                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `LitigationRefundsService.revokeSourceRefunds` | 按 `sourceType + sourceId` 找出退费行，逐笔 follow 到 `UNKNOWN`，备注「二审结果已撤销，退费口径待核」 |
| `CaseSecondInstanceService` 撤销分支           | 结果撤销成功后调用回滚                                                                                |

## 线上验证

案件 `00120261026011`：

| 步骤                     | 结果                                                                         |
| ------------------------ | ---------------------------------------------------------------------------- |
| 提交二审结果（维持原判） | `stage=WAITING_EXECUTION_DOCUMENTS`，version 30，退费行 `90b46700` = PENDING |
| 撤销二审结果             | 201，`stage` 回到 `SECOND_INSTANCE`，version 31                              |
| 退费行状态               | `90b46700`：PENDING → **UNKNOWN**，备注「二审结果已撤销，退费口径待核」      |

库存当前快照（同案三笔）：

```
90b46700…|UNKNOWN|二审结果登记应退金额|二审结果已撤销，退费口径待核|SECOND_INSTANCE_RESULT
29cab8a2…|PENDING|判决更新登记应退金额|（一审，未撤销）|JUDGMENT
1ab7907d…|PENDING|二审结果登记应退金额|（历史遗留）|SECOND_INSTANCE_RESULT
```

## 历史遗留（已处理）

`1ab7907d` 是第一轮验收（回滚功能尚未上线时）登记的退费行，其二审结果已撤销但状态仍为 `PENDING`。

2026-11-17 13:08 通过跟进接口清理：

```
PATCH /api/v1/cases/litigation-refunds/:caseId/items/:itemId/follow-up
{ status: "UNKNOWN", remark: "二审结果已撤销，退费口径待核",
  reason: "历史遗留清理：结果撤销时回滚尚未上线" }
→ 200，库存版本 revision 4 → 5（versionId 102d560c…）
```

清理后库存快照：

| itemId      | 状态    | 备注                         | 来源                       |
| ----------- | ------- | ---------------------------- | -------------------------- |
| `90b46700…` | UNKNOWN | 二审结果已撤销，退费口径待核 | SECOND_INSTANCE_RESULT     |
| `1ab7907d…` | UNKNOWN | 二审结果已撤销，退费口径待核 | SECOND_INSTANCE_RESULT     |
| `29cab8a2…` | PENDING | —                            | JUDGMENT（一审，正常待退） |

至此两笔二审退费均已作废，仅保留一审那笔待退，审计链完整。

## 测试

| 层                                  | 结果      |
| ----------------------------------- | --------- |
| 后端 `case-second-instance.service` | 35 项通过 |
| health                              | 200       |
