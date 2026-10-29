#!/usr/bin/env bash
# root 执行：bash verify-p0a.sh <完整commit> --live --confirm-cost [--continue-from <原验收commit>]
# 没有 --live --confirm-cost 时只准备独立工作树并 dry run，不调用模型。
set -Eeuo pipefail
TARGET=${1:?请提供完整commit}; shift
ORIGIN=''
LIVE=0
CONFIRM=0
while (( $# )); do
  case "$1" in
    --live) LIVE=1; shift ;;
    --confirm-cost) CONFIRM=1; shift ;;
    --continue-from) ORIGIN=${2:?请提供原验收commit}; shift 2 ;;
    *) echo '支持：--live --confirm-cost [--continue-from 原验收commit]'; exit 1 ;;
  esac
done
if [[ -n "$ORIGIN" && ! "$ORIGIN" =~ ^[0-9a-f]{40}$ ]]; then echo '原验收版本必须为40位commit'; exit 1; fi
if (( LIVE != CONFIRM )); then echo '--live 与 --confirm-cost 必须同时提供'; exit 1; fi
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo '版本号必须是40位commit'; exit 1; }
[[ $(id -u) == 0 ]] || { echo '请通过sudo或root运行'; exit 1; }
NODE_BIN=/home/projectmemo/.nvm/versions/node/v24.22.0/bin
APP=/opt/projectmemo/app
VERIFY="/opt/projectmemo/evaluations/p0a-${ORIGIN:-$TARGET}"
ENV_FILE=/etc/projectmemo/projectmemo.env
as_app() { sudo -H -u projectmemo env PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" "$@"; }
test -x "$NODE_BIN/node"
test "$("$NODE_BIN/node" -p 'process.versions.node.split(".")[0]')" = 24
as_app git -C "$APP" cat-file -e "$TARGET^{commit}"
exec 9>/run/lock/projectmemo-p0a.lock
flock -n 9 || { echo '另一个真实模型验收正在运行'; exit 1; }
shopt -s nullglob
for ledger in /opt/projectmemo/evaluations/p0a-*/tmp/p0-a-live/budget.json; do
  if [[ "$ledger" != "$VERIFY/tmp/p0-a-live/budget.json" ]]; then
    echo '发现其他真实调用账本，不能创建新预算；请用 --continue-from 原验收commit，或先核对多份账本。'; exit 1
  fi
done
if [[ -n "$ORIGIN" ]]; then
  test -f "$VERIFY/tmp/p0-a-live/budget.json"
  test -f "$VERIFY/tmp/p0-a-live/results.json"
  test -f "$VERIFY/tmp/p0-a-live/evaluation.db"
  test ! -e "$VERIFY/tmp/p0-a-live/budget.json.lock"
  as_app git -C "$VERIFY" diff --quiet
  as_app git -C "$VERIFY" diff --cached --quiet
  as_app git -C "$VERIFY" merge-base --is-ancestor "$ORIGIN" HEAD
  as_app git -C "$VERIFY" merge-base --is-ancestor HEAD "$TARGET"
  as_app git -C "$VERIFY" checkout --detach "$TARGET"
fi
install -d -o projectmemo -g projectmemo -m 700 /opt/projectmemo/evaluations
if [[ ! -d "$VERIFY" ]]; then as_app git -C "$APP" worktree add --detach "$VERIFY" "$TARGET"; fi
test "$(as_app git -C "$VERIFY" rev-parse HEAD)" = "$TARGET"
as_app git -C "$VERIFY" diff --quiet
as_app git -C "$VERIFY" diff --cached --quiet
cd "$VERIFY"
if [[ ! -d node_modules ]]; then as_app npm ci --include=dev; as_app npm rebuild better-sqlite3; fi
as_app env DATABASE_URL=file:./tmp/generate-only.db npm exec prisma -- generate
MODE=()
if (( LIVE )); then MODE=(--live --confirm-cost); fi
if [[ -n "$ORIGIN" ]]; then MODE+=(--retry-failed); fi
# EnvironmentFile仅由systemd读取；不source、不打印、不把密钥放到命令行。
# runEvaluation在导入任何数据库模块前，强制切换到本工作树/tmp/p0-a-live/evaluation.db。
UNIT="projectmemo-p0a-$(date -u +%Y%m%dT%H%M%SZ)"
systemd-run --unit="$UNIT" --wait --pipe --collect \
  --property=User=projectmemo --property=Group=projectmemo \
  --property=WorkingDirectory="$VERIFY" --property=EnvironmentFile="$ENV_FILE" \
  --property=UMask=0077 --property=NoNewPrivileges=true \
  --setenv="PATH=$NODE_BIN:/usr/local/bin:/usr/bin:/bin" \
  "$NODE_BIN/node" --import tsx scripts/eval-missions.ts "${MODE[@]}" --max-requests 60 --max-cost-cny 10 --repeats 3
printf '\n独立验收目录：%s\n付费模式结果：tmp/p0-a-live/results.json 和 budget.json。\n' "$VERIFY"
