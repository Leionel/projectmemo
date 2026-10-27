# R4 Agent Experience 实施记录

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
