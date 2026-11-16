#!/usr/bin/env bash
# UAT 部署脚本（通用版）：备份 → 解包 → 安装 → 迁移 → 构建 → 切换 → 重启 → 清理。
#
# 用法（在本地仓库根目录执行，脚本通过 ssh 在服务器上运行）：
#   git archive --format=tar --prefix=source/ -o src.tar <commit>
#   scp src.tar ubuntu@<host>:/home/ubuntu/
#   ssh ubuntu@<host> 'bash -s' -- <commit> < scripts/deploy-uat.sh
#
# 可选环境变量（写在 ssh 命令里，例如 'APP_ROOT=/srv/xxx bash -s'）：
#   APP_ROOT      部署根目录，默认 /srv/ip-bp-uat
#   ENV_FILE      服务环境文件，默认 /etc/ip-bp-uat/backend.env
#   SERVICE_NAME  systemd 服务名，默认 ip-bp-uat
#   NODE_BIN_DIR  远端 Node 目录，默认 /opt/ip-bp-uat/node-v24.21.0/bin
#   KEEP_RELEASES 保留发布数，默认 5
#   KEEP_BACKUPS  保留数据库备份数，默认 10
#
# 约定：
# - 第 8 步只在 health=200 时清理，且永不删除 current 指向的发布目录。
# - release 目录属主为 root，清理需要免密 sudo。

set -euo pipefail

H=${1:?usage: deploy-uat.sh <commit>}
APP_ROOT=${APP_ROOT:-/srv/ip-bp-uat}
ENV_FILE=${ENV_FILE:-/etc/ip-bp-uat/backend.env}
SERVICE_NAME=${SERVICE_NAME:-ip-bp-uat}
NODE_BIN_DIR=${NODE_BIN_DIR:-/opt/ip-bp-uat/node-v24.21.0/bin}
KEEP_RELEASES=${KEEP_RELEASES:-5}
KEEP_BACKUPS=${KEEP_BACKUPS:-10}

NEW="$APP_ROOT/releases/$H"
BACKUP="/var/backups/ip-bp-uat/case-$H"
SRC_TAR="/home/ubuntu/src-$H.tar"

echo "== 1. backup =="
sudo mkdir -p "$BACKUP"
sudo bash -c "set -a; . $ENV_FILE; set +a; pg_dump \"\$DATABASE_URL\" -Fc -f $BACKUP/db-before.dump"
sudo ls -lh "$BACKUP"

echo "== 2. unpack =="
sudo mkdir -p "$NEW"
sudo tar xf "$SRC_TAR" -C "$NEW" --strip-components=1
sudo chown -R ubuntu:ubuntu "$NEW"

echo "== 3. install =="
cd "$NEW"
export PATH="$NODE_BIN_DIR:/opt/ip-bp-uat/bin:/usr/bin:/bin"
export NODE_OPTIONS=--max-old-space-size=2304
pnpm install --frozen-lockfile --prefer-offline

echo "== 4. migrate =="
DBURL=$(sudo -n bash -c "set -a; . $ENV_FILE; set +a; printf %s \"\$DATABASE_URL\"")
cd "$NEW/backend"
sudo -n env PATH="$NODE_BIN_DIR:/usr/bin:/bin" DATABASE_URL="$DBURL" \
  "$NODE_BIN_DIR/node" node_modules/prisma/build/index.js migrate deploy

echo "== 5. build =="
cd "$NEW"
pnpm prepare:prisma
pnpm build:prepared

echo "== 6. release =="
sudo chown -R root:root "$NEW"
sudo chmod -R a+rX "$NEW"
sudo ln -sfn "$NEW" "$APP_ROOT/current.next"
sudo mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"

echo "== 7. restart =="
sudo systemctl restart "$SERVICE_NAME"
sleep 6
systemctl is-active "$SERVICE_NAME"
HEALTH=$(curl -sk -o /dev/null -w "%{http_code}" https://127.0.0.1/api/v1/health || true)
echo "health:$HEALTH"
readlink -f "$APP_ROOT/current"

echo "== 8. prune =="
# 仅在服务健康时清理；保留最近 KEEP_RELEASES 个发布与 KEEP_BACKUPS 份备份，
# 永不删除 current 指向的目录。
if [ "$HEALTH" = "200" ]; then
  sudo -n bash -c "
    keep=$KEEP_RELEASES
    keep_backups=$KEEP_BACKUPS
    cur=\$(readlink -f $APP_ROOT/current)
    cd $APP_ROOT/releases || exit 0
    ls -1t | tail -n +\$((keep+1)) | while read -r d; do
      [ \"$APP_ROOT/releases/\$d\" = \"\$cur\" ] && continue
      rm -rf \"\$d\" && echo \"pruned release \$d\"
    done
    cd /var/backups/ip-bp-uat 2>/dev/null || exit 0
    ls -1dt case-* 2>/dev/null | tail -n +\$((keep_backups+1)) | while read -r b; do
      rm -rf \"\$b\" && echo \"pruned backup \$b\"
    done
  "
else
  echo "skip prune (health=$HEALTH)"
fi
echo "== done =="
