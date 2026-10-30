# R4 Agent UX：代码与 Demo 对账

本报告完成 UX-0 的源码审计。统一实施顺序及验收案例见 [Roadmap](D:/Projects/hongmen/planning/r4-agent-ux-integration/R4_AGENT_UX_INTEGRATION_ROADMAP.md)，交互细节见 [核心页面方案](D:/Projects/hongmen/planning/r4-agent-ux-integration/CORE_PAGE_DESIGN.md)。本轮只有规划文档变更。

## 1. 审计对象与证据等级

| 对象 | 本次核对结果 |
|---|---|
| 真实本地工作树 | codex/ct5-ct6-research @ e8281d6b8bb8781447eb1ebfb1a60ebcfcd0dd3a |
| master / origin/master | e87b8eeb79003c0a0798378611304c09db90cd87；CT-4～6 尚在本地当前分支的提交链 |
| 已有 tracked 修改 | AGENTS.md、旧 Agent Evolution Roadmap、harmonyos/build-profile.json5、tsconfig.json；逐文件哈希保留 |
| Demo | [v2 原型目录](D:/Projects/hongmen/prototypes/ProjectMemo_CodeGrounded_Agent_Research_Web_Harmony_Demo_v2_2026-10-29/ProjectMemo_CodeGrounded_v2)；README、研究说明、HTML 及 Web/mobile 图片 |
| 规划来源 | planning/r4-continuity-20261028 下的 Roadmap、Intent、Context/Handoff、UX、Eval、Decisions、Tool Matrix；原 AgentExperience 与 PR-6 规划／实施记录 |
| 当前页面证据 | Web/ArkTS 源码与接口；另查看 CT-5/6 隔离 E2E 的批准、核算回执截图；本轮未重新启动应用或做真机操作 |
| 验证方式 | 静态调用链、原验收 JSON、原截图、输入文件哈希；不运行写入探针、数据库迁移或模型 |

“源码存在”证明有实现入口；“历史测试通过”证明对应快照上的工程检查；“真实模型 pilot”证明该次传输和行为；“目标设备／多日用户／独立评审”分别签收。本文的可复现步骤是后续隔离环境的检查方案，未写成已经执行的运行结果。

## 2. CT-1～6：已经交付的基础与仍开放的 Gate

| 基础 | 已核对实现与记录 | 可以复用 | 尚未成立的结论 |
|---|---|---|---|
| AgentExperience、Goal Reasoning | [investigationService](D:/Projects/hongmen/lib/conversation/investigationService.ts)、[presentationRuntime](D:/Projects/hongmen/lib/conversation/presentationRuntime.ts)、[AgentExperience 实施记录](D:/Projects/hongmen/R4_AGENT_EXPERIENCE_IMPLEMENTATION_NOTES.md) | 每次观察后动态选工具／询问／结束；十类原生语义块、可信 catalog、稳定草稿、原业务回读 | 开发集质量及部分模拟器验收不等于全部设备／独立留出集通过 |
| PR-6 | [researchTools](D:/Projects/hongmen/lib/conversation/researchTools.ts)、[researchCoverage](D:/Projects/hongmen/lib/conversation/researchCoverage.ts)、[researchSummary](D:/Projects/hongmen/lib/conversation/researchSummary.ts)、上述实施记录 | Search/Fetch、用户 URL、阅读层级、来源快照、覆盖、原 Artifact 预览确认；原 turn/worker/lease/UNKNOWN 账本 | 联网独立语义质量、跨代真实联网旅程和目标设备仍有 Gate |
| CT-1 | [directiveService](D:/Projects/hongmen/lib/continuity/directiveService.ts)、[admission](D:/Projects/hongmen/lib/continuity/admission.ts)、[turnCoordination](D:/Projects/hongmen/lib/continuity/turnCoordination.ts)、[实施记录](D:/Projects/hongmen/R4_CONTINUITY_IMPLEMENTATION_NOTES.md) | 原话准入、范围／期限、撤回、有效视图、generation/lease、抑制与跨会话接续 | 不能把虚拟 D1/D3/D5 说成真实五天使用；完整人评未完成 |
| CT-2 | [repoSource](D:/Projects/hongmen/lib/sensing/repoSource.ts)、原 CI observations/tools、[实施记录](D:/Projects/hongmen/R4_REPO_CI_IMPLEMENTATION_NOTES.md) | 明确连接授权、固定 SHA、状态／job／失败日志工具、同 Mission 原批准与结果 | 真实日志下载域名、私有 OAuth／必要 diff、目标设备未全签收；29 checks、20/26 runs 是不完整覆盖 |
| CT-3 | [investigationDelegation](D:/Projects/hongmen/lib/mission/investigationDelegation.ts)、[delegationObservation](D:/Projects/hongmen/lib/mission/delegationObservation.ts)、[attentionReceipt](D:/Projects/hongmen/lib/mission/attentionReceipt.ts)、[实施记录](D:/Projects/hongmen/R4_INVESTIGATION_DELEGATION_IMPLEMENTATION_NOTES.md) | 原 worker 定时观察同一固定 SHA、稳定观察零模型、累计预算、私人注意力、SEEN；无需第二 Runner | 真实多日 OS 长跑、系统推送、设备接受度不由虚拟时钟／服务测试证明 |
| CT-4 | [reader](D:/Projects/hongmen/lib/documents/reader.ts)、[observations](D:/Projects/hongmen/lib/documents/observations.ts)、双 Conversation/Mission documentTools、[实施记录](D:/Projects/hongmen/R4_DOCUMENT_DEEP_READ_IMPLEMENTATION_NOTES.md) | 原附件修订与文件 hash、物理页、原文引用及撤权保护；复用 Poppler | OCR／复杂表格、未知日期归因的完整回答、QUICK 完整质量、鸿蒙原页导航仍待验证 |
| CT-5/6 | [metrics](D:/Projects/hongmen/lib/experiments/metrics.ts)、[sandbox](D:/Projects/hongmen/lib/experiments/sandbox.ts)、[academicTools](D:/Projects/hongmen/lib/mission/academicTools.ts)、[crossrefMetadata](D:/Projects/hongmen/lib/research/crossrefMetadata.ts)、[实施记录](D:/Projects/hongmen/R4_EXPERIMENT_ACADEMIC_IMPLEMENTATION_NOTES.md) | CSV/JSON 条件与列映射；原批准后固定算术 Docker job；Crossref 元数据；同 Mission/Action/resultCardId | 固定算术不是训练平台；元数据不是全文；合成结果不是现实复现；完整 Conversation+新工具+生成 UI 独立质量仍开放 |

[CT-2/3 合并验证](D:/Projects/hongmen/evidence/r4-continuity/20261029-ct2-ct3/merge-validation.json) 记录 1158 项测试、Web 24 通过／2 跳过、鸿蒙 86 项及 HAP。当前 CT-5/6 [最终回执](D:/Projects/hongmen/evidence/r4-experiments/20261029-complete/acceptance-summary.json) 记录 141 文件／1189 项测试、完整 Web 26 通过／2 跳过、最后定向 Web 2 通过、鸿蒙 86 项及最终 HAP。这些数字不相加，也不替代本轮的规划验证。

CT-5/6 的 21 次真实模型请求与 Docker、Crossref 真实传输确有记录；输入／Action 结果属于合成旅程。最终分离模型评审为 PARTIAL_PASS_WITH_UNVERIFIED_ITEMS；同供应商评审不等于独立人工验收。旧失败、Crossref UNKNOWN 和原预算继续保留。

## 3. 八项 Demo 能力逐项映射

类型沿用 Roadmap：U＝UI／调用接合，S＝原服务内补全，V＝未验收，L＝后续 CT 或渠道。

| Demo 项 | 现有服务、接口与页面 | 本次应改什么 | 缺口与验收 |
|---|---|---|---|
| 今日焦点 | [globalFocus](D:/Projects/hongmen/lib/server/globalFocus.ts:12)、GET /api/workspace/focus、GET /api/projects/{id}/agent-context；[FocusAgentWorkspace](D:/Projects/hongmen/components/FocusAgentWorkspace.tsx)、[GlobalFocusPanel](D:/Projects/hongmen/harmonyos/entry/src/main/ets/components/GlobalFocusPanel.ets) | U：一项首要动作、去重、降低统计和技术状态层级；S：统一候选／等待投影 | F01～03；同一快照双端一致，有限覆盖不冒充全局最优，UX-1 |
| 长期委托 | 原 Mission create/read/input/approval/pause/resume、continuation-policy、research-scope；[MissionPanel](D:/Projects/hongmen/components/MissionPanel.tsx)、[MissionInvestigationDelegation](D:/Projects/hongmen/components/MissionInvestigationDelegation.tsx)、[原生同名组件](D:/Projects/hongmen/harmonyos/entry/src/main/ets/components/MissionInvestigationDelegation.ets) | U：目标、当前进展、等谁、下一步；S：稳定 waitingFor 与观察时点投影；许可和预算差异预览 | 现有原服务可持续调查；多日与双端竞争仍验，UX-1/3 |
| Always On | CT-3 原 worker、investigationDelegation、delegationObservation、USER Policy/Decision/BudgetLedger；POST /api/missions/{id}/attention | 显示具体委托的“持续跟进”；暂停调查、停提醒、停用来源分开；复用原预算和幂等回执 | 无变化零模型已具工程证据；关 App 的私人任务推送未交付，UX-3 + V |
| Memory / Dream | [globalWorkspace](D:/Projects/hongmen/lib/server/globalWorkspace.ts)、[KnowledgeCardView](D:/Projects/hongmen/components/KnowledgeCardView.tsx)、[temporalLedger](D:/Projects/hongmen/lib/memory/temporalLedger.ts)、[MemoryTimeline](D:/Projects/hongmen/harmonyos/entry/src/main/ets/pages/MemoryTimeline.ets)、原 GoalGap/Output/Decision/Experience | U+S：已记录／待核实／变化经过的联合投影；每条指向原对象与证据；Dream 没有独立服务或库 | F04/06；claim 定位、读视图无隐含写入、并发纠正／整理 Guard，UX-2；条件化学习 CT-8 |
| 用户纠正 | [Continuity 路由](D:/Projects/hongmen/app/api/conversations/[id]/continuity/route.ts)、[Web Continuity](D:/Projects/hongmen/components/ConversationContinuity.tsx)、[ArkTS Continuity](D:/Projects/hongmen/harmonyos/entry/src/main/ets/components/ConversationContinuity.ets)、原 sourcePolicy | 已有改方向／撤回；新增就近“理解有误／材料更新／不再参考／少提醒”分流，不用一个按钮代替全部语义 | F05；claim 级持久定位是小增量，不声称目前已有，UX-1/2 |
| 跨会话接续 | [handoff](D:/Projects/hongmen/lib/continuity/handoff.ts)、[readback](D:/Projects/hongmen/lib/mission/readback.ts)、GET /api/missions/{id}/readback、原 ConversationBinding | 一句话重建当前工作、上次结果、未决条件；进入原问题／批准／Action，不重新创建任务 | nextOwner 现有映射过粗；失效、双端并发、同 resultCardId 验收，UX-1 |
| 提醒卡片 | Focus/Anchor/Intervention/GoalQuestion 私人收件箱；[WidgetDataService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/WidgetDataService.ets)、[MissionWidgetContract](D:/Projects/hongmen/harmonyos/entry/src/main/ets/common/MissionWidgetContract.ets)、[NotificationService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/NotificationService.ets) | 已有桌面卡片和共享 Intervention 本地通知；调整去重、隐私、过期、入口；静默后重判 | F08；未来定时本地通知返回 UNSUPPORTED，私人 Mission systemPush=false；设备 Gate 独立，UX-3 |
| 小艺入口 | [missionAccess](D:/Projects/hongmen/lib/xiaoyi/missionAccess.ts)、[inspect](D:/Projects/hongmen/lib/xiaoyi/inspectMissionService.ts)、[resume](D:/Projects/hongmen/lib/xiaoyi/resumeMissionService.ts)、原 Index 设置及 Want 导航 | 只读说明状态、打开 App；原受限恢复继续受 owner/version/budget/policy 约束 | 当前 TEST_USER+MISSION_ALLOWLIST 不是正式多用户身份；不可语音批准，BOUNDED_INVESTIGATION 不在当前恢复范围；穿戴 L+V |

## 4. 可复现问题与设计后果

以下优先级指修复／实施顺序。高置信度来自明确的静态分支；未跑隔离探针的项不标运行 PASS。

### F01 · P1：Web 和鸿蒙首要事项选择不同

证据：[Web 第 46 行](D:/Projects/hongmen/components/FocusAgentWorkspace.tsx:46) 从 waiting → reminders → running → actions 的首个非空组取 hero，未使用服务端 primaryContext；[鸿蒙第 3 行](D:/Projects/hongmen/harmonyos/entry/src/main/ets/common/GlobalFocusPresentation.ets:3) 优先用 primaryContext。FOCUS_AGENT 关闭的旧 Web 路径又会使用 primaryContext。

复现输入：同一 DTO 中 waiting[0] 是普通失败，primaryContext 指向另一原问题或事项；对两个选择函数比较原对象 ID。预期差异可以由代码直接推出。后果是换端像换了“当前目标”。UX-1 用同一投影，旧 DTO fallback 也保持统一。规则：rule/preserve-mental-model、rule/one-primary-action；置信度高。

### F02 · P1：等待观察被误写为等用户；失败项被写成 Agent 接续

[workspaceSummary](D:/Projects/hongmen/lib/mission/workspaceSummary.ts:25) 不读 waitState/plan/delegation，WAITING_INPUT 无问题时写“需要你补充项目资料”。[handoff](D:/Projects/hongmen/lib/continuity/handoff.ts:41) 按状态硬映射 nextOwner，FAILED 落到 AGENT。CT-3 [无变化观察](D:/Projects/hongmen/lib/mission/delegationObservation.ts) 正常返回 WAITING_INPUT，构成真实的状态复用。

隔离样本应同时包含：等获准 CI 检查、等私有材料、已回答旧 QUESTION、暂停、失败、UNKNOWN。不能只拿 WAITING_INPUT 的人工问答样本验文案。UX-1 先补 S1，证据不足的旧行显示“等待条件需核对”；不用模型分类替代持久原因。规则：rule/cover-reachable-states；置信度高。

### F03 · P1：候选集合先截断，排序又固定高估普通故障

[globalFocus](D:/Projects/hongmen/lib/server/globalFocus.ts:10) LIMIT=6，各类按更新时间等规则取有限行，再只为前六个项目计算 context；[candidatePriority](D:/Projects/hongmen/lib/projectAgentContext.ts:7) 把 PAUSED/FAILED 的 40 固定排在高严重度 Intervention 的 50 和 Action 的 70 前。原 hasMore 存在，但不能表达已比较哪些候选及哪些查询不完整。

隔离样本：超过六个项目，近期普通故障占前六，较早项目有重要期限／可处理批准。先保证权限内有界候选召回，再统一比较可行动性、期限与目标相关性；附 coverage/cursor，并测查询量与 p95。不得用“查看全部”掩盖错误的“全局最重要”承诺。UX-1，S1；置信度高。

### F04 · P1：全局记忆列表不能直接承担“Agent 仍在使用的事实”视图

[globalWorkspace](D:/Projects/hongmen/lib/server/globalWorkspace.ts) 复用原卡片和 temporal state，但未投影 sourceUse/suppression；[KnowledgeCardView](D:/Projects/hongmen/components/KnowledgeCardView.tsx) 没有完整 claim 纠正与停止复用动作。历史内容可继续向有权用户展示，这本身不是泄漏；风险是把“可看历史”渲染成“当前有效支持”。

UX-2 为当前主张、历史原文和 Agent 使用策略分别投影。CURRENT 不等于客观真；用户确认是自述；来源不可用、未知血缘、被停用要显式呈现。复现用同根派生摘要、被抑制根和相似异项目资料，断言来源去重与隔离；置信度高。

### F05 · P1：纠正入口仍偏全局，claim 级反驳尚无完整持久合同

[continuity 类型](D:/Projects/hongmen/lib/types/continuity.ts) 支持 SET/WITHDRAW/SUPPRESS_USE/TRANSFER 及原范围；双端 Continuity 支持改方向、解释候选确认和撤回。它们不能直接等价为“这条指标归因错了”或“原文没有说这句话”。现有十类 UI block 也没有已实现的独立 continuity semantic type。

UX-1 将原方向控制就近放置；UX-2 在原事件合同拟增 INTERPRETATION_CORRECTION、target/locator metadata 与有效 corrections 视图，和上下文、复用 hash、读集消费层接通，不挤入 workingObjective。无法唯一定位就保留原话并澄清，不生成伪 sourceId。反驳主张不能默认屏蔽整份真实文档。规则：rule/name-object-scope-consequence、rule/inline-before-modal；置信度高。

### F06 · P2：经验列表的读取含同步写入

[listExperiences 第 40 行](D:/Projects/hongmen/lib/experience/service.ts:40) 调用 syncExperiences；原接口允许这种行为，但新“只读记忆／Dream”页若直接复用，会让一次浏览隐含生成／更新经验候选。UX-2 在原 experience 服务内拆出纯读投影和显式同步入口，保留原资格、状态、用例与幂等；不能新建经验库。SHADOW 激活和 ACTIVE 撤销仍走原服务。置信度高；对旧接口行为的兼容需探针。

### F07 · P1：撤销仓库连接后，历史 CANDIDATE 的新采纳缺当前连接校验

[listSignals 第 173 行](D:/Projects/hongmen/lib/sensing/repoSource.ts:173) 独立映射信号；撤销只更新连接 status/revision。[actOnSignal 第 225 行](D:/Projects/hongmen/lib/sensing/repoSource.ts:225) 对新 CANDIDATE 采纳检查 owner/project、原命令和信号状态，创建 Capture 前未重验连接 ACTIVE/revision。Web [RepoSignalsCard](D:/Projects/hongmen/components/RepoSignalsCard.tsx) 和 [鸿蒙面板](D:/Projects/hongmen/harmonyos/entry/src/main/ets/components/RepoSignalPanel.ets) 依 CANDIDATE 显示采纳。

隔离复现：创建连接和候选 → 撤销连接 → 用新 requestId 采纳旧候选。静态路径能到 Capture 写入；本轮没有在业务库执行。UX-2 扩大来源／记忆交互前，在原服务事务补当前授权及版本 guard；区分“新的采纳效果”与“已提交原命令的读回”，后者保留幂等历史。仅隐藏按钮不足。原 [Claude 原型审查](D:/Projects/hongmen/docs/FINAL/AGENT_REVIEW/HARMONY_CLAUDE_PROTOTYPE_REVIEW_2026-10-29.md) 和 CT-5/6 记录已保留此欠账；本轮未夹带修复。置信度高。

### F08 · P1：卡片、通知、小艺和穿戴的能力容易被合并描述

[module.json5](D:/Projects/hongmen/harmonyos/entry/src/main/module.json5) 声明 phone/tablet/2in1，注册 EntryFormAbility，未声明 wearable。WidgetDataService 已有 owner/project/TTL 和退出清理；NotificationService 可发布获权的共享 Intervention 本地通知，但未来时间调度返回 UNSUPPORTED。CT-3 私人通道默认无系统推送。小艺 inspect/resume 有服务，身份仍受测试用户及 Mission allowlist 约束。

UX-3 先复用已存在通路，按设备、账号、渠道分别签收。正式小艺绑定、穿戴与私人后台投递单列 Gate。原生 ArkTS 不是 HTML 手机框，Web 原型截图不能证明设备能力。置信度高。

### F09 · P2：页面层级仍暴露了过多执行细节，主动作不随等待原因变化

[FocusAgentWorkspace](D:/Projects/hongmen/components/FocusAgentWorkspace.tsx:63) 的 hero 和列表可重复同一事项，主要动作普遍为“和忆程讨论”；[MissionPanel](D:/Projects/hongmen/components/MissionPanel.tsx) 持续展示执行／草稿、GoalQuestion、readback、output、步骤和多项设置。CT-5/6 [原批准截图](D:/Projects/hongmen/evidence/r4-experiments/20261029-complete/metric-approval.png) 与 [原回执截图](D:/Projects/hongmen/evidence/r4-experiments/20261029-complete/metric-receipt.png) 提供历史渲染证据。

UX-1 首屏只保留当前问题／下一合法动作和最近有用结果；工具步骤、版本和设置按需展开。核算结果的长浮点尾数可格式化展示，原精度留详情。保留必要授权范围／后果，不把批准降为无信息按钮。具体易用性影响须由首次使用研究量测。规则：rule/structure-before-containers、rule/one-primary-action；结构判断置信度高，用户收益待研究。

### F10 · P1：capabilities、授权和环境健康不能只用一个 enabled 表示

[Conversation capabilities](D:/Projects/hongmen/app/api/conversations/capabilities/route.ts) 和 [Mission capabilities](D:/Projects/hongmen/app/api/missions/capabilities/route.ts) 已有开关；更细的工具可用性还分布在 Mission DTO。开关开启不证明该用户已授权来源、容器可用、worker 活跃或设备可投递。

UX-1/3 沿原 DTO 增加可选能力及原因投影，保留旧客户端正文 fallback。用 feature-off、无授权、环境故障、读失败和旧字段缺失分别验；不能由客户端拼一个“Always On 已启用”。置信度高。

## 5. Demo 的采用、调整与延期

| 设计 | 裁决 | 技术／用户依据 |
|---|---|---|
| 单项今日重点、低饱和配色、桌面上下文侧栏 | 采用方向，替换为原对象与共享投影 | 与现有纸白／墨绿及 focus 架构兼容，能降低同时阅读的对象数 |
| 目标、依据、未知与操作在同一语境 | 采用，沿十类 semantic block 动态组合 | 模型保留顺序与强调；操作来自服务端 catalog，不能复制原型本地点击状态 |
| Memory/Dream 双视角 | 调整为“已记录／待核实”，辅以变化与原经验详情 | 复用现有数据，不把推测晋升事实；不增加永久“梦境库” |
| 顶层 Always On 开关 | 调整为具体委托的“持续跟进”许可与状态 | 原 CT-3 已有期限、连接、工具和总预算；通用开关无法表达这些条件 |
| 五项底部导航、单独全局聊天／Mission 页面 | 本阶段不采用；保留现有四项及深链 | 当前 Web／App 用户路径已经存在，先验证收敛后的任务完成率 |
| 常驻 Runner、read-set/sourceRefs、CT/SHA/flag 解释 | 移入详情或研究文档 | 不帮助普通用户决定下一步；具体 SHA、版本仍可在依据详情核对 |
| 原型脚本中的批准、恢复、记忆切换 | 仅作为交互意图 | HTML 本地状态没有 server binding、CAS、真实回执和账号隔离 |
| 手机框、小艺状态和未来穿戴图示 | 不作为原生验收证据 | 必须有实际 App／设备／平台渠道记录 |

Demo 的“CT-3 没有后台 CI 检查”等描述已落后于当前实施记录最后一节；CT-4～6 已在本地分支，不能按 Demo 的 master 快照重建。UX 改造应保留论文、指标、文档与动态调查的全部合法入口。

## 6. 设计参照与依赖裁决

本轮对陌生的 Agent UI 协议作了只读开源核查。查询时 [AG-UI](https://github.com/ag-ui-protocol/ag-ui) 为 MIT、约 1.69 万 stars，最近 push 为 2026-10-29；[A2UI](https://github.com/a2ui-project/a2ui) 为 Apache-2.0、约 1.69 万 stars，同日有更新。AG-UI 的事件生命周期可用于检查“真实状态驱动 UI”；A2UI 的受信组件目录可用于检查“模型声明布局，客户端只渲染允许组件”。A2UI 仍有预览／版本演进和 renderer 适配成本，不能据此假定存在可直接用于本项目的 ArkTS 渲染器。

裁决：借鉴两者的协议边界，继续使用现有 ConversationTurn 事件、presentationRuntime、Web/ArkTS renderer；本阶段不增加 SDK、依赖或第二 Agent 框架。正式平台边界参照 [Intents Kit](https://developer.huawei.com.cn/consumer/cn/sdk/intents-kit) 与 [穿戴开发概览](https://developer.huawei.com/consumer/cn/multidevice/wearables/)，具体权限仍由本产品服务端和目标设备验收决定。

## 7. 交接结论

第一实施切片是 UX-1“看懂下一步，并接回原任务”。F01/02/03/10 是其服务与状态前置；F09 在同一纵向旅程落到两端。UX-2 先补 F07，再扩证据和纠正；F04/05/06 随原记忆／经验合同接通。F08 进入 UX-3 的设备和渠道 Gate。

后续质量账本继续保留 PR-6、CT-4、CT-5/6 的未决项；不能把一次 UI 改版当作它们已通过。规划阶段的文件哈希、链接和范围核对单独记录在本目录 PLANNING_VALIDATION.json。
