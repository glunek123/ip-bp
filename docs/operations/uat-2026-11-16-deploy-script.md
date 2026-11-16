# 2026-11-16 部署脚本纳入版本管理（`scripts/deploy-uat.sh`）

| 项目     | 值                                            |
| -------- | --------------------------------------------- |
| 脚本路径 | `scripts/deploy-uat.sh`                       |
| 首次使用 | 2026-11-16 17:41（北京时间），部署 `9d67d875` |

## 用法

```bash
git archive --format=tar --prefix=source/ -o src.tar <commit>
scp src.tar ubuntu@<host>:/home/ubuntu/
ssh ubuntu@<host> 'bash -s' -- <commit> < scripts/deploy-uat.sh
```

## 可配置项

| 变量            | 默认值                             | 说明             |
| --------------- | ---------------------------------- | ---------------- |
| `APP_ROOT`      | `/srv/ip-bp-uat`                   | 部署根目录       |
| `ENV_FILE`      | `/etc/ip-bp-uat/backend.env`       | 服务环境文件     |
| `SERVICE_NAME`  | `ip-bp-uat`                        | systemd 服务名   |
| `NODE_BIN_DIR`  | `/opt/ip-bp-uat/node-v24.21.0/bin` | 远端 Node 目录   |
| `KEEP_RELEASES` | `5`                                | 保留发布数       |
| `KEEP_BACKUPS`  | `10`                               | 保留数据库备份数 |

覆盖方式：`ssh ubuntu@host 'APP_ROOT=/srv/other bash -s' -- <commit> < scripts/deploy-uat.sh`

## 与本地脚本的关系

`.local/deploy/deploy-generic.sh` 仍可用，但不再维护；以 `scripts/deploy-uat.sh` 为准。

## 验证

用新脚本部署 `9d67d875`：

| 项         | 结果                                                     |
| ---------- | -------------------------------------------------------- |
| 构建与切换 | 成功，`current` = `9d67d875`                             |
| 健康检查   | 200                                                      |
| prune 输出 | `pruned release 199715f6`、`pruned backup case-92602e37` |
| 发布数     | 5                                                        |
| 备份数     | 10（`case-*`）                                           |
| 服务       | active                                                   |
