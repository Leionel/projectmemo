# ProjectMemo 2.1：国赛竞争力可执行计划

本计划把 ProjectMemo 2.0 的现有闭环推进到可复核的竞赛交付，并只增加与“长期项目记忆 + 有证据的主动推进”直接相关的能力。执行者不需要阅读本次对话；按工作包顺序实施、保存回执，并把任何偏离写入 `ProjectMemo_2.1_IMPLEMENTATION_NOTES.md`。

> 基线文档：[`ProjectMemo_2.0_PLAN.md`](./ProjectMemo_2.0_PLAN.md)
>
> 当前状态：[`ProjectMemo_2.0_IMPLEMENTATION_NOTES.md`](./ProjectMemo_2.0_IMPLEMENTATION_NOTES.md) 第一部分
>
> S08 部署：[`docs/xiaoyi/Alibaba Cloud Linux 部署 S08.md`](./docs/xiaoyi/Alibaba%20Cloud%20Linux%20部署%20S08.md)
>
> 状态基准：2026-08-26
>
> 当前设备边界：只有 DevEco Studio 模拟器，没有可用于验收的 HarmonyOS 真机
>
> 计划类型：实施交接与验收手册；本文不代表功能已经实现

## 0. 执行结论

ProjectMemo 2.1 不重写后端，也不同时堆叠多个候选功能。先关闭验证债和 S08 公网链路，再交付一个能被评委记住的纵向创新闭环。

一句话定位：

> **ProjectMemo 是能识别项目事实何时变化、说明结论由哪些证据支持，并在合适时机推动下一步的鸿蒙 Project Agent。**

2.1 只承诺下面三个产品结果：

1. **真实闭环可复核。** HarmonyOS 模拟器、真实 Backend、小艺工作流和 AgentRun 使用同一数据源，并能用 ID 对账。
2. **记忆会更新，也会拒答。** 系统区分当前、过期、冲突和证据不足，不把“检索到了相似内容”伪装成“结论得到支持”。
3. **主动性有边界。** 系统显示为什么提醒、为什么没有提醒；任何高影响写入都必须经过用户确认。

### 0.1 新增功能决策

新增功能按交付价值分级，执行者不得把后两级提前混入 P0。

| 级别 | 功能 | 决策 | 原因 |
|---|---|---|---|
| P0 | Temporal Evidence Ledger（时间化证据账本） | 必做 | 形成“旧决定 → 新决定 → 当前有效事实”的核心创新 |
| P0 | Evidence Trust Receipt（证据可信回执） | 并入时间化账本 | 复用现有 citation 和 AgentRun，不另建平台；补齐 `SUPPORTED / CONTESTED / INSUFFICIENT` 与拒答 |
| P1 | Intervention Budget（低打扰介入预算） | 晋级后做 | 强化主动 Agent，但不阻塞复赛稳定性 |
| P1 | Project Change Brief（项目变化简报） | 晋级后优先 | 复用时间线、Gap 和 Intervention，低成本形成主动汇总 |
| P2 | Meeting State Diff | 候选功能首选 | 文本转录即可演示多条状态变化，不依赖真机语音 |
| P2 | 云 A2A / 意图一步达 / Vision OCR / 跨端迁移 | 条件功能 | 受平台资格、应用上架或真机能力约束，当前不能承诺 |

### 0.2 当前执行顺序

执行者按以下顺序推进。外部权限阻塞只冻结对应声明，不得伪造结果，也不得无期限阻塞其他可离线验证的工作。

```text
W00 固化基线与证据目录
  ├─ W01 模拟器 UI 与 S05-S07 验证债
  ├─ W02 真实模型与 Hybrid Search Gate
  └─ W03 S08 ECS + 小艺工作流真实对账
          ↓
W04 Temporal Ledger tracer bullet
          ↓
W05 Evidence Trust Receipt + benchmark
          ↓
W06 复赛冻结、用户验证与提交包
          ↓ 晋级后
W10 Intervention Budget
          ↓
W11 Project Change Brief
          ↓
W12 只选择一个候选增强
```

## 1. 执行纪律

本节定义所有工作包共用的完成标准。违反这些规则时，即使页面能演示，也不能标记为完成。

### 1.1 状态定义

每个 Gate 只能使用以下状态，实施笔记必须记录状态变化日期和证据路径。

| 状态 | 含义 |
|---|---|
| `NOT STARTED` | 尚未开始 |
| `IN PROGRESS` | 正在实施，尚无完整验收回执 |
| `PARTIAL` | 代码或部分流程存在，但缺少真实边界验证 |
| `VERIFIED` | 自动化、目标环境和人工流程均满足该 Gate |
| `BLOCKED` | 外部权限、设备或凭据阻塞，已记录失效条件 |
| `UNVERIFIED` | 当前条件无法验证，禁止转换成宣传性完成声明 |

### 1.2 完成定义

一个工作包只有同时满足下面五项才能进入 `VERIFIED`。

1. 运行该工作包列出的自动化命令并保存原始输出。
2. 在目标环境完成手工路径；HarmonyOS 工作包的目标环境是 DevEco 模拟器，平台工作包的目标环境是小艺开放平台测试态。
3. 保存成功、失败和恢复路径的回执，而不只保存成功截图。
4. 更新 `ProjectMemo_2.1_IMPLEMENTATION_NOTES.md`，写明提交号、数据集 hash、构建 hash 和偏离。
5. 关闭功能开关后，2.0 的 Capture → Action → Reflection 核心闭环仍能运行。

### 1.3 证据目录约定

执行 W00 时创建下面的目录结构。原始输出先保存，再生成摘要或图表。

```text
evidence/2.1/
  baseline/                 # 构建、测试、环境版本
  ui-matrix/                # 截图、录屏、布局 dump、无障碍记录
  provider/                 # S03 真实模型原始回执
  search/                   # S04 数据集、原始结果、指标
  inbox-gap-notification/   # S05-S07 样例与失败恢复
  xiaoyi/                   # 平台请求、AgentRun、App 同 ID 对账
  temporal/                 # 时间关系数据集与 benchmark
  trust-receipt/            # claim-evidence 和拒答评测
  user-study/               # 脱敏任务记录
  release/                  # manifest、hash、提交材料
```

敏感信息不得进入该目录。Token、API Key、用户原始私有材料和证书私钥只保存在环境配置或平台密钥区。

### 1.4 实施偏离记录

当代码实际与计划不一致，但没有触发 STOP 条件时，执行者采取最保守的兼容方案并继续，然后追加以下记录：

```markdown
## Deviations

### YYYY-MM-DD｜Wxx｜偏离标题
- 计划要求：
- 代码实际：
- 采取方案：
- 影响范围：
- 验证结果：
```

## 2. 调研结论与能力边界

本节只记录会改变执行决策的一手资料。外部能力在真正跑通之前仍保持 `UNVERIFIED`。

### 2.1 竞赛策略

2026 鸿蒙高校创新赛允许应用创新、Agent 创新、用户体验创新和操作系统智能创新等方向。ProjectMemo 保持 **Agent 创新**，不因新增 UI 或 Kit 改换方向。[赛事官方页面](https://developer.huawei.com/consumer/cn/activity/incentive/C4)

官方常见问题明确说明赛事不提供硬件，参赛者可使用官方模拟器、云测试或云调试。因此“只有模拟器”不是停止参赛的理由，但真机专属能力必须单独标记 `UNVERIFIED`。[赛事官方页面](https://developer.huawei.com/consumer/cn/activity/incentive/C4)

仓库内盖章规程把鸿蒙赛道基础评分分为创新性 50、完备度 20、前景评估 20 和规范性 10，并设置实际应用价值 20 分附加评分。计划把分数映射到可复核交付物：

| 评分项 | 主攻内容 | 必须交付的证据 |
|---|---|---|
| 创新性 50 | Temporal Ledger、Trust Receipt、Goal-aware Gap | 决策演化 Demo、时间记忆 benchmark、拒答对照 |
| 完备度 20 | S02A-S08 Gate 与异常恢复 | 自动化、模拟器矩阵、平台 20 轮、失败回执 |
| 前景评估 20 | 科研/竞赛/课程项目的持续性痛点 | 8-15 人目标试用、失败任务、量化指标和匿名摘要 |
| 规范性 10 | 同一 release candidate 的文档、视频和 manifest | 20 页内说明、5 分钟内视频、SHA-256 和已知限制 |
| 实际应用价值 +20 | 可安装 HAP、真实 Backend、测试态小艺与源码 | HAP 状态、平台记录、云端健康检查；上架状态如实披露 |

竞赛交付策略如下：

- 用现有四台 DevEco AVD 形成 Phone、Foldable、Tablet、2in1 的模拟器矩阵；
- 不把模拟器结果写成真机结果；
- 把创新性证据集中在时间化记忆、证据回执和主动策略，而不是 Kit 数量；
- 以仓库中的盖章版规程为提交格式和截止日期的最终依据，官网只用于核对更新。

### 2.2 小艺与 A2A

华为当前同时提供工作流/Skill、云 A2A 和端 A2A 等接入路径。云 A2A 适合复用已有云端 Agent；端 A2A 通过 Agent Framework Kit 在 ArkTS 应用内提供 A2A Server、Agent Card 和任务生命周期。[Harmony Intelligence 官方说明](https://developer.huawei.com/consumer/cn/harmonyos-ai)、[端 A2A 开发指南](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/hmaf-a2a-dev-guide)

当前选择保持不变：

1. 先用小艺工作流调用 ProjectMemo 公网 HTTPS 工具。
2. 工作流 20 轮和授权边界通过后，再评估云 A2A。
3. 端 A2A 只有在应用身份、SDK、签名和真机调试条件具备时才启动。

基于当前测试态工作流画布和公网插件路线，本计划推断“应用未上架”不会直接阻止 W03 的工作流联调；如果平台创建插件时实际要求应用身份，则立即按 W03 STOP 条件处理。正式意图上架则明确要求 App 先在 AppGallery Connect 上架；官方意图调试页还注明当前只支持 API 20 及以上手机，不能仅靠模拟器得出正式结论。[意图上架配置](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/intents-kit-listing-configuration-V5)、[意图调试约束](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/insight-intent-debug)

### 2.3 视觉与语音

Vision Kit 提供文档扫描和 AI 识图，Core Vision Kit 提供 OCR；官方文档明确标注 Vision Kit 和通用文字识别当前不支持模拟器。因此 W01 只验收 Picker、上传、PDF 文本提取和 `NEEDS_OCR` 真实状态，不能把 OCR 写成 P0。[Vision Kit 简介](https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/vision-introduction)、[Core Vision 通用文字识别](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/core-vision-text-recognition-V5)

Meeting State Diff 的 P2 最小输入采用文本转录。只有获得可验证的真机或平台语音能力后，才增加录音和语音识别。

### 2.4 长期记忆与证据可信度

LongMemEval 把多会话推理、时间推理、知识更新和拒答列为长期记忆核心能力；Zep 的时间知识图研究强调保留关系的历史有效期。因此 2.1 选择“扩展现有 CardRelation”，而不是为了图谱名词迁移数据库。[LongMemEval](https://arxiv.org/abs/2410.10813)、[Zep temporal knowledge graph](https://arxiv.org/abs/2501.13956)

RAG 回答“有引用”不等于引用真实支撑了结论。相关研究把 citation correctness 和 citation faithfulness 分开，并观察到事后找引用的问题。因此 W05 必须评测 claim 与 evidence 的逐条支撑关系，而不是只统计 citation 数量。[Correctness is not Faithfulness in RAG Attributions](https://arxiv.org/abs/2412.18004)

## 3. 当前进展审计

本节以 2026-08-26 的仓库和串行测试为准。文档中较早的 38/38、76/76、79/79 等数字只保留为历史记录，不再作为当前基线。

| 切片 | 当前状态 | 已有证据 | 仍需关闭的 Gate |
|---|---|---|---|
| S01 构建/HAP | `VERIFIED`（unsigned） | Backend build、ArkTS build、Hypium、模拟器安装 | 正式签名 `PENDING` |
| S02 模拟器闭环 | `VERIFIED` | App 经 `10.0.2.2:4400` 读取真实 Backend，完成 Capture → Action → Reflection | 保持回归 |
| S02A 原生 UI | `PARTIAL` | 五页、统一组件、Evidence Spine、项目头像和导航 | 深色、大字体、屏幕朗读、慢网/乱序、横屏/大屏矩阵 |
| S03 真实模型 | `PARTIAL` | provider/fallback 元数据和探针脚本存在 | 真实 provider 20 样例 |
| S04 Hybrid Search | `PARTIAL` | Search API、embedding/backfill 和 benchmark 脚本存在 | 真实 embedding 与 Recall/MRR/Evidence Precision/p95 回执 |
| S05 Inbox | `PARTIAL` | Picker、上传、校验、PDF 提取、`NEEDS_OCR` 存在 | 图片/PDF 各 5 份模拟器回执；OCR 保持条件能力 |
| S06 Deliverable Gap | `PARTIAL` | Evidence 显式确认关系、规则测试和 HarmonyOS 流程存在 | App 选择/确认矩阵与 Gap Accuracy |
| S07 通知 | `PARTIAL` | NotificationKit、WantAgent、Snooze 和深链代码存在 | 模拟器权限、去重、冷/热启动和重启后调度回执 |
| S08 小艺 | `PARTIAL` | 四项本地能力、固定项目授权、Bearer、限流、幂等和 AgentRun；专项 8/8 | ECS HTTPS、平台字段映射、20 轮真实调用和 App 同 ID |

### 3.1 本轮可复核基线

2026-08-26 已串行重跑下面两项，结果用于 W00 输入。

```text
npm.cmd run verify:s08-adapter  → 1 file, 8/8 PASS
npm.cmd test                    → 12 files, 85/85 PASS
```

这两项只证明本地契约和后端回归，不证明 ECS、小艺平台、真实 provider 或模拟器人工矩阵已经通过。

### 3.2 S08 状态纠偏

旧版 2.1 计划把 `query_memory`、`inspect_project` 和 `create_action` 写成未实现。当前仓库已经存在：

```text
POST /xiaoyi/v1/memories
POST /xiaoyi/v1/memories/search
POST /xiaoyi/v1/projects/inspect
POST /xiaoyi/v1/actions
```

因此 W03 不再重复设计四套本地能力，重点改为部署、平台契约适配和真实对账。

## 4. 2.1 产品与安全契约

本节规定所有新功能必须保护的主线、不变量和外部接口语义。

### 4.1 主闭环

2.1 在 2.0 闭环中增加时间关系和证据状态，不改变 Backend 的唯一事实源地位。

```text
Capture / Attachment / Xiaoyi
        ↓
KnowledgeCard + 原始来源
        ↓
RELATED / SUPPORTS / CONTRADICTS / SUPERSEDES / DERIVED_FROM
        ↓
当前事实 + 过期事实 + 冲突 + 证据不足
        ↓
Milestone / Deliverable Gap
        ↓
Intervention Policy
        ↓
Evidence Trust Receipt + Action Preview
        ↓ 用户确认
Action → Result → Reflection Memory
```

### 4.2 不变量

后端必须执行以下不变量，不能依靠模型提示词或 UI 隐藏按钮实现。

- Backend 是唯一事实源；Web、HarmonyOS 和小艺共享相同项目状态。
- 两张关系卡必须属于同一项目，且不能是同一张卡。
- `SUPERSEDES` 不能成环；未确认关系不能改变当前事实。
- 多个已确认关系竞争同一当前事实时，系统显示冲突并要求人工选择。
- 用户必须能撤销错误确认；撤销保留审计记录并重新计算当前事实。
- `INSUFFICIENT` 时不生成确定性答案或高风险行动建议。
- 小艺不能接收模型传入的任意 `projectId`；测试身份只映射到 `XIAOYI_TEST_PROJECT_ID`。
- 外部写操作必须带稳定 request ID；重复请求不得重复创建卡片或行动。
- 小艺行动第一次调用只生成签名提案，第二次确认才创建 Action。
- mock、keyword fallback、平台失败和真机未测必须在 UI 与回执中明确标记。

### 4.3 功能开关

每个可选增量必须能独立关闭，关闭后保留数据并恢复 2.0 行为。

| 开关 | 默认值 | 关闭后的行为 |
|---|---|---|
| `TEMPORAL_MEMORY_ENABLED` | 实施期 `false` | 关系保留，Search 按 2.0 排序，不计算当前事实 |
| `EVIDENCE_TRUST_RECEIPT_ENABLED` | 实施期 `false` | Copilot 返回现有 citations，不显示 claim 支撑状态 |
| `INTERVENTION_POLICY_V2_ENABLED` | `false` | 使用现有 Intervention 去重和通知逻辑 |
| `PROJECT_CHANGE_BRIEF_ENABLED` | `false` | 隐藏变化简报入口，不影响周报和成果生成 |
| `XIAOYI_ADAPTER_ENABLED` | 生产显式设置 | 返回 503，App 与 Web 核心闭环继续运行 |

## 5. Gate 与依赖

本节把“能继续开发”和“能对外声称完成”分开。外部凭据缺失不会阻止纯规则和数据迁移工作，但会阻止相关 Gate 变成 `VERIFIED`。

| Gate | 通过条件 | 阻塞的工作 | 外部阻塞时的处理 |
|---|---|---|---|
| G0 Baseline | W00 全部通过 | 所有代码增量 | 先修基线，不新增功能 |
| G1 Simulator UX | W01 UI、S05-S07 矩阵通过 | W06 冻结 | 记录具体 AVD/API 限制，不写真机结论 |
| G2 Real AI | S03 20 样例 + S04 benchmark | 真实语义宣传、P2 Meeting 智能抽取 | 保留 mock/keyword fallback，状态为 `BLOCKED` |
| G3 Xiaoyi tracer bullet | 一次平台调用与 App 同 ID | S08 20 轮、云 A2A评估 | 回收时间做核心回归，不绕过鉴权 |
| G4 Temporal tracer bullet | 一条 confirmed supersession 全链路 | W05、W10-W12 | 关闭 feature flag，回退 2.0 |
| G5 Trust benchmark | claim 支撑和拒答门槛通过 | 对外“可信 Agent”声明 | 不展示确定性结论，只展示原始 evidence |
| G6 Freeze | 10 次演练、manifest 和材料 hash | 正式提交 | 候选功能全部砍掉，只修 P0 |

## 6. W00｜固化基线与证据目录

W00 不改业务逻辑。它建立后续所有结论可复核的起点，预计 0.5 人日。

**前置条件：** 当前工作树中的用户改动已备份或提交；Node、DevEco Studio 和现有模拟器可用。

**涉及文件：** `ProjectMemo_2.1_IMPLEMENTATION_NOTES.md`（新建）、`evidence/2.1/`（新建）、可选的证据采集脚本。

### 6.1 执行步骤

按顺序运行命令，任一命令失败就先记录原始输出，再定位失败原因。

1. 记录环境版本、当前提交号和工作树状态。
2. 串行运行 Backend 测试、类型检查、lint 和生产构建。
3. 运行 HarmonyOS Hypium 与 HAP 构建。
4. 运行 S08 专项测试。
5. 把每项命令、退出码和产物 SHA-256 保存到 `evidence/2.1/baseline/`。

```powershell
git rev-parse HEAD
git status --short
npm.cmd test
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
npm.cmd run build
npm.cmd run harmony:test
npm.cmd run harmony:build
npm.cmd run verify:s08-adapter
```

### 6.2 验收与回滚

W00 通过时，Backend 至少保持 85/85、S08 8/8、Hypium 23/23，构建命令退出码均为 0。测试数量未来可以增加，但不得减少现有关键用例。

如果基线失败，停止 W04-W12；只允许修复基线或恢复到已知可用提交。不得删除用户未提交的改动，也不得用 `git reset --hard` 处理失败。

## 7. W01｜关闭模拟器 UI、Inbox、Gap 与通知验证债

W01 优先产出真实模拟器回执；只有测试暴露缺陷时才改代码。预计 2-3 人日，不含缺陷修复时间。

**前置条件：** G0 通过；Backend 以 `npm.cmd run harmony:backend` 在 `127.0.0.1:4400` 运行；Pura 90、Mate X7、MatePad Pro 13 和 MateBook Pro AVD 至少能启动目标机型。

**代表文件：** `harmonyos/entry/src/main/ets/pages/`、`harmonyos/entry/src/main/ets/components/AsyncStateView.ets`、`AttachmentService.ets`、`MilestoneService.ets`、`NotificationService.ets`、`EntryAbility.ets`。

### 7.1 UI 状态矩阵

每个状态至少保存一张截图和一份 `uitest dumpLayout`。颜色不是唯一状态编码，所有可操作元素必须有文字或无障碍标签。

| 场景 | Phone 竖屏 | Foldable | Tablet/2in1 | 通过标准 |
|---|---:|---:|---:|---|
| 首页有数据/空态/错误态 | 必测 | 抽测 | 必测 | 无遮挡、无死按钮、可恢复 |
| ProjectHome 正常/慢网/乱序返回 | 必测 | 抽测 | 必测 | 旧请求不覆盖新状态 |
| MemoryTimeline 长标题/长摘要/大字体 | 必测 | 必测 | 必测 | 不截断关键证据与当前状态 |
| InterventionDetail 读屏顺序 | 必测 | 抽测 | 抽测 | Evidence → 判断 → 操作顺序正确 |
| ActionBoard 弹窗、键盘、完成回写 | 必测 | 抽测 | 必测 | 键盘不遮挡提交，结果可持久化 |
| 深色模式 | 必测 | 抽测 | 必测 | 对比度和状态语义可辨 |

慢网使用可恢复的代理延迟或测试服务注入，不通过在页面里写死 `sleep` 实现。乱序场景至少制造两个连续请求，让较早请求最后返回。

### 7.2 S05-S07 场景

按下面的样例数量执行，保留失败样例。

| 切片 | 样例 | 必须观察的状态 |
|---|---|---|
| S05 图片 | 5 份：正常 JPEG、PNG、大图、伪扩展名、重复文件 | 成功、格式拒绝、大小拒绝、去重；OCR 不可用时显示 `NEEDS_OCR` |
| S05 PDF | 5 份：文本 PDF、扫描 PDF、损坏 PDF、超限 PDF、重复 PDF | 提取成功、`NEEDS_OCR`、失败可重试、去重 |
| S06 Gap | 至少 30 个规则 case + 10 次 App 操作 | 未确认 evidence 不关闭 Gap；确认后只关闭对应 deliverable |
| S07 通知 | 权限允许/拒绝、重复触发、点击、冷启动、热启动、Snooze、重启 | 稳定通知 ID、正确深链、拒绝权限不破坏 App 内提醒 |

### 7.3 验收、证据与 STOP

W01 的证据写入 `evidence/2.1/ui-matrix/` 和 `evidence/2.1/inbox-gap-notification/`。每个失败必须标注“产品缺陷”“模拟器限制”或“真机待测”，不得只删除失败截图。

以下情况触发停止对应能力：

- Vision/OCR API 明确不支持模拟器：保持 `UNVERIFIED`，不继续用模拟数据冒充。
- 通知权限或 WantAgent 在目标模拟器完全不可用：保留 App 内 Intervention，S07 记为 `BLOCKED`。
- 大屏布局需要重写五页才能通过：先保证 Phone 与 Tablet 关键闭环，折叠屏增强降为 P2。

## 8. W02｜关闭真实模型与 Hybrid Search Gate

W02 验证真实 provider，不把 deterministic mock 或 keyword fallback 计入成功。预计 1-2 人日，外部凭据等待时间不计入。

**前置条件：** 获得明确授权的 OpenAI-compatible chat 和 embedding 端点、模型名、预算上限；密钥只进入本地或 ECS 环境变量。

**代表文件：** `lib/agent/llmAgent.ts`、`lib/memory/embedding.ts`、`lib/memory/hybridSearch.ts`、`scripts/probe-llm.ts`、`scripts/benchmark-hybrid-search.ts`。

### 8.1 执行步骤

先做最小探针，再运行会产生费用的批量评测。

1. 配置真实 provider 环境变量。
2. 运行 `npm.cmd run verify:s03-provider`，确认响应不是 mock/fallback。
3. 用 20 份覆盖论文、代码、实验、会议、需求和风险的输入运行 Capture。
4. 人工核对结构化字段与原文一致性，保存 provider、model、duration 和 fallbackReason。
5. 确认预算后运行 `npm.cmd run benchmark:s04 -- --confirm-provider-cost`。
6. 保存原始 JSON、标注集和 dataset hash，禁止只保留汇总分数。

### 8.2 通过门槛

W02 使用以下门槛。指标未达标时先检查标注和检索错误类型，不直接更换模型掩盖问题。

```text
S03 valid structured captures     >= 19/20
S03 unlabelled fallback           = 0
Recall@8                          >= 0.90
MRR                               >= 0.80
Evidence Precision                >= 0.90
p95 retrieval latency             <= 1500 ms（ECS 同区域实测）
provider/model metadata coverage  = 100%
```

### 8.3 回退与 STOP

如果 provider 不可用或费用未获授权，将 G2 标记 `BLOCKED`，保留当前 mock 和 keyword fallback。其他工作可以继续，但作品说明必须写“真实语义检索未通过”，不能展示 semantic 指标。

## 9. W03｜完成 S08 ECS 与小艺真实对账

W03 复用现有四项本地能力，把 `project.luojiatutor.xyz` 变成小艺平台可调用的真实入口。预计 1-2 人日，平台审核和证书等待时间不计入。

**前置条件：** 香港 ECS 运行 Alibaba Cloud Linux；域名 A 记录已指向 ECS；安全组允许 80/443；拥有小艺开放平台测试态工作流权限。

**代表文件：** `app/xiaoyi/v1/`、`lib/xiaoyi/`、`deploy/alibaba-cloud-linux/`、`docs/xiaoyi/`、`tests/xiaoyi.adapter.test.ts`。

### 9.1 部署 tracer bullet

先只验证 `record_memory`，成功后再配置其余节点。

1. 按 [`Alibaba Cloud Linux 部署 S08`](./docs/xiaoyi/Alibaba%20Cloud%20Linux%20部署%20S08.md) 部署 Next.js、systemd、Nginx 和证书。
2. 设置 `XIAOYI_ADAPTER_ENABLED=true`、至少 32 字符的 Token 和固定 `XIAOYI_TEST_PROJECT_ID`。
3. 从外网访问 `GET https://project.luojiatutor.xyz/health`。
4. 用 PowerShell 或 curl 调用 `POST /xiaoyi/v1/memories`，保存 `request_id`、`agent_run_id` 和 `card_id`。
5. 让 DevEco 模拟器的演示构建读取云端 Backend，确认 Memory 页面出现同一个 `card_id`。
6. 在小艺插件节点配置同一接口；真实平台调用成功后，手工调用只保留为网络诊断证据。

### 9.2 四项平台工具契约

平台字段必须映射到现有严格 schema；平台没有的字段不得由模型自由拼接。

| 小艺工具 | HTTP 接口 | 写入行为 | 成功证据 |
|---|---|---|---|
| `record_memory` | `POST /xiaoyi/v1/memories` | 创建一张卡片 | App、AgentRun、平台返回同一 `card_id` |
| `query_memory` | `POST /xiaoyi/v1/memories/search` | 只读 | 返回 evidence card ID 和 retrieval mode |
| `inspect_project` | `POST /xiaoyi/v1/projects/inspect` | 可触发评估，但不创建 Action | milestone、Gap、Intervention 与 App 一致 |
| `create_action` | `POST /xiaoyi/v1/actions` | 第一次提案，确认后写入 | 提案时 Action=0；确认后恰好新增 1 条 |

### 9.3 20 轮与安全对照

先完成 20 轮正常调用，再执行负向测试。正常结果和失败结果都写入 `evidence/2.1/xiaoyi/`。

```text
record_memory     5 轮
query_memory      5 轮
inspect_project   5 轮
create_action     5 轮（每轮都含 proposal + commit）
```

额外负向测试至少覆盖：缺少 Token、错误 Token、缺少 request ID、重复 request ID、模型传入 `project_id`、无效/过期 proposal、限流、Backend 503。成功门槛如下：

- 20/20 正常调用具有关联 request ID 和 AgentRun；
- 重放返回相同业务 ID，不产生重复副作用；
- Unauthorized Action Rate = 0；
- 平台失败时，小艺不能回复“已记录”或“已创建”；
- 请求、AgentRun、数据库和 App 至少四方可按 ID 对账；
- 真机小艺入口保持 `UNVERIFIED`。

### 9.4 回滚与 STOP

发现越权、重复写入或敏感数据泄漏时，立即把 `XIAOYI_ADAPTER_ENABLED` 设为 `false` 并重启服务。保留数据库和失败回执用于诊断。

如果平台不支持当前 Bearer 配置，不得删除服务端鉴权。记录平台支持的认证字段，再单独调整认证适配层；在方案确认前停止 W03 平台写入测试。

## 10. W04｜交付 Temporal Evidence Ledger tracer bullet

W04 是复赛唯一必须新增的技术差异化功能。先完成一条“新决定取代旧决定”的纵向闭环，再扩充关系类型和 benchmark。预计 3-5 人日。

**前置条件：** G0 通过；S04/S06 的本地规则和测试可运行。G2 可以是 `BLOCKED`，但模型自动提议关系不得计入真实 AI 成果。

**代表文件：** `prisma/schema.prisma`、新 migration、`lib/repositories/cards.ts`、建议新增 `lib/memory/temporalLedger.ts`、新的 decisions/relations Route Handler、`lib/types.ts`、HarmonyOS `MemoryTimeline.ets` 与对应 model/service、独立测试和 benchmark 脚本。

### 10.1 数据模型

第一版扩展 `CardRelation`，不引入图数据库。旧字段和 `RELATED` 行为必须兼容。

```text
CardRelation
  currentCardId       新卡片
  relatedCardId       被关联或被取代的旧卡片
  reason              关系理由
  score               保留旧字段
  relationType        RELATED | SUPPORTS | CONTRADICTS | SUPERSEDES | DERIVED_FROM
  confidence          0..1，可空
  confirmed           false by default
  confirmedAt         datetime?
  revokedAt           datetime?
  validFrom           datetime?
  validTo             datetime?
```

旧关系迁移为 `RELATED + confirmed=false`。`score` 可以归一化为 confidence，但不能因此自动确认关系。

### 10.2 接口

第一版提供读取、提议、确认和撤销四种动作。确认和撤销必须校验 project、relation 和 card 的归属。

```http
GET  /api/projects/:id/decisions/timeline
POST /api/projects/:id/cards/:cardId/relations/propose
POST /api/projects/:id/relations/:relationId/confirm
POST /api/projects/:id/relations/:relationId/revoke
```

`/api/projects/:id/cards/search` 增加兼容字段：

```json
{
  "current": true,
  "supportState": "SUPPORTED",
  "supersededBy": null,
  "temporalReason": "8/23 的已确认决策取代 8/20 决策"
}
```

旧客户端忽略新字段后必须继续工作。

### 10.3 纵向实现步骤

按下面顺序实施，禁止先搭建通用图查询框架。

1. 增加 additive migration、默认值和回滚说明。
2. 实现跨项目、自环和 `SUPERSEDES` 成环校验。
3. 实现一条关系的提议、确认、撤销和当前事实计算。
4. 增加 API 集成测试，证明未确认关系不改变 Search。
5. 在 MemoryTimeline 增加“决策演化”入口，展示当前决定、旧决定、变更原因和确认状态。
6. 使用两条固定卡片完成 App 纵向演示。
7. 通过 tracer bullet 后，再加入 `CONTRADICTS`、冲突选择和 60 组 benchmark。

### 10.4 UI 状态

MemoryTimeline 必须覆盖以下状态，且不能只用颜色区分：

- `当前有效`：已确认且未被有效关系取代；
- `已取代`：显示取代它的卡片和原因；
- `存在冲突`：多个候选当前事实，等待人工选择；
- `待确认`：模型或规则提出关系，但尚未生效；
- `已撤销`：保留历史审计，不参与当前事实；
- `证据不足`：没有足够关系支持当前结论。

### 10.5 测试与门槛

测试集至少包含 60 组：明确取代、只补充不取代、矛盾但证据不足、截止日期变化、方案回滚、重复记录、查询过去版本、查询当前版本、环、自环和跨项目关系。

```text
Conflict Detection F1          >= 0.85
Supersession Precision         >= 0.90
Current Fact Accuracy          >= 0.90
Evidence Precision             >= 0.95
Unconfirmed auto-activation    = 0
Cross-project relation writes  = 0
Supersession cycles accepted   = 0
```

原始样例、预测、人工标注和指标写入 `evidence/2.1/temporal/`。评测未达标时关闭 `TEMPORAL_MEMORY_ENABLED`，保留关系数据并恢复 2.0 搜索。

## 11. W05｜加入 Evidence Trust Receipt 与拒答

W05 不是新的 Agent 平台。它复用当前 `AgentMessage.citations`、Search 结果和 `AgentRun.trace`，让每个关键结论显示证据支撑状态。预计 2-3 人日。

**前置条件：** G4 通过；Copilot 和 Search 当前回归通过。

**代表文件：** `lib/services/copilotService.ts`、`lib/types.ts`、`lib/agent/prompts.ts`、`components/MemoryCopilot.tsx`、HarmonyOS Copilot model/service/page、AgentRun 展示与新的 benchmark。

### 11.1 输出契约

Copilot 的每个可核查 claim 必须映射到 evidence card，而不是整段回答挂一个 citation 列表。

```json
{
  "message": "当前复赛方案改为工作流 Agent。",
  "supportState": "SUPPORTED",
  "abstained": false,
  "claims": [
    {
      "text": "当前复赛方案改为工作流 Agent。",
      "support": "SUPPORTED",
      "cardIds": ["new-decision-card"],
      "supersededCardIds": ["old-decision-card"]
    }
  ]
}
```

第一版只允许以下三个互斥状态：

| 状态 | 行为 |
|---|---|
| `SUPPORTED` | 当前有效证据直接支持 claim，可给出结论 |
| `CONTESTED` | 有相互冲突或未解决的当前证据，只陈述冲突并请求确认 |
| `INSUFFICIENT` | 没有足够证据，明确说不知道，不生成确定性结论或行动 |

### 11.2 实现步骤

按下面顺序加入可信回执，不在第一版引入第二个 LLM judge 服务。

1. 用确定性规则检查 citation card 是否存在、是否属于当前项目、是否已被取代。
2. 把 claim、card IDs、support state、检索模式和拒答原因写入 `AgentRun.trace`。
3. 扩展 Copilot 响应类型，旧客户端缺少新字段时保持兼容。
4. 在 Web 和 HarmonyOS 中展示“依据充分 / 存在冲突 / 证据不足”，并允许展开原始卡片。
5. 对写操作增加守卫：`CONTESTED` 或 `INSUFFICIENT` 不直接生成可提交行动，只能建议补充证据或人工选择。
6. 建立 40 组人工标注问题，覆盖已知、已过期、冲突、未知和错误 citation ID。

### 11.3 通过门槛

门槛用于本项目评测，不代表通用模型能力承诺。

```text
Claim Evidence Precision       >= 0.95
Current-source usage           >= 0.90
Abstention recall              >= 0.90
Unsupported confident claims   = 0
Cross-project citations        = 0
Actions from INSUFFICIENT       = 0
```

关闭 `EVIDENCE_TRUST_RECEIPT_ENABLED` 后，Copilot 恢复 2.0 citation 展示；Answer、Action、Capture 和已有 AgentMessage 不得损坏。

## 12. W06｜用户验证、演示冻结与提交包

W06 把代码和研究结果转化为评委可复核的材料。预计 3-4 人日，必须在功能冻结后执行。

**前置条件：** G1、G3、G4 至少通过；G2/G5 如未通过，材料必须明确降级；候选功能全部保持关闭。

### 12.1 用户任务

招募目标为 8-15 名学生，覆盖科研、学科竞赛和课程项目。人数不足时报告实际样本量，不补造数据。

每名参与者执行六项任务：

1. 导入一份脱敏项目材料。
2. 找回一条过去决定。
3. 判断一条新记录是否取代旧决定。
4. 查看一次有证据的风险介入。
5. 接受、稍后或忽略建议。
6. 完成行动并确认 Reflection Memory。

记录首次成功率、总时间、检索成功率、错误引用数、未经确认写入数、提醒反馈分布、SUS 或简化问卷，以及“最可信、最打扰、最难理解”的开放反馈。

### 12.2 十次演练

固定同一数据集和 release candidate，连续完成 10 次五分钟演示。每次保存起止时间、关键业务 ID、失败点和是否使用 fallback。

通过标准：

- 10/10 完成核心故事；
- 断网时能继续展示本地已有证据，并明确云能力不可用；
- provider 失败时显示 fallback，不冒充真实模型；
- 小艺失败时不显示写入成功；
- 每次都能从旧决定进入新决定，再进入 Gap、Intervention、Action 和 Reflection。

### 12.3 Release manifest

从同一候选提交生成全部材料，并记录以下字段：

```text
git commit
working tree status
DB migration hash
model/provider/version
benchmark dataset hash
raw benchmark result hash
HAP path + SHA-256 + signed/unsigned
Backend build hash
小艺工作流/Agent 版本
10 次 Demo receipts
用户试用匿名摘要
说明文档/PPT/视频 SHA-256
已知限制与 UNVERIFIED 清单
```

manifest 生成后只允许修复阻断性 Bug、文档错误和提交格式；任何功能变化都必须生成新的 manifest 并重跑十次演练。

## 13. 晋级后 W10｜Intervention Budget

W10 把固定提醒升级为可解释的低打扰策略，不训练个性化模型。预计 2-3 人日。

**前置条件：** G4/G5 通过，S07 至少在模拟器完成通知矩阵。

**建议落点：** 新增纯函数模块 `lib/interventions/policy.ts`；复用 `AgentIntervention` 历史；只有安静时段和每日预算无法表达时才新增项目级 preference 表。

策略输入包括风险严重度、截止时间、证据完整度、重复提醒、最近接受/忽略/稍后、安静时段和每日预算。输出只能是：

```text
SHOW_IN_APP
NOTIFY_NOW
SCHEDULE_LATER
SUPPRESS_DUPLICATE
SUPPRESS_LOW_CONFIDENCE
```

每次结果写入 AgentRun：输入信号、规则版本、阈值、渠道、抑制原因。策略不得自动创建 Action。

使用模拟时钟运行至少 80 个场景，门槛如下：

```text
Duplicate Reminder Rate       = 0
Quiet-hours violations        = 0
Daily-budget violations       = 0
High-risk recall              >= 0.90
Appropriate-channel accuracy  >= 0.85
Unauthorized Action Rate      = 0
```

## 14. 晋级后 W11｜Project Change Brief

W11 新增“项目变化简报”，回答自上次查看以来发生了什么，而不是再生成一篇普通周报。预计 1-2 人日。

**前置条件：** Temporal Ledger 和 Intervention Budget 通过；变化简报只读，不自动修改项目。

第一版按需生成，不建缓存和调度系统。它只汇总四类内容：

```text
新增事实
被取代或冲突的决定
新出现的 Deliverable Gap / Risk
等待用户确认的行动
```

建议新增只读接口 `GET /api/projects/:id/change-brief?since=<ISO time>`，并在 ProjectHome 增加一张可展开简报卡。每一项必须带 card、relation、deliverable 或 intervention ID；没有变化时返回明确空态。

首版通过标准：20 个固定时间窗口中，变化召回率 >= 0.90、错误旧事实引用为 0、无证据条目为 0。验证通过后再评估通知或小艺“今天项目有什么变化”入口。

## 15. W12｜只选择一个候选增强

W12 只有在 W10/W11 完成且离国赛冻结至少还有 7 天时才能启动。下面的候选互斥，默认选择 Meeting State Diff。

| 候选 | 用户价值 | 启动条件 | 当前结论 |
|---|---|---|---|
| Meeting State Diff | 把一次组会文本变成“新增/确认/改变/冲突/待确认行动” | 文本输入稳定；W04/W05 通过 | **首选** |
| 云 A2A | 让现有云端 Agent 通过 Agent Card 和任务生命周期接入 | W03 20 轮通过；获得平台权限 | 条件启动 |
| 意图一步达 | 从小艺直达指定 ProjectMemo 页面 | App 上架；API 20+ 真机可调试 | 当前 `BLOCKED` |
| Vision OCR/文档扫描 | 图片直接进入可检索证据 | 获得支持 Kit 的真机 | 当前 `UNVERIFIED` |
| 跨端 Project Review | 手机捕获、平板/PC 审核 | 至少两台真实设备、签名和同账号 | 当前 `UNVERIFIED` |
| Smart Scheduling | 把建议落到日历 | 日历权限、时区、冲突和撤销方案齐备 | 不优先 |
| GitHub Evidence | 自动发现代码提交证据 | 有真实开发用户和 OAuth/隐私方案 | 不优先 |

### 15.1 Meeting State Diff 最小交付

第一版只接受一份文本转录或可提取文本的 PDF，并输出以下预览：

```text
新增了什么？
确认了什么？
改变了什么？
与旧记录冲突什么？
哪些行动等待确认？
```

所有变化必须先预览。用户确认后，系统才能创建 KnowledgeCard、CardRelation 或 Action。音频、说话人分离和会议录制都不属于第一版。

## 16. 时间表与砍项门

下面按当前 2026-08-26 状态排期。复赛截止时间以仓库盖章规程和赛事后台最新通知为准；如果日期变化，保持相同冻结缓冲，不压缩最后三天上传窗口。

| 日期 | 工作包 | 当日必须产生的输出 | 砍项门 |
|---|---|---|---|
| 8/26-8/27 | W00 | 基线回执、证据目录、实施笔记 | G0 不过则停止所有新增功能 |
| 8/28-9/02 | W01 | UI/S05-S07 模拟器矩阵 | 需重写五页时砍大屏增强，保 Phone 主链 |
| 8/28-9/04 | W02 | provider 探针和 benchmark | 无凭据则标 `BLOCKED`，不得假装 semantic |
| 8/28-9/05 | W03 | HTTPS + 一次同 ID tracer bullet | 9/05 平台仍不通则停止云 A2A 讨论 |
| 9/06-9/12 | W04 | confirmed supersession 纵向闭环 | 9/10 migration 不稳定则关闭 flag，保设计和测试集 |
| 9/13-9/16 | W05 | Trust Receipt + 40 组评测 | 门槛不达则只展示原始 Evidence，不宣称可信回答 |
| 9/17-9/19 | 缺陷清零 | 全量回归、十次演练候选 | 9/17 任一核心闭环失败，砍 W05 UI 增强 |
| 9/20 | 功能冻结 | release candidate | 冻结后不启动 W10-W12 |
| 9/21-9/25 | W06 | 用户试用、说明文档、PPT、视频 | 只修阻断性缺陷 |
| 9/26-9/27 | 提交预演 | release manifest、备用包 | 材料必须来自同一 commit |
| 9/28 | 首次完整上传 | 后台下载复核 | 不等最后一天首次上传 |
| 9/29-9/30 | 缓冲 | 修复上传/格式问题 | 禁止功能变化 |
| 晋级后 | W10 → W11 → W12 | 每次只启动一个工作包 | 国赛冻结前 7 天停止新增功能 |

## 17. 数据迁移、兼容与回滚

本节适用于 W04 及之后的 schema 或响应变化。所有迁移必须 additive，旧客户端必须可以忽略新增字段。

1. 在迁移前复制 SQLite 数据库并记录文件 hash。
2. 给新字段提供兼容默认值；旧 `CardRelation` 保持 `RELATED` 行为。
3. 在空数据库、2.0 seed 数据库和真实演示数据库副本上分别运行 migration。
4. 在开启 flag 前完成回归；开启后运行 tracer bullet；失败时先关闭 flag。
5. 关闭 flag 后不删除新关系或审计数据，只恢复 2.0 查询和 UI。
6. 如果 migration 破坏 Capture → Action → Reflection，立即停止并从已验证备份恢复。
7. 数据恢复完成后重新运行 W00，不沿用迁移前回执。

## 18. 全局 STOP 条件

遇到以下条件时，执行者必须停止对应工作包并记录，不得自行扩大权限或伪造替代方案。

1. 小艺平台没有测试资格、插件节点或可映射的鉴权方式。
2. S08 只能通过无认证接口或模型可控 `projectId` 工作。
3. 真实 provider/embedding 无预算授权或无法稳定调用。
4. 未确认关系会自动覆盖当前事实，或撤销后无法恢复。
5. Evidence Trust Receipt 把相似 citation 当作 claim 的直接支持。
6. 只有模拟器却需要声明真机小艺、端 A2A、意图、Vision OCR 或跨端迁移完成。
7. 新功能要求迁移数据库技术栈、重写 Backend 或并行维护第二事实源。
8. 测试需要上传密钥、私有文档或未脱敏用户数据。
9. 功能冻结后仍需要 schema 或外部接口变更。

## 19. 文件修改地图

本节帮助后续执行者快速定位代码，但不要求一次修改所有文件。每个工作包只触碰完成其纵向结果所需的最小集合。

| 目的 | 主要现有文件 | 允许的新文件 |
|---|---|---|
| 时间关系数据 | `prisma/schema.prisma`、`lib/repositories/cards.ts` | migration、`lib/memory/temporalLedger.ts` |
| 时间线 API | `app/api/projects/[id]/cards/search/route.ts` | `app/api/projects/[id]/decisions/`、`relations/` routes |
| Trust Receipt | `lib/services/copilotService.ts`、`lib/types.ts`、`lib/agent/prompts.ts` | 独立纯规则/benchmark 文件 |
| HarmonyOS 时间线 | `MemoryTimeline.ets`、`MemoryService.ets`、`Memory.ets` | 必要的小组件，不新建第二导航体系 |
| 介入预算 | `agentContextService.ts`、`NotificationService.ets`、AgentRun | `lib/interventions/policy.ts` |
| 变化简报 | ProjectHome、milestone/intervention repositories | `changeBriefService.ts`、只读 route |
| S08 | `app/xiaoyi/v1/`、`lib/xiaoyi/` | 仅平台契约确有差异时增加适配代码 |
| 评测 | `scripts/`、`tests/` | temporal/trust/policy benchmark 和数据集 |

## 20. 明确不做

这些功能与当前得分主线相近，但会稀释实施和验收时间，因此不进入 2.1 默认范围。

- 团队 IM、群聊、社区和动态；
- 完整 Kanban、Gantt、工时和企业权限体系；
- 通用知识库、通用聊天机器人或多 Agent 角色扮演；
- 新图数据库、向量数据库或事件流平台；
- 未经评测的自动项目管理；
- 同时实现多个小艺/意图/A2A 入口；
- 为凑 HarmonyOS 特性数量而加入与证据闭环无关的 Kit；
- 在只有模拟器时投入真机专属 Vision、意图和跨端功能。

## 21. 验证命令与预期结果

当前命令和计划新增命令分开列出。尚未创建的脚本在对应工作包实施时加入 `package.json`，不能在实施笔记里提前写 PASS。

### 21.1 当前必须通过

下面的命令在每个 release candidate 上串行运行。

```powershell
npm.cmd test
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
npm.cmd run build
npm.cmd run harmony:test
npm.cmd run harmony:build
npm.cmd run verify:s08-adapter
```

预期结果：退出码为 0；当前基线至少为 Backend 85/85、S08 8/8、Hypium 23/23；Next.js 构建包含 `/health` 和四个 `/xiaoyi/v1/*` 路由。

### 21.2 实施后新增

这些命令必须先输出机器可读的 JSON/CSV，再输出摘要。

```powershell
npm.cmd run verify:s03-provider
npm.cmd run benchmark:s04 -- --confirm-provider-cost
npm.cmd run benchmark:temporal-memory
npm.cmd run benchmark:evidence-trust
npm.cmd run benchmark:intervention-policy
npm.cmd run verify:release-manifest
```

如果脚本因为缺少外部凭据退出，它必须返回非零退出码并说明缺少哪项配置，不能自动切换 mock 后返回成功。

## 22. 五分钟答辩故事

现场演示只讲一条变化链，不逐页介绍所有功能。

1. 从 HarmonyOS App 或小艺记录一条旧方案。
2. 导入一条新的组会决定。
3. ProjectMemo 发现新旧决定冲突，但先显示“待确认”。
4. 用户查看两条原始证据并确认 `SUPERSEDES`。
5. 系统把旧方案标为已取代，并显示当前决定和变化原因。
6. Deliverable Gap 发现新方案缺少验证证据。
7. 系统给出带 Trust Receipt 的提醒；证据不足的 claim 明确拒答。
8. 用户确认创建行动，完成后回写 Reflection Memory。

答辩只强调三个技术点：

```text
Temporal Evidence Memory
Goal-aware Gap Reasoning
Human-controlled Proactive Intervention
```

HarmonyOS 与小艺的作用是把这三个能力带到系统入口，而不是作为孤立的 Kit 清单。

## 23. 显式假设

执行者在 W00 更新这些假设的状态。任何假设失效时，按对应 STOP 或降级路径处理。

| 假设 | 当前状态 | 失效后的处理 |
|---|---|---|
| 复赛提交截止仍以盖章规程/赛事后台为准 | 待持续核对 | 调整日期，不压缩三天上传缓冲 |
| DevEco 四类 AVD 可用于模拟器矩阵 | 本机已有记录，待 W01 复核 | 保 Phone 主链，缺失设备记 `BLOCKED` |
| 香港 ECS 和域名由用户控制 | 已确认，HTTPS 待部署 | W03 保持 `PARTIAL` |
| 小艺测试态允许配置插件和某种安全鉴权 | 未验证 | 停止平台写入，不关闭后端鉴权 |
| 真实 chat/embedding provider 可获得 | 未验证 | G2 `BLOCKED`，保 mock/keyword fallback |
| SQLite 足以承载当前单用户竞赛数据量 | 已由现有架构支持 | 不迁移数据库；出现真实瓶颈先测量 |
| 当前只有模拟器 | 已确认 | 真机专属能力全部 `UNVERIFIED` |

## 24. Plan validation

本节验证计划本身是否可执行，不代表 W01-W12 已经完成。

```text
PLAN VALIDATION: ProjectMemo_2.1_PLAN.md
  Answers the request
    第 0 节给出新增功能与优先级；第 6-15 节形成可执行工作包；第 16 节给出日程和砍项门。

  Answers landed
    当前只有模拟器、已有香港 ECS/域名、工作流优先于 A2A、S08 四能力已本地实现、暂不改代码，全部写入计划。

  Scope gate
    复赛只强制 Temporal Ledger + 其可信回执；W10-W12 晋级后串行；第 20 节列出明确不做。

  Assumptions explicit
    第 2、5、18、23 节标明平台、provider、设备、上架和日期边界。

  Verification
    第 21 节列出现有命令、计划新增命令、非零失败语义和预期结果。
```

## 25. Review notes

2026-08-26 按 Completeness、Feasibility、Scope、Testability、Risk 和 Assumptions 六个维度重新审查。初审分数针对旧版 2.1 文档；修订后分数针对本文。

| 维度 | 初审 | 修订后 | 主要修订 |
|---|---:|---:|---|
| Completeness | 4/5 | 5/5 | 增加逐工作包的前置、步骤、异常、证据、回滚和 STOP |
| Feasibility | 3/5 | 5/5 | 修正 S08 四能力现状；先 ECS tracer bullet；真机专属能力条件化 |
| Scope | 4/5 | 5/5 | P0/P1/P2 分层，候选互斥，不引入图数据库或第二 Agent 平台 |
| Testability | 4/5 | 5/5 | 增加模拟器矩阵、20 轮小艺、60/40/80 数据集和机器可读回执 |
| Risk | 4/5 | 5/5 | 增加越权、重放、关系环、错误确认、拒答、迁移和冻结回滚 |
| Assumptions | 4/5 | 5/5 | 把设备、平台、provider、上架、ECS 和日期条件单列并给出失效处理 |

最终判定：计划可作为后续实现的交接文档。实施者必须先执行 W00，并持续维护 `ProjectMemo_2.1_IMPLEMENTATION_NOTES.md`；计划评分不能替代真实 provider、模拟器、ECS、小艺平台或用户试用回执。

## 26. 下一步

从 W00 开始，不要直接进入 Temporal Ledger 编码。完成基线回执后，并行执行 W01、W02 和 W03；首次需要新增业务代码的工作包是 W04。
