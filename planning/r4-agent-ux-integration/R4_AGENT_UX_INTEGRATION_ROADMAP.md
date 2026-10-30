# R4 Agent UX Integration Roadmap

R2 增量修订：2026-10-30（北京时间），代码基线为 UX-1 本地提交 2017c31。UX-1 工程闭环已完成，目标设备、真实自然日和独立质量 Gate 保留。本轮深化 UX-2/3 规划，不修改业务代码、不启动新后台执行器。CT-1～10 的能力目标和原验收要求保留。

新增主入口：[UX-2 Memory Evolution / Dream Verification](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/UX2_DEEPENING_ROADMAP.md)；[UX-3 长期责任 / 主动协作](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux3-deepening/UX3_DEEPENING_ROADMAP.md)。旧 UX-0 审计和 SOURCE_SNAPSHOT 是 e8281d6 时点记录，UX-1 实际变更见 [实施记录](D:/Projects/hongmen/R4_AGENT_UX_IMPLEMENTATION_NOTES.md)。R2 当前核对见 [R2_SOURCE_SNAPSHOT](D:/Projects/hongmen/planning/r4-agent-ux-integration/R2_SOURCE_SNAPSHOT.json) 和 [PLANNING_R2_VALIDATION](D:/Projects/hongmen/planning/r4-agent-ux-integration/PLANNING_R2_VALIDATION.json)。

本文件是统一实施入口。原 UX-0 的 [代码与 Demo 对账](D:/Projects/hongmen/planning/r4-agent-ux-integration/CODE_DEMO_AUDIT.md)、[SOURCE_SNAPSHOT.json](D:/Projects/hongmen/planning/r4-agent-ux-integration/SOURCE_SNAPSHOT.json) 和 [PLANNING_VALIDATION.json](D:/Projects/hongmen/planning/r4-agent-ux-integration/PLANNING_VALIDATION.json) 保留为历史证据；当前差距以 R2 深化审计为准。交互见 [核心页面方案](D:/Projects/hongmen/planning/r4-agent-ux-integration/CORE_PAGE_DESIGN.md)，已执行阶段的任务定义见 [UX-1 Prompt](D:/Projects/hongmen/planning/r4-agent-ux-integration/UX1_IMPLEMENTATION_PROMPT.md)。

## 1. 产品目标：三个任务，一条持续协作链

| 用户任务 | 成功时用户实际得到什么 | 主要入口与对象 |
|---|---|---|
| **回来后知道项目变了什么** | 当前工作重点、重要变化、上次结果及现在等谁；可以纠正 | 今日焦点 → 原项目、Conversation、Handoff、Action 回执 |
| **把眼前问题查清楚** | Agent 自主挑工具、追原文、比较条件、给出判断和仍未知之处；用户能就近改正 | 同一 Conversation → Goal Reasoning / Investigation → 证据与合法操作 |
| **把一段工作交代下去** | 一次核对范围、期限和总预算后继续原 Mission；必要时协作；跨端找回进度 | 原委托 → 有界调查、Attention → 原批准及结果回执 |

用户是同时推进课程、科研或竞赛项目的学生。目标不是让用户维护“Agent 配置”，而是减少找入口、重复解释、误认完成和无效确认。当前方案改变的是现有对象的可理解性与可操作性，不增加新的任务身份。

三项任务不是三套新模块，也不要求把所有页面变成聊天。UX-1 保留现有“焦点／项目／记忆／行动”导航和深链；焦点内突出原委托入口，项目内沿用“概览／委托／资料／行动／成果”。UX-2 改造记忆内容，UX-3 在焦点加入可筛选的委托集合。暂不另增全局 Mission 页面或五项 Demo 导航，避免首页和项目页各养一套列表。

设计依据：`rule/one-primary-action`、`rule/structure-before-containers`、`rule/preserve-mental-model`、`rule/smallest-intervention`。以下尺寸、排序及研究门槛均为本项目建议，不冒充平台规定。

## 2. 当前基线与能力映射

Demo 固定在 master `e87b8ee`，R2 本地 HEAD 为 `2017c31`，包含 CT-4、CT-5/6 及 UX-1。不能按 master 重做这些工具。原 CT 规划中的“拟新增”是历史设计状态，实施记录后段和当前代码优先决定“已经有什么”。

分类：**U**＝现有合同上的 UI／调用接合；**S**＝现有服务内的小规模补全；**L**＝后续 CT 能力；**V**＝真实质量、设备或渠道验收。一个项目可同时有多类工作。

| 能力 | 当前可复用实现 | 本轮真实增量 | 类型／阶段 |
|---|---|---|---|
| 今日焦点 | [globalFocus](D:/Projects/hongmen/lib/server/globalFocus.ts:12)、[ProjectAgentContext](D:/Projects/hongmen/lib/projectAgentContext.ts:7)、双端 Focus | UX-1 已统一首要事项、责任方、覆盖与原对象入口；真实用户／设备继续验收 | U+S 已实施；V 开放 |
| 当前方向、运行中改道 | [directiveService](D:/Projects/hongmen/lib/continuity/directiveService.ts)、[turnCoordination](D:/Projects/hongmen/lib/continuity/turnCoordination.ts)、双端 Continuity | 就近调整／撤回，时限到达刷新，跨端变化后旧控件重核；不重做 Admission | U+S，UX-1 |
| 跨会话接续 | [handoff](D:/Projects/hongmen/lib/continuity/handoff.ts)、[readback](D:/Projects/hongmen/lib/mission/readback.ts) | 下一责任方与恢复条件准确；始终返回原 Mission、原结果与原问题 | U+S，UX-1 |
| 自主调查与生成式 UI | [investigationService](D:/Projects/hongmen/lib/conversation/investigationService.ts)、[presentationRuntime](D:/Projects/hongmen/lib/conversation/presentationRuntime.ts)、[uiActions](D:/Projects/hongmen/lib/conversation/uiActions.ts) | 依据／纠正入口附着于原判断；按任务渐进展开；保留动态布局和工具选择 | U+S，UX-1/2 |
| PR-6、CI、文档、指标、论文 | 原 Conversation/Mission tools、CT-4～6 adapters | 同一来源阅读体验；准确区分摘要、正文、物理页、元数据、报告指标、固定核算 | U，UX-2；现有审批回执在 UX-1 不退化 |
| Memory 事实视图 | [temporalLedger](D:/Projects/hongmen/lib/memory/temporalLedger.ts)、[globalWorkspace](D:/Projects/hongmen/lib/server/globalWorkspace.ts)、原记录和来源 | 按主张显示依据、有效期和使用策略；用户确认与客观证实分开 | U+S，UX-2 |
| Dream 与长期综合 | Investigation 的 GoalGap／证据状态、Output INFERENCE、Decision 候选、Episode 修订 | 稳定 Claim/Event、派生 Digest、反证与动态验证、真实上下文消费；不建平行记忆数据库 | U+S，UX-2 R2 |
| 记忆整理与经验 | [memoryConsolidationService](D:/Projects/hongmen/lib/services/memoryConsolidationService.ts)、[experience/service](D:/Projects/hongmen/lib/experience/service.ts) | 原整理建议按需出现；停止隐含写入的只读页面调用；条件经验深化留 CT-8 | U+S，UX-2；L，CT-8 |
| Always On | [investigationDelegation](D:/Projects/hongmen/lib/mission/investigationDelegation.ts)、[delegationObservation](D:/Projects/hongmen/lib/mission/delegationObservation.ts)、原 worker | 统一责任／修订、可靠 wake、公平领取、获准发现、活动事实与低打扰；原执行链承接 | U+S，UX-3A～D |
| Attention | 原 USER Policy、BudgetLedger、Decision、Anchor、私人 Mission SEEN | 跨入口投影去重、个人偏好一致、合并摘要、到时再判；不新建通知系统 | U+S，UX-3；V，设备 |
| 鸿蒙桌面卡片／系统提醒 | [WidgetDataService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/WidgetDataService.ets)、[NotificationService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/NotificationService.ets) | 校准可用状态、隐私和点击回原任务；私人 Mission 不自动接系统推送 | U+S+V，UX-3 |
| 小艺／穿戴 | [missionAccess](D:/Projects/hongmen/lib/xiaoyi/missionAccess.ts)、inspect/resume；当前 module 无 wearable | 小艺测试身份与只读限制明示；正式账号绑定和穿戴独立设备 Gate | U+V；正式渠道后续专项 |

工程证据：CT-2/3 合并回执是 1158 测试、Web 24 通过／2 跳过；CT-5/6 最终记录是 1189 测试、Web 全量 26 通过／2 跳过。UX-1 原 [验收回执](D:/Projects/hongmen/evidence/r4-agent-ux/20261030-ux1/acceptance-summary.json) 记录 143 文件／1197 测试、最终受影响 55 测试、Web 全量 27 通过／2 跳过及最终定向 6 通过、鸿蒙 86 测试和 HAP 构建。它们分别绑定原源码；R2 只核对文件哈希，不重跑业务测试。真实手机、多日用户研究、独立质量和部分联网／论文 Gate 仍开放。

## 3. 必须补齐的五个合同

### S1：UX-1 已接入共享投影，继续统一“现在等谁、该做什么”的只读投影

UX-1 已扩展原 ProjectAgentContext、Mission readback/Handoff 和共享 workState；代码字段见 lib/types/workState.ts。原结果仍从 readback/actionReceipts 读取，coverage 在 Focus 外层，不宣称所有下列语义已集中在一个 DTO。后续合同继续沿原对象补全，不加平行任务状态或 Planner：

```text
workState: phase, nextActor, requiresUser, reasonCode, reasonText
           originalRef, exactQuestionRef?, exactApprovalRef?, lastReceiptRef?
           observedAt, checkedAt, nextCheckAt?, nextBoundary?
           freshness, coverage, safeNavigation / allowedActionRefs
```

`phase` 是显示投影：RUNNING、QUEUED、WAITING_OBSERVATION、WAITING_USER、WAITING_APPROVAL、PAUSED、UNKNOWN、COMPLETED、UNAVAILABLE。它不写回代替原状态。

- `WAITING_INPUT` 不能一律标为“等你”：结合原 `waitStateJson`、是否已解决、原问题类型、有效 continuation policy、观察事件和下一检查时间。仍需用户提供私有材料／决策时显示“等你”；明确等待获准观察且没有待答阻碍时显示“等待新变化”。
- 当前记录不足以区分时显示“等待条件需核对”；在**原** waitState/plan JSON 补版本化 `waitingFor` 原因，优先从真实状态转移写入。模型自由文字不能决定责任方。旧行不批量猜测回填。
- `READY` 是待执行，`RUNNING` 需当前租约证据；没有 worker 健康证据不写“后台正常运行”。过期 lease 或读取失败显示最后核对时间与恢复入口。
- `FAILED`、预算耗尽、授权过期、来源变化、UNKNOWN 分开。UNKNOWN 只提供原状态查询／核对，不能生成“再试一次”重新派发原外部操作。
- `SUCCEEDED` 保留完成条件、草稿核验、Action/resultCardId、现实效果的不同层级。

首要事项排序先比较当前可行动性和时间约束，再比较已有目标相关性和关注偏好，最后用稳定 ID 打破同分。普通技术故障不固定高于所有行动；授权／预算阻碍也不能被一律折叠。置顶偏好不覆盖真实紧急待办。采用原确定性候选规则和 Goal Reasoning 已存判断，不新增首页模型请求。

全局候选须先保留每项目每类最重要的可处理项，再有界聚合；不能先按更新时间取 6 条，就声称全局最重要。给 `coverage/hasMore/nextCursor`；未完整覆盖时使用“当前范围建议先处理”，保留查看全部。候选读取不能暴露其他 owner 的私人委托。

### S2：显示合同与控制合同分开

复用现有 `ConversationView.continuity`、十类 semantic block、`allowedActions` 和原 typed service。UX-1 不把“撤回”伪装成批准 Action，也不为每项能力发明新 semantic type。

就近操作由服务端绑定原对象、用户、项目、版本／hash、期限和可用状态。模型可以选择展示位置、比较项和解释，不能输出可执行 URL、任意 payload 或新的权限。没有合法 binding 时保留正文和“查看原对象”。

当前原 Continuity 路由可承担指令控制；若需把它挂入生成式消息，只扩现有 action union 的白名单控制分支，重用 `submitDirective`，不另建通用命令平台。scope、原话、解释候选、应用回执必须仍可核对。

到 `nextBoundary`、回前台、换账号／项目、源版本变化时重新取有效视图；客户端可立即标记需重读并停用旧控件，最终失效仍由服务端时间／版本 guard 保证。保留草稿和原 requestId；丢回包先读取／重放同请求。

### S3：Memory Evolution 与可验证认知对象（R2调整）

显示与消费身份为 `(owner, project, original object, revision, claim/block locator)`，时间与 scope 进入有效性计算。没有唯一原对象就显示历史线索，不给“已核实”或可执行确认。

| 视图内容 | 来自哪里 | 可做什么 | 禁止的晋升 |
|---|---|---|---|
| 已记录 | Capture、附件修订、Card、Action/resultCardId、Artifact manifest | 查看原文、补新记录、建立取代／反驳关系、纠正解释、停用来源 | CURRENT、用户确认、Action DONE 均不自动等于独立证实 |
| 待核实 | 原 GoalGap／Investigation／Output／Decision；R2 增加稳定 Claim/Event | 查看依据／缺口、支持和反证，继续同一调查，补材料，停止关注或明确不再参考 | 不能因重复总结、模型置信度、点击采纳变成永久事实 |
| 变化经过 | Temporal relations、Lifecycle、Impact/Decision、原回执 | 比较旧新版本、谁在何时修改、哪些下游需要重核 | 归档不等于失效；撤回不恢复旧审批 |
| 方法经验 | 原 AgentExperience / Use / trajectory | 查看适用条件、支持和反例、激活 SHADOW、撤销 ACTIVE | 单个案例不自动变成跨项目方法；不改权限或系统 Prompt |

证据更新沿原 ImpactJob、sourcePolicy 和原读集 guard。投影缓存可丢弃；键包含原来源 revision、intent/reusePolicy、身份与有效时间段，截止不超过最近有效边界。来源链未知不算第二份独立证据；用户直接提供的原记录也要区分自报与实证。

纠正分流：改工作方向 → Directive；反驳判断 → 定位原 claim 后记录带来源的纠正／重评；原材料有误 → 原附件修订或新 Capture + temporal relation；不再使用 → `SUPPRESS_USE`；少提醒 → Anchor/Preference。不得把“这句话错了”直接屏蔽整份真实原文。

R2 不再默认把解释纠正存为 AgentDirectiveEvent 的新 kind。比较当前 Directive、Temporal、Lifecycle 和 Episode 后，推荐原数据库中的 AgentClaim + 追加 AgentClaimEvent 承载稳定认知身份与用户解释纠正，AgentContextDigest 承载可重建综合。原事实、目标指令、阶段发布、任务与经验不复制。技术依据与最小字段见 [认知合同](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/MEMORY_EVOLUTION_CONTRACT.md)。

纠正不进入 workingObjective，也不授予工具／业务权限。它复用原 continuitySeq 用户控制时钟、相关 scope 的 reusePolicyHash 和原 turn/Mission 协调；原 source/readset guard 同步覆盖摘要、Artifact、经验和提案。新目标仍用原 Directive Admission。未知 locator 不伪造来源，未映射 Artifact 只定位整项／已知块。

后台 Dreaming 是带 manifest 的长期综合；Dream/Hypothesis 是稳定的可验证认知对象，二者分开。Hypothesis 按 PROPOSED→INVESTIGATING→SUPPORTED/REFUTED/INCONCLUSIVE/EXPIRED 演化，并关联原调查和工具。SUPPORTED 不等于独立事实核验。稳定身份、跨会话状态、反证和实际上下文消费属于 UX-2，不能降级为只读卡片。

“忽略这条推测”默认只改变当前候选／主题的展示偏好；“以后不要参考这个判断”才登记明确使用抑制。恢复是撤回该限制后重新核对，旧批准不会复活。完整内容删除与备份清理不混在这两个动作里。

整理触发：用户主动整理；同项目出现原服务判定的重复候选；来源换版、纠正或原结果到达使已有结论需重核；授权持续 Mission 观察到有意义变化。打开记忆页、日历过一天、无新信息不产生新的模型整理任务。后台先用原 ImpactJob 做便宜的失效／资格标记；已获持续许可时，语义编译／重评可在原 Mission 和总预算内自动推进；无背景许可不启动新付费循环。当前请求中的合法自主调查不逐工具重复确认。原 `listExperiences` 会调用 `syncExperiences`，新的“只读记忆视图”不得不知情地调用这条写入路径。

### S4：调查执行与注意力分离

现有 CT-3 已做固定 SHA 的定时 CI 观察、稳定观察零模型、累计预算、私人注意力和 SEEN。UI 不应重新要求用户逐次批准合法只读工具，也不把 FOLLOW 或联网许可当成持续付费调查许可。

| 事件 | 原执行链 | 用户看到什么 |
|---|---|---|
| 新资料／附件修订／真实 Action 结果 | 原输入指纹 → 同 Mission → Goal Reasoning 动态调查 | 有意义结果才更新摘要；需要协作时给一个问题或批准 |
| 到期的已授权 CI 检查 | 原 worker → Step/HTTP 账本 → 比较已收录 SHA 状态 | 同状态只更新核对时间；不承诺自动发现任意新 head |
| 无新信息 | 保持等待；远程元数据检查可能消耗已授权 HTTP 预算 | 无新通知、无新模型解释；“暂无重要变化”按需可见 |
| 安静时段／LATER | 合法调查继续；注意力 QUEUE／SUPPRESS | 回来看到合并后的当前事项；明确 STOP 不因新 revision 解除 |
| 期限／预算／授权失效 | 原 guard 停止新派发，保留 UNKNOWN 和已用预算 | 原因、已做结果、恢复所需条件；不自动加预算 |

合并在原 Focus/Anchor/Intervention 投影完成，按 owner + 原任务／主题 + 有效版本／待决对象去重。`已读`、`曝光`、`已批准`、`平台已接受通知`分别记录；不能用“全部已读”消耗审批，不能用页面一次加载虚报 SEEN。

个人“少提醒我”复用 USER policy / GoalQuestionPreference / Anchor；不得改其他成员的项目偏好。无新事件但静默结束、日预算边界、指令到期仍须再判。提醒评价同时测噪声和漏报，不能以全静音降低打扰数。

CT-3 私人任务当前 `systemPush=false`。现有共享 Intervention 的本地系统通知、Action reminder 与私人任务是不同通道。UX-3 统一可用性及回执展示，真实后台投递缺口留设备／渠道专项；不新建 push 服务，不宣称关闭 App 仍能收通知。

### S5：能力可用、已获授权、运行健康分别表达

扩原 capabilities 与 Mission DTO 的可选字段；区分 feature 支持、当前用户权限、资源授权、执行环境、可用操作和暂不可用原因。功能开关不是授权，按钮出现不是已可后台执行。缺字段的旧客户端走原正文与对象入口，写入仍走原 guard。

Web 与 App 共享原 Mission/Conversation/Action ID、版本、source hash 和回执，不共享本地缓存当权威。跨端确认、撤权、租约替换、迟到响应、离线恢复都以服务端结果决定。系统卡片只携带最小导航参数；打开 App 后登录并重新解析目标，不携带审批令牌。

## 4. 实施阶段与依赖

```mermaid
flowchart LR
  CT[当前 CT-1 至 CT-6 工作树] --> UX0[UX-0 对账与冻结]
  UX0 --> UX1[UX-1 看懂下一步并接回原任务]
  UX1 --> UX2[UX-2 看依据并纠正和验证]
  UX1 --> UX3[UX-3 有界跟进与低打扰接续]
  UX2 --> CT8[CT-8 条件化结果经验]
  UX3 --> CT7[CT-7 部署观察]
  UX2 --> CT9[CT-9 Browser及外部资源]
  CT9 --> CT10[CT-10 外部写入]
```

箭头表示复用关系，CT-7 的功能实现不依赖 UX-3 才具备技术可行性；本次产品顺序明确先 UX。推荐实际执行 UX-1 → UX-2 → UX-3。UX-3 可复用 UX-1 合同独立开发，不必等待 CT-8/9/10。

### UX-0：原审计和冻结，已完成文档阶段

交付本目录四份文档、源码／未提交修改快照及验证索引；保留 Demo 和原 CT 规划。登记完整能力映射、静态可复现缺口、真实验收欠账和 UX 案例。不开业务 PR、不安装设备、不使用真实数据跑探针。

### UX-1：打开后看懂下一步，继续同一件事，P0

**纵向旅程**：D1 Web 留下一个真实 Mission 和待确认方案；D3 用户打开今日，看到真正需要自己处理的项；改“本周先稳演示”；原调查按新目标改道，旧提案后端拒绝；从鸿蒙进入原 Mission 补材料／确认合法提案、记录原 Action 结果；Web 新会话读回同一 resultCardId 和剩余缺口。

内部检查点只为定位问题，最终交付必须完整：

1. **状态与候选**：S1/S5，修正全局焦点优先级、等待原因、精确对象指向；为有限候选覆盖给出真实标记；无首页模型调用。
2. **原位协作**：共享首要事项投影进入 Web Focus、鸿蒙 GlobalFocusPanel、Mission、Continuity；当前重点一行、必要证据折叠；明确停止保持易达；原动态 Investigation/GenUI 全保留。
3. **完整回执**：Web→App→Web 同对象；原批准与 Action/resultCardId；旧版本、草稿、到期、UNKNOWN、flag-off 和恢复全部覆盖。

复用 `/api/workspace/focus`、`/api/projects/{id}/agent-context`、`/api/conversations/{id}/continuity`、原 turn/reconcile/ui-actions/work、`/api/missions/{id}`/readback/input/approvals/pause/resume。小增量限定为投影、必要 wait reason、capabilities 和这些入口的调用适配；不新增执行链。

Web 改 FocusAgentWorkspace、ConversationContinuity、MissionPanel/Readback 和原项目入口；鸿蒙改 GlobalFocusPanel/Presentation、FocusConversation、ConversationContinuity、MissionDetail 及对应 DTO/Service。未改到的复杂证据页继续原路访问。

**完成证据**：案例 UX-J01/02/03/07/08/10/12；原数据库 IDs 和回执一致；双端合同、Web E2E、HAP；实际设备单独签收。只出新首页或只出 DTO 不算完成。没有真实多日使用证据时，只报“工程闭环完成，真实多日 Gate 开放”。

### UX-2：可信记忆、动态研究、上下文组织与假设验证，P1（R2深化）

完整保留原 UX-J04/05/06/09/10/14、Fact/Dream/变化经过、纠正、版本比较、全部 PR-6/CT-4～6 工具、Goal Reasoning、动态 Investigation、GenUI、Web/鸿蒙和原结果接续。详细 [路线](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/UX2_DEEPENING_ROADMAP.md) 与 [评测／首阶段 Prompt](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/EVAL_AND_IMPLEMENTATION.md)。

| 内部阶段 | 增量 | 完整行为 |
|---|---|---|
| UX-2A | F07、来源绑定、locator、Claim/Event、纠正传播与证据交互 | 从原判断追证据、纠正后真实重评，双端回原调查／回执 |
| UX-2B | Memory Evolution、Digest、依赖失效、Context Composer | 新结果改变综合与实际下一步，无变化零模型，保留历史原因 |
| UX-2C | 稳定假设、支持／反证／未定／到期、动态验证 | D1提出、D3重评／反驳、D5同一认知对象与任务接续 |

三阶段属于同一个完整交付目标，不把论文、文档、实验、生成 UI 或双端移到“以后”。数据增量有明确语义依据，继续原数据库／服务／Runner，不以形式最小实现削弱认知能力。UX-2 不等待 CT-8 深入经验学习。

### UX-3：长期责任、主动发现、低打扰协作与跨端接续，P1（R2深化）

完整保留长期委托、固定 CI 观察、注意力、多端和真实验收；把目标／标准／scope／期限／总包／触发／批准／STOP 组织为原 Mission 的责任合同。详细 [路线与公开系统对照](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux3-deepening/UX3_DEEPENING_ROADMAP.md)、[技术合同](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux3-deepening/RESPONSIBILITY_AND_CONTINUATION.md)、[三日旅程／评测](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux3-deepening/UX_AND_EVAL.md)。

| 内部阶段 | 新增重点 | 验收 |
|---|---|---|
| UX-3A | 责任视图／原子修订、原 Worker 公平性、wake／恢复、活动／presence | 积压、双 worker、停止／截止／UNKNOWN、总预算和原状态 |
| UX-3B | 获准主动研究、Memory/GoalGap/Hypothesis 联动、获准分支发现 | 新观察真实改调查，范围正确，无变化零模型 |
| UX-3C | 变化价值、合并提醒、静默／漏报、双端及真实渠道 | 不重复扣预算；已读／通知／批准／执行分开；设备 Gate |
| UX-3D | 完整三日旅程与 Agent 质量 | 原 Mission/claim/Action/resultCardId；工程、实模、人评、自然日分别签收 |

只读 research watch 仍用原 READ_ANALYZE Mission 与有界 policy，不新增 Watch Runner。已授权范围内可自主发现、验证和推进；无许可的新线索不自动扩大付费或写入。原 worker 的短路公平性须修，时钟只是资格条件，不等同 Always On。

推荐依赖：UX-1 已完成 → UX-2A/B/C；UX-3A 可独立利用 UX-1 先做，3B/3D 的完整认知闭环依赖 UX-2。四个检查阶段不缩小 UX-3 最终范围。小艺、卡片和穿戴按真实能力接入，不预设后台系统推送。

## 5. CT-7～10 的边界与后续接法

| 切片 | UX 现在完成 | 随该 CT 交付 | 当前不应增加 |
|---|---|---|---|
| CT-7 部署观察 | 通用证据层级、观察时点、来源不可用、等待／回执布局 | 固定环境/release 来源、build/deploy/health/user-path 区分、日志权限、实际查询与验收 | 虚构线上健康状态、自动部署、第二监控系统 |
| CT-8 结果经验 | 已有案例／SHADOW／ACTIVE 展示、撤销、出处、纠正、当前任务结果重评 | 结构化适用条件、反例归因、Focus case 读取、负迁移和效果评测 | 每晚自动“做梦”改永久记忆、跨项目自动激活 |
| CT-9 Browser | 来源卡的阅读层级／定位／过期合同，Fetch 不足时真实说明缺口 | 隔离只读浏览器、页面状态与截图/DOM 证据、登录／注入边界 | 任意网页操控按钮、假浏览器进度 |
| CT-9 外部应用 | 统一授权差异和返回原对象的位置 | 选定 Mail/Docs/Calendar 的账号、OAuth scope、资源版本、时区 | 复制工具列表充当可用授权；假定已有系统提醒等于外部日历读写 |
| CT-10 外部写入 | 保留具体操作预览、待批准／UNKNOWN／回执这些现有语义槽位 | 每种 write 的 payload/目标/幂等/effect 查询/撤销语义及端侧批准边界 | 通用“允许自动操作”开关；把当前创建内部 Action 当成已实现外部写 |

上述后续 adapter 进入同一证据、状态与批准组件，按真实能力添加字段；现在不先造通用 connector/control schema。小艺正式身份和穿戴是渠道条件，不强塞进 CT-9 的工具授权模型。

## 6. 跨端交付矩阵

| 端 | 本阶段职责 | 不能假定 | 验收 |
|---|---|---|---|
| Web | 深入证据、修改方向、审批、输入、恢复；键盘可完成 | 读到旧页面即拥有当前批准；浏览器关闭还能本地轮询 | 桌面＋360/390/430，刷新／回退／多标签竞争／网络失败 |
| HarmonyOS App | 同一状态／权限；单列、就近操作、底部输入；复杂证据展开 | HAP 构建＝手机可用；Web CSS px 可直接套 fp/vp | 当前 target 6.1.1(24)、compatible 6.1.0(23) 的设备实测；深色、大字体、输入法、读屏 |
| 原桌面服务卡片 | 最小状态快照、核对时间、打开原任务 | 私人问题正文／审批载荷可在锁屏缓存；卡片是 Runner | TTL、换账号、离线、回前台、Want 参数重验 |
| 小艺测试入口 | 查询指定 Mission；仅合法 LOW_RISK_READ_ANALYZE 接续 | 测试用户＋allowlist 是正式用户认证；语音可批准原业务效果 | 错 owner/项目、过期版本、超预算、需 App 跳转；平台真机另验 |
| 穿戴 | 先做目标设备可行性；未来最小摘要和打开手机 | 当前 module 支持 wearable、所有表支持同一卡片/API、手表能审批 | 选机型/系统/渠道后实测；本轮无“已支持手表”声明 |

官方 Intents Kit 把应用能力分发到小艺等系统入口；这不替代本产品身份绑定和审批。[官方 Intents Kit](https://developer.huawei.com.cn/consumer/cn/sdk/intents-kit)。穿戴设备分不同开发体系，需按目标设备选型。[官方穿戴概览](https://developer.huawei.com/consumer/cn/multidevice/wearables/)。当前仓库只声明 phone/tablet/2in1，正式渠道能力以代码和实机为准。

## 7. 验收案例与指标

以下是新增开发／回归场景，继承原 CT-J/X 与 R1 负例；不是已完成的用户研究，也不是独立留出集。时钟快进用于工程，跨自然日研究另计。

| ID／阶段 | 可复现任务 | 核心断言和失败反例 |
|---|---|---|
| UX-J01／1 | 新用户空项目→记录一条材料→提出一个真实问题→第一次有依据回答 | 先得到价值，再按需要请求云上下文／公开研究许可；无 Worker 时不承诺后台；无空白控制台 |
| UX-J02／1 | A 项目一批近期 FAILED，B 有待批准，C 有重要期限；Web/App 打开今日 | 同一快照相同主事项／精确对象；普通错误不能覆盖可处理决策；超过候选上限如实标 coverage |
| UX-J03／1,3 | 同一 Mission 分别等用户材料、等固定 CI 状态、PAUSED、UNKNOWN、READY | 等谁和主操作正确；待观察不算待回应；FAILED 不显示 Agent 正在接续；UNKNOWN 不重新派发 |
| UX-J04／2 | 同一问题先 PR-6 摘要，再 PDF 原页／论文元数据，证据充分后结束 | 自主选择和停止，不强制固定路径；reading level/物理页/覆盖准确；不为展示工具而多读 |
| UX-J05／2 | 用户“这个数字只是我说的”→补原实验文件→修订文件→新会话追问 | 区分纠正解释与改原文；旧主张需重核；原输入保留；正负结果都可改变下一步 |
| UX-J06／2 | 同根来源派生三份摘要；停用根来源；另一项目有相似资料 | 三份不算三源；Artifact/推测/经验/待批提案都受约束；B 不误失效 |
| UX-J07／1,3 | Web 编辑→App 撤回／换账号→旧 Web 点击；离线保存失败后返回 | 后端拒绝旧操作；草稿保留且隔离账号；登录后重读；不自动提交旧草稿 |
| UX-J08／1,3 | 模型／工具在途时改方向，到期无新事件，随后迟到响应 | generation/lease/原预算守恒；UI 与实际调查一起改道；旧答案不重新发布 |
| UX-J09／2 | 不同 split 的指标与论文高分对照；同条件下降走原固定核算 | 不可比保持未知；核算先原批准；真实 job 回执不说“已复现方法”；保留 Action/resultCardId |
| UX-J10／1,2 | capabilities 部分关闭、旧消息、新字段缺失、原来源撤权 | 正文／原对象 fallback；不露不可用按钮；旧引用不能成为有效支持 |
| UX-J11／3 | 同状态 CI 重复四轮，静默跨夜，随后出现关键问题 | 无变化零模型；HTTP 成本照记；普通变化合并；STOP 不复活；关键项能被主动打开看到 |
| UX-J12／1,3 | D1 委托→D3 新会话/手机→D5 原 Action 完成→原 Mission 读回 | 同 Mission/Action/resultCardId，无重复批准效果；工程快进与真实自然日证据分开 |
| UX-J13／3 | 小艺／桌面卡片读状态，进入审批、切账号、离线过期 | 小艺不发批准令牌；受限恢复；卡片重新认证并导航原任务；穿戴无实现时不冒充可用 |
| UX-J14／2 | 两端同时纠正／整理，原来源在预览后改版，撤回整理 | 当前 guard 拒绝过期确认；重放原回执；撤销不覆盖后来的独立用户修改 |

### 体验与 Agent 质量分开量测

| 指标 | 定义／记录方法 | 建议放行目标，评测前冻结 |
|---|---|---|
| 首次价值 | 从有权访问的空项目开始，到用户能指出一项有来源的判断／下一步；权限选择与等待分开计时 | ≥80% 新用户无主持人提示完成；中位主动操作 ≤3 分钟 |
| 下一步理解 | 展示页面后，用户正确说出项目、等谁、下一动作、结果层级的次数/机会 | ≥90%；中位识别 ≤15 秒；样本小则报 n/N |
| 接续成功 | 新会话找到并继续原对象且无重复效果/应接续机会 | 工程集 100%；用户任务 ≥90% |
| 纠正有效 | 同 scope 纠正后不再错误使用的决策点/全部暴露机会；误伤他项目单列 | ≥95%；跨项目错误传播 0 |
| 自主推进 | 授权、预算、资料足够时实际执行必要调查/可推进机会 | 不低于当前 CT 基线；不得靠多问用户、逐工具确认“降噪” |
| 调查适应 | 新观察使合理换工具／结束／移交的案例；按允许下一步集合评，不规定唯一链 | 正向、负结果、证据已足三类都通过 |
| 提醒质量 | 有价值的用户打断/全部打断；应及时可见却遗漏/关键事项 | 重复提醒 0；关键漏报 0；噪声较基线下降，静默不能充当高分 |
| 误完成／误授权 | 用户把元数据当全文、READY 当运行、回执当现实成功、FOLLOW 当付费许可的次数 | 硬负例 0；用户研究逐例报告和修订 |
| 成本与耗时 | 原模型、工具、HTTP、UNKNOWN 预占和主动操作时长；分别统计 | 无变化模型调用 0；相同任务能力不退化；不清账缩分母 |

对照采用同一 CT-1～6 工具集、同一数据／模型／预算的 **当前 UI** 与 **新 UX**，先只比较表达和用户成本；S1/S3 服务补全作为单独因素标记，不把后端修复全部归因于视觉改版。旧 Q&A / 固定流程仅是补充对照，不能以删调查换取快响应。

独立质量：延续原 CT 24 条隐藏多轮题，非实现者准备、双人盲评；另用至少 5 名目标用户做首次使用、纠正与相隔 ≥3 日接续，覆盖三类项目。模型裁判仅辅助；执行结果由 SQL/原回执核对。新场景暴露给开发后不得继续叫隐藏集。独立实模评测使用新 campaign 和硬上限；同一 Mission 接续仍累计原责任总账，历史 UNKNOWN 不移出账本。本轮未调用付费模型。

## 8. 验证、发布与回滚

实施时按阶段先跑受影响测试，再做发布集合：`npm.cmd exec tsc -- --noEmit`、`npm.cmd run lint`、`npm.cmd test`、`npm.cmd run test:e2e`、`npm.cmd run harmony:test`、`npm.cmd run harmony:build`。Web E2E 脚本包含隔离构建，成功后不为凑次数重复 build。独立构建需要时再跑 `npm.cmd run build`。

沿现有 Vitest/E2E 隔离库与 Windows 清理脚本；模型、HTTP、真实容器、合成结果、真实用户分别标注。HAP 构建、模拟器安装、目标设备、平台联调、上线各有回执，互不替代。

UX-1 复用现有持久结构，API 加可选投影字段与版本化 wait 原因。R2 的 UX-2 则在原数据库增加必要 Claim/Event/Digest 和来源绑定，需空库及旧库副本迁移验证；不能因为只读页面就跳过持久合同，也不操作真实库。JSON 写 schemaVersion 和旧记录 fallback。原 feature flags 管能力；若需要 UI 灰度只增加双端可读的 projection capability，不另设授权体系。

回滚可退呈现层，原 guard、有效指令和回执保持；新 JSON 旧客户端可忽略，但必须有自然文本入口。不能退回会放行旧源或忽略停止限制的写路径。每阶段继续维护已有 `R4_AGENT_UX_IMPLEMENTATION_NOTES.md`，记录真实验证、Deviations 与未关闭 Gate。

## 9. 裁决、延期与实施探针

已作出的产品裁决：以三个用户任务收敛；保留动态调查与生成式布局；Memory/Dream 用中文“已记录／待核实”；Always On 显示为具体委托的“持续跟进”；复杂授权和证据渐进展开；真实批准的对象、范围、费用及后果不能折叠到看不见。

| 待探针／条件 | 阶段 | 可证伪的检查与处理 |
|---|---|---|
| WAITING_INPUT 投影与真实理解 | UX-1 工程已验；人评开放 | 已补等待原因和未知 fallback；继续真实用户／设备样本，不由模型自由文字猜责任方 |
| 全局排序和响应成本 | UX-1 工程已验；扩大规模复测 | 已补有界分组覆盖、共享读取与排序负例；较大数据量继续记录查询量/p95和 coverage |
| claim 级纠正／抑制身份 | UX-2 | 同句不同 source/版本不串改；来源链未知只允许重新调查；不能把未知 locator 当新权威根 |
| 原记忆快捷确认 guard | UX-2 | 预览后 source/relation 变化、双端并发、重放；旧服务不足则在原事务补校验 |
| 跨来源去重与静默后关键项 | UX-3 | 同 Mission 来自 Anchor/GoalQuestion/Intervention 三入口；不重扣预算，也不漏当前有效审批 |
| 小艺正式账号与设备渠道 | 渠道专项 | 明确平台账号映射、目标机型及发布条件后验收；测试 allowlist 不升格正式身份 |
| 独立人评与真实多日样本 | 各阶段质量 Gate | 人员／样本尚未取得；可继续本地工程，不能提前标质量通过 |

延期事项：CT-7 部署 adapter；CT-8 深入条件经验学习（不阻塞 UX-2）；CT-9 Browser/外部资源；CT-10 外部写；穿戴 App；正式小艺多用户发布；私人 Mission 系统后台推送。延期不影响现在把已有自主调查、长期委托和结果链做好。持续责任始终由明确授权与有限总预算承接。

规划自审：完整性、范围、可测试性、风险、假设均已落到合同和案例；可行性仍依赖上表探针，不能以自评分代替实现证明。本轮“独立审计”指重新按源码和原回执核对 Demo，不表示已取得外部评审或真实用户研究。

## R2 范围与依据

UX-2 本轮完成审计、公开系统研究和规划修订，未修改业务代码。UX-3 同样只规划，不启动后台执行器。新增稳定认知、派生综合及责任／唤醒合同的真实增量、替代方案、失败反例和实施探针分别在两份深化目录中冻结；原 CT-1～10 不重排。
