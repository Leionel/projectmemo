# Focus Agent 实施路线：从跨项目对话到原任务闭环

日期：2026-10-26 修订。面向开发者与验收负责人。架构合同见 [FOCUS_AGENT_ARCHITECTURE.md](FOCUS_AGENT_ARCHITECTURE.md)，实际状态见 [实施记录](FOCUS_AGENT_IMPLEMENTATION_NOTES.md)。

## 1. 裁决摘要：下一轮开发什么

**领取 F1 + F2 窄切片“理解、决定、创建真实行动并读回”。** 同一用户跨项目比较、连续追问、绑定原 Mission，确认后复用现服务创建真实 Action，并在原会话读到同一 Action 状态。只读问答是技术里程碑，不能作为首个完整产品交付。

本次新增四个首包门槛：跨页面保持原 Conversation；独立 Priority Reasoning 及显式偏好；现有提醒一键追问；至少一种真实业务写入及同会话读回。动态 D2、完整结果写回和自动消息更新不提前。

这要求同时完成最小 Conversation 迁移、Context Router、用户级额度、带范围的来源合同，以及 Web/鸿蒙入口。只加聊天框、拼接焦点的六项摘要、把所有问题转成新 Mission，均不能交付 F1-A。

顺序为 **F1 跨项目持续理解 → F2 冻结决定推进原业务对象 → F3 主动发现与动态反馈闭环**。A/P1-A 和 E0 已有工程基础，继续消费其现成 API；D1/D2 在原 decision 路线深化，Focus 提供统一协作面。E0 和设备/效果验收的未关闭项不阻止 F1 本地开发，也不能被 F1 通过覆盖。

| 当前核查 | 结论 |
| --- | --- |
| 分支/HEAD | `codex/r3-runtime-research` / `7f7582ad6cb92b328f18b72b3d26759a824f72f9` |
| 既存修改 | AGENTS、旧演进路线、鸿蒙签名配置、Next/TS 生成配置等保留；不纳入本方案代码包 |
| 有效底层进度 | [实施计划](docs/FINAL/AGENT_REVIEW/NEXT_PHASE_IMPLEMENTATION_PLAN.md)及[实施记录](docs/FINAL/AGENT_REVIEW/NEXT_PHASE_IMPLEMENTATION_NOTES.md)：P1-A、P2-A/B 窄域 E0 有实现，D1/D2/E1/N6 未实施 |
| 初次规划验证 | 2026-10-25 的47项现有隔离回归；本次实施结果见实施记录 |
| 前序文档处理 | 保留原计划/研究；Focus 作为统一交互层增量。旧决策摘要的“先做 P1-A”需按现进度理解，不能重复开发 |

收尾另观察到 Constants 的开发 flavor 和 MissionEvidenceReview 的显示样式修改；本轮未操作，已在架构基线记录。47 项回归对应本次测试运行时快照，不替代这些后续鸿蒙修改的设备验收。

## 2. 一个体验、三阶段完成门槛

| 阶段 | 用户获得的能力 | 必须证明的增量 | 不计作完成的展示 |
| --- | --- | --- | --- |
| F1 + 协作窄切片 | 比较项目、解释优先级、提醒追问、跨页面/跨设备继续、确认创建 Action 并读回 | 真正跨项目读取；原 Conversation/对象持续；真实 Action/来源/回执可核对 | 固定问句、链接结束协作、仅最近六项、Mock 当模型成功 |
| F2：决定与任务协作 | 在对话内调查、选原方案、补料、批准、看原结果 | 冻结选择经现服务改变原对象；相同请求零重复效果；结果可在原项目核对 | 只输出计划、跳页面才做所有关键步骤、另建平行待办库 |
| F3：主动发现与闭环 | 从变化继续同一讨论，按新结果选择读/问/验证/保持 | D1 有用发现、Anchor 去重、D2 有界反馈与原任务修订 | 推送数量增加、全量提醒入聊天、只测 Fit 准确率 |

三个阶段都能上线独立价值；后续按原合同扩展同一会话，不为每阶段另建一套聊天产品。下面数值是拟议验收阈值和预算，非已测表现，也不构成付费调用授权。

## 3. Phase F1：全局对话基础与 Context Router

### 3.1 用户价值与技术目标

用户问“最近哪个项目最值得处理”，Agent 在授权项目目录上观察目标、截止、等待和风险，并按问题深入原资料。用户的下一句能继续明确对象；“不要联网”“只看比赛项目”在长对话和换设备后仍有效。

目标是用户级持久会话、显式上下文范围、可追溯问题路由、隔离权限和费用。F1 的多轮能力必须超出现有 Copilot 的最近六条文本拼入 Prompt；关键绑定和否决以结构保存。

### 3.2 工作包与代码落点

“拟增”均是未来文件，不代表当前已有实现。每个包包含必要调用方和测试适配。

| 包 | 工作内容 | 主要文件/模块 | 验收输出 |
| --- | --- | --- | --- |
| F1-A.1 | 建会话/请求/对象绑定，兼容旧历史 | `prisma/schema.prisma`、新 migration；拟 `lib/conversation/repository.ts`、`contracts.ts`、`service.ts`；适配 `lib/repositories/agent.ts`、`lib/services/copilotService.ts` | 空库/旧库副本迁移；旧 message/run/确认结果 ID 不变；无 owner 历史不迁入私聊 |
| F1-A.2 | 显式用户计费、usage 透传与持久请求预占 | `lib/auth/cloudQuota.ts`、`lib/agent/llmAgent.ts`；拟 `lib/conversation/turnService.ts`；原 provider 调用方兼容 | 同 request 唯一预占；workspace 计当前用户；project 行为保留；未知 usage 如实记录；UNKNOWN 不自动重发 |
| F1-A.3 | 授权目录、分层摘要、定向路由 | 拟 `lib/services/workspaceContextService.ts`、`lib/conversation/contextRouter.ts`、`evidenceAdapter.ts`；复用 `projectAgentContextService.ts`、`lib/mission/memorySearch.ts`、`sourceSignals.ts`、`readback.ts`、Ledger | 第七个及无焦点事项项目可被找到；问不同问题产生不同读取；coverage 完整记录 |
| F1-A.4 | 多轮结构与类型化返回 | 拟 `lib/conversation/focusResolver.ts`、`historyBuilder.ts`、`lib/types/conversation.ts`、`lib/types/workspaceContext.ts`、`lib/agent/focusPrompts.ts` | 冻结建议的 project/mission refs；歧义先澄清；否决不被压缩丢失 |
| F1-A.5 | 会话 API 与双端纵向入口 | 拟 `app/api/conversations/`；`app/focus/page.tsx`、`components/FocusDashboard.module.css`；拟 `ConversationPanel.tsx`、`FocusAgentEntry.tsx`；鸿蒙 `GlobalFocusPanel.ets`、拟 `pages/FocusConversation.ets`、`services/ConversationService.ets`、`models/Conversation.ets` 及 pages 注册 | 真实后端多轮、打开原任务、返回同会话；小屏/键盘可用；无复制客户端模型逻辑 |

先完成一个贯穿 F1-A.1–A.5 的窄纵向样例，再扩历史压缩/更多查询类型，不能先铺完整会话平台而无跨项目问答。

### 3.2.1 本次补入的首包任务

| 包 | 实现与验证 |
| --- | --- |
| F1-A.6 Priority Reasoning | Router 外独立合同：目标重要性/长期目标、时效、阻塞、投入、用户偏好、unknown、备选与取舍；用户偏好持久化并有版本。至少覆盖“无截止的重要科研”和“五分钟临期任务”，模型不可用时明确规则观察而非伪装智能排序 |
| F1-A.7 会话连续性 | Focus→项目知识页→原会话、Focus→Mission→返回；conversationId/message/object 引用不丢。项目可另建 PROJECT 会话，旧历史保留、私人跨项目全文不入公共历史 |
| F1-A.8 已有提醒追问 | 手动入口绑定 Intervention/GoalQuestion/Impact ID、来源和修订；去重显式进入，后续自动事件投影仍 F3 |
| F1-C.1 真实协作 | 复用冻结 CopilotToolExecution/createActionInTx，确认创建同项目真实 Action，重复确认同 ID；同会话实时读回。PAUSED Mission 可显式预览/确认原 resume，其他状态不套通用恢复 |

首包数据除原 Conversation 层，还含最小 ConversationAnchor 和用户项目优先偏好；不另建执行系统。详细实现偏差及迁移写入实施记录。

### 3.3 API、数据与兼容

新增 Conversation、ConversationProject、ConversationTurn、ConversationBinding；AgentMessage/AgentRun 增可空 conversation/turn 关联及 workspace 所需 nullable projectId。字段、不变量与迁移次序见架构 §4。

首包实现 create/list/read、turn submit/status、context update。明确要求 requestId、expectedVersion、replyToMessageId/bindingIds、contextSelection；模型上下文授权单列。已配置云模型时，发送区默认选中云端分析，并说明发送会使用本次授权项目资料，用户可关闭；只有主动发送才随请求提交 llmContextApproved，进入页面和刷新不触发模型调用。未配置模型时明确显示本地整理。响应含 scope、read manifest、sources、bindings、status 和 failure/fallback 元数据。

纯 GET 不跑模型、不写 Mission event、不改变 nextStep。POST turn 使用固定路由/读取/回答阶段，首版正常请求同步返回最终提交结果；相同 in-flight 请求返回 202 + turnId，客户端读 status。进程中断不靠浏览器连接维持任务，启动恢复将已发模型且无回执的 turn 标 UNKNOWN，未发出的可明确重试；不把“返回 202”当作已存在可恢复后台执行能力。

旧项目 API 继续按原 DTO 返回；可证明归属的历史可幂等绑定为 PROJECT Conversation，旧无 owner 行保留原位。新旧读取器均不得把 projectId=null 当“全部项目”。工作区消息只在私有 Conversation API 可见。

### 3.4 两端交互

Web 首版真实列表/对话联动，旧 hero 改为左区首项，右区不被说明卡占满。HarmonyOS 保留底部“焦点/项目/记忆/行动”，在焦点显示“问忆程”，展开全屏会话；显示同一来源与对象语义。

两个客户端共享 schemaVersion、block/intent 能力、游标、绑定和失败语义。保留 ApiClient、Cookie/Bearer 认证、generation 防迟到、鉴权失败清缓存；新会话请求切用户/项目后返回的旧响应不得覆盖新页面。

### 3.5 模型、预算、权限与回执

采用现有兼容模型 provider 和严格 JSON schema。模型提出路由/建议，服务器限制可读项目及工具，状态事实独立读库。无需引入新的模型平台依赖。

每 turn 目标上限：路由 1 次 + 回答 1 次 + 可选 Judge 1 次；本地读取≤6、深读项目≤3、来源片段≤12；目录最多 3×20 项，超出明确分页；总输入建议≤12k tokens、总输出≤4k tokens、主动执行≤60 秒。所有付费子调用共用根预算，修复/压缩/嵌入不额外隐形计次。Judge 未运行时显示 NOT_CHECKED，不用“有引用”代替语义支持。

读项目用 membership；私有 Mission 仍要求 ownerUserId 与 OWNER，不能因为项目可读就显示他人待批准。确认前后撤权均应阻断出站/返回受限内容。read manifest 记录实际覆盖、source hash/revision、时间与失败；不记录密钥、个人数据库或全量私密 Prompt 到公开证据。

### 3.6 测试与真实验收

拟测试文件：`tests/conversationPersistence.test.ts`、`workspaceContextRouter.test.ts`、`conversationAccess.test.ts`、`conversationQuota.test.ts`、`focusConversationPanel.test.ts`、`conversationNativeContract.test.ts`。名称在实施时创建，不是当前可执行命令。

| 测试层 | 必测内容 | 通过条件 |
| --- | --- | --- |
| 迁移/持久 | 空库、旧库副本、旧私聊、无 owner、同 request 换载荷、重进/跨设备 | 零历史丢失/误归属；原回执重放同 ID；新库约束有效 |
| Router | ≥8 项目、同名项目、无近期焦点项目、归档、项目超过60、同义查询、部分工具失败 | 不按 Focus 截断检索；不完整不说全局；指定项目定向查；局部失败有 coverage |
| 多轮/权限 | 指代上一建议、切焦点、两个候选、旧否决、多端竞争、期间撤权、摘要混合项目 | 歧义不执行；不串项目；模型输入及返回无撤权内容；冲突保留原输入 |
| 额度/中断 | 无额度、同请求并发、已发未回、模型失败/降级、显式重试 | 零隐形绕额度/重复预占；UNKNOWN 可查；不伪造成功 |
| UI/协议 | 状态/证据卡、390px/360vp、130% 字体、暗色、键盘、401清理、冷启动 | 两端同 conversation/refs；可回原任务并返回；未知操作只读 |

真实模型工程小验收先冻结 12 段多轮会话：6 段跨项目优先级/进展，3 段历史原因，3 段歧义/权限/覆盖不足。开发输入和保留评测输入分开；成功样例与失败样例全部归档。每段 3–5 次用户输入，最多 2 个明确 attempt；按上限预估最多 360 个付费子请求，实际以更小的当次授权额度为准，额度不足先完成可执行工程与离线评测。

对照为“当前焦点 + 项目 Copilot”和“同模型、相同可读原资料额度的摘要拼接问答”；新系统必须通过实际读取而非预置答案完成。记录路由目标、可观察金标、来源覆盖、回答正确性、多轮绑定、调用/token/时延/失败。上线前安全约束零违反；在 12 段中至少 10 段端到端正确，多轮唯一指代全部正确，遇到歧义全部澄清。小样阈值只用于工程放行，不用于推断总体提升率。

### 3.7 完成、失败与回滚

F1 首个产品交付完成需要：真实模型跨项目理解和优先级解释通过、提醒追问、跨页面/双端连续性通过、权限/额度/历史迁移通过、确认创建真实 Action 并读回同 ID、覆盖不足不冒充完整；模型或设备条件欠缺时分别记录工程与相应验收，不能标整个 F1 完成。

路由不佳先改目录与定向读取，不能用全量项目拼 Prompt 替代。模型不可信时保留结构化状态读取和澄清，但这只是降级，不作为真实跨项目理解通过。关闭拟 `FOCUS_AGENT_ENABLED` 写入口即可回原焦点；保留新表和兼容读取器，禁止倒迁移删除会话。

## 4. Phase F2：对话驱动调查、决定与 Mission 协作

### 4.1 用户价值与技术目标

用户能说“查已有证据”“选第一种”“继续原委托”“把这个变成行动”“验证结果是……”并在对话内完成必要预览和批准。调查、选择和写入关联原对象；原项目中能读到同一结果。

技术目标是结构化 AgentIntent、冻结 optionMap、业务服务适配和双向结果投影。现固定 DecisionScenarios 可先接入；D2 动态候选不是 F2 首切片的硬依赖，也不能将固定枚举重新包装称动态规划。

### 4.2 工作包与代码/API 落点

| 包 | 代码落点 | 原服务复用与新增 |
| --- | --- | --- |
| F2-A 对象/意图解析 | 拟 `lib/conversation/intent.ts`、`focusResolver.ts`、`proposalService.ts`；`lib/types/conversation.ts`、Copilot DTO | 提出 ANSWER/CLARIFY/INSPECT/OPEN_EXISTING/PREVIEW_*/REPORT_RESULT 等受控意图；用 server binding 解析，不让模型上传执行权 |
| F2-B 冻结命令与批准 | `lib/copilot/confirmation.ts`、`continuation.ts`、`prisma/schema.prisma`；拟 `lib/conversation/commandAdapters.ts` | 扩 CopilotToolExecution target/ref/readSet/expiry/version；新增会话 confirm/decline API；原提案只引用，原业务命令只消费一次 |
| F2-C 原 Mission 内调查/接续 | `lib/mission/missionService.ts`、`continuationService.ts`、`tools.ts`、`sourceSignals.ts`；`lib/decision/scenarios.ts` | 当前只读工具及原 input/continuation/resume/approval；必要时提取 tx 入口；受限 raw material 工具若与 D2 重叠，只由原 Registry 实现一份 |
| F2-D 结果与成果回流 | `lib/services/actionService.ts`、`artifactService.ts`、`lib/mission/artifactAdoptionService.ts`、`readback.ts`；拟 `lib/conversation/receiptProjection.ts` | 提取行动结果 prepare/commit 与 actor/版本 guard；精确 Output revision、Action/resultCardId、Artifact receipt；显式 reconcile API |
| F2-E 双端卡片与返回 | Web `MemoryCopilot.tsx`、`CopilotContinuation.tsx`、`MissionContinuation.tsx`、`MissionReadback.tsx` 提取展示复用；鸿蒙对应 Mission/Decision/Copilot 服务和拟会话卡片 | 在同会话提供原表单/批准，打开详情是深入阅读。保留原问答、创建、排程、执行和完成的不同状态 |

适配以服务为主，不让新 route 绕回自己发 HTTP。现服务开启独立事务时，为跨层原子确认提取可传 tx 的核心入口，保留旧 wrapper。多目标计划先逐项目/逐对象批准，避免首版承诺跨项目全局写事务。

### 4.3 数据、模型和授权

只增加架构 §4.3 的 CopilotToolExecution 字段/索引，不建新任务表。新提案来源是会话 AgentRun，包含 targetProjectId 和冻结 binding；引用 DecisionScenarioProposal 时以原 status/receipt 为准。

自然语言选择可以自动定位候选，但执行前需显示服务器生成的明确预览并确认；“第一个”不直接等价于 approved=true。批准某项计划不自动批准后续 Action、外部访问或费用扩张。已获明确范围授权的只读调查可自主进行，超范围返回预览。

会话 turn 仍使用 F1 上限；转给原 Mission 后，调用/工具使用计入该 Mission 剩余预算。路由成本与任务执行分别记账，不能双扣同一 provider 请求，也不能通过聊天新建任务重置预算。F2 不额外引入决策模型服务；D2 完成后接其冻结 V2 提案，预算按原 D2 Gate。

### 4.4 测试与真实模型验收

拟测试：`conversationIntentBinding.test.ts`、`conversationConfirmation.test.ts`、`conversationMissionIntegration.test.ts`、`conversationReceiptProjection.test.ts`，并扩现 Copilot persistence/continuation、MissionContinuation、DecisionEvolution、Action completion 和双端契约测试。

必测：两个同项目 Mission 目标不同；两个项目的“第一种”；否决后换方案；运行中/暂停/等待/失败/终态的不同命令；版本和来源变化；相关/无关 source 更新成对；并发确认、载荷篡改、确认后断网、投影失败、撤权、完成与取消竞争、同结果重复提交、设备冷启动恢复。

真实模型冻结至少 12 段协作：4 段复用原 Mission，3 段必要新任务，3 段方案选择/拒绝，2 段结果回写，覆盖下文场景一和三。用实际独立数据库、实际 API 和原 Worker 运行，结果核对原表及 readback。模型建议、已批准、工具执行和用户现实结果分别评审。

门槛：至少 10/12 段完成正确业务路径；所有实际写入目标、冻结选项、效果 ID 与预期一致；重复请求新增业务效果为零；陈旧/越权/未批准写入为零；旧 API 回归通过。错误绑定即阻止放行，不能靠总体成功率稀释。

### 4.5 失败与回滚

业务已提交但会话投影失败：用固定 request/effect ID 读原回执，补同消息引用，不能重做业务。新命令适配器按工具开关关闭，原项目入口继续可用；保留已执行回执和会话。行动完成的事务/权限修复必须兼容旧调用方，不以关闭 Focus 撤销真实结果。

F2 完成门槛是“在同会话推进原对象并看到实际结果”，不是仅将用户导航到 Mission 页面。需要长时执行或现实操作时允许离开等待，但重新进入必须沿原 ID 继续。

### 4.6 2026-10-26 本地实现进展

按用户继续 F2 的要求，已实现原对象协作适配：原问题答复、原批准/拒绝、材料评估与接续、暂停任务恢复、固定方案对比/采用、精确 Output 归入，以及同 Action 的完成与复盘。Web 与鸿蒙在会话内提供表单、预览和确认；原 Worker 继续负责执行，不因聊天入口新增任务运行器。

原方案次序冻结在会话消息的 `options` 与 `ConversationBinding`，自然语言“选第一种”只生成明确提案。新命令复用 `CopilotToolExecution.proposalJson` 保存版本化信封，冻结原对象、命令载荷、局部版本、会话限制及15分钟有效期；本批没有增加重复的业务状态表，也没有新增 Prisma 列。后续需要按信封字段检索时再提升为可空列。

F2 工程进度与阶段签收分开记录。真实模型12段协作、必要新任务的语义匹配、精确累计 token 预占及设备冷启动旅程仍按原门槛验收；本批规则/脚本测试不能关闭这些门槛。具体代码、验证结果与 UI 截图见 [实施记录](FOCUS_AGENT_IMPLEMENTATION_NOTES.md)。

## 5. Phase F3：主动发现、D2 反馈与对话闭环

### 5.1 用户价值与依赖

用户上传相关材料后，焦点出现值得核对的问题；点击即可追问原变化、调查、选方案并接续原 Mission。新结果回来后讨论继续；无关材料、用户延后和否决不会制造消息噪声。

依赖 F1/F2 稳定，以及 D1 目标变化候选和 D2 动态提案的最低质量/权限/预算 Gate。可以先接已有 GoalQuestion/Impact 做 Anchor 工程验证，但只有接入有效的 D1/D2 场景并评估后才称 F3 完成。

### 5.2 工作包、接口与数据

| 包 | 代码落点 | 交付 |
| --- | --- | --- |
| F3-A 主动入口与锚定 | 拟 `lib/conversation/entryService.ts`、`anchorService.ts`；`prisma/schema.prisma`；`lib/types/globalFocus.ts`、`lib/server/globalFocus.ts`、`app/api/workspace/focus/route.ts` | ConversationAnchor 和 origin revision 去重；Focus 可选 entryRef；新增 `/api/conversations/entry`，同事件同主题返回同会话 |
| F3-B 原策略与发现衔接 | `lib/decision/questions.ts`、`impactJobs.ts`、原 intervention policy/feedback；D1 拟 `changeUnderstanding.ts`、`changeCandidateRules.ts` | 只消费结构化发现；PRESENT/EXPOSED/UNKNOWN/LATER/STOP 各自原语义；D1 候选不得成为未核验硬依赖 |
| F3-C 动态决定与结果反馈 | D2 拟 `dynamicCandidates.ts`、`boundedReview.ts`；`scenarios.ts`；`lib/conversation/receiptProjection.ts` | 引用 purpose=CHANGE_REVIEW/DYNAMIC_PLAN 的 V2 原提案；KEEP_PLAN 不改 planRevision；有限反馈后可停止 |
| F3-D 双端联动与投影恢复 | `GoalQuestion.tsx`、`GlobalFocusPanel.ets`、`GoalQuestionPanel.ets`、会话 UI；`scripts/mission-worker.ts` 按需增投影派发 | 一键追问、同主题修订、新结果卡、延后/停止、未读与断线重建；不引入通用通知服务 |

原 D1/D2 迁移由其底层包维护 purpose/reviewKey 和 schema 判别；Focus 不另建同名 proposal 或复制状态机。Anchor 在用户进入或明确订阅时建立，不能每次提醒都自动写消息。

### 5.3 模型、预算和权限

D1 单相关事件批≤1 次模型决策；D2≤2 次决策+2 次只读工具，最多两轮前提分析/反馈，沿 [D1/D2 附录](docs/FINAL/AGENT_REVIEW/NEXT_PHASE_AGENT_DEEPENING_DESIGN.md)的根 reviewKey、预占、未知调用和停止约束。会话显示这些已有结果不额外生成模型复述。

同一个用户追问若可读取现有分析就直接引用，不再创建同 read-set 的分析；确需新增 Focus 合成调用则消费根协作预算，不能分别用满 turn、D1、D2 上限。后台分析必须有项目/目标、资料范围、期限与次数/费用策略；llmContextApproved 不是无限后台授权。

### 5.4 测试、真实模型/用户验收与回滚

拟 `conversationAnchor.test.ts`、`focusProactiveCollaboration.test.ts`；复用 decisionEvolution、MissionEvidenceFit、continuation/receipt 与策略预算测试。验证重复事件、相关新 revision、来源过期、条件不匹配、UNKNOWN、无关/负结果、停止主题、原任务已结束、多端曝光、回放恢复和相关局部失效。

真实模型至少冻结 16 个变化 episode：相关且可处理4、无关4、主体/阶段/条件错位4、信息不足4；每组包含用户否决、版本变化或中断。D1 漏发现也纳入分母，不能只评已弹出的卡。对照固定提醒+普通问答；消融分别去除目标关联、对象绑定、动态选择，Fit 的增益单列。

工程放行：所有投影/命令幂等、权限、停止/延后规则通过；16 个 episode 中至少 13 个发现及后续处理正确，无关组不产生新会话打扰，越权/错误执行为零。领域人员独立核对 N6 的区分力；没有可执行验证就保持未知/原计划。

另用至少 5 名目标用户各完成一个主动和一个询问旅程，记录正确完成、纠错时间、额外导航、是否理解建议与真实结果差异、打扰反馈。样本用于发现问题；如对照与质量未显示收益，缩小主题/触发范围，不发布总体效果结论。N6、真实模型调用和用户研究各按当次条件授权，不捏造评分。

噪声或重规划质量失败时关闭 D1 主动进入/自动更新策略，保留手动对话和原任务，Anchor/历史继续可读；不删除来源/旧方案或回滚已发生的现实结果。F3 最终门槛包含三场景及真实效果 Gate，不能用更多推送替代。

### 5.5 本轮实现：F3 关注与结果回流底座

已接入同主题来源修订、显式 FOLLOW、原 LATER/STOP 策略、跨端已读游标，以及原 Mission 问题/材料/成果/Action 回执的幂等投影。工作台返回时按有界轮转同步已关注会话；停止和终态主题仍可恢复丢失的历史投影。默认 `FOCUS_AGENT_FOLLOW_ENABLED=false`，不自动订阅新提醒，不新增模型复述或通用通知服务。

当前消费的是原结构化事件和回执。材料的可能相关性复用原 continuation 字段/条件核对，未将其称为 D1 语义发现。源码仍无 D1 变化理解和 D2 V2 动态候选模块；本轮实现 F3-A/B/D 的本地协作底座，F3-C、16段真实模型 episode、目标用户研究及设备冷启动验收尚未完成，因此不签收完整 F3。验证与迁移说明见 [实施记录](FOCUS_AGENT_IMPLEMENTATION_NOTES.md)。

### 5.6 2026-10-26：有界D1/D2与回答资料指引

已接入CHANGE_REVIEW/DYNAMIC_PLAN持久提案、根请求去重与预算、两轮方案/两次读取、会话内预览确认、原Runner定向执行和同讨论结果读回。KEEP_PLAN保留原计划，未知调用不自动重发，相关源按局部read-set失效。上传不会自动授权后台云分析。

双端新增回答内原资料指引、第一条问题命名讨论和失败恢复；手机端统一悬浮入口、输入区、主页面标题与桌面卡片。真实模型16案例已实际运行，共47次授权内调用（含探针、专项复查和正常Focus回答）；首轮失败保留。当前仍待独立质量评审、领域验证与5用户Gate，详见实施记录，不能只凭工程检查宣布完整F3签收。

## 6. 三个代表性端到端验收场景

各场景使用独立库中可追溯的项目、原资料、版本及实际业务服务。确定性测试可用 stub，最终模型验收必须运行实际 provider 并保留失败账本。固定文本只验证 UI，不算理解或协作通过。

### S1 用户主动询问：哪个项目现在最值得处理

准备至少8个授权项目、1个无权限项目；其中“应优先核对”的项目不在原 Focus 六个 context 候选内，同名项目至少两个。部分项目没有新任务但有重要历史风险；标明人审的合理优先集，而非强制唯一推荐文案。

1. 用户问“我最近最应该处理哪个项目？为什么？”实际 Router 扫目录、按问题深入，返回建议及来源/范围。
2. 用户说“那帮我处理这个项目当前的问题”，按前一条建议 binding 定位项目并读取原 Mission；F1 展示/打开原任务，F2 可在会话内预览接续。
3. 用户否决第一建议并切另一项目，再说“继续原来的”；系统保留已否决对象和当前焦点，必要时澄清。
4. 在另一端改任务版本、撤销其中一个项目权限，再从旧会话提交；旧提案失效或受限内容隐藏。冷启动恢复会话并重复提交同 requestId。

通过证据：目录/路由 manifest、合成项目金标、实际来源 revision、会话 seq 与 bindings、双端读取记录；F2 还包含原 Mission 命令回执和相同对象 readback。回答优先级属于建议，任务推进另查原 ID/状态。

### S2 Agent 主动发现：新实验记录可能改变旧决定

准备一个部署目标与现有活动 Mission、旧决定及来源；新设备/新阶段记录可能相关。成对提供无关资料、他人训练值、条件一致的负结果和缺条件记录，不让拼接材料凑出充分性。

1. 上传真实格式的 fixture，经原 Capture/附件管线保存；D1 对授权变化批产生候选，原硬 Impact 路径仍独立处理。
2. 焦点提示“有一项值得核对的变化”；用户追问“为什么”“查已有记录”，Anchor 保留 trigger、项目、Mission、证据。
3. E 核对适用条件；D2 比较读旧记录、问条件、必要小验证和 KEEP_PLAN；用户拒绝第一项并选冻结的第二项。
4. 经原提案批准，继续同 Mission 或必要 Action。结果返回同会话和项目 readback；重复事件、同结果通知不重复消息或效果。
5. 用户延后/停止后重放事件；来源 revision 改变再确认；离开/重进/换端，均保留正确策略和历史决定。

通过证据：原上传对象/hash、D1 rootReviewKey 与候选、E 条件差异、D2 proposal/candidate/hash、真实工具/批准/效果及投影游标。无关不打扰，错位不支持，信息不足为 UNKNOWN；负结果可适用并改变决定。建议“做测试”与用户提供测试结果是两条事实。

### S3 真正协作：比赛项目还缺什么，怎么推进

准备一个比赛项目的要求、进展、证据、已有两条不同目标 Mission 和待办；另一个同名项目不能混入。材料包含缺失的设备验收和未核实的模型效果，避免以构建成功替代比赛可交付。

1. 用户在焦点说“帮我看看这个比赛项目还缺什么，再整理一个能完成的推进方案”。Agent 确认指向、读取要求/进展/原任务/证据，以可核查缺口组织候选。
2. 用户说“先做第一项”；映射冻结选项，说明它继续哪条原 Mission，或为何需新 Action。用户补充“不联网，不改部署”，持久保存限制。
3. 批准后调用原服务，Runner 实际执行许可内调查。需设备/现实操作时等待用户，不自动标 DONE。
4. 用户说“验证完成了，结果是……”；先核对绑定 Action 和结果文本，再确认写回 resultCardId。原项目与同会话展示同一回执。
5. 用户中途切另一项目/否决方案，原目标版本变化后旧确认失败；断网重试和另一设备再次确认仅回同效果。

通过证据：要求来源、局部 read-set、计划与否决、目标/成功条件版本、原批准和 Runner steps、Action/resultCardId/Output revision、两端读取。区分“模型计划”“工程步骤完成”“用户自述结果”“独立效果证据”。

### 所有场景的交叉断言

| 边界 | S1/S2/S3 都必须注入的变体 | 检查 |
| --- | --- | --- |
| 权限 | 他人项目、Mission 私有、过程撤权 | 模型出站/历史/摘要/结果无泄漏；写入拒绝 |
| 多轮指代 | “这个”“第一个”“原来的”，两个合理候选 | 唯一绑定正确；歧义澄清，不重新猜写入 |
| 上下文切换 | 换项目/换设备/旧响应晚到 | focus CAS、generation、范围显示一致 |
| 来源追溯 | 原文变化/归档/部分读取/条件错位 | 有 qualified refs、revision/范围；旧正文留历史 |
| 用户否决 | 禁止联网、不选方案、延后/停止主题 | 后续 turn/压缩/事件重放继续生效 |
| 版本变化 | 相关源/目标/批准变，另测无关资料变 | 前者拒绝并重预览；后者不无故失效 |
| 中断恢复 | 已发模型未回、效果已提交投影未回 | UNKNOWN/原回执恢复；不盲重发/重做 |
| 重复请求 | 同 request、不同 request 同提案、篡改载荷 | 原 effect ID；零重复；换载荷冲突 |
| 结果语义 | 建行动/执行工具/保存成果/现实结果 | 各状态独立，模拟数据不进入真实效果 |

## 7. 与已有路线的融合与领取顺序

| 原能力 | 当前状态与责任 | Focus 如何消费 | 依赖 |
| --- | --- | --- | --- |
| A 资料接回原任务 | P1-A 当前已有实现；继续维护原导航、candidates、readback | 会话打开原 question、接续表单和材料使用位置 | F2 直接接，不重写 |
| E Evidence Fit | E0 窄域工程切口已做，默认关闭；效果/领域 Gate 未闭 | 对话呈现核对条件和 UNKNOWN，不把它当主要产品故事 | F1 不阻塞；F2 按原能力开关，F3 处理适用性 |
| D1 目标变化理解 | 当前设计，原附录定义候选、purpose、局部版本和策略 | Focus 的主动发现入口与追问起点 | 可与 F1/F2 底层开发并行；F3 采用前过质量 Gate |
| D2 动态选择/有界重规划 | 当前设计，保留原 Mission 与 KEEP_PLAN | 会话中的项目特定方案、调查、反馈与计划修订 | F2 先固定方案；F3 接 V2 动态提案 |
| N6 最小验证 | 条件性 D2 候选，需领域区分力/现实执行 | 原 Output 草案→用户批准 Action→实际结果→同会话修订 | 不阻塞 F1/F2，也不强制每次未知做实验 |

建议代码领取顺序：F1-A 单纵向 → F1 边界补齐与真实验收 → F2-A/B/C 原 Mission 接续 → F2-D/E 结果回流 → F3 Anchor + D1 → D2/N6 反馈闭环。D1/D2 的服务深化可独立推进，但接口需共同采用 qualified ref、proposal purpose/candidate、局部版本和预算合同。

实施记录已建立于 [FOCUS_AGENT_IMPLEMENTATION_NOTES.md](FOCUS_AGENT_IMPLEMENTATION_NOTES.md)，保存实际 diff、命令结果、模型/设备证据和 Deviations。当前未改变 A/E/D1/D2 判断逻辑；只为原 Mission 命令提取同事务入口。

## 8. 验证命令与证据交接

当前已执行：

```powershell
npm.cmd test -- tests/copilotPersistence.test.ts tests/copilotContinuation.test.ts tests/projectAgentContext.test.ts tests/globalFocusPresentation.test.ts
```

结果：4 文件、47 项通过；各写入测试在导入 db 前建立独立临时库并重放迁移，不读取开发数据库。文档本轮另外核对链接、代码路径、差异和既存修改保护；不因写文档重跑全量构建。

后续实现按受影响范围先测新增契约，再完成跨端/迁移全套检查。仓库现命令为：

```powershell
npm.cmd test
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run harmony:test
npm.cmd run harmony:build
```

这些是未来实现放行命令，本轮未全量执行。测试关闭文件并行，保留 `scripts/e2e-env.ts`、`setup-e2e.ts`、`run-e2e.ts` 的隔离和 Windows 进程清理。迁移另在空库与旧库副本验证，不调用 db:setup 修已有环境。

每个模型/端到端运行使用新证据目录 `evidence/focus-agent/<phase>/<run-id>/`，包含 commit/dirty diff、fixture/金标 hash、provider/model、策略/协议版本、项目/来源/会话/原对象 IDs、调用/usage/未知费用、全部失败与重试、原业务回执及双端截图。合成输入、真实项目、mock、真实模型分别标识；公开包脱敏。

评测预先冻结合理答案/下一步集合及边界，两人独立审阅模型质量；有分歧先保留，不让同一个生成模型给自己打通过。沿用原 C/D 评测的已验证部分，再单列全局路由、连续指代和协作闭环增量。真实改善要比较正确完成和纠错总成本，不能只报少点击或更高回答长度。

## 9. 暂缓、停止与实施前检查

| 暂缓内容 | 理由与重启条件 |
| --- | --- |
| 多 Agent/通用 Planner/新 Runtime | 原 Runner 已能管理长期执行；只有出现单 Runtime 无法表达的已验证需求再议 |
| 所有聊天自动入知识库 | 会把试探、否决和模型草案污染成事实；先保留私有会话，用户保存/原结果链入项目 |
| 全 workspace 后台持续扫描 | 权限、费用、噪声和召回分母尚未验证；先目标/主题范围策略 |
| 任意跨项目外部代执行/代码写入 | 超出现有只读与受控 Action 合同；另需业务授权及对端效果设计 |
| 新向量数据库/知识图谱/事件总线 | 当前目录分页、原检索/关系、原 Worker 可支撑切片；性能数据证明瓶颈后再选型 |
| 首版 token 流式渲染与复杂消息编辑分支 | 不决定理解/原任务闭环；先可恢复持久消息，再加展示流，不能流出撤权或未核验结论 |
| N6 作为默认解决方案 | 未知可通过读/问/保持解决；测试无区分力时不增加现实负担 |

执行前重新核实 HEAD、dirty、有效实施记录和是否另有 D1/D2 修改；相关接口变化先适配当前源码。若出现“旧聊天归属无法证明”“旧客户端读取 nullable 行不安全”“费用归属绕过额度”“跨层事务无法保证一次消费”，先完成该阻断的保守修复并记录，不能用虚拟项目、客户端禁按钮或临时文本猜测绕过。

本轮决定已足够领取 F1-A。模型额度、设备和生产环境仅约束各自验收；继续可完成的本地实现和隔离验证，达到相应 Gate 后再如实签收。
