# R4 Prompt 合同 · PR-0

PR-1 已接入 `focus.route.v2`、`focus.investigate.v1`（联合 `focus.goal.v1`）与 `focus.answer.v2`；配置与输出 schema 见 `lib/conversation/promptSpecs.ts`。持久预占接原 cloudQuota，C0 字符串调用保留。`focus.ui_plan.v1` 随 PR-2 接入，其他专项按下表继续追踪。

基线：`c8c7072`，2026-10-26。实现入口为 `lib/agent/promptSpec.ts`；本批冻结消息与预算接口，现有 Provider 和业务 Prompt 尚未切换。R4 总基线为本地 `docs/FINAL/AGENT_REVIEW/projectmemo_r4/PROJECTMEMO_AGENT_EXPERIENCE_R4_BASELINE_v1_2.md`。

## 消息与模型边界

- `PromptSpec<Input, Output>` 冻结 id/version/purpose/system/outputSchemaVersion/maxOutputTokens/outputSchema/buildMessages。
- `buildPromptMessages` 要求唯一且居首的 system，另有用户消息。来源经 `modelDataMessage` 序列化为 `UNTRUSTED_DATA`；来源不能追加 system。工具消息必须有原 toolCallId。
- `ModelCapabilities` 显式声明 system/tool/JSON 支持；不支持则拒绝，不把角色静默压平。原字符串接口保留，PR-1 在原 Provider 增量适配。
- `modelMessagesInputBound` 计算全部消息、角色、工具 ID、JSON 封装及每条 framing 的 UTF-8 上界；它不是精确 tokenizer。
- `ModelCallReservation` 以 callId 区分同 purpose 的多次调查。HTTP 前持久预占；已知 usage 结算一次；未知字段保留预占。PR-0 提供纯计算/上限校验，PR-1 接原事务与额度，不另建账本。
- 所有调查、目标判断、回答和 UI Plan 共用根 turn 预算。不得隐形增加修复、压缩、embedding 或 UI 规划调用。一次响应可承载多个任务输出，但每个输出保留 purpose/schema/诊断。
- Provider 返回已知失败与 usage 未知分别记录；网络 UNKNOWN 不自动重发。工具读取失败、模型失败、UI Plan 失败分别定位。

## 专责 Prompt 注册表

下表是实施合同，登记不表示已接入模型。各模块的实际输出 schema 随对应 PR 接入并测试；PR-0 已冻结 GoalGap、InvestigationDecision 和 PresentationPlan。

| ID / 版本 | purpose | 输出职责 | 必测负例 / 指标 | 接入批次 |
|---|---|---|---|---|
| focus.route.v2 / 2.0.0 | ROUTE | 选择授权项目、信息需求和澄清 | 同名项目、指代、撤权；项目定位准确率 | PR-1 |
| focus.investigate.v1 / 1.0.0 | INVESTIGATE | InvestigationDecision；每次观察后重新决定 | 重复读取、无工具、注入；必要读取与信息增益 | PR-1 |
| focus.goal.v1 / 1.0.0 | GOAL | GoalGap；条件、阻碍、下一信息需求 | 构建冒充部署、TODO 冒充进度；条件判断正确率 | PR-1 |
| focus.answer.v2 / 2.0.0 | ANSWER | 结论、实际已读证据、影响决定的未知 | 无依据断言、模板长答；grounding precision | PR-1/2 |
| focus.ui_plan.v1 / 1.0.0 | UI_PLAN | PresentationPlan v2；语义选择、次序、强调 | 伪造操作、机械卡片；布局合理性及用户操作成本 | PR-2 |
| decision.d1.v4 / 4.0.0 | CHANGE_REVIEW | 目标关联、前提变化、适用性、KEEP_PLAN | 背景误触发、UNKNOWN 当失败；无关误报率 | PR-3/5 |
| decision.d2.v3 / 3.0.0 | DYNAMIC_PLAN | 候选取舍、分支、停止条件 | 无论结果均不改变决定的验证；候选可用性 | PR-5 |
| mission.strategy.v2 / 2.0.0 | MISSION | 原 Mission 工具选择、输出与停止 | 重复工具、旧任务当当前；真实任务有效结束率 | PR-5 |
| capture.fidelity.v2 / 2.0.0 | CAPTURE | 保留原文断言强度的旧 Schema 输出 | “好像”变“已核验”；保真率 | PR-5 |
| artifact.coverage.v2 / 2.0.0 | ARTIFACT | 来源覆盖、缺口、版本明确的成果 | 摘要冒充完整验收；无依据断言数 | PR-5 |
| legacy_copilot.style.v2 / 2.0.0 | LEGACY_COPILOT | 原项目问答兼容与统一表达 | 私聊公共化、历史改写；历史可读性 | PR-5/6 |

长期身份、任务 policy、输出协议、表达规范分层维护。显存字段留在领域输入，不进入通用 system。默认结论先行，简单问题短答；只有会改变判断的未知才需要说明。

## 审计与下一接口

PR-1 每次调用须持久保留 promptId/version/outputSchemaVersion/provider/model/request identity/usage/usageUnknown/recoveryReason，以及有界 hash 诊断。PR-0 不改变现有 AgentRun 数据和历史回执。

验收以相同 provider/model/temperature/输入的配对对照为准，详见 [评测合同](R4_EVALUATION_PROTOCOL.md)。`tests/r4ExperienceContract.test.ts` 覆盖角色、数据隔离、完整消息预占、未知费用、任务级预算及三领域输出接口；这些测试不证明模型遵循 Prompt。
