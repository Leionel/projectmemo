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
| [Focus 更新说明](FOCUS_UPDATE.md) | F1–F3 / R4 环境开关、配置备份、重启与功能检查 |
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

1. 在正确 ECS 的 root 终端执行。目标分支为 `master`，`TARGET` 必须填写已经验证并推送的完整 40 位提交号；下方留空时命令会停止。

   脚本内部同样拉取并核对 `origin/master`，不使用可能被其他 fetch 覆盖的 `FETCH_HEAD`。版本校验失败发生在停服、备份和迁移之前；此时不要恢复数据库，先核对目标提交与脚本版本。

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

sudo -H -u projectmemo git -C "$APP" fetch origin master

sudo -H -u projectmemo git -C "$APP" show \
  "$TARGET:deploy/alibaba-cloud-linux/safe-update.sh" > "$UPDATE_SCRIPT"

test -s "$UPDATE_SCRIPT"
bash "$UPDATE_SCRIPT" "$TARGET"
UPDATE
```

脚本先检查版本祖先关系、工作区、服务与内存，再停止 Web 和 Worker 并备份。随后切换目标提交、安装依赖、验证 SQLite 原生模块、生成 Prisma Client，执行 `next typegen` 和独立 `tsc --noEmit`，再用单 worker 构建到独立目录。构建通过后才对 `file:/opt/projectmemo/data/projectmemo.db` 执行增量迁移与完整性检查，切换构建、设置 `PROJECTMEMO_RELEASE`、启动 Web 并核对健康版本，最后启动 Worker。

默认构建堆上限为 3072 MiB。停服前后都要求 `MemAvailable + SwapFree` 至少为上限加 1024 MiB；物理内存不足该余量时，还要求至少 3 GiB 空闲 swap。脚本保留配置的堆上限，不再按物理内存自动调低：2026-11-01 ECS 在 1280 MiB 上限下发生了独立 TypeScript 检查 OOM，即使当时还有约 6 GiB 空闲 swap。swap 不会扩大 V8 堆上限，低内存构建也可能较慢。脚本不会自动增加 swap。需要调整上限时，在 `bash "$UPDATE_SCRIPT" "$TARGET"` 前加 `PROJECTMEMO_BUILD_HEAP_MB=4096`，先核对 `free -h`。

备份位于 `/opt/projectmemo/backups/web-update-<UTC时间>/`：环境文件、前一提交、数据库与附件备份，以及被替换的依赖、Prisma Client 和构建。停服后失败会尝试恢复旧代码、依赖、构建和环境，保留数据库已执行的增量迁移；查看脚本最后输出确认恢复是否成功。不要用 `db:setup`、seed 或 reset 修复生产库。

如果已经是目标提交，脚本只校验健康版本后退出，**不会重新构建、迁移或补写功能开关**。目标版本成功后仍需完成下面的环境与功能检查。

3. 核对发布结果和功能。

```bash
systemctl is-active projectmemo projectmemo-mission-worker
curl -fsS --max-time 10 http://127.0.0.1:4400/health
```

两个服务都应输出 `active`，`health.release` 应等于本次 `TARGET`。从公网检查 `/login` 可用、未登录业务 API 返回 401、`/api/settings` 返回 404，并用自己的账号登录验证业务。

## 低内存构建的换页策略

2026-11-01 的 ECS 在约 2 GiB RAM、6 GiB 空闲 swap 下仍触发全局 OOM；系统与当前内存组 swappiness 均为 0。新预检在依赖 swap 而策略为 0 或不可核验时拒绝更新，发生在停服前，不自动修改内核配置。

该机器使用 `safe-update-with-swap.sh <已验证并推送的40位SHA>` 包装原发布脚本：读取并保存实际执行账号的 cgroup v1 策略，临时将系统及该内存组设为 60，核验后调用同一 `safe-update.sh`；正常退出、报错和可捕捉中断时恢复原值。它不写 sysctl.conf、不改 overcommit、不创建新 swap，也不绕过备份、类型检查、迁移及回滚。不可捕捉的进程终止仍需人工核对策略。

从目标提交同时提取该包装器执行；不要执行旧 checkout 中的脚本冒充新版本。构建成功只证明工程发布，不证明真实模型、Worker 连续运行或设备交互已经验收。

## 环境开关与 Focus 验收

代码更新和功能启用是两个步骤。`safe-update.sh` 保留服务器环境配置，只更新发布指纹；它不会把仓库 `.env.example` 合并到 `/etc/projectmemo/projectmemo.env`。systemd 的环境文件只对服务进程生效，开发机 `.env` 和仅在终端 `export` 的值不改变线上服务。

| 配置 | 用途 |
|---|---|
| `FOCUS_AGENT_ENABLED=true` | 启用 `/focus` 全局对话和项目内关联会话入口 |
| `FOCUS_AGENT_FOLLOW_ENABLED=true` | 启用 F3 显式关注、延后、停止和原会话结果回流；需同时开启上一项 |
| `GOAL_CHANGE_REVIEW_ENABLED=true` | 启用原委托内D1资料变化复核与D2有界方案；先执行本轮迁移，再启用 |
| `FOCUS_AGENT_R4_ENABLED=true` | 启用云端动态调查、目标差距与 Web 语义回答；与 Focus 同时开启 |
| `MISSION_ENABLED=true`、`MISSION_UI_ENABLED=true` | 原长期委托及其页面入口；沿用服务器原配置，协作验收时核对 |

Focus、关注、变化复核和 R4 调查四个开关默认均为 `false`，部署新代码后仍可能看到旧焦点页。按 [Focus 更新说明](FOCUS_UPDATE.md) 执行带备份的环境修改、重启和检查；已部署到目标版本时只执行该配置步骤即可。

`/health` 只证明服务状态与版本，不返回 Focus 开关。登录后访问 `/api/conversations/capabilities`，核对 `enabled`、`followAvailable`、`changeReviewAvailable`、`r4Available` 四项。F3 的“关注”需要先从已有提醒、问题或影响打开关联讨论，再由用户明确开启；普通空白聊天不会自动关注。

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

## 账号邮件（注册、找回密码、委托等待提醒）

没有发信配置时，注册、找回密码和邮箱验证全部关闭（接口返回 `ACCOUNT_MAIL_UNAVAILABLE`），只有已有账号能登录。代码已支持 Resend HTTPS API 和 SMTP 两种方式，**推荐 Resend**：走 443 端口，不受阿里云默认封禁 25 端口的影响。

1. **在 Resend 验证发信域名。** 添加 `mail.luojiatutor.xyz`，把 Resend 给出的 SPF（TXT/MX）和 DKIM（TXT）记录加到该域名的 DNS，等待状态变为 Verified。`AUTH_EMAIL_FROM` 的域名必须与已验证域名一致。
2. **创建 API Key。** 权限选 Sending access，限定到该域名。Key 只写进服务器环境文件，不进仓库、回执或聊天记录。
3. **写入 `/etc/projectmemo/projectmemo.env`**（先备份；每个键只保留一行）：

```bash
cp -a /etc/projectmemo/projectmemo.env /etc/projectmemo/projectmemo.env.bak-$(date -u +%Y%m%dT%H%M%SZ)
vi /etc/projectmemo/projectmemo.env
# AUTH_MAIL_TRANSPORT=resend
# AUTH_PUBLIC_BASE_URL=https://project.luojiatutor.xyz   # 生产必须 https，且不带路径
# AUTH_EMAIL_FROM="忆程 <no-reply@mail.luojiatutor.xyz>"
# RESEND_API_KEY=re_xxx
```

   用 SMTP 时改为 `AUTH_MAIL_TRANSPORT=smtp`，并填写 `SMTP_HOST`、`SMTP_PORT`（默认 465）、`SMTP_SECURE`、`SMTP_USER`、`SMTP_PASSWORD`。阿里云 ECS 只能用 465 或 587 端口。

4. **发一封测试邮件。** 测试脚本在独立的 systemd 单元里读取生产环境文件，不会把密钥打印出来，也不会创建账号：

```bash
cd /opt/projectmemo/app
systemd-run --wait --pipe --collect \
  --property=User=projectmemo --property=Group=projectmemo \
  --property=WorkingDirectory=/opt/projectmemo/app \
  --property=EnvironmentFile=/etc/projectmemo/projectmemo.env \
  --setenv=PATH=/home/projectmemo/.nvm/versions/node/v24.22.0/bin:/usr/bin:/bin \
  /home/projectmemo/.nvm/versions/node/v24.22.0/bin/node --import tsx scripts/test-account-mail.ts --to <你控制的邮箱>
```

5. **重启并核对。**

```bash
systemctl restart projectmemo && systemctl restart projectmemo-mission-worker
curl -s https://project.luojiatutor.xyz/api/auth/capabilities ; echo   # 期望两项都为 true
```

   然后用一个新邮箱走一遍注册 → 收验证邮件 → 点链接 → 登录，再用同一邮箱试一次“找回密码”。

6. **委托等待提醒（可选）。** 上面几步通过后，才开启 `bash set-flags.sh MISSION_WAIT_EMAIL_ENABLED=true`。开启后 Worker 会在委托等你回答或批准时，给已验证邮箱发一封邮件：同一次等待只发一封，遵守静默时段和每日预算，邮件只含项目名和回到忆程的链接。这属于真实外部发信，开启前确认收件范围。

邮件发不出时，接口只返回“暂时无法发出”，不暴露服务商报错。到 Resend 控制台的 Logs 查看具体原因，最常见的是域名未验证，或 From 与已验证域名不一致。

## 上传大小与等待时间（nginx）

应用内上传上限为 100MB，项目前理解最多等待模型 110 秒。`safe-update.sh` 不改 nginx，需要在 `location ^~ /api/` 中手动设置：

```nginx
client_max_body_size 100m;
proxy_read_timeout 120s;
```

修改前先备份实际配置，再执行 `nginx -t && systemctl reload nginx`。

## 模型状态显示（nginx 与静态页）

服务器已配置模型，界面却显示“演示模式 / Mock / 规则模式”，有两个原因，都已在代码里修好，但需要部署：

- **nginx 原先把 `/api/settings` 整个返回 404。** Web 设置页和鸿蒙“模型与连接”都靠这个只读接口判断是否已接入模型。读取失败后，它们回退到默认的 mock 显示。新版 `projectmemo.nginx.conf` 只对 `/api/settings` 放行 GET；修改接口和 `/api/settings/probe` 仍返回 404，生产环境应用本身也拒绝 POST。`safe-update.sh` 不改 nginx，需要手动更新：

```bash
cp -a /etc/nginx/conf.d/projectmemo.conf /etc/nginx/conf.d/projectmemo.conf.bak-$(date -u +%Y%m%dT%H%M%SZ)   # 按实际文件名
# 用仓库 deploy/alibaba-cloud-linux/projectmemo.nginx.conf 中的两个 /api/settings location 替换原来那一段
nginx -t && systemctl reload nginx
curl -s https://project.luojiatutor.xyz/api/settings ; echo                          # 期望 {"llmMode":"openai-compatible",...}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://project.luojiatutor.xyz/api/settings   # 期望 403
```

- **构建时不加载生产环境文件**，`/login` 等静态页曾把“演示模式”和“注册关闭”固化进 HTML。现在根布局改为按请求渲染，新版本部署后即可生效。

## 故障恢复速查

| 现象 | 先看什么 | 处理 |
|---|---|---|
| 新版代码已部署但仍是旧焦点页 | `/health.release`、登录后的 `/api/conversations/capabilities` | 按 [Focus 更新说明](FOCUS_UPDATE.md) 核对四个开关并重启，然后强制刷新 `/focus` |
| 没有“关注”按钮 | `followAvailable`、当前会话是否有关联提醒/问题/影响 | 核对 F3 开关，从已有提醒进入关联讨论；不向无来源的聊天自动添加关注 |
| 鸿蒙仍是旧界面 | 已安装 HAP 版本、`Constants.ets` 构建模式与后端地址 | 安装新版 HAP，核对其连接的是 ECS 还是本机后端 |
| 站点 502 | `systemctl status projectmemo`、`journalctl -u projectmemo -n 100` | 起服务；若因环境文件错误反复退出，先修 `projectmemo.env` |
| 服务反复重启 | `systemctl show projectmemo -p NRestarts` | 多为 `DATABASE_URL` 指向不存在目录或迁移未执行 |
| 登录全部 401 | `/health` 与 `npx prisma migrate deploy` | 会话表缺失或迁移未跑 |
| 删除项目失败，或“问忆程”上传附件报错 | `migrate status`（命令见下方“讨论附件迁移”） | 缺 `ConversationAttachment` 表：讨论附件迁移未执行。删除项目会去这张表找附件原件，所以缺表时删除项目也会失败；先备份再 `migrate deploy` |
| 注册 / 找回密码提示“邮件服务尚未配置” | `/api/auth/capabilities` | 按“账号邮件”一节配置发信，重启 Web 与 Worker |
| 已配置模型，界面仍显示演示模式 / 规则模式 | `curl https://project.luojiatutor.xyz/api/settings` | 返回 nginx 404 时，按“模型状态显示”一节更新 nginx |
| 附件打不开 | `ls /opt/projectmemo/storage`、`ATTACHMENT_DIR` | 附件目录未挂载或发布时被覆盖；从最近备份还原该目录 |
| 数据库损坏 | `node deploy/alibaba-cloud-linux/sqlite-tool.mjs verify <db>` | 保留损坏文件后从备份恢复，禁止直接删库重建 |
| 磁盘写满 | `df -h /opt`、`du -sh /opt/projectmemo/backups` | 清理旧备份或调小 `KEEP`；先确认最近的备份仍完整 |

### 讨论附件迁移（2026-11 起）

`20261104220000_conversation_attachment` 新建 `ConversationAttachment` 表，存放“仅用于本次讨论”的附件；只新建表，不改已有数据。删除项目的流程会读取这张表清理附件原件，因此**这张表缺失时，删除项目也会失败**，不只是附件功能不可用。

- 用 `safe-update.sh` 更新到包含该迁移的提交时，脚本会在构建通过后自动执行 `migrate deploy`，然后才启动服务，无需手动迁移。
- 以下情况不会自动迁移，需要手动核对：机器已经是目标提交（脚本只校验健康状态后退出）；或者没用 `safe-update.sh`，手动拉代码、手动构建。
- 更新后核对迁移状态（只读）：

```bash
cd /opt/projectmemo/app
sudo -H -u projectmemo env DATABASE_URL=file:/opt/projectmemo/data/projectmemo.db npm exec prisma -- migrate status
sudo -H -u projectmemo env APP_DIR=/opt/projectmemo/app node deploy/alibaba-cloud-linux/sqlite-tool.mjs info /opt/projectmemo/data/projectmemo.db | grep ConversationAttachment
```

- 如果显示有未执行的迁移，先停服、备份，再迁移、启动（与 `safe-update.sh` 的顺序一致）：

```bash
systemctl stop projectmemo-mission-worker projectmemo
sudo -H -u projectmemo env DB_FILE=/opt/projectmemo/data/projectmemo.db ATTACHMENT_DIR=/opt/projectmemo/storage   BACKUP_ROOT=/opt/projectmemo/backups/manual-migrate-$(date -u +%Y%m%dT%H%M%SZ) KEEP=0 bash deploy/alibaba-cloud-linux/backup.sh
sudo -H -u projectmemo env DATABASE_URL=file:/opt/projectmemo/data/projectmemo.db npm exec prisma -- migrate deploy
systemctl start projectmemo && systemctl start projectmemo-mission-worker
```

- 迁移后验收：在“问忆程”里各上传一次附件（选“仅用于本次讨论”和“加入项目记忆”各一次）。删除项目只用新建的测试项目验证，不要拿真实项目试。

`sqlite-tool.mjs` 也支持单独使用：`info <db>` 查看各表行数，`verify <db>` 做完整性校验，
`backup <源> <目标>` 取一致快照。它在应用目录下解析 `better-sqlite3`，因此
`APP_DIR` 要指向应用目录，运维机无需额外安装 `sqlite3` 命令行工具。
