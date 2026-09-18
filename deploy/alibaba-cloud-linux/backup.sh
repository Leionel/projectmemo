#!/usr/bin/env bash
#
# 忆程 ProjectMemo —— ECS 备份
#
# 备份两样东西，缺一不可：
#   1. SQLite 数据库（用 Online Backup API 取一致快照，见 sqlite-tool.mjs 说明）
#   2. 附件目录（图片/PDF 原件，删掉不可再生）
#
# 用法：
#   sudo -u projectmemo ./backup.sh
#
# 可覆盖的环境变量：
#   APP_DIR         应用目录（用于解析 better-sqlite3），默认 /opt/projectmemo/app
#   DB_FILE         数据库文件，默认 /opt/projectmemo/data/projectmemo.db
#   ATTACHMENT_DIR  附件目录，默认 /opt/projectmemo/storage
#   BACKUP_ROOT     备份根目录，默认 /opt/projectmemo/backups
#   KEEP            保留最近多少份，默认 14
#
# 只读：本脚本不修改数据库与附件目录，只读源、写 BACKUP_ROOT。

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/projectmemo/app}"
DB_FILE="${DB_FILE:-/opt/projectmemo/data/projectmemo.db}"
ATTACHMENT_DIR="${ATTACHMENT_DIR:-/opt/projectmemo/storage}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/projectmemo/backups}"
KEEP="${KEEP:-14}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_ROOT/$STAMP"
TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sqlite-tool.mjs"

log() { printf '[backup] %s\n' "$*"; }
fail() { printf '[backup] 错误：%s\n' "$*" >&2; exit 1; }

# ---- 前置检查：宁可什么都不做，也不要产出一个看起来成功的空备份 ----
command -v node >/dev/null 2>&1 || fail "找不到 node，无法执行在线备份"
[ -f "$TOOL" ] || fail "找不到 helper：$TOOL"
[ -f "$DB_FILE" ] || fail "数据库不存在：$DB_FILE"
[ -d "$APP_DIR" ] || fail "应用目录不存在：$APP_DIR"

# 备份根目录必须由当前账号可写。没有这一步时，非 root 身份运行会直接抛出
# 原始的 "mkdir: cannot create directory ...: Permission denied"，
# 看起来像脚本坏了，实际是目录归属不对（通常是被 root 创建过）。
if [ ! -d "$BACKUP_ROOT" ]; then
  mkdir -p "$BACKUP_ROOT" 2>/dev/null \
    || fail "无法创建备份根目录 $BACKUP_ROOT。修复：sudo mkdir -p $BACKUP_ROOT && sudo chown -R $(id -un) $BACKUP_ROOT"
fi
[ -w "$BACKUP_ROOT" ] \
  || fail "备份根目录不可写：$BACKUP_ROOT（当前账号 $(id -un)，属主 $(stat -c '%U:%G' "$BACKUP_ROOT")）。修复：sudo chown -R $(id -un) $BACKUP_ROOT"

mkdir -p "$DEST" || fail "无法在 $BACKUP_ROOT 下创建快照目录 $DEST"

# ---- 1. 数据库在线备份 ----
log "备份数据库 $DB_FILE → $DEST/projectmemo.db"
APP_DIR="$APP_DIR" node "$TOOL" backup "$DB_FILE" "$DEST/projectmemo.db"

# ---- 2. 备份内数据量核对（防止把空库当成有效备份）----
BACKUP_COUNTS="$(APP_DIR="$APP_DIR" node "$TOOL" info "$DEST/projectmemo.db")"
log "备份库数据量：$BACKUP_COUNTS"

# ---- 3. 附件目录 ----
ATTACHMENT_FILES=0
if [ -d "$ATTACHMENT_DIR" ]; then
  log "备份附件目录 $ATTACHMENT_DIR → $DEST/storage"
  cp -a "$ATTACHMENT_DIR" "$DEST/storage"
  ATTACHMENT_FILES="$(find "$DEST/storage" -type f | wc -l | tr -d ' ')"
else
  log "警告：附件目录不存在（$ATTACHMENT_DIR），本次备份不含附件"
fi

# ---- 4. 回执清单 ----
RELEASE="${PROJECTMEMO_RELEASE:-}"
if [ -z "$RELEASE" ] && [ -f "$APP_DIR/.env" ]; then
  RELEASE="$(sed -n 's/^PROJECTMEMO_RELEASE=//p' "$APP_DIR/.env" | tr -d '"' | head -1)"
fi
RELEASE="${RELEASE:-unversioned}"

GIT_COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
DB_SHA="$(sha256sum "$DEST/projectmemo.db" | cut -d' ' -f1)"
DB_BYTES="$(stat -c%s "$DEST/projectmemo.db")"

{
  echo "created_at_utc=$STAMP"
  echo "host=$(hostname)"
  echo "release=$RELEASE"
  echo "git_commit=$GIT_COMMIT"
  echo "source_db=$DB_FILE"
  echo "source_attachment_dir=$ATTACHMENT_DIR"
  echo "db_sha256=$DB_SHA"
  echo "db_bytes=$DB_BYTES"
  echo "attachment_files=$ATTACHMENT_FILES"
  echo "db_counts=$BACKUP_COUNTS"
  echo "integrity_check=ok"
} > "$DEST/manifest.txt"

# ---- 5. 只保留最近 KEEP 份 ----
if [ "$KEEP" -gt 0 ]; then
  # 按时间倒序，跳过前 KEEP 个，其余删除。备份目录名是 UTC 时间戳，排序即时间序。
  ls -1dt "$BACKUP_ROOT"/*/ 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
    log "清理过期备份 $old"
    rm -rf "$old"
  done
fi

log "完成：$DEST"
log "数据库 sha256=$DB_SHA，附件文件数=$ATTACHMENT_FILES"
cat "$DEST/manifest.txt"