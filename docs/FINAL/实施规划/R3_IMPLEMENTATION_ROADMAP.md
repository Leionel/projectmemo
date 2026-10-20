# R3 决赛升级实施路线图

日期：2026-10-20。负责人视角；实施契约见 [R3_PHASE_SPECS.md](R3_PHASE_SPECS.md)。

## 1. 推荐决策

建设一个**单项目、单执行者、有持久进度的 Mission Agent**：模型根据观察结果选择工具，服务端负责权限、预算、版本、确认和结果验收。继续使用 Next.js、TypeScript、Prisma 和 SQLite；先不引入 Agent 框架、队列平台或新的向量数据库。

产品定位采用 **Evidence-grounded Personal Project Agent**。“Personal”首先表示用户拥有自己的委托、约束、来源和执行历史；决赛最小版本不依赖跨项目画像。

第一条完整能力是：读取项目当前方案 → 检索相关记忆 → 搜索并读取公开资料 → 区分公开参考与项目实测 → 必要时追问 → 保存有来源的比较草稿 → 请求批准一项验证行动 → 创建并读回该行动 → 中断后继续同一 Mission。

这条链必须由模型选择工具，顺序随任务和工具结果变化。固定脚本只用于确定性测试，不充当自主执行证据。

### 1.1 与总体方案的取舍

完整阅读了 [2026-10-20 总体方案](../总体方案/ProjectMemo_Personal_Project_Agent_决赛升级总体方案_2026-10-20.md) 的 0–21 节及附录。保留其 Mission 主线，调整以下决策：

| 总体方案中的方向 | 本路线图的决定 | 理由 |
|---|---|---|
| 先 Runtime，再 Context，最后 Verifier | 第一条链就包含最小 Context、确认、验收和恢复；后续增强语义核验 | 否则第一阶段产出无法安全演示，后接确认会返工 |
| Worker 在长任务或主动功能中引入 | Worker 属于 R3.1；周期性主动触发另列 Stretch | 鸿蒙请求读取超时 30 秒，执行不能依赖页面或请求进程存活 |
| Mission 可支持多个项目、可无项目 | 首版必须绑定一个 projectId 和一个 ownerUserId | 当前领域服务按项目组织，多项目授权不是免费能力 |
| 4–6 个现有工具加多种扩展 | 最小版限定 7 个模型工具、1 个由服务端调度的批准提交器 | 降低选择歧义和事务改造范围 |
| 预览排程、完成行动等同时工具化 | 最小写入仅创建 Action；不让 Agent 自行报告现实实验已完成 | 先证明一条副作用链可靠，而非全面自动化业务 |
| 单独购买搜索服务作为优先路径 | 先验证现有 DeepSeek 的原生工具协议与 Search/Fetch；搜索 Provider 与模型 Adapter 仍分离 | 当前官方接口已有相关能力，是否可用需真实账号联调，不能由兼容接口名称推断 |
| 四组完整消融为 MVP 必交 | 最小版两组同模型对照；Target 增加离线消融 | 控制评测开发和调用预算；授权门从不在真实写入实验中移除 |
| 17 份左右的设计/状态材料 | 本轮两份文档，后续按工作包追加事实记录 | 把有限时间用于可运行链路；本轮不创建额外文件 |

## 2. 审计基线与证据口径

工作目录 `D:\Projects\hongmen`，分支 `master`，HEAD `723c832ba2d433c84847448f84e8761fd9546be7`，最近提交日期 2026-09-29。当前工作树有 16 个已跟踪文件修改，以及 `.workbuddy/`、`evidence/final-feature-20261015/` 等未跟踪内容；未创建分支、提交或覆盖修改。

审计以本地源码为准，覆盖 Agent、Memory、Context、Execution、Reliability、Integration、Infrastructure 和客户端入口。本文的“存在/缺失/部分”是代码审计结论；本轮未运行测试、模型、迁移、服务或设备，也未读取真实密钥。10 月 15 日回执只作为历史记录。规划结束时核对两份新文件和既有工作树差异范围。

### 2.1 能力与源码映射

状态：**复用**＝已有适配价值；**整合**＝已有但不满足 Mission 边界；**未验收**＝存在实现、运行效果须另证；**新增**＝当前实现中未找到该能力；**调整**＝存在影响本轮的设计缺口。

| 层 | 当前事实与直接证据 | 分类 | R3 处理 |
|---|---|---|---|
| 模型调用 | [llmAgent.ts](../../../lib/agent/llmAgent.ts) `chatWithLLMWithMeta` 只发送单条 user message、读 content；无 tool_calls、tool role、usage 归一化 | 整合/调整 | 新增独立 Mission Model Adapter，不破坏 Capture 等旧调用 |
| Copilot | [copilotService.ts](../../../lib/services/copilotService.ts) `answerProjectQuestion` 一次 `chatJsonWithMeta`；`executeCopilotTool` 只支持 create_action/generate_artifact | 整合 | 保留快速问答，显式“创建委托”进入新 Runtime；首版不自动路由所有聊天 |
| 运行记录 | [schema.prisma](../../../prisma/schema.prisma) `AgentRun`、`AgentMessage`；[agent.ts](../../../lib/repositories/agent.ts) `saveAgentRun` | 复用/新增 | AgentRun 作步骤调用审计；新增 Mission/Step/Event/Approval，不能用 trace JSON 当任务状态机 |
| 多轮消息 | `AgentMessage` 没有 user/thread/mission 归属；`listAgentMessages` 按 createdAt 升序 take 20，取得最早消息；Prompt 不传历史 | 调整 | Mission 事件流隔离近期对话；旧聊天不自动归入个人私密记忆 |
| 时态记忆 | [temporalLedger.ts](../../../lib/memory/temporalLedger.ts) `evaluateTemporalCard`；[temporalLedgerService.ts](../../../lib/services/temporalLedgerService.ts) `getTemporalSearchStates` | 复用 | 保留当前、取代、争议、未知，不用 Mission 摘要覆盖项目事实 |
| 检索/嵌入 | [hybridSearch.ts](../../../lib/memory/hybridSearch.ts) `searchProjectCards` 全项目扫描；查询可调用 `ensureCardEmbedding`；[embedding.ts](../../../lib/memory/embedding.ts) 有远程与确定性回退 | 复用/调整 | 小规模先复用；任务检索禁止查询时无界补嵌入，记录截断和回退；不换向量库 |
| 阶段记忆 | [projectEpisodeService.ts](../../../lib/services/projectEpisodeService.ts) 预览/发布/来源失效；[memoryConsolidationService.ts](../../../lib/services/memoryConsolidationService.ts) 归并和撤销 | 复用 | 是长期项目记忆，不是执行 checkpoint；读取 Episode 可能回写失效状态 |
| 当前上下文 | [projectStateService.ts](../../../lib/services/projectStateService.ts)、[projectReentryService.ts](../../../lib/services/projectReentryService.ts)、[projectHealthService.ts](../../../lib/services/projectHealthService.ts) `buildProjectHealthReport(projectId,{userId})` | 复用/调整 | 工具使用结构化状态和真实 viewer；不把缓存摘要当最新事实 |
| 捕获与输入 | [captureService.ts](../../../lib/services/captureService.ts) `processCaptureWithRequest` 已有持久请求键、事务回执与后处理状态 | 复用 | 复用模式和保存逻辑；不直接开放任意记忆写入工具 |
| 行动/执行 | [actionService.ts](../../../lib/services/actionService.ts) `completeProjectAction` 原子保留结果卡；[actionFeasibilityService.ts](../../../lib/services/actionFeasibilityService.ts) 依赖评估 | 复用 | 创建、安排、完成、独立核验分开；最小 Mission 只创建待办并验证创建结果 |
| 幂等基础 | [agent.ts](../../../lib/repositories/agent.ts) `createAction` 无强请求幂等；Copilot `withProposalLock` 是进程 Map，业务写与执行记录分两次提交 | 调整 | 新 Mission 写路径在一个数据库事务内提交业务对象、批准消费和 Step 回执；不调用旧 Copilot 写入口代替 |
| 可靠写入先例 | [episodeActionService.ts](../../../lib/services/episodeActionService.ts) 使用稳定 dedupeKey；[meetingStateDiffService.ts](../../../lib/services/meetingStateDiffService.ts) `confirmMeetingChanges`；[scheduleService.ts](../../../lib/services/scheduleService.ts) 版本确认 | 复用 | 提取最小事务函数，沿用版本校验和领域规则，不复制 API Handler |
| Claim/成果 | [trustReceipt.ts](../../../lib/evidence/trustReceipt.ts) `evaluateClaim` 检查归属/时态，未比较文本蕴含；[artifactService.ts](../../../lib/services/artifactService.ts) 模型输出为 `UNMAPPED_MODEL` | 复用/调整 | 新 Mission 草稿存带来源的结构化块，保留未核验状态；旧成果生成本身会写正式成果，不能当无副作用草稿工具 |
| 主动提醒 | [agentContextService.ts](../../../lib/services/agentContextService.ts) `evaluateProjectContext` 会生成提醒/决策；[interventionPolicyService.ts](../../../lib/services/interventionPolicyService.ts) 有 USER 作用域、频控与预算 | 复用/新增 | 不注册为只读 inspect；执行 Worker 必做，定期主动检查后置 |
| 授权 | [guard.ts](../../../lib/auth/guard.ts) `authorizeProjectAccess` 校验 session 与 membership，不按 role 区分写权限 | 调整 | Mission 默认仅 OWNER 可创建/批准，其他角色先拒绝；Worker 每一步重新查用户与成员关系，不依赖过期 Cookie |
| 小艺 | [auth.ts](../../../lib/xiaoyi/auth.ts) 固定测试项目+共享 Bearer；[createActionService.ts](../../../lib/xiaoyi/createActionService.ts) 有签名提案/请求回执，但业务写与完成回执并非同事务 | 整合/未验收 | 复用报文风格；现有 Token 不能代表任意用户批准 Mission，先完成受限身份映射 |
| 鸿蒙/Web | [ProjectHome.ets](../../../harmonyos/entry/src/main/ets/pages/ProjectHome.ets) 6014 行，Index 3365 行；[ApiClient.ets](../../../harmonyos/entry/src/main/ets/services/ApiClient.ets) 30 秒读取超时；Web `MemoryCopilot`、`ReentryBrief` 已有 | 整合 | 独立 Mission 组件；202 入队与轮询，同一 Mission ID；不继续堆入大页面 |
| 日历/Widget | `CalendarSyncService.ets`、`ActionReminderBlock.ets`、Widget 服务及回执已存在 | 复用/未验收 | 日历不纳入 Mission 自动写工具；跨入口状态核实与系统提醒送达分别验收 |
| 部署/CI | [ci.yml](../../../.github/workflows/ci.yml) 仅 Web lint/types/unit/build；[projectmemo.service](../../../deploy/alibaba-cloud-linux/projectmemo.service) 样例使用 Node 22 路径，项目约定 Node 24；未发现 Mission Worker/服务端业务调度主循环 | 调整/新增 | 增加独立 Worker unit 与运行目录核对；不推断线上版本；迁移与生产操作留给授权后的实施 |

### 2.2 为何还不是可持续执行的 Agent

模型目前输出的是答案和候选操作，不会收到“本轮工具实际结果”再选择下一步；工具集合未形成模型可见契约；对话虽已保存，却未进入下一轮生成。进程退出后没有可重建的运行游标、待确认步骤和执行租约。将这几项补到调用链上，比新增 Planner/Researcher 多角色更直接。

业务服务还默认由 HTTP 入口完成身份校验，不能交给后台 Worker 后继续隐式信任 projectId；“读取工具”的成本和缓存写入也未被统一预算。长期执行会放大这些边界，必须先把工具身份、输入版本和实际副作用写清楚。

### 2.3 进入 R3 前必须处理的五项本地缺口

当前源码仍保留此前审查指出的五种形态，列入 WP-00A，不引用旧测试数字宣布已修复：

1. Reentry 第一条 FACT 被当关键结论，历史判定遗漏 `PARTIALLY_STALE`；需要按句级 freshness 决定能否显示当前结论。
2. KnowledgeCardView 的 `/attachments/:id/file` 链接没有对应路由；需补鉴权原件读取或替换成真实可用入口。
3. 附件校对的 expectedCurrentText 在事务外检查，鸿蒙省略空文本基线；需补事务内版本条件与重试/并发测试。
4. primaryTargetId 未被两端消费，附件来源跳到宽泛录入区；需补精确定位。
5. 新增受阻行动扫描未过滤 isSimulated；模拟任务会进入真实风险聚合。

不能退回 HEAD 就称之为稳定复赛版：当前尚有用户修改。后续实施需先形成包含这些修改和必要修复、可重新构建验收的候选基线；本轮不产生该基线。

## 3. 成熟项目经验与引入判断

下列为 2026-10-20 查询的一手材料；表中迁移建议是本项目的设计判断。SDK 不会替本项目提供业务授权与数据库原子性。

| 项目/材料 | 解决的问题 | ProjectMemo 对应问题与采纳机制 | 引入决定 |
|---|---|---|---|
| [Anthropic Agent/Workflow](https://www.anthropic.com/engineering/building-effective-agents) | 动态工具循环与固定工作流的选择 | 模型负责选择下一动作；代码负责停止、权限和提交 | 借鉴模式，保持单 Agent |
| [LangGraph Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts) | 线程 checkpoint、长期 store、中断恢复；重放会再运行部分代码 | Mission 与项目记忆分开；已提交副作用按持久回执恢复 | 先用 Prisma；若两天限定 PoC 仍不能证明恢复，再比较 JS checkpointer，不能直接全库迁移 |
| [OpenAI Agents SDK 人审](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)、[Tracing](https://openai.github.io/openai-agents-js/guides/tracing/) | 批准中断、状态序列化、调用追踪 | 采用冻结提案、恢复事件和单次调用 trace；记录输入输出引用 | 不默认引入 SDK；模型 Provider、持久状态和应用权限仍由本后端控制 |
| [Letta Memory Blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks) | 长期上下文块及只读控制 | 区分任务工作记忆、用户约束、项目事实；任务摘要不能覆写用户确认约束 | 轻量 Context Builder；不另部署记忆服务 |
| [OpenHands 架构源码文档](https://github.com/OpenHands/docs/blob/main/sdk/arch/overview.mdx) | 事件、动作、观察与执行环境解耦 | 独立 Model Adapter、工具执行器和事件流 | 借鉴边界；不引入代码沙箱或电脑操作 |
| [Dify Agent 节点](https://docs.dify.ai/en/cloud/use-dify/nodes/agent) | 原生 Function Calling/结构化策略、迭代上限、工具描述 | 统一 ActionChoice、参数校验、最大迭代；记录真实调用结果 | 不部署第二个工作流后端；工具仍调用当前领域服务 |
| [Notion Custom Agents](https://www.notion.com/help/custom-agents)、[权限](https://www.notion.com/help/custom-agents-sharing-and-permissions) | 工作空间工具、事件/周期触发、显式资源授权 | 借鉴范围选择和活动记录；差异化验证时态来源与计划失效 | 不声称对方缺乏主动 Agent；不复制协作平台 |
| [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)、[Search/Fetch](https://api-docs.deepseek.com/guides/search/) | 原生工具消息与独立网页搜索/获取接口 | 当前封装尚未使用；可减少额外供应商，但必须通过 WP-00B 验证 | 首选能力探针；未通过时切受控 JSON Choice 与单一搜索替代商 |

现成框架的收益是成熟的控制流和调试工具；代价是第二套持久状态、Provider 适配及序列化迁移。当前只有一个 Runner、少量工具和一个数据库，轻量实现更容易审计。若无法通过租约/崩溃测试，应暂停扩功能，而不是继续自建更复杂的图引擎。

## 4. 目标架构与三项核心 ADR

```mermaid
flowchart TD
  UI[Web / 鸿蒙 Mission 面板] --> API[鉴权 API：创建 / 输入 / 批准 / 暂停]
  API --> DB[(Prisma：Mission / Step / Event / Approval)]
  W[独立 Node Worker] <--> DB
  W --> C[Context Builder：目标 / 最新状态 / 近期事件 / 来源引用]
  C --> M[Model Adapter：选择下一动作]
  M --> P[Registry + Policy + Budget]
  P --> R[现有领域服务适配器]
  P --> S[Search Provider + 受限网页获取]
  R --> DB
  S --> SRC[(外部来源与摘录)]
  P --> V[确定性验收 + 可选语义核验]
  V --> OUT[(Mission 草稿与结果回执)]
  DB --> UI
```

### ADR-1：Mission 独立持久化，轻量 Runner 保留现有领域层

Project 是业务容器，Action 是用户需要执行的事项，Episode 是可追溯阶段记忆，AgentRun 是一次调用记录；Mission 是受委托目标的执行状态。首版一个 Mission 只属于一个项目和一个用户，状态以数据库为准。

API 只入队/读取，不在 Next 请求返回后启动无托管 Promise。独立 Worker 每次执行一个有界片段，网络调用在事务外；步骤结果和游标落盘后才进入下一决策。租约带递增 fence，过期 Worker 无权提交。

### ADR-2：动态决策与确定性写入分离

模型工具为 `inspect_project`、`search_memory`、`web_search`、`web_fetch`、`save_research_draft`、`propose_action`、`inspect_action`；提问/完成是 ActionChoice 的类型。`commit_action` 不向模型开放，由批准事件触发确定性执行。

Action 创建必须复用领域校验，业务行、稳定 dedupeKey、Step 回执和批准消费原子提交。模型不得用“confirmed=true”绕过审批。断线重试读回执，不新建执行意图。日历、事实取代、现实行动完成和第三方写入暂不开放。

### ADR-3：外部来源、项目事实与核验结果分层

网页首先是 Mission 私有参考来源，不写 KnowledgeCard/CURRENT，不关闭内部实验缺口。来源记录 URL、获取方式、时间、规范化文本哈希和必要摘录；“用户批准引用”不等于内容已验证真实。

Mission 保存独立草稿，不直接把 `generateArtifact` 包装成“草稿工具”。最小版支持精确摘录和结构检查；Target 增加关键 Claim 语义判定。工具执行成功、来源支持、任务验收及用户自报各自有状态，不合并成一个 VERIFIED。

### 4.1 其他决定

- 首版使用原生 tool calling（通过真实探针时），否则使用单一严格 JSON ActionChoice；两种都进入同一 Registry/Policy。禁止解析任意自然语言为工具调用。
- 执行并发为 1，SQLite 短事务；全局执行槽与每 Mission 租约见阶段规格。不以进程 Map 保证并发，不在模型调用期间持有数据库锁。
- 每个工具声明领域副作用、网络外传、缓存写入和成本，不能只写 READ_ONLY 一个标签。
- 内部检索优先关键词/已有兼容向量，禁止工具调用顺便无界补嵌入。规模超出首版阈值时返回截断说明，后续再优化索引。
- 新审批和结果草稿仅在 Mission 表系内可见；旧 Copilot/Artifact API 保持报文兼容。旧版没有 Mission 功能时不显示假入口。
- 本轮不新增依赖。实施时优先原生 fetch/https/crypto、现有 Zod/Prisma；若直抓 HTML，允许一个直接声明的解析库，说明为何现有依赖不足；禁止依赖未声明的传递包。

## 5. 分阶段路线图

工程量按单人每天约 6 小时有效开发估计，包含受影响测试和记录，不包含等待授权、设备、供应商支持及最后发布缓冲。各阶段只领取一个工作包；规格中的 WP 为最小交付单位。

| 阶段 | 用户可感知结果 | 核心工作包 | 估时 | 前置 / 阶段通过条件 |
|---|---|---|---|---|
| R3.0 基线与能力验证 | 旧主流程可靠，清楚知道哪些模型/来源可用 | WP-00A 五项缺口和基线；WP-00B 工具/搜索探针、任务集与预算 | 1–1.5 日 | 新证据；现有修改保留；真实调用仅在获授权后运行 |
| R3.1 首个可恢复 Mission | 委托内部目标、模型选工具、批准后创建一个行动，中断继续 | WP-10 持久纵切片；WP-11 批准原子执行；WP-12 崩溃/预算/多 Worker 验证 | 4–5 日 | 三种工具按观察动态调用；未批准零业务写；崩溃恢复无重复 |
| R3.2 外部研究与任务上下文 | 能查公开资料、追问内部缺口、保存带出处的比较草稿 | WP-20 搜索/获取/来源；WP-21 上下文与研究草稿 | 2–3 日 | 真实 Search+Fetch；内外来源隔离；网页注入反例不越权 |
| R3.3 验收与失效重规划 | 用户知道实际做成了什么；来源变化后重新确认 | WP-30 确定性验收/计划失效；WP-31 完成回执及成果关联 | 1–1.5 日 | 不把草稿或外部指标变成项目实测完成；旧批准失效 |
| R3.4 鸿蒙接续 | Web 发起、鸿蒙查看/补充/批准/继续同一 Mission | WP-40 最小原生面板 | 1.5–2 日 | 实际设备同 ID、冷启动、会话失效恢复；编译不替代设备验收 |
| R3.5 评测与发布冻结 | 现场可重复演示，有真实任务成绩和故障预案 | WP-50 任务评测；WP-51 环境放行/材料 | 5–7 自然日发布窗口 | 指标、真机、备份恢复、版本对账和三次彩排 |

R3.1 就要具备最小 Context/Verifier；R3.2 引入外部来源后立即扩展对应门禁。R3.3 是集成核验，不是等到最后才加安全边界。

Target 增量：WP-32 关键 Claim 语义核验（2–3 日）；WP-41 小艺受限身份与真实接续（1–2 日，平台条件满足时）；WP-42 Widget 摘要（0.5–1 日）。Target 的跨入口最低由 Web+鸿蒙完成，小艺有独立 Gate。

Stretch：WP-X1 显式个人偏好/用户可见的只读跨项目摘要；WP-X2 单一周期检查与有意义变化通知。它们不进入 Minimum 关键路径，也不在基础 Worker 上附带偷偷实现。

## 6. 三种交付范围与时间判断

### 6.1 Minimum Finalist Release

包含 R3.0–R3.4 的最小工作包和 R3.5 放行：

- 一个真实模型、一个项目、七个工具，至少一个非固定顺序的多步任务。
- 真实 Search/Fetch、至少两条可读取来源；无法获取时明确暂停或换来源。
- Mission 私有草稿、一次 Action 批准及读回、一次进程重启后的接续。
- Web 和最小鸿蒙审批/继续入口；具备目标设备验收。
- 结构/出处/关键数值约束，无法判定语义的内容保留待审核。
- 至少 12 个留出任务的同模型两组对照，加独立故障/越权用例；不能用测试数量替代任务成绩。

从现在起约需 **12–16 个有效开发日到功能冻结，另留 5–7 自然日放行**，含核心工程风险余量。若只能每天投入 2–3 小时，按小时重新估算，不能继续沿用“开发日”数字。

### 6.2 Target Finalist Release

Minimum 之上，关键 Claim 支持/冲突/不足的语义判定、来源变化影响步骤、完整结果读回；30 个留出任务、5–8 人小测；增加小艺或 Widget 中至少一个已验收入口。总体约 **16–23 个有效开发日到冻结，另留 7 自然日放行**。

Target 不要求跨项目画像、全部日历工具或后台自动研究。它的竞争力来自真实工具选择、时态计划失效、恢复与可解释的结果。

### 6.3 Stretch Release

仅在 Target 的零容忍用例、真实模型任务和设备 Gate 全部通过后，选择 WP-X1 或 WP-X2 之一，约再加 3–5 日；不同时做。GitHub/OAuth、多人权限体系、复杂排程、多 Agent、模型训练、任意浏览器/终端执行全部后置。

### 6.4 日期预案和硬节点

实际决赛日记为 D。以下是内部控制点，不是官方时间要求：

| 控制点 | 最迟要求 | 未达到时 |
|---|---|---|
| 核心架构/首版工具冻结 | 10 月 22 日：确定单项目、状态、批准原子边界、Provider 探针方案 | 不继续扩 API/实体；先关闭不确定性 |
| 第一条真实模型+工具+搜索纵切片 | 10 月 27 日前取得 PoC，且必须早于 D−10 日 | 停 Target/Stretch，剩余时间投入最小链路；不得以 mock 顶替 |
| Minimum 候选核心功能冻结 | D−7 自然日；小艺等新增入口 D−10 日完成可行验证 | 未验收扩展不进入候选包 |
| 停新增功能 | D−7 至 D 只修阻断、重测、验收与彩排 | 不追加“顺便做”的能力 |
| 最终版本/资料锁定 | D−2 日前完成对账和三次完整彩排 | 保留本地录像与缓存的明确标识；不临场迁移架构 |

若 D 在 11 月 1–7 日，按单人工作量和放行缓冲，**不能负责任地承诺完整 Minimum**。可先验证窄 Mission PoC，但未满足全部门槛时仍交付稳定复赛功能，清楚展示已完成的 R3 部分。不能把“入口+录屏”重命名为 Minimum。

若 D 在 11 月 8–15 日，只有较高连续投入、模型/设备条件马上就绪时才争取 Minimum；若 D 在 11 月 16 日以后，优先保住 Minimum，再根据实际剩余有效开发日选择 Target 增量。通知到达后按 D 重排，不能把未知日期当作额外工期。

### 6.5 关键路径与并行面

Critical Path：WP-00A/00B → WP-10 → WP-11 → WP-12 → WP-20/21 → WP-30/31 → WP-40 → WP-50/51。

单人可交错准备但不能按多人并发缩短估时：任务集/人工标注可以从 WP-00B 开始；设备签名和平台申请同日起准备；API 稳定后绘制/实现鸿蒙面板；搜索抓取适配可在持久契约冻结后独立开发。共享 Schema、Registry 和批准提交器串行修改。

砍功能顺序：跨项目画像 → 周期主动研究 → GitHub/更多连接器 → Widget → 小艺新写操作及复杂接续 → 语义 Judge 自动化（保留摘录和待审核）→ 排程扩展。不能砍掉真实外部获取、动态工具选择、批准、幂等、恢复和最小评测，否则不再满足 Minimum。

## 7. 评测与现场演示

### 7.1 指标及判分

| 指标 | 可复现定义 | Minimum / Target 门槛 |
|---|---|---|
| Mission Task Success | 任务开始前冻结成功条件；检查实际产物、批准及业务读回；合理等待私有信息单独计分 | 12 / 30 个留出任务，总体成功率目标 ≥75%；同时公开任务类型和分母 |
| Tool Selection | 按允许的有效工具集合/偏序判分，不强制唯一调用顺序 | 合理选择 ≥85%；“仅内部”任务对外调用必须 0 |
| Multi-step Execution | 至少三种不同工具，后续调用使用此前真实观察结果 | 三种目标变体有不同合法轨迹，不计固定脚本 |
| Pause/Resume / Recovery | 写入前、提交后未回包、租约过期、批准等待等故障点 | 重复业务副作用 0；已完成步骤不再次提交 |
| Context Retrieval | 命中必需当前/历史来源，正确解析最近指代、否决及新目标 | 固定反转/多轮反例全部通过；遗漏和过度拒答分别统计 |
| Web Research Quality | 链接可达、获取正文、出处/时间明确、满足任务范围 | 两个独立来源；同源转载不算交叉验证；无搜索结果时不能伪造 |
| Claim Grounding | 人工判断来源是否支持关键句、数值/单位/对象/条件是否匹配 | 高风险外部指标冒充自测为 0；普通关键句支持率目标 ≥90% |
| Unauthorized Action | 无权限、无批准、被篡改/过期批准、网页注入后的实际业务写 | 成功越权 0；任何一次即失败，不用总体成功率抵消 |
| Latency / Token Cost | 每次模型/搜索/获取及重试累计，含失败和不明消耗 | 均不突破服务端硬次数/时间预算；报告 p50/p95 和未知计费，成本上限由用户批准 |
| 用户实际帮助 | 同任务人工/旧版/新版的用时、错误、手工步骤 | Target 5–8 人顺序平衡的小测；报告个人变化，不预填节省百分比 |

Minimum 使用 A＝同模型旧问答路径、B＝新 Mission 进行对照；原版不支持的目标仍计入其失败分母，另报只覆盖旧能力的子集。Target 增加 B−Web、B−Mission 短期上下文、B−Temporal/Semantic 的离线只读消融，隔离各机制的贡献。所有有副作用实验始终保留同一授权门；不通过去掉权限制造“能力提升”。具体题集、评分和重复规则见阶段规格。

### 7.2 贯穿 Demo

采用课程/技术项目的匿名材料：方案 A 已被 B 取代，B 缺一项本地验证。用户委托“比较近期公开方法，给出阶段汇报草稿和下一项验证建议”。

模型实际选择内部读取和检索，执行公开搜索/网页获取；对“别人论文指标”保留外部来源标签；缺本地指标时向用户提问。用户补充后，Agent 保存比较草稿、提案一项验证 Action；用户在鸿蒙批准，服务端创建并读回；重启 Worker/退出 App 后，同一 Mission 继续显示此前步骤和结果。

再演示一次来源 A→B 改变使旧提案失效，以及一次搜索失败/注入页面。演示数据可以固定，工具结果不能预写；缓存/录制回放明确显示来源与获取时间。现实实验没有执行就保持待办，不伪造“Agent 已完成实验”。

## 8. 风险、回退和需要拍板的事项

| 风险 | 暴露范围 | 处理与降级 |
|---|---|---|
| Provider 工具协议不稳定 | 单步模型选择 | WP-00B 早验证；切严格 JSON Choice，同一权限/预算；仍失败则暂停该任务 |
| 搜索服务不可用 | 需要最新外部资料的任务 | 仅切一个经验证 Provider；缓存标历史；真实 Search/Fetch 不通过则 Minimum 未通过 |
| SQLite 竞争/双 Worker | 执行、批准与重试 | 全局槽、fence、短事务、故障注入；不能靠 Map；锁竞争不满足预算则降并发/暂停，不临赛换数据库 |
| 语义 Judge 给错结论 | 研究草稿及推荐 | 保留结构化来源、精确摘录与人工审核；来源支持和现实效果分别验收 |
| 旧客户端/回滚 | 全产品数据 | 仅增表/可空关联；关新入口、停止新队列、排空写事务，保留旧服务与历史记录，不做降库删表 |
| 小艺共享 Token 暴露用户 Mission | 用户身份和私有内容 | Target 前先限定一个专用测试账号/项目和 Mission 白名单；不能扩为泛用户授权 |
| 线上 Node/路径与本地漂移 | Worker 和原生 SQLite 模块 | 用部署副本验证 Node 24、依赖、数据库/附件持久目录及权限；本轮不碰线上 |
| 设备/签名未及时就绪 | 鸿蒙验收 | 开工日落实；Web 可继续研发，设备 Gate 不因构建通过而关闭 |

### 8.1 规划自检

| 维度 | 原总体方案主要缺口 | 本轮处理 |
|---|---|---|
| 完整性 | 没有可领取的细粒度契约/工作包 | 阶段规格列状态、Schema、API、测试、回滚和依赖 |
| 可行性 | Worker/确认/评测分阶段过晚，估时偏紧 | 最小纵切片早验证，单人估时重排，外部条件单列 |
| 范围 | 个人画像/多入口/多工具易同时膨胀 | Minimum/Target/Stretch 分开，写工具限定一个 |
| 可测试性 | 按功能数量难判断自主性 | 真实轨迹、故障点、留出任务和零容忍门禁 |
| 风险 | 原子回执、旧进程提交、身份边界不够具体 | fence/事务/任务所有者/重试预算纳入规格 |
| 假设 | 模型/搜索、投入时间与具体决赛日未验证 | WP-00B 和下方决策项明确验证条件；不以规划评分代替运行验收 |

### 8.2 需要负责人决定的三件事

1. **可投入工时与 D**：默认单人每天 6 小时、每周 5–6 个有效开发日；确认后决定 Minimum 或 Target。
2. **真实联调额度与资料外传范围**：是否使用当前 DeepSeek 账号做工具/搜索探针及评测；批准总预算、可公开的研究摘要与资料范围。当前仅查询官方文档，未产生模型/搜索 API 调用。
3. **真机与平台入口**：默认 Web+鸿蒙为必须，小艺为 Target；确认可用设备、签名条件及小艺测试账号，避免把平台申请留到最后一周。

无需先拍板引入哪套框架。建议第一包从 **WP-00A：五项基线缺口与回归候选** 开始，同时准备 WP-00B 的脱敏工具/搜索测试。其余架构按本文推荐方案推进；PoC 证据不支持时再调整。
