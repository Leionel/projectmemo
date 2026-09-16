# ProjectMemo ECS、后端、小艺与 HAP 执行手册

这份操作手册帮助你把已验证的 ProjectMemo 提交部署到香港 ECS，完成小艺工作流真实对账，并生成可安装的评审 HAP。请严格按“后端 → 小艺 → HAP → 联合验收 → 冻结封包”的顺序执行；前一阶段没有通过时，不要开始后一阶段。

本文是一份操作手册，不是已完成证明。带 `【待确认】` 的值必须由你根据 ECS、华为账号和赛事后台填写。不要把 Token、密码、证书私钥或个人数据库内容写入本文、Git、截图或聊天记录。

## 本轮目标与完成标准

完成本手册后，你应取得同一个候选版本的五类证据。

| 阶段 | 完成标准 | 不能替代它的证据 |
|---|---|---|
| ECS 后端 | `/health` 返回预期提交号，迁移完成，服务重启后可恢复 | 本地 `next build` |
| 公网边界 | 未登录业务 API 返回 401，跨项目返回 403，设置写入口不可公网使用 | 域名能打开 |
| 小艺 | 平台真实调用返回业务 ID，20 轮对账通过，App 能看到相同数据 | 插件节点显示“成功” |
| HAP | 使用评审 HTTPS 地址、完成签名、可在干净目标安装和重启 | unsigned HAP 构建成功 |
| 发布候选 | 后端提交、HAP 哈希、视频和说明文档绑定同一版本 | 历史截图或旧测试数量 |

本轮固定候选提交为：

```text
f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4
```

如果候选提交发生变化，请从 ECS 备份与部署开始重新执行，并更新所有版本号和 SHA-256。不要把不同提交产生的后端、HAP、视频和说明文档拼成一个提交包。

## 开始前填写输入表

开始操作前，复制下表到你的私密工作记录中并补全。敏感值只记录“已配置/未配置”，不要记录明文。

| 输入 | 本轮值 | 填写要求 |
|---|---|---|
| `VERIFIED_COMMIT` | `f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4` | 固定完整提交号 |
| Git 仓库 | `https://github.com/Leionel/projectmemo.git` | 不包含凭据 |
| 公网后端 | `https://project.luojiatutor.xyz` | 必须是有效 HTTPS |
| ECS SSH 别名或地址 | `【待确认】` | 建议配置 SSH alias，不在文档写私钥 |
| ECS sudo 账号 | `【待确认】` | 必须能运行 `sudo` |
| 服务账号 | `projectmemo` | 不用于密码登录 |
| 应用目录 | `/opt/projectmemo/app` | ECS 当前部署目录 |
| 数据库 | `/opt/projectmemo/data/projectmemo.db` | 备份后再迁移 |
| 附件目录 | `/opt/projectmemo/storage` | 与数据库一起备份 |
| 服务环境文件 | `/etc/projectmemo/projectmemo.env` | 权限应为 `600` |
| 小艺适配层 Token | `【已配置/未配置】` | 只放 ECS 环境文件和平台密钥区 |
| 小艺固定测试项目 ID | `【待确认】` | 必须是专用演示项目 |
| 评审用户名 | `【待确认】` | 使用独立演示账号 |
| 评审密码 | `【已设置/未设置】` | 不写进 Git、HAP 或文档 |
| HAP bundle name | 当前为 `com.example.projectmemo`，正式值 `【待确认】` | 与华为应用身份一致 |
| HAP vendor | 当前为 `example`，正式值 `【待确认】` | 与正式应用信息一致 |
| DevEco 签名配置 | `【待确认】` | 保存在本机/DevEco，不提交证书私钥 |
| 测试目标 | `【模拟器/专用设备待确认】` | `hdc list targets` 必须可见 |

如果任一必需值缺失，只执行不依赖它的步骤，并把对应阶段保持为 `BLOCKED`。

## 阶段 0：冻结本地候选版本

这一步确认你准备部署的代码与已验证提交一致。所有命令都在 Windows PowerShell 的仓库根目录 `D:\Projects\hongmen` 中运行。

1. 打开 PowerShell，进入仓库：

   ```powershell
   Set-Location -LiteralPath 'D:\Projects\hongmen'
   ```

2. 查看当前提交：

   ```powershell
   git rev-parse HEAD
   ```

   预期输出：

   ```text
   f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4
   ```

3. 查看工作区：

   ```powershell
   git status --short
   ```

   当前仓库允许保留你的 benchmark、比赛说明和配图草稿，但这些未提交文件不能进入 ECS 部署包或最终 release manifest。ECS 必须检出上面的固定提交，而不是复制当前工作目录。

4. 运行本地版本检查：

   ```powershell
   npm.cmd test
   npm.cmd exec tsc -- --noEmit
   npm.cmd run build
   npm.cmd run verify:s08-adapter
   ```

5. 如果任何命令失败，停止部署。先修复失败并产生新的候选提交，然后从本阶段重新开始。

## 阶段 1：备份 ECS 数据

这一步在更新代码前保存数据库、附件和环境配置。所有命令都在 ECS 上运行；不要在本机 PowerShell 中运行 Linux 命令。

1. 使用你的 SSH alias 或 ECS 地址登录：

   ```bash
   ssh 【ECS_SSH_ALIAS_OR_USER_AT_HOST】
   ```

2. 检查应用工作区：

   ```bash
   sudo -iu projectmemo
   cd /opt/projectmemo/app
   git status --short
   exit
   ```

   如果输出任何内容，停止更新。先确认服务器改动来源；不要运行 `git reset --hard`，也不要覆盖服务器上的未知文件。

3. 创建只属于本次提交的备份目录：

   ```bash
   release_id=f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4
   backup_dir="/opt/projectmemo/backups/${release_id}"
   sudo mkdir -p "$backup_dir"
   sudo chown projectmemo:projectmemo "$backup_dir"
   sudo chmod 700 "$backup_dir"
   ```

4. 备份 SQLite 数据库：

   ```bash
   sudo -u projectmemo sqlite3 /opt/projectmemo/data/projectmemo.db \
     ".backup '${backup_dir}/projectmemo.db'"
   ```

5. 备份附件目录：

   ```bash
   sudo -u projectmemo tar -C /opt/projectmemo -czf \
     "${backup_dir}/storage.tar.gz" storage
   ```

6. 备份环境文件，但不要下载或提交它：

   ```bash
   sudo cp --preserve=mode,ownership,timestamps \
     /etc/projectmemo/projectmemo.env \
     "${backup_dir}/projectmemo.env"
   sudo chmod 600 "${backup_dir}/projectmemo.env"
   ```

7. 验证三个备份文件存在且非空：

   ```bash
   sudo ls -lh "$backup_dir"
   sudo -u projectmemo sqlite3 "${backup_dir}/projectmemo.db" 'PRAGMA integrity_check;'
   ```

   预期 `PRAGMA integrity_check` 输出 `ok`。如果不是 `ok`，停止更新。

## 阶段 2：把后端部署到固定提交

这一步只更新应用代码、依赖、迁移和版本指纹，不覆盖现有 Token、项目 ID或模型凭据。

1. 以服务账号检出固定提交：

   ```bash
   sudo -iu projectmemo
   cd /opt/projectmemo/app
   git fetch origin --prune
   git checkout --detach f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4
   git rev-parse HEAD
   source /home/projectmemo/.nvm/nvm.sh
   nvm use 22.22.3
   npm ci
   exit
   ```

   `git rev-parse HEAD` 必须输出完整候选提交号。

2. 打开服务环境文件：

   ```bash
   sudo vi /etc/projectmemo/projectmemo.env
   ```

3. 确认或修改以下非敏感项：

   ```dotenv
   NODE_ENV=production
   DATABASE_URL=file:/opt/projectmemo/data/projectmemo.db
   ATTACHMENT_DIR=/opt/projectmemo/storage
   PROJECTMEMO_RELEASE=f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4
   TEMPORAL_MEMORY_ENABLED=true
   EVIDENCE_TRUST_RECEIPT_ENABLED=true
   PROJECT_STATE_ENABLED=true
   INTERVENTION_BUDGET_ENABLED=true
   XIAOYI_ADAPTER_ENABLED=true
   ```

4. 如需启用真实 DeepSeek，在服务器环境文件中配置以下项目。`LLM_API_KEY` 只在服务器输入，不粘贴到聊天、截图或 Git：

   ```dotenv
   LLM_MODE=openai-compatible
   LLM_PROVIDER=deepseek
   LLM_BASE_URL=https://api.deepseek.com
   LLM_MODEL_NAME=deepseek-flash
   LLM_TIMEOUT_MS=30000
   LLM_API_KEY=【服务器私密配置】
   ```

   ProjectMemo 的 DeepSeek 结构化请求显式关闭思考模式，以取得可解析的最终 `content`。DeepSeek chat 不能自动充当 embedding provider；未单独配置 embedding 服务时，不宣称真实语义向量检索。

5. 确认以下敏感项存在，但不要复制到终端输出或截图：

   ```dotenv
   XIAOYI_ADAPTER_TOKEN=【服务器中已有的至少 32 字符密钥】
   XIAOYI_TEST_PROJECT_ID=【固定测试项目 ID】
   ```

6. 如果 Token 尚未生成，在 ECS 上生成并直接写入环境文件：

   ```bash
   openssl rand -hex 32
   ```

   只把输出保存到 `/etc/projectmemo/projectmemo.env` 和小艺平台密钥区。不要把输出粘贴到本文、Git、截图或聊天记录。

7. 限制环境文件权限：

   ```bash
   sudo chown root:root /etc/projectmemo/projectmemo.env
   sudo chmod 600 /etc/projectmemo/projectmemo.env
   ```

8. 使用明确的数据库路径执行迁移、生成和构建。不要为了构建而让服务账号读取包含 Token 的生产环境文件：

   ```bash
   sudo -iu projectmemo
   cd /opt/projectmemo/app
   source /home/projectmemo/.nvm/nvm.sh
   nvm use 22.22.3
   export NODE_ENV=production
   export DATABASE_URL=file:/opt/projectmemo/data/projectmemo.db
   npx prisma generate
   npx prisma migrate deploy
   npm run build
   exit
   ```

9. 重启服务：

   ```bash
   sudo systemctl restart projectmemo
   sudo systemctl status projectmemo --no-pager
   ```

10. 在 ECS 本机检查服务与版本：

   ```bash
   curl --fail --silent --show-error http://127.0.0.1:4400/health
   ```

   响应必须包含：

   ```json
   {
     "status": "ok",
     "service": "projectmemo",
     "schema_version": "2.1",
     "release": "f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4",
     "capabilities": [
       "record_memory",
       "query_memory",
       "inspect_project",
       "create_action"
     ],
     "workflow_helpers": ["begin_request"]
   }
   ```

10. 如果服务没有启动，查看最近日志：

    ```bash
    sudo journalctl -u projectmemo -n 200 --no-pager
    ```

    不要在截图或工单中暴露环境变量、Authorization Header 或完整业务数据。

## 阶段 3：验证 ECS 公网边界

这一步确认 Nginx 把小艺、登录和业务 API 转发到正确后端，同时保留鉴权和限流。

1. 在 ECS 上验证 Nginx 配置：

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

2. 确认仓库中的部署规则与 ECS 生效配置一致：

   - `/health`：公网只读。
   - `/xiaoyi/v1/*`：公网可达，但必须验证独立 Bearer Token。
   - `/api/auth/login`：公网可达并启用登录限流。
   - `/api/auth/*`：转发用户会话。
   - `/api/settings*`：公网返回 404。
   - `/api/*`：转发到应用，由 `AuthSession` 和 `ProjectMembership` 保护。
   - 其他路径：返回 404。

3. 在本机 PowerShell 中运行带版本锁定的无写入预检：

   ```powershell
   Set-Location -LiteralPath 'D:\Projects\hongmen'
   $env:XIAOYI_BASE_URL = 'https://project.luojiatutor.xyz'
   $env:PROJECTMEMO_EXPECTED_RELEASE = 'f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4'
   npm.cmd run verify:w03-public
   Remove-Item Env:\XIAOYI_BASE_URL
   Remove-Item Env:\PROJECTMEMO_EXPECTED_RELEASE
   ```

4. 确认以下七项全部为 `true`：

   ```text
   health_ok
   schema_current
   release_present
   release_matches
   capabilities_complete
   workflow_helpers_complete
   all_routes_authenticated
   ```

5. 如果 `release_matches=false`，不要继续小艺调试。检查 `PROJECTMEMO_RELEASE`、systemd 重启结果和 Nginx 是否转发到了旧进程。

6. 如果任一业务路由返回 HTML 404，不要继续小艺调试。检查 ECS 是否检出了正确提交，以及 Nginx 是否加载了当前配置。

## 阶段 4：准备评审账号和隔离数据

这一步给 HAP 和评审人员提供独立登录身份，避免公开团队真实项目库。

1. 确认评审使用方式：

   ```text
   评审用户名：按钮/说明文档中提供，值为【待确认】
   评审密码：通过安全渠道提供，值不写入 Git/HAP
   演示项目：独立项目，ID 为【待确认】
   小艺测试项目：可以与演示项目相同，但必须明确并使用虚构数据
   ```

2. 在 ECS 数据库中只查询候选项目，不修改数据：

   ```bash
   sudo sqlite3 /opt/projectmemo/data/projectmemo.db \
     'SELECT id, title FROM Project ORDER BY updatedAt DESC;'
   ```

3. 确认 `XIAOYI_TEST_PROJECT_ID` 指向专用演示项目，不指向个人真实项目。

4. 使用评审账号登录一次，确认它只能看到自己的项目。不要把管理员或团队个人账号交给评审。

5. 从非登录状态访问一个项目业务 API，确认返回 401；使用另一个账号访问不属于它的项目，确认返回 403。

6. 如果无法证明账号隔离，停止 HAP 评审构建，不要通过放宽 Nginx 或删除应用鉴权来绕过。

## 阶段 5：配置小艺工作流

这一步在小艺开放平台中完成。你需要已登录的平台账号和已存入平台密钥区的适配层 Token。

### 创建公共插件配置

先创建或打开 `projectmemo_backend` 云插件，然后给每个工具设置公共字段。

| 字段 | 输入值 |
|---|---|
| Base URL | `https://project.luojiatutor.xyz` |
| 请求头名称 | `Authorization` |
| 请求头值 | `Bearer 【从平台密钥区引用 XIAOYI_ADAPTER_TOKEN】` |
| Content-Type | `application/json` |
| 超时 | 30 秒 |

不要在普通文本字段中明文保存 Token。如果平台不能安全设置固定 Header，停止配置，不要关闭服务端鉴权。

### 配置 `begin_request`

`begin_request` 是每轮工作流的第一个工具，只产生本轮关联 ID，不写业务数据。

| 字段 | 输入值 |
|---|---|
| 工具名 | `begin_request` |
| 方法 | `POST` |
| 路径 | `/xiaoyi/v1/requests/begin` |
| 请求体 | `{}` |
| 成功状态 | 200 |
| 保存输出 | `request_id`、`issued_at` |

将工作流主干改成：

```text
开始 → begin_request → 意图分类
```

使用平台变量选择器，把 `begin_request.request_id` 映射到后续工具的 `request_id`。不要手写固定 ID，也不要让大模型生成 ID。

### 配置四个业务工具

按下表输入路径、请求体和输出字段。

| 工具 | 方法和路径 | 请求体 | 成功输出 |
|---|---|---|---|
| `record_memory` | `POST /xiaoyi/v1/memories` | `content`、`source_type`、`request_id` | `card_id`、`agent_run_id`、`request_id` |
| `query_memory` | `POST /xiaoyi/v1/memories/search` | `query`、`top_k=5`、`request_id` | `results[]`、`agent_run_id`、`request_id` |
| `inspect_project` | `POST /xiaoyi/v1/projects/inspect` | `refresh=false`、`request_id` | `project`、`state`、`agent_run_id`、`request_id` |
| `create_action` 预览 | `POST /xiaoyi/v1/actions` | `confirmed=false`、`title`、`description`、`priority`、`request_id` | `proposal_id`、预览字段、`request_id` |
| `create_action` 提交 | `POST /xiaoyi/v1/actions` | `confirmed=true`、预览返回的 `proposal_id`、同一个 `request_id` | `action.id`、`agent_run_id`、`request_id` |

平台节点中的最小测试输入如下。把 `request_id` 绑定为 `begin_request` 输出，不要复制示例中的占位符。

```json
{
  "content": "记录一下：评审后端联调已经开始。",
  "source_type": "xiaoyi-workflow",
  "request_id": "【绑定 begin_request.request_id】"
}
```

```json
{
  "query": "评审后端联调",
  "top_k": 5,
  "request_id": "【绑定 begin_request.request_id】"
}
```

```json
{
  "refresh": false,
  "request_id": "【绑定 begin_request.request_id】"
}
```

```json
{
  "confirmed": false,
  "title": "核对评审后端联调结果",
  "description": "确认小艺、ECS 与 HAP 使用同一份项目数据。",
  "priority": 3,
  "request_id": "【绑定 begin_request.request_id】"
}
```

预览成功后，从返回值中选择 `proposal_id`，再配置确认调用：

```json
{
  "confirmed": true,
  "proposal_id": "【绑定预览节点 proposal_id】",
  "request_id": "【复用同一 begin_request.request_id】"
}
```

### 配置意图分类与确认分支

将意图分类设置为六个互斥出口。

| 分类 | 说明 |
|---|---|
| `record_memory` | 用户明确要求保存新进展 |
| `query_memory` | 用户查找过去的决定、资料或证据 |
| `inspect_project` | 用户询问当前进度、风险、停滞或下一步 |
| `create_action` | 用户要求创建行动，或回应行动确认 |
| `generate_artifact` | 仅保留为未接后端的成果草稿能力 |
| `other` | 闲聊、越界请求或无法判断的内容 |

给分类节点输入以下提示词：

```text
只负责分类，不回答用户问题。
优先根据用户本轮主要动作分类。
“记录/保存/记一下”且内容是新信息时选 record_memory。
“之前/上次/找一下/回忆”时选 query_memory。
“现在/风险/进度/下一步/停滞”时选 inspect_project。
“创建待办/建立行动/确认创建/稍后/取消”时选 create_action。
无法确定时选 other，不要猜测。
```

将 `create_action` 分支设置为：

```text
整理行动参数
→ create_action confirmed=false
→ 展示预览并询问用户
→ 用户明确确认
→ create_action confirmed=true + proposal_id
→ 返回真实 action.id
```

取消、稍后或没有明确确认时，不得调用 `confirmed=true`。

### 运行六句路由测试

在发布工作流前逐句输入以下内容，并记录实际分支和结果。

| 输入 | 预期分支 | 预期行为 |
|---|---|---|
| `记录一下：小艺工作流已完成接口联调。` | `record_memory` | 返回真实 `card_id` |
| `找一下刚才记录的接口联调。` | `query_memory` | 结果包含同一张卡片 |
| `这个项目现在有什么风险？` | `inspect_project` | 只根据接口返回整理状态 |
| `把插件联调建成待办。` | `create_action` | 只展示预览并请求确认 |
| 在上一句后选择 `取消` | `create_action` 取消出口 | 不创建行动 |
| `帮我生成一份答辩稿。` | `generate_artifact` | 明确标记为未保存草稿 |

任何插件失败时，回复必须明确写“本次没有完成读取/写入”。不要让文本节点在接口失败后回答“已记录”或“已创建”。

## 阶段 6：运行小艺 20 轮真实对账

这一步会向固定测试项目真实写入 5 张卡片和 5 条行动。只有在你确认测试项目正确并明确允许这些公网写入后，才能执行。

1. 在本机 PowerShell 中进入仓库：

   ```powershell
   Set-Location -LiteralPath 'D:\Projects\hongmen'
   ```

2. 使用掩码输入 Token：

   ```powershell
   $secureToken = Read-Host -MaskInput '输入 Xiaoyi adapter token'
   $env:PROJECTMEMO_XIAOYI_TOKEN = $secureToken
   $env:XIAOYI_BASE_URL = 'https://project.luojiatutor.xyz'
   $env:PROJECTMEMO_EXPECTED_RELEASE = 'f37523ab940674a66a3a7dcdf7a75d6e75b5e5a4'
   ```

3. 运行真实对账：

   ```powershell
   npm.cmd run verify:w03-live
   ```

4. 清除当前 PowerShell 进程中的敏感变量：

   ```powershell
   Remove-Item Env:\PROJECTMEMO_XIAOYI_TOKEN
   Remove-Item Env:\XIAOYI_BASE_URL
   Remove-Item Env:\PROJECTMEMO_EXPECTED_RELEASE
   $secureToken = $null
   ```

5. 确认输出满足：

   ```text
   passed = true
   normal_rounds_passed = 20
   cards_created = 5
   actions_created = 5
   agent_run_metadata_coverage = 1
   replay_mismatches = 0
   unauthorized_action_rate = 0
   ```

6. 保存脚本生成的 `evidence/2.1/xiaoyi/W03-live-*.json`。检查文件不包含 Token 后，再决定是否纳入 release evidence。

7. 在 HAP 或 Web 评审账号中打开固定测试项目，确认能看到脚本返回的同一 `card_id` 和 `action.id`。平台成功但 App 看不到相同 ID，不算通过。

## 阶段 7：配置评审 HAP

这一步把鸿蒙客户端从模拟器开发地址切换到评审 HTTPS 后端。只有阶段 3 的版本预检和阶段 4 的评审账号验证通过后才执行。

1. 打开 [Constants.ets](../../harmonyos/entry/src/main/ets/common/Constants.ets)。

2. 将配置改为：

   ```ts
   static readonly BUILD_FLAVOR: string = 'review';
   static readonly DEVELOPMENT_BASE_URL: string = 'http://10.0.2.2:4400';
   static readonly REVIEW_BASE_URL: string = 'https://project.luojiatutor.xyz';
   ```

3. 打开 [app.json5](../../harmonyos/AppScope/app.json5)，核对以下正式应用信息：

   ```text
   bundleName：当前 com.example.projectmemo，正式值【待确认】
   vendor：当前 example，正式值【待确认】
   versionCode：每次正式候选递增
   versionName：与提交材料一致
   ```

   如果赛事允许使用当前测试应用身份，请保存对应规则证据。否则先在 AppGallery Connect/DevEco 中建立正式应用身份，再填写注册值。

4. 在 DevEco Studio 中打开 `D:\Projects\hongmen\harmonyos`。

5. 进入项目签名配置界面。不同 DevEco 版本的菜单名称可能略有差异，通常位于 **File > Project Structure > Signing Configs**。

6. 登录你的华为开发者账号，选择或生成符合赛事安装方式的签名配置。

7. 确认 [build-profile.json5](../../harmonyos/build-profile.json5) 不再是空的 `signingConfigs: []`，并确保私钥、证书密码和本机签名材料不会提交到 Git。

8. 运行鸿蒙测试：

   ```powershell
   Set-Location -LiteralPath 'D:\Projects\hongmen'
   npm.cmd run harmony:test
   ```

9. 使用 DevEco 生成 release HAP。不要把 `npm.cmd run harmony:build` 生成的 debug unsigned HAP 当作最终包；该脚本当前固定使用 `buildMode=debug`。

10. 在 PowerShell 中找到最新 HAP 并计算哈希：

    ```powershell
    $hap = Get-ChildItem -LiteralPath 'D:\Projects\hongmen\harmonyos\entry\build\default\outputs\default' -Filter '*.hap' |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    $hap | Select-Object FullName, Length, LastWriteTime
    Get-FileHash -Algorithm SHA256 -LiteralPath $hap.FullName
    ```

11. 检查文件名和 DevEco 输出，确认产物已签名。如果仍为 `*-unsigned.hap`，停止封包。

## 阶段 8：安装并验收 HAP

这一步需要 `hdc list targets` 能看到模拟器或专用测试设备。本轮已在 DevEco 模拟器完成公网登录与主流程检查，但这不替代真机安装；生成最终签名 HAP 后仍需从产物文件执行一次干净安装。

1. 设置 `hdc` 路径：

   ```powershell
   $hdc = 'D:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
   ```

2. 查看目标：

   ```powershell
   & $hdc list targets
   ```

   如果输出 `[Empty]`，停止安装。先在 DevEco Device Manager 中启动模拟器，或连接开启调试授权的专用设备。

3. 安装签名 HAP：

   ```powershell
   & $hdc install -r '【签名 HAP 的绝对路径】'
   ```

4. 启动应用。把占位符替换为正式 bundle name：

   ```powershell
   & $hdc shell aa start -a EntryAbility -b '【正式 bundle name】'
   ```

5. 使用评审账号完成以下最小验收：

   - 首次启动显示登录页，不自动绑定个人账号。
   - 登录后只看到评审项目。
   - 创建一条项目记录，返回后能看到对应知识卡片。
   - 查询项目状态，刷新失败时保留旧状态并显示失败原因。
   - 创建行动时先展示预览，确认后才写入。
   - 完成行动后出现 `resultCardId` 对应的复盘卡。
   - 上传一个专用测试附件并确认重启后仍可读取。
   - 模型配置在生产环境显示只读，保存按钮不可用。
   - 杀死应用进程后重新启动，登录态和数据表现符合设计。
   - 断网时不显示假成功；恢复网络后可以重新同步。

6. 在专用测试设备上执行一次干净安装验收。只有你明确允许清除该测试设备数据时，才卸载旧包；不要在个人设备上为了“干净安装”删除真实数据。

7. 录制安装、登录、写入、重启和小艺同 ID 对账过程。截图只能证明显示，录屏和数据库/接口回执共同证明操作成功。

## 阶段 9：冻结候选版本并封包

这一步把代码、后端、HAP 和材料绑定成可复核的 release candidate。

1. 建立本轮 release manifest，至少记录：

   ```text
   Git commit
   ECS /health release
   数据库迁移结果
   小艺工作流/插件版本
   W03 20 轮证据文件和 SHA-256
   HAP 路径、大小、SHA-256、signed/unsigned
   测试设备/模拟器型号与系统版本
   评审后端 URL
   Web、TypeScript、HarmonyOS 测试结果
   视频、说明 PDF 和 ZIP 的 SHA-256
   已知限制与 UNVERIFIED 项
   ```

2. 从最终 ZIP 中重新解压 HAP，计算 SHA-256，并在干净目标上安装。不要只测试构建目录中的原文件。

3. 使用最终 HAP 和同一 ECS 版本录制正式视频。不要使用开发地址、旧后端或 unsigned 包录制后再替换交付物。

4. 冻结后只修阻断性缺陷、文档错误和提交格式。任何代码、后端环境或 HAP 变化都要生成新 manifest，并重跑受影响验收。

## 回滚 ECS 后端

如果部署后出现迁移、登录或业务写入异常，先停止继续联调并保留失败日志。

1. 临时关闭小艺写入入口：

   ```bash
   sudo sed -i 's/^XIAOYI_ADAPTER_ENABLED=true$/XIAOYI_ADAPTER_ENABLED=false/' \
     /etc/projectmemo/projectmemo.env
   sudo systemctl restart projectmemo
   ```

2. 检出上一个已验证提交，不要删除当前数据库和失败回执：

   ```bash
   sudo -iu projectmemo
   cd /opt/projectmemo/app
   git checkout --detach 【上一个已验证提交】
   source /home/projectmemo/.nvm/nvm.sh
   nvm use 22.22.3
   npm ci
   exit
   ```

3. 只有迁移明确破坏数据且你已验证备份完整时，才从备份恢复数据库。不要在未核对目标路径和备份时间的情况下覆盖生产数据库。

4. 恢复代码后重新构建、重启并运行带期望提交号的公网预检。

## 停止条件

出现以下任一情况时，停止相应阶段，不要用截图或口头说明替代：

- ECS 工作区不干净且改动来源未知。
- 数据库备份完整性检查不为 `ok`。
- `/health.release` 与候选提交不一致。
- 未登录业务 API 可写，或跨项目访问没有被拒绝。
- 小艺平台不能安全配置 Bearer Header。
- `create_action` 未经确认就创建行动。
- 20 轮对账出现 ID 不一致、重复卡片或重复行动。
- HAP 仍使用 `10.0.2.2`、`localhost`、`127.0.0.1` 或空地址。
- HAP 仍为 unsigned。
- `hdc list targets` 返回 `[Empty]`。
- 最终 ZIP 中的 HAP 与已验收 HAP 哈希不同。

## 下一步

完成每个阶段后，按以下顺序继续：

1. 先按照 [香港 ECS 部署说明](../xiaoyi/Alibaba%20Cloud%20Linux%20部署%20S08.md) 更新后端并锁定版本。
2. 再按照 [小艺开放平台教程](../xiaoyi/小艺开放平台操作与更新教程.md) 完成平台调试和真实 ID 对账。
3. 使用 [复赛提交放行清单](../../REMATCH_SUBMISSION_GATE_2026-09-14.md) 核对签名、安装、材料、视频和最终上传。
