# ECS 部署与运维（Alibaba Cloud Linux）

本目录是**部署样例**，不是自动安装器：所有命令都需要在目标机器上按实际情况执行。
变量全集见 [`projectmemo.env.example`](projectmemo.env.example) 与仓库根目录 `.env.example`。

## 文件

| 文件 | 作用 |
|---|---|
| `projectmemo.service` | systemd unit（监听 127.0.0.1:4400，由 nginx 反代） |
| `projectmemo.nginx.conf` | nginx 站点配置：TLS、登录限流、小艺独立限流、转发头覆盖 |
| `projectmemo.env.example` | 生产环境变量样例 → 安装为 `/etc/projectmemo/projectmemo.env` |
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
代码目录 `/opt/projectmemo/app` 可以整体替换；数据目录不可以。systemd unit 的
`ReadWritePaths` 已经把可写范围限制在 `/opt/projectmemo/data`、`/opt/projectmemo/storage`
和 `.next/cache` 三处。

## 首次部署

```bash
sudo useradd --system --home /opt/projectmemo --shell /usr/sbin/nologin projectmemo
sudo mkdir -p /opt/projectmemo/{app,data,storage,backups} /etc/projectmemo
sudo chown -R projectmemo:projectmemo /opt/projectmemo

# 1. 代码与依赖
sudo -u projectmemo git clone <repo> /opt/projectmemo/app
cd /opt/projectmemo/app && sudo -u projectmemo npm ci
sudo -u projectmemo npx prisma generate
sudo -u projectmemo npm run build

# 2. 环境文件（权限收紧，内含小艺 Token）
sudo install -m 600 -o root -g projectmemo projectmemo.env.example /etc/projectmemo/projectmemo.env
sudo editor /etc/projectmemo/projectmemo.env   # 填 PROJECTMEMO_RELEASE / XIAOYI_ADAPTER_TOKEN / XIAOYI_TEST_PROJECT_ID

# 3. 迁移（先核对目标库，不要对已有数据的库盲跑 db:setup）
sudo -u projectmemo npx prisma migrate deploy

# 4. 服务
sudo install -m 644 projectmemo.service /etc/systemd/system/projectmemo.service
sudo systemctl daemon-reload
sudo systemctl enable --now projectmemo

# 5. nginx
sudo install -m 644 projectmemo.nginx.conf /etc/nginx/conf.d/projectmemo.conf
sudo nginx -t && sudo systemctl reload nginx
```

## 重启自动恢复

`enable` 决定开机自启，必须显式执行并验证，不能只看 `start` 成功：

```bash
sudo systemctl is-enabled projectmemo     # 期望 enabled
sudo systemctl restart projectmemo        # 模拟进程重启
curl -s http://127.0.0.1:4400/health      # 期望返回 release 指纹
```

`/health` 返回的 `release` 应当等于 `PROJECTMEMO_RELEASE`。它是判断"当前跑的是哪一版"
的唯一依据，部署后先看它再看业务接口。

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
  /opt/projectmemo/backups/<时间戳>
```

脚本会先对备份做 `integrity_check`，再还原副本，并打印用副本起验证实例的命令。
用副本确认「登录成功、项目列表可见、抽查一条记忆与一个附件能打开」，才算演练通过。

覆盖线上数据是不可逆操作，必须同时给出两个参数，并且脚本会先自动给现有库做一份
`pre-restore-*` 快照：

```bash
sudo -u projectmemo APP_DIR=/opt/projectmemo/app \
  bash /opt/projectmemo/app/deploy/alibaba-cloud-linux/restore-to-copy.sh \
  /opt/projectmemo/backups/<时间戳> --in-place --confirm
sudo systemctl restart projectmemo
```

## 故障恢复速查

| 现象 | 先看什么 | 处理 |
|---|---|---|
| 站点 502 | `systemctl status projectmemo`、`journalctl -u projectmemo -n 100` | 起服务；若因环境文件错误反复退出，先修 `projectmemo.env` |
| 服务反复重启 | `systemctl show projectmemo -p NRestarts` | 多为 `DATABASE_URL` 指向不存在目录或迁移未执行 |
| 登录全部 401 | `/health` 与 `npx prisma migrate deploy` | 会话表缺失或迁移未跑 |
| 附件打不开 | `ls /opt/projectmemo/storage`、`ATTACHMENT_DIR` | 附件目录未挂载或发布时被覆盖；从最近备份还原该目录 |
| 数据库损坏 | `node deploy/alibaba-cloud-linux/sqlite-tool.mjs verify <db>` | 保留损坏文件后从备份恢复，禁止直接删库重建 |
| 磁盘写满 | `df -h /opt`、`du -sh /opt/projectmemo/backups` | 清理旧备份或调小 `KEEP`；先确认最近的备份仍完整 |

`sqlite-tool.mjs` 也支持单独使用：`info <db>` 查看各表行数，`verify <db>` 做完整性校验，
`backup <源> <目标>` 取一致快照。它在应用目录下解析 `better-sqlite3`，因此
`APP_DIR` 要指向应用目录，运维机无需额外安装 `sqlite3` 命令行工具。