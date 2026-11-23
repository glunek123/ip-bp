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

## 后续修正（cbedf0d5，已部署）

上一版详情页「删除客户」按钮按编辑权限渲染，属妥协版。本版补齐服务端能力投影：

- `customer.service.ts` 的 `detail()` 增加 `customer.delete` 授权判定，`capabilities` 返回 `delete: boolean`。
- 前端按钮改为只认 `customer.capabilities.delete`，无授权者不再看到按钮。
- 回归：后端客户模块 251/251、前端客户模块 280 通过；新增两条前端用例（能力开关控制按钮、带关联数量与原因的删除流程跳回列表）。

## 线上故障修复（495b354a，已部署）

现象：客户详情页整页显示「客户资料暂时无法加载」，服务器日志显示 `GET /api/v1/customers/:id` 返回 200。

根因：`frontend/src/api/customers.ts` 的详情校验器用**白名单精确键**校验 `capabilities`（`Object.keys(capabilities).every(key => [...].includes(key))`），新增的 `delete` 字段不在白名单内，`getCustomer` 因此抛 `invalidResponse`，页面进入失败态。后端返回本身正确。

修复：白名单补 `delete`；新增解析器用例（含 `delete: true` 正常解码、未知能力键 `deleteAll` 被拒）。

线上产物 `index-BPQpzUNA.js`，可直接检出 `editRoutine","admit","deleteDraft","delete"` 片段，确认修复已生效。

## API 层验收执行（2026-11-23 13:20）

以 `zhichan`（徐梦梦，UAT知产运营）与 `manager`（UAT准入主管）实调接口，客户 `372f3cc0-…`（验收测试客户甲 / 901）：

| 步骤 | 请求 | 结果 |
|---|---|---|
| 能力投影（有删除权限） | `GET /customers/:id` | `capabilities.delete = true` |
| 关联数量 | `GET /customers/:id/deletion-impact` | 线索/案件/协议/结算/资产/账号 全 0 |
| 删除 | `POST /customers/:id/delete` `{expectedVersion:1, reason:"UAT 验收-删除测试"}` | `201`，版本 → 2 |
| 列表联动 | `GET /customers` | 总数 62 → 61，目标不可见 |
| 已删除名单 | `GET /customers/deleted-drafts` | 含「验收测试客户甲」，原因与版本正确 |
| 恢复 | `POST /customers/:id/restore` `{expectedVersion:2}` | `201`，列表回到 62 |
| 能力投影（无删除权限） | `manager` `GET /customers/:id` | `capabilities.delete = false`（按钮不渲染） |
| 越权删除 | `manager` `POST …/delete` | `403 CUSTOMER_ACTION_FORBIDDEN` |
| 重复拒绝 | 同名 + 同证件号新建 | `409 CUSTOMER_DUPLICATE`，提示含既有编号 901 |
| 同名不同证件 | 同名 + `…0002Y` 新建 | `201`，分配编号 063；已即时物理清理 |

结论：能力投影、删除、已删除名单、恢复、重复拒绝与放行分支均在真实接口上按预期工作。

## 新建客户死锁修复（e8cc0efe，已部署）

现象：新建客户面板填入统一社会信用代码后，提交始终提示「填写信用代码或证件号码时，请选择主体类型和证件类型。」，但界面上已没有「主体类型 / 证件类型」两个下拉，无法继续。

根因：`1cc4f841`（11-19「drop the subject and identity type selectors」）删掉了两个下拉、并从请求体去掉了 `customerType`，却**没有删除对应的校验分支**，`customerType`/`identityType` 恒为空 → 只要填了证件号就永远校验失败。

修复（`CustomerNewPage.vue`）：

- 删除残留校验分支与 `customerType`/`identityType`/`displayedIdentityTypes`/`watch` 等死代码；
- 证件类型固定 `BUSINESS_LICENSE`（字段本身已收敛为「统一社会信用代码」）；
- 标签固定显示「统一社会信用代码」。

验证：前端客户模块 281 通过 / 9 跳过（新增「凭信用代码直接创建」用例）；`vue-tsc`、ESLint、Prettier 通过；UAT 用新载荷 `{name, identityType:'BUSINESS_LICENSE', identityNumber}` 实测 `201`（自动分配编号 064，随后已物理清理）；线上 `current` → `e8cc0efe`，产物 `index-BiRD2IKb.js`。
