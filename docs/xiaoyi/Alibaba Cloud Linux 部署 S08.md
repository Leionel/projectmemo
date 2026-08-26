# 在香港 ECS 部署 ProjectMemo S08 适配层

这份跟做教程把 `project.luojiatutor.xyz` 部署成 ProjectMemo 的受控公网入口。完成后，小艺工作流可以调用 `record_memory`，DevEco 模拟器可以从同一云端数据库读取新卡片。

当前只交付 S08 的第一条纵向链路。它通过后，再复用同一鉴权和审计模块增加其他工具。

## 完成标准

部署结束后，你应得到以下可复核结果：

```text
小艺/手工请求 request_id
  → HTTPS 适配层
  → 固定测试项目
  → 一张 KnowledgeCard
  → 一个 xiaoyi-workflow AgentRun
  → DevEco 模拟器显示同一 card_id
```

相同 `request_id` 重试时，接口返回第一次的 `card_id`，不重复创建卡片。

## 开始前检查

开始部署前，确认以下条件：

- `project.luojiatutor.xyz` 的 A 记录已经指向香港 ECS 公网 IP；
- ECS 安全组开放 `80`、`443`，并只向你的公网 IP 开放 `22`；
- ECS 的 `4400` 端口没有向公网开放；
- 你可以使用具有 `sudo` 权限的账号登录 ECS；
- 当前代码已经包含 `app/xiaoyi/v1/memories/route.ts` 和迁移 `20260826000000_xiaoyi_adapter_receipts`。

在 ECS 上检查系统版本：

```bash
cat /etc/os-release
```

本教程以 Alibaba Cloud Linux 3 为准。如果 `VERSION_ID` 以 `2` 开头，先升级或更换为 Alibaba Cloud Linux 3；不要继续执行 Node.js 22 部署。

## 第 1 步：安装系统依赖

在 Alibaba Cloud Linux 3 中安装 Git、Nginx、OpenSSL 和 SQLite：

```bash
sudo dnf install -y git nginx openssl sqlite
sudo systemctl enable --now nginx
```

验证 Nginx：

```bash
curl -I http://127.0.0.1
```

## 第 2 步：创建服务账号和持久化目录

创建不允许密码登录的 `projectmemo` 服务账号：

```bash
sudo useradd --create-home --shell /bin/bash projectmemo
sudo passwd -l projectmemo
sudo mkdir -p /opt/projectmemo/app /opt/projectmemo/data /opt/projectmemo/storage
sudo mkdir -p /etc/projectmemo /etc/nginx/certs
sudo chown -R projectmemo:projectmemo /opt/projectmemo
sudo chmod 700 /opt/projectmemo/data /opt/projectmemo/storage /etc/projectmemo /etc/nginx/certs
```

## 第 3 步：安装 Node.js 22

以 `projectmemo` 身份安装固定版本的 NVM 和 Node.js：

```bash
sudo -iu projectmemo
git clone --branch v0.40.6 --depth 1 https://github.com/nvm-sh/nvm.git /home/projectmemo/.nvm
source /home/projectmemo/.nvm/nvm.sh
nvm install 22.22.3
nvm alias default 22.22.3
node --version
npm --version
exit
```

`node --version` 应输出 `v22.22.3`。当前 Next.js 依赖要求 Node.js `>=20.9.0`。

## 第 4 步：上传并构建代码

在本地先提交或冻结包含 S08 适配层的版本，再把该版本上传到 ECS。不要把本机 `.env`、数据库、`node_modules`、测试截图或 API Key 上传到仓库。

如果使用 GitHub，在 ECS 上执行：

```bash
sudo -iu projectmemo
git clone https://github.com/Leionel/projectmemo.git /opt/projectmemo/app
cd /opt/projectmemo/app
git checkout REPLACE_WITH_VERIFIED_COMMIT
source /home/projectmemo/.nvm/nvm.sh
nvm use 22.22.3
npm ci
npx prisma generate
exit
```

`REPLACE_WITH_VERIFIED_COMMIT` 必须替换为本地测试通过后的提交哈希，不能直接部署一个会继续变化的分支头。

## 第 5 步：生成适配层令牌

在 ECS 上生成 64 位十六进制令牌：

```bash
openssl rand -hex 32
```

只把输出复制到服务器环境文件和小艺插件的鉴权配置中。不要把真实令牌写进仓库、截图或聊天记录。

复制环境文件模板：

```bash
sudo cp /opt/projectmemo/app/deploy/alibaba-cloud-linux/projectmemo.env.example /etc/projectmemo/projectmemo.env
sudo chmod 600 /etc/projectmemo/projectmemo.env
sudo vi /etc/projectmemo/projectmemo.env
```

至少替换：

```dotenv
XIAOYI_ADAPTER_TOKEN=刚生成的令牌
XIAOYI_TEST_PROJECT_ID=固定测试项目ID
```

第一轮可保留 `LLM_MODE=mock` 验证网络和写入链路，但这不能算 S03 真实模型通过。准备 S08 正式证据前，再配置真实模型并单独通过 S03/S04 Gate。

## 第 6 步：初始化数据库并构建生产版本

首次部署时加载服务器环境变量并执行迁移：

```bash
sudo -iu projectmemo
cd /opt/projectmemo/app
source /home/projectmemo/.nvm/nvm.sh
set -a
source /etc/projectmemo/projectmemo.env
set +a
npx tsx scripts/ensure-db.ts
npx prisma migrate deploy
npx tsx prisma/seed.ts
npm run build
exit
```

查看可绑定的测试项目 ID：

```bash
sudo sqlite3 /opt/projectmemo/data/projectmemo.db 'SELECT id, title FROM Project;'
```

如果第 5 步还没有真实项目 ID，把目标 ID 写入 `/etc/projectmemo/projectmemo.env` 后再继续。

## 第 7 步：启动 ProjectMemo 服务

安装并启动 systemd 服务：

```bash
sudo cp /opt/projectmemo/app/deploy/alibaba-cloud-linux/projectmemo.service /etc/systemd/system/projectmemo.service
sudo systemctl daemon-reload
sudo systemctl enable --now projectmemo
sudo systemctl status projectmemo --no-pager
```

验证 Next.js 只监听本机回环：

```bash
sudo ss -lntp | grep 4400
curl http://127.0.0.1:4400/health
```

预期响应包含：

```json
{"status":"ok","service":"projectmemo"}
```

## 第 8 步：部署 HTTPS 证书

在阿里云数字证书管理服务中，为 `project.luojiatutor.xyz` 申请证书并下载 Nginx 格式文件。把证书和私钥上传为：

```text
/etc/nginx/certs/project.luojiatutor.xyz.pem
/etc/nginx/certs/project.luojiatutor.xyz.key
```

限制私钥权限：

```bash
sudo chown root:root /etc/nginx/certs/project.luojiatutor.xyz.pem /etc/nginx/certs/project.luojiatutor.xyz.key
sudo chmod 600 /etc/nginx/certs/project.luojiatutor.xyz.pem /etc/nginx/certs/project.luojiatutor.xyz.key
```

## 第 9 步：配置 Nginx 公网边界

先在本机浏览器访问 `https://ifconfig.me` 或使用可信网络工具确认你的当前公网 IPv4。打开模板，把 `REPLACE_WITH_YOUR_PUBLIC_IP` 替换为该 IP：

```bash
sudo cp /opt/projectmemo/app/deploy/alibaba-cloud-linux/projectmemo.nginx.conf /etc/nginx/conf.d/projectmemo.conf
sudo vi /etc/nginx/conf.d/projectmemo.conf
sudo nginx -t
sudo systemctl reload nginx
```

这个配置执行以下限制：

| 路径 | 访问规则 |
|---|---|
| `/health` | 公网可读，只返回健康状态 |
| `/xiaoyi/v1/*` | 公网可达，应用层必须验证 Bearer Token |
| `/api/settings*` | 公网始终返回 404 |
| `/api/*` | 只允许你当前公网 IP，用于 DevEco 模拟器对照 |
| 其他路径 | 返回 404 |

验证 HTTPS：

```bash
curl -i https://project.luojiatutor.xyz/health
```

## 第 10 步：手工验证 `record_memory`

在你自己的电脑上设置临时变量。不要把令牌直接写入命令历史：

```powershell
$env:PROJECTMEMO_XIAOYI_TOKEN = Read-Host -MaskInput "Xiaoyi adapter token"
$requestId = "manual-" + [guid]::NewGuid().ToString()
$headers = @{
  Authorization = "Bearer $env:PROJECTMEMO_XIAOYI_TOKEN"
  "Idempotency-Key" = $requestId
}
$body = @{ content = "记录一下：香港 ECS 的 S08 HTTPS 链路已经打通。" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://project.luojiatutor.xyz/xiaoyi/v1/memories" -Headers $headers -ContentType "application/json" -Body $body
```

保存返回的 `request_id`、`agent_run_id` 和 `card_id`。用同一个 `$requestId` 再发一次，响应应为：

```json
{"replayed":true}
```

第二次调用的 `card_id` 和 `agent_run_id` 必须与第一次相同。

## 第 11 步：让 DevEco 模拟器读取云端数据

在演示构建中，把 `Constants.BASE_URL` 临时改为：

```text
https://project.luojiatutor.xyz
```

重新构建并安装 App。因为 Nginx 只允许你的公网 IP 访问 `/api/*`，模拟器必须通过同一台开发电脑联网。如果网络出口 IP 改变，先更新 Nginx allowlist，再运行 `nginx -t` 和 `systemctl reload nginx`。

刷新 Memory 页面，确认 App 显示第 10 步返回的同一 `card_id`。这一步只证明 DevEco 模拟器与云端 Backend 的一致性；真机小艺入口仍保持 `UNVERIFIED`。

## 第 12 步：配置小艺插件节点

在小艺开放平台的云插件中配置：

| 字段 | 值 |
|---|---|
| 工具名 | `record_memory` |
| 方法 | `POST` |
| 地址 | `https://project.luojiatutor.xyz/xiaoyi/v1/memories` |
| 请求体 | `content`、稳定的 `request_id` |
| 鉴权 | `Authorization: Bearer <XIAOYI_ADAPTER_TOKEN>`，仅在平台支持该方式时使用 |
| 成功字段 | `card_id`、`title`、`summary`、`agent_run_id`、`request_id` |

如果控制台不支持固定 Bearer Token，不要关闭服务端鉴权。截取“插件鉴权方式”和“请求头配置”区域（遮住真实值），再按平台支持的方式改造 `lib/xiaoyi/auth.ts`。

## 回滚

如果公网接口出现异常，先关闭适配层，不删除数据库：

```bash
sudo sed -i 's/^XIAOYI_ADAPTER_ENABLED=true$/XIAOYI_ADAPTER_ENABLED=false/' /etc/projectmemo/projectmemo.env
sudo systemctl restart projectmemo
```

关闭后 `/xiaoyi/v1/*` 返回 `503 XIAOYI_ADAPTER_DISABLED`，App 的本地模拟器路线不受影响。

## 下一步

- 保存手工调用、`AgentRun` 和模拟器同卡片 ID 的三方回执，完成 T02 tracer bullet。
- 在插件控制台完成一次真实 `record_memory` 调用，替换手工请求证据。
- 通过第一条链路后，复用鉴权、固定项目映射和幂等回执实现 `query_memory` 与 `inspect_project`。
- 最后实现 `prepare_action`/`commit_action`，完成 20 轮 S08 对照测试。
