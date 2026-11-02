#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 ]] || { echo '请在 ECS root 终端执行'; exit 1; }
exec 8>/run/lock/projectmemo-swap-update.lock
flock -n 8 || { echo '另一个临时 swap 更新正在运行'; exit 1; }

APP=/opt/projectmemo/app
TARGET=${1:?请提供已验证并推送的40位目标提交}
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo '目标提交必须为40位SHA'; exit 1; }
OLD_VM=$(sysctl -n vm.swappiness)
CG_REL=$(sudo -H -u projectmemo awk -F: '$2=="memory" {print $3}' /proc/self/cgroup)
[[ "$CG_REL" == /* && "$CG_REL" != / ]] || { echo '当前内存组与已诊断环境不同，停止'; exit 1; }
CG_FILE="/sys/fs/cgroup/memory${CG_REL}/memory.swappiness"
[[ -r "$CG_FILE" && -w "$CG_FILE" ]] || { echo '无法读取或调整当前内存组，停止'; exit 1; }
OLD_CG=$(cat "$CG_FILE")
UPDATE_SCRIPT=$(mktemp /tmp/projectmemo-safe-update.XXXXXX.sh)

cleanup() {
  local result=$?
  trap - EXIT
  set +e
  if ! printf '%s\n' "$OLD_CG" > "$CG_FILE"; then
    echo "警告：未能恢复 $CG_FILE 为 $OLD_CG" >&2
    result=1
  fi
  if ! sysctl -q -w "vm.swappiness=$OLD_VM"; then
    echo "警告：未能恢复 vm.swappiness 为 $OLD_VM" >&2
    result=1
  fi
  rm -f "$UPDATE_SCRIPT"
  printf '恢复目标：vm.swappiness=%s，当前内存组=%s；实际读取如下：\n' "$OLD_VM" "$OLD_CG"
  sysctl vm.swappiness
  cat "$CG_FILE"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

sudo -H -u projectmemo git -C "$APP" fetch origin master
sudo -H -u projectmemo git -C "$APP" show \
  "$TARGET:deploy/alibaba-cloud-linux/safe-update.sh" > "$UPDATE_SCRIPT"
test -s "$UPDATE_SCRIPT"
bash -n "$UPDATE_SCRIPT"

sysctl -w vm.swappiness=60
printf '60\n' > "$CG_FILE"
[[ $(sysctl -n vm.swappiness) == 60 && $(cat "$CG_FILE") == 60 ]]
echo '临时换页策略已生效；构建可能较慢，请等待完整结果。'
PROJECTMEMO_BUILD_HEAP_MB=3072 bash "$UPDATE_SCRIPT" "$TARGET"

systemctl is-active projectmemo projectmemo-mission-worker
curl -fsS --max-time 10 http://127.0.0.1:4400/health
