# R4 Agent Experience 实施记录

## 2026-10-27 PR-5 · 专责 Prompt、原结果与决策接续

从 `36bb1a0` 继续。D1/D2、Mission、Capture、Artifact、旧 Copilot 已接专责版本化策略；默认请求将可信策略放 system、资料放独立数据消息，复用原 Provider、额度、事务和历史。Mission 保留原 JSON/native tool 协议及原有一次格式修复窗口，没有增加另一套 Runner。调用审计记录 Prompt 版本、用量、未知和失败。

### 实际能力

- D1 输入原目标、成功条件、当前计划和有界 Goal State：最近 8 项非模拟原行动、4 版本人 Mission 输出。原结果有 resultCardId 与 REPORTED 标识，不把 DONE 当目标核验。结果或输出改变时，旧复核、方案及已采用的读取保护失效；旧记录没有新字段仍可读。
- 原行动完成回执进入资料选择与实际读取，沿原确认保存复盘，再在同一 Conversation 重评。D1 change 与 D2 comparison 投影在聊天里，绑定原 Review/hash/候选；选择只预览，确认仍由原 Mission 原子执行，重试复用原效果。修复了旧操作读回截掉后续消息的问题。
- Web/ArkTS 显示目标原句、依据、未知、预期观察、结果分支和停止条件；反馈、选料与否决按原会话/业务身份保存。相同后果的验证分支不能显示成可执行。
- Capture 2.0.0/2.0.1 的实模仍偶发将背景条件归给用户原话，因此 2.0.2 从调用契约上只传本条 rawText；背景用于后续项目推理。原 Capture、旧卡片 Schema 与历史不变。
- Artifact 提供最多 24 张卡片及有界原文/附件片段，记录覆盖与来源修订。选旧检查点时只用当时冻结的标题/摘要，不混入后来卡片、关键词或原文。模型成果保持 UNMAPPED_MODEL，未将其宣称为逐句核验。
- 旧 Copilot 保留原 API、项目来源校验、私有对话范围和写操作确认，换用自己的表达策略；测试验证跨项目私聊不进入旧项目问答，旧消息不改写。

### 真实模型开发对照

本轮授权封顶 48 次，目前 **44 次**，与后续 PR-6 共用同一账本，未重置。三领域冻结输入、旧策略源码及原响应见本轮证据。前 36 次为六任务 × 三领域 × 旧/新策略；另有 4 次原结果重评与 4 次 Capture 归属复查。

| 项目 | 实际结果 |
|---|---|
| 输出结构 | 旧组 14/18、新组 17/18 符合 Schema；旧组 3 次 Copilot priority 类型错误、1 次 D2 接收中断；新组 1 次课程 Mission 多段 JSON 拒绝。这里只统计协议，不作为任务质量分数。 |
| 原结果反馈 | 科研 52ms 用户报告选择 KEEP_PLAN，未升格独立核验；竞赛安装成功但离线失败，ATTEND 后生成有差异的 D2；课程保留缺 B 输出/种子的未知，决策为 KEEP_PLAN，与冻结预期 UNKNOWN 不同，保留该差异。三例各有一个原 Action 和同一完成回执，重复完成不新增卡片。 |
| Capture | 2.0.1 两次复查仍有背景归属混入；改为只传原文的 2.0.2 后，科研/课程两次输出均不再加入原文没有的设备 X、双线程或 S2。没有删除前面的失败。 |

这不是独立留出集或人工逐句评分；仍需核对 Artifact 无依据断言、D2 候选效用、Mission 失败恢复与用户决策成本。参考 [Vercel AI SDK 角色/工具消息](https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx) 与 [LangGraph 审批/反馈接续](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/agents/human-in-the-loop.md)，未引入外部 Runtime 或依赖。

### 验证与下一包

全量 **121 文件、1095 项测试通过**；随后新增检查点冻结与最后 Capture 收窄的定向 3 文件 27 项通过。类型、lint、Web 生产构建及 **23 项 E2E、0 跳过**通过，包含桌面/390 的真实 D1/D2 比较与原预览。鸿蒙 **86 项测试与 HAP 构建通过**。首次类型检查与 E2E 的 Prisma 生成重叠，生成文件暂缺；生成结束后串行重跑通过。原始失败日志保留。

当前用户原有四项未提交修改逐字节保留；没有迁移真实库、推送或部署 ECS。原生新增控件的实际模拟器复查与 PR-6 合并进行，构建不算设备验收。下一包继续主动事件筛选、已有授权的仓库/实验/公开研究观察与部署验收准备。

## 2026-10-26 PR-4 · 鸿蒙原生语义回答与稳定草稿

ArkTS 原生渲染十种共享语义块：有限富文本、目标差距、依据、调查、问题、方案比较、确认、回执、变化和时间线。沿用纸白/墨绿资源、可展开依据与原文件指引，约 16fp 正文和至少 44vp 操作目标；未知顶层协议退回原正文，未知块显示可读 fallback。原 comparison/D1/D2 的完整业务接入仍在 PR-5。

快速/标准/深入选项、真实进展轮询和停止接入同一 Conversation API；最长深入调用使用有界超时。操作只提交原 bindingId/messageId/版本和幂等键，确认后读回原 Action，仍由原服务校验。原任务面板按业务身份保持；问题、选项、答复、时间输入及主输入保存到当前用户私有 Preferences，64 份有界草稿，换用户/退出/会话失效清除。源版本改变保留内容并要求先核对。

实际模拟器验收发现两处缺陷并修复：退出时必须先同步清空内存凭据再等待草稿清理；ArkUI Builder 按值传入消息导致确认成功后还显示待确认，改为官方的单对象引用参数和可更新属性，保留稳定 message/block 身份。参照 [官方 Builder 状态传递](https://github.com/openharmony/docs/blob/master/en/application-dev/ui/state-management/arkts-builder.md)，没有用会话版本重建整段表单。

放大字验收还发现应用原来没有开启系统字体跟随。依照 [官方应用配置](https://github.com/openharmony/docs/blob/master/en/application-dev/quick-start/app-configuration-file.md) 增加 followSystem，当前上限 1.3；正文和操作随系统放大，布局仍使用原响应式资源。

### 验收与交付范围

鸿蒙 **86/86 测试通过**，最终原配置的 HAP 主编译通过；开发地址签名 HAP 已覆盖安装到用户打开的模拟器。模拟器连接专用临时 SQLite 与本机 4400 后端：真实模型的三领域历史来自 PR-3 合成库副本，额外 UI 数据明确为 HTTP stub，手机验收新增模型调用 0。个人数据库和签名配置未提交。

已实际操作：确认原位转回执、查看原行动、结果草稿关闭重开/新消息到达/页面返回、合法资料变化调查入口、系统深色模式与放大字。首次陈旧 UI 和截图工具未覆盖旧文件的原记录保留，最终有效截图另命名。键盘弹出、全套读屏、所有十种块的目标真机交互和生产 ECS 尚未签收。详情见 [PR-4 验收回执](evidence/r4-agent-experience/20261026-pr3-pr4/pr4-validation.json)。

下一步 PR-5：D1/D2、Mission、Capture、Artifact、旧 Copilot 的专责 Prompt 与对应真实业务覆盖；随后 PR-6 做独立留出集、用户决策成本和目标设备/生产验收。

## 2026-10-26 PR-3 · 原业务闭环与资料变化入口

从 PR-2 `5b45b24` 继续。沿用原 Conversation、Anchor、MissionEvent、execution 和 Action，不增加执行状态表或迁移。合法 SOURCE_ARRIVED 经原等待资料筛选后生成 change 块，绑定原事件、目标原句、来源修订和私有会话。读回重新检查归属、权限、目标及来源版本；修订后保留历史正文，撤掉陈旧交互。提醒与读回不调用模型，点击调查只带入原消息，发送仍需用户操作；原延后、停止关注和去重继续生效。

原 Action 的完成状态、resultText、resultCardId 作为结构化原对象供同会话重评，明确是用户报告。模型调查 Prompt 1.0.1 合并同项目的多个条件，保留重复项目拒绝规则。可信评测入口增加 C1（仅 Prompt）与 C2（动态读取、无 GoalGap/UI）；HTTP 输入不能选择或伪造消融模式。

### 本轮真实模型结果

DeepSeek / deepseek-flash，冻结三条新合成开发输入，独立临时 SQLite，**48/48 次实际 HTTP**。原响应、哈希、调用序号、失败和效果保存在 [本轮实模证据](evidence/r4-agent-experience/20261026-pr3-pr4/real-model/summary.json)。这是开发闭环，不是独立质量评分。

| 领域 | 本轮结果 |
|---|---|
| 科研 | C0 类型错误保留；C1 只有摘要而未知，C2 读到 78ms 原文。C3 确认创建一个原 Action，重复请求读回同效果；完成报告 52ms 后同会话重评，稳定性仍未知，结果保持 REPORTED。 |
| 竞赛 | 首先澄清同版本安装条件；显式补充后遇到重复 projectId 协议错误，安全降级。Prompt 修订后用新的显式问题继续，确认一个 Action、幂等回放并保存结果；重评区分安装成功的报告和仍缺本地模型的离线阻塞。最后 UI 规划在 HTTP 前触及本轮额度，保留已知回答。 |
| 课程 | 读到 A/B 数据划分不一致，确认一个原 Action；完成报告后仍缺 B 的原始输出和随机种子，保持 UNKNOWN，不声称可比或已核验。 |

三条 C3 都有真实服务的完成回执和反馈；C1/C2 只在科研做了配对。首轮评测脚本的创建请求编号重用在下一领域调用前失败，已修为 caseId/group，原失败日志保留。没有自动追加修复模型调用。正式三领域 C0–C3 留出集、独立人工评分和用户决策成本仍待后续验收。

### 验证

全量单元/集成 **120 文件 1086 项通过**；类型、lint、Web 生产构建及 **22 项 E2E 全部通过、0 跳过**。新增测试覆盖真实事件绑定、停止关注、去重、来源修订、旧交互拒绝与可信消融边界；Web 旅程实际点击变化进入同会话调查。首次 E2E 构建被本机开发目录的损坏生成类型阻塞，保留失败日志后移除该生成文件、恢复原配置重跑通过。完整命令日志见本轮证据目录。

下一包 PR-4 接原生 ArkTS 语义 UI；D1/D2、Capture、Artifact 与旧 Copilot 的专责 Prompt 仍按 PR-5 推进。

## 2026-10-26 PR-2 · 可操作回答与原业务回执

基线 PR-1 `9dbc01f`。模型在原 turn 内生成 UI Plan，选择内容、顺序和强调；服务端按当前授权、来源版本和原 execution 建立 catalog，再生成 Web DTO。十种受限原生块支持文字/表格、证据、目标差距、调查、比较、问题、变化、审批、回执与时间线。实际新业务 catalog 已接目标/证据/调查/澄清/创建行动及其回执；D1/D2 继续使用原 WorkCard，新 comparison/change/timeline 的原业务投影由后续批次接入。

提案冻结与 PARTIAL AgentRun 同事务，UI 模型调用在事务外；未发布的提案不能通过原 API 执行。确认由当前 messageId/bindingId/version 解析回原服务，同时检查 hash、15 分钟期限、完整源版本和会话版本。重试原请求产生一个效果。审批位置在读回时替换为原 Action 状态，已创建、进行中、已保存结果与独立核验分开；刷新不调用模型。

新语义 UI 无效或网络未知时，保留已知回答与原提案，返回受控展示并留下失败审计；未知模型费用继续预占。已知坏结构不自动修复调用。根 turn 可停止，已发出的 HTTP 等待返回后收尾，不再读资料、发起模型或发布提案；未发布 execution 标记 DECLINED。

Web 按原应用纸白/墨绿配色排版，复杂依据可展开，确认后将回执滚动到视口。WorkCard 去除消息条数 key；主输入、问题、方案选择和任务答复按稳定身份保存于 sessionStorage，换用户/退出/401 清理。新消息和关闭重开保留草稿；任务版本变化先核对再预览。从焦点选另一任务时，新对象的项目优先于旧会话焦点，修复了回归中发现的错项目发送。

本机 `.env` 已新增 `FOCUS_AGENT_ENABLED=true`、`FOCUS_AGENT_R4_ENABLED=true`，原文件备份在系统临时目录；仓库示例默认关闭。ECS 文档统一四个开关与 capabilities、回退和客户端差异，本轮未推送或部署。ArkTS 补可选 capability/确认版本/CANCELLED 兼容；原生语义 UI 在 PR-4。

### 真实模型开发对照

同 provider/model（DeepSeek / deepseek-flash）、同三领域合成输入，先 C0 后 C3。共 **24 次实际 HTTP，额度上限 24**；原响应、哈希、用量和失败见 `evidence/r4-agent-experience/20261026-pr1-pr2/pr2-model-*.json`。不是留出集或独立评分。

| 领域 | C0 / C3 调用 | 可检查增量 | 未通过项 |
|---|---|---|---|
| 科研 | 2 / 6 | 原来只知摘要缺条件；调查实际读取 6.8GB 原文，指出超过 6GB | 合法模型 UI；未生成行动提案 |
| 竞赛 | 2 / 6 | 实际读取设备验收 TODO 与缺安装回执 | UI JSON 未闭合，安全降级；未生成提案 |
| 课程 | 2 / 6 | 实际读取 s1/s2 划分不同，指出无法同条件比较 | 第 24 次已完成回答；UI HTTP 前触及全局评测上限，降级；未生成提案 |

这轮说明原文调查能补足判断，也暴露处理请求被路由成只回答、UI 组合超出 catalog 以及输出结构稳定性问题。随后 Route 版本升至 2.0.1，明确处理请求可生成待确认提案；UI Plan 升至 1.0.1，约束非 prose 逐项引用 catalog，不拼接或创造问题控件。修订只做本地协议与回归验证，没有追加付费调用。C1/C2、独立质量、真实模型操作闭环和主动事件/重评仍在 PR-3；不能以本轮 stub 的 Action 效果替代它们。

### 验证

全量单元/集成 120 文件、1082 项通过；鸿蒙 83 项和 HAP 构建通过。三领域隔离服务测试覆盖真原文读取、下一步变化、来源修订/撤权、私有 Mission、预算竞争、停止、期限、未发布提案、伪造绑定和重复确认；客户端覆盖受限富文本、未知协议版本、任务版本冲突、关闭重开及换用户草稿。

Web 定向 10 项通过；最终重建专用库后完整 22 项通过、0 跳过，生产构建、类型与 lint 通过。覆盖桌面/360/390/430、125% 文字、暗色、键盘聚焦、草稿、新消息、确认创建和原回执刷新。首轮对象定位、旧断言和专用 API 测试认证问题已修正；复用测试库造成的演示提醒状态干扰另留原日志。命令/退出码/截图见 `evidence/r4-agent-experience/20261026-pr1-pr2/pr2-validation.json`。构建保留既有 NFT tracing 警告；设备安装、生产、独立产品质量尚未签收。

## 2026-10-26 PR-1 · 动态调查与 GoalGap 接入

基线 0941f7ae。原 Provider 兼容角色消息数组，ROUTE/INVESTIGATE（含 Goal v1）/ANSWER 分责；每次调查观察后重新选择工具、询问或结束。GoalGap 的 nextInformationNeed 必须与下一读取绑定；来源条件适用、反证与报告语义分别保存，模型不得自行授予 VERIFIED。

使用现有 ConversationTurn.readManifestJson 持久化预算、真实步骤、目标判断与读集，无新增迁移。callId 唯一预占、同 purpose 可多步；账号额度与根预算同事务检查，未知费用继续预占。审计保留 Prompt/Schema 版本、真实 provider、request/usage/finishReason 和有界哈希。超时、已收到坏输出和引用失败分别恢复；已知坏协议不追加修复调用，改为真实项目状态；网络 UNKNOWN 保留原请求。

四个只读工具在 workspace user/project 上适配现有读取服务，searchMissionMemory 的读上下文缩窄为真实 user/project，不再伪造 missionId。定位的原记录/附件指针、正文、原行动、原 Mission owner、项目权限和全部已读版本在出站/返回/提交时检查。重复工具提前 NO_GAIN；没有增量、预算耗尽、用户问题或既有任务移交均可停止。进度只从持久步骤投影，不暴露模型原文。

Quick/Standard/Deep 的初始根上限分别为 5/9/12 次模型、1/5/8 次动态读；深度须显式选择。额外 ANSWER/UI_PLAN 预算预留在同一个根内。当前按 UTF-8 消息封装上界预占，实际 usage 替换已知值。数字是待实模与体验校准的版本化初值，不作为智能能力上限。

开关 `FOCUS_AGENT_R4_ENABLED` 默认关闭，原 Focus/C0 路径保留；PR-2 联合完成本机启用与发布说明。数据和 API 兼容，鸿蒙新增可选模式/真实进度 DTO；实际原生块渲染在 PR-4。

隔离服务验证：科研/竞赛/课程的新原文实际被工具读取，下一次模型选择改变为 ANSWER_NOW；冻结 Action 经原确认服务产生一个效果。新调查 10 项通过；上一轮原会话/契约合并 73 项通过，其中新增前的调查 8 项，与最终 10 项重叠不累加。类型、lint、HAP 主编译通过；原课程 fixture 的 scenario 枚举错误已纠正，首轮失败保留。真实模型调用仍为 0；质量消融与设备/生产签收未执行。

实现入口：`promptSpecs.ts`、`investigationService.ts`、`toolAdapter.ts`、原 `turnService.ts`、`cloudQuota.ts`、`llmAgent.ts`；测试 `r4Investigation.test.ts`。定向参考 [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control) 的逐步工具选择/停止及 [LangGraph.js](https://github.com/langchain-ai/langgraphjs) 的 durable/interrupt 语义（2026-10-26 核查 3377 stars、MIT、近期更新），不引入第二个 Runtime 或依赖。

下一步持续执行 PR-2：模型 UI Plan → 当前授权 catalog → 原操作绑定 → Web 原生语义块，稳定草稿与同会话状态回读。

## 2026-10-26 PR-0 · 共用契约与纵向 fixtures

源码基线 `c8c7072d01598de6d7315697bd505d84e33cd8f6`；用户授权「开始 pr 0」。范围是合同冻结、纯校验、三领域 fixture 与对应测试。本批不改变现有 Provider/Runner、不运行模型、不迁移库或部署。首包产品仍需 PR-1/2/3/4 联合落地。

### 已覆盖 / 缺口 / 冲突

| 现状 | 代码定位 | 本批处理 |
|---|---|---|
| 原 Conversation/Binding/提案/原效果/回执已有 | `lib/conversation/` | 沿用原对象链，不新建执行状态库 |
| 普通 turn 固定两次、单 user、advice 主体 | `turnService.ts` / `model.ts` / `llmAgent.ts` | 冻结替换接口，PR-1 接入，不把接口当能力完成 |
| 原计费 purpose 只有 ROUTE/ANSWER | `tokenBudget.ts` / `cloudQuota.ts` | 新 callId/完整消息/根预算合同兼容旧账本，PR-1 迁调用 |
| 原消息 schemaVersion=1 | Web/ArkTS Conversation 模型 | 添加可选 presentation；原字段保留 |
| WorkCard key 带消息条数 | `ConversationPanel.tsx` | 登记 PR-2 草稿修复与实际浏览器验收 |
| v1.2 要求模型选布局、服务端可信绑定 | 本地基线 §12B | 分离 Plan v2 与 hydrated v1；保留模型顺序/强调 |

### 本批源码

- `lib/types/agentExperience.ts`：GoalGap、EvidenceLink、动态读取/停止、调查步骤与预算、受限文本 AST、PresentationPlan、HydratedBlock、AllowedAction。
- `lib/agent/promptSpec.ts`：PromptSpec/ModelMessage、角色与 Provider 能力校验、完整消息上界、已知/未知用量计算。
- `lib/conversation/experienceContract.ts`：纯 server snapshot 校验与 hydration；范围/私有 owner/版本/证据/候选/审批/回执负例。authority 是调用方新建的可信快照，PR-1/2 仍须实现实际读前读后鉴权及 CAS。
- `tests/fixtures/r4/experience-v1.json`：科研、竞赛、课程不同初始与新观察场景，共享 Plan、权威对象与预期业务状态。标记 SYNTHETIC，无模型、无业务执行。
- ArkTS `AgentExperience.ets` 与可选 Conversation presentation；编译级可赋值与字段集合检查防止所需字段脱节，虚拟删除原版本字段会让检查失败。实际渲染属于 PR-4。

### 设计参照

2026-10-26 定向核查 [Vercel AI SDK UIMessage](https://github.com/vercel/ai/blob/main/packages/ai/src/ui/ui-messages.ts)（27524 stars，Apache-2.0，近期更新）与 [assistant-ui 消息分块](https://www.assistant-ui.com/docs/primitives/message)（仓库 12762 stars，MIT，近期更新）。前者区分消息/parts/metadata；后者按内容部分及稳定身份呈现，并把工具审批绑定原调用。借鉴可序列化语义、稳定身份和批准边界；不引入它们的 Runtime，不复制 UI 或增加依赖。

### 验证与下一包

验证回执见 `evidence/r4-agent-experience/20261026-pr0/validation.json`，首轮失败与最终记录分别保留。真实模型调用 0。原有五个 tracked dirty 文件逐字节核对，未纳入本批。

最终定向 3 文件 68 项通过，其中新契约 43 项，其余为原会话/Anchor 合同回归；类型、lint 无错误或警告，鸿蒙原单测 83 项通过。最后字段更新由最终 HAP 主编译及共享/ArkTS 类型检查覆盖。未运行 Web E2E/生产构建：本批未切换原渲染或 turn 路径。

验收前补充完整 readSet 重校，禁止省略引用绕过撤权/修订；EvidenceLink 将具体 claim 的支持/反证/未定与适用性分开，直接适用的反证不能核验成功。富文本保留完整原生可读 fallback。首轮虚拟编译路径错误和一次未使用 import 警告已修复；原失败日志保留。

下一包 PR-1：接角色消息与原额度事务、workspace actor 只读适配器、durable 动态调查和 GoalGap；以本批三领域 fixture 及负例驱动。PR-2/4 同 DTO 接真实模型 UI Plan、Web/ArkTS renderer 与草稿；PR-3 首条真实事件与原业务闭环。
