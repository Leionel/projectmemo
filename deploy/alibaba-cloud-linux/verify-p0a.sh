#!/usr/bin/env bash
# root 执行：bash verify-p0a.sh <完整commit> --live --confirm-cost
# 没有 --live --confirm-cost 时只准备独立工作树并 dry run，不调用模型。
set -Eeuo pipefail
TARGET=${1:?请提供完整commit}; shift
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo '版本号必须是40位commit'; exit 1; }
[[ $(id -u) == 0 ]] || { echo '请通过sudo或root运行'; exit 1; }
NODE_BIN=/home/projectmemo/.nvm/versions/node/v24.22.0/bin
APP=/opt/projectmemo/app
VERIFY="/opt/projectmemo/evaluations/p0a-$TARGET"
ENV_FILE=/etc/projectmemo/projectmemo.env
as_app() { sudo -H -u projectmemo env PATH="$NODE_BIN:/usr/local/bin:/usr/bin:/bin" "$@"; }
test -x "$NODE_BIN/node"
test "$("$NODE_BIN/node" -p 'process.versions.node.split(".")[0]')" = 24
as_app git -C "$APP" cat-file -e "$TARGET^{commit}"
install -d -o projectmemo -g projectmemo -m 700 /opt/projectmemo/evaluations
if [[ ! -d "$VERIFY" ]]; then as_app git -C "$APP" worktree add --detach "$VERIFY" "$TARGET"; fi
test "$(as_app git -C "$VERIFY" rev-parse HEAD)" = "$TARGET"
as_app git -C "$VERIFY" diff --quiet
as_app git -C "$VERIFY" diff --cached --quiet
cd "$VERIFY"
if [[ ! -d node_modules ]]; then as_app npm ci --include=dev; as_app npm rebuild better-sqlite3; fi
as_app env DATABASE_URL=file:./tmp/generate-only.db npm exec prisma -- generate
if (( $# == 0 )); then
  MODE=()
elif [[ $# == 2 && "$1" == --live && "$2" == --confirm-cost ]]; then
  MODE=(--live --confirm-cost)
else echo '只支持无参数dry run，或 --live --confirm-cost'; exit 1; fi
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
