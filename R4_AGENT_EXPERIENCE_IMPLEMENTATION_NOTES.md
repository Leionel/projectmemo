# R4 Agent Experience 实施记录

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
