# ProjectMemo 鸿蒙迁移代码库审计

> 审计日期：2026-08-19
> 配套文档：`../plans/HARMONYOS_PLAN.md`（迁移计划）
> 审计原则：只分析，不修改代码。
>
> **目录口径说明**：仓库中不存在 `original/` 目录。**仓库根部本身就是现有 ProjectMemo 项目**（Next.js Web 应用），`harmonyos/` 是新增的 HarmonyOS 工程。下文按此口径审计。

---

## 0. 结论先行（TL;DR）

1. **后端闭环已经真实存在，且质量超出计划文档的预期**：`Memory → Project State → Risk → Evidence → 用户确认 → Action → 回写 Memory` 的完整链路在现有代码中**全部落地**（规则引擎 + SQLite 事务 + 状态机 + 审计留痕），不是空架子。
2. **"智能"部分是双模式**：LLM（裸 fetch OpenAI-compatible，无任何 SDK）可选，失败/未配置时回退到确定性 mock/规则。**当前 `.env` 为 `LLM_MODE="mock"`，运行时所有 AI 路径实际都走 mock**。这是初赛"离线可演示"的刻意设计，迁移时应保留。
3. **计划文档 §5 建议的 API 路径与真实 API 不一致**（`/memories`→实际是 `/captures`+`/cards`，`/risks`→实际是 `/interventions`，`/state`→实际是 `/projects` 内嵌 dashboard + `/metrics`）。**HarmonyOS 端应按真实 API 建模，不要按计划文档的路径造接口**。
4. **HarmonyOS 工程进度为 0%**：`harmonyos/` 是 DevEco 默认 Empty Ability 模板，无页面、无网络层、无模型、无 `INTERNET` 权限。PLAN 中 Phase 2 的全部工作尚未开始。
5. **HarmonyOS MVP 可以零后端改动完成**：现有 23 个 API 端点足以支撑 P0 四页面 + Demo A/B/C 三条链路。唯一需要动的是启动方式（`next dev -H 0.0.0.0` 让手机可达），不是代码。
6. **Web 前端存在业务逻辑耦合**（规则引擎被浏览器端 import、snooze 时长/逾期判断/重要性阈值硬编码在组件里），但这些**不影响 HarmonyOS 迁移**——因为同样的逻辑在后端 API 都有对应出口；迁移时鸿蒙端不要复制这些前端逻辑，只调 API。

---

## 1. 当前 ProjectMemo 技术栈和目录结构

### 1.1 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 框架 | Next.js 16（App Router，React 19，TypeScript） | 全部 API 为 Route Handlers，`runtime = "nodejs"`；**无 Server Actions、无 middleware、无 rewrites** |
| 样式 | Tailwind CSS 4 + next-themes | |
| 数据库 | SQLite（Prisma 7 + better-sqlite3 驱动） | 单文件 `prisma/dev.db`；E2E 独立库 `prisma/projectmemo-e2e.db` |
| 校验 | zod 4 | 所有 API 入参经 zod schema（`lib/validation/schemas.ts`） |
| LLM | **无任何 SDK**，原生 `fetch` 打 OpenAI-compatible `/chat/completions`（`lib/agent/llmAgent.ts`） | 由 `LLM_MODE / LLM_BASE_URL / LLM_API_KEY / LLM_MODEL_NAME / LLM_TIMEOUT_MS` 环境变量控制 |
| 测试 | Vitest（单测+SQLite 集成）、Playwright（E2E） | `tests/` 7 个测试文件、`e2e/demo.spec.ts` |
| 鸿蒙端 | DevEco Studio / ArkTS / Stage Model / API 6.1.1(24) | 目前仅有模板脚手架 |

### 1.2 目录结构（仓库根 = 现有 ProjectMemo）

```text
hongmen/                        ← 仓库根 = ProjectMemo Web 项目本体
├── docs/plans/HARMONYOS_PLAN.md           迁移计划（本次审计的输入）
├── app/                        Next.js App Router
│   ├── api/                    ★ 全部 15 个 route.ts（23 个端点），见 §3
│   ├── page.tsx                落地页（含硬编码演示物料，见 §7）
│   └── projects/               项目列表 / 详情工作台 / 成果生成室
├── components/                 19 个 React 组件（全部中文 UI）
├── lib/
│   ├── agent/                  LLM/mock Agent：index(分发) / llmAgent / mockAgent / prompts
│   ├── memory/                 vectorStore(名不副实,见 §5) / linker(关键词关联)
│   ├── services/               ★ 用例编排：capture / agentContext(规则引擎) / action / copilot / artifact
│   ├── repositories/           Prisma 数据访问：projects / cards / agent / artifacts
│   ├── generators/templates.ts mock 成果模板（真实数据填空）
│   ├── projectDashboard.ts     状态/准备度/打分规则（被前后端同时引用，见 §7）
│   ├── suggestions.ts          ⚠ 死代码（仅测试引用）
│   ├── types.ts                前后端共享类型与枚举
│   ├── validation/schemas.ts   全部 zod schema
│   ├── api.ts                  统一错误协议 {error:{code,message,details?}}
│   ├── db.ts                   Prisma 客户端（better-sqlite3）
│   └── client/workspaceEvents.ts 浏览器内事件总线
├── prisma/                     schema.prisma（9 表 9 枚举）、2 个 migration、seed.ts
├── scripts/                    db 初始化 / demo-reset / e2e 环境
├── tests/、e2e/                Vitest、Playwright
├── docs/competition/           初赛说明草案、竞赛增强与迭代蓝图
└── harmonyos/                  ★ HarmonyOS 工程（目前 = 空模板，见 §8）
```

---

## 2. Web 前端、Backend、数据库之间的关系

```text
┌──────────────────────────── Web 前端（两条数据通道）────────────────────────────┐
│                                                                                │
│  通道 A：RSC 服务端组件直查库（不走 HTTP API）                                     │
│    /projects、/projects/[id]、/projects/[id]/generate                           │
│    → lib/repositories/* → lib/db.ts → Prisma → SQLite                          │
│    ⚠ /projects/[id] 渲染时还会执行 evaluateProjectContext()（写库副作用）          │
│                                                                                │
│  通道 B：客户端组件 fetch 自家 Route Handlers                                     │
│    components/* → fetch("/api/...") → app/api/** → lib/services/*              │
│    → lib/repositories/* → Prisma → SQLite                                      │
└────────────────────────────────────────────────────────────────────────────────┘
```

关键事实：

- **前端不直接调 LLM、不拼 prompt、不 import Prisma**（已全库 grep 验证）；prompt 全部在 `lib/agent/prompts.ts`，仅服务端引用。
- 客户端组件之间用 `lib/client/workspaceEvents.ts`（CustomEvent 总线）做写后刷新。
- **后端是唯一智能核心**：碎片结构化、规则评估、行动闭环、成果生成、问答全部在 `lib/services` + `lib/agent`，Web 前端只是消费者之一。
- **这正是迁移鸿蒙的有利条件**：HarmonyOS App 可以作为后端的第二个消费者，与 Web 并列，走通道 B 的同一批 API。
- 数据库为单文件 SQLite，**无任何认证/鉴权**（本地工具假设）。手机演示需后端以 `next dev -H 0.0.0.0` 暴露在局域网。
- 现状数据痕迹：dev.db 中 2 个项目（seed 项目 + 1 条测试残留）、10 卡片、**370 条 AgentRun**——其中大量来自"每次打开项目详情页都触发一次 evaluate 写库"的 RSC 副作用（`app/projects/[id]/page.tsx:27`）。

---

## 3. 当前所有核心 API（23 个端点，全部已逐个核实）

统一约定：错误响应 `{ error: { code, message, details? } }`（zod 错误→422，业务错误→自定义码，其他→500）。无认证。

### Project

| 方法 | 路径 | 作用 | 实现性质 |
|---|---|---|---|
| GET | `/api/projects` | 项目列表，**每条内嵌 dashboard**（截止状态、准备度、关注度打分、下一步建议） | ✅ 真实查库 + 确定性计算 |
| POST | `/api/projects` | 创建项目（title/description/goal/scenario/deadline，zod 校验） | ✅ |
| GET | `/api/projects/:id` | 项目详情：全量卡片（含原文 Capture、出入关联边）+ 成果 + 计数 | ✅ |
| PATCH | `/api/projects/:id` | 部分更新 | ✅ |
| DELETE | `/api/projects/:id` | 删除（子表级联） | ✅ |

### Memory（Capture / KnowledgeCard）

| 方法 | 路径 | 作用 | 实现性质 |
|---|---|---|---|
| POST | `/api/projects/:id/captures` | **核心管线**：碎片 → Agent 结构化 → 关键词关联 → 事务写 Capture+Card+Relation | ⚠ LLM 可选，默认 mock 分类 |
| PATCH | `/api/projects/:id/cards/:cardId` | 人工纠错卡片 | ✅ |
| DELETE | `/api/projects/:id/cards/:cardId` | 删卡片（连带原文） | ✅ |

> **注意**：没有 `GET .../cards` 独立端点——卡片列表随 `GET /api/projects/:id` 返回；**没有独立的 memory search 端点**——检索能力目前只通过捕获时自动关联和 copilot 问答间接暴露。

### Intervention（= 计划文档中的 Risk / Intervention）

| 方法 | 路径 | 作用 | 实现性质 |
|---|---|---|---|
| POST | `/api/projects/:id/agent/evaluate` | **规则引擎评估**（5 条规则），upsert 介入、写 AgentRun；`scenario` 参数可注入演示模拟数据；`clearSimulation` 清除 | ✅ 真实规则引擎（`provider:"rules"`，非 LLM）；⚠ 模拟旁路任何人可调 |
| GET | `/api/projects/:id/interventions` | 介入列表（含 evidenceCard 摘要与关联行动） | ✅ |
| PATCH | `/api/projects/:id/interventions/:interventionId` | 状态机：ACCEPTED（按 actionIndex 从预存提案创建 Action）/ SNOOZED（需 snoozedUntil）/ DISMISSED / RESOLVED | ✅ 含幂等与迁移校验 |

### Action

| 方法 | 路径 | 作用 | 实现性质 |
|---|---|---|---|
| GET | `/api/projects/:id/actions` | 行动列表（含来源介入/卡片/结果卡引用） | ✅ |
| POST | `/api/projects/:id/actions` | 创建行动（同来源+标题会去重复用，200 `reused:true` / 201） | ✅ |
| PATCH | `/api/projects/:id/actions/:actionId` | 更新；**`status=DONE` 时触发闭环**：resultText → capture 管线 → reflection 卡片 → 介入置 RESOLVED | ⚠ 状态机真实；结构化复盘同 captures 双模式 |

### Artifact / Copilot / 审计 / 其他

| 方法 | 路径 | 作用 | 实现性质 |
|---|---|---|---|
| GET/POST | `/api/projects/:id/artifacts` | 列表 / 生成（无 content）或存编辑版本（有 content）；6 种类型 | ⚠ LLM 可选，默认模板填空 |
| GET/POST | `/api/projects/:id/agent/chat` | 最近 20 条对话 / 提问（引用真实卡片、幻觉引用被过滤、候选写操作需确认） | ⚠ mock 先行（正则意图分支），LLM 可选 |
| POST | `/api/projects/:id/agent/tools` | 确认执行 `create_action` / `generate_artifact`；**`confirmed != true` 直接 400** | ✅ 符合"不越权"原则 |
| GET | `/api/projects/:id/agent/runs` | Agent 运行审计（provider/status/trace/fallbackReason） | ✅ |
| GET | `/api/projects/:id/metrics` | 效果指标（关联率/接受率/闭环数等，**排除 isSimulated**） | ✅ |
| GET/POST | `/api/settings` | LLM 运行时配置（仅本机+非生产可写；密钥只回 hasApiKey） | ✅ |

---

## 4. 五大核心概念的实现位置（计划文档用语 → 代码实体）

| 计划概念 | 代码实体 | 实现位置 | 说明 |
|---|---|---|---|
| **Memory** | `Capture`（原文）+ `KnowledgeCard`(结构化卡片) + `CardRelation`(关联边) | 写：`lib/services/captureService.ts` → `lib/agent/index.ts` → `lib/repositories/cards.ts`（事务写三表）；检索：`lib/memory/linker.ts` + `lib/memory/vectorStore.ts` | 存储真实；检索是**纯关键词交集**（无 embedding/向量/FTS，候选池仅最近 50 卡）；`KeywordVectorStore.index()` 是空操作 |
| **Project State** | `Project.dashboard`（派生）+ `metrics` | `lib/projectDashboard.ts`（`buildProjectDashboard`：截止分级、准备度 6 项清单、下一步建议决策树、attentionScore 公式）；`lib/repositories/agent.ts#getProjectMetrics` | ✅ 真实规则计算（查库+公式，无 LLM、无硬编码假值），但属于启发式统计而非状态机建模 |
| **Risk** | 双路径：① `KnowledgeType="risk"` 卡片（用户记录的风险）；② `AgentIntervention` 的 `RISK_UNHANDLED` 等触发 | `lib/services/agentContextService.ts#evaluateProjectContext`：5 条规则（DEADLINE_NEAR / RISK_UNHANDLED / PROJECT_STALE / EXPERIMENT_GAP / MATERIAL_GAP） | ✅ 真实规则引擎，阈值硬编码（14 天/72 小时/≥2 论文卡等）；**不是 LLM**；AgentRun 中标记 `provider:"rules"` |
| **Evidence** | `AgentIntervention.evidence`(Json) + `evidenceCardId`(外键) | 产生于 `agentContextService.ts`（每条 match 带 `{rule, facts, cardIds?, evaluatedAt}`）；持久化于 schema；`acceptIntervention` 时把证据卡 id 传给 Action 的 `sourceCardId` | ✅ 双层结构：JSON 推理痕迹 + 外键证据链（卡片→介入→行动） |
| **Action** | `ActionItem` | `lib/services/actionService.ts` + `lib/repositories/agent.ts` | ✅ 状态机 TODO/DOING/DONE/CANCELLED；**完成即闭环**：resultText → 新 reflection 卡片 → 源介入 RESOLVED；模拟行动拒绝闭环（409） |

**结论：PLAN §17 要求的"确认当前代码是否已具备完整闭环"——答案是：已具备。** `Memory → State → Risk → Evidence → Confirm → Action → Memory` 每一环都有真实实现。

---

## 5. 真实实现 vs mock / hard-code / fallback 清单

### 5.1 真实实现 ✅

| 项 | 证据 |
|---|---|
| 全部持久化（9 表 CRUD、事务、级联删除） | `lib/repositories/*`，2 个 Prisma migration，dev.db 有 7/13–7/20 真实使用痕迹 |
| 介入状态机与去重 | `projectId+dedupeKey` 唯一约束；`INVALID_INTERVENTION_TRANSITION` 迁移校验；accept 幂等复用 |
| Action 完成回写 Memory | `completeProjectAction`：事务创建复盘卡片 + 关联边 + 介入 RESOLVED + AgentRun 留痕 |
| Evidence 组织 | JSON facts 来自真实查询；`evidenceCardId` 外键挂真实卡片 |
| Project State / metrics 计算 | 公式+查库，显式排除 `isSimulated` 数据 |
| 用户确认原则 | copilot 写操作 `confirmed != true` → 400 `CONFIRMATION_REQUIRED`；介入接受动作本身即确认 |
| 自我审计 | 每次 Agent 行为写 `AgentRun`（provider / status=SUCCESS|FALLBACK / fallbackReason / trace）——系统对"真实 vs 模拟"有元数据追踪 |

### 5.2 Mock / fallback（有意设计的降级路径）⚠

| 项 | 位置 | 说明 |
|---|---|---|
| 碎片结构化 mock | `lib/agent/mockAgent.ts` | 硬编码中文关键词词典分类（`containsAny(text,["风险","来不及",...])`）+ 固定 nextActions 文案；`LLM_MODE != openai-compatible` 或 LLM 异常时使用。**当前 .env 下这是实际生效路径** |
| 成果生成模板 | `lib/generators/templates.ts` | 6 套 Markdown 骨架，用**真实卡片数据**填空（不是随机假文本）；无卡片时 400 拦截 |
| Copilot mock 回答 | `lib/services/copilotService.ts:39-78` | 正则意图分支的确定性回答；LLM 失败时保留 mock 并标记 `fallback` |
| "向量检索" | `lib/memory/vectorStore.ts` | **名不副实**：`index()` 空操作，`search()` 实为关键词交集计数。无 embedding |

### 5.3 Hard-code / 需要注意的注入点 ⚠

| 项 | 位置 | 说明 |
|---|---|---|
| 演示情境模拟 | `agentContextService.ts` + `evaluateContextSchema` | `scenario: deadline_48h / stale_72h / risk_cluster` 会伪造触发条件并写入 `isSimulated=true` 介入（risk_cluster 甚至凭空编造证据）。有隔离（metrics 排除、可清除），**但 API 无权限区分，任何调用方可注入** |
| 规则阈值 | 5 条规则的 14 天/72 小时等 | 合理硬编码，但后续可调 |
| 首页演示物料 | `app/page.tsx:37-47` | 虚构项目卡 + 3 条 MemoryPreview，与 seed 双份维护 |
| 假功能 | `CaptureBox.tsx:181-196` | "上传文档"只弹"即将支持"提示（且用成功样式），误导性 stub |
| seed 数据 | `prisma/seed.ts` | 8 条硬编码 capture，走真实管线生成卡片——是演示数据，不是 mock 逻辑 |
| 前端业务常量 | 见 §7 | snooze 24h、重要性阈值 4、回执 ≥5 字等散在组件里 |

---

## 6. HarmonyOS 前端可以直接调用的 API

**前提**：HarmonyOS 的 `@ohos.net.http` 不受浏览器 CORS 约束（当前后端也没有任何 CORS 头，对原生客户端无影响）；后端需 `next dev -H 0.0.0.0 -p 3000`，真机用宿主机局域网 IP。

### MVP 直接可用（对应 Demo A/B/C 全链路）

| 用途 | 端点 | 鸿蒙页面 |
|---|---|---|
| 项目列表 + 驾驶舱状态（内嵌 dashboard） | `GET /api/projects` | Home |
| 触发一次评估（进页面时调一次，替代 Web 的 RSC 渲染期评估） | `POST /api/projects/:id/agent/evaluate`，body `{}` | Home 刷新 |
| 风险/介入列表（含 evidence、proposedActions） | `GET /api/projects/:id/interventions` | Home Insight / Intervention 页 |
| 接受建议→创建行动 | `PATCH /api/projects/:id/interventions/:iid` body `{status:"ACCEPTED", actionIndex:0}` | Intervention 页 [创建行动] |
| 稍后提醒 / 忽略 | 同上，`{status:"SNOOZED", snoozedUntil}` / `{status:"DISMISSED"}` | Intervention 页 |
| 行动板 | `GET /api/projects/:id/actions` | Action Board |
| 完成行动（**触发 Memory 回写闭环**） | `PATCH /api/projects/:id/actions/:aid` body `{status:"DONE", resultText:"…"}` | Action Board |
| 记忆时间线（卡片含原文、关联、时间） | `GET /api/projects/:id` | Memory Timeline |
| 快速记录碎片 | `POST /api/projects/:id/captures` body `{rawText, sourceType?}` | Home 快速输入 / 小艺场景 1 |
| 效果指标 | `GET /api/projects/:id/metrics` | Home 副区（P1 可放） |

### MVP 可用但注意

| 端点 | 注意点 |
|---|---|
| `POST /agent/evaluate` 带 `scenario` | 会注入模拟数据；正式演示别误传 |
| `POST /api/projects/:id/agent/chat` + `GET` + `POST /agent/tools` | 计划中的 `query_memory`/`inspect_project` 最接近的现成出口；P1 的记忆副驾驶页面直接用；mock 模式下回答是正则分支 |
| `POST /api/projects/:id/actions` | 手动建行动；**无 `confirmed_by_user` 字段**——PLAN §4.5 的确认语义目前靠"介入接受动作本身即确认"实现，直接创建通道没有确认标志 |

### 缺失、需要后端补的（都不阻塞 MVP）

| 计划文档要求 | 现状 | 建议 |
|---|---|---|
| `GET /projects/:id/state`（PLAN §5.1） | 无独立端点；状态分散在 `GET /projects` 的 dashboard 与 `/metrics` | P1 可加聚合端点；MVP 用现有两个拼 |
| `POST /projects/:id/memories/search`（PLAN §5.2） | 无；检索只在捕获关联与 copilot 内部 | P1：把 `lib/memory/linker` 暴露成独立端点，同时供小艺 `query_memory` 复用 |
| `confirmed_by_user` 强制校验（PLAN §4.5） | copilot tools 有；`POST /actions` 无 | P0 末/P1：给 actionCreateSchema 加可选确认来源校验（介入接受路径已天然满足） |

---

## 7. 错误地耦合在 Web 前端中的业务逻辑

（迁移时鸿蒙端**不要复制**这些逻辑；长期应下沉后端。按严重度排列）

| # | 级别 | 问题 | 位置 |
|---|---|---|---|
| 1 | 高 | **整块规则引擎被客户端组件 import，在浏览器执行**：提醒活跃判定 `isInterventionActive`、截止分级 `getDeadlineState`、准备度 `buildCompetitionReadiness`（含 `severity>=4` 风险判断）、关注度打分公式、行动"smart"排序 | `lib/projectDashboard.ts` ← `InterventionPanel.tsx:9,82`、`ActionBoard.tsx:9,62`、`ProjectList.tsx:37` |
| 2 | 高 | **RSC 页面渲染期执行 Agent 评估写库**（读页面带写副作用；dev.db 370 条 AgentRun 的主要来源） | `app/projects/[id]/page.tsx:27` |
| 3 | 中 | 业务策略写死在组件：snooze 固定 +24h（`InterventionPanel.tsx:93`）、"重点记录"阈值 importance≥4（`[id]/page.tsx:50`）、回执最少 5 字（`ActionBoard.tsx:115`）、默认场景 COMPETITION（`NewProjectForm.tsx:8`） | 前端 |
| 4 | 中 | 客户端做逾期判断、isSimulated 过滤、TODO/DOING/DONE 统计；且"当前时间"在挂载时冻结（`useState(() => new Date())`，久不刷新会失真） | `ActionBoard.tsx:48,58-61,194-195` |
| 5 | 中 | 首页硬编码 demo 物料（项目卡+3 条记忆预览），与 seed 双份维护 | `app/page.tsx:37-47,87` |
| 6 | 中 | 假功能：文件上传只显示"即将支持"的成功提示 | `CaptureBox.tsx:181-196` |
| 7 | 低 | 领域枚举/来源词表/长度校验前后端双份维护，无单一来源 | `lib/types.ts`、`CaptureBox.tsx:8-16`、`CardEditor.tsx:71-77` |
| 8 | 低 | 死代码遗留旧规则引擎（已被 InterventionPanel 取代） | `lib/suggestions.ts`、`components/ProactiveSuggestions.tsx` |
| 9 | 低 | 演示情境注入开关在前端（有 env 门控 + isSimulated 隔离，可接受但需标注） | `InterventionPanel.tsx:11,90` |

**对鸿蒙迁移的含义**：#1/#3/#4 意味着"同一个业务判断在 Web 前端还有一份影子实现"。鸿蒙端若照抄 Web 的行为，会把错误再抄一遍。正确做法：**鸿蒙端只做展示与确认交互，判断全部以 API 返回为准**（介入是否活跃看 `status/snoozedUntil` 字段原样渲染即可，排序可用后端返回顺序）。

---

## 8. HarmonyOS MVP 最少需要的页面和文件

现状：`harmonyos/` = DevEco 默认模板（唯一页面 `pages/Index.ets` 是 Hello World；无 components/models/services；**`module.json5` 未声明 `ohos.permission.INTERNET`**；bundleName 为 `com.example.projectmemo`；`signingConfigs` 为空）。

### 8.1 页面（对齐 PLAN §2.2 P0，Project 与 Home 合并）

| 页面 | 承载内容 | 数据来源 |
|---|---|---|
| `Home.ets`（驾驶舱） | 项目状态四格（Progress/Deadline/Risks/Pending）+ 最醒目的 Insight 卡 + 快速记录入口 | `GET /projects` + `POST /agent/evaluate` + `GET /interventions` |
| `MemoryTimeline.ets` | 按天分组的卡片流（类型/标题/摘要/原文来源/关联） | `GET /projects/:id` |
| `InterventionDetail.ets`（最重要页面） | What/Why/Evidence/Suggested Action + [创建行动][稍后提醒][忽略] | `GET /interventions` + `PATCH /interventions/:iid` |
| `ActionBoard.ets` | Today/Upcoming/Completed 三组 + 完成时填结果（触发 Memory 回写） | `GET /actions` + `PATCH /actions/:aid` |

导航：一个 Tabs（首页/记忆/行动）+ 介入详情 push，即可覆盖。

### 8.2 文件清单（约 16 个新文件）

```text
entry/src/main/ets/
├── common/Constants.ets            baseUrl（可切换 127.0.0.1 / 局域网 IP）
├── models/
│   ├── Project.ets                 对齐后端 Project + dashboard 字段
│   ├── Memory.ets                  KnowledgeCard（+ capture 原文、relations）
│   ├── Intervention.ets            AgentIntervention（severity 是 Int 1-5、
│   │                               evidence/proposedActions 是 JSON 数组）
│   └── Action.ets                  ActionItem（priority 是 Int 1-5）
├── services/
│   ├── ApiClient.ets               @ohos.net.http 封装：baseUrl+JSON+统一错误解析
│   ├── ProjectService.ets          list/evaluate
│   ├── MemoryService.ets           timeline、postCapture
│   ├── InterventionService.ets     list、accept/snooze/dismiss
│   └── ActionService.ets           list、complete（带 resultText）
└── pages/
    ├── Home.ets
    ├── MemoryTimeline.ets
    ├── InterventionDetail.ets
    └── ActionBoard.ets
```

### 8.3 配置改动（3 处，非代码逻辑）

1. `entry/src/main/module.json5`：加 `"requestPermissions": [{ "name": "ohos.permission.INTERNET" }]` —— **阻塞项，缺它网络请求直接失败**。
2. `resources/base/profile/main_pages.json`：注册 4 个新页面。
3. 提交前：bundleName 去掉 `com.example.`、补 signingConfig（真机自动签名）。

---

## 9. 从当前状态迁移到 HarmonyOS MVP 的最小改动路线

**原则：后端零改动（或近零），表现层全部新增在 harmonyos/ 内。**

### Step 0｜打通网络可达（0.5 天，不改代码）

- `npm.cmd run db:setup`（已就绪）→ `npm.cmd run dev -- -H 0.0.0.0` 启动后端；
- 手机/模拟器与宿主机同网段，`Constants.ets` 配宿主机 IP:3000；
- 用 curl/Postman 从另一台设备验证 `GET /api/projects` 可达。

### Step 1｜鸿蒙配置与网络层（0.5 天）

- INTERNET 权限、页面注册（§8.3）；
- `ApiClient.ets`：GET/POST/PATCH + JSON 序列化 + `{error:{code,message}}` 统一解析 + 网络异常兜底文案（PLAN DoD 要求"网络异常有合理 fallback"）。

### Step 2｜models + services（1 天）

- 按 §8.2 建 4 个 model、5 个 service；
- **字段对齐真实 API 而非 PLAN §5 的设想路径**（interventions 不是 risks；severity/priority 是整数；evidence/proposedActions 是数组）。

### Step 3｜四个 P0 页面（1.5–2 天）

- 按 §8.1 逐页实现；先跑通 **Demo C 主链路**（Intervention 详情 → 接受 → 行动板出现 → 填结果完成 → Memory 时间线出现复盘卡 → 再次 evaluate 后 Insight 变化）——这是复赛高潮，优先保证它稳定。

### Step 4｜演示数据与联调（0.5 天）

- `npm.cmd run db:seed` 灌入种子项目（8 条 capture 走真实管线）；
- 需要"deadline 逼近 + ablation pending"剧情时：直接编辑种子项目的 deadline / 补两条 capture，**不用 `scenario` 模拟参数**（避免 isSimulated 数据进入演示主线）；
- 全流程在真机录一遍，确认 5 分钟演示脚本（PLAN §13）可走通。

### 明确不做（保持最小改动）

- ❌ 不动后端现有 23 个端点的签名与行为；
- ❌ 不把 Web 前端逻辑翻译成 ArkTS（尤其 §7 的 #1/#3/#4）；
- ❌ 不引入真 LLM 依赖来"增强演示"（mock 模式离线稳定，符合 DoD"不依赖随机 LLM 输出"）；
- ❌ 不做账号/同步/推送（PLAN §2.2 P2）。

### 建议顺带做的近零成本后端小修（可选，P0 末尾）

| 项 | 理由 |
|---|---|
| `app/projects/[id]/page.tsx:27` 的渲染期 evaluate 改为显式触发 | 消除写放大（370 条 AgentRun 的根源）；不改不影响鸿蒙 |
| `POST /agent/evaluate` 的 `scenario` 参数加 env 门控（DEMO_SCENARIOS 已有前端门控，后端未校验） | 防止误注入模拟数据 |
| 删除 `lib/suggestions.ts` + `ProactiveSuggestions.tsx` 死代码 | 降低后来者误抄旧规则的概率 |

---

## 10. P0 / P1 / P2 TODO

### P0 —— 稳定 Demo 闭环（鸿蒙 MVP，复赛成立底线）

| # | TODO | 验收标准 |
|---|---|---|
| P0-1 | module.json5 加 INTERNET 权限 + 页面注册 + ApiClient.ets | 真机 `GET /api/projects` 成功返回 JSON；断网时显示兜底文案不崩溃 |
| P0-2 | models + 5 个 services（字段严格对齐真实 API） | 编译通过；每个 service 有至少一次真机调用成功记录 |
| P0-3 | Home 驾驶舱（状态四格 + Insight + 快速记录） | 数据来自 `GET /projects`+`evaluate`+`interventions`，无任何本地假数据 |
| P0-4 | Intervention 详情页（Evidence + 三按钮） | 接受后行动板出现该行动；忽略/稍后状态正确持久化（杀进程重进仍在） |
| P0-5 | Action Board（完成填结果 → 回写 Memory） | 完成行动后 Memory 时间线出现 reflection 卡；介入变 RESOLVED |
| P0-6 | Memory Timeline | capture 一条碎片后下拉刷新可见新卡片；能展示原文与关联 |
| P0-7 | Demo C 全链路真机彩排 | 5 分钟内无人工造数据走完 Insight→接受→完成→状态变化 |
| P0-8（后端可选） | 渲染期 evaluate 写放大修复 + scenario 参数门控 | AgentRun 不再随页面浏览增长；API 直传 scenario 在 DEMO_SCENARIOS=false 时被拒 |

### P1 —— 鸿蒙体验完善 + 后端小口径对齐

| # | TODO | 验收标准 |
|---|---|---|
| P1-1 | `GET /projects/:id/state` 聚合端点（合并 dashboard+metrics+top interventions） | Home 只调一个接口；Web 亦可切换复用 |
| P1-2 | `POST /projects/:id/cards/search`（暴露 linker 关键词检索） | 鸿蒙记忆页可搜索；为小艺 `query_memory` 铺路 |
| P1-3 | `POST /actions` 增加确认来源校验（对齐 PLAN §4.5 `confirmed_by_user`） | 无介入来源且无确认标志的创建被拒或显式标记 |
| P1-4 | 鸿蒙成果页（Artifact 列表 + 周报生成预览） | 调现有 artifacts API 即可 |
| P1-5 | 记忆副驾驶页（agent/chat + tools 确认流） | 回答带卡片引用；写操作需点确认 |
| P1-6 | 统一前后端枚举单一来源（OpenAPI/zod → 生成鸿蒙 types 或手工对齐文档） | 消除 §7-#7 双份维护 |
| P1-7 | 清理死代码（suggestions.ts / ProactiveSuggestions / 首页硬编码物料收敛到 seed） | grep 无残留引用 |

### P2 —— 小艺接入与评测（MVP 稳定后启动）

| # | TODO | 验收标准 |
|---|---|---|
| P2-1 | 小艺 Agent 四个场景映射到现有 API：record_memory→captures、query_memory→cards/search（P1-2）、inspect_project→state（P1-1）、create_action→介入接受或 tools 确认 | PLAN §8.1 四场景全部经真实后端 |
| P2-2 | 跨入口一致性验证 | 小艺记一条 → 鸿蒙 App 可见；App 的风险 → 小艺问得出同一 Evidence |
| P2-3 | Memory Recall / Risk Recall / Evidence Accuracy / Unauthorized Action Rate 最小 Benchmark | PLAN §10 四项指标各有数字，Unauthorized Action Rate = 0 |
| P2-4 | bundleName/签名/图标/应用名收尾，提交材料 | 通过真机安装与评审演示 |

---

## 附录：术语映射表（读代码时必备）

| PLAN 文档用语 | 代码实体 | API 路径 |
|---|---|---|
| Memory | Capture + KnowledgeCard | `/captures`、`/cards/:id`（列表在 `GET /projects/:id`） |
| Project State | project.dashboard + metrics | `GET /projects`、`/metrics` |
| Risk（用户记录的） | KnowledgeCard type="risk" | 同 Memory |
| Risk / Intervention（系统发现的） | AgentIntervention | `/agent/evaluate`、`/interventions` |
| Evidence | intervention.evidence + evidenceCardId | 随 interventions 返回 |
| Action | ActionItem | `/actions` |
| record_memory | — | `POST /captures` |
| query_memory | — | copilot chat（现成）；cards/search（待建，P1-2） |
| inspect_project | — | `GET /projects` + `/metrics`（待聚合，P1-1） |
| get_interventions | — | `GET /interventions` |
| create_action | — | `PATCH /interventions/:id`（accept）或 `POST /actions` |
| complete_action | — | `PATCH /actions/:id`（status=DONE + resultText） |
| generate_artifact | — | `POST /artifacts` |
