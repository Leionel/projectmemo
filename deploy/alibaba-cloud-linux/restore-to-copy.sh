#!/usr/bin/env bash
#
# 忆程 ProjectMemo —— 恢复演练（把备份还原成一份可独立运行的副本）
#
# 默认行为是把备份还原到**另一个目录**，用它验证「备份确实可恢复」，
# 不触碰线上数据。这是复赛 Gate 里缺的那一步：有备份不等于能恢复。
#
# 用法：
#   ./restore-to-copy.sh <备份目录>                     # 还原到 /opt/projectmemo/restore-drill/<时间戳>
#   ./restore-to-copy.sh <备份目录> <目标目录>            # 还原到指定目录
#   ./restore-to-copy.sh <备份目录> --in-place --confirm  # 覆盖线上数据（明确授权后才可用）
#
# 覆盖线上数据是不可逆操作：会先用现有数据库做一次 pre-restore 快照再替换，
# 但仍然会丢失快照之后写入的数据，因此必须同时给出 --confirm。

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/projectmemo/app}"
LIVE_DB="${LIVE_DB:-/opt/projectmemo/data/projectmemo.db}"
LIVE_ATTACHMENT_DIR="${LIVE_ATTACHMENT_DIR:-/opt/projectmemo/storage}"
DRILL_ROOT="${DRILL_ROOT:-/opt/projectmemo/restore-drill}"
# 与 backup.sh 使用同一个备份根目录，覆盖前的兜底快照也落在那里
BACKUP_ROOT="${BACKUP_ROOT:-/opt/projectmemo/backups}"

TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sqlite-tool.mjs"

log() { printf '[restore] %s\n' "$*"; }
fail() { printf '[restore] 错误：%s\n' "$*" >&2; exit 1; }

BACKUP_DIR="${1:-}"
[ -n "$BACKUP_DIR" ] || fail "用法：restore-to-copy.sh <备份目录> [目标目录|--in-place --confirm]"
[ -d "$BACKUP_DIR" ] || fail "备份目录不存在：$BACKUP_DIR"
[ -f "$BACKUP_DIR/projectmemo.db" ] || fail "备份里没有 projectmemo.db：$BACKUP_DIR"
[ -f "$TOOL" ] || fail "找不到 helper：$TOOL"

# ---- 先验证备份自身可用，再谈恢复 ----
log "校验备份完整性"
APP_DIR="$APP_DIR" node "$TOOL" verify "$BACKUP_DIR/projectmemo.db" >/dev/null
BACKUP_COUNTS="$(APP_DIR="$APP_DIR" node "$TOOL" info "$BACKUP_DIR/projectmemo.db")"
log "备份数据量：$BACKUP_COUNTS"

SHIFT_TARGET="${2:-}"
IN_PLACE=0
if [ "$SHIFT_TARGET" = "--in-place" ]; then
  [ "${3:-}" = "--confirm" ] || fail "覆盖线上数据必须显式加 --confirm"
  IN_PLACE=1
fi

if [ "$IN_PLACE" -eq 1 ]; then
  log "警告：即将用备份覆盖线上数据"
  if [ -f "$LIVE_DB" ]; then
    SNAPSHOT="$BACKUP_ROOT/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).db"
    mkdir -p "$(dirname "$SNAPSHOT")"
    log "覆盖前先给现有库做快照：$SNAPSHOT"
    APP_DIR="$APP_DIR" node "$TOOL" backup "$LIVE_DB" "$SNAPSHOT" >/dev/null
  fi

  mkdir -p "$(dirname "$LIVE_DB")"
  cp -a "$BACKUP_DIR/projectmemo.db" "$LIVE_DB"
  # 覆盖时必须清掉旧的 WAL/SHM，否则会和新 .db 文件拼出不一致的状态
  rm -f "$LIVE_DB-wal" "$LIVE_DB-shm" "$LIVE_DB-journal"

  if [ -d "$BACKUP_DIR/storage" ]; then
    log "还原附件目录 → $LIVE_ATTACHMENT_DIR"
    mkdir -p "$LIVE_ATTACHMENT_DIR"
    cp -a "$BACKUP_DIR/storage/." "$LIVE_ATTACHMENT_DIR/"
  fi

  APP_DIR="$APP_DIR" node "$TOOL" verify "$LIVE_DB" >/dev/null
  log "线上数据已按备份还原，请重启服务并重新走一遍登录与主流程"
  exit 0
fi

TARGET="${SHIFT_TARGET:-$DRILL_ROOT/$(basename "$BACKUP_DIR")}"
[ -e "$TARGET" ] && fail "目标目录已存在，请换一个以免覆盖：$TARGET"

log "还原副本 → $TARGET"
mkdir -p "$TARGET"
cp -a "$BACKUP_DIR/projectmemo.db" "$TARGET/projectmemo.db"
if [ -d "$BACKUP_DIR/storage" ]; then
  cp -a "$BACKUP_DIR/storage" "$TARGET/storage"
fi

APP_DIR="$APP_DIR" node "$TOOL" verify "$TARGET/projectmemo.db" >/dev/null
log "副本数据量：$(APP_DIR="$APP_DIR" node "$TOOL" info "$TARGET/projectmemo.db")"

cat <<EOF

[restore] 演练完成，副本位于：$TARGET

用副本起一个只读验证实例（不占用线上端口与数据）：

  cd $APP_DIR
  DATABASE_URL="file:$TARGET/projectmemo.db" \\
  ATTACHMENT_DIR="$TARGET/storage" \\
  PORT=4401 npm run start

然后确认：登录成功、项目列表可见、抽查一条记忆与一个附件能打开。
这一步通过，才能说“备份可恢复”，而不是“有备份文件”。
EOF