# 在香港 ECS 部署 ProjectMemo S08 适配层

这份跟做教程把 `project.luojiatutor.xyz` 部署成 ProjectMemo 的受控公网入口。完成后，小艺工作流可以调用 `record_memory`、`query_memory`、`inspect_project` 和 `create_action`，并先通过内部辅助路由 `begin_request` 取得一次运行内的关联 ID；DevEco 模拟器可以从同一云端数据库读取结果。

当前本地代码已经交付四条 S08 业务路由和一条不写业务数据的 `begin_request` 辅助路由；公网是否实际具备这些能力，以 `/health` 版本指纹和 `verify:w03-public` 的结果为准，不能只看域名能否打开。

## 完成标准

部署结束后，你应得到以下可复核结果：

```text
小艺工作流
  → begin_request（仅 Bearer，返回 request_id）
  → 四项业务工具复用同一 request_id
  → HTTPS 适配层
  → 固定测试项目
  → 一张 KnowledgeCard
  → 一个 xiaoyi-workflow AgentRun
  → DevEco 模拟器显示同一 card_id
```

相同 `request_id` 重试时，接口返回第一次的 `card_id`，不重复创建卡片。

`begin_request` 只保证一次工作流运行内的关联；整轮工作流重试会重新生成 UUID，不能替代跨整轮重试的幂等键。手工调用四项业务路由时，仍需由调用方显式提供稳定的 `request_id`。

如果 ECS 已经能打开 `/health`，但新增工具返回 HTML 404，说明服务器仍在运行旧提交。先完成“更新已有 ECS”一节，再继续平台调试。

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

## 更新已有 ECS

如果你已经完成首次部署，请用同一个已验证提交更新代码、迁移和版本指纹。以下过程不会自动丢弃服务器上的未提交修改；发现脏工作区时会停下。

1. 在本地通过回归后，记录准备部署的提交：

   ```powershell
   git rev-parse HEAD
   npm.cmd test
   npm.cmd run build
   npm.cmd run verify:s08-adapter
   ```

2. 在 ECS 上检查工作区：

   ```bash
   sudo -iu projectmemo
   cd /opt/projectmemo/app
   git status --short
   ```

   如果命令输出任何内容，停止更新并先确认这些文件的来源。不要运行 `git reset --hard`。

3. 在工作区干净时，检出步骤 1 的提交：

   ```bash
   git fetch origin --prune
   git checkout --detach REPLACE_WITH_VERIFIED_COMMIT
   source /home/projectmemo/.nvm/nvm.sh
   nvm use 22.22.3
   npm ci
   exit
   ```

4. 编辑 `/etc/projectmemo/projectmemo.env`，把版本指纹设为同一个提交，并确认 2.1 功能开关：

   ```dotenv
   PROJECTMEMO_RELEASE=REPLACE_WITH_VERIFIED_COMMIT
   TEMPORAL_MEMORY_ENABLED=true
   EVIDENCE_TRUST_RECEIPT_ENABLED=true
   XIAOYI_ADAPTER_ENABLED=true
   ```

   已有 ECS 不要再次复制环境模板，否则可能覆盖真实 Token 和固定项目 ID。保留原有 `XIAOYI_ADAPTER_TOKEN`、`XIAOYI_TEST_PROJECT_ID` 和模型配置，只修改需要更新的键。

5. 迁移前备份 SQLite，再执行迁移和构建。把备份文件名中的占位符也替换为相同提交号：

   ```bash
   sudo -u projectmemo sqlite3 /opt/projectmemo/data/projectmemo.db ".backup '/opt/projectmemo/data/projectmemo-pre-REPLACE_WITH_VERIFIED_COMMIT.db'"
   sudo -iu projectmemo
   cd /opt/projectmemo/app
   source /home/projectmemo/.nvm/nvm.sh
   set -a
   source /etc/projectmemo/projectmemo.env
   set +a
   npx prisma generate
   npx prisma migrate deploy
   npm run build
   exit
   sudo systemctl restart projectmemo
   sudo systemctl status projectmemo --no-pager
   ```

   6. 在本地验证公网版本、四条业务路由和 `begin_request` 辅助路由：

   ```powershell
   $env:XIAOYI_BASE_URL = "https://project.luojiatutor.xyz"
   $env:PROJECTMEMO_EXPECTED_RELEASE = "REPLACE_WITH_VERIFIED_COMMIT"
   npm.cmd run verify:w03-public
   ```

   成功结果中，`health_ok`、`schema_current`、`release_present`、`release_matches`、`capabilities_complete`、`workflow_helpers_complete` 和 `all_routes_authenticated` 必须全部为 `true`。脚本只使用无效 Token 验证 401，不会写入项目数据。

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
{
  "status": "ok",
  "service": "projectmemo",
  "schema_version": "2.1",
  "release": "已验证的提交号",
  "capabilities": ["record_memory", "query_memory", "inspect_project", "create_action"],
  "workflow_helpers": ["begin_request"]
}
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

四条路由全部部署后，可以运行 20 轮自动对账。该命令会真实创建 5 张测试卡片和 5 条测试行动，因此只在固定测试项目上运行：

```powershell
$env:PROJECTMEMO_XIAOYI_TOKEN = Read-Host -MaskInput "Xiaoyi adapter token"
npm.cmd run verify:w03-live
Remove-Item Env:\PROJECTMEMO_XIAOYI_TOKEN
```

成功时，脚本把脱敏回执写入 `evidence/2.1/xiaoyi/W03-live-*.json`。回执包含 20 轮工具结果、幂等重放结果、业务 ID、AgentRun 覆盖率和 SHA-256，不包含 Bearer Token。

## 第 11 步：让 DevEco 模拟器读取云端数据

在演示构建中，把 `Constants.BASE_URL` 临时改为：

```text
https://project.luojiatutor.xyz
```

重新构建并安装 App。因为 Nginx 只允许你的公网 IP 访问 `/api/*`，模拟器必须通过同一台开发电脑联网。如果网络出口 IP 改变，先更新 Nginx allowlist，再运行 `nginx -t` 和 `systemctl reload nginx`。

刷新 Memory 页面，确认 App 显示第 10 步返回的同一 `card_id`。这一步只证明 DevEco 模拟器与云端 Backend 的一致性；真机小艺入口仍保持 `UNVERIFIED`。

## 第 12 步：配置小艺插件节点

在小艺开放平台的云插件中配置：

### 12.1 第一个节点：`begin_request`

先添加 `POST /xiaoyi/v1/requests/begin` 插件节点。该节点只配置 `Authorization: Bearer <XIAOYI_ADAPTER_TOKEN>`，请求体留空或传 `{}`；不要在请求体中配置 `project_id`、`request_id`，也不要让大模型生成它们。成功返回的 `request_id` 连接到后续四项业务工具的同名字段。

`begin_request` 是工作流关联辅助，不计入四项 S08 业务能力，不创建卡片、行动或 `AgentRun`。它返回的 UUID 只在本次工作流运行内复用；`create_action` 的预览和确认两个阶段使用同一个 UUID，同时仍须把预览返回的 `proposal_id` 传给确认阶段。整轮重试会生成新的 UUID，不能据此宣称跨重试幂等。

### 12.2 业务工具示例

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

- 如果 `verify:w03-public` 报 `HTML_NOT_FOUND`，按“更新已有 ECS”部署包含四条业务路由和 `begin_request` 的新提交。
- 公网预检通过后，在固定测试项目执行 20 轮真实对账。
- 在插件控制台先调用 `begin_request`，再分别调用四个业务工具；保存 `AgentRun`、接口响应和模拟器同一业务 ID 的回执。`begin_request` 本身不应产生 `AgentRun`。
- 只有平台、服务端和 DevEco 模拟器三方 ID 对齐后，才把 W03/G3 标记为通过。
- 最后实现 `prepare_action`/`commit_action`，完成 20 轮 S08 对照测试。
