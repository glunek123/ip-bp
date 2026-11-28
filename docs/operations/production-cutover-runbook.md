# 知产案管系统生产切换 Runbook

本文档用于指导将当前已完成功能修复与数据结构收口的 UAT 系统（运行基线 `ae8605a5`）正式切换为运营生产系统。

---

## 1. 上线前阻塞与前提核对（需业务/运维确认）

| 优先级 | 前提项 | 现状与要求 | 负责方 |
| --- | --- | --- | --- |
| **P0** | 老系统停写窗口与增量备份 | 当前数据来源于 `2026-11-17` NocoBase 备份。需约定停写窗口，导出停写后最新全量/增量 MySQL 备份并回放 `11-17` 之后的增量数据 | 业务 + 运维 |
| **P1** | 外部三端门户实测账号 | 内部运营主链（含真实写入）在 UAT 验证通过；**客户端、律师端、公证处端**外部门户登录与协作流程需使用对应测试账号各实测一轮 | 业务 + QA |
| **P1** | 阿里云 OSS 桶私有化改造（**可选**） | 后端已上线鉴权代理 `/api/v1/legacy-attachments/:id/content` 并隐藏前端原直链，**当前可不改 OSS 桶权限、不影响系统正常使用**。若后续决定收紧桶 ACL 为“私有读”，须先配置只读 RAM AccessKey/Secret 并接入代理 V4 签名后再切桶权限 | 运维 + 开发（可选） |
| **P1** | 分支合入 `main` 授权 | 当前代码提交位于本地分支 `codex/case-cards-20261110`（未推送远端、未合入 `main`），需获明确合入授权后推送并部署正式环境 | 项目负责人 |

---

## 2. 停写窗口与增量切换步骤

1. **老系统只读冻结**：通知业务停止在旧 NocoBase 系统录入与编辑，记录切流时间点。
2. **切流前全量快照**：在目标库执行手动全量备份（或复用自动备份脚本 `/usr/local/sbin/ip-bp-uat-daily-backup.sh`）：
   ```bash
   sudo /usr/local/sbin/ip-bp-uat-daily-backup.sh
   ```
3. **提取并导入 `2026-11-17` 之后增量数据**：
   - 使用停写时刻导出的老库 `.sql.gz` 对比增量客户、线索、公证、案件、费用、附件及开票记录；
   - 按既有脚本/前向 SQL 幂等导入，同步校对 `customer_business_number_counters.last_value >= MAX(business_id::bigint)`；
   - 运行与 `20261128213000_clean_orphan_fk_rows_and_restore_checks` 同等口径的孤儿外键与 5 项 CHECK 约束校验，确保全库零违例。
4. **清理 UAT 测试数据**：
   - 核对测试客户（如 `UAT复验测试客户-20261128` 编号 `880`，已于 UAT 验证软删除留痕）、测试线索/公证/案件（如 `00120261128001`、`NT-20261128-001`）；
   - 如需正式库干净口径，在切正式前按既定清理清单/归档规则处理测试记录。
5. **业务待决 14 项历史人工补录**（不阻塞切换，可切换后由运营逐步补齐）：
   - 12 件待归档历史案缺结案日期/多案归属确认（见 [2026-11-24-case-guard-health.md](2026-11-24-case-guard-health.md)）；
   - 2 家未建开票档案（`嘉厚所（技术测试）`缺少税号银行、`北京金洪恩`对应客户已软删除）。

---

## 3. 代码合并与生产发布

1. **本地合入检查**（PowerShell 根目录下先执行 `. .\Use-ProjectRuntime.ps1`）：
   ```powershell
   pnpm context:check:strict
   pnpm architecture:check
   pnpm verify
   ```
2. **合并 `codex/case-cards-20261110` → `main` 并打标签**（经负责人授权后执行）。
3. **通过部署脚本发布**：
   - 本地归档并上传至服务器 `/home/ubuntu/src-<commit>.tar`；
   - 服务器执行 `scripts/deploy-uat.sh <commit>`（注意 Windows 端通过 SSH 管道传递时需去除 `\r`：`tr -d '\r' | bash -s -- <commit>`）。
4. **发布后核验**：
   - `systemctl is-active ip-bp-uat` 为 `active`；
   - `curl -sk https://127.0.0.1/api/v1/health` 返回 `200`（`database: "up"`）；
   - `npx prisma migrate status` 无待执行迁移；
   - 抽检报表（`/reports`）、结算与退费（`/settlements`）、证物（`/evidence`）、公证（`/notary-matters`）、历史附件代理（`/api/v1/legacy-attachments/:id/content`）及删除留痕（`/settings/deletion-audit-logs`）。

---

## 4. 备份与回滚预案

- **每日自动备份**：`/etc/cron.d/ip-bp-uat-daily-backup` 每日 `03:00` 执行 `/usr/local/sbin/ip-bp-uat-daily-backup.sh`，输出至 `/var/backups/ip-bp-uat/daily/dev_cor_uat-YYYYMMDD-HHMMSS.dump`，保留最近 14 天，日志位于 `/var/log/ip-bp-uat-backup.log`。
- **发版前快照**：每次运行 `scripts/deploy-uat.sh` 均会在 `/var/backups/ip-bp-uat/case-<commit>/db-before.dump` 自动生成发版前备份。
- **回滚命令**：若切流或发版异常，立即停止服务、使用最近一次 `.dump` 执行 `pg_restore` 恢复库状态，并将 `/srv/ip-bp-uat/current` 指回上一稳定 release 后重启服务。
