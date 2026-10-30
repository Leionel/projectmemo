# UX-3 R2：Always On × 长期委托 × 主动协作

2026-10-30，北京时间。基线为 UX-1 提交 2017c31；UX-2 当前为深化规划，尚未实施。此文不启动 worker、不建后台执行器、不修改业务代码。原 CT-1～10 和 UX-2/3 的能力、工具、双端及验收范围保留。

配套：[责任与接续合同](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux3-deepening/RESPONSIBILITY_AND_CONTINUATION.md)、[交互、三日旅程与评测](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux3-deepening/UX_AND_EVAL.md)。认知依赖见 [UX-2 R2](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/UX2_DEEPENING_ROADMAP.md)。

## 1. 产品目标

用户把一段工作交代下去后，Agent 应保持对原目标、责任、证据和剩余工作的连续理解，在许可内推进；有实质变化才协作，遇到真正阻碍才请求用户。定时或事件只是唤醒机制，不能单独证明持续责任已经成立。

Always On 的完成条件同时包含：责任合同、持久状态、合适的发现／调查、结果更新、用户控制、注意力策略与跨端接续。不能靠每隔一小时重新问同一个 Prompt、重建任务或重复通知替代。

## 2. 现有代码能力对账

分类：E＝已有实现；N＝UX-3 真增量；V＝真实验收；L＝后续 adapter。

| 能力 | 当前证据 | 增量／边界 |
|---|---|---|
| 持续委托范围、期限、工具和预算 | [bounded policy](D:/Projects/hongmen/lib/types/mission.ts)、[Mission service](D:/Projects/hongmen/lib/mission/missionService.ts)、双端 MissionInvestigationDelegation | E；N：统一责任预览／修订和合成版本；不新建责任任务身份 |
| 原 Worker 与恢复 | [mission-worker](D:/Projects/hongmen/scripts/mission-worker.ts)、[runtimeStore](D:/Projects/hongmen/lib/mission/runtimeStore.ts)、原 turnWorker | E：扫描、lease/epoch、原步骤；N：公平性、扫描可观测性和故障隔离；V：持续 OS 长跑 |
| 事件与定时观察 | [investigationDelegation](D:/Projects/hongmen/lib/mission/investigationDelegation.ts)、[delegationObservation](D:/Projects/hongmen/lib/mission/delegationObservation.ts) | E：输入 fingerprint、到期检查、固定 SHA CI；N：明确 wake 原因和获准分支新提交发现 |
| 下一次检查与稳定观察 | [release](D:/Projects/hongmen/lib/mission/runtimeStore.ts) | E：WAITING_INPUT 释放时按周期及 expiresAt 更新 nextAttemptAt；不能误判为每 15 秒重复执行调查 |
| 动态研究 | 原 GoalGap/Investigation、Mission tools、PR-6／CT-2～6 | E：根据新观察选工具；N：接 UX-2 稳定假设、记忆 dirty 与重验资格；不固定工具链 |
| 控制与失效 | [Continuity](D:/Projects/hongmen/lib/continuity/directiveService.ts)、turnCoordination、原 sourcePolicy | E：STOP/撤回／到期／版本／UNKNOWN；N：责任视图和新 wake／认知源共用原 guard |
| 注意力与私人收件箱 | [USER policy](D:/Projects/hongmen/lib/services/interventionPolicyService.ts)、[attentionReceipt](D:/Projects/hongmen/lib/mission/attentionReceipt.ts)、Anchor/GoalQuestionPreference | E：静默、日预算、去重、PRIVATE_MISSION、SEEN；N：变化价值、跨入口合并和漏报检测 |
| 可审计活动 | AgentRun、MissionStep/Event、原 [readback](D:/Projects/hongmen/lib/mission/readback.ts) | E：provider、步骤、失败和原结果；N：面向用户的责任／活动投影和真实 worker presence |
| 状态与接续 | UX-1 WorkState、Focus、Handoff，Web/ArkTS | E：等谁、原问题／批准／结果；N：连续责任摘要、跨端未读和动作一致性 |
| 卡片与通知 | WidgetDataService、MissionWidgetContract、NotificationService、Action reminder | E：有真实组件；V：设备投递；私人 Mission systemPush=false，不能说已支持关 App 推送 |
| 小艺／穿戴 | 原 inspect/resume、测试身份／allowlist；module 无 wearable | E：受限通路；V：正式身份／平台；L：穿戴可行性，不能预设审批 |

原 CT-3 1158 服务测试、24 Web 通过／2 跳过及原生构建是工程证据；UX-1 又验证了共享状态与接续。真实多日、目标设备、真实失败日志域名和独立质量仍开放。

### 2.1 接入点与调用方

| 合同 | 当前真实入口 | UX-3 改造位置 |
|---|---|---|
| 责任与修订 | [Mission route](D:/Projects/hongmen/app/api/missions/[id]/route.ts)、continuation-policy、constraints、research-scope、budget-review、pause/resume/cancel | 在原 missionService 的用例边界组合预览／原子修订；新 DTO 仍由原 Mission 路由和共享类型承载 |
| 经过与结果 | [events](D:/Projects/hongmen/app/api/missions/[id]/events/route.ts)、[readback](D:/Projects/hongmen/app/api/missions/[id]/readback/route.ts)、原 outputs/input/approvals | 原事实投影出 Activity/Responsibility，继续绑定原问题、批准、Action 和 resultCardId |
| 注意力 | [attention](D:/Projects/hongmen/app/api/missions/[id]/attention/route.ts)、[interventionPolicyService](D:/Projects/hongmen/lib/services/interventionPolicyService.ts)、[anchorService](D:/Projects/hongmen/lib/conversation/anchorService.ts)、goal-question-preference | 复用当前用户总账、偏好、Decision 和私人回执；补语义去重与跨入口投影 |
| Web | [MissionInvestigationDelegation](D:/Projects/hongmen/components/MissionInvestigationDelegation.tsx)、[MissionPanel](D:/Projects/hongmen/components/MissionPanel.tsx)、[FocusAgentWorkspace](D:/Projects/hongmen/components/FocusAgentWorkspace.tsx) | 一次交代、原位协作、活动渐进展开；不新增后台控制台 |
| 鸿蒙 App | [MissionPanel](D:/Projects/hongmen/harmonyos/entry/src/main/ets/components/MissionPanel.ets)、[MissionInvestigationDelegation](D:/Projects/hongmen/harmonyos/entry/src/main/ets/components/MissionInvestigationDelegation.ets)、[MissionService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/MissionService.ets)、[Mission 模型](D:/Projects/hongmen/harmonyos/entry/src/main/ets/models/Mission.ets) | 同步 DTO／版本／错误、快答／暂停／授权、回前台重读、草稿与原回执 |
| 系统入口 | [MissionWidgetContract](D:/Projects/hongmen/harmonyos/entry/src/main/ets/common/MissionWidgetContract.ets)、[WidgetDataService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/WidgetDataService.ets)、[NotificationService](D:/Projects/hongmen/harmonyos/entry/src/main/ets/services/NotificationService.ets)、[missionAccess](D:/Projects/hongmen/lib/xiaoyi/missionAccess.ts) | 先校准真实可用能力、隐私与回流；正式账号和设备渠道分别验收 |

以上链接定位源码／目录；未链接的 API 子路径都在原 `/api/missions/{id}` 下。R2 不调用写接口或启动 Worker。

### 2.2 静态审计发现

**A01，P1：队列公平性。** Worker 目前采用 runConversationTurn() || runMissionSlice()。连续 Conversation backlog 时，Mission 可能一直不被调用。UX-3 应在原循环内做有界公平领取／轮换，并用持续到达的队列测试；不建立新 Runner。

**A02，P1：当前 CI 观察不等于分支持续发现。** 已实现的是从已收录信号选择固定 SHA，再按许可检查状态。跟踪新 head 需要把原 refreshConnection 的读取接入原 Step/HTTP 账本及授权周期，不能把手工刷新接口直接无预算定时调用。

**A03，P1：活动可见不等于运行健康。** 有步骤／HAP／功能开关不证明 worker 当前活跃；租约只能证明对应窗口。需要真实 presence／最后扫描与领取事实，读失败不显示“后台正常”。

**A04，P1：已读、可见和实际送达。** 原私人回执是 AVAILABLE/SEEN，且 systemPush=false。不能将其翻译成手机通知已送达，或将 SEEN 当原提案已批准。

**A05，P1：跨入口的意义去重仍需验。** 已有多个有效去重键和预算联动，但 Anchor、GoalQuestion、Focus、私人任务的同一事项合并、静默后关键项和多个设备应做完整旅程，不仅检查单服务返回。

**A06，P1：长期责任超出短 pilot 的额度表达。** 当前持续模型上限 24、工具 64、HTTP 96，适合当前有界实现。长期责任需要在原预算复核中支持有限但更长的总包及可选日突发上限；不能每日重置总消耗，也不能无限自动续费。

这些是代码和合同风险。本轮没有运行新的 worker／并发故障探针，不把风险描述写成生产故障结论。

## 3. 行业比较

以下为查询时的公开资料，不推断产品内部表、调度器或 Prompt。

| 对照 | 公开行为／工程机制 | 对 ProjectMemo 的启发与限度 |
|---|---|---|
| [OpenAI Dots](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot) | 官方说明目标可跨会话推进，结合记忆和连接应用；用户可反馈、改变方向、暂停 | 责任和控制是持续体验核心；其私有电脑／内部调度不等于本项目已实现 |
| [ChatGPT Scheduled Tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt) | 当前帮助页已包含定时和受支持应用事件、条件／指令审核、审批暂停和通知设置 | 不把 Tasks 简化成纯闹钟；触发仍不自动解决目标连续性、来源和结果语义 |
| [Claude Cowork recurring tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork) | 当前说明区分远程运行和本地文件／应用依赖；任务可查看、暂停和管理 | 不能沿用“所有 Cowork 都必须电脑开着”的旧描述；本项目也应显示真实运行位置与条件 |
| [Claude Agent SDK hosting](https://platform.claude.com/cookbook/claude-agent-sdk-07-hosting-the-agent) | 公开示例区分 session 持久化、进程／容器生命周期、路由与网关认证 | 借鉴恢复身份与部署责任；不引入第二 SDK 执行系统，sessionId 也不是本项目授权 |
| [Meta Muse](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) | 公开说明跨会话跟进、连接范围、敏感操作核对、暂停／遗忘和活动审计 | 借鉴主动协作与可见控制；不将它的 VM/Sentinel 当作本项目已有能力 |
| [Grok Automations](https://x.ai/news/grok-automations) | 官方说明定时或邮件触发、每次运行的对话与历史、可接着对话、通知偏好 | 借鉴完整运行历史和可接续输出；“每次 fresh request”不替代同一 Mission 的累计预算和结果链 |
| [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | 检查点支持持久恢复及中断后的状态读取 | 借鉴持久边界；外部副作用仍需幂等／效果查询，检查点不是任意外部操作 exactly-once 的证明 |

共同值得借鉴的是：一次交代、真实进展、历史可查、必要时协作、用户能改变边界。ProjectMemo 的增量落在原服务合同，不能用竞品功能名替代本地验收。

## 4. UX-3A～D 内部阶段

| 阶段 | 真实纵向行为 | 主要增量与依赖 | 退出证据 |
|---|---|---|---|
| **3A 责任与可靠接续** | 一次核对范围／期限／总包，离开后原 Mission 合法继续 | 统一责任 DTO／修订；原循环公平性；wake 原因、失败／UNKNOWN、presence；依赖 UX-1 | 状态、预算、边界、双 worker、积压和重启；无第二 Runner |
| **3B 主动发现与记忆联动** | 新证据形成有意义问题，Agent 自主验证或给一项建议 | UX-2 dirty/claim/revalidation refs；获准只读 research watch；分支 head 发现的原账本适配 | 新观察实际改变调查；无范围越权，无变化零模型 |
| **3C 注意力和双端协作** | 静默中合法调查，关键问题留在收件箱，手机处理，Web 读同结果 | 原 USER policy/Anchor/Decision 合并；价值解释；最小卡片／小艺和可用性 | 重复扣预算 0、关键漏报 0、SEEN/批准/执行分离；设备 Gate 单列 |
| **3D 三日可靠性与 Agent 质量** | D1 交代、D2 变化／故障、D3 纠正与原结果回写 | 完整工具链、跨自然日、恢复／并发、独立质量和消融 | 原 Mission/Action/resultCardId；工程、实模、人评、设备分别签收 |

四阶段是同一完整 UX-3 的检查组织。A 可先于完整 UX-2 实施；B/D 的认知闭环依赖 UX-2 的真实合同，不能把待规划能力标成现有。C 也不能以静态卡片替代后台进展。

推荐第一个 UX-3 纵向切片是 **3A：一次交代 → 离开 → 原 CI 检查 → 真实活动／等待原因 → 手机接续 → 原结果读回**。先用原固定 SHA 观察证明可靠性，再在 3B 接分支新 head 和 UX-2 认知重验；不以建责任表、心跳表或只做新首页作为 3A 完成。当前整体执行仍先完成 UX-2，不在这轮规划中启动 3A。

## 5. 与 CT-7～10 的边界

UX-3 现在完成原长期委托、CI 观察／获准发现、注意力、审计活动、多端接续和实际验收。CT-7 提供部署／健康的 L0 adapter；CT-8 提供条件经验和更深反馈学习；CT-9 提供 Browser/外部应用；CT-10 提供具体外部写、查询／撤销和效果回执。

共同的责任、唤醒、来源、成本、停止和 UNKNOWN 合同现在定义并验证；没有 adapter 时只说明缺口，不伪造在线健康、邮件发送或浏览器操作。穿戴和正式系统渠道按设备条件独立推进，不成为删减双端长期委托的理由。
