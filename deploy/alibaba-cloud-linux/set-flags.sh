#!/usr/bin/env bash
# 安全修改 /etc/projectmemo/projectmemo.env 中的功能开关，然后重启 Web 与 Worker。
#
# 用法（root，在 ECS 上）：
#   bash set-flags.sh FOCUS_AGENT_R4_ENABLED=true DOCUMENT_DEEP_READ_ENABLED=true
#
# 行为与 FOCUS_UPDATE.md 中的开关步骤一致：
#   - 只接受 NAME=true|false，NAME 必须以 _ENABLED 结尾，不会写入或打印密钥；
#   - 修改前确认服务健康并记录版本，原环境文件备份到 /etc/projectmemo/flags-backup.*；
#   - 每个开关先删除旧行再追加一行，其余配置原样保留；
#   - 重启后核对健康、版本、两个服务，以及 Web 进程中这些开关的实际取值；
#   - 任一步失败时恢复原环境文件并重启。
# 不运行迁移、不更新代码。需要迁移的开关先按 README 部署对应提交。
set -Eeuo pipefail

ENV_FILE=/etc/projectmemo/projectmemo.env
NODE=/home/projectmemo/.nvm/versions/node/v24.22.0/bin/node

test "$(id -u)" = 0 || { echo '需要 root'; exit 1; }
test -f "$ENV_FILE" || { echo "找不到 $ENV_FILE"; exit 1; }
test -x "$NODE" || { echo "找不到 Node：$NODE"; exit 1; }
test "$#" -gt 0 || { echo '用法：bash set-flags.sh NAME_ENABLED=true|false ...'; exit 1; }

NAMES=()
VALUES=()
for arg in "$@"; do
  if [[ ! "$arg" =~ ^([A-Z0-9_]+_ENABLED)=(true|false)$ ]]; then
    echo "参数格式不正确：$arg（只接受 NAME_ENABLED=true|false）"
    exit 1
  fi
  NAMES+=("${BASH_REMATCH[1]}")
  VALUES+=("${BASH_REMATCH[2]}")
done

exec 9>/run/lock/projectmemo-update.lock
flock -n 9 || { echo '另一个更新正在运行'; exit 1; }

EXPECTED_RELEASE=$(curl -fsS --max-time 10 http://127.0.0.1:4400/health |
  "$NODE" -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const h=JSON.parse(s);if(h.status!=="ok"||!/^[0-9a-f]{40}$/.test(h.release))process.exit(1);console.log(h.release)})')
systemctl is-active --quiet projectmemo projectmemo-mission-worker || { echo 'Web 或 Worker 当前不是 active，先排查服务再改开关'; exit 1; }

BACKUP=$(mktemp -d /etc/projectmemo/flags-backup.XXXXXX)
cp -a "$ENV_FILE" "$BACKUP/projectmemo.env"
TEMP_ENV=$(mktemp /etc/projectmemo/.flags-env.XXXXXX)
CHANGED=0
trap 'rm -f "$TEMP_ENV"' EXIT
rollback() {
  local code=$?
  trap - ERR
  if [ "$CHANGED" = 1 ]; then
    cp -a "$BACKUP/projectmemo.env" "$ENV_FILE"
    if systemctl restart projectmemo projectmemo-mission-worker; then
      echo '已恢复原环境文件并重启，请检查原版本健康状态。'
    else
      echo '原环境文件恢复后服务重启失败，请检查 journalctl。'
    fi
  fi
  echo "开关修改失败。备份：$BACKUP"
  exit "$code"
}
trap rollback ERR

PATTERN=$(IFS='|'; echo "${NAMES[*]}")
{
  grep -Ev "^[[:space:]]*(${PATTERN})[[:space:]]*=" "$ENV_FILE" || true
  echo ""
  for i in "${!NAMES[@]}"; do
    echo "${NAMES[$i]}=${VALUES[$i]}"
  done
} > "$TEMP_ENV"
chmod --reference="$ENV_FILE" "$TEMP_ENV"
chown --reference="$ENV_FILE" "$TEMP_ENV"
CHANGED=1
mv "$TEMP_ENV" "$ENV_FILE"

systemctl restart projectmemo projectmemo-mission-worker
READY=0
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:4400/health > "$BACKUP/health.json" &&
    "$NODE" -e 'const h=require(process.argv[1]);process.exit(h.status==="ok"&&h.release===process.argv[2]?0:1)' \
      "$BACKUP/health.json" "$EXPECTED_RELEASE"; then
    READY=1
    break
  fi
  sleep 2
done
test "$READY" = 1
systemctl is-active --quiet projectmemo projectmemo-mission-worker

# 只核对本次修改的开关，不输出完整环境。Web 必须生效；Worker 若未读同一环境文件只给出提示。
for SERVICE in projectmemo projectmemo-mission-worker; do
  PID=$(systemctl show "$SERVICE" -p MainPID --value)
  test "$PID" -gt 0
  MISSING=0
  for i in "${!NAMES[@]}"; do
    tr '\0' '\n' < "/proc/$PID/environ" | grep -qx "${NAMES[$i]}=${VALUES[$i]}" || MISSING=$((MISSING + 1))
  done
  if [ "$MISSING" = 0 ]; then
    echo "$SERVICE：${#NAMES[@]} 个开关已生效"
  elif [ "$SERVICE" = projectmemo ]; then
    echo "projectmemo：有 $MISSING 个开关未生效"
    false
  else
    echo "提示：$SERVICE 有 $MISSING 个开关未在进程环境中，请确认其 unit 的 EnvironmentFile"
  fi
done
cat "$BACKUP/health.json"
printf '\n开关修改完成。备份：%s\n' "$BACKUP"
