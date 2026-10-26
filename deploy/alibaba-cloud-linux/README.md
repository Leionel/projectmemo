# ECS 部署与运维（Alibaba Cloud Linux）

已有 ECS 的更新统一使用本文的 `bash <<'UPDATE'` 命令，从目标提交提取 `safe-update.sh` 执行。所有 Linux 命令都在你确认的 ECS 上运行；本地 SSH 配置不能用来推断生产服务器。
变量全集见 [`projectmemo.env.example`](projectmemo.env.example) 与仓库根目录 `.env.example`。

## 文件

| 文件 | 作用 |
|---|---|
| `projectmemo.service` | systemd unit（监听 127.0.0.1:4400，由 nginx 反代） |
| `projectmemo.nginx.conf` | nginx 站点配置：TLS、登录限流、小艺独立限流、转发头覆盖 |
| `projectmemo.env.example` | 生产环境变量样例 → 安装为 `/etc/projectmemo/projectmemo.env` |
| `safe-update.sh` | 已部署机器的版本校验、停服备份、构建、迁移、重启与失败恢复 |
| [Focus 更新说明](FOCUS_UPDATE.md) | F1–F3 环境开关、配置备份、重启与功能检查 |
| `backup.sh` | 数据库 + 附件备份（含完整性校验与回执清单） |
| `restore-to-copy.sh` | 恢复演练：还原成独立副本，或明确授权后覆盖线上 |
| `sqlite-tool.mjs` | 在线备份 / 校验 / 计数助手，被上面两个脚本调用 |

## 持久路径

发布新版本时**不能覆盖**这两处，否则等同于清空业务数据：

| 路径 | 内容 |
|---|---|
| `/opt/projectmemo/data/projectmemo.db` | SQLite 数据库（含 `-wal` / `-shm`） |
| `/opt/projectmemo/storage` | 附件原件（图片、PDF） |

`DATABASE_URL` 与 `ATTACHMENT_DIR` 必须指向这两个持久路径，见 `projectmemo.env.example`。
更新脚本在代码目录 `/opt/projectmemo/app` 切换固定提交，保留数据目录。systemd unit 的
`ReadWritePaths` 已经把可写范围限制在 `/opt/projectmemo/data`、`/opt/projectmemo/storage`
和 `.next/cache` 三处。

## 首次部署

`safe-update.sh` 要求机器上已有可运行版本、依赖、生成的 Prisma Client 和 `.next`，不能用于空机初始化。新机器先准备服务账号、Node.js 24、持久路径、环境文件、Web 和独立 Worker 的 systemd unit，以及 Nginx；核对实际路径后再配置首次构建与迁移。

本目录的 `projectmemo.service` 是 Web unit 样例。现有机器保留实际 unit；本目录未提供 Worker unit 安装器，不要用样例覆盖现有服务。生产环境文件只在首次安装时从样例建立，后续更新保留原凭据并按需修改具体键。

## 更新发布（已部署机器）

1. 在正确 ECS 的 root 终端执行。目标分支为 `codex/r3-runtime-research`，`TARGET` 必须填写已经验证并推送的完整 40 位提交号；下方留空时命令会停止。

   当前脚本固定核对以下部署配置。不一致时先检查实际 unit 和目标提交中的脚本，不要直接改服务路径来绕过检查。

   | 项目 | 预期值 |
   |---|---|
   | 应用目录 | `/opt/projectmemo/app` |
   | Node | `/home/projectmemo/.nvm/versions/node/v24.22.0/bin/node` |
   | 环境文件 | `/etc/projectmemo/projectmemo.env` |
   | 服务 | `projectmemo`、`projectmemo-mission-worker`，均已运行 |
   | 数据与附件 | 上节两个持久路径 |
   | 健康接口 | `http://127.0.0.1:4400/health` |

2. 填写 `TARGET` 后整段执行。临时文件使用 `mktemp`；fetch、提取或检查失败会立即停止，退出时删除临时脚本。

```bash
bash <<'UPDATE'
set -Eeuo pipefail

APP=/opt/projectmemo/app
TARGET='' # 填入本次已验证并推送的完整 40 位 commit
[[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || { echo '请先填写 TARGET'; exit 1; }
UPDATE_SCRIPT=$(mktemp /tmp/projectmemo-safe-update.XXXXXX.sh)
trap 'rm -f "$UPDATE_SCRIPT"' EXIT

sudo -H -u projectmemo git -C "$APP" fetch origin codex/r3-runtime-research

sudo -H -u projectmemo git -C "$APP" show \
  "$TARGET:deploy/alibaba-cloud-linux/safe-update.sh" > "$UPDATE_SCRIPT"

test -s "$UPDATE_SCRIPT"
bash "$UPDATE_SCRIPT" "$TARGET"
UPDATE
```

脚本先检查版本祖先关系、工作区、服务与内存，再停止 Web 和 Worker 并备份。随后切换目标提交、安装依赖、验证 SQLite 原生模块、生成 Prisma Client，执行 `next typegen` 和独立 `tsc --noEmit`，再用单 worker 构建到独立目录。构建通过后才对 `file:/opt/projectmemo/data/projectmemo.db` 执行增量迁移与完整性检查，切换构建、设置 `PROJECTMEMO_RELEASE`、启动 Web 并核对健康版本，最后启动 Worker。

默认构建堆上限为 1536 MiB。停服前要求 `MemAvailable + SwapFree` 至少为上限加 1024 MiB，停服后按实际内存收紧；独立类型检查所需下限为 1280 MiB，低内存时要求至少 3 GiB 空闲 swap 兜底。脚本不会自动增加 swap。需要调整上限时，在 `bash "$UPDATE_SCRIPT" "$TARGET"` 前加 `PROJECTMEMO_BUILD_HEAP_MB=3072`，先核对 `free -h`。

备份位于 `/opt/projectmemo/backups/web-update-<UTC时间>/`：环境文件、前一提交、数据库与附件备份，以及被替换的依赖、Prisma Client 和构建。停服后失败会尝试恢复旧代码、依赖、构建和环境，保留数据库已执行的增量迁移；查看脚本最后输出确认恢复是否成功。不要用 `db:setup`、seed 或 reset 修复生产库。

如果已经是目标提交，脚本只校验健康版本后退出，**不会重新构建、迁移或补写功能开关**。目标版本成功后仍需完成下面的环境与功能检查。

3. 核对发布结果和功能。

```bash
systemctl is-active projectmemo projectmemo-mission-worker
curl -fsS --max-time 10 http://127.0.0.1:4400/health
```

两个服务都应输出 `active`，`health.release` 应等于本次 `TARGET`。从公网检查 `/login` 可用、未登录业务 API 返回 401、`/api/settings` 返回 404，并用自己的账号登录验证业务。

## 环境开关与 Focus 验收

代码更新和功能启用是两个步骤。`safe-update.sh` 保留服务器环境配置，只更新发布指纹；它不会把仓库 `.env.example` 合并到 `/etc/projectmemo/projectmemo.env`。systemd 的环境文件只对服务进程生效，开发机 `.env` 和仅在终端 `export` 的值不改变线上服务。

| 配置 | 用途 |
|---|---|
| `FOCUS_AGENT_ENABLED=true` | 启用 `/focus` 全局对话和项目内关联会话入口 |
| `FOCUS_AGENT_FOLLOW_ENABLED=true` | 启用 F3 显式关注、延后、停止和原会话结果回流；需同时开启上一项 |
| `GOAL_CHANGE_REVIEW_ENABLED=true` | 启用原委托内D1资料变化复核与D2有界方案；先执行本轮迁移，再启用 |
| `MISSION_ENABLED=true`、`MISSION_UI_ENABLED=true` | 原长期委托及其页面入口；沿用服务器原配置，协作验收时核对 |

两个 Focus 开关默认均为 `false`，部署新代码后仍可能看到旧焦点页。按 [Focus 更新说明](FOCUS_UPDATE.md) 执行带备份的环境修改、重启和检查；已部署到目标版本时只执行该配置步骤即可。

`/health` 只证明服务状态与版本，不返回 Focus 开关。登录后访问 `/api/conversations/capabilities`，应看到 `enabled: true` 和 `followAvailable: true`。F3 的“关注”需要先从已有提醒、问题或影响打开关联讨论，再由用户明确开启；普通空白聊天不会自动关注。

ECS 更新覆盖 Web 与共享后端。鸿蒙新界面需要重新构建并安装 HAP；评审包连接 HTTPS ECS，开发包可能连接 `http://10.0.2.2:4400`。按 `Constants.ets` 核对实际构建模式与地址。

R2 相关开关见 `projectmemo.env.example`：`PROJECT_EPISODES_ENABLED`、`PROJECT_SCHEDULING_ENABLED`、
`PROJECT_REENTRY_ENABLED` 随发布启用。待办卡片的“日历提醒”依赖
`PROJECT_CALENDAR_REMINDER_ENABLED=true`；“安排时间”中的“添加到手机日历”还依赖
`PROJECT_CALENDAR_SYNC_ENABLED=true`。二者在完成目标设备的授权、冲突预览、写入、撤销和重启后状态核对前保持 `false`；开启时修改
`/etc/projectmemo/projectmemo.env` 并重启 `projectmemo`，仅修改开发机 `.env` 不影响评审 HAP 连接的 ECS。
`PROJECT_MEMORY_CONSOLIDATION_ENABLED` 同样在交互验收前保持 `false`。日历能力需要回退时，将对应开关改回
`false` 并重启，不删除已有计划与审计记录；先确认设备上的自有日程如何处置。

冒烟验收（接口需要登录态）：

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:4400/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<账号>","password":"<密码>"}' \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4400/api/projects ; echo
PROJECT_ID='<上一步返回的项目 id>'
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4400/api/projects/$PROJECT_ID/reentry ; echo
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4400/api/projects/$PROJECT_ID/episodes ; echo
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4400/api/projects/$PROJECT_ID/schedule/current ; echo
```

没有数据时这三个接口应返回结构化空态（`{"episodes":[]}`、`{"status":"EMPTY","plan":null}`），
而不是 500。

## 重启自动恢复

`enable` 决定开机自启，必须显式执行并验证，不能只看 `start` 成功：

```bash
sudo systemctl is-enabled projectmemo     # 期望 enabled
sudo systemctl restart projectmemo        # 模拟进程重启
curl -s http://127.0.0.1:4400/health      # 期望返回 release 指纹
```

`/health` 返回的 `release` 应当等于 `PROJECTMEMO_RELEASE`。它是判断"当前跑的是哪一版"
的发布指纹，部署后先看它再验证功能开关和业务接口。

真正验证开机自启需要一次重启（会短暂中断服务，请在非演示时段执行）：

```bash
sudo reboot
# 重新登录后
systemctl status projectmemo --no-pager
curl -s https://project.luojiatutor.xyz/health
```

服务起止时间（故障排查与回执需要）：

```bash
systemctl show projectmemo -p ActiveEnterTimestamp -p ExecMainStartTimestamp -p NRestarts
journalctl -u projectmemo --since "1 hour ago" --no-pager | tail -50
```

## 备份

只读源数据，只写 `BACKUP_ROOT`。数据库用 SQLite Online Backup API 取一致快照——
库处于 WAL 模式，直接 `cp projectmemo.db` 会漏掉还留在 `-wal` 里的事务。

备份根目录必须由运行账号可写。它常被 root 手动创建过，于是以服务账号运行时
`mkdir` 直接报 `Permission denied`。先确认归属并交给服务账号：

```bash
ls -ld /opt/projectmemo /opt/projectmemo/backups
sudo mkdir -p /opt/projectmemo/backups
sudo chown -R projectmemo:projectmemo /opt/projectmemo/backups
```

```bash
sudo -u projectmemo APP_DIR=/opt/projectmemo/app \
  DB_FILE=/opt/projectmemo/data/projectmemo.db \
  ATTACHMENT_DIR=/opt/projectmemo/storage \
  BACKUP_ROOT=/opt/projectmemo/backups \
  bash /opt/projectmemo/app/deploy/alibaba-cloud-linux/backup.sh
```

每次备份会在 `$BACKUP_ROOT/<UTC 时间戳>/` 下产出 `projectmemo.db`、`storage/` 与
`manifest.txt`（含 release、git commit、库 sha256、附件文件数、各表行数）。默认保留最近 14 份。

定时执行（每日 03:20，日志进 journal）：

```bash
sudo install -m 644 /dev/stdin /etc/cron.d/projectmemo-backup <<'CRON'
20 3 * * * projectmemo APP_DIR=/opt/projectmemo/app DB_FILE=/opt/projectmemo/data/projectmemo.db ATTACHMENT_DIR=/opt/projectmemo/storage BACKUP_ROOT=/opt/projectmemo/backups bash /opt/projectmemo/app/deploy/alibaba-cloud-linux/backup.sh >/dev/null 2>&1
CRON
```

## 恢复演练

**有备份文件不等于能恢复**，必须实际还原一次再声称可恢复。默认还原到独立目录，不碰线上：

```bash
sudo -u projectmemo APP_DIR=/opt/projectmemo/app \
  bash /opt/projectmemo/app/deploy/alibaba-cloud-linux/restore-to-copy.sh \
  '/opt/projectmemo/backups/<时间戳>'
```

脚本会先对备份做 `integrity_check`，再还原副本，并打印用副本起验证实例的命令。
用副本确认「登录成功、项目列表可见、抽查一条记忆与一个附件能打开」，才算演练通过。

覆盖线上数据是不可逆操作，必须同时给出两个参数，并且脚本会先自动给现有库做一份
`pre-restore-*` 快照：

```bash
sudo -u projectmemo APP_DIR=/opt/projectmemo/app \
  bash /opt/projectmemo/app/deploy/alibaba-cloud-linux/restore-to-copy.sh \
  '/opt/projectmemo/backups/<时间戳>' --in-place --confirm
sudo systemctl restart projectmemo
```

## 故障恢复速查

| 现象 | 先看什么 | 处理 |
|---|---|---|
| 新版代码已部署但仍是旧焦点页 | `/health.release`、登录后的 `/api/conversations/capabilities` | 按 [Focus 更新说明](FOCUS_UPDATE.md) 启用两个开关并重启，然后强制刷新 `/focus` |
| 没有“关注”按钮 | `followAvailable`、当前会话是否有关联提醒/问题/影响 | 核对 F3 开关，从已有提醒进入关联讨论；不向无来源的聊天自动添加关注 |
| 鸿蒙仍是旧界面 | 已安装 HAP 版本、`Constants.ets` 构建模式与后端地址 | 安装新版 HAP，核对其连接的是 ECS 还是本机后端 |
| 站点 502 | `systemctl status projectmemo`、`journalctl -u projectmemo -n 100` | 起服务；若因环境文件错误反复退出，先修 `projectmemo.env` |
| 服务反复重启 | `systemctl show projectmemo -p NRestarts` | 多为 `DATABASE_URL` 指向不存在目录或迁移未执行 |
| 登录全部 401 | `/health` 与 `npx prisma migrate deploy` | 会话表缺失或迁移未跑 |
| 附件打不开 | `ls /opt/projectmemo/storage`、`ATTACHMENT_DIR` | 附件目录未挂载或发布时被覆盖；从最近备份还原该目录 |
| 数据库损坏 | `node deploy/alibaba-cloud-linux/sqlite-tool.mjs verify <db>` | 保留损坏文件后从备份恢复，禁止直接删库重建 |
| 磁盘写满 | `df -h /opt`、`du -sh /opt/projectmemo/backups` | 清理旧备份或调小 `KEEP`；先确认最近的备份仍完整 |

`sqlite-tool.mjs` 也支持单独使用：`info <db>` 查看各表行数，`verify <db>` 做完整性校验，
`backup <源> <目标>` 取一致快照。它在应用目录下解析 `better-sqlite3`，因此
`APP_DIR` 要指向应用目录，运维机无需额外安装 `sqlite3` 命令行工具。
