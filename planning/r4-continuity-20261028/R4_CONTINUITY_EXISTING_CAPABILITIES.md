# 当前能力审计

## 1. 核查范围与证据口径

核查日期 2026-10-28；本地 HEAD `1132f30ee149e42d5f9fce79219ba1d9ecf02ea3`，分支 `codex/r3-runtime-research`，stash 为空。以本地源码为准，没有用基线中的远端 `c8c7072` 或 PR-6 起点 `bf7ca1a` 替代当前版本。

输入为 `docs/FINAL/tool&function/` 下三份指定基线，已阅读全文。另发现 `docs/FINAL/AGENT_REVIEW/projectmemo_r4/` 下同名 R4 v1.2：后者增加 PR-6 Search/Fetch 和覆盖/恢复补充，主体相同。此补充及根目录最新 PR-6 文档共同纳入，没有覆盖任何原文。两个同名文件 SHA256 分别为 `5dae8fad4476f371b17682e46c21183f08396e2352659209b3ac15b46f2f4f04` 和 `b8668949ed7bd15c0848bf394dea45140d83e29ae55f04b1d39507b6dd682b02`。

已读根目录 `AGENTS.md`、`R4_AGENT_EXPERIENCE_IMPLEMENTATION_NOTES.md`、`R4_PR6_WEB_RESEARCH_PLAN.md`、Prompt/UI/评测合同、PR-6 checkpoint、相关 Prisma/服务/API/双端类型及测试源码。原工作树有四个已跟踪修改：`AGENTS.md`、`docs/FINAL/AGENT_REVIEW/AGENT_EVOLUTION_ROADMAP.md`、`harmonyos/build-profile.json5`、`tsconfig.json`；另有大量历史证据和未跟踪文件。均保留。

本文 `CODE_VERIFIED` 指静态源码与调用链已核对；`RECORDED_TEST` 指旧回执记录；`INFERENCE` 指由代码推导但尚未运行的风险；`PROPOSED` 指本方案增量。**没有把测试文件存在称为本轮测试通过。**

## 2. 能力与复用审计

| ID / 能力 | 当前代码与真实性 | owner / 读写边界 | 覆盖结论与真实增量 |
|---|---|---|---|
| E01 Conversation | `prisma/schema.prisma:379`；`lib/conversation/turnService.ts:42`、`lib/conversation/service.ts:125`：requestId、版本、私有消息、对象绑定、50 条分页 | 认证用户及可访问项目；私有 Mission 另查 owner | CODE_VERIFIED。保留受理、历史和 CAS；新增跨会话有效指令解析，不能靠最近消息维持长期目标。 |
| E02 pinned state | `lib/conversation/turnService.ts:142`：正则把整条消息追加到 `string[]`，上限24；`:236` 按任意历史“只读/不创建行动”抑制 action | 当前 Conversation，无结构化项目/任务/期限/撤回 | CODE_VERIFIED。不等价 Effective Intent/Correction；需要独立于事实记忆的、用户可修订指令记录。 |
| E03 调查中的历史 | `lib/conversation/investigationService.ts:146`、`:167`：pinnedConstraints、最近6条×500字；初始 sources 最多12 | route 最多3项目、当前目录及读前读后权限 | CODE_VERIFIED。增加按问题读取有效指令/承诺；近期窗口不能承担长期合同。 |
| E04 动态 Investigation | `investigationService.ts:28`、`:169`、`:193`；`toolAdapter.ts:43` | workspace actor；每步重新选工具，Quick/Standard/Deep预算；来源及指针重验 | CODE_VERIFIED。复用循环；新增 intent/context hash，并让关键原文按需保留，不能用新 Planner 替换。 |
| E05 GoalGap | `normalizeGoals`，`lib/types/agentExperience.ts:30` | 原 Project.goal；引文逐字绑定；模型 VERIFIED 降为 REPORTED，缺适用性保持 UNKNOWN | CODE_VERIFIED。绑定当前工作目标与原验收条件的差异；不得只增加 preference 文本而仍强制围绕旧 goalQuote 调查。 |
| E06 工作区上下文 | `lib/services/workspaceContextService.ts:11,60` | 成员目录≤60、深入≤3、每项目部分 Action/Mission；偏好按 user/project | CODE_VERIFIED。不是统一协调器；缺失 intent/correction/commitment/lineage 的问题相关投影。 |
| E07 Memory 时态 | `lib/memory/temporalLedger.ts:17,113`；`lib/repositories/temporalRelations.ts`；`lib/mission/memorySearch.ts:15` | 原卡片、Capture、附件修订、确认/撤回/有效期关系 | CODE_VERIFIED。CURRENT/SUPERSEDED/CONTESTED/UNKNOWN 已有；复用，不能再造另一套事实有效期表。 |
| E08 来源与派生 | `lib/mission/memorySearch.ts:35`；`lib/mission/projectMaterialReader.ts:19`；`lib/mission/artifactProvenanceService.ts:7` | 卡片摘要被标 PROJECT_OBSERVATION；部分 Mission Artifact 有逐块来源审计 | 部分覆盖。卡片是摘要不等于一手；跨所有来源的根证据身份、派生去重和用途权限没有统一贯通。 |
| E09 Decision/D1/D2 | `lib/decision/reviewPersistence.ts:27`；`lib/decision/goalState.ts:7`；`lib/decision/dynamicCandidates.ts`、`lib/decision/boundedReview.ts` | 目标/成功条件/约束/范围/读集/最近真实结果hash；原候选采纳 | CODE_VERIFIED。继续复用；增加有效指令hash和工具适用条件，保留 KEEP_PLAN 与 UNKNOWN。 |
| E10 影响传播 | `lib/decision/impact.ts:30`；`lib/decision/impactJobs.ts:9,29` | 持久 job 同事务排入，原 worker处理；旧审批 EXPIRED、旧 step OBSOLETE、原 Mission重审 | CODE_VERIFIED。已有影响机制，不能重建全局依赖图。将新指令根/新工具来源接入，确认边界仍即时重验。 |
| E11 原写入与回执 | `lib/conversation/commands.ts:15`；`lib/conversation/uiActions.ts:17`；`lib/conversation/workService.ts`；`lib/copilot/confirmation.ts` | 冻结提案、原会话/来源/期限/owner、幂等；完成有 resultCardId | CODE_VERIFIED。新增意图冲突检查，旧业务效果保持历史，纠正不反向删除已提交行动。 |
| E12 Mission/Handoff | `prisma/schema.prisma:1089`；`lib/mission/gaps.ts:22`；`lib/mission/continuationService.ts:99,115` | waitState、原问题、pause/resume、低风险材料自动接续；私有owner | 部分覆盖。已有原任务等待与接续；缺少跨新会话的统一下一责任方、外部等待条件与真实承诺入口。 |
| E13 Turn恢复 | `lib/conversation/turnRuntime.ts:36,38`；`lib/conversation/turnWorker.ts`；`scripts/mission-worker.ts:9` | 原 Turn operation/inputHash、lease/fencing、结果缓存、UNKNOWN不重发 | CODE_VERIFIED，PR-6有恢复测试回执。不是缺少Runtime；缺少恢复时有效意图与新证据的协调。 |
| E14 Anchor | `lib/conversation/anchorService.ts:115,206`；`prisma/schema.prisma:452` | 显式进入/关注、LATER/STOP、revision去重、Action跟踪、原回执 | CODE_VERIFIED。仅投影已有原事件和缓存仓库线索；不是持续联网调查/系统推送授权。 |
| E15 注意力预算 | `lib/services/interventionPolicyService.ts:119,350`；`GoalQuestionPreference`；`lib/services/interventionDeliveryService.ts` | USER预算、安静时段、项目主题降频、生成/曝光/送达分开 | 部分覆盖。Anchor sync未调用统一quiet/daily gate；三层Attention需要接合两条路径，不能宣称预算不存在。 |
| E16 Outcome经验 | `lib/experience/trajectoryIndex.ts:50`、`lib/experience/extract.ts:50,125`、`lib/experience/injection.ts:27`、`lib/experience/service.ts:102` | 项目+owner；候选/SHADOW/用户ACTIVE/REVOKED；按mission去重 | CODE_VERIFIED。只做到工具序列/失败修复模式；条件主要是文本、版本检查，非数据集/设备/原始结果可比性。Focus未见同等入口。 |
| E17 GitHub | `lib/sensing/repoSource.ts:9`；`lib/conversation/sourceObservation.ts:8` | 公开commits、显式刷新、ETag；候选须确认采纳；Focus仅读缓存 | CODE_VERIFIED。没有通用CI观察或私有OAuth。新增量是固定SHA的checks/run/diff，不能再把“接GitHub”整体算新功能。 |
| E18 PR-6研究 | `lib/conversation/researchTools.ts:70,90`；`lib/conversation/researchScope.ts:10,34`；`lib/conversation/researchCoverage.ts:6` | Conversation研究scope、用户URL、公开查询隔离、逐次operation、授权revision | CODE_VERIFIED。同会话来源与research summary已有；跨会话关联须依授权重新解析，不能复制快照逃过原scope。 |
| E19 双端UI | `lib/types/agentExperience.ts:133,173`；`lib/conversation/presentationRuntime.ts`；`components/AgentMessageBlocks.tsx`；`harmonyos/entry/src/main/ets/components/AgentMessageBlocks.ets` | 模型plan→服务端catalog/绑定→原生渲染；旧正文fallback | CODE_VERIFIED。没有统一continuity语义、控制命令和handoff视图；应增量扩协议及capabilities。 |
| E20 附件深读 | `lib/services/attachmentService.ts:31`；`lib/mission/projectMaterialReader.ts:8` | pdftotext -layout、可配置图片OCR、手工修订；12k/5k等片段边界 | 部分覆盖。文本抽取存在；可靠页/节/表格寻址、检索与版面定位尚缺。不是从零做文件上传。 |

以上简写未带目录的 Conversation 文件均在 `lib/conversation/`；Memory/Decision等按表中完整前缀。双端确切渲染入口以交互方案列出的实际路径为准。

## 3. 优先缺口及复现方法

| 级别 / 缺口 | 最小复现与预期差异 | 证据与边界 |
|---|---|---|
| P0 指令不能替代/撤回 | 同一会话说“本次不要创建行动”，稍后“现在允许创建行动”；再请求具体行动。应能解除本次限制；当前 `pinned` 没有删除/替代路径，`:236` 仍会抑制 action。 | CODE_VERIFIED 控制分支；完整模型/UI旅程未在本轮运行。 |
| P0 限制跨项目误传播 | Workspace会话在A说“只读”，切换B明确要求创建行动。当前 pinned没有projectId，任一“只读”可阻止B行动。 | CODE_VERIFIED 作用域缺失及全数组扫描；B的真实写入仍必须确认。 |
| P1 纠正丢失或错分类 | “别重新训练，先测部署”不命中当前持久正则；超过6条近期消息或另开会话后，没有等价的结构化纠正入口。 | CODE_VERIFIED 正则、history窗口、schema；不是断言模型在每次都会遗忘。 |
| P0 跨会话意图不使旧提案失效 | 在会话A保存提案，再到B改变私人工作方向。原 Project.goal/Mission版本没变，A的确认guard没有该方向的读集。 | INFERENCE：缺少意图源和guard可静态确认；需要新隔离并发测试证实最终表现。 |
| P1 原目标压过新工作目标 | 用新的阶段目标调查时 `normalizeGoals`仍要求goalQuote严格等于Project.goal。仅把新目标塞进prompt不足以完成迁移。 | CODE_VERIFIED。扩goal binding，原成功条件不自动降低。 |
| P1 来源存在被误当支持 | 卡片摘要统一PROJECT_OBSERVATION；DERIVED_FROM可参与时态supporting，但这不提供语义核验或独立根证据。 | CODE_VERIFIED 来源标签/时态逻辑。需贯通provenance，不指称已发生具体伪事实。 |
| P1 研究总结二次使用缺共同语义 | PR-6归入的Artifact带CONVERSATION_RESEARCH manifest，Mission审计以MissionArtifactReceipt为入口；定向Artifact读取为MIXED。撤销原研究许可后，已明确归入的项目副本应否继续可读/用于新决定，当前没有统一合同。 | CODE_VERIFIED 两条路径不等价；这是用途/撤权政策缺口，不凭静态代码宣布存在越权泄漏。 |
| P1 多日承诺不完整 | 新会话问“上次等评测那件事呢”，当前目录仅列部分Mission状态；未结构化保存任意对话承诺的责任方/触发器。 | CODE_VERIFIED已有状态可投影；自然语言准确找回率尚待独立评测。 |
| P1 注意力两条路径割裂 | 安静时段或用户预算用尽，Anchor sync仍可新增投影；它未共享Intervention的完整决策口径。 | CODE_VERIFIED调用链。应用内摘要可以允许更新，但不得当作已授权即时通知。 |
| P1 经验条件不足 | 同工具序列但目标设备/数据集不同，injection只硬查工具/协议版本、反例数；条件文本由模型理解。 | CODE_VERIFIED。需结构化适用匹配和原结果指针，不能把采用率当真实方法效果。 |
| P1 读取增加反而稀释关键证据 | Investigation上下文总摘录约4800字符，来源增多后每条可见片段缩短；语义判断可能失去刚读到的关键句。 | CODE_VERIFIED `investigationService.ts:153`；质量影响为INFERENCE，应测关键span保留与动态深读。 |

## 4. PR-6 当前 Gate

依据 `evidence/r4-agent-experience/20261027-pr6/delivery-checkpoint.json`，属于 RECORDED_TEST：新增研究/恢复/迁移21项、原Conversation22项定向、types、鸿蒙86项及HAP构建有通过记录；lint在最后fixture加入前通过。全量最终回归待补，Web E2E已落盘未运行，冻结11/48 arms，独立语义评分/三策略对照不完整，HDC当时无设备，生产未迁移部署。188/336模型预占、17/96外部预占是旧运行账本，**不是本轮调用，也不是未来余额授权**。

PR-6收尾先复核当前代码与旧记录的差异，完成既定测试和质量Gate；本方案不把新CI、论文或长期调度塞进PR-6。CT-1可在隔离环境开发，但产品发布不可跳过PR-6相关恢复、引用和授权Gate。

## 5. 外部依据与方案取舍

2026-10-28只读核查GitHub元数据：以下仓库均非archived、超过500 stars且近期有代码更新。Stars是筛选条件，不是质量或本项目适用性证明。

| 参考 | 观察快照 | 借鉴与不引入的原因 |
|---|---|---|
| [LangGraphJS](https://github.com/langchain-ai/langgraphjs) / [Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) | MIT，3383 stars，pushed 2026-10-28 | 持久执行态与跨会话存储的边界可借鉴。本仓库已有Turn/Mission持久化和worker，不引入第二个执行框架。 |
| [Letta](https://github.com/letta-ai/letta) / [Stateful agents](https://docs.letta.com/v1-sdk/concepts/stateful-agents) | Apache-2.0，25271 stars，pushed 2026-10-18 | 可检查记忆和历史回读有价值；其可由Agent编辑的memory block不适合作为用户授权根。保留原记忆体系。 |
| [Docling](https://github.com/docling-project/docling) / [Document](https://docling-project.github.io/docling/concepts/docling_document/) | MIT，69718 stars，pushed 2026-10-27 | 文本/表格/层级/版面及provenance作为深读adapter设计参考；Python及OCR/模型运行成本需独立验证，首批不默认增加依赖。 |
| [MLflow](https://github.com/mlflow/mlflow) / [REST](https://mlflow.org/docs/latest/api_reference/rest-api.html) | Apache-2.0，28563 stars，pushed 2026-10-28 | run/metric/artifact分离值得借鉴；先兼容项目CSV/JSON，已存在Tracking服务才接REST。不是新建实验管理平台。 |

原论文核查支持评测维度：[LongMemEval](https://arxiv.org/abs/2410.10813)涵盖跨会话、时序、更新和弃答；[LoCoMo](https://aclanthology.org/2024.acl-long.747/)测长程时间/因果理解；[Memora](https://aclanthology.org/2026.findings-acl.1337/)明确关注失效记忆复用；[LoCoMo-Plus](https://aclanthology.org/2026.acl-long.1150/)强调约束在语义变化后的应用。这里只采用其维度，未复现论文实验，也未把其分数移作ProjectMemo门槛。

技术判断：**小型指令事件记录 + 原来源读集 + 按需有效上下文 + 原Runtime内持续调查**更适合现有仓库。新建统一图数据库、大型记忆Agent或把所有业务统一搬进外部框架，没有当前收益依据。
