# R4 UX Integration Contract

日期：2026-10-22。这是 Pre-R4 的界面承载规格，不是 R4 后端实现。领域含义以[最终架构](../R4_FINAL_ARCHITECTURE.md)、[路线图](../R4_FINAL_ROADMAP.md)、[研究裁决](../R4_RESEARCH_REVIEW_AND_DECISIONS.md)为准；配套[总体方案](ProjectMemo_双端功能曝光与UI优化方案_2026-10-21.md)、[原型](PRE_R4_UX_PROTOTYPES.md)。下文“拟”字段/API需在R4工作包冻结，不把它们加入Pre-R4生产响应冒充可用。

## 1. 可实现等级、宿主和交付边界

| 能力 | N：Pre-R4可做 | S：只预留设计位置 | R：等待R4服务 | 责任工作包 |
|---|---|---|---|---|
| Agent过程 | 现有Mission状态/问题/批准/Step/Event/Output/Receipt；有界只读摘要 | 计划重修原因的扩展区域 | 多跳根因、语义读取覆盖、完整失效解释 | UX P11/P21；R4 W1/W2 |
| 项目演进 | Ledger、现有Snapshot/Diff、已发布Episode、直接来源映射；标局限 | 变化→影响详情的分层容器 | Twin新鲜度/覆盖修正、多跳路径、ImpactJob | UX P20；R4 W1 |
| Project Twin / Cross-Layer | 复用概览/资料来源与当前变化，不伪装完整Twin | 分层列表、图切换、影响对象定位 | typed projection/ImpactAssessment与只读API | R4 W1/W2/W4 |
| Decision Lab | 当前行动提案审阅/批准，独立于未来Scenario | 比较页/手机纵卡、后果确认、回执视图 | 私有候选/计算器/持久原子采用 | R4 W2/W3/W4 |
| Proactive2.0 | 原提醒/静默/预算/反馈入口；原Mission问题和接续 | 分级事项和单问布局、订阅授权原型 | 新影响排序/反转去重；周期准备另Target | R4 W5，Target TP |
| Project Sensing | 现有上传/附件来源与处理状态 | 资料页外部候选、关联确认原型 | 单仓库连接/游标/候选采纳/撤权 | Target TE |
| Experience Learning | 查看可观察轨迹与既有结果；不声称有效学习 | 建议旁经验条件说明、暂停入口原型 | Unit/Use生命周期、新任务对照及复用 | MFR索引；Target TB |

N只复用现有业务与必要只读DTO，不新增事实状态；S不在生产显示假按钮、空图或演示计数；R必须在对应服务和权限具备后接入。R4不增加六个一级导航：概览承载变化/主动事项，委托承载缺口/重规划，资料承载来源候选，行动承载方案/排程，成果承载引用复核；经验说明就近展开。

## 2. 当前 Mission 读取与最小 DTO 扩展

### 2.1 已有接口和界面数据

已有 `/api/missions`（创建/列表）、`/api/missions/:id`、`events?afterSeq`、`sources`、`outputs/:outputId`，以及 input/pause/resume/cancel/replan、approvals/:approvalId、constraints、research-scope、continuation-policy、continuations/preview/confirm、artifact-preview/confirm。复用原服务；不要新增“UI执行器”。具体HTTP方法按route.ts，调用时不凭命名猜测。

列表分页每批20；事件按seq递增每批100；详情当前只取最近5份Output。这些是读取窗口，不是对象总量/全量历史保证。UI写“本页/最近修订”，加载更多/按ID读回；不能显示成“仅有5份草稿”。

| 数据 | 当前来源 | 摘要表达 | 缺字段处理 |
|---|---|---|---|
| 目标/运行状态 | AgentMission goal/status/version/contextVersion/planRevision | 短显目标可展开，当前真实状态 | 未识别枚举写状态待确认并保留诊断 |
| 问题 | 当前WAITING_INPUT的QUESTION事件id/payload | 缺什么、需要何种指标/条件、绑定输入 | 无解释字段不由模型临时补造理由 |
| 活动 | Step.status/result、Event.seq/type/createdAt | 已读取/已保存/已受理及对象定位 | 当前Step DTO无时间，使用相关Event或不显示时间 |
| 批准 | PENDING审批proposal/hash/expiresAt | 创建什么、范围、到期和后果 | 来源/计划版本由服务重查，不前端猜测有效性 |
| 输出/采纳 | Output revision/sourceRefs/claimChecks；MissionArtifactReceipt | 草稿、核验、成果采纳分别呈现 | 缺块映射只显示上下文可能影响 |
| 权限/开关 | capabilities、原owner/session校验 | enabled/关闭/无权/探测错误分别处理 | 401登录，其他错误重试，不全部假设关闭 |

**Pre-R4只读扩展（已实施，见实施记录）**：已通过统一 `missionWorkspaceSummary` 服务及 `GET /api/missions/summary?projectId=…` 提供有界项目摘要，返回每项Mission的id、原版本、短显原目标、status、当前question/approval的引用及短文、最近关键活动与真实时间/seq、最新Output引用、分页/截断说明。首页不为每项调完整详情、全部事件或运行模型；OWNER过滤先于读取，不泄漏其他人的任务数量/标题。不得持久第二套状态或客户端自造truth。

暂停/取消已请求但状态仍RUNNING的跨端显示，已将已有pauseRequestedAt/cancelRequestedAt作为**新增可选只读字段**暴露，并适配Web+ArkTS；缺字段的旧客户端仍可运行。优先明确这项适配，不迁移新表。能力探测的网络失败与enabled=false在客户端状态分开即可，不必扩充服务器业务状态。

### 2.2 共享状态语义

| 服务状态/证据 | 双端文案与动作 | 禁止混同 |
|---|---|---|
| READY | 已保存，等待执行；允许现有暂停/取消 | 不写正在处理资料 |
| RUNNING | 正在执行；最近真实活动；暂停/取消请求 | 不虚构思考过程或百分比 |
| WAITING_INPUT | 等待补充；具体问题/选入材料 | 不把新料到达当充分 |
| WAITING_APPROVAL | 等待批准；进入冻结提案审阅 | 摘要点击不直接批准 |
| PAUSED | 已暂停；具体原因；服务允许时恢复 | RUNNING的暂停请求不提前变PAUSED |
| FAILED | 执行失败；错误/已有结果/可行恢复路径 | 不调用仅支持PAUSED的resume |
| SUCCEEDED | 本委托成功条件已验收；看Output/Receipt | 不表示真实项目/实验已经成功 |
| CANCELLED | 已取消；历史可读 | 不删除已执行结果 |
| Approval APPROVED且未消费 | 批准已记录，等待执行 | 不写行动已创建 |
| Step SUCCEEDED + 业务回执 | 工具已执行/行动已创建，按具体结果 | 工具成功不等于现实行动完成 |
| Output存在 / 采纳回执 / Action DONE | 草稿已保存 / 已归入成果 / 已报告完成并可查resultCardId | 三者不共用模糊“已完成” |

派生的displayLabel/section/group只是展示适配；命令允许性、版本和事实有效性仍由原服务决定。只读刷新不自动发resume、批准、采纳或重新生成。

### 2.3 命令、接续和恢复

所有原命令保持requestId/expectedVersion；input绑定questionId，approval绑定proposalHash/id且服务核计划/来源/到期。错误保留草稿；超时先读回同请求/对象，不自动新建请求导致重复写。来源或版本409要求刷新/重新预览，用户重新选择后发新的明确意图。

材料状态严格分层：ARRIVED（上传回执）→相关候选→缺口检查结果→允许接续→READY/RUNNING→成功条件验收。这里的箭头是交互链，不新增一套数据库状态枚举。自动读取分析必须同时满足原Mission授权、服务开关、结构化缺口匹配和合法状态；新行动/成果采纳仍批准。自由文本input转READY只表示重评，不表示充分。

LLM上下文外传、公开搜索范围、自动接续边界三项分别展示和撤销；公开主题授权不允许内部实验、身份、私有全文外传。个人约束来自用户，显示版本/当前限制，不被网页或摘要覆盖。

## 3. Project Twin、时间演进与 Cross-Layer Impact

### 3.1 拟读取契约

拟 `GET /api/projects/:id/twin` 返回只读投影summary、分页scope/cursor、coverage/freshness。UI所需字段与架构对齐：projectionSchemaVersion、ruleVersion、sourceManifestHash、evaluationPhaseKey、evaluatedAt、nextInvalidationAt、coverage；对象引用含稳定entityType/id/revision，解释含ruleId、源修订/时间及支持/反例。缺失字段必须显式unknown/incomplete，不用前端补全。

现有Snapshot schema/policy与Ledger状态不强改成新枚举。既有CURRENT/SUPERSEDED/CONTESTED/UNKNOWN加reasonCode分别渲染；R4原生轴按API版本适配：来源可用性、时态支持、执行记录、即时可行性、未来条件、来源复核、HYPOTHETICAL。一个行内可同时出现“历史已完成”和“当前依据需复核”，不以单一绿色/红色统合。

### 3.2 影响详情

ImpactAssessment需要根变化、受影响对象、impactKind、规则、支持/反例、路径和完整性。kind包括SUPPORT_CHANGED、NEEDS_REVIEW、HARD_PREREQUISITE_UNMET、PLAN_STALE、PENDING_STEP_OBSOLETE。默认分层列表，再可选图；每条路径可定位源/对象及当前状态。sourceCardId仅追溯，soft关联不能伪装hard阻断，替代支持仍满足时解释“部分依据变化”。截断/未覆盖路径直接标出，不显示精确全量影响数。

读取图不写Mission。源变更提交和明确采纳触发ProjectImpactJob；积压时显示“影响重评处理中”，已确定范围与未知范围分开。旧批准EXPIRED、未执行步骤OBSOLETE由服务维护；inflight结果不能越过新版本/fence。已完成步骤、成果、行动回执保留，新证据只新增复核说明或新修订。

### 3.3 时间和历史边界

Pre-R4：展示现有Diff.fromSnapshotId/toSnapshotId、schema/policy和真实evaluatedAt；Episode是已发布修订。无访问时间不写“自上次查看”，无完整历史不提供任意时间滑块。跨规则快照提示不可直接比较；缓存时间边界缺陷未修前不得暗示页面刷新已消除陈旧。

R4 Minimum：当前投影+冻结观察回放，显示“观察于/当时规则”；完整双时态asOf留赛后。UI的更新时间/观察时间不能进入语义manifest造成自失效，也不能代替有效时间。nextInvalidationAt到期应标需重评，不由浏览器直接判卡片真假。

**验收/回退**：缺基线、孤立记录、未来生效/过期/撤销、争议、AND/OR替代、环、来源删除、Job积压均可解释；关闭Twin展示仍能看旧记录/历史。不能把新采用路径降级到不完整一跳检查。

## 4. Decision Lab 与排程采用

### 4.1 进入与比较

宿主：概览重要变化/影响详情的“比较应对方案”、行动页和原Mission提案上下文。完整比较是分享/返回安全的项目内目的地，不新增一级导航。至少两个实质候选，加“不改变当前计划”参照；每候选展示业务delta、确定性计算、模型定性权衡、假设/未知、未安排原因和采纳后果。候选不够时明确结果不足，不复制文本充数。

拟 API：POST `/api/projects/:id/decisions/preview`；GET `/decisions/:proposalId`；POST `/confirm`与`/cancel`。准备返回proposalId/revision/status，202只代表准备受理。BUILDING/READY/FAILED/CANCELLED/EXPIRED/CONFIRMED等由服务持久维护，不能新建客户端并行状态机。新修订用新不可变proposal并关联supersedesProposalId。

比较需proposal owner/project/revision/hash、baseManifest、scenarioKey/deltaHash/metricsHash、规则/求解器版本、expiresAt、准备失败/缺口信息；采用需requestId、expectedRevision、proposalHash、scenarioKey及明确额外确认。字段具体schema以W2冻结为准。

### 4.2 采用、陈旧和回执

采用前逐项列将创建/修改/取消的对象、数量、依赖/排程和影响，旧输出不重写。服务短事务CAS和完整manifest/时间相位重查，原子写业务+receipt+ImpactJob；模型不拥有采用权限。已提交同载荷requestId重放原回执，后续来源变化也不重复创建；异载荷冲突要明确提示。

STALE_SCENARIO_BASE/PROPOSAL_CHANGED/SCENARIO_EXPIRED提示变化或到期，保留旧选择/文本，重新求值产生新提案；REQUEST_ID_REUSED不自动改ID掩盖操作冲突；UNKNOWN_HARD_CONSTRAINT/SCHEDULE_CONFLICT引导补最小输入/调整方案；UNSUPPORTED_DELTA指出不支持的操作。SQLite重试耗尽提示可重试冲突，不显示成功。

Minimum不允许历史成果重写、自动DONE、删源、改权限预算、任意API/SQL和外部写。技术路线选择是决策/假设，实验事实变化仍走来源/关系确认。Pre-R4只能做比较和确认的原型，不能把既有propose_action包装成任意多操作Scenario提交器。

### 4.3 排程与日历

同一约束口径下展示FEASIBLE、PROVEN_INFEASIBLE、SEARCH_EXHAUSTED、UNKNOWN_INPUT；缺工期为UNKNOWN_DURATION，缺期限slack为null。CPM逻辑下界与个人时间安排分区；未来A→B排程不改变B现在BLOCKED。只有完整已声明硬约束通过才可采用可执行安排，未知结果可转调查行动。

应用内CONFIRMED与设备CalendarKit分别有回执。最低范围保留已同步/锁定块或先取得设备撤销回执再替换；部分失败列具体块/重试，不能写全部同步。跨项目个人占用只暴露不可用区间，不泄漏其他项目标题。

**验收/回退**：两个方案并发只采用一个；响应丢失同请求读回；新依赖/撤权/过期/时间跨界拒绝；准备不污染业务；关闭采用入口保留历史/待处理回执，不自动撤销已采用业务。设备同步失败不回滚成“未采用”。

## 5. Proactive 2.0

宿主是概览焦点/待处理队列和原Mission，不是“智能通知中心”新导航。每项显示何种变化、为何影响当前目标、依据及一个当前动作；按重要事项/需回应/普通记录分层，重复根因合并，反转解决原项。无授权/预算/静默/主题抑制不能被UI绕过。

拟数据需求：event identity/root causes、policyVersion、impact refs、priority reasons、question/gap identity、候选/抑制原因、生成/曝光/送达/反馈各自时间与结果。InformationPriority是可解释启发式，不显示概率、金额或“节约价值”。尚未曝光不能推断忽略。

单问交互允许回答、不知道、稍后、停止主题；需要对应持久命令后才启用后两类新语义，不能用关闭toast代替停止。补料后回原Mission重评。公开信息可按scope研究，私有实测只能问用户/提出测量建议。

MFR变化处理/进入时应用内介入；Target TP独立周期准备必须有项目/目的/外传范围/频率/预算/期限/撤销订阅。既有LOW_RISK_READ_ANALYZE不自动覆盖。关闭App后持续监控、系统推送实际送达必须有Worker/发送和设备证据。

**验收/回退**：重复/撤销/无变化/预算耗尽/静默/用户停止均有可解释结果，关键问题不重复催促；关闭新候选后旧提醒继续受原策略保护，不能停来源和计划保护。

## 6. Project Sensing

Target TE才出现资料页“外部候选”区及项目连接设置；默认只读一个明确绑定的GitHub仓库。公开/私有授权分开，凭据只存安全引用，UI不回显token。

拟读取SourceConnection的owner/project/provider/stable repo ID、允许资源、status、lastSuccess/error/retry；ExternalSignal的对象ID/revision、URL、observedAt、hash、净化摘录、候选关联与采纳回执。分页/ETag按资源保存，UI不会把“刚同步过Commit”写成所有PR/Checks已最新。

原始观察→候选关联→用户采纳分别显示。确认页展示将归入哪项目、与哪行动/要求关联、具体信号版本与语义；采纳请求校验版本/归属/幂等。恶意标题/正文仅是资料，不成为工具或权限指令。CI通过只说明对应SHA/check/attempt，PR合并只说明代码整合，完成仍走resultCardId。

**验收/回退**：304、429/403、分页中断、重启、撤权、同SHA多attempt与跨项目关联；停连接不删除已采纳历史，当前不可读来源标可用性变化。未采纳候选不进入事实硬阻断。

## 7. Experience Learning

宿主是建议旁“经验依据”，完整管理在资料/委托历史的二级区域。MFR只做可观察轨迹/结果索引，不能标“已学会”；Target TB才引入经验证的Workflow/Guardrail复用，DecisionPattern按正式范围推进。

拟Unit字段：lineage/revision/project/owner、source mission/step/output/receipt hashes、task family、适用与排除条件、工具/协议版本、步骤/预期观察/停止条件/验证义务、反例、证据等级/有效期、成本和生命周期。Use保留本次候选/命中条件/适配/是否注入/结果/停用原因；不展示隐藏思维链。

生命周期CANDIDATE→SHADOW→PROJECT_ACTIVE，以及SUSPENDED/REVOKED/SUPERSEDED按服务合法转移。用户激活前可查看来源、验证范围/反例、使用成本；激活只允许建议，不能放宽事实/权限/预算。当前用户约束优先，工具/条件变更导致停用/重验，暂停或撤销后不再新注入；已执行历史保留。

结果标签分TOOL_SUCCEEDED、MISSION_CRITERIA_PASSED、USER_ACCEPTED、REAL_OUTCOME_REPORTED/VERIFIED；批准拒绝不自动当失败、重复重试不当独立样本。收益用新任务对照和负迁移/总成本，不写自报95%置信度。跨项目默认不复用，导出/导入需显式脱敏重验。

**验收/回退**：适用/不适用/条件变化、旧新经验冲突、外部污染、撤销、运行中版本重查；关闭复用仍可看历史。若只完成候选提炼/检索，则据实标工程功能，不能声称越用越好。

## 8. 兼容、身份和统一实现边界

旧根锚点继续经projectSectionForHash/projectHref解析，保留query/entity，旧八页继续直达；新增分组不重写记录ID/审批ID/来源版本。Web链接可新标签打开，原生router返回保留原项目/任务。未授权目标显示原有安全错误，不揭示私有存在性。

401/退出/切用户立即清除私有候选/草稿/响应缓存；迟到响应核对身份generation、projectId、missionId和版本；旧响应不覆盖新选择。草稿持久化遵守原用户范围与退出清理策略，不能为“不丢输入”保留到另一个账号。

只建立共享呈现词汇/DTO适配，不新建事实表、Runtime、事件总线或第二文档系统。Context/Output/Registry沿既有分层；可选字段向后兼容，不能靠两端前端实现来源有效性/批准幂等。必要新读接口先审查询上界、归属和副作用，保持首页快速、按需详情。

R4建议开关TWIN_READ/DECISION_PREVIEW/DECISION_CONFIRM/PROACTIVE_IMPACT/SENSING_GITHUB/EXPERIENCE_REUSE为拟名，现代码不能假设存在；实现统一配置。关新入口不撤销历史/已提交业务，不削弱提交保护；旧客户端无法解释新状态时限制新操作，不能默认为成功。

## 9. 交接与冻结门槛

| 接缝 | UX交付 | R4接入前服务证据 |
|---|---|---|
| 状态/演进 | 当前映射、四屏状态集、可比基线说明 | W1时间/规则/coverage和只读性检查 |
| 影响/失效 | typed列表/根因/不完整标记、对象定位 | W1/W2真实读取依赖、Job补偿、旧Worker保护 |
| 方案/排程 | 原计划+两候选、后果/未知、超时/409原型 | W2事务/幂等/并发；W3独立硬约束校验 |
| 双端接续 | 同Mission/Output/Receipt、身份隔离和返回 | W4 DTO、设备/字体/前后台/必要小艺各层回执 |
| 主动/感知/经验 | 宿主/权限/生命周期/停用原型 | W5/TP、TE、TB各自真实服务与效果证据 |

Pre-R4验收只要求N能力真实可用、S有明确规格、R未冒充上线。R4接入再跑新增路径；不能用Pre-R4原型通过替代R4工程、真实模型、设备或发布Gate。UX-4冻结本文时记录仍待W0/W1/W2确定的具体schema/读回方式，不为了“冻结”编造已存在字段。
