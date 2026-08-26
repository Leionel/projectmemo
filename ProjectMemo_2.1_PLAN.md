# ProjectMemo 2.1：国赛竞争力升级计划

本计划在 2.0 已有闭环上收敛复赛交付，并为晋级后的国赛增强设置独立 Gate，不把候选功能写成既成事实。

> 基线：继承 [`ProjectMemo_2.0_PLAN.md`](./ProjectMemo_2.0_PLAN.md) 的产品定位、核心闭环和技术边界。  
> 状态基准：2026-08-24，以 [`ProjectMemo_2.0_IMPLEMENTATION_NOTES.md`](./ProjectMemo_2.0_IMPLEMENTATION_NOTES.md) 第一部分和当前小艺工作流画布为准。  
> 目标：先通过复赛进入全国总决赛，再把作品升级为可现场证明的 Evidence-grounded Proactive Project Agent。  
> 执行记录：实施时新建并持续维护 `ProjectMemo_2.1_IMPLEMENTATION_NOTES.md`。

## 0. 结论先行

ProjectMemo 2.1 不重做 2.0，也不靠堆功能冲击国赛。它只做三件事：

1. **把 2.0 已有能力从“代码存在”推进到“Gate 有证据”。** S02A-S08 当前仍是 `PARTIAL`；这些未闭合前不应继续扩功能。
2. **增加一个评委能记住的技术创新：时间化证据记忆。** ProjectMemo 不只检索“过去写过什么”，还要说明“一个决定何时产生、被什么证据支持、后来为何改变、当前哪个版本有效”。
3. **把主动性变成可测量的低打扰策略。** 系统根据风险、证据、截止时间和用户的接受/稍后/忽略反馈决定何时提醒，并保证未经确认不写入高影响行动。

2.1 的一句话定位：

> **ProjectMemo 是能追踪项目决策演化、解释目标差距，并在合适时机用证据推动下一步的鸿蒙 Project Agent。**

2.1 的现场记忆点：

```text
它不只是记得。
它知道哪条结论已经过期、为什么过期、现在缺什么，
并且只在值得打扰时出现。
```

## 1. 2.1 与 2.0 的继承关系

2.0 仍是产品和架构基线；2.1 只覆盖优先级、国赛增量和验收方式。

### 1.1 完全继承

以下内容不变：

- 产品主线：长期项目记忆 + 可追溯主动推进；
- 核心闭环：Capture -> Memory -> State/Gap -> Intervention -> Evidence -> Confirm -> Action -> Result -> Reflection Memory；
- Backend 是唯一事实源；HarmonyOS App、小艺和 Web 共用同一份状态；
- 所有 Risk 必须能提供 Evidence；
- 高影响写操作必须由服务端确认，不把提示词当权限边界；
- mock/fallback 必须显式标记，不能冒充真实模型或平台能力；
- 当前以 DevEco 模拟器作为 HarmonyOS App 验收基线，真机能力保持 `UNVERIFIED`。

### 1.2 2.1 覆盖的旧优先级

2.0 中的 Scheduling、完整 Meeting Mode、GitHub Connector、复杂跨设备协同不再默认进入复赛承诺。它们只有在本计划的 Gate 通过后，才能按候选池排序启动。

### 1.3 2.1 明确不做

为了保持 Agent 创新方向，不新增以下范围：

- 团队 IM、群聊、社区和动态；
- 完整 Kanban、Gantt、工时和企业权限体系；
- 通用知识库或通用聊天机器人；
- 多 Agent 角色扮演；
- 未经评测的“全自动项目管理”；
- 为凑鸿蒙特性数量而添加与主线无关的系统能力。

## 2. 竞赛依据与得分策略

2026 鸿蒙赛道规程把作品分为应用创新、Agent 创新、用户体验创新和操作系统智能创新四个方向。ProjectMemo 继续选择 **Agent 创新**，不切换赛题方向。

规程对 Agent 创新的重点是：个人学习/成长陪伴、主动服务、位置/时间/拍照/对话历史等上下文，以及文本、语音、视觉等自然交互。复赛 Agent 方向可提交源代码文件或“小艺开放平台”测试态 Agent；总决赛采用现场答辩。评分为创新性 50、完备度 20、前景评估 20、规范性 10，另有实际应用价值 20 分附加分。

依据：

- 仓库内盖章规程：[`2026“中国高校计算机大赛-人工智能创意赛”通知_规程（盖章版）.pdf`](./2026“中国高校计算机大赛-人工智能创意赛”通知_规程（盖章版）.pdf)
- [2026 C4-AI 官方页面](https://developer.huawei.com/home/C4-AI)

### 2.1 评分项到交付物的映射

每个评分项都必须对应可复核交付物，不能只用功能名称或演示口播证明。

| 评分项 | 2.1 主攻点 | 必须提供的证据 |
|---|---|---|
| 创新性 50 | 时间化证据记忆、目标差距推理、低打扰主动策略、小艺/鸿蒙系统入口 | 决策演化 Demo、对照实验、真实节点调用记录、技术架构 |
| 完备度 20 | S02A-S08 关闭关键 Gate；异常、空态、慢网、重复提醒和回退状态真实 | 自动化结果、模拟器录屏、5/5 或 10/10 演示回执、失败恢复演示 |
| 前景评估 20 | 面向科研、竞赛、课程项目的真实持续性痛点；小规模用户试用 | 访谈/试用样本、任务完成时间、检索成功率、打扰接受/忽略数据 |
| 规范性 10 | 20 页内说明文档、5 分钟视频、现场 PPT、哈希一致的 release manifest | 提交清单、版本号、构建命令、HAP/source/Agent 测试态说明 |
| 实际应用价值 +20 | 可安装 HAP、真实 Backend、源代码、测试态小艺 Agent；条件具备时上架 | HAP hash、启动与核心闭环、平台测试记录、上架状态如实披露 |

### 2.2 国赛不是“复赛分数累积”

规程明确初赛、复赛和总决赛各阶段单独评分。进入国赛后必须重新用现场演示证明价值，不能依赖复赛排名或文档中的完成声明。

## 3. 当前进展审计

本表只记录截至 2026-08-24 可复核状态。后续以 2.1 实施记录中的新回执更新，不在本计划里直接改成完成。

| 切片 | 当前状态 | 已有证据 | 进入国赛前的缺口 |
|---|---|---|---|
| S01 构建/HAP | `VERIFIED`（unsigned） | Backend build、ArkTS build、Hypium、模拟器安装 | 正式签名仍 `PENDING` |
| S02 模拟器闭环 | `VERIFIED` | App 连接 `10.0.2.2:4400` Backend，不是静态壳 | 保持回归，不重复开发 |
| S02A 原生 UI | `PARTIAL` | 五页、Evidence Ledger 视觉、项目头像与基础导航 | 深色、大字体、读屏、慢网/乱序、横屏/大屏矩阵 |
| S03 真实模型 | `PARTIAL` | provider/fallback 审计与探针脚本 | 真实 provider 20 样例回执 |
| S04 Hybrid Search | `PARTIAL` | Search API、embedding/backfill、benchmark 脚本 | 真实 embedding、Recall/MRR/Evidence Precision/p95 回执 |
| S05 Inbox | `PARTIAL` | 图片/PDF Picker、上传、校验、PDF 提取、`NEEDS_OCR` | 模拟器图片/PDF 各 5 份；真实视觉/OCR 条件 |
| S06 Deliverable Gap | `PARTIAL` | 证据确认关系和规则测试 | App 端 Evidence 选择/确认闭环与 Gap Accuracy |
| S07 通知 | `PARTIAL` | NotificationKit、WantAgent、Snooze 代码 | 模拟器权限、去重、深链和重启验收 |
| S08 小艺 | `PARTIAL` | 工作流原型；`record_memory` 本地适配层、固定项目授权、幂等回执和专项测试 | ECS HTTPS 部署、插件真实调用、App 同卡片对照、其余三能力、20 轮对照 |

### 3.1 当前最大的三个风险

下面三项决定 2.1 的执行顺序和砍项条件。

1. **验证债高于开发债。** 多个模块已经有代码，但缺少真实 provider、模拟器或平台回执。
2. **小艺工作流仍是文字演示。** 当前画布没有插件/API 节点，不能读取或写入 ProjectMemo。
3. **只有模拟器。** 端 A2A、真机小艺、跨设备流转和真机 OCR 不能被当作当前完成项。

## 4. 2.1 产品主线

2.1 把“长期项目记忆”升级为“会演化的项目事实”，再用它支持主动介入。

```text
多模态碎片
   ↓
可追溯 KnowledgeCard
   ↓
时间化关系：SUPPORTS / CONTRADICTS / SUPERSEDES / DERIVED_FROM
   ↓
当前有效项目状态
   ↓
Milestone / Deliverable 目标差距
   ↓
低打扰 Intervention Policy
   ↓
Evidence + 行动预览
   ↓
用户确认
   ↓
Action / Result / Reflection
   ↓
更新有效事实与决策演化
```

## 5. 国赛增量一：Temporal Evidence Ledger

这是复赛阶段唯一必须新增的技术差异化功能。它解决普通 RAG 无法稳定回答“后来改了吗”“现在以哪个版本为准”“为什么改变”的问题。第 6 节 Intervention Budget 在复赛只做规则与评测设计，晋级且前置 Gate 通过后再进入实现。

### 5.1 用户体验

用户记录两条信息：

```text
8 月 20 日：演示使用云 A2A。
8 月 23 日：由于应用未上架且只有模拟器，复赛先使用工作流，云 A2A 后移。
```

ProjectMemo 不把两条记录平铺返回，而是展示：

```text
当前有效决定
复赛先使用工作流 Agent 完成接口联调。

取代了
演示直接使用云 A2A。

变更原因
应用未上架、没有正式签名、只有 DevEco 模拟器。

证据
[8/20 决策卡] ← SUPERSEDED BY ← [8/23 决策卡]
```

### 5.2 最小数据增量

优先扩展现有 `CardRelation`，不新建独立图数据库：

```text
CardRelation
  保留现有字段 currentCardId / relatedCardId / reason / score
  relationType  RELATED | SUPPORTS | CONTRADICTS | SUPERSEDES | DERIVED_FROM
  confidence    0..1
  confirmed     boolean
  validFrom     datetime?
  validTo       datetime?
```

第一版只允许 `SUPERSEDES` 和 `CONTRADICTS` 影响“当前有效事实”；模型提出关系，用户确认后才生效。原 `RELATED` 关系保持兼容。关系方向固定为 `currentCardId = 新卡片`、`relatedCardId = 被取代/被关联的旧卡片`，避免查询和 UI 各自解释方向。旧数据迁移时 `relationType` 回填为 `RELATED`；`confidence` 可由现有 `score` 归一化回填，但不因此自动获得 `confirmed=true`。

关系层必须执行以下不变量：

- 两张卡片必须属于同一项目；
- 禁止卡片指向自己；
- `SUPERSEDES` 不能形成环；
- 未确认关系不参与当前事实计算；
- 同一旧决定出现多个已确认取代关系时，系统标记冲突并要求人工选择，不能按创建时间静默覆盖；
- 用户可以撤销错误确认；撤销后重新计算当前有效事实并写审计记录。

### 5.3 最小接口

第一版只增加关系提议、人工确认和时间线读取三个接口。

```http
GET  /api/projects/:id/decisions/timeline
POST /api/projects/:id/cards/:cardId/relations/propose
POST /api/projects/:id/relations/:relationId/confirm
```

现有 `/cards/search` 增加可解释字段：

```json
{
  "current": true,
  "supersededBy": null,
  "temporalReason": "8/23 的已确认决策取代 8/20 决策"
}
```

研究依据不是“图数据库更高级”，而是长期记忆需要处理时间、更新、冲突和拒答。Zep 的时间知识图架构强调保留历史关系；LongMemEval 把 temporal reasoning、knowledge updates 和 abstention 列为长期记忆核心能力。[Zep 论文](https://arxiv.org/abs/2501.13956)、[LongMemEval](https://arxiv.org/abs/2410.10813)

### 5.4 UI

在 Memory 页面增加 **决策演化** 过滤入口：

- 左侧继续使用 Evidence Spine；
- 同一主题的卡片按时间排列；
- `SUPERSEDES` 使用明确箭头，不依赖颜色表达；
- 默认折叠旧版本，但保留“为什么改变”和证据入口；
- 没有已确认关系时显示“尚未确认当前版本”，不让模型自动裁决。

### 5.5 评测

建立至少 60 组时间冲突样例，覆盖：

- 明确取代；
- 仅补充，不取代；
- 相互矛盾但证据不足；
- 截止日期更新；
- 方案回滚；
- 相同事实重复记录；
- 查询过去版本与查询当前版本。

通过门槛：

```text
Conflict Detection F1          >= 0.85
Supersession Precision         >= 0.90
Current Fact Accuracy          >= 0.90
Evidence Precision             >= 0.95
Unconfirmed auto-activation    0
```

## 6. 国赛增量二：Intervention Budget

这个增量把“主动提醒”从固定规则升级为有边界的主动策略。第一版复用现有 Intervention 历史，不训练新模型。

### 6.1 策略输入

策略只读取现有风险、证据和用户反馈信号。

```text
风险严重度
距离截止时间
证据完整度
是否重复提醒
最近是否接受同类提醒
最近是否忽略/稍后同类提醒
安静时段
每日提醒预算
```

### 6.2 决策输出

每次判断只允许返回一个互斥的渠道决策。

```text
SHOW_IN_APP
NOTIFY_NOW
SCHEDULE_LATER
SUPPRESS_DUPLICATE
SUPPRESS_LOW_CONFIDENCE
```

每次策略都写入 `AgentRun.trace`：输入信号、分数、阈值、最终渠道和抑制原因。

### 6.3 最小实现原则

第一版从 `AgentIntervention.status`、`snoozedUntil`、`dismissReason`、severity、dedupeKey 和时间统计中计算，不新增“万能个性化模型”。只有当现有字段无法表达安静时段和每日预算时，才新增项目级 `InterventionPreference`。

### 6.4 评测

建立至少 80 个策略场景，并通过模拟时钟验证：

```text
Duplicate Reminder Rate       0
Quiet-hours violations        0
Daily-budget violations       0
High-risk recall              >= 0.90
Appropriate-channel accuracy  >= 0.85
Unauthorized Action Rate      0
```

真实用户 Acceptance Rate 只作为观察指标，不设置虚假的保证阈值。

## 7. 候选增量：只允许选一个

以下功能不能同时启动。只有 2.0 Gate 和第 5 节通过后，才根据设备、平台权限和剩余时间选择一个。

| 候选 | 竞争力 | 依赖 | 选择条件 | 默认结论 |
|---|---|---|---|---|
| Meeting State Diff | 展示视觉/语音输入如何改变项目状态，不是普通会议总结 | S03、S05、Temporal Ledger | 文本转录最小路径可稳定，音频只作条件增强 | **优先** |
| 小艺云 A2A | 证明第三方 Agent 直连和系统入口 | 公网 HTTPS、平台权限、AgentCard | 工作流四工具 20 轮先通过 | 条件启动 |
| 跨端迁移 Project Review | 手机捕获后在平板/PC 继续证据审阅 | 至少两台可验证设备、签名/同账号环境 | 获得真实设备或官方调试条件 | 当前 `UNVERIFIED` |
| Smart Scheduling | 把行动建议落到时间 | 日历权限、时区、冲突处理 | 所有主线 Gate 已通过 | 不优先 |
| GitHub Evidence | 自动发现代码证据 | OAuth、仓库权限、隐私策略 | 有真实开发用户试用需求 | 不优先 |

### 7.1 Meeting State Diff 最小形态

输入一份组会文本或可提取的转录，系统只回答五件事：

```text
新增了什么？
确认了什么？
改变了什么？
与旧记录冲突什么？
哪些行动等待确认？
```

所有候选变化先进入预览，用户确认后再创建 KnowledgeCard、时间关系或 Action。音频识别不可用时，文本转录仍能独立完成 Demo。

## 8. 小艺与 HarmonyOS 2.1 路线

### 8.1 小艺

当前先完成工作流模式，最终路线是云 A2A：

```text
工作流试验版
  意图分类 + 插件调用 + 两步确认 + 20 轮对照
        ↓
云 A2A
  直接复用 ProjectMemo Agent 和任务状态
        ↓
端 A2A / ArkTS Skill
  仅在应用身份、API、签名和真机条件具备后评估
```

工作流不能把小艺长期记忆当作 ProjectMemo Memory。四项能力必须通过公网 HTTPS 适配层调用 Backend，并写入 `AgentRun`。

### 8.2 HarmonyOS 特性组合

2.1 只把与核心闭环直接相关的能力计入技术亮点：

| 鸿蒙能力 | 对应产品价值 | 当前证据边界 |
|---|---|---|
| ArkUI 原生多页体验 | Evidence Ledger 与行动确认 | 模拟器可验收 |
| Core File Picker / Photo Picker | 图片、PDF 进入 Project Inbox | 模拟器可验收 |
| NotificationKit + WantAgent | 高风险介入离开 App，并深链到 Evidence | 模拟器先验收，真机另记 |
| 小艺工作流/Agent | 系统级自然语言入口 | 平台调试可验收，真机入口另记 |
| Agent Framework A2A | 第三方 Agent 协议接入 | 条件能力，不预先写完成 |
| 跨端迁移 | 手机捕获、平板/PC 复盘 | 没有真实多设备证据时不计完成 |

规程中“建议应用三种及以上 HarmonyOS 特性”针对应用创新方向，不是 Agent 创新方向的硬门槛。ProjectMemo 仍不为了凑数量重复计算页面、图标或普通网络请求；每项技术亮点必须对应一段用户可见闭环和独立回执。

## 9. 用户验证与前景证据

进入国赛不仅需要技术 Demo，还要证明需求真实。招募目标是 8-15 名学生，覆盖科研、学科竞赛和课程项目；人数不足时如实报告实际样本量。

### 9.1 任务

每名参与者完成：

1. 导入一份项目材料；
2. 找回一条过去决定；
3. 判断一条新记录是否取代旧决定；
4. 查看一次有证据的风险介入；
5. 接受、稍后或忽略建议；
6. 完成行动并回写结果。

### 9.2 指标

试用必须同时记录成功、错误和打扰反馈。

```text
首次成功完成率
完成六任务的总时间
检索成功率
错误引用次数
行动未确认写入次数
提醒接受/稍后/忽略分布
SUS 或简化可用性问卷
开放问题：最可信/最打扰/最难理解的环节
```

用户研究报告必须附任务脚本、样本特征、失败样例和原始匿名数据摘要，不能只放好评截图。

### 9.3 隐私和研究边界

试用只使用参与者自愿提供的非敏感项目材料或统一脱敏样例。开始前说明收集字段、用途和保存期限；导出报告前删除姓名、账号、学校内部信息、密钥和原始私有文档。参与者可以随时退出并要求删除其测试数据。

## 10. 纵向执行切片

每个切片都必须交付一个可独立演示的结果。后续切片不能用自己的成功覆盖前置 Gate 失败。

### T01｜关闭 2.0 验证债

**Blocked by：** none  
**交付：** S02A-S07 的模拟器/真实 provider Gate 产生回执；无法满足的能力明确降级，不扩功能。

验收：

- [ ] S02A 慢网、空态、错误态、大字体和横屏矩阵完成；
- [ ] S03 真实 provider 20 样例，mock 不计成功；
- [ ] S04 benchmark 输出 Recall/MRR/Evidence Precision/p95；
- [ ] S05 图片/PDF 各 5 份模拟器闭环；
- [ ] S06 Evidence 选择/确认和 Gap Accuracy；
- [ ] S07 通知权限、去重、深链、Snooze 回执；
- [ ] 所有未通过项保持 `PARTIAL/BLOCKED`。

### T02｜工作流真实写入一张卡片

**Blocked by：** 平台插件/鉴权方式已确认；T01 可与本切片并行，但不得占用其修复时间  
**交付：** 小艺工作流 `record_memory` 经插件和 HTTPS 适配层写入 ProjectMemo，HarmonyOS App 可见同一 `card_id`。

验收：

- [ ] 平台请求、适配层日志、AgentRun 和 App 显示同一 ID；
- [ ] 无授权身份无法写入；
- [ ] 测试态身份只映射到一个专用测试项目，不能传任意 `projectId`；
- [ ] 插件失败时不显示“已记录”；
- [ ] 本机地址未暴露到平台。

### T03｜小艺四能力 20 轮对照

**Blocked by：** T02、S04、S06  
**交付：** record/query/inspect/create_action 各 5 轮，平台与 App 状态一致。

验收：

- [ ] 20/20 调用均有关联 request ID 和 AgentRun；
- [ ] 首次行动请求无写入，确认后恰好写入一条；
- [ ] Unauthorized Action Rate = 0；
- [ ] 真机入口未测时明确写 `UNVERIFIED`。

### T04｜决策演化端到端

**Blocked by：** T01 的 S04、S06  
**交付：** 两条相冲突的决策卡经过关系提议和人工确认后，App 能展示当前决定、旧决定和变更原因。

验收：

- [ ] 旧数据迁移后仍保持 `RELATED` 行为；
- [ ] 未确认关系不改变当前事实；
- [ ] 跨项目关系、自环和 supersession 环全部被拒绝；
- [ ] 撤销错误确认后恢复上一有效事实且保留审计；
- [ ] 查询“当前决定”和“过去决定”返回不同且正确的证据；
- [ ] 60 组 benchmark 达到第 5.5 节门槛。

### T05｜低打扰主动策略

**Blocked by：** T01 的 S07、T04  
**交付：** 同一风险在安静时段、重复状态和高风险状态下分别被延后、抑制或立即通知，并可解释原因。

验收：

- [ ] 每次策略决定进入 AgentRun；
- [ ] 80 个模拟时钟场景达到第 6.4 节门槛；
- [ ] 关闭通知后 App 内 Intervention 仍可用；
- [ ] 策略不会自动创建 Action。

### T06｜国赛候选增强

**Blocked by：** T03、T04、T05  
**交付：** 从第 7 节只选择一个候选，默认 Meeting State Diff；其余保留为 `NOT STARTED`。

验收：

- [ ] 文本输入可独立完成，不依赖未验证音频能力；
- [ ] 所有状态变化先预览再确认；
- [ ] 一次演示能清楚说明它如何强化时间化证据主线。

### T07｜用户试用与候选冻结

**Blocked by：** T04、T05；T06 非硬阻塞  
**交付：** 匿名用户试用报告、benchmark、HAP/source/Agent 测试态、视频和文档绑定到同一 release manifest。

验收：

- [ ] 至少报告实际样本量和失败任务；
- [ ] 10 次完整现场流程演练，成功率 10/10；
- [ ] 演示断网、provider 失败或平台失败时有真实降级说明；
- [ ] 所有提交文件记录 SHA-256；
- [ ] 候选冻结后只修 Bug、文档和演示，不新增功能。

## 11. 日程与砍项门

复赛提交截止以官方最新通知为准；当前规程写明 2026-09-30 24:00。下面沿用 2.0 的 9 月 20 日功能冻结策略，为文档和视频保留缓冲。

| 日期 | 目标 | 砍项门 |
|---|---|---|
| 8/23-9/07 | T01 关闭验证债 | 任一真实 provider 阻塞超过 1 天，停止新增 UI |
| 9/08-9/12 | T02 工作流 tracer bullet | 公网/平台权限不通则回收时间做核心回归 |
| 9/13-9/17 | T03 20 轮；T04 最小决策演化 | 9/17 T01 未过则砍 T04，只保留文档方案 |
| 9/18-9/20 | 缺陷清零与功能冻结 | 不启动 T05/T06 |
| 9/21-9/26 | benchmark、视频、说明文档、HAP/source 打包 | 只修复，不扩功能 |
| 9/27-9/29 | 最终上传预演和备用包 | 每个文件从同一 manifest 生成 |
| 晋级后至 11 月 | T04 完整版、T05、再选 T06、T07 | 未晋级不提前消耗复赛稳定时间 |

## 12. 数据迁移、回滚与兼容

所有 2.1 schema 采用 additive migration：

1. 迁移前复制 SQLite 数据库并记录 hash；
2. `CardRelation` 新字段提供兼容默认值，旧关系全部视为 `RELATED`；
3. 时间关系识别用 feature flag `TEMPORAL_MEMORY_ENABLED` 控制；
4. 关闭 flag 后保留关系数据，但 Search 恢复 2.0 排序；
5. Intervention Budget 用 `INTERVENTION_POLICY_V2_ENABLED` 控制；
6. 关闭策略 V2 后回到现有去重和通知逻辑；
7. 小艺不可用时 App 和 Backend 核心闭环保持完整；
8. 任何 migration 破坏 Capture -> Action -> Reflection 时立即回滚并停止。

## 13. 风险与 STOP 条件

执行者遇到以下条件必须停止对应切片并记录，不得自行伪造替代方案：

1. 小艺平台没有插件节点、测试资格或可用鉴权方式；
2. 适配层只能暴露无认证的项目 ID；
3. 真实 embedding/provider 无法稳定完成 S03/S04；
4. Temporal relation 会自动覆盖未经用户确认的当前事实；
5. 通知不能在模拟器中完成权限、去重或深链验证；
6. 只有模拟器却需要声明真机小艺、端 A2A、跨端迁移或真机 OCR 完成；
7. 新功能需要迁移数据库技术栈或重写现有 Backend；
8. 9 月 17 日仍有任一 P0 Gate 未通过；此时砍掉全部 2.1 新功能，转入提交收口。

## 14. 验证命令与证据

现有基线命令必须全部通过：

```powershell
npm test
npm run build
npm run harmony:build
npm run harmony:test
npm run benchmark:s04
```

实施 2.1 时新增以下脚本，脚本先输出原始 JSON/CSV，再生成图表：

```powershell
npm run benchmark:temporal-memory
npm run benchmark:intervention-policy
npm run verify:s08-adapter
npm run verify:release-manifest
```

最终证据包至少包含：

```text
git commit
DB migration hash
model/provider/version
benchmark dataset hash
raw benchmark results
HAP hash
Backend build hash
小艺工作流/Agent 版本
10 次 Demo receipts
用户试用匿名摘要
说明文档/PPT/视频 hash
```

## 15. 答辩叙事

五分钟演示按一条故事完成，不逐页介绍功能：

1. 手机导入一份组会材料；
2. ProjectMemo 抽取新决定和证据；
3. 系统发现它与旧决定冲突，展示“旧方案 -> 新方案”的演化；
4. Milestone 检查发现新方案缺少交付证据；
5. Intervention Budget 判断值得提醒，并通过通知/小艺出现；
6. 用户查看完整 Evidence，确认创建行动；
7. 完成行动并回写结果；
8. 决策时间线、Deliverable 和 Risk 同时更新。

答辩只强调三个技术点：

```text
Temporal Evidence Memory
Goal-aware Gap Reasoning
Human-controlled Proactive Intervention
```

HarmonyOS 和小艺不是独立卖点，而是让这三个能力在真实系统入口中发生。

## 16. 方案验证

以下清单验证计划是否回答了需求、约束和验收方式，不代表对应功能已经实现。

```text
PLAN VALIDATION: ProjectMemo_2.1_PLAN.md
  Answers the request
    第 2 节把国赛评分映射到交付物；第 5-9 节给出后期功能调研与选择；第 10-11 节给出执行切片和砍项门。

  Answers landed
    采用“证据主动 Agent”框架；继承 2.0；保留工作流到云 A2A 路线；模拟器作为当前验收基线；未丢弃用户要求。

  Scope gate
    2.1 只强制一个新技术增量；第 7 节候选只能选一个；第 1.3、11、13 节明确砍项与 STOP 条件。

  Assumptions explicit
    当前只有 DevEco 模拟器；真实 provider、签名、小艺平台和真机入口仍是外部条件；第 3、8、13 节明确状态与失效条件。

  Verification
    npm test
    npm run build
    npm run harmony:build
    npm run harmony:test
    npm run benchmark:s04
    以及已新增的 verify:s08-adapter 和实施后新增的 temporal/intervention/release 验证脚本。
```

## 17. Review Notes

2026-08-24 按 Completeness、Feasibility、Scope、Testability、Risk 和 Assumptions 六个维度完成压力审查。

| 维度 | 初审 | 修订后 | 主要修订 |
|---|---:|---:|---|
| Completeness | 4/5 | 5/5 | 增加关系环/冲突/撤销、平台身份映射和用户试用隐私边界 |
| Feasibility | 4/5 | 5/5 | 复用现有 CardRelation/Intervention；T02/T04 都先做单条纵向 tracer bullet |
| Scope | 5/5 | 5/5 | 强制新增仅 Temporal Ledger；候选增量最多选一个 |
| Testability | 5/5 | 5/5 | 每个切片有数据集、阈值、命令和可观察回执 |
| Risk | 4/5 | 5/5 | 增加跨项目、自环、循环取代、错误确认撤销和身份越权防护 |
| Assumptions | 5/5 | 5/5 | 模拟器、provider、签名、平台与真机条件均显式标记 |

最终判定：六项均达到 5/5，可作为实施计划；外部平台条件仍必须按 STOP 条件执行，不能用文档评分替代真实验证。
