# 权利主体 编辑 / 解除关联 设计（待实现）

## 已确认口径（2026-11-13）

- 删除 = 只解除本客户关联，主体记录保留；其他客户不受影响
- 编辑 = 更新共用主体资料，影响所有关联客户；保存前提示影响范围

## 实施进展（2026-11-13）

- 编辑：已上线 `88d77333`
- 解除关联：首版线上 500（P2003），关联行被资产与命令回执以 Restrict 引用，不能物理删除；已回退，待迁移

## 现状

- 后端仅有 `GET /customers/:id/rights-holders`、`POST rights-holders`、`GET rights-holders/:holderId`、`GET linkable-rights-holders`、`POST rights-holder-links`
- 无 PATCH / DELETE，前端表格操作列只有「查看详情」

## 接口设计

| 方法   | 路径                                                    | 入参                                                                    | 权限                         | 结果                          |
| ------ | ------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------- | ----------------------------- |
| PATCH  | `/customers/:customerId/rights-holders/:rightsHolderId` | `expectedCustomerVersion`、name/credit/address/legalRepresentative/duty | `customer.edit-routine` 范围 | `{ holder, customerVersion }` |
| DELETE | `/customers/:customerId/rights-holders/:rightsHolderId` | `expectedCustomerVersion`                                               | 同上                         | `{ customerVersion }`         |

实现要点：

- 复用 `RightsHolderService` 的 scope、版本递增、幂等回执（新增 action：`update` / `unlink`）
- 更新写审计事件，记录变更前后字段
- 解除关联删除 `customerRightsHolderLink` 行，不动 `rightsHolder`
- 版本冲突沿用 409 语义，前端提示刷新

## 前端

- 操作列：`编辑` + `解除关联`（二次确认，文案说明“仅从本客户移除，主体保留”）
- 编辑弹层复用现有新建表单字段：权利主体*、统一社会信用代码*、住所地*、法定代表人*、职务
- 保存前提示：该主体同时关联 N 个客户，修改将同步生效
- 成功后刷新列表与客户版本

## 验证

- 后端单测：权限拒绝、版本冲突、重复解除、幂等回执、审计写入
- 前端用例：弹层回填、保存、取消、解除确认
- 线上：编辑一个主体后核对另一关联客户看到新值；解除后原客户列表移除、主体仍可被重新关联
