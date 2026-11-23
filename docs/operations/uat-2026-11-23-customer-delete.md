# 2026-11-23 客户删除与重复校验上线（已部署 adb463e1）

## 口径

- 删除：软删除，数据全保留，仅从列表/详情/选择器隐藏，可在「已删除客户」恢复；准入客户须填原因。
- 重复：同名且证件号相同（或双方都无证件号）拒绝新建，返回 409 `CUSTOMER_DUPLICATE`。
- 权限：新增 `customer.delete` / `customer.restore`，迁移里自动授予已有草稿删除/恢复权限的部门级角色。

## 迁移

| 迁移 | 内容 |
|---|---|
| `20261123120000_customer_soft_delete_enums` | 新增两个权限枚举值 |
| `20261123120100_customer_soft_delete` | 删除 `customers_deleted_never_admitted_check`；重写 `customer_draft_deletion_guard`、`customer_draft_association_guard`（只拦新增）；按角色补授权 |
| `20261123130000_customer_soft_delete_state` | 替换 `customers_deleted_state_check`——原约束要求被删客户仍是 DRAFT，准入客户无法删除 |

## 部署与实测（UAT）

- `current` → `/srv/ip-bp-uat/releases/adb463e1`，健康 200，产物 `index-ByF9WvBt.js`。
- 三条迁移 `finished_at` 均已写入，`customers_deleted_never_admitted_check` 计数 0，新授权 2 条。
- 事务内冒烟（已回滚，无残留）：准入客户软删除成功 → 恢复成功；已删除客户的历史案件执行 `UPDATE cases` 成功（说明关联守卫放宽生效）；对已删除客户新增线索被 `customer_new_lead_cooperation_guard` 拒绝（符合预期）。
- 首次部署 `efd355d9` 时冒烟失败：`customers_deleted_state_check` 要求 `profile_status='DRAFT'`，准入客户无法删除。已由 `20261123130000` 修复后重新部署。

## 前端

- 详情页「删除客户」：先读关联数量（线索/案件/协议/结算/资产/账号），原因必填，确认后跳回列表。
- 新建客户：移除「同名继续原因」输入，被拒后弹出提示块并保留表单。
- 「已删除草稿」改为「已删除客户」，恢复走 `POST /customers/:id/restore`。

## 已知边界

- 详情页「删除客户」按钮当前按「有编辑权限即显示」渲染，未使用服务端 `capabilities.delete` 投影：加入该投影会让 5 个后端测试套件因 mock 调用顺序变化失败，本轮回退，无授权者点击会收到失败提示而非按钮消失。
- 未执行数据库型 E2E；删除/恢复仅经上述 SQL 冒烟与单元测试验证。

## 回滚

```bash
ssh ubuntu@111.231.164.248 'sudo ln -sfn /srv/ip-bp-uat/releases/40a37065 /srv/ip-bp-uat/current.next && sudo mv -Tf /srv/ip-bp-uat/current.next /srv/ip-bp-uat/current && sudo systemctl restart ip-bp-uat'
```

回滚代码不会撤销三条迁移（约束与触发器已替换）；如需恢复旧约束，需另写迁移。删除前备份在 `/var/backups/ip-bp-uat/case-adb463e1/`。
