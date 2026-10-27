# R4 Agent Experience 实施记录

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
