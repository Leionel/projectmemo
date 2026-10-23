#!/usr/bin/env bash
# root 执行：bash safe-update.sh <已推送的40位commit>
# 更新共用后端；不调用模型，不运行 seed，不修改 nginx 或鸿蒙本地配置。
set -Eeuo pipefail
APP=/opt/projectmemo/app
NODE_BIN=/home/projectmemo/.nvm/versions/node/v24.22.0/bin
ENV_FILE=/etc/projectmemo/projectmemo.env
TARGET=${1:?请提供完整的已推送 commit}
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo '版本号必须是40位commit'; exit 1; }
[[ $(id -u) == 0 ]] || { echo '请通过sudo或root运行'; exit 1; }
exec 9>/run/lock/projectmemo-update.lock
flock -n 9 || { echo '另一个更新正在运行'; exit 1; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="/opt/projectmemo/backups/web-update-$STAMP"
BUILD_NAME=".next-update-$STAMP"
PREVIOUS=''
STOPPED=0
DEPS_MOVED=0
GENERATED_MOVED=0
BUILD_SWITCHED=0
as_app() { sudo -H -u projectmemo env PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" "$@"; }
check_build_memory() {
  BUILD_HEAP_MB=${PROJECTMEMO_BUILD_HEAP_MB:-2048}
  if [[ ! "$BUILD_HEAP_MB" =~ ^[1-9][0-9]{3,4}$ ]] || (( BUILD_HEAP_MB < 1536 || BUILD_HEAP_MB > 16384 )); then
    echo 'PROJECTMEMO_BUILD_HEAP_MB 必须为1536至16384的整数（MiB）'; return 1
  fi
  local available_kb available_mb required_mb
  available_kb=$(awk '/^MemAvailable:/{m=$2} /^SwapFree:/{s=$2} END {if (m=="") exit 1; printf "%.0f", m+s}' "$1") || { echo '无法读取可用内存，更新停止'; return 1; }
  available_mb=$(( available_kb / 1024 ))
  required_mb=$(( BUILD_HEAP_MB + 1024 ))
  printf '构建堆上限：%s MiB；当前可用内存与空闲swap：%s MiB；要求至少：%s MiB。\n' "$BUILD_HEAP_MB" "$available_mb" "$required_mb"
  if (( available_mb < required_mb )); then
    echo '构建内存余量不足；尚未停服。请核对free -h、增加内存或swap后再更新。'; return 1
  fi
}
health() {
  local release=$1 response
  for attempt in {1..60}; do
    response=$(curl -fsS --max-time 3 http://127.0.0.1:4400/health 2>/dev/null || true)
    if printf '%s' "$response" | "$NODE_BIN/node" -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{const h=JSON.parse(s);process.exit(h.status==="ok"&&h.release===process.argv[1]?0:1)}catch{process.exit(1)}})' "$release"; then return 0; fi
    sleep 1
  done
  return 1
}
rollback() {
  systemctl stop projectmemo-mission-worker projectmemo
  as_app git -C "$APP" restore -- next-env.d.ts tsconfig.json
  as_app git -C "$APP" checkout --detach "$PREVIOUS"
  if (( DEPS_MOVED )); then
    if [[ -d "$APP/node_modules" ]]; then mv "$APP/node_modules" "$BACKUP/failed-node_modules"; fi
    mv "$BACKUP/previous-node_modules" "$APP/node_modules"
  fi
  if (( GENERATED_MOVED )); then
    if [[ -d "$APP/lib/generated/prisma" ]]; then mv "$APP/lib/generated/prisma" "$BACKUP/failed-prisma-client"; fi
    mv "$BACKUP/previous-prisma-client" "$APP/lib/generated/prisma"
  fi
  if (( BUILD_SWITCHED )); then
    if [[ -d "$APP/.next" ]]; then mv "$APP/.next" "$BACKUP/failed-next-build"; fi
    mv "$BACKUP/previous-next-build" "$APP/.next"
  fi
  install -m 600 "$BACKUP/projectmemo.env" "$ENV_FILE"
  systemctl reset-failed projectmemo projectmemo-mission-worker || true
  systemctl start projectmemo
  health "$PREVIOUS_HEALTH"
  systemctl start projectmemo-mission-worker
  systemctl is-active --quiet projectmemo projectmemo-mission-worker
}
on_error() {
  local line=$1
  trap - ERR
  printf '\n更新失败，行号%s；备份：%s\n' "$line" "$BACKUP"
  if (( STOPPED )); then
    # 数据库保留增量迁移，绝不在服务曾对外开放后盲目覆盖数据库。
    if ( set -e; rollback ); then echo '旧代码、依赖、构建和环境已恢复。';
    else echo '自动恢复未完成，服务状态如下；请保留备份，不要执行db:setup。'; fi
  fi
  journalctl -u projectmemo -u projectmemo-mission-worker -n 40 --no-pager || true
  systemctl --no-pager --full status projectmemo projectmemo-mission-worker || true
  exit 1
}
trap 'on_error "$LINENO"' ERR

cd "$APP"
test -x "$NODE_BIN/node"
test "$("$NODE_BIN/node" -p 'process.versions.node.split(".")[0]')" = 24
test "$(systemctl show projectmemo -p WorkingDirectory --value)" = "$APP"
systemctl show projectmemo -p ExecStart --value | grep -Fq "$NODE_BIN/node"
grep -qx 'DATABASE_URL=file:/opt/projectmemo/data/projectmemo.db' "$ENV_FILE"
grep -qx 'ATTACHMENT_DIR=/opt/projectmemo/storage' "$ENV_FILE"
test -f /opt/projectmemo/data/projectmemo.db
test -d "$APP/.next"
test -d "$APP/node_modules"
test -d "$APP/lib/generated/prisma"
systemctl is-active --quiet projectmemo projectmemo-mission-worker
as_app git -C "$APP" diff --quiet -- . ':(exclude)next-env.d.ts'
as_app git -C "$APP" diff --cached --quiet
as_app git -C "$APP" fetch origin codex/r3-runtime-research
as_app git -C "$APP" cat-file -e "$TARGET^{commit}"
as_app git -C "$APP" merge-base --is-ancestor "$TARGET" FETCH_HEAD
PREVIOUS=$(as_app git -C "$APP" rev-parse HEAD)
as_app git -C "$APP" merge-base --is-ancestor "$PREVIOUS" "$TARGET"
if [[ "$PREVIOUS" == "$TARGET" ]]; then health "$TARGET"; echo '已经是目标版本'; exit 0; fi
check_build_memory /proc/meminfo
PREVIOUS_HEALTH=$(curl -fsS --max-time 5 http://127.0.0.1:4400/health | "$NODE_BIN/node" -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const h=JSON.parse(s);if(h.status!=="ok"||!h.release)process.exit(1);console.log(h.release)})')
test ! -e "$BACKUP"
install -d -o projectmemo -g projectmemo -m 700 "$BACKUP"
install -m 600 "$ENV_FILE" "$BACKUP/projectmemo.env"
printf '%s\n' "$PREVIOUS" > "$BACKUP/previous-release.txt"

# 冻结写入后备份，失败也会尝试启动旧版本。
STOPPED=1
systemctl stop projectmemo-mission-worker projectmemo
as_app env DB_FILE=/opt/projectmemo/data/projectmemo.db ATTACHMENT_DIR=/opt/projectmemo/storage BACKUP_ROOT="$BACKUP/data" KEEP=0 \
  bash "$APP/deploy/alibaba-cloud-linux/backup.sh"

mv "$APP/node_modules" "$BACKUP/previous-node_modules"; DEPS_MOVED=1
mv "$APP/lib/generated/prisma" "$BACKUP/previous-prisma-client"; GENERATED_MOVED=1
as_app git -C "$APP" checkout --detach "$TARGET"
as_app npm ci --include=dev
as_app npm rebuild better-sqlite3
as_app node -e 'const D=require("better-sqlite3");const d=new D(":memory:");d.prepare("select 1").get();d.close()'
as_app env DATABASE_URL=file:/opt/projectmemo/data/projectmemo.db npm exec prisma -- generate
as_app env NODE_OPTIONS="--max-old-space-size=$BUILD_HEAP_MB" CIRCLE_NODE_TOTAL=2 \
  DATABASE_URL=file:/opt/projectmemo/data/projectmemo.db ATTACHMENT_DIR=/opt/projectmemo/storage \
  PROJECTMEMO_RELEASE="$TARGET" NEXT_DIST_DIR="$BUILD_NAME" npm run build -- --webpack
test -f "$APP/$BUILD_NAME/BUILD_ID"
as_app git -C "$APP" restore -- next-env.d.ts tsconfig.json
# 不运行db:setup或seed。只有构建成功才迁移已经备份的生产库。
as_app env DATABASE_URL=file:/opt/projectmemo/data/projectmemo.db npm exec prisma -- migrate deploy
as_app env APP_DIR="$APP" node "$APP/deploy/alibaba-cloud-linux/sqlite-tool.mjs" verify /opt/projectmemo/data/projectmemo.db
mv "$APP/.next" "$BACKUP/previous-next-build"; BUILD_SWITCHED=1
mv "$APP/$BUILD_NAME" "$APP/.next"
if grep -q '^PROJECTMEMO_RELEASE=' "$ENV_FILE"; then sed -i "s/^PROJECTMEMO_RELEASE=.*/PROJECTMEMO_RELEASE=$TARGET/" "$ENV_FILE";
else printf '\nPROJECTMEMO_RELEASE=%s\n' "$TARGET" >> "$ENV_FILE"; fi
systemctl reset-failed projectmemo projectmemo-mission-worker || true
systemctl start projectmemo
health "$TARGET"
systemctl start projectmemo-mission-worker
systemctl is-active --quiet projectmemo projectmemo-mission-worker
curl -fsS --max-time 5 http://127.0.0.1:4400/health
printf '\n更新完成：%s\n备份：%s\n真实模型验收未自动运行。\n' "$TARGET" "$BACKUP"
