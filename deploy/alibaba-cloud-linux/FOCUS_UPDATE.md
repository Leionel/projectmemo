# Focus Agent：ECS 开关与验收

先按 [ECS 更新命令](README.md#更新发布已部署机器) 部署已经验证并推送的完整提交，再配置本页两个开关。已有正确版本时，只需执行下面的环境更新，无需重复构建。

首次升级 Focus 时由更新脚本应用 `20261026010000_focus_conversations` 和 `20261026020000_focus_anchor_projection` 等尚未执行的迁移。开启开关前确认脚本的迁移与健康检查成功；单独修改开关不会补建表。

## 开启 Focus 与 F3 关注

在正确 ECS 的 root 终端整段执行。脚本保留其他配置，将两个开关各写成一条 `true`，保存原环境文件后重启 Web 和 Worker；检查失败时尝试恢复原配置。备份只保存在服务器 `/etc/projectmemo/focus-backup.*`，不要提交或回传环境文件。

```bash
bash <<'UPDATE'
set -Eeuo pipefail

ENV_FILE=/etc/projectmemo/projectmemo.env
NODE=/home/projectmemo/.nvm/versions/node/v24.22.0/bin/node
test "$(id -u)" = 0
test -f "$ENV_FILE"
test -x "$NODE"

exec 9>/run/lock/projectmemo-update.lock
flock -n 9 || { echo '另一个更新正在运行'; exit 1; }

# 修改前确认已有服务健康，记录期望版本
EXPECTED_RELEASE=$(curl -fsS --max-time 10 http://127.0.0.1:4400/health |
  "$NODE" -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const h=JSON.parse(s);if(h.status!=="ok"||!/^[0-9a-f]{40}$/.test(h.release))process.exit(1);console.log(h.release)})')

BACKUP=$(mktemp -d /etc/projectmemo/focus-backup.XXXXXX)
cp -a "$ENV_FILE" "$BACKUP/projectmemo.env"
TEMP_ENV=$(mktemp /etc/projectmemo/.focus-env.XXXXXX)
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
  echo "配置检查失败。备份：$BACKUP"
  exit "$code"
}
trap rollback ERR

awk '
  /^[[:space:]]*FOCUS_AGENT_ENABLED[[:space:]]*=/ { next }
  /^[[:space:]]*FOCUS_AGENT_FOLLOW_ENABLED[[:space:]]*=/ { next }
  { print }
  END {
    print ""
    print "FOCUS_AGENT_ENABLED=true"
    print "FOCUS_AGENT_FOLLOW_ENABLED=true"
  }
' "$ENV_FILE" > "$TEMP_ENV"
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

# 只检查两个开关，不输出服务完整环境
PID=$(systemctl show projectmemo -p MainPID --value)
test "$PID" -gt 0
for FLAG in FOCUS_AGENT_ENABLED FOCUS_AGENT_FOLLOW_ENABLED; do
  tr '\0' '\n' < "/proc/$PID/environ" | grep -qx "$FLAG=true"
  echo "$FLAG=true：已生效"
done
cat "$BACKUP/health.json"
printf '\n配置更新完成。备份：%s\n' "$BACKUP"
UPDATE
```

## 验证实际功能

1. 强制刷新并打开 `/focus`，应显示全局对话。若跳转到登录页，先登录自己的账号。
2. 在同一浏览器打开 `/api/conversations/capabilities`，确认 `enabled: true` 和 `followAvailable: true`。未登录请求返回 401；不要用匿名返回结果判断开关。
3. 从已有提醒、GoalQuestion 或 Impact 打开关联讨论，明确点击“关注”。普通空白聊天不会自动建立订阅，也不会因为开启开关就自动关注所有项目。
4. 在原任务有新材料、状态、成果或行动回执后，回到同一讨论读取新结果。关注同步在进入 Focus 或可见会话的轮询中触发；不承诺离开页面后持续后台推送。消息会保留原任务引用，读取结果不自动接续、批准或完成任务。
5. 验证“延后”“停止”和刷新后状态保留；只有明确读取新结果才清除对应未读。用原对象和原会话 ID 核对，避免把新建聊天当作接续。

`cloudAvailable` 取决于原 `LLM_MODE`。已配置云模型时，更新后的 Web / 鸿蒙发送区默认选中“云端分析”，说明使用本次授权项目资料，用户可关闭。仅进入页面不会调用模型；关闭后仅整理项目记录，未配置模型时显示本地整理与原因。本页不修改模型配置、不运行模型探针；后续主动发送的云模型对话仍按原凭据和额度计费。F3 当前交付为关注与原对象结果回流，不包含 D1/D2 语义发现和动态重规划。

## 关闭与恢复

需要暂停关注时，将 `/etc/projectmemo/projectmemo.env` 中唯一的 `FOCUS_AGENT_FOLLOW_ENABLED` 改为 `false` 并重启服务；需要回到旧焦点页时，同时将 `FOCUS_AGENT_ENABLED` 改为 `false`。保留原会话、关注记录和业务回执，不删除数据库表。关闭开关不等于可直接降级到旧 Prisma schema。

配置步骤失败时先看脚本恢复输出，再检查两个服务和 `/health`。如需手动恢复，选取**本次** `/etc/projectmemo/focus-backup.*` 中的原环境文件，确认之后没有需要保留的新配置，再恢复并重启。不要把整个环境文件粘贴到聊天或日志。

## 鸿蒙端没有变化

ECS 更新不会替换设备上的 ArkTS 页面。安装本次构建的 HAP，并按 [Constants.ets](../../harmonyos/entry/src/main/ets/common/Constants.ets) 核对 `BUILD_FLAVOR` 与地址：评审构建连接 HTTPS ECS，开发构建默认连接 `http://10.0.2.2:4400`。连接本机后端时，ECS 上的开关不控制该实例。

如果 DevEco 显示 `Waiting for emulator online...` 或 `Waiting for emulator ready to install timeout`，先等待模拟器完成系统启动，并确认 `hdc list targets` 能列出设备，再重新运行安装。该提示发生在安装前；先检查模拟器启动日志和宿主机内存，不先卸载 App 或清空模拟器数据。
