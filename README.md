# 忆程 ProjectMemo

> 沉淀每一步，推进下一程。

忆程 ProjectMemo 是一个面向大学生项目制学习的知识资产沉淀与主动推进 Agent。它把论文笔记、代码报错、实验记录、会议结论、灵感和比赛要求沉淀为结构化知识卡片，关联历史记忆，并以可追溯的提醒、行动闭环和成果生成推动下一步交付。

Web 与鸿蒙 ArkTS 客户端共用同一套 Next.js 后端；业务事实以服务端持久数据为准。

## 能力状态

本文件区分三档状态，避免把路线图写成能力、或把已实现的工作说成"还没做"：

- **已验证**：代码已实现，并且有本地测试、独立数据库或设备验证可复现。
- **已实现，待外部验收**：代码已实现且本地可复现，但结论依赖设备、平台或外部服务，尚未取得回执。
- **规划中**：尚未实现。

当前本地回归结果：`npm test` → **38 个测试文件 / 282 个测试全部通过**。

## 已验证

**记忆与状态**

- 项目创建、编辑、搜索、截止日期与项目总览；项目级用户与 Membership 授权。
- 文本碎片捕获、草稿恢复、Agent 结构化、原文追溯与人工纠错；`requestId` 幂等，重复提交不产生重复记忆。
- 知识卡片、关联关系与知识资产流；记忆生命周期（当前 / 已取代 / 存在冲突 / 未知）与归档恢复，事件写入审计链。
- 时间证据账本：关系需人工确认，支持撤销，保留历史快照；A→B→A 的状态重现各自成行。
- 记忆检索为 hybrid：向量 + 关键词 + 元数据 + 兜底；未配置向量 provider 时退化为关键词检索且不冒充语义检索。
- 项目状态快照、状态差异、刷新新鲜度与读游标；刷新失败保留上一快照并标记 STALE/FAILED，不会把错误当成 0% 状态。

**主动推进与行动闭环**

- 主动介入：截止逼近、风险未处理、项目停滞、实验缺口、材料缺口、交付物证据缺口。
- 干预预算、降频与静默时段；生成 / 曝光 / 送达 / 反馈分开记录，未验证送达不宣称用户已收到。
- 接受、稍后、忽略提醒；行动项结构化依赖与可行性评估；行动完成后自动生成复盘卡片并保留 `resultCardId` 回执链。
- 会议提案、变更影响预览与人工确认后才应用业务变更（409 重新预览）。

**成果与可追溯**

- 六类成果：项目周报、作品说明大纲、答辩 PPT 大纲、README、简历描述和下周行动计划；支持 Markdown 渲染预览、源码编辑切换、草稿预览和版本留存。
- 成果逐句溯源与审计；记忆副驾驶带具体知识卡片引用，并区分"依据充分 / 存在冲突 / 证据不足"。
- 证据不足或存在冲突时阻止产生写操作；所有写操作都需要用户确认。
- Agent 运行记录保留 provider、状态、失败与降级原因。

**输入与客户端**

- 附件 Inbox：MIME 与文件魔数双重校验、20MB 上限、写盘前去重、异常清理、修订链与人工纠正。
- 文本 PDF 经 `pdftotext` 抽取；图片走对话模型的视觉能力（请求体格式与 DeepSeek 视觉接口一致）。
- 鸿蒙 ArkTS 客户端：与 Web 共用 REST API，覆盖登录、项目、捕获、记忆、行动、成果与附件 Picker。
- 认证：`scrypt` 加盐口令哈希、32 字节随机会话令牌、库内只存 SHA-256 token 哈希、生产环境 Cookie 带 `Secure`。
- 小艺适配层：`record_memory` / `query_memory` / `inspect_project` / `create_action`，固定项目授权、独立 Bearer Token、限流、幂等键与两步确认。

默认使用完全离线的确定性 Mock，真实模型调用失败会自动回退，因此现场演示不依赖网络或密钥。

## 已实现，待外部验收

以下能力代码已经就位、本地可复现，但结论依赖设备或外部平台，目前**没有**回执，不作为已完成能力对外宣称：

| 能力 | 已做到的 | 还缺什么 |
|---|---|---|
| 正式签名 HAP | ArkTS 单测、DevEco 模拟器公网主流程、unsigned HAP 构建均通过 | 正式 bundleName / 签名配置 / 真机干净安装 / 杀进程冷启动重读 |
| 小艺平台联调 | 适配层与公网接口契约已实现并有专项测试 | 真实小艺 Agent → Workflow → 公网后端 → App 同步的往返回执 |
| 真实模型路径 | DeepSeek 结构化调用曾成功一次（约 4.9s） | 30 条真实矩阵：成功率、回退、p50/p95、JSON 解析失败率 |
| 向量语义检索 | embedding + hybrid 检索、Search API 与 backfill 均已接入 | 真实 embedding provider 配置，以及 Recall@5 / MRR / p95 检索基准回执 |
| 图片与扫描件 OCR | 图片按官方视觉接口格式提取；文本 PDF 可抽取 | 生产默认 `LLM_MODE=mock`，此时图片为 `NEEDS_OCR`；扫描 PDF 仍无 OCR |
| 系统通知 | 发布回执与应用内曝光分开记录 | 真机通知曝光与点击回执 |
| 生产容灾 | 公网 HTTPS 后端可用，登录与项目接口返回有效 JSON | 数据库与附件备份、恢复演练、重启自启与故障恢复说明 |

复赛前是否关闭这些 Gate，以 [放行清单](REMATCH_SUBMISSION_GATE_2026-09-14.md) 与 [ECS / 小艺 / HAP 执行手册](docs/competition/projectmemo-ecs-backend-xiaoyi-hap-runbook.md) 的当前状态为准。

## 规划中

尚未实现，仓库中不存在对应服务：

- 记忆巩固（Episode / Consolidation）与长期记忆合并。
- App 内排程引擎与后台任务。
- GitHub 增量证据连接器、日历只读与写入连接器。
- 团队协作权限等级（OWNER / EDITOR / VIEWER）。当前 `ProjectMembership.role` 已有字段，但访问控制只判断"是否属于该项目"，尚未按角色区分写权限，因此不宣称完整多人协作权限。

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

上述命令只重新导入"人工智能创意赛 忆程 ProjectMemo 作品开发"种子项目。若需要让演示环境只保留该项目，请显式确认后执行：

```powershell
npm.cmd run db:demo-reset -- --confirm
```

该命令会清空本地所有项目后重新导入种子数据，不可恢复。

## 配置

变量全集、分组说明与默认值见 [`.env.example`](.env.example)——它是变量名的唯一事实来源，本文件不重复维护默认值。生产部署的取值差异见 [`deploy/alibaba-cloud-linux/projectmemo.env.example`](deploy/alibaba-cloud-linux/projectmemo.env.example)。

需要单独说明的三点：

- **真实模型**：默认 `LLM_MODE="mock"`。切到 `openai-compatible` 后使用 OpenAI-compatible 的 `/chat/completions` 契约；结构化任务显式关闭思考模式，以取得可解析的最终 `content`。API Key 只能通过本机环境变量、部署密钥或开发设置接口注入，不能写入源码、证据、日志或 Git。
- **向量检索**：DeepSeek 的对话预设不会被自动当作 embedding provider。要开启 `SEMANTIC_MEMORY_ENABLED`，必须另行提供 `EMBEDDING_BASE_URL` 与 `EMBEDDING_MODEL_NAME`，否则 Hybrid Search 保持关键词/元数据 fallback，且不计入真实语义检索 Gate。
- **视觉提取**：图片提取复用当前对话模型，`LLM_VISION_MODEL_NAME` 留空即复用 `LLM_MODEL_NAME`（DeepSeek 的 `deepseek-flash` 原生接受 base64 图片输入）。留空是推荐配置——填入别家的模型名只会让请求报错并退化成 `NEEDS_OCR`。

功能开关（`PROJECT_STATE_ENABLED`、`INTERVENTION_BUDGET_ENABLED`、`TEMPORAL_MEMORY_ENABLED`、`EVIDENCE_TRUST_RECEIPT_ENABLED`、`PROJECT_INBOX_ENABLED`、`DELIVERABLE_GAP_ENABLED`）可单独回退。关闭只影响新行为的生成，不删除已有历史数据。

开发设置接口只保留在当前运行进程，生产环境一律拒绝运行时写入。

## 验证命令

```powershell
npm.cmd test                      # 单元 / 集成（独立测试库）
npm.cmd run lint
npm.cmd exec tsc -- --noEmit
npm.cmd run build
npm.cmd run test:e2e              # 使用独立数据库与 3321 端口
npm.cmd run benchmark:w04         # 时间证据账本
npm.cmd run benchmark:w05         # 证据可信回执
```

需要外部服务才有意义的基准（未配置时脚本会直接报错退出，不会伪造结果）：

```powershell
npm.cmd run verify:s03-provider   # 真实对话模型连通性
npm.cmd run benchmark:s04         # hybrid 检索基准（需真实 embedding provider）
npm.cmd run db:backfill-embeddings
npm.cmd run verify:w03-public     # 小艺公网接口契约（只读）
```

E2E 会使用独立数据库和 `3321` 端口，不影响开发数据库。

## HarmonyOS 客户端（harmonyos/）

鸿蒙客户端与 Web 共用同一套 REST API。App 的后端地址唯一来源是
`harmonyos/entry/src/main/ets/common/Constants.ets`；模拟器访问宿主机回环用
`http://10.0.2.2:4400`，与本仓库 `npm run harmony:backend` 的监听端口对应。
模拟器地址只证明模拟器可达，不构成评审设备可访问的证明。若端口被本机安全策略占用，
需要同时更新该脚本与 `Constants.ets`，保持单一配置一致。

```powershell
# 1. 启动 App 要连接的 Backend（即本项目 dev 服务器，监听 4400）
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
`signingConfigs`，仓库不保存任何证书密钥）：

```powershell
$hdc = 'D:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
$bundle = '<harmonyos/AppScope/app.json5 中的 bundleName>'
& $hdc list targets                                  # 确认模拟器可见
& $hdc install -r .\harmonyos\entry\build\default\outputs\default\entry-default-unsigned.hap
& $hdc shell aa start -a EntryAbility -b $bundle
```

unsigned HAP 不等于最终交付产物；正式签名包的生成与真机验收步骤见执行手册。

## 三分钟演示建议

1. 首页：说明「碎片输入 → 可追溯记忆 → 主动介入 → 行动回写 → 成果生成」的闭环。
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
deploy/                 ECS 部署样例（systemd unit、nginx、生产 env）
docs/competition/       初赛/复赛作品文档、图与演示截图
evidence/               验收回执（按批次分目录，注明数据来源）
```

## 比赛材料

- [复赛放行清单](REMATCH_SUBMISSION_GATE_2026-09-14.md)
- [ECS、后端、小艺与 HAP 执行手册](docs/competition/projectmemo-ecs-backend-xiaoyi-hap-runbook.md)
- [初赛作品说明文档草案](docs/competition/ProjectMemo_初赛作品说明文档草案.md)
- [复赛作品说明文档草案](docs/competition/ProjectMemo_复赛作品说明文档草案.md)
- [复赛 5 分钟演示视频脚本草案](docs/competition/ProjectMemo_复赛5分钟演示视频脚本草案.md)
- [竞赛增强与迭代蓝图](docs/competition/ProjectMemo_竞赛增强与迭代蓝图.md)
- [宣传海报生成提示词](docs/competition/忆程ProjectMemo_宣传海报生成提示词.md)
- [复赛配图生成提示词](docs/competition/复赛配图生成提示词.md)