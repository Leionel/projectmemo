# R4 UI 协议 · PR-0

源码：`lib/types/agentExperience.ts`、`lib/conversation/experienceContract.ts`；鸿蒙镜像：`harmonyos/entry/src/main/ets/models/AgentExperience.ets`。

## 三层边界与版本

1. 模型输出 `PresentationPlan.schemaVersion=2`：intent/composition/primaryIntent。每块只有稳定 blockKey、semanticType、emphasis、dataRefs 和可选解释文字；prose 使用 text 或受限 content AST 二选一。模型没有 URL、HTML、命令、状态或 allowedActions 字段。
2. 服务端从当前授权、版本与原业务服务构建 `ExperienceAuthority`，选择可信 catalog 块，产生 `AgentPresentation.schemaVersion=1`。`hydratePresentation` 保留模型选择的块、次序和强调，将业务内容与操作绑定到原对象。
3. Web 与 ArkTS 消费相同 JSON，分别原生渲染。`ConversationBlocks.schemaVersion=1` 不变，仅增加可选 `presentation`；旧正文、来源、提案和历史继续可读。

PR-0 实现契约及纯校验/hydration，不接数据库权限查询、不启用新模型循环、不发出新 presentation、不替换客户端 renderer。PR-1/2 必须在实际调用处构建并更新 authority，不能从客户端、模型或持久旧快照直接信任它。

## 来源与目标

`ExperienceEntityRef` 使用 kind/id/projectId/revision，来源另有 excerptHash/readScope/observedAt。`EvidenceLink` 分别保存 applicability、verification，以及对具体 claim 的 SUPPORTS / CONTRADICTS / UNDETERMINED 关系。来源存在、条件适用与支持结论是三件事。GoalGap 从原项目或 Mission 目标引用出发，逐条件表达 VERIFIED / REPORTED / UNKNOWN / BLOCKED / NOT_APPLICABLE。

- VERIFIED 至少需要直接适用、已核对且 SUPPORTS 当前同一 requirement 的来源；纯报告、反证或其他结论的证据不能升级。
- NOT_APPLICABLE 需要核对依据。Unknown 不转为 False，不生成无分母的进度百分比。
- 目标、条件和证据必须属于同项目。来源修订、撤权或私有对象 owner 变化后旧引用失效。
- authority 记录本轮完整 readSet，输出短文或省略引用也不能绕过读集撤权/版本检查。
- server catalog 的证据链接必须与当前核对记录一致；模型不得自填 CHECKED 来取得信任。

## 语义块

每块包含 blockKey/emphasis/fallbackText/refs/actionBindingIds。白名单共十种，简单回答允许仅一个 prose；上限为 16 块、展示 JSON 96000 字符，超限整体安全降级，不能截断后遗失批准关系。

| semanticType | 服务端绑定数据 | 首批体验要求 |
|---|---|---|
| prose | 受限文本节点与已授权引用 | 短答、段落、标题、列表、代码、表格 |
| evidence | EvidenceLink、SUPPORTED/UNKNOWN/CONTESTED | 依据与适用条件可追溯 |
| goal_gap | 原目标与条件判断 | 解释真实缺口，接续调查 |
| comparison | 原 Proposal hash、原 candidate ID、取舍/分支/停止条件 | 选择与否决不自动执行 |
| investigation | 原 turn 步骤、哈希、真实状态与覆盖 | 可读真实进展，绝不编百分比 |
| change | 原 Review、目标原句、变化/相关性/未知 | 追问、保留计划、延后与停止 |
| question | 原 Question、draftKey、输入类型及冻结选项 | 提交/取消明确，草稿持续 |
| approval | 原 executionId、hash、期限与状态 | 经原预览后确认或否决 |
| receipt | 原 Receipt/Action/Mission 的实际状态 | 已创建、运行、结果保存、核验分开 |
| timeline | 原 Event 引用及发生时间 | 同一主题的变化和结果可追溯 |

富文本采用有限 AST；不支持任意 HTML/链接/可执行代码。即便文本包含 `<script>` 也只作为文本节点，renderer 必须 escape。未知节点/版本以受控旧正文或 fallbackText 展示；来源和操作校验失败不得保留可执行控件。PR-2/4 实现实际 fallback 路径并测试。

## 动作与持久业务

`AllowedAction` 只来自服务端注册表，包含 bindingId/conversationId/expectedConversationVersion/actionKind/target/enabled/disabledReason。动作只有 OPEN / ASK / PREVIEW / CONFIRM / DECLINE / REFRESH，无任意 URL 或请求体。

提案动作另绑定 frozen proposalHash/candidateId/expiresAt。PREVIEW 可尚无 executionId；CONFIRM 必须已有原预览 executionId。比较卡的 PREVIEW 必须指向同一冻结候选且可行；审批卡的执行对象、hash、期限必须一致。陈旧/否决/过期状态不提供可用确认。

客户端只发送原 API 要求的 requestId、expectedVersion、executionId、proposalHash 或原 work command 的冻结字段。当前 authority 校验不是长期授权；每次读取、预览和确认都由原服务重新鉴权、检查源版本、批准期限与幂等。操作和回执仍由原事务提交。

## 草稿与跨端接口

- WorkCard 身份固定为 conversationId + 原业务 kind/id；不能拼消息条数。revision 变化需要显式冲突/交接，不以重挂载静默清空。
- draftKey 来自原 Question/业务身份；新消息、readback、页面来回不得清空未提交内容；切换用户清除私有草稿。
- 约 15–16px 等效正文、44–48px 触控目标，适配 360/390/430px、键盘、安全区、放大字、暗色。
- 状态字典与实际 renderer 在 PR-2/4 交付；内部枚举不直接当产品提示。当前 WorkCard key 风险仍登记为待修。

共享 fixture：`tests/fixtures/r4/experience-v1.json`。科研、竞赛、课程有不同初始/观察后 UI Plan，包含同一对象的审批/创建回执及用户结果 REPORTED。它们是合成输入；模型动态性和真实业务效果另验收。
