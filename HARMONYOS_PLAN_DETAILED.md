# ProjectMemo 鸿蒙复赛迁移与实现计划｜细化执行版

> 文档定位：**仅细化 HarmonyOS 迁移、小艺接入、复赛 Demo 与评测，不纳入 ProjectMemo 2.0 功能扩展。**  
> 基线仓库：`Leionel/projectmemo`  
> 基线分支：`master`  
> 基线提交：`c65fe9b1c9c0e6aacca423f503c4982f57e64331`  
> 更新时间：2026-08-19  
> 复赛提交截止：2026-09-30  
>
> 本文用于替代旧版 `HARMONYOS_PLAN.md` 中已经被真实代码状态推翻或过于抽象的部分，可供项目负责人、Codex、Claude Code、DevEco Code 共同执行。

---

# 0. 本阶段唯一目标

本阶段**不扩展 ProjectMemo 2.0**。

不做新的产品大方向，不做 Semantic Memory、多模态 Inbox、Milestone、Scheduling 等新增能力。

当前目标只有一个：

> **把初赛已经真实存在的 ProjectMemo 核心闭环，完整、稳定、原生地搬到 HarmonyOS，并增加小艺入口，使 App 与小艺共享同一个 ProjectMemo Backend。**

最终演示链：

$$
\text{Capture}
\rightarrow
\text{Memory}
\rightarrow
\text{Evaluate}
\rightarrow
\text{Intervention}
\rightarrow
\text{Evidence}
\rightarrow
\text{User Confirm}
\rightarrow
\text{Action}
\rightarrow
\text{Result}
\rightarrow
\text{Reflection Memory}
$$

产品表达：

> **ProjectMemo 不是 Todo App，也不是聊天机器人。它让长期项目记忆真正成为下一步行动的依据。**

核心原则：

> **主动介入，但不越权。**

---

# 1. 当前真实项目状态

## 1.1 Web / Backend：已经完成，不重新实现

当前仓库根目录就是 ProjectMemo 的 Next.js 主工程。

主要技术栈：

```text
Next.js 16
React 19
TypeScript
Prisma 7
SQLite
Zod
Vitest
Playwright
```

后端已经拥有完整核心闭环：

```text
Capture
↓
KnowledgeCard
↓
CardRelation
↓
Project Dashboard
↓
Agent Evaluate
↓
AgentIntervention
↓
Evidence
↓
Accept / Snooze / Dismiss
↓
ActionItem
↓
DONE + resultText
↓
Reflection Card
↓
Intervention RESOLVED
```

因此：

> **HarmonyOS 端只做第二个客户端，不复制 Backend 业务逻辑。**

## 1.2 当前后端真实实体

数据库中已有：

```text
Project
Capture
KnowledgeCard
CardRelation
GeneratedArtifact
AgentIntervention
ActionItem
AgentRun
AgentMessage
```

当前核心关系：

```text
Project
├─ Capture
│   └─ KnowledgeCard
│       ├─ outgoingLinks
│       └─ incomingLinks
│
├─ AgentIntervention
│   ├─ evidence
│   └─ proposedActions
│
├─ ActionItem
│   ├─ sourceIntervention
│   ├─ sourceCard
│   └─ resultCard
│
├─ GeneratedArtifact
├─ AgentRun
└─ AgentMessage
```

HarmonyOS 不需要改变此 schema。

---

# 2. 当前 HarmonyOS 工程状态

旧计划认为 HarmonyOS 工程是空模板，但仓库现在已经向前推进了一步。

## 2.1 已完成

目前已有：

```text
harmonyos/
└─ entry/src/main/ets/
   ├─ common/
   │  └─ Constants.ets
   │
   ├─ models/
   │  └─ Project.ets
   │
   ├─ services/
   │  ├─ ApiClient.ets
   │  └─ ProjectService.ets
   │
   └─ pages/
      └─ Index.ets
```

并且 `module.json5` 已经包含 `ohos.permission.INTERNET`。

当前 `Index.ets` 已经执行：

```text
HarmonyOS
↓
ProjectService.listProjects()
↓
GET /api/projects
↓
显示真实项目列表
```

所以：

> **Phase 0 的“建立鸿蒙项目、增加网络权限、第一次请求 Project API”已经基本完成。**

## 2.2 当前已经可用的 HarmonyOS 能力

### Project Model

`Project.ets` 已覆盖：

```text
Project
ProjectDashboard
DeadlineState
CompetitionReadiness
NextAction
_count
```

足够支撑项目列表与 Dashboard。

### ApiClient

当前已经有：

```text
GET
POST
```

并实现：

```text
JSON parse
HTTP error parse
network error fallback
10s connect timeout
10s read timeout
```

### ProjectService

当前已有：

```text
listProjects()
→ GET /api/projects
```

### Index

当前已有：

```text
Loading
Error + Retry
Empty
Project List
```

这是一个可以保留并继续扩展的良好起点。

---

# 3. 当前 HarmonyOS 主要缺口

更准确地说，当前状态是：

```text
工程初始化           ✅
网络权限             ✅
基础 ApiClient       🟡
Project Model        ✅
Project List         ✅

Memory Model         ❌
Intervention Model   ❌
Action Model         ❌

PATCH Client         ❌

Project Workspace    ❌
Memory Timeline      ❌
Intervention Detail  ❌
Action Board         ❌

核心闭环联调         ❌
小艺接入             ❌
Benchmark            ❌
提交打包             ❌
```

因此当前迁移进度可粗略视为：

> **HarmonyOS 基础层约 20%～25%，核心业务迁移尚未开始。**

---

# 4. 必须立即修正旧计划中的三个错误

## 4.1 不再按“设想 API”开发

旧计划中写了：

```http
GET /api/projects/:id/state
GET /api/projects/:id/memories
POST /api/projects/:id/memories/search
GET /api/projects/:id/risks
POST /api/projects/:id/interventions/:id/feedback
POST /api/actions/:id/complete
```

这些不是当前真实 API。

**当前迁移阶段不要为了对齐旧计划而新增这些接口。**

HarmonyOS 必须直接消费现有真实 API。

## 4.2 不复制 Web 前端规则

Web 前端中还有一部分影子逻辑，例如 deadline 判断、snooze 默认时间、attention score、readiness 和 smart sort。

HarmonyOS 不允许复制这些规则。

原则：

```text
Backend 返回什么
HarmonyOS 展示什么
```

HarmonyOS 只负责：

```text
Render
Navigation
User Input
User Confirmation
API Call
Refresh
```

而不是重新判断：

```text
这个 Risk 是否严重
这个 Intervention 是否应该显示
这个项目是否接近截止
```

## 4.3 小艺不需要新造一套 Agent Backend

正确：

```text
HarmonyOS ─┐
           ├─→ ProjectMemo Backend
小艺 ──────┘
```

不同入口必须共享同一份：

```text
Project
Memory
Intervention
Action
Evidence
```

---

# 5. 当前真实 API：HarmonyOS 唯一接口基线

## 5.1 Project

### 项目列表

```http
GET /api/projects
```

返回：

```text
projects[]
├─ id
├─ title
├─ description
├─ goal
├─ scenario
├─ deadline
├─ createdAt
├─ updatedAt
├─ _count
│  ├─ cards
│  └─ artifacts
└─ dashboard
   ├─ activeReminderCount
   ├─ highestReminderSeverity
   ├─ activeActionCount
   ├─ deadline
   ├─ readiness
   ├─ nextAction
   └─ attentionScore
```

当前 `Project.ets` 已基本建好。

### 项目详情

```http
GET /api/projects/:id
```

返回：

```text
project
├─ basic info
├─ cards[]
│  ├─ capture
│  ├─ outgoingLinks
│  └─ incomingLinks
├─ artifacts[]
└─ _count
```

这是 Memory Timeline 的数据来源。

## 5.2 Capture / Memory

### 写入新碎片

```http
POST /api/projects/:id/captures
```

body：

```json
{
  "rawText": "今天 baseline 跑通了，但 accuracy 比论文低 2%",
  "sourceType": "manual"
}
```

真实管线：

```text
rawText
↓
Agent structure
↓
Capture
↓
KnowledgeCard
↓
CardRelation
```

## 5.3 Agent Evaluate

```http
POST /api/projects/:id/agent/evaluate
```

正式演示：

```json
{}
```

**不要传 `scenario`。**

`scenario=deadline_48h / stale_72h / risk_cluster` 属于模拟旁路，正式 Demo 尽量使用真实 seed/project data 触发 Intervention。

## 5.4 Intervention

### 获取 Intervention

```http
GET /api/projects/:id/interventions
```

核心字段：

```text
id
projectId
triggerType
status
severity
title
content
evidence
proposedActions
isSimulated
snoozedUntil
dismissReason
handledAt
evidenceCardId
createdAt
updatedAt
actions[]
```

### 接受建议

```http
PATCH /api/projects/:id/interventions/:interventionId
```

body：

```json
{
  "status": "ACCEPTED",
  "actionIndex": 0
}
```

这一步本身就是用户确认创建 Action。

### 稍后提醒

```json
{
  "status": "SNOOZED",
  "snoozedUntil": "2026-08-21T10:00:00.000Z"
}
```

### 忽略

```json
{
  "status": "DISMISSED",
  "dismissReason": "当前暂不处理"
}
```

## 5.5 Action

### 获取 Action

```http
GET /api/projects/:id/actions
```

Action 状态：

```text
TODO
DOING
DONE
CANCELLED
```

### 完成 Action

```http
PATCH /api/projects/:id/actions/:actionId
```

body：

```json
{
  "status": "DONE",
  "resultText": "完成消融实验，结果显示模块 A 提升约 1.8%。"
}
```

成功后 Backend 自动：

```text
Action DONE
↓
创建 Reflection Memory
↓
resultCardId
↓
source Intervention RESOLVED
```

这是复赛最关键的闭环。

## 5.6 Metrics

```http
GET /api/projects/:id/metrics
```

P1 使用。

## 5.7 Agent Chat

```http
POST /api/projects/:id/agent/chat
```

body：

```json
{
  "message": "这个项目现在最需要注意什么？"
}
```

返回：

```text
message
citations[]
proposedActions[]
runId
fallback
```

小艺阶段可以直接复用。

## 5.8 Agent Tool Confirm

```http
POST /api/projects/:id/agent/tools
```

body：

```json
{
  "tool": "create_action",
  "confirmed": true,
  "payload": {}
}
```

该接口已经具备用户确认约束。

---

# 6. HarmonyOS 最终 P0 架构

推荐：

```text
entry/src/main/ets/
│
├─ common/
│  └─ Constants.ets
│
├─ models/
│  ├─ Project.ets               ✅ 已有
│  ├─ Memory.ets                ← 新增
│  ├─ Intervention.ets          ← 新增
│  └─ Action.ets                ← 新增
│
├─ services/
│  ├─ ApiClient.ets             🟡 扩展 PATCH
│  ├─ ProjectService.ets        🟡 扩展 detail/evaluate
│  ├─ MemoryService.ets         ← 新增
│  ├─ InterventionService.ets   ← 新增
│  └─ ActionService.ets         ← 新增
│
├─ components/
│  ├─ ProjectCard.ets
│  ├─ StatusSummary.ets
│  ├─ InsightCard.ets
│  ├─ MemoryCard.ets
│  ├─ EvidenceList.ets
│  └─ ActionCard.ets
│
└─ pages/
   ├─ Index.ets                 ✅ 已有项目列表
   ├─ ProjectHome.ets           ← 新增
   ├─ MemoryTimeline.ets        ← 新增
   ├─ InterventionDetail.ets    ← 新增
   └─ ActionBoard.ets           ← 新增
```

---

# 7. 页面结构

## 7.1 Index：项目入口

保留当前 Index。

本轮改造：

```text
Project Card
├─ title
├─ scenario
├─ deadline
├─ readiness
├─ active reminders
└─ next action
```

点击：

```text
Index
↓
ProjectHome
```

## 7.2 ProjectHome：项目驾驶舱

显示顺序：

```text
Project Name

Project State
├─ Deadline
├─ Readiness
├─ Active Risk
└─ Active Actions

ProjectMemo Insight
├─ Highest Priority Intervention
├─ Severity
├─ Reason summary
└─ 查看依据

Quick Capture
└─ 记录一条项目碎片

Entry
├─ Memory
└─ Actions
```

## 7.3 MemoryTimeline

数据源：

```http
GET /api/projects/:id
```

只展示：

```text
KnowledgeCard
├─ type
├─ title
├─ summary
├─ createdAt
├─ original capture
└─ related cards
```

第一版不做 Semantic Search、Graph Visualization、复杂 Filter。

## 7.4 InterventionDetail

必须完整展示：

```text
What
Why
Evidence
Suggested Action
Human Decision
```

按钮必须真实 PATCH Backend。

## 7.5 ActionBoard

第一版只做：

```text
进行中
待开始
已完成
```

完成时填写结果并真实 PATCH，随后刷新 Action / Memory / Intervention / Project Dashboard。

---

# 8. 当前第一优先级：补齐 HarmonyOS Data Layer

## Task H1｜修正网络配置

当前：

```text
Constants.BASE_URL = http://10.0.2.2:3000
```

至少改成清晰可替换的开发配置，并在 README 说明真机时使用电脑局域网 IP。

建议根 `package.json` 增加：

```json
"dev:harmony": "next dev -H 0.0.0.0 -p 3000"
```

## Task H2｜扩展 ApiClient

必须增加：

```text
PATCH
```

并正确处理：

```text
200
201
204
```

避免 204 时 `JSON.parse("")`。

## Task H3｜补 Memory Model

建议最小模型：

```text
CaptureSummary
CardRelationSummary
KnowledgeCard
ProjectDetail
```

只建当前 UI 真正使用字段。

## Task H4｜补 Intervention Model

对齐：

```text
AgentEvidence
ProposedAction
Intervention
```

注意：

```text
severity = Int 1~5
```

## Task H5｜补 Action Model

对齐：

```text
ActionItem
```

## Task H6｜补 Services

### ProjectService

```text
listProjects()
getProjectDetail(id)
evaluateProject(id)
```

### MemoryService

```text
getTimeline(projectId)
capture(projectId, rawText, sourceType)
```

### InterventionService

```text
list(projectId)
accept(projectId, interventionId, actionIndex)
snooze(projectId, interventionId, until)
dismiss(projectId, interventionId, reason)
```

### ActionService

```text
list(projectId)
updateStatus(...)
complete(projectId, actionId, resultText)
```

---

# 9. 第二优先级：先跑通 Demo C

不要等所有页面做完。

先跑：

```text
Project
↓
Evaluate
↓
Intervention
↓
Evidence
↓
Accept
↓
Action
↓
Complete
↓
Reflection
↓
Resolved
```

## Demo C 验收步骤

1. `GET /api/projects`
2. `POST /api/projects/:id/agent/evaluate` body `{}`
3. `GET /api/projects/:id/interventions`
4. 展示 Evidence
5. PATCH Intervention `{status:"ACCEPTED", actionIndex:0}`
6. `GET /api/projects/:id/actions`
7. PATCH Action `{status:"DONE", resultText:"..."}`
8. `GET /api/projects/:id`，确认出现 reflection
9. `GET /api/projects/:id/interventions`，确认源 intervention 为 RESOLVED

Definition of Done：

```text
[ ] Risk 来自 Backend
[ ] Evidence 来自 Backend
[ ] 没有 hard-coded 风险
[ ] Accept 真实创建 Action
[ ] 重复 Accept 不产生重复 Action
[ ] DONE 必须填写 resultText
[ ] 完成后生成 Reflection
[ ] Intervention RESOLVED
[ ] App 重新打开数据仍在
```

---

# 10. 第三优先级：Capture 与 Memory

ProjectHome 增加快速记录：

```text
[快速记录]
```

发送：

```http
POST /api/projects/:id/captures
```

成功后：

```text
Capture Success
↓
刷新 Project Detail
↓
新的 KnowledgeCard 出现在 Memory
```

避免页面渲染自动触发 Agent 写操作。

---

# 11. 第四优先级：Project State

本阶段不新增 `/state`。

使用：

```text
GET /api/projects → dashboard
GET /api/projects/:id/metrics → P1
```

ProjectHome P0 展示：

```text
Deadline
Readiness
Active Reminder Count
Active Action Count
Next Action
```

---

# 12. 小艺接入：只映射现有 API

HarmonyOS MVP 稳定后开始。

## record_memory

```text
POST /captures
```

## query_memory

本阶段直接使用：

```text
POST /agent/chat
```

不要新造 `/memories/search`。

## inspect_project

优先：

```text
POST /agent/chat
```

或组合读取现有项目/介入/指标接口。

## create_action

来源于 Intervention：

```text
PATCH Intervention → ACCEPTED
```

来源于 Copilot：

```text
POST /agent/tools
confirmed=true
```

## 小艺最小 Demo

### Demo X1

```text
小艺记录 baseline 完成
↓
captures API
↓
HarmonyOS Memory 可见
```

### Demo X2

```text
小艺询问当前项目风险
↓
agent/chat
↓
回答 + citations
```

---

# 13. LLM 模式

当前默认：

```env
LLM_MODE="mock"
```

迁移阶段顺序：

```text
HarmonyOS 闭环
→ mock 稳定
→ openai-compatible smoke
→ fallback 验证
```

不要把“接真实模型”和“鸿蒙迁移”同时 Debug。

---

# 14. 网络与运行环境

## 本地 Backend

```powershell
npm.cmd run db:setup
npm.cmd run dev -- -H 0.0.0.0 -p 3000
```

## 模拟器

当前 `10.0.2.2:3000` 必须实测，不要假定所有环境都有效。

## 真机

```text
手机和电脑同一网络
↓
http://<电脑局域网IP>:3000
```

## 提交环境

先完成：

```text
方案 A：本机 Backend + 鸿蒙真机
```

核心 Demo 稳定后再考虑部署 Demo Backend。

---

# 15. 提交前配置收尾

当前仍有：

```text
bundleName = com.example.projectmemo
vendor = example
signingConfigs = []
```

提交前处理：

```text
[ ] 正式 bundleName
[ ] vendor
[ ] App 名称
[ ] App 图标
[ ] versionName/versionCode
[ ] 真机签名
[ ] Release Build
```

建议 bundleName：

```text
com.leionel.projectmemo
```

最终以开发者账号配置为准。

---

# 16. 页面注册

当前 `main_pages.json` 只有 `pages/Index`。

完成 P0 后至少：

```json
{
  "src": [
    "pages/Index",
    "pages/ProjectHome",
    "pages/MemoryTimeline",
    "pages/InterventionDetail",
    "pages/ActionBoard"
  ]
}
```

---

# 17. UI 开发顺序

```text
Data
↓
Behavior
↓
Navigation
↓
State
↓
Visual
```

HarmonyOS-Design / frontend-design 在核心闭环稳定后再使用，且只改视觉与交互，不改 Backend/API。

---

# 18. 推荐里程碑

## M0｜当前

```text
HarmonyOS Project
INTERNET Permission
ApiClient GET/POST
Project Model
ProjectService
Project List
```

状态：✅

## M1｜数据层完整

建议：8 月 21 日前

```text
PATCH
Memory Model
Intervention Model
Action Model
Project detail/evaluate
MemoryService
InterventionService
ActionService
```

## M2｜Demo C 闭环

建议：8 月 24 日前

```text
ProjectHome
InterventionDetail
ActionBoard
Evaluate → Accept → Action → Complete → Reflection → Resolved
```

## M3｜Memory + Capture

建议：8 月 27 日前

```text
MemoryTimeline
Quick Capture
Original Source
Related Memory
```

## M4｜HarmonyOS MVP Freeze

建议：8 月 31 日前

```text
5 个页面稳定
核心闭环稳定
真机/模拟器运行
不依赖 Web UI
```

## M5｜小艺 MVP

建议：9 月 7 日前

```text
record
query/inspect
confirmed action
cross-entry consistency
```

## M6｜真实模型 + Fallback

建议：9 月 10 日前

## M7｜Benchmark

建议：9 月 15 日前

## M8｜复赛 Candidate

建议：9 月 20 日前

冻结功能，只允许 Bug/UI/文档/视频。

## M9｜Submission Freeze

建议：9 月 26 日。

---

# 19. 本周实际执行顺序

```text
1. 实测 Index 从真实 Backend 加载
2. 修正 BASE_URL 开发策略
3. ApiClient 增加 PATCH
4. Memory / Intervention / Action Models
5. Services
6. ProjectHome
7. InterventionDetail
8. ActionBoard
9. Demo C
10. MemoryTimeline
11. Quick Capture
```

本周不要做：

```text
小艺
2.0 新功能
Semantic Memory
多模态
复杂 UI 动效
Artifact 页面
```

---

# 20. Coding Agent 下一条 Prompt

```text
请读取：

1. HARMONYOS_PLAN_DETAILED.md
2. HARMONYOS_AUDIT.md
3. harmonyos/ 当前代码
4. lib/types.ts
5. lib/validation/schemas.ts
6. app/api/projects/**

本轮目标：
完成 HarmonyOS P0 数据层，不做 UI 美化，不做 ProjectMemo 2.0 新功能。

当前已有：
- INTERNET permission
- Constants.ets
- Project.ets
- ApiClient GET/POST
- ProjectService.listProjects()
- Index.ets 项目列表

请实施：

P0-1
扩展 ApiClient：
- PATCH
- 正确处理 200/201/204
- 保留统一 ApiError

P0-2
根据真实 Backend 类型新增：
- Memory.ets
- Intervention.ets
- Action.ets

P0-3
新增：
- MemoryService.ets
- InterventionService.ets
- ActionService.ets

P0-4
扩展 ProjectService：
- getProjectDetail
- evaluateProject

约束：
- 不修改 Prisma schema
- 不新增 /memories /risks /state 等虚构接口
- 不复制 Web 前端业务规则
- 不修改 Backend，除非发现真实阻塞
- 不使用 any 规避 ArkTS 类型检查
- 不做 UI redesign
- 不接小艺
- 不增加 2.0 功能

完成后：
1. 运行 ArkTS / DevEco 检查；
2. 构建 HarmonyOS 工程；
3. 输出修改文件；
4. 输出 service → Backend API 映射；
5. 给出 DevEco Studio 手工验证步骤；
6. 如果有无法确认的 API 字段，先报告，不猜。
```

---

# 21. 第二轮 Coding Agent Prompt

```text
读取 HARMONYOS_PLAN_DETAILED.md。

现在只实现 Demo C：

Project
→ Evaluate
→ Intervention
→ Evidence
→ Accept
→ Action
→ Complete
→ Reflection
→ Resolved

新增：
- ProjectHome.ets
- InterventionDetail.ets
- ActionBoard.ets

要求：
- 使用真实 Backend
- evaluate body = {}
- 不使用 scenario 模拟参数
- Intervention Evidence 必须来自 API
- Accept 必须 PATCH intervention
- 完成 Action 必须提交 resultText
- 完成后刷新 Action / Intervention / Project Detail
- 不 hard-code Risk
- Loading / Error / Empty 必须存在
- 暂不做 UI 美化
```

---

# 22. 第三轮 Coding Agent Prompt

```text
现在实现 Memory / Capture。

新增：
- MemoryTimeline.ets
- Quick Capture interaction

数据：
GET /api/projects/:id
POST /api/projects/:id/captures

要求：
- 展示真实 KnowledgeCard
- 展示 type/title/summary/time
- 能查看原始 Capture
- 能展示 related cards
- Capture 成功后自动刷新 Memory
- 不实现 Semantic Search
- 不实现 Graph
- 不增加 2.0 功能
```

---

# 23. 每次 Agent 开发必须输出

```text
Task
Priority
Files to Change
Backend APIs Used
Business Logic Changed?
How to Verify
```

正常情况下：

```text
Business Logic Changed? = No
```

---

# 24. 当前风险清单

## R1｜BASE_URL 写死

M1 前解决环境切换。

## R2｜ApiClient 无 PATCH

这是当前第一开发阻塞项。

## R3｜UI 先行

Demo C 优先于 UI。

## R4｜误用 simulated scenario

正式演示 `evaluate` 永远 `{}`。

## R5｜把 HarmonyOS 做成 Web 翻版

只保留：

```text
Project
Insight
Memory
Action
```

## R6｜同时开始小艺与 App

App P0 Freeze 后再接小艺。

## R7｜后端仅本机导致复现困难

8 月底确认本地复现方案或在线 Demo Backend。

---

# 25. 测试矩阵

## Project

```text
[ ] 正常加载
[ ] 空项目
[ ] Backend 不可达
[ ] Retry
```

## Capture

```text
[ ] >=5 字正常
[ ] <5 字显示 Backend validation
[ ] 保存后 Memory 刷新
```

## Intervention

```text
[ ] OPEN
[ ] ACCEPTED
[ ] SNOOZED
[ ] DISMISSED
[ ] RESOLVED
[ ] Evidence 正确
```

## Action

```text
[ ] TODO
[ ] DOING
[ ] DONE
[ ] resultText <5 被拒
[ ] DONE 产生 Reflection
[ ] DONE 解决 Intervention
```

## Safety

```text
[ ] 不点确认不会创建 Action
[ ] 重复 Accept 不重复创建
[ ] simulated 数据不混入正式 Demo
```

## Network

```text
[ ] Emulator
[ ] Real Device
[ ] Backend restart
[ ] Timeout
```

---

# 26. HarmonyOS MVP Definition of Done

## 技术

- [ ] ArkTS 构建通过
- [ ] HAP 可安装
- [ ] Backend 可访问
- [ ] GET/POST/PATCH 完整
- [ ] 无核心业务逻辑复制到客户端

## 页面

- [ ] Index
- [ ] ProjectHome
- [ ] MemoryTimeline
- [ ] InterventionDetail
- [ ] ActionBoard

## 核心闭环

- [ ] Capture
- [ ] Memory
- [ ] Evaluate
- [ ] Intervention
- [ ] Evidence
- [ ] Confirm
- [ ] Action
- [ ] Complete
- [ ] Reflection
- [ ] Resolved

## 体验

- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] Retry
- [ ] 用户操作反馈

## 演示

- [ ] 不打开 Web 页面也能完成核心 Demo
- [ ] 不调用 simulated scenario
- [ ] 数据刷新后仍存在
- [ ] 3 分钟内可跑完整核心闭环

---

# 27. 小艺 MVP Definition of Done

- [ ] 小艺可以写 Capture
- [ ] 写入后 HarmonyOS 能看到
- [ ] 小艺可以查询项目现状
- [ ] 回答可以引用当前 Project Memory
- [ ] 小艺不能未经确认创建 Action
- [ ] App 与小艺共享同一 Backend
- [ ] 小艺失败不破坏 HarmonyOS 主 Demo

---

# 28. 最终技术架构

```text
                        ┌──────────────┐
                        │     小艺      │
                        └──────┬───────┘
                               │
                               ↓
┌─────────────────────────────────────────────────────┐
│               ProjectMemo Backend                   │
│                                                     │
│ Capture Service                                     │
│ Agent / Mock Provider                               │
│ Project Dashboard                                   │
│ Intervention Rule Engine                            │
│ Evidence                                            │
│ Action State Machine                                │
│ Artifact / Copilot                                  │
│                                                     │
│ Prisma → SQLite                                     │
└────────────────────────┬────────────────────────────┘
                         │ HTTP
                         ↓
             ┌────────────────────────┐
             │    HarmonyOS Native    │
             │ Index                  │
             │ ProjectHome            │
             │ MemoryTimeline         │
             │ InterventionDetail     │
             │ ActionBoard            │
             └────────────────────────┘
```

不存在第二份 Memory、第二份 Risk Engine、第二份 Project State。

---

# 29. 复赛 Demo 主线

```text
HarmonyOS Project
↓
Capture
↓
Memory
↓
Evaluate
↓
ProjectMemo Insight
↓
Evidence
↓
User Accept
↓
Action
↓
DONE + resultText
↓
Reflection
↓
RESOLVED
↓
小艺查询当前项目
```

---

# 30. 本计划的冻结边界

直到 HarmonyOS MVP + 小艺 MVP 完成前，以下内容全部留给 `PROJECTMEMO_2.0_PLAN.md`：

```text
Semantic Memory
Embedding
多模态 Inbox
Meeting Mode
Milestone
Deliverable
Scheduling
Calendar
GitHub Connector
高级 Memory Graph
系统级通知
服务卡片
实况窗
跨设备深度协同
```

不得抢占当前迁移主线资源。

---

# 31. 当前下一步

基于仓库现状，现在下一步不是再 Audit，也不是设计 UI。

直接执行：

```text
ApiClient PATCH
↓
Memory / Intervention / Action Models
↓
Services
↓
ProjectHome
↓
InterventionDetail
↓
ActionBoard
↓
Demo C
```

第一验收节点：

> **在 HarmonyOS 中，不打开 Web 页面，真实完成一次  
> Intervention → Evidence → Accept → Action → DONE → Reflection → RESOLVED。**
