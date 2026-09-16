# 忆程 ProjectMemo

> 沉淀每一步，推进下一程。

忆程 ProjectMemo 是一个面向大学生项目制学习的知识资产沉淀与主动推进 Agent。它把论文笔记、代码报错、实验记录、会议结论、灵感和比赛要求沉淀为结构化知识卡片，关联历史记忆，并以可追溯的提醒、行动闭环和成果生成推动下一步交付。

## 当前可演示能力

- 项目创建、编辑、搜索、截止日期与项目总览。
- 文本碎片捕获、草稿恢复、Agent 结构化、原文追溯与人工纠错。
- 关键词记忆检索、相关卡片跳转与知识资产流。
- 截止逼近、风险未处理、项目停滞、实验缺口和材料缺口的主动介入。
- 接受、稍后、忽略提醒；行动项完成后自动生成复盘卡片。
- 决策依据、Agent 运行记录、内部准备度与效果面板。
- 带具体知识卡片引用的记忆副驾驶；一切写操作都需要用户确认。
- 六类成果：项目周报、作品说明大纲、答辩 PPT 大纲、README、简历描述和下周行动计划；支持 Markdown 渲染预览、源码编辑切换、草稿预览和版本留存。

默认使用完全离线的确定性 Mock，真实模型调用失败会自动回退，因此现场演示不依赖网络或密钥。

## 本地启动

要求：Node.js 24。Windows PowerShell 若限制 `npm.ps1`，请使用下面的 `npm.cmd`。

```powershell
copy .env.example .env
npm.cmd install
npm.cmd run db:setup
npm.cmd run dev
```

打开 <http://127.0.0.1:3000>。`db:setup` 会生成 Prisma Client、应用迁移并导入种子演示项目；它不会删除其他本地项目。

### 演示数据

```powershell
npm.cmd run db:seed
```

上述命令只重新导入“人工智能创意赛 忆程 ProjectMemo 作品开发”种子项目。若需要让演示环境只保留该项目，请显式确认后执行：

```powershell
npm.cmd run db:demo-reset -- --confirm
```

该命令会清空本地所有项目后重新导入种子数据，不可恢复。

## 模型配置

`.env` 默认配置为离线 Mock：

```env
LLM_MODE="mock"
```

如需连接 OpenAI-compatible 服务：

```env
LLM_MODE="openai-compatible"
LLM_PROVIDER="deepseek"
LLM_BASE_URL="https://api.deepseek.com"
LLM_API_KEY=""
LLM_MODEL_NAME="deepseek-flash"
LLM_TIMEOUT_MS="30000"
```

DeepSeek 配置使用 OpenAI-compatible 的 `/chat/completions` 契约；结构化任务显式关闭思考模式，以取得可解析的最终 `content`。API Key 只应通过本机环境变量、部署密钥或开发设置接口注入，不能写入源码、证据、日志或 Git。开发设置只保留在当前运行进程；线上环境禁用该设置写入接口。

DeepSeek chat 配置不自动视为 embedding provider。要开启 `SEMANTIC_MEMORY_ENABLED`，还需单独提供兼容的 embedding 服务：

```env
EMBEDDING_BASE_URL="https://your-embedding-provider.example/v1"
EMBEDDING_API_KEY=""
EMBEDDING_MODEL_NAME="your-embedding-model"
```

未配置 embedding provider 时，Hybrid Search 会保持可用的关键词/元数据 fallback，并且不会把它计入真实语义检索 Gate。

Temporal Evidence Ledger 默认开启。它通过提议、人工确认和可撤销关系保留决策演化；如需紧急回退到 2.0 搜索语义，可设置 `TEMPORAL_MEMORY_ENABLED=false`，关系历史不会被删除。

Evidence Trust Receipt 默认开启。问忆程会把回答拆成可核验结论，显示“依据充分 / 存在冲突 / 证据不足”，并阻止后两种状态产生写操作；紧急回退可设置 `EVIDENCE_TRUST_RECEIPT_ENABLED=false`，已有 `AgentRun` 审计记录不会被删除。

## 验证命令

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd exec tsc -- --noEmit
npm.cmd run benchmark:w04
npm.cmd run build
npm.cmd run test:e2e
```

E2E 会使用独立数据库和 `3321` 端口，不影响开发数据库。

## HarmonyOS 客户端（harmonyos/）

鸿蒙客户端与 Web 共用同一套 REST API。App 的后端地址唯一来源是
`harmonyos/entry/src/main/ets/common/Constants.ets`，当前固定为模拟器回环地址
当前机器验证地址为 `http://10.0.2.2:4400`（模拟器访问宿主机回环）；请用 `npm run harmony:backend` 启动对应端口。若端口再次被本机安全策略占用，需要同时更新该脚本与 `harmonyos/entry/src/main/ets/common/Constants.ets`，保持单一配置一致。

```powershell
# 1. 启动 App 要连接的 Backend（即本项目 dev 服务器）
npm.cmd run harmony:backend

# 2. 启动 DevEco 手机模拟器（冷启动约 1-3 分钟）
& 'D:\Program Files\Huawei\DevEco Studio\tools\emulator\Emulator.exe' -start 'Pura 90'

# 3. 构建 HAP（自动设置 DEVECO_SDK_HOME 与 JAVA_HOME，成功后输出 SHA-256 凭证）
npm.cmd run harmony:build

# 4. 运行 HarmonyOS 本地单元测试（Hypium，请求体/状态码/错误映射/状态枚举）
npm.cmd run harmony:test
```

DevEco Studio 安装路径不同时用环境变量覆盖：`$env:DEVECO_HOME = 'D:\path\to\DevEco Studio'`。

安装与运行（模拟器接受 unsigned debug HAP；正式签名需在 DevEco 中登录华为账号配置
signingConfigs，仓库不保存任何证书密钥）：

```powershell
$hdc = 'D:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
& $hdc list targets                                  # 确认模拟器可见
& $hdc install -r .\harmonyos\entry\build\default\outputs\default\entry-default-unsigned.hap
& $hdc shell aa start -a EntryAbility -b com.example.projectmemo
```

## 三分钟演示建议

1. 首页：说明“碎片输入 → 可追溯记忆 → 主动介入 → 行动回写 → 成果生成”的闭环。
2. 进入种子项目：展示项目状态、知识资产、相关卡片与准备度。
3. 启用一个演示情境或处理现有提醒：展开触发依据并接受建议。
4. 在行动板完成行动并填写结果：展示自动生成的复盘记忆和指标变化。
5. 打开记忆副驾驶或成果文档室：展示有卡片引用的回答，以及 PPT/README/作品说明的生成结果。

## 目录

```text
app/                    页面与 Route Handlers
components/             中文 UI 与交互组件
lib/agent/              Mock/LLM Provider 与 prompts
lib/services/           捕获、上下文、行动、成果等用例编排
lib/repositories/       Prisma 数据访问
prisma/                 SQLite schema、迁移与种子数据
tests/、e2e/            单元、集成与端到端测试
docs/competition/       初赛草案、迭代蓝图、海报提示词与演示截图
```

## 比赛材料

- [初赛作品说明 Markdown 草案](docs/competition/ProjectMemo_初赛作品说明文档草案.md)
- [竞赛增强与迭代蓝图](docs/competition/ProjectMemo_竞赛增强与迭代蓝图.md)
- [宣传海报生成提示词](docs/competition/忆程ProjectMemo_宣传海报生成提示词.md)

小艺 Workflow、语音/图片输入、鸿蒙客户端、真实后台推送、embedding 和记忆图谱均属于后续路线，当前版本不声称已接入。
