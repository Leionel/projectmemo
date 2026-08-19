# ProjectMemo 2.0：复赛功能扩展与 HarmonyOS 融合规划

> 用途：复赛产品规划、技术实施、Coding Agent 上下文、答辩叙事统一  
> 阶段：2026 C4-AI 鸿蒙赛道复赛  
> 核心策略：**不把 ProjectMemo 扩成普通项目管理软件，而是围绕“长期项目记忆 + 可追溯主动推进”做纵向增强。**

---

# 0. 结论先行

ProjectMemo 初赛版本已经具备较完整的核心闭环：

```text
Memory
  ↓
Project State
  ↓
Risk / Intervention
  ↓
Evidence
  ↓
User Confirmation
  ↓
Action
  ↓
Result
  ↓
New Memory
```

代码审计确认，该闭环已有真实实现，包括：

- Capture / KnowledgeCard / Relation 的持久化；
- Project State 与 metrics；
- 5 类规则型风险识别；
- Evidence 留痕；
- Intervention 状态机；
- 用户确认；
- Action 完成后回写 Memory；
- AgentRun 审计。

因此复赛阶段不应该推翻重做。

真正需要解决的是：

1. **输入半径太窄**：目前核心输入仍偏文本；
2. **长期记忆技术深度不足**：当前检索本质仍是关键词交集；
3. **项目理解粒度不够**：只能识别风险，尚不能真正理解 Milestone / Deliverable；
4. **主动服务仍主要发生在应用内部**；
5. **鸿蒙系统能力和小艺尚未成为产品核心体验的一部分**；
6. **当前 LLM 主路径仍以 mock / fallback 为主，真实 AI 能力需要强化。**

复赛版统一定位：

> **ProjectMemo 是面向大学生科研、竞赛与项目制学习场景的个人 Project Agent。它持续吸收项目过程中的多模态碎片，将其沉淀为长期项目记忆，理解当前项目状态与目标差距，在合适时机给出有证据的主动建议，并在用户确认后推动行动，最终把行动结果重新沉淀为项目记忆。**

一句话：

> **Memory becomes action.**

产品原则：

> **主动介入，但不越权。**

---

# 1. 竞赛导向

根据 2026 C4-AI 鸿蒙赛道规程，作品强调：

- 前沿创新；
- 实用落地；
- AI 技术融合；
- 美学与交互；
- 多设备协同；
- HarmonyOS 技术创新。

其中 Agent 创新方向特别强调：

```text
个人日常生活 / 工作学习 / 成长陪伴
+
主动服务
+
上下文感知
+
自然交互
+
文本 / 语音 / 视觉
```

评分结构中：

```text
创新性        50
完备度        20
前景评估      20
规范性        10
实际应用价值  +20
```

因此复赛优化不能只做“功能更多”。

需要优先增加：

```text
技术创新
+
Agent 主动性
+
鸿蒙原生性
+
实际可演示性
```

---

# 2. 当前已有能力：必须保留

以下为当前代码审计确认的真实能力。

## 2.1 Memory

当前数据结构：

```text
Capture
   ↓
KnowledgeCard
   ↓
CardRelation
```

支持：

- 原始碎片保存；
- 自动结构化；
- 卡片类型；
- 卡片关联；
- 来源保留；
- 人工纠错。

问题：

> 当前所谓 vectorStore 并不是真正的向量检索，核心仍是关键词交集，候选范围有限。

---

## 2.2 Project State

当前已有：

- Deadline 状态；
- Readiness；
- Attention Score；
- 下一步建议；
- Metrics。

优点：

> 状态由真实数据库数据 + 规则计算得出。

不足：

> 当前更接近启发式 Dashboard，而非真正的项目阶段 / 依赖 / 目标状态建模。

---

## 2.3 Risk / Intervention

已有 5 类规则：

```text
DEADLINE_NEAR
RISK_UNHANDLED
PROJECT_STALE
EXPERIMENT_GAP
MATERIAL_GAP
```

已有：

- 去重；
- severity；
- evidence；
- ACCEPTED；
- SNOOZED；
- DISMISSED；
- RESOLVED。

这是 ProjectMemo 目前最值得保留和强化的核心。

---

## 2.4 Action Loop

已有：

```text
Intervention
   ↓
User Accept
   ↓
Action
   ↓
DONE + Result
   ↓
Reflection Memory
   ↓
Intervention RESOLVED
```

这条链路必须成为复赛演示高潮。

---

## 2.5 Agent / Copilot

已有：

- Project Copilot；
- Agent Chat；
- Candidate Tool；
- Tool Confirmation；
- AgentRun；
- Artifact Generation。

但目前：

- LLM 可选；
- 当前配置主要走 mock；
- 成果生成有模板 fallback；
- Copilot fallback 偏确定性。

复赛应提升真实模型调用，但保留 fallback 作为稳定性保障。

---

# 3. ProjectMemo 2.0 功能总体结构

复赛不做“大而全”。

建议最终形成 6 个能力层：

```text
Layer 1
Project Inbox
多模态捕获

        ↓

Layer 2
Project Memory
长期语义记忆

        ↓

Layer 3
Project Intelligence
状态 / Milestone / Deliverable / Risk

        ↓

Layer 4
Proactive Intervention
主动判断与主动触达

        ↓

Layer 5
Action & Scheduling
行动与时间安排

        ↓

Layer 6
HarmonyOS / 小艺
系统级自然交互与跨设备体验
```

---

# 4. P0：多模态 Project Inbox

## 4.1 为什么必须增加

当前 ProjectMemo 最大的问题之一是：

> 用户需要主动把项目信息“整理成文本”后交给系统。

但真实项目碎片来自：

```text
聊天
截图
PDF
实验结果
白板
语音
组会
会议纪要
网页
文件
照片
```

因此应该把 Capture 升级为：

> **Project Inbox**

## 4.2 统一输入结构

不要给每一种输入重新造业务系统。

统一：

```text
Text
PDF
Image
Screenshot
Voice
Meeting Note
File
Share
   ↓
Attachment
   ↓
Content Extractor
   ↓
Raw Content
   ↓
现有 Capture Pipeline
   ↓
KnowledgeCard
   ↓
Relation
```

建议新增：

```typescript
Attachment {
  id
  projectId
  type
  uri
  mimeType
  extractedText
  source
  createdAt
}
```

## 4.3 示例

用户拍摄导师白板：

```text
Ablation
lr = 1e-4 / 5e-5
周五前完成
```

ProjectMemo 自动产生：

```text
Decision
比较两组 learning rate

Action Candidate
完成 Ablation Experiment

Deadline
本周五

Evidence
IMG_xxx.jpg
```

并全部进入现有 Memory。

## 4.4 HarmonyOS 融入

移动端负责：

```text
拍照
文件选择
语音
系统分享
```

所有入口最后调用同一个：

```text
POST /captures
```

或者扩展后的：

```text
POST /attachments
       ↓
captureService()
```

重点：

> **附件不是文件仓库，而是项目记忆的证据来源。**

---

# 5. P0：真正的 Semantic Project Memory

## 5.1 当前问题

当前记忆系统：

```text
关键词交集
+
最近有限候选
```

不足以支撑“长期项目记忆”的产品定位。

如果一个项目有：

```text
500
1000
3000+
```

条记录，当前检索会快速暴露局限。

## 5.2 升级方向

设计 Hybrid Retrieval：

```text
Query
 │
 ├─ Semantic Similarity
 ├─ Keyword Match
 ├─ Recency
 ├─ Importance
 ├─ Relation Graph
 └─ Project State Relevance
          ↓
        Rerank
          ↓
     Evidence Memories
```

可以定义：

$$
S(m,q)
=
w_sS_{semantic}
+
w_kS_{keyword}
+
w_rS_{recency}
+
w_iS_{importance}
+
w_gS_{graph}
$$

## 5.3 新 API

新增：

```http
POST /api/projects/:id/cards/search
```

输入：

```json
{
  "query": "为什么之前决定改 learning rate？",
  "topK": 8
}
```

输出：

```json
{
  "results": [
    {
      "cardId": "...",
      "score": 0.91,
      "reason": "...",
      "source": "..."
    }
  ]
}
```

## 5.4 一个能力服务多个入口

该 Search API 同时供：

```text
HarmonyOS Memory Search
小艺 query_memory
Copilot
Risk Engine
Artifact Generator
Meeting Review
```

这是高 ROI 功能。

---

# 6. P0：Milestone / Deliverable-aware Project Intelligence

## 6.1 为什么现有 Risk 还不够

当前系统知道：

> “项目停滞了。”

但不一定知道：

> “项目本来应该走到哪里。”

因此 Project State 需要从：

```text
当前数据统计
```

升级为：

```text
当前状态
vs
目标状态
```

## 6.2 Project Plan

项目新增：

```text
Milestone
Deliverable
Dependency
Expected Evidence
```

例如科研项目：

```text
Paper Reading
   ↓
Baseline
   ↓
Ablation
   ↓
Evaluation
   ↓
Writeup
   ↓
Presentation
```

竞赛项目：

```text
Idea
 ↓
Architecture
 ↓
MVP
 ↓
Test
 ↓
Document
 ↓
Video
 ↓
Submission
```

## 6.3 Deliverable Gap

每个关键任务可以定义：

```text
Expected Evidence
```

例如：

```text
Ablation Experiment

Expected Evidence
├─ config
├─ baseline
├─ ablation result
├─ figure
└─ conclusion
```

系统检查：

```text
config        ✓
baseline      ✓
result        ✗
figure        ✗
conclusion    ✗
```

ProjectMemo：

> “Ablation 虽然处于进行中，但目前没有发现实验结果、可视化图表和结论。”

这比：

> “任务未完成。”

更有 Agent 价值。

## 6.4 新 Risk 类型

建议新增：

```text
MILESTONE_DELAY
DEPENDENCY_BLOCKED
DELIVERABLE_GAP
EVIDENCE_MISSING
DECISION_UNRESOLVED
ACTION_OVERLOAD
```

保留原 5 个规则。

最终形成：

```text
规则引擎
+
Project Structure
+
Memory Evidence
+
LLM 辅助判断
```

---

# 7. P0：主动服务必须离开 App

## 7.1 当前主动方式

目前更接近：

```text
用户打开 ProjectMemo
        ↓
evaluate
        ↓
看到风险
```

这只能算：

> App 内主动建议。

真正的 Agent 应该：

```text
项目状态变化
       ↓
Risk Engine
       ↓
Intervention Policy
       ↓
判断是否值得打扰用户
       ↓
系统级主动触达
```

## 7.2 HarmonyOS 系统入口

可以逐步选择：

```text
系统通知
服务卡片
桌面 Widget
实况窗
小艺
```

不用一次全部完成。

复赛至少做两个：

```text
P0
系统通知

P1
服务卡片 / 实况窗
```

## 7.3 主动服务策略

每次介入计算：

$$
I =
w_uU+
w_dD+
w_sS+
w_eE+
w_cC
$$

其中：

- $U$：Urgency；
- $D$：Deadline；
- $S$：Stagnation；
- $E$：Evidence Gap；
- $C$：Context。

设置：

```text
Low
→ App 内显示

Medium
→ Home Insight

High
→ 系统级主动提醒
```

必须同时考虑：

```text
重复提醒
用户 Ignore
用户 Snooze
近期活跃
打扰成本
```

---

# 8. P1：小艺 ProjectMemo Agent

## 8.1 小艺不是另一个 ProjectMemo

正确架构：

```text
                      小艺
                       │
                       ↓
                 ProjectMemo Agent
                       │
                       ↓
HarmonyOS App → ProjectMemo Backend
                       ↓
Memory / State / Risk / Action
```

不同入口共享同一份状态。

## 8.2 四个核心场景

### Capture

用户：

> “小艺，记一下 baseline accuracy 到 82.3%。”

执行：

```text
record_memory
→ POST /captures
```

### Recall

用户：

> “我为什么之前改 learning rate？”

执行：

```text
query_memory
→ semantic search
```

### Inspect

用户：

> “我的项目现在最大的问题是什么？”

执行：

```text
inspect_project
→ state + metrics + interventions
```

### Act

用户：

> “那帮我安排 ablation。”

Agent：

```text
建议：
Ablation Experiment
Priority: High
Due: Tomorrow

[确认]
```

用户确认后：

```text
create_action
```

---

# 9. P1：Action → Scheduling

当前闭环：

```text
Risk
 ↓
Action
```

升级成：

```text
Risk
 ↓
Action
 ↓
Time
```

## 9.1 Smart Scheduling

考虑：

```text
Deadline
Priority
Estimated Duration
Dependency
Existing Schedule
User Preference
```

生成：

```text
Suggested Plan

Wed 19:30–21:30
Ablation Experiment

Reason:
距离组会 3 天，
且该实验是 Writeup 的前置依赖。
```

用户：

```text
[加入计划]
```

## 9.2 不越权

ProjectMemo 永远不能：

```text
自动占用时间
自动创建任务
自动改变截止日
```

除非用户明确确认。

原则保持：

> **主动介入，但不越权。**

---

# 10. P1：Meeting / Review Mode

## 10.1 场景

大学生科研、竞赛最常见信息源之一：

> 会议。

输入：

```text
Audio / Transcript / Note
```

ProjectMemo 自动提取：

```text
Decision
Action Candidate
Deadline
Risk
Question
Experiment
```

## 10.2 示例

导师：

> “baseline 先别调了，下周重点补 ablation，另外确认一下数据 split。”

产生：

```text
Decision
暂停 baseline 调参

Action Candidate
完成 ablation

Risk
数据划分可能有问题

Deadline
下周

Question
是否需要重新验证 split？
```

确认后进入 Memory。

## 10.3 会议结束后的差异化输出

不要只输出会议总结。

输出：

```text
What changed?
What should be remembered?
What should be done?
What became risky?
What needs confirmation?
```

这更符合 ProjectMemo。

---

# 11. P1：跨设备 Project Space

不要简单：

```text
手机 = 一个 UI
平板 = 放大 UI
PC = 再放大
```

而要角色分工。

## 11.1 Phone

负责：

```text
Capture
小艺
拍照
语音
通知
快速确认 Action
```

## 11.2 Tablet / PC

负责：

```text
Memory 深度浏览
Evidence
Milestone
Artifact
Project Review
成果编辑
```

## 11.3 连续体验

例如：

```text
手机
看到 Risk
↓
点击“稍后处理”

电脑
ProjectMemo 自动恢复
同一个 Project
同一个 Risk
同一个 Evidence
```

这才叫 HarmonyOS 全场景价值。

---

# 12. P2：External Evidence Connector

这是第二阶段，不建议过早做。

目标：

> ProjectMemo 不仅依赖用户自己汇报项目状态。

可以接：

```text
GitHub
Calendar
File System
```

复赛只选一个即可。

## 12.1 GitHub Example

系统发现：

```text
Action
完成 baseline implementation

GitHub
过去 3 天已有相关 commits
```

ProjectMemo：

```text
检测到代码仓库已有更新，
是否将相关 commit 作为 Action Evidence？
```

## 12.2 原则

External Connector 只能：

> 提供 Evidence。

不要把 ProjectMemo 变成 GitHub Client。

---

# 13. P2：Project Brief / 导师汇报

利用现有 Artifact 模块。

生成：

```text
Weekly Project Brief

1. Progress
2. Key Decisions
3. Experiments
4. Risks
5. Resolved Issues
6. Next Actions
7. Questions for Mentor
8. Evidence
```

重要的是：

> 每一部分都来自真实 Memory。

不是普通 LLM 自由生成。

---

# 14. 推荐新增的数据结构

只新增必要实体。

## 14.1 Attachment

```text
Attachment
```

用途：

```text
图片 / PDF / 音频 / 文件证据
```

## 14.2 Milestone

```text
Milestone
├─ title
├─ targetDate
├─ status
├─ dependencies
└─ deliverables
```

## 14.3 Deliverable

```text
Deliverable
├─ title
├─ status
├─ expectedEvidence
└─ linkedCards
```

## 14.4 ScheduleSuggestion

不一定第一版持久化。

```text
ScheduleSuggestion
├─ actionId
├─ startTime
├─ duration
├─ reason
└─ confirmed
```

---

# 15. API 增量

建议增加：

```http
POST /api/projects/:id/attachments
POST /api/projects/:id/cards/search

GET  /api/projects/:id/state

GET  /api/projects/:id/milestones
POST /api/projects/:id/milestones

GET  /api/projects/:id/deliverables

POST /api/projects/:id/schedule/suggest
```

但不要为了“接口好看”重写已有 API。

继续复用：

```text
/captures
/interventions
/actions
/artifacts
/agent/chat
/agent/tools
/metrics
```

---

# 16. ProjectMemo 2.0 核心架构

```text
                 ┌───────────────┐
                 │     小艺       │
                 └───────┬───────┘
                         │
                         ↓
               ProjectMemo Agent
                         │
                         │
 ┌───────────────────────┼────────────────────────┐
 │                       │                        │
 ↓                       ↓                        ↓
HarmonyOS App        System Service          External Input
                                     Image / PDF / Voice / File
 │                       │                        │
 └───────────────────────┼────────────────────────┘
                         ↓
                  Project Inbox
                         ↓
                  Content Extractor
                         ↓
                     Memory
                Capture / Card / Edge
                         ↓
                  Hybrid Retrieval
                         ↓
                  Project State
                         ↓
          Milestone / Deliverable / Risk
                         ↓
                  Intervention
                         ↓
                    Evidence
                         ↓
               User Confirmation
                         ↓
                  Action / Plan
                         ↓
                      Result
                         ↓
                   New Memory
```

---

# 17. 功能优先级

## P0 —— 必须做

### P0-A

```text
HarmonyOS MVP
```

至少：

```text
Home
Memory
Intervention
Action
```

### P0-B

```text
真实 LLM Path
+
稳定 fallback
```

要求：

```text
演示主路径不再是 mock
fallback 仍保留
AgentRun 清楚记录 provider
```

### P0-C

```text
Semantic Memory
```

至少：

```text
embedding
+
keyword
+
recency
```

### P0-D

```text
Project Inbox
```

至少实现两种额外输入：

```text
Image
+
PDF / File
```

语音可 P1。

### P0-E

```text
Milestone / Deliverable Gap
```

至少在 Demo 项目中真实运行。

### P0-F

```text
System-level Intervention
```

至少通知可运行。

---

# 18. P1 —— 强烈推荐

```text
小艺 Agent
Scheduling
Meeting Mode
服务卡片 / 实况窗
跨设备接续
Project Brief
```

---

# 19. P2 —— 有余力再做

```text
GitHub Evidence
Calendar Connector
高级 Memory Graph
多人协作
团队项目空间
```

---

# 20. 明确不做

复赛前不要做：

```text
社区
聊天群
完整 Kanban
复杂 Gantt
番茄钟
IM
论坛
文件云盘
完整多人权限
企业项目管理
大型知识库编辑器
```

原因：

> 会把 ProjectMemo 拉向普通项目管理工具。

---

# 21. 复赛 Demo 重新设计

## Scene 1：多模态 Capture

用户：

```text
拍摄一张导师白板
```

系统：

```text
识别出

Decision
Action
Deadline
Question
```

进入 Project Memory。

## Scene 2：Semantic Recall

几天后：

用户：

> “小艺，上次老师为什么让我补 Ablation？”

ProjectMemo：

```text
根据 8/19 组会记录：

导师认为 baseline 已基本稳定，
下一步需要验证各模块贡献。

Evidence
[会议卡片]
[白板照片]
```

## Scene 3：主动出现

用户没有打开 App。

HarmonyOS 通知：

```text
ProjectMemo Insight

距离组会还有 3 天，
Ablation 尚未产生实验结果。

[查看原因]
```

## Scene 4：Evidence

进入：

```text
为什么提醒？

8/19
导师要求完成 Ablation

8/20
Action created

8/21
仍处于 TODO

8/22
未发现实验结果
```

## Scene 5：Project Intelligence

展示：

```text
Milestone
Evaluation

Expected Deliverables

Baseline      ✓
Ablation      ✗
Figure        ✗
Conclusion    ✗
```

系统判断：

```text
HIGH RISK
```

## Scene 6：Plan

ProjectMemo：

```text
建议：
今晚 19:30–21:30
完成 Ablation

原因：
该任务是 Evaluation 与 Writeup 的前置依赖。
```

用户：

```text
确认
```

## Scene 7：Action Closure

完成：

```text
Ablation Experiment
```

填写结果。

系统：

```text
Result
↓
Reflection
↓
Memory
↓
Deliverable 更新
↓
Risk RESOLVED
```

## Scene 8：Project Brief

电脑 / 平板：

> “生成本周组会简报。”

输出：

```text
Progress
Decisions
Experiments
Risks
Next Actions
Questions
Evidence
```

完成。

---

# 22. 复赛的核心技术亮点

答辩中不要介绍成：

```text
我们用了 LLM
我们用了 RAG
我们用了 HarmonyOS
```

而应该强调：

## 22.1 Evidence-grounded Proactive Agent

```text
不是：
AI 猜用户应该做什么

而是：
根据真实 Project Memory
发现目标差距
提供 Evidence
再提出行动
```

## 22.2 Hybrid Long-term Project Memory

```text
Semantic
+
Keyword
+
Recency
+
Importance
+
Relation
```

用于长期项目状态理解。

## 22.3 Goal-aware Project Intelligence

区别于普通 Memory Agent：

```text
过去发生了什么
+
目标要求什么
+
现在缺什么
+
下一步是什么
```

## 22.4 Human-controlled Autonomy

Agent 可以主动：

```text
发现
解释
建议
提醒
```

但不能未经授权：

```text
执行重要写操作
改变项目状态
占用用户时间
```

## 22.5 HarmonyOS-native Agent Experience

```text
小艺
+
原生 App
+
通知 / 服务卡片
+
拍照 / 文件 / 语音
+
跨设备
```

而不是：

> Web App 套鸿蒙壳。

---

# 23. 建议评测

## Memory Retrieval

```text
Recall@K
MRR
Evidence Precision
```

## Risk Detection

```text
Risk Recall
False Positive Rate
```

## Deliverable Gap

```text
Gap Detection Accuracy
```

## Intervention

```text
Acceptance Rate
Dismiss Rate
Duplicate Reminder Rate
```

## Agent Safety

必须：

```text
Unauthorized Action Rate = 0
```

## Long-term Memory Test

构造：

```text
50
100
500
1000
```

条 Memory。

测试：

```text
检索准确率
延迟
Evidence 稳定性
```

这能证明：

> “长期记忆”不是口号。

---

# 24. 开发顺序

严格按照：

```text
Phase 1
HarmonyOS 核心闭环

        ↓

Phase 2
真实 LLM
Semantic Memory

        ↓

Phase 3
Project Inbox

        ↓

Phase 4
Milestone / Deliverable

        ↓

Phase 5
系统主动介入

        ↓

Phase 6
小艺

        ↓

Phase 7
Scheduling / Meeting / 多设备

        ↓

Phase 8
Benchmark / Video / Document
```

---

# 25. 当前推荐执行顺序

如果从今天开始：

## 第一轮

```text
HarmonyOS
Home
Memory
Intervention
Action
```

跑通真实 Backend。

## 第二轮

解决技术硬伤：

```text
LLM_MODE
Semantic Retrieval
/cards/search
```

## 第三轮

做最能改变产品感知的两个能力：

```text
Project Inbox
Milestone / Deliverable
```

## 第四轮

做鸿蒙差异化：

```text
通知
小艺
服务卡片 / 实况窗
```

## 第五轮

选择一个：

```text
Meeting Mode
或
Scheduling
```

优先推荐 Scheduling。

---

# 26. 给 Coding Agent 的实施约束

任何 Agent 在修改项目前，必须先阅读本文件与代码审计文档。

必须遵守：

```text
1. 不推倒现有 Backend。
2. 不破坏现有 Memory → Intervention → Action → Memory 闭环。
3. 所有新输入最终进入统一 Memory。
4. 所有 Risk 必须能够提供 Evidence。
5. 所有高影响写操作必须经过用户确认。
6. 不允许为 Demo 写死 Risk。
7. 不允许用 mock 假装真实 LLM 成果。
8. Mock 只能作为 fallback。
9. 新功能必须回答“是否强化 Project Agent 主线”。
10. 不做普通项目管理软件已有但与核心无关的功能。
```

每个开发任务开始前输出：

```text
Task:
Priority:
Core Loop Impact:
Files to Change:
API Changes:
Data Migration:
How to Verify:
Demo Impact:
```

---

# 27. Definition of Done

ProjectMemo 2.0 复赛版至少达到：

## Memory

- [ ] 多模态输入至少 2 类
- [ ] Semantic Search 真实可用
- [ ] Search API 可供小艺与 App 共用
- [ ] Evidence 可追溯

## Intelligence

- [ ] Project State
- [ ] Milestone
- [ ] Deliverable
- [ ] Risk
- [ ] Gap Detection

## Agent

- [ ] Proactive Intervention
- [ ] Evidence
- [ ] Confirm
- [ ] Action
- [ ] Result
- [ ] Memory Loop

## HarmonyOS

- [ ] 原生 HAP
- [ ] 原生 ArkUI
- [ ] 系统通知
- [ ] 小艺 Agent
- [ ] 至少一个系统级特色能力

## Safety

- [ ] Unauthorized Action Rate = 0
- [ ] Snooze / Ignore 生效
- [ ] 无重复疯狂提醒
- [ ] Mock / Simulated 数据有清晰隔离

## Evaluation

- [ ] Memory Recall
- [ ] Risk Recall
- [ ] Evidence Accuracy
- [ ] Gap Detection
- [ ] Agent Safety

---

# 28. 最终产品叙事

初赛版：

> **让碎片成为记忆，让记忆推动行动。**

复赛版进一步强化：

> **ProjectMemo 不只是记录项目发生过什么，而是持续理解项目现在处于什么状态、距离目标还缺什么，并在真正需要时，用可追溯的项目记忆作为依据，主动帮助用户推进下一步。**

最终模型：

```text
Capture
  ↓
Memory
  ↓
Understand
  ↓
Compare with Goal
  ↓
Detect Gap
  ↓
Intervene
  ↓
Explain
  ↓
Confirm
  ↓
Act
  ↓
Reflect
  ↓
Memory
```

一句话定位：

> **ProjectMemo：让项目记忆真正成为行动的依据。**
