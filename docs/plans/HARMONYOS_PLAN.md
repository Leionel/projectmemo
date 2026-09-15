# ProjectMemo 鸿蒙复赛迁移与实现计划

> 文档用途：供项目负责人和 Coding Agent / AI Agent 共同执行。  
> 当前阶段：复赛准备期  
> 核心策略：**保留现有 ProjectMemo 后端与 Agent 逻辑，新增轻量 HarmonyOS 原生 App，并接入小艺 Agent，形成“App + Agent + 小艺 + Backend”的完整产品形态。**

---

## 0. 一句话目标

在复赛提交前，将 ProjectMemo 从当前的 Web / Demo 形态升级为：

> **一个以长期项目记忆为核心、能够理解项目状态、发现风险、给出证据并在用户确认后推动行动的 HarmonyOS 原生 Agent 产品。**

最终必须让评委清楚看到：

$$
\text{Memory}
\rightarrow
\text{Project State}
\rightarrow
\text{Risk Detection}
\rightarrow
\text{Intervention}
\rightarrow
\text{User Confirmation}
\rightarrow
\text{Action}
\rightarrow
\text{New Memory}
$$

ProjectMemo 的竞争力不应被表达成“AI 项目管理 App”，而应表达为：

> **让长期项目记忆真正转化为下一步行动。**

---

# 1. 最终产品形态

## 1.1 总体架构

```text
                     ┌──────────────────────┐
                     │       小艺入口        │
                     │ ProjectMemo Agent    │
                     └──────────┬───────────┘
                                │
                                │ API / Agent Capability
                                ↓
┌──────────────────────────────────────────────────────────┐
│                  ProjectMemo Backend                     │
│                                                          │
│  Project State                                           │
│  Memory Engine                                           │
│  Evidence Engine                                         │
│  Risk Detection                                          │
│  Intervention Policy                                     │
│  Action Management                                       │
│  Artifact / Weekly Report Generation                     │
└───────────────────────┬──────────────────────────────────┘
                        │
                        │ HTTPS API
                        ↓
             ┌─────────────────────────┐
             │     HarmonyOS App       │
             │                         │
             │  Home / Dashboard       │
             │  Project                │
             │  Memory Timeline        │
             │  Risk / Intervention    │
             │  Action Board           │
             └─────────────────────────┘
```

## 1.2 各层职责

### A. HarmonyOS App：产品主体与可视化空间

负责：

- 项目总览；
- 项目状态；
- 长期记忆时间线；
- 风险与依据展示；
- 用户确认；
- Action Board；
- Agent 处理结果的可视化。

**不负责重新实现核心 AI / Agent 算法。**

### B. ProjectMemo Backend：统一智能核心

负责：

- 项目数据；
- Memory 写入与查询；
- 项目状态计算；
- 风险识别；
- Evidence 组织；
- Intervention 判断；
- Action 创建与更新；
- 成果生成；
- 为 HarmonyOS App 和小艺 Agent 提供统一 API。

### C. 小艺 Agent：系统级自然语言入口

负责：

- 快速记录项目碎片；
- 查询历史记忆；
- 查询项目状态；
- 查看当前风险；
- 发起行动建议；
- 在用户确认后创建任务。

小艺不是 ProjectMemo 的全部产品，而是 **ProjectMemo Agent 的系统级入口之一**。

---

# 2. 技术原则

## 2.1 不推倒重写

必须最大化复用现有：

```text
Existing ProjectMemo
├── Backend
├── Database
├── Memory Logic
├── Risk Logic
├── Evidence Logic
├── LLM Layer
├── Action Logic
└── Existing Web Demo
```

新增：

```text
ProjectMemo-HarmonyOS
└── Native HarmonyOS Frontend

Xiaoyi / 小艺
└── ProjectMemo Agent Entry
```

原则：

> **迁移表现层，保留智能核心。**

---

## 2.2 HarmonyOS 原生优先，但只迁必要部分

禁止在复赛阶段做“全量鸿蒙重写”。

HarmonyOS App 只实现复赛真正需要展示的核心流程。

### P0 页面

1. Home / 项目驾驶舱
2. Project Detail
3. Memory Timeline
4. Risk / Intervention
5. Action Board

如果时间紧，Project Detail 与 Home 可以合并。

### P1 页面

- Weekly Report / Artifact
- Project Memory Graph
- Settings

### P2：复赛前不做

- 完整账号系统；
- 完整多用户协作；
- 社区；
- 复杂权限；
- 大量动画；
- 全量 Web 功能迁移；
- 本地大模型部署；
- 全平台数据同步；
- 与项目主线无关的新增功能。

---

# 3. 核心 Demo 闭环

复赛版本至少必须稳定跑通下面三条链路。

## 3.1 Demo A：项目记忆 Capture

### 用户输入

> “今天 baseline 跑通了，但是 accuracy 比论文低 2%。”

### Agent 处理

抽取：

```json
{
  "type": "experiment",
  "project_id": "...",
  "event": "baseline reproduction",
  "status": "completed",
  "issue": "accuracy 低于论文约 2%",
  "source": "user_input"
}
```

### 系统行为

1. 保存为 Memory；
2. 更新项目状态；
3. 出现在 Memory Timeline；
4. 后续状态判断可以引用这条记录。

### 验收标准

- 数据必须真实保存；
- App 刷新后仍存在；
- 查询时能够召回；
- Risk Engine 可以引用。

---

## 3.2 Demo B：项目状态理解

用户：

> “ProjectMemo，我这个项目现在怎么样？”

Agent 返回结构化状态：

```text
Progress
Risks
Pending Decisions
Missing Evidence
Upcoming Deadlines
Suggested Next Action
```

示例：

```text
当前状态：存在中等风险

已完成
- Baseline reproduction

待完成
- Ablation experiment

主要风险
- 距离组会还有 3 天
- Ablation experiment 尚无结果

建议
- 今天优先完成 ablation experiment
```

### 验收标准

不能只是把数据库内容简单 summarization。

必须体现：

> **历史信息 → 当前状态推断**

---

## 3.3 Demo C：主动介入闭环

这是 ProjectMemo 复赛最重要的 Demo。

已有记忆：

```text
8/15  导师要求本周完成消融实验
8/17  Ablation 状态仍然 pending
8/18  仍没有实验结果
8/21  组会
```

ProjectMemo 判断：

```text
Risk:
Ablation experiment may delay weekly presentation.

Evidence:
1. 导师要求本周完成；
2. 当前任务仍 pending；
3. 未发现对应实验结果；
4. 距离组会仅剩 3 天。
```

界面展示：

```text
ProjectMemo Insight

消融实验可能影响本周汇报

为什么提醒我？
- 8/15 导师要求本周完成
- 8/17 任务仍未开始
- 当前没有找到实验结果
- 距离组会还有 3 天

建议：
今晚优先运行 Ablation Experiment

[创建行动]
[稍后提醒]
[忽略]
```

用户点击：

```text
创建行动
```

生成：

```text
Action:
完成 Ablation Experiment

Priority:
High

Reason:
当前关键实验缺失且距离组会仅 3 天
```

完成 Action 后：

```text
Action Completed
      ↓
Result Recorded
      ↓
New Memory
      ↓
Project State Updated
```

### 验收标准

必须满足：

- 风险不是写死的；
- Evidence 来源于真实 Memory；
- Agent 不自动越权执行；
- 必须由用户确认后创建 Action；
- Action 完成后能回写 Memory。

---

# 4. ProjectMemo Agent Capability 设计

不要做几十个 Tool。

第一版只保留以下核心能力。

## 4.1 `record_memory`

用途：

> 记录新的项目事实。

输入：

```json
{
  "project_id": "string",
  "content": "string",
  "source": "user | file | action | system"
}
```

输出：

```json
{
  "memory_id": "string",
  "type": "experiment | task | decision | deadline | note | issue",
  "summary": "string",
  "entities": [],
  "created_at": "datetime"
}
```

---

## 4.2 `query_memory`

用途：

> 从项目长期记忆中检索与当前问题有关的信息。

输入：

```json
{
  "project_id": "string",
  "query": "string",
  "top_k": 5
}
```

输出：

```json
{
  "memories": [
    {
      "memory_id": "...",
      "summary": "...",
      "created_at": "...",
      "relevance": 0.92
    }
  ]
}
```

---

## 4.3 `inspect_project`

用途：

> 综合长期记忆、任务、截止时间与历史状态，生成当前 Project State。

输出建议：

```json
{
  "progress": [],
  "risks": [],
  "pending_decisions": [],
  "missing_evidence": [],
  "deadlines": [],
  "suggested_actions": []
}
```

---

## 4.4 `get_interventions`

用途：

> 判断当前是否存在值得主动提醒的情况。

输出：

```json
{
  "interventions": [
    {
      "risk_id": "...",
      "title": "...",
      "severity": "low | medium | high",
      "reason": "...",
      "evidence": [],
      "suggested_action": "..."
    }
  ]
}
```

---

## 4.5 `create_action`

用途：

> 用户确认以后，将建议变为行动。

输入：

```json
{
  "project_id": "...",
  "title": "...",
  "due_at": "...",
  "priority": "...",
  "reason": "...",
  "confirmed_by_user": true
}
```

如果：

```text
confirmed_by_user != true
```

则禁止创建。

这是 ProjectMemo 的产品原则：

> **主动介入，但不越权。**

---

## 4.6 `complete_action`

Action 完成以后：

1. 更新 Action；
2. 生成完成事件；
3. 写回项目 Memory；
4. 重新计算 Project State。

---

## 4.7 `generate_artifact`

P1 能力。

用途：

- 周报；
- 组会摘要；
- 当前项目总结；
- 阶段成果。

必须尽量引用 Memory / Evidence，而不是无依据生成。

---

# 5. Backend API 建议

现有后端如果接口不同，可以保留实现，只统一语义。

## 5.1 Project

```http
GET /api/projects
GET /api/projects/:id
GET /api/projects/:id/state
```

## 5.2 Memory

```http
GET  /api/projects/:id/memories
POST /api/projects/:id/memories
POST /api/projects/:id/memories/search
```

## 5.3 Risk / Intervention

```http
GET  /api/projects/:id/risks
GET  /api/projects/:id/interventions
POST /api/projects/:id/interventions/:id/feedback
```

feedback：

```text
accept
remind_later
ignore
```

## 5.4 Action

```http
GET   /api/projects/:id/actions
POST  /api/projects/:id/actions
PATCH /api/actions/:id
POST  /api/actions/:id/complete
```

---

# 6. HarmonyOS App 实现规划

建议使用：

```text
DevEco Studio
ArkTS
ArkUI
Stage Model
```

目录建议：

```text
ProjectMemo-HarmonyOS/

entry/src/main/ets/
│
├── pages/
│   ├── Home.ets
│   ├── Project.ets
│   ├── Memory.ets
│   ├── Intervention.ets
│   └── Actions.ets
│
├── components/
│   ├── ProjectCard.ets
│   ├── StatusCard.ets
│   ├── MemoryItem.ets
│   ├── RiskCard.ets
│   ├── EvidenceCard.ets
│   └── ActionCard.ets
│
├── models/
│   ├── Project.ets
│   ├── Memory.ets
│   ├── Risk.ets
│   └── Action.ets
│
├── services/
│   ├── ApiClient.ets
│   ├── ProjectService.ets
│   ├── MemoryService.ets
│   └── ActionService.ets
│
└── utils/
```

---

# 7. HarmonyOS 页面设计

## 7.1 Home：Project Dashboard

核心信息：

```text
ProjectMemo

当前项目：
Diffusion Language Model Harness

Status
─────────────────────
Progress       64%
Deadline       3 days
Risks          2
Pending        3

ProjectMemo Insight

⚠ Ablation experiment stalled

持续时间：4 days
距离汇报：3 days

[查看原因]
```

页面最重要的不是“项目列表”，而是：

> **ProjectMemo 现在认为我最应该关注什么？**

---

## 7.2 Memory Timeline

展示：

```text
TODAY

18:22 · Experiment
Baseline reproduction completed

Evidence
output/result.json


14:35 · Decision
Learning rate changed to 5e-5

Reason
Original setting caused unstable loss
```

应该允许：

- 查看来源；
- 查看关联 Memory；
- 搜索历史；
- 查看被哪些 Risk 引用。

---

## 7.3 Intervention

整个复赛最重要页面。

每条风险必须具有：

```text
What
Why
Evidence
Suggested Action
Human Confirmation
```

禁止：

```text
⚠ 你的项目存在风险
```

这种没有证据的泛泛提醒。

---

## 7.4 Action Board

最少做：

```text
Today
Upcoming
Completed
```

Action 显示：

```text
Ablation Experiment

Priority: High
Due: Aug 21

Suggested by ProjectMemo

Reason:
Weekly meeting in 3 days and no experiment result exists.
```

---

# 8. 小艺 Agent 接入计划

## 8.1 第一阶段：只做四个场景

### 场景 1：快速记录

用户：

> “小艺，告诉 ProjectMemo，baseline 已经跑通了。”

执行：

```text
record_memory
```

---

### 场景 2：项目回忆

用户：

> “我之前为什么改学习率？”

执行：

```text
query_memory
```

---

### 场景 3：项目检查

用户：

> “ProjectMemo，我这个项目现在有什么问题？”

执行：

```text
inspect_project
```

---

### 场景 4：行动确认

Agent：

> “距离组会只剩 3 天，但消融实验尚未完成。是否创建高优先级行动？”

用户：

> “创建。”

执行：

```text
create_action
```

---

# 9. 主动介入机制

ProjectMemo 不能变成疯狂发通知的 Agent。

建议第一版 Intervention Score：

$$
I =
w_dD+
w_sS+
w_uU+
w_eE+
w_hH
$$

其中：

- $D$：Deadline proximity；
- $S$：Stagnation；
- $U$：Unresolved issue；
- $E$：Evidence gap；
- $H$：Historical importance。

第一版甚至可以不用 ML，使用规则 + LLM 判断即可。

例如：

```text
IF
deadline <= 3 days
AND
critical_task == pending
AND
required_evidence == missing

THEN
risk = HIGH
```

但所有 Intervention 必须保存：

```text
trigger
reason
evidence
timestamp
user_feedback
```

方便后续评测。

---

# 10. 数据与评测

复赛不能只有 Demo。

需要有最小 Benchmark。

## 10.1 Memory Retrieval

构造 20~30 个项目 Memory。

人工设置问题：

> “为什么学习率改成 5e-5？”

评估：

$$
\text{Recall@k}
=
\frac{\text{被正确召回的目标记忆}}
{\text{所有目标记忆}}
$$

---

## 10.2 Risk Detection

人工构造约 15~20 个项目风险。

评估：

$$
\text{Risk Recall}
=
\frac{\text{正确发现风险数量}}
{\text{真实风险数量}}
$$

同时统计：

```text
False Positive Rate
```

因为“主动提醒”最怕误报。

---

## 10.3 Evidence Grounding

评估：

$$
\text{Evidence Accuracy}
=
\frac{\text{有正确历史证据支持的提醒}}
{\text{全部提醒}}
$$

---

## 10.4 Intervention Safety

检查：

- 是否在没有用户确认时创建行动；
- 是否重复提醒；
- 是否使用过期信息；
- 是否提供无法追溯的理由；
- Ignore 后是否仍频繁提醒。

目标：

```text
Unauthorized Action Rate = 0
```

---

# 11. 实施阶段

## Phase 0：冻结产品定义

目标：

> 不再增加主线之外的新功能。

必须确定：

```text
核心用户：
大学生项目制学习 / 科研 / 竞赛参与者

核心问题：
项目知识碎片化，历史决策容易丢失，
现有工具只“保存”，不会根据长期状态主动推进。

核心能力：
Memory → State → Intervention → Action
```

---

## Phase 1：Backend 整理

完成：

- [ ] 统一 Project / Memory / Risk / Action 数据结构
- [ ] 明确核心 API
- [ ] 删除 Demo 中依赖硬编码的数据
- [ ] 确认所有 Risk 都能关联 Evidence
- [ ] 确认 Action 需要用户确认
- [ ] Action 完成后自动回写 Memory
- [ ] 准备一个稳定 Demo 项目

验收：

```text
仅通过 API
就可以完整跑通：
Memory → Risk → Confirm → Action → Memory
```

---

## Phase 2：HarmonyOS MVP

完成：

- [ ] 新建 ArkTS Stage 项目
- [ ] 网络访问 Backend
- [ ] Home
- [ ] Memory Timeline
- [ ] Intervention
- [ ] Action Board

验收：

> 不打开 Web 页面，也能完整展示 ProjectMemo 核心 Demo。

---

## Phase 3：小艺 Agent

完成：

- [ ] 建立 ProjectMemo Agent
- [ ] record_memory
- [ ] query_memory
- [ ] inspect_project
- [ ] create_action
- [ ] 与真实 Backend 通信

验收：

```text
小艺输入一条项目信息
        ↓
ProjectMemo Backend 保存
        ↓
HarmonyOS App 出现同一条 Memory
```

以及：

```text
HarmonyOS App 中存在 Risk
        ↓
通过小艺询问项目状态
        ↓
Agent 返回同一个 Risk 和 Evidence
```

重点验证：

> **不同入口共享同一份项目状态。**

---

## Phase 4：主动介入

完成：

- [ ] Deadline trigger
- [ ] Stagnation trigger
- [ ] Missing evidence trigger
- [ ] Risk severity
- [ ] Explainable Evidence
- [ ] Accept / Remind Later / Ignore
- [ ] 防重复提醒

验收：

> Agent 的主动行为可信、可解释、可控。

---

## Phase 5：评测

完成：

- [ ] Memory Benchmark
- [ ] Risk Benchmark
- [ ] Evidence Benchmark
- [ ] Intervention Safety Test
- [ ] 保存实验数据
- [ ] 输出图表

---

## Phase 6：复赛包装

功能冻结。

只做：

- [ ] Bug Fix
- [ ] UI 收尾
- [ ] Demo 数据
- [ ] Demo Script
- [ ] 演示视频
- [ ] 项目说明文档
- [ ] GitHub / Source Code
- [ ] 架构图
- [ ] Benchmark 结果
- [ ] FAQ / 答辩问题

---

# 12. Demo 项目建议

不要使用空白 App 现场创建数据。

提前准备一个真实、易理解的 Demo 项目，例如：

```text
Project:
LLM Research Project

Goal:
复现论文并完成消融实验

Deadline:
Weekly Meeting · Aug 21
```

历史 Memory：

```text
Aug 12
阅读论文，决定先复现 baseline

Aug 14
Baseline 首次运行失败

Aug 15
导师要求本周完成 Ablation

Aug 16
Baseline reproduction completed

Aug 17
Ablation still pending

Aug 18
No ablation result found
```

于是 ProjectMemo 主动判断：

```text
HIGH RISK

Ablation experiment may delay weekly presentation.
```

这个故事五分钟内即可理解。

---

# 13. 复赛 5 分钟演示结构

## 0:00–0:30：问题

大学生科研 / 竞赛项目中：

```text
聊天
会议
实验
文件
TODO
论文
截止时间
```

不断产生碎片。

传统工具解决：

> “在哪里保存？”

ProjectMemo 解决：

> “这些历史信息现在意味着什么，以及接下来应该做什么？”

---

## 0:30–1:00：核心概念

展示：

```text
Memory
   ↓
State
   ↓
Risk
   ↓
Intervention
   ↓
Action
```

---

## 1:00–1:45：小艺 Capture

对小艺说：

> “记录一下，baseline 已经完成，但是 accuracy 比论文低 2%。”

然后打开 HarmonyOS App。

展示 Memory 已同步。

---

## 1:45–3:10：主动介入高潮

App 首页出现：

```text
⚠ Ablation experiment may delay presentation
```

进入：

```text
Evidence
```

展示为什么提醒。

点击：

```text
创建行动
```

---

## 3:10–3:40：闭环

完成 Action。

新实验结果进入 Memory。

Project State 更新。

Risk 消失或降低。

---

## 3:40–4:15：小艺 Recall

问：

> “为什么之前提醒我做消融实验？”

Agent 根据长期 Memory 回答，并引用 Evidence。

---

## 4:15–4:40：Benchmark

快速展示：

```text
Memory Recall
Risk Recall
Evidence Accuracy
Unauthorized Action Rate
```

---

## 4:40–5:00：总结

最终一句：

> **ProjectMemo 让记忆不再只是存档，而成为推动项目向前的依据。**

---

# 14. Agent 执行规则

后续任何 Coding Agent 在修改该项目之前，都必须遵守以下约束。

## 14.1 优先级

```text
P0
稳定 Demo 闭环

P1
鸿蒙原生体验

P2
小艺入口

P3
评测与展示

P4
新功能
```

任何 P4 工作不得影响 P0~P3。

---

## 14.2 禁止行为

Agent 不得：

- 无理由重构现有 Backend；
- 更换整个技术栈；
- 把真实数据逻辑替换为 mock；
- 为 UI 演示写死 Risk；
- 绕过用户确认创建 Action；
- 为增加“AI 感”添加无关聊天功能；
- 在核心闭环未完成前增加大型功能；
- 为鸿蒙迁移复制全部 Web 代码；
- 修改产品主线为普通 Todo / Project Manager。

---

## 14.3 每次开发任务必须回答

Coding Agent 开始一个任务前应明确：

```text
1. 该修改服务于哪个核心闭环？
2. 属于 P0/P1/P2/P3/P4 哪一级？
3. 是否改变现有 API？
4. 是否影响 Demo 稳定性？
5. 如何验证？
```

如果无法回答 1，则默认不做。

---

# 15. Definition of Done

ProjectMemo 复赛版完成的最低标准：

## 产品

- [ ] HarmonyOS 原生 App 可运行
- [ ] 小艺可以调用 ProjectMemo
- [ ] 两个入口共享同一 Backend
- [ ] Memory 可持久化
- [ ] Project State 真实计算
- [ ] Risk 基于真实数据
- [ ] Risk 可以显示 Evidence
- [ ] 用户确认后创建 Action
- [ ] Action 完成回写 Memory

## Demo

- [ ] 5 分钟内完成全部核心演示
- [ ] Demo 无需现场临时造数据
- [ ] 网络异常有合理 fallback
- [ ] 不依赖随机 LLM 输出才能成功
- [ ] 关键 Agent 输出格式稳定

## 评测

- [ ] 至少一个 Memory Retrieval Benchmark
- [ ] 至少一个 Risk Detection Benchmark
- [ ] Evidence Accuracy 数据
- [ ] Unauthorized Action Rate = 0

## 叙事

评委可以在 30 秒内理解：

```text
ProjectMemo ≠ Todo App
ProjectMemo ≠ Chatbot
ProjectMemo ≠ 普通 RAG

ProjectMemo =
Long-term Project Memory
+
State Understanding
+
Explainable Proactive Intervention
+
Human-controlled Action
```

---

# 16. 当前最优执行顺序

从现在开始，不要并行铺太多线。

严格按照：

```text
① Backend 闭环
        ↓
② HarmonyOS MVP
        ↓
③ 小艺 Agent
        ↓
④ 主动介入优化
        ↓
⑤ Benchmark
        ↓
⑥ UI / 视频 / 文档
```

当前第一目标：

> **只通过现有 Backend API，跑通一次真实的  
> Memory → Risk → Evidence → Confirm → Action → New Memory。**

完成以后，再开始 HarmonyOS 页面迁移。

---

# 17. 给 Coding Agent 的当前任务入口

如果把本文件直接提供给 Coding Agent，可以从下面任务开始：

```text
请首先审计现有 ProjectMemo 代码库，不要立即大规模修改。

目标：
确认当前代码是否已经具备
Memory → Project State → Risk → Evidence → User Confirmation → Action → Memory
完整闭环。

请输出：

1. 当前项目目录与技术栈；
2. 已存在的对应模块；
3. 缺失模块；
4. 当前 API；
5. 当前数据库结构；
6. mock / hard-code / fallback 的位置；
7. 与本计划目标的 gap analysis；
8. 最小改动实施方案；
9. 按 P0/P1/P2/P3 排序的 TODO；
10. 第一轮只实施 P0，并为每项提供可验证测试。

原则：
- 不推倒重构；
- 保留现有 Backend；
- 不先做视觉优化；
- 不先新增功能；
- 不把 Risk 写死；
- 不允许未经用户确认创建 Action；
- 所有主动提醒必须包含可追溯 Evidence。
```

---

# 18. 最终产品定位

ProjectMemo 的复赛定位统一使用：

> **ProjectMemo 是面向大学生项目制学习、科研与竞赛场景的知识资产沉淀与主动推进 Agent。它持续将项目中的碎片信息组织为长期记忆，并基于记忆理解项目状态、识别停滞与材料缺口，在给出可追溯依据后提出下一步行动建议，由用户确认后执行，从而形成“记忆—判断—介入—行动—再记忆”的闭环。**

核心原则：

> **Memory becomes action.**

> **主动介入，但不越权。**
