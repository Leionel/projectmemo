# R3 分阶段实施规格

日期：2026-10-20。执行范围与优先级以 [路线图](R3_IMPLEMENTATION_ROADMAP.md) 为准。本文件把工作包、持久化、API、工具和验收固定下来，供后续开发 Agent 逐包实施。

## 1. 领取和交付规则

1. 开工先读适用 AGENTS.md、路线图及本包依赖，核对 Git 差异。保留现有用户修改，不用 reset/checkout 覆盖工作树。
2. 一次只领取一个 WP。完成实现、调用方适配、正负测试及证据记录，再推进依赖它的下一包。已有能力满足要求时复用并提供定位，不重复开发。
3. 第二轮规划修订只改两份文档；随后用户授权继续 R3.1/R3.2 实施，保留已有修改，逐阶段验证与提交。下文新增/修改项均是实施契约，领取时先核对实际源码和回执，不等于已实现或已验收。
4. 后续实施在新 `evidence/r3/<时间戳>/<WP>/` 保存命令、退出码、数据来源、模型模式、工作区差异、失败和未运行项；在本文件末尾的实施记录表追加实际结果。额外报告只在确有用途时新增。
5. 真实模型/搜索调用、真实资料外传、设备日历写入、部署、提交推送按用户当时授权执行。缺少外部条件只阻塞对应验收，本地实现和模拟故障测试继续。
6. 每包达到本地完成不等于阶段放行；真实模型、设备、平台各有独立门槛。迁移只先在独立空库和旧库副本演练，禁止 seed/reset 开发库。

## 2. 全局接口与领域边界

### 2.1 执行身份

`MissionActor={userId,projectId,missionId}` 由服务端建立，模型参数不得传 ownerUserId、projectId、批准标识或任意 endpoint。Mission 首版绑定一个项目、一个 owner。创建、输入、批准、继续和事件读取同时检查 Mission 所有者及当前项目成员关系；首版仅 OWNER 开放执行能力，未知角色拒绝。

Worker 每一步重新查询用户和 membership。用户退出某个会话不删除持久委托；后续写批准需要有效会话，成员关系撤销后停止后续访问。不要保存 Cookie/Token 到 Mission Context。

旧业务服务主要依赖 HTTP 鉴权，新工具适配器必须显式执行权限校验，不能只把 projectId 转发。小艺现有共享 Bearer 只能代表固定测试接入范围，不能代替用户身份或批准。

### 2.2 状态机

```ts
type MissionStatus =
  | 'READY' | 'RUNNING' | 'WAITING_INPUT' | 'WAITING_APPROVAL'
  | 'PAUSED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
type PauseReason = 'USER' | 'BUDGET' | 'REVIEW_REQUIRED' | 'DEPENDENCY_UNAVAILABLE';
type StepStatus = 'READY' | 'RUNNING' | 'WAITING_APPROVAL'
  | 'SUCCEEDED' | 'FAILED' | 'OBSOLETE' | 'SKIPPED';
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CONSUMED';
type ResultKind = 'DRAFT_DELIVERED' | 'TOOL_EXECUTED' | 'USER_REPORTED' | 'CRITERIA_CHECKED';
```

合法转移：READY→RUNNING；RUNNING→READY/WAITING_INPUT/WAITING_APPROVAL/PAUSED/SUCCEEDED/FAILED；WAITING_INPUT 经绑定当前问题的合法回答，或第 7 节材料评估及授权检查通过→READY；WAITING_APPROVAL 经批准→READY，经拒绝→READY 重新规划或由用户取消；PAUSED 经继续→READY；FAILED 仅在 recoverable 且预算允许时经显式重试→READY；非终态可取消。SUCCEEDED/CANCELLED 不原地重启；新目标创建新 Mission。

暂停/取消运行中任务先记录请求，下一安全边界生效。已发出的网络请求不保证立即终止；提交业务写之前必须再次检查取消标记。已提交的 Action 保留并展示，不把取消写成自动撤销。

新材料使计划依据失效时：增加 contextVersion/planRevision，将未执行的受影响步骤标 OBSOLETE，使相关旧批准失效；信息缺口未满足则仍 WAITING_INPUT，满足且恢复授权合法才进入 READY。已提交步骤及历史不改写。状态、来源绑定、失效原因和事件原子提交；正在运行的旧片段须在提交时校验版本并丢弃过期结果。

材料到达、与 Mission 相关、足以补缺口、允许继续、任务已完成是不同判断。它们记录为 Event/等待评估，不扩张顶层 MissionStatus；SUCCEEDED 仍须 finish 通过成功条件检查，资料到达不能直接设为成功。

### 2.3 最小数据模型

以下为拟新增表和约束，不修改旧表字段语义。M1 在 WP-10 新增前五表，M2 在 WP-20 新增 ExternalSource，M3 在 WP-30/31 增接续字段及成果归入回执；AgentRun 继续作调用审计，旧 runType 枚举不必扩展。

| 表 | 必需字段 | 约束及生命周期 |
|---|---|---|
| AgentMission | id、ownerUserId、projectId、goal、successCriteriaJson、constraintsJson、constraintsVersion、researchScopeJson、researchScopeVersion、continuationPolicyJson、status、pauseReason、version、planRevision、planJson、contextSchemaVersion、contextVersion、waitStateJson、budgetJson、budgetUsedJson、nextEventSeq、leaseOwner、leaseUntil、leaseEpoch、executionSlot、pauseRequestedAt、cancelRequestedAt、lastErrorJson、createdAt、updatedAt、finishedAt | FK 到 User/Project；unique(ownerUserId,createRequestId)，同时存 createPayloadHash；executionSlot 可空且唯一，非空仅允许 1；首版全局一个执行槽；索引 owner/status、status/leaseUntil |
| AgentMissionStep | id、missionId、ordinal、planRevision、toolName、toolVersion、status、canonicalInputJson、inputHash、readSetJson、effectKey、attempts、resultJson、agentRunId、providerCallId、usageJson、verificationJson、startedAt、finishedAt | unique(missionId,ordinal)、unique(effectKey)；effectKey 对写步骤稳定；输出严格限长；已成功步骤不能被重新执行覆盖 |
| AgentMissionEvent | id、missionId、seq、type、payloadJson、commandRequestId、commandPayloadHash、createdAt | unique(missionId,seq)、unique(missionId,commandRequestId)；用户命令键加 cmd: 前缀，来源信号用服务端 source:<kind>:<id>:<revision/hash> 键；普通事件为空；序号在 Mission 事务内递增；仅存允许展示的摘要与引用 |
| AgentMissionApproval | id、missionId、stepId、proposalHash、proposalJson、expectedPlanRevision、readSetJson、approverUserId、status、expiresAt、decidedAt、consumedAt | unique(stepId)；使用复合关系或事务约束确保 Step 属于同一 Mission；提案冻结，不接受批准请求覆盖字段 |
| AgentMissionOutput | id、missionId、revision、kind、contentJson、sourceRefsJson、claimChecksJson、verificationStatus、createdAt | unique(missionId,revision)；通用 Output 的内容带 schemaVersion/kind；每次修订新增不可变行，来源也固定版本；不直接写 GeneratedArtifact/KnowledgeCard，用户归入另经回执 |
| MissionArtifactReceipt（M3） | id、missionId、outputId、outputRevision、outputHash、artifactId、artifactType、sourceManifestJson、blockMapJson、verificationSnapshotJson、createdByUserId、requestId、payloadHash、createdAt | FK Output/Mission/GeneratedArtifact；unique(outputId,artifactType)、unique(createdByUserId,requestId)、unique(artifactId)；事务内验证同项目/同 Mission，Artifact 与回执同事务提交；永久引用已保存版本 |
| ExternalSource | id、missionId、requestedUrl、resolvedUrl、retrievalMode、title、publisher、publishedAt、fetchedAt、normalizedContentHash、excerptJson、availability、trustLabel | 同 URL 内容变化生成新观察行；unique(missionId,requestedUrl,normalizedContentHash)；权限继承 Mission；哈希指向规范化摘录/文本，不冒称原始网页字节哈希 |

Mission、Step、Event、Approval、Output 为新命名规划；实现前对照 schema 避免冲突。必须声明 User/Project 反向关系和删除策略。项目删除可级联任务私有数据；Action 不因 Mission 删除而连带消失。Step→AgentRun 可空引用、onDelete:SetNull。不得把凭据或网页无限全文塞进 JSON。

字段分期：M1 实现 contextVersion/constraintsVersion/researchScopeVersion（初值 1）、用户约束/授权范围和 continuationPolicyJson（默认 MANUAL）；waitStateJson 为可空的结构化提问。M3 扩展等待记录的 gapId、要求（指标/单位/时间/来源类型）、候选资料及 sourceCursor、assessmentHash、缺口判定和人工决定。M3 的新增 JSON 键带 schemaVersion，旧等待记录按人工补充处理，不推断授权；新 Receipt 表是必要持久关联，不能仅靠 Output JSON 或临时日志替代。

事件同时承载 Mission 内 USER_INPUT、QUESTION、ANSWER、PLAN_CHANGED、TOOL_STARTED/FINISHED、APPROVAL_*、PAUSED、RECOVERED、OUTPUT_SAVED、SOURCE_ARRIVED、SOURCE_ASSOCIATED、GAP_ASSESSED、CONTINUATION_READY/RESUMED、CONSTRAINTS_CHANGED、OUTPUT_ADOPTED；不自动搬入同项目所有人的 AgentMessage。目标/输入修改记录 commandRequestId 和版本，重放同载荷返回同结果，异载荷 409。

### 2.4 Model Adapter 与工具契约

```ts
type ActionChoice =
  | { kind: 'tool'; tool: string; args: unknown; summary: string }
  | { kind: 'ask'; question: string; missing: 'PRIVATE' | 'CRITICAL' | 'CONFLICT'; requirements?: unknown }
  | { kind: 'finish'; outputId: string };
interface ModelDecision {
  choice: ActionChoice;
  provider: string; model: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  protocol: 'NATIVE_TOOL' | 'JSON_CHOICE';
}
interface MissionTool<I, O> {
  name: string; version: string; description: string;
  effects: { businessWrite: boolean; cacheWrite: boolean; externalDisclosure: boolean };
  inputSchema: unknown; outputSchema: unknown;
  execute(actor: MissionActor, input: I, signal: AbortSignal): Promise<{
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED'; data: O | null;
    sources: SourcePointer[]; observedAt: string;
    error: { code: string; retryable: boolean } | null;
  }>;
}
interface MissionActor { userId: string; projectId: string; missionId: string }
interface SourcePointer { kind: 'PROJECT' | 'EXTERNAL'; entityType: 'CARD' | 'CAPTURE' | 'ATTACHMENT_REVISION' | 'ARTIFACT' | 'EXTERNAL_SOURCE'; id: string; revision: string; hash: string }
```

接口是设计契约，input/outputSchema 实现用现有 Zod 并导出具体推断类型，不把 unknown 直接传入领域服务。一次模型决策只接受一个动作；原生返回多个调用时先按协议验证并进入受限修复，不能执行一半后丢掉其余调用。默认不请求并行调用；若 Provider 不支持禁并行参数，由 Adapter 的输出校验约束。

原生模式持久记录 tool_call_id 及脱敏消息结构，恢复时重建 assistant/tool 消息配对；JSON 模式将工具观察作为明确的数据消息。两种模式均记录 schemaVersion/protocolVersion，不保存隐藏思维链。格式错误最多修复一次，消耗预算，仍失败暂停。

| 工具 | 输入边界 | 输出/适配 | 权限与副作用 |
|---|---|---|---|
| inspect_project | 当前 Mission 范围，禁止任意 projectId | 最新状态/新鲜度、关键约束、Health findings；复用 projectState、buildProjectHealthReport | 领域只读；可能存在状态缓存维护，须明确标注；不调用会生成提醒的 evaluateProjectContext |
| search_memory | query≤256 字，limit≤8，historyPurpose 可选 | searchProjectCards + 时态状态；返回具体来源与截断说明 | 不在查询路径无界调用 ensureCardEmbedding；缺向量用关键词并报告 |
| web_search | query、scopeRevision、可选 siteFilter/dateRange；模型不得修改授权范围 | SearchProvider 结果 ID、URL、摘要、时间及 Query Policy 回执 | 网络外传；允许范围内自主生成查询，服务端核对公开主题、允许外传类别及敏感信息；超范围需用户确认，Provider 长度上限另校验 |
| web_fetch | 本 Mission 搜索结果 ID 或用户显式允许的 URL ID | 受限获取、规范化片段、Source ID、获取时间和失败类型 | 公开 HTTPS、SSRF/大小/重定向限制；不允许模型提交任意 URL |
| save_mission_output | kind、schemaVersion、content、sourcePointers；R3.2 扩展研究块、claim 与待补项 | 同一 Output Service 创建新 MissionOutput revision | 任务私有持久写，不改变项目当前事实；无引用的判断标推断或待审核 |
| propose_action | title、description、priority、可选dueAt、依据引用 | 冻结批准预览与 proposalHash | 仅保存提案，不创建 Action；描述不能把公开结果写成项目已完成 |
| inspect_action | 本 Mission 已批准创建/允许查看的 actionId | Action 实际字段和领域回执 | 只读验证创建是否成功；不把 TODO 当完成 |

`commit_action` 是服务端批准后的执行器，不注册给模型。缺少信息时用 ask，由服务端校验并生成 questionId/gapId、结构化 requirements 与等待记录；finish 必须传已有 outputId，由结果验收器决定状态，模型不能指定 VERIFIED。

### 2.5 API 契约

均为拟新增，Node.js runtime。列表/事件需分页；单次最多 100 事件。响应不包含内部 Prompt、密钥或未脱敏网页。非法跨用户/跨项目访问统一 404，未登录 401，范围内权限不足 403，旧版本/请求键冲突 409，功能关闭 503。

| 方法与路径 | 请求 | 响应与语义 |
|---|---|---|
| POST /api/missions | projectId、requestId、goal、successCriteria、missionConstraints、researchScope、continuationPolicy | 202，Mission DTO；同 requestId 同载荷返回同 Mission；不在请求内跑模型 |
| GET /api/missions?projectId=&cursor= | 当前用户作用域 | 分页 DTO，不泄露同项目其他人的委托 |
| GET /api/missions/:id | 无 | version/contextVersion、约束及范围版本、状态、计划、步骤、预算、Output/成果回执、待输入/批准与资料评估 |
| GET /api/missions/:id/outputs/:outputId | 当前 Mission 范围及固定 Output ID | kind/schemaVersion、revision、内容、固定来源与核验状态、归入回执；其他 Mission 的 Output 拒绝 |
| GET /api/missions/:id/events?afterSeq= | cursor | events、nextAfterSeq；重复拉取可去重，重连不丢事件 |
| PATCH /api/missions/:id/constraints | requestId、expectedVersion、expectedConstraintsVersion、set/unset/revoke | 用户会话命令；版本化约束变更事件，影响计划/批准时原子失效；历史保留 |
| PATCH /api/missions/:id/research-scope | requestId、expectedVersion、expectedScopeVersion、scope、continuationPolicy | 用户明确确认，模型不可调用；撤销/缩小立即约束后续调用，扩范围不追认旧外传 |
| POST /api/missions/:id/continuations/preview | 当前 questionId、候选 sourcePointers（可手动选择） | 只读返回关联、缺口充分性/冲突、仍缺项、建议状态及 assessmentHash；不会恢复 |
| POST /api/missions/:id/continuations/confirm | requestId、expectedVersion/contextVersion、questionId、sourcePointers、assessmentHash、用户确认的缺口答复 | 202；重查来源/权限/缺口/预算/约束，过期 409；不足仍等待；满足时原子绑定并入 READY |
| POST /api/missions/:id/outputs/:outputId/artifact-preview | artifactType（既有类型）、expectedOutputRevision | 冻结内容 hash、内外来源清单、块映射、核验快照、项目可见范围及 previewHash，不写 Artifact |
| POST /api/missions/:id/outputs/:outputId/artifact-confirm | requestId、previewHash、expectedOutputRevision、expectedContextVersion | 用户会话显式确认；原子创建 Artifact 历史版本和 Receipt，返回两者 ID；同意图读回，异载荷/旧源 409 |
| POST /api/missions/:id/input | requestId、expectedVersion、questionId、answer；公开搜索范围扩充需用户显式确认 | 202；引用当前问题；保留原输入历史 |
| POST /api/missions/:id/approvals/:approvalId | requestId、decision、proposalHash、expectedVersion | 202；只决定批准/拒绝，不能附新工具参数；工作进程负责提交 |
| POST /api/missions/:id/pause | requestId、expectedVersion | 202；运行中显示暂停请求已接收，安全点后转 PAUSED |
| POST /api/missions/:id/resume | requestId、expectedVersion | 202；不重置累计预算，不重放已成功步骤 |
| POST /api/missions/:id/cancel | requestId、expectedVersion | 202；保留已发生的副作用和回执 |

preview 接口不运行模型、不调用外网、不写业务对象。confirm 重查哈希覆盖的 Output、来源、约束及范围版本；来源不变不能只靠 Project.updatedAt 判断。所有 PATCH/确认执行第 2.1 节权限及持久请求幂等；用户命令不能伪造服务端来源信号键。成果归入可在 SUCCEEDED 后执行，不重开 Mission；取消任务的归入先拒绝。

预算上调不混在 resume：首版在详情明确展示预算耗尽，由用户确认新增额度的独立管理命令处理；未实现该命令时保持暂停，不自动重置。GET 和轮询不触发业务执行。

## 3. 可靠执行的不可省略部分

### 3.1 Worker、租约和事务

新增独立 `scripts/mission-worker.ts`，复用同一代码版本和数据库；Web API 仅写 READY。每片段最多一次模型决策和一个工具，完成落盘后续片段再选择。首版不使用 SSE、Redis 或进程内 Map 作为任务真相。

领取时在短事务内回收已过期执行槽，将选中 Mission 的 executionSlot 设为 1、leaseEpoch 加一、写 leaseOwner/leaseUntil。唯一槽约束控制全局并发；每次提交、续租、释放必须匹配 owner+epoch。建议初值：lease 60 秒、heartbeat 10 秒、模型/网页单请求上限 20 秒；最终由探针结果调整且请求超时必须小于租约。

Worker 失联后，只读步骤可重试；已成功副作用根据稳定 effectKey 读回执；正在执行但无法证明结果的外部副作用进入人工核对，本轮不提供此类工具。旧 Worker 恢复后不得提交结果或清除新 Worker 的租约。

批准创建 Action 的原子事务必须：先条件校验 Mission fence/取消状态并取得写锁 → 重查身份、批准 TTL/哈希/版本、源 readSet → 按稳定 effectKey 创建或读取 Action → 消费 Approval → 写 Step 回执、Event、Mission 游标。模型和网络在事务外。刷新快照等后处理失败只标 pending，不丢业务回执。

不得先调用当前 `createAction()`，然后另一次事务保存 Mission 回执。应在 `lib/repositories/agent.ts` 提取最小 `createActionInTx(tx,...)`，复用已有校验；对 Action 使用现有 dedupeKey 唯一能力，命名 `mission:<missionId>:step:<stepId>`，不是按标题去重。

### 3.2 读集和批准版本

readSet 固定实际依赖对象的 ID、内容/修订哈希、行动状态与 dependencyVersion、关系确认/撤销及有效时间。批准提交时在同一事务重新读取原始对象，用现有纯时态判定函数复算。

Project.updatedAt、snapshotId 和缓存 freshness 只能作提示，不能单独证明所有依据未变。未执行步骤发现来源变化后废弃旧批准并重新预览；用户确认不能把旧来源变成新事实。

### 3.3 预算和停止

建议起始上限：每 Mission 12 次模型决策、16 次工具、3 次搜索、4 次网页获取；一片段一次决策；活动执行累计 180 秒；上下文约 6000 token、单次输出约 1000 token。是待校准配置，不是性能实测。

调用前原子预留次数、时间/输出 token 上限和可计费请求，失败和修复也计数。网络超时导致 usage 不明时记录 UNKNOWN，按保守额度保留占用，不填 0 成本。usage 可得时结算，实际人民币/美元预算由负责人授权额度和 Provider 费率决定。

相同 tool+inputHash+readSet 连续两次无新信息即停；失败自动重试最多两次并退避，401/403/无效输入不盲重试。预算耗尽、关键冲突、缺私有信息、需批准均是可操作暂停/等待，不是继续生成的理由。

### 3.4 上下文与来源

装配顺序：系统权限/用户约束 → Mission 目标和成功条件 → 最新结构化状态 → 当前计划、成功步骤和待批准 → 最近不超过 6 轮任务输入/回答 → 相关时态记忆 → 外部摘录。Context manifest 记录选入/排除的来源、版本、预算与原因。

先削减重复工具正文和网页长文，不能裁掉用户否决、未知状态、批准范围或来源版本。摘要带源事件序号和 schemaVersion，不可修改原事件；本阶段不建设自动个人记忆写入器。

Research Scope 包括用户确认的公开主题、允许的子问题/资料类型、允许外传的信息类别、明确排除项、可选站点/日期限制及版本。例如批准“近期 3D 医学图像分割方法及公开模型性能”，允许 Agent 自主检索论文、模型、公开评测和方法对比；这不批准外传内部实验指标、未公开结论、身份或私有文档。

服务端 Query Policy 在发送前检查 scopeRevision、主题/类别、敏感标记与禁止内容。查询构造使用独立的“公开研究视图”（授权范围及已公开来源），不直接把完整 Mission/私有上下文放进搜索参数；模型建议的 query 仍需校验。仅靠敏感词或语义相似度不能证明安全，来源不明/分类不确定或超范围时拒绝，提示用户确认公开摘要或扩范围，不能用模型自评绕过。已允许主题内的新查询无需逐条确认。

审计接受的规范化公开 query、范围版本、Provider、时间及实际外传类别/内容摘要；拒绝请求只存 hash、拒绝类别和原因，不在日志复制私有文本。LLM Context 的外传授权独立配置，研究范围批准不能给云模型全项目访问权，云模型许可也不能变成搜索许可；所有凭据留在 Adapter 服务端。

网页与工具输出都作为不可信数据。Prompt 分区不能独自保证安全，权限、工具名白名单、来源作用域和批准必须由代码执行。外部指标即使引用正确，也只能是外部报告，不关闭本地实验 Gap。

推荐先验证 DeepSeek Search，并使用本地受限 HTTPS 获取器：域名白名单、仅 443、拒绝 userinfo/私网/回环/链路本地/元数据地址和 IPv4-mapped IPv6；解析全部地址并绑定验证后的连接 IP，保持正确 TLS hostname；每次重定向重新检查，最多 3 次；请求和解压后正文分别限长，初值 512 KiB；仅解析文本/HTML，不执行 JS/下载二进制。HTML 解析可新增一个直接依赖，不用正则替代解析器。

若 WP-00B 选 DeepSeek Fetch 替代本地获取，必须记录 `PROVIDER_EXTRACT`，官方返回的规范化文本不等于原始响应；最终 URL/重定向链不可见时 resolvedUrl=null、来源身份待核实，不能宣称已验证最终域名。只能向配置固定的服务端 endpoint 发送 URL，密钥不转发目标网站。两条获取路径择一实现，不同时铺开。

### 3.5 Mission-level Personal Constraints（Minimum，WP-10）

constraintsJson 使用有版本 Schema：availableMinutes、resourceLimits/costCeiling（含币种及是否禁止付费）、deadline/priority、forbiddenApproaches、rejectedActions（带稳定意图/依据，不只标题）、executionBoundary。每项带用户确认来源 Event 与有效状态，未提供为 UNKNOWN；系统预算和安全策略始终是更严格的上限。用户在创建或专用编辑界面提供/确认，查看、修改、逐项撤销保留历史。

硬约束进入每轮 Context 和服务端工具前置检查；时间/优先级进入计划排序，费用/资源/禁止方案进入调用与提案检查。无法机器判定的方案先 ask，不能把模型摘要视为批准。约束变更增加 constraintsVersion/contextVersion，并使受影响未执行步骤/批准失效；Runner 提交再次核对版本。外部网页、普通输入摘要与模型输出不能改约束；普通回答中的否决需用户确认后归入，不能静默画像。自动执行范围撤销即停后续自动恢复，仍可人工补资料。

### 3.6 一套 Output 生命周期（WP-10 → WP-21 → WP-31）

WP-10 的 outputService.ts 唯一负责校验、不可变 revision、持久化、Step/Event 回执及读取；保存 Output 与对应成功 Step/Event 在同一事务，按稳定步骤意图去重，崩溃重放不能多增版本。通用内容为 {schemaVersion,kind,blocks,resultRefs}，来源为固定版本 SourcePointer；kind 首版可用 NOTE/RESEARCH，不为研究另建草稿状态机。WP-21 只增加 researchOutputSchema.ts：blockId、text、kind（PROJECT_OBSERVATION/EXTERNAL_REFERENCE/INFERENCE）、sourcePointers、claimChecks、missingInformation。保存仍通过 save_mission_output/outputService，来源归属与版本由服务端校验。

Output 的“已保存”“来源结构合法”“语义支持”“任务完成”“已归入成果”分开；归入通过 WP-31 回执引用固定 Output 行，不能把旧稿覆盖为新稿，也不能自动将任何块升级 CURRENT。

## 4. R3.0：基线和关键能力探针

### WP-00A：建立可复用候选基线

- **目标/范围**：保留路线图第 2.3 节五项修复/回归任务，按调用依赖区分阻断与非阻断，保存当前工作树差异；不改产品导航、不统一重构服务。估时 0.5–0.75 日，依赖无。
- **复用/文件**：projectReentryService、AttachmentService/校对组件、KnowledgeCardView、ReentryBrief、EpisodeCheckpointCard、ProjectHome；新增真实原件读取路由时复用附件 storageKey 安全定位和 authorizeProjectAccess。
- **数据/API**：原件下载校验项目归属、响应类型和路径；附件 CAS 若现有字段不足，可增加明确 revision/version，必须兼容旧调用方并补独立迁移；否则用事务内条件更新和实际旧值避免空值绕过。不删除修订链。
- **测试/Gate**：PARTIALLY_STALE 受影响句不显示为当前；原件链接实际 200 且越权 404；空基线/非空基线并发两次不同纠错只有一次生效、另一 409；重复同意图不重建卡；两端跳转具体实体；模拟受阻任务不进真实首屏。运行相关单测、类型、lint、Web/鸿蒙受影响检查。
- **回退/环境/Demo**：无外部 API；按功能小步回退，保留原始材料和用户修改。交付一条 A→B 来源变化和材料纠错的真实路径。五项未全关闭时不宣称全部基线放行；仅相关依赖阻断对应工具/验收，允许独立 Provider 探针和不依赖缺陷路径的隔离 Runtime PoC。来源有效性、授权、状态和写一致性阻断不能为演示豁免。

### WP-00B：Provider、搜索、环境和题集探针

- **目标/范围**：估时 0.5–0.75 日；立即开展，不以 WP-00A 全部完成或 Runtime 完成为前提。新增拟定 `scripts/probe-mission-provider.ts`、`scripts/probe-mission-search.ts` 和脱敏 fixture；不修改旧模型调用语义、不创建业务任务。
- **探针**：同一模型做“仅查内部”“必须查外部”“缺私有指标应提问”三类变体；验证 tools、tool role、usage、非法 JSON、超时和错误类型。外部搜索验证有结果/无结果/限流，Fetch 验证实际正文、来源元数据和失效页面。每类至少 3 次，保留原始脱敏输入输出与版本。
- **决策**：原生工具协议通过则使用 NATIVE_TOOL；否则严格 JSON_CHOICE 再测。优先验证当前 DeepSeek 独立 Search/Fetch；账号或效果不满足时只选一家替代搜索服务，默认候选 Brave。不自动开账户、买额度或并接多家。
- **环境/Gate**：真实探针需要用户授权的模型/搜索额度和脱敏主题；无授权时 fixture 合同验证可完成，MODEL/SEARCH Gate 待验证。核实实际 Node、SQLite 模块、设备/签名/小艺条件，不能从部署样例推断现网。形成 Minimum 12/Target 30 个留出任务的标注模板，开发集与留出集隔离。
- **Schema/回退**：不需要业务迁移。探针失败只关闭相应能力，不把 mock-fallback 标为真实成功。输出协议选择、获取方式、超时与额度建议，为 WP-10/20 定参数。

## 5. R3.1：内部多步执行与恢复

### WP-10：持久 Mission 纵切片

- **目标**：用户委托内部材料整理，模型自主调用 inspect_project/search_memory/save_mission_output，至少三种工具并利用观察继续。估时 1.5–2 日，依赖 WP-00B 的协议选择及 WP-00A 中实际读取路径的阻断项；全部五项修复不是 Runtime 开发前置。
- **拟新增**：`lib/mission/contracts.ts`、`repository.ts`、`missionService.ts`、`runner.ts`、`modelAdapter.ts`、`contextBuilder.ts`、`outputService.ts`、`constraintsService.ts`、`toolRegistry.ts`、`budget.ts`；`lib/mission/tools/projectTools.ts`；`scripts/mission-worker.ts`；Mission 创建/读取/事件/输入/约束/授权范围/暂停/继续/取消路由；Web 最小 `components/mission/MissionPanel.tsx`。
- **修改/迁移**：M1 新增第 2.3 节前五表，Prisma 生成遵循既有路径；User/Project 反向关系、可空 AgentRun 关联。旧表/客户端响应保持兼容。对读工具禁止顺便运行提醒评估。
- **测试**：状态机合法/非法转移；相同创建请求重放/异载荷 409；跨用户/跨项目读写 404；Worker 中断后读取同一输出与事件；等待输入不轮询调用模型；失败 usage 仍计预算；Output 同意图重放不新增 revision、历史行不可变；约束修改/撤销影响后续工具及旧批准，网页/摘要不能覆盖。
- **真实/E2E Gate**：真实模型三类任务轨迹有合法差异，工具选择不是预写；Worker 停掉后页面仍可读；重新启动可继续。无真实模型权限时本地 Gate 可关闭，真实 Gate 不关闭。API 请求快速 202，不等待模型。
- **开关/回退/Demo**：`MISSION_ENABLED=false` 隐藏入口并拒绝新命令；Worker 可独立停止，旧 Copilot 照常。演示关闭页面后重新进入同一 Mission；不用引入框架或完整聊天迁移。

### WP-11：一次批准、一次 Action 原子创建

- **目标**：Agent 提案验证工作，用户批准后创建待办并读回。估时 1.5–2 日，依赖 WP-10。
- **拟新增/修改**：`lib/mission/approvalService.ts`、`toolExecutor.ts`、`tools/actionTools.ts`；批准路由；`MissionApproval` Web 组件；在 `lib/repositories/agent.ts` 提取事务内 Action 创建函数，保持旧 createAction 外观。
- **契约**：复用 M1 Approval/Step，Action.dedupeKey 使用稳定 effectKey；proposalHash 覆盖工具版本、所有参数、用户/项目、readSet、planRevision、到期时间。初始批准有效期 10 分钟；过期必须重新预览。
- **测试/Gate**：批准前 Action=0，拒绝不写入；篡改/过期/旧来源批准 409；20 次同意图并发只生成一个 Action；提交完成后丢响应再重试仍返回同 ID；其他项目行动不能作为源。取消与批准竞态不能在取消生效后新建 Action。
- **真实/E2E/回退**：真实模型可提出不同建议，服务端只提交已冻结字段；工具回执读回 title/status/source/dedupeKey。`MISSION_WRITES_ENABLED=false` 保留草稿/预览、拒绝执行；关开关不会把提案误标成功。本包无第三方写入，不能演示实验已完成。

### WP-12：崩溃、租约和预算故障门禁

- **目标**：估时 1 日；依赖 WP-10/11。补 `tests/missionRecovery.test.ts`、`missionBudget.test.ts`、`missionConcurrency.test.ts` 和受控本地进程测试夹具；不增加功能工具。
- **故障矩阵**：领取前、模型响应后未保存、批准等待、业务事务提交前、业务提交后未回包、租约过期、旧 Worker 恢复、两 Worker 同抢任务、不同任务抢全局槽、搜索/模型超时 usage 不明、连续相同调用无进展。
- **Gate**：每个写故障点重复 10 次，重复 Action=0；过期 fence 提交=0；全局有效执行槽≤1；事件 seq 单调且无重复；resume 不补满预算；预算预留失败时不发请求。网络调用不占长事务。
- **环境/迁移/回退/Demo**：独立测试库、fake Provider/clock、mock 工具，真实恢复再用少量已授权模型调用复核；不新迁移。失败阻塞 R3.1 放行，停止新增工具。演示强制结束 Worker 后启动同代码，继续原 Mission。

## 6. R3.2：真实外部信息和任务上下文

### WP-20：Search、Fetch 与来源存证

- **目标**：真实搜索并读取网页，保存可追溯外部参考。估时 1–1.5 日，依赖 WP-00B、WP-10 的 Registry/权限；首次集成放行需 WP-12。
- **拟新增**：`lib/research/contracts.ts`、`searchProvider.ts`、选定 Provider Adapter、`safeFetch.ts` 或选定托管 Fetch Adapter、`sourceRepository.ts`、`queryPolicy.ts`；`lib/mission/tools/researchTools.ts`；来源读取 API（当前 Mission 鉴权），Web 来源列表。
- **迁移/配置**：M2 增 ExternalSource；`MISSION_WEB_ENABLED` 默认 false，独立 `MISSION_SEARCH_PROVIDER`、获取方式配置和搜索密钥引用；不从模型提供的 baseUrl 读取。DeepSeek 已有 key 仅在明确授权后使用，不读取/打印真实 key 做规划。
- **测试**：有结果、空结果、过期来源、网页 404、429/5xx 退避、正文超限、类型拒绝、私网/IP 编码/IPv6/重定向/DNS 重绑定、同 URL 更新、网页指令诱导外传或创建行动、其他 Mission 的 Source ID。测试请求使用本地受控 fixture，不攻击真实服务。
- **Gate**：真实任务至少两条可读取来源及获取时间，搜索摘要与正文摘录分别标识；来源变化保留旧行；外部资料不增加内部 CURRENT 卡片或关闭实验 Gap；仅内部任务对外搜索 0；同主题新查询无需逐条批准，私有数据夹带、越范围、scope 过期、撤销授权、中文/英文改写和编码外传均在请求前阻断；查询审计不泄露被拒私有原文。SSRF 失败则关闭 Fetch，不为演示改成任意 URL 代理。
- **回退/Demo**：关闭 Web 只保留内部委托和明确标记的已缓存来源；真实外部 Gate 未过不称 Minimum 完成。演示现场搜索与一个失败 URL 的替代处理。

### WP-21：Research Output 扩展、多轮上下文与缺口提问

- **目标**：模型能理解“先做第二项”，知道哪些信息能搜索、哪些必须问用户。估时 1–1.5 日，依赖 WP-20、WP-11。
- **拟新增/修改**：扩展 WP-10 的 `lib/mission/contextBuilder.ts`/`outputService.ts`，新增 `researchOutputSchema.ts`、`sourceRouter.ts` 和研究 Output 组件；M1 Output/M2 Source 复用，不再新增 Draft Service 或对话库。原 AgentMessage 不全量迁入。
- **契约**：草稿块包含 blockId、text、kind（PROJECT_OBSERVATION/EXTERNAL_REFERENCE/INFERENCE）、sourcePointers、待补项；关键引用给出规范化片段起止位置与哈希。用户答复绑定当前 questionId 和 expectedVersion，否决记录进入后续上下文。
- **测试/Gate**：最近 6 轮指代与被否决方案不丢；任务修改后旧计划失效；来源不足时提出一项必要问题而非编造；达到上下文上限时约束和来源 ID 不被截断；同项目另一个用户的消息不进入 Context；公开论文数值不变成项目实测。
- **真实/E2E/回退/Demo**：真实模型执行内部/外部/混合/缺私有指标四类任务。自动摘要失败回到有界原事件，不假装保留全文。Web 关闭时只停依赖 Web 的步骤，用户可继续补内部资料。本包先验显式回答原 questionId 后继续同 Mission；Capture/Attachment 到达识别与接续评估由 WP-30 增量接入，不在此重复实现。

## 7. R3.3：验收、失效和结果回写

### WP-30：成功条件、来源失效与材料事件接续

- **目标**：估时 0.5–0.75 日，依赖 WP-12/21；新增 lib/mission/resultVerifier.ts、readSetValidator.ts、continuationService.ts、sourceSignals.ts 及 tests/missionVerification.test.ts、missionContinuation.test.ts。不做通用 NLI、事件总线或自主调度平台。
- **验收契约**：successCriteria 是有类型的检查项，如 DRAFT_EXISTS、SOURCE_COUNT、ACTION_CREATED、APPROVAL_CONSUMED、REQUIRED_INPUT_PRESENT；描述与确定性检查器配对。创建后模型不能降低标准，用户修改须版本事件。finish 只能引用已有 Output；来源、批准或实际 Action 缺失不能通过对应条件。草稿交付不表示现实实验通过。
- **Minimum 材料接续**：复用已有 Capture、Attachment/修订记录、Mission Event 和 Worker，仅处理本项目已有 WAITING_INPUT 的 Mission，Minimum 每个 Mission 只保留一个当前等待问题/缺口，不实现多缺口并行调度。Agent 提问时保存 gapId/questionId、预期指标/单位/时间/来源类型、当前 readSet 和授权边界。来源到达后产生去重信号，形成候选，展示关联依据、缺口是否满足及剩余问题；用户预览、确认材料与答复后，服务端校验并恢复同一 Mission。无需重新委托目标或重新提交已有成果。关联和充分性不明时保留等待，可让用户明确选择与回答。
- **五层判断**：SOURCE_ARRIVED 仅证明持久来源存在；SOURCE_ASSOCIATED 检查项目/所有者访问、等待问题及来源关联，不靠关键词命中就补缺口；GAP_ASSESSED 标 SUFFICIENT/INSUFFICIENT/CONFLICT/UNKNOWN，按问题要求、可读取状态、指标单位及版本判断；CONTINUATION_READY 另检查授权、预算、当前状态和版本；SUCCEEDED 仅由任务成功条件验收。解析未完成/失败的附件可记到达，但不能当可用正文；外部论文指标不能满足本地实验缺口。
- **持久信号与漏报补偿**：优先在现有来源保存流程追加轻量通知适配，通知只携带来源 ID/版本。进程内回调不是唯一依据：Worker 按等待起点和持久 sourceCursor 分页补查 Capture/Attachment 修订，采用重叠扫描及稳定 source:<kind>:<id>:<revision/hash> 去重，覆盖迟提交及通知后崩溃。不能只比较 Project.updatedAt，也不对全项目持续语义搜索。无候选时不调用模型；同一信号不重复付费评估。Minimum 的候选与人审无需额外模型调用。
- **原子接续**：确认时在短事务重查身份、资料版本、questionId、assessmentHash、contextVersion/约束版本和取消标记；先按持久请求键读已提交回执，同意图返回原结果；新命令重查当前状态，旧候选 409。绑定来源并增加 contextVersion；新证据改变计划时增加 planRevision，将相关未执行步骤标 OBSOLETE、使旧批准失效，写评估/计划/恢复事件后才允许 WAITING_INPUT→READY。不足或冲突仍等待。已成功步骤、旧 Output、已消费批准和执行回执保留；旧运行片段提交必须检查新版本，不能覆盖新计划。
- **Target 自动恢复**：在同一 WP 的可选分支提供预先确认的 LOW_RISK_READ_ANALYZE 模式。仅结构化缺口可确定满足、无冲突、授权/预算有效时自动入 READY；自动片段只可读取、检索、分析及保存任务私有 Output，超范围搜索仍拒绝，Action 和成果归入仍单独审批。不得自动提高预算、扩范围、改用户约束或重复旧写操作。复杂语义判定、未经预授权或结论不确定均回到人审；停止在新的审批/问题边界。
- **测试/Gate**：无关材料、不足指标、单位/时间不符、冲突结果、附件解析失败均不误恢复；同资料重复到达 10 次只形成一个候选；漏通知/重启/迟提交可补查；撤权、撤自动许可、耗尽预算、取消竞态禁止恢复。来源 A→B 只废弃相关未执行步骤，旧批准 409；双 Worker 仍最多一个执行槽。对照接续前后 Mission ID、成功 Step、旧 Output hash 和历史批准均保留。Target 另测“充分但无授权”“有授权但不足”不自动执行，新写仍待批。
- **Schema/回退/Demo**：M3 扩展 waitStateJson 的候选/评估/cursor，复用 Event 去重及现有租约；不改 ActionStatus。MISSION_EVENT_CONTINUATION_ENABLED 关闭后回到显式选择来源、回答原问题；MISSION_AUTO_CONTINUATION_ENABLED 默认 false，失效时先降人审。校验器异常显示 NEEDS_REVIEW/暂停，保持来源与历史。演示退出→补实验材料→同 Mission 修订方案继续，而非只重启进程。

### WP-31：结果读回与受控成果归入

- **目标**：估时 0.5–0.75 日，依赖 WP-11/21 的稳定 Output/来源接口；可与 WP-30 交错准备，最终集成需通过 WP-30。复用既有 GeneratedArtifact 保存、编辑历史与审计，不另建文档系统；M3 新增第 2.3 节 MissionArtifactReceipt，持久保存版本映射、来源和幂等确认回执。
- **结果链**：分别展示 DRAFT_DELIVERED、TOOL_EXECUTED、USER_REPORTED、CRITERIA_CHECKED；创建 Action 读回仍是 TODO。用户真实完成行动沿 completeProjectAction 保留 resultCardId，再将真实结果引用挂回 Mission；Mission 成功不代替行动完成。
- **最小归入链**：研究 Output → 用户预览固定 revision 的内容、来源/核验状态及项目可见范围 → 用户确认 → 保存一个既有 artifactType 的成果历史版本（Minimum 只接现有 weekly_report（项目周报）作为阶段汇报载体，其余类型后置） → 后续 Mission 检索/引用。现有 GeneratedArtifact 没有数字 version，保存新版本会新建一行并按 createdAt 列出历史；以 artifactId 引用这一固定版本，禁止假设或另造数字文档版本系统。
- **文件/事务**：新增 lib/mission/artifactAdoptionService.ts；在 lib/repositories/artifacts.ts 提取 saveArtifactInTx，旧 saveArtifact 外观不变。事务内重查用户/项目、Output revision/hash、上下文及实际源版本，原子提交 Artifact、Receipt 和 OUTPUT_ADOPTED 事件。Receipt 固定 missionId、outputId/revision/hash、artifactId/type、内外来源清单、块到 claim/source 的映射及核验快照；同 outputId+artifactType 只归入一次。不同内容须先保存新 Output revision，同 requestId 异载荷 409；写后丢响应重试先读持久回执返回原 artifactId，不因之后来源变化重复创建；新归入意图才重做当前校验。
- **来源与事实**：现有 Artifact claims 解析只认 TEMPLATE_BOUND/UNMAPPED_MODEL，sourceRefs 主要按 cardId 处理。保留旧报文语义，新增审计/呈现路径通过 artifactId 联查 Receipt；不能把 ExternalSource ID 塞成 cardId，也不能标为 TEMPLATE_BOUND 来暗示已支持。每块区分外部参考、项目观察、推断/缺口，归入保留 NOT_CHECKED/UNKNOWN 等状态；核验快照不是当前真值。确认归入只批准成果保存及明确的共享内容，不是确认 Claim；项目事实改变仍走 Temporal Ledger 原有确认流程。
- **后续检索/影响定位**：扩展同一个 search_memory 适配器，可检索本项目有权查看的已归入 Artifact（Minimum 关键词即可），仍限现有结果预算，不加第八个工具。SourcePointer 为 PROJECT 时补 entityType（CARD/ARTIFACT 等）；ARTIFACT 用 artifactId/contentHash 指固定版本，返回命中块、Receipt ID 和核验状态，再由同一 Context Builder 装配。Receipt 按来源 ID/修订/hash 映射 blockId/claimId；读取审计/重新使用时重新核对 Ledger 及已有来源观察，标记受影响块为 STALE/CONFLICT/UNKNOWN，不改写历史正文或自动发布新稿。网页变化只有已重取形成新观察或已知不可用时才可判断，未重取只显示截至时间，不声称持续监控。
- **可见性/保留**：归入时仅将用户预览确认的必要摘录、来源和块映射放入项目可见成果快照；后续 Mission 不因此取得原 Mission 私有对话或其他外部来源。原始私有记录访问仍查原权限。已有归入 Receipt 的 Mission/Output 不物理级联删除，使用保留/隐藏策略及限制删除关系；项目整体删除按既有授权处理。后续人工编辑产生的新 Artifact 版本不盲继承旧块支持关系，未重新映射的内容显示未核验。
- **测试/Gate**：预览不发布、拒绝不写；跨用户/项目、旧 Output/源/上下文、篡改 hash 拒绝；并发及失败回滚确保 Artifact 与 Receipt 同有同无，重试不重复版本；外部指标不能升级项目实测。后续 Mission 能找到归入版并引用固定来源；来源失效能精确定位块；编辑新版本不继承无效支持；旧 Artifact API/审计回归通过。现实结果完成重试不重复复盘卡。
- **回退/环境/Demo**：无新第三方，MISSION_ARTIFACT_ADOPTION_ENABLED 关闭只停新归入，保留 Artifact、Receipt 和审计读取；新增 Artifact 属于批准后的业务副作用，不反向删除。结果引用补链失败可按持久回执修复。演示旧稿与修订稿保留、确认归入、后续 Mission 重新检索，并显示一个失效来源的影响。

### WP-32：关键 Claim 语义核验（Target）

- **目标/估时**：2–3 日，依赖 WP-21/30；新增 `lib/mission/claimVerifier.ts`、关键数字/单位/否定规则、Judge Adapter 和人工标注 fixtures。仅核验研究稿关键句，不重写旧 trustReceipt 的支持语义。
- **契约**：每句保留 claimId、来源片段/hash、STRUCTURAL_CHECK、ENTAILS/CONTRADICTS/NOT_ENOUGH_INFORMATION/NOT_CHECKED、判定模式与版本。结构合法不自动推出 ENTAILS；外部主体与内部主体不一致必须被规则拦截。
- **测试/真实 Gate**：支持、矛盾、数字错配、单位错配、条件遗漏、来源失效和全拒答反例；标注至少两人独立判读关键子集并保留分歧。报告支持精确率、错误支持和过度拒答；高风险错误自测归因=0，普通关键句支持率目标≥90%。
- **迁移/回退/Demo**：复用 Output.claimChecksJson 并版本化；`MISSION_SEMANTIC_CHECK_ENABLED=false` 时显示未做语义核验，不能显示通过。真实 Judge 使用授权额度；失败回退精确摘录+人工审核。演示一条引用存在但语义不支持的反例。

## 8. R3.4：原生接续与可选入口

### WP-40：Web ↔ 鸿蒙同一 Mission（Minimum）

- **目标/估时**：1.5–2 日，依赖 Mission API 冻结与 WP-31。新增 ArkTS `models/Mission.ets`、`services/MissionService.ets`、`components/MissionPanel.ets`、`MissionApprovalSheet.ets`、`MissionEventList.ets`、任务详情页面；ProjectHome/问忆程仅嵌入入口。Web 对应 `components/mission/`。
- **交互**：创建目标、查看/编辑/撤销个人约束和研究范围、状态/步骤、来源、待输入、资料候选/缺口评估与确认接续、批准拒绝、暂停继续取消、成果预览/确认归入；中文状态含原因和时间，不仅颜色；不展示隐藏推理。轮询可初始 1.5 秒、稳定后 5 秒，退后台停止；重进按 afterSeq 续读。
- **API/Schema**：复用第 2.5 节 API，无端侧第二套状态；客户端 Token 失效先登录，再读服务端任务，不自动重发已批准写操作。202 表示受理，不能显示执行完成。
- **测试/Gate**：Web 发起、鸿蒙读同 ID 并批准后两端 Action ID 相同；断网/重复点击/会话失效/冷启动/取消竞态；长目标、键盘、大字号和失败重试；退出后通过 Capture/Attachment 补资料，重进显示相同 questionId 和历史，确认接续与成果归入两端结果一致。运行 harmony:test/build 与 Web 受影响 E2E；目标设备干净安装并完整操作一次。
- **回退/环境/Demo**：保留当前 Constants 单一地址来源及已有签名配置，不导出私钥；`MISSION_UI_ENABLED` 关闭新入口不影响旧工作台。无设备时交付代码/编译，DEVICE Gate 保留未验收。

### WP-41：小艺受限接续（Target）

- **目标/估时**：1–2 日，依赖 WP-12/40 及可用平台。新增 `lib/xiaoyi/inspectMissionService.ts`、`resumeMissionService.ts`、契约和相应路由；不把平台工作流变成第二个 Runner。
- **身份/API**：专用测试用户/项目及 Mission 白名单的服务端映射；仅查询/继续已授权只读范围，批准必须返回 App 的有效用户会话。Mission ID 本身不是访问凭证，不能由请求任意指定 owner。
- **Gate**：平台实际入口调用同一 Mission，状态和事件 seq 与 App 一致；越权 Mission 404；重复 resume 不重置预算或重复写；小艺无批准能力时明确跳回应用处理。深链另核对正式 SDK/平台和设备，不把 URL 文本当作可用跳转证据。
- **迁移/回退/Demo**：优先复用服务器测试配置，不建通用 OAuth 体系；无身份绑定条件则不开放。沿用旧适配开关加 Mission 子开关，失败不影响 App。展示真实平台请求回执，不用 curl 冒充小艺联调。

### WP-42：Widget 摘要（Target 可选）

- **目标/估时**：0.5–1 日，依赖 WP-40；复用现有 WidgetDataService/表单，增加 Mission 状态、待确认数、更新时间和准确入口，不新增事实表。
- **Gate**：过期/退出登录/项目切换不显示他人旧任务；点击打开正确任务，不能在卡片后台偷偷批准；真实设备刷新和入口验证。能力不支持时保持 App 入口，不因标题显示就称完成接续。
- **回退**：独立 UI 开关，移除新增字段展示不影响现有项目卡片；无第三方 API。

## 9. R3.5：任务评测、发布和答辩

### WP-50：Agent Evaluation

- **目标**：从 WP-00B 开始准备、各阶段增量跑，最后放行汇总。新增拟定 `scripts/eval-missions.ts`、`tests/fixtures/missions/`、只读评分器；数据文件记录版本/hash、开发/留出分组、预期允许工具偏序和成功条件。
- **Minimum**：12 个留出任务：3 内部反转/当前性、3 外部研究、2 内外比较、2 多轮澄清、2 中断/失效任务（分别覆盖补材料后同 Mission 接续、来源变化后修订及归入后由下一 Mission 检索；仍为 12 个任务）。另有确定性越权/故障集，不混入正常任务成功率。每个候选全量跑两次；相同任务的两次作为重复结果，不谎称 24 个独立任务。
- **Target**：30 个留出任务：8 内部、6 外部、6 混合、5 多轮/澄清、5 恢复/来源变化；加入 5–8 人小测，顺序平衡，记录耗时、错误、手工步骤、实际帮助和退出原因。用户招募由负责人安排或另行授权。
- **对照**：Minimum A=同模型旧问答、B=新 Mission。报告共同支持子集与全任务集，别让新能力任务隐形消失。Target 只读离线增加去 Web、去任务上下文、去 Temporal/Semantic 的消融，始终保留授权门；各条件同模型/温度/材料/预算，网页变化用同一合法冻结来源集并另外报告实时搜索成功率。
- **Gate**：Task Success≥75%、合理 Tool Selection≥85%、普通关键句人工支持率目标≥90%；越权、重复副作用、把外部指标写成自测、仅内部任务主动外传均为0；补料未充分不误恢复，接续不丢历史，归入不升级事实，用户否决/费用约束持续有效。Target 另报预授权自动恢复用例，不以其失败否决已通过人审接续的 Minimum。合理等待/正确拒答按预标任务类别判定；同时统计过度拒答，不能靠全拒答过关。
- **记录**：全部尝试、工具选择、输入hash、来源、usage、延迟、错误和人工评分；失败/超时也计入任务分母，usage 不明不填零。p50/p95 报明样本数，样本不足时不包装稳定分位数；不预填成绩。
- **环境/回退**：真实模型及搜索需批准的总额度；fixture/mock/规则/实时来源/人工标签分别标注。失败降低发布范围，禁止删除困难任务使结果变绿。无 Schema 变更。

### WP-51：版本冻结与环境放行

- **目标/窗口**：决赛前至少 5–7 自然日，依赖所选范围全部本地 Gate。新增/修改仅为后续实施中的必要部署与验收记录；本轮不执行任何服务器写入。
- **部署准备**：拟增加 `deploy/alibaba-cloud-linux/projectmemo-mission-worker.service`，核对 Node 24、Prisma 原生模块、工作目录、数据库/附件持久路径、服务账号、日志脱敏和重启策略；不得直接照搬样例中的 Node 22 路径。先在副本演练迁移/备份恢复，再按授权部署。
- **必跑检查**：npm.cmd test、npm.cmd exec tsc -- --noEmit、npm.cmd run lint、npm.cmd run build、隔离 npm.cmd run test:e2e、npm.cmd run harmony:test、npm.cmd run harmony:build；保留各自退出码。修改后仅重跑受影响检查；最终候选需完整一轮。CI 中加入不含真实密钥的 Mission 契约/故障测试，外部评测手动执行。
- **安装/平台 Gate**：最终包签名、真机干净安装、非开发网络、冷启动/断网/登录过期、Worker 重启、暂停批准恢复、数据库与附件副本恢复；小艺按所选发布范围单独验收。unsigned HAP 不关闭安装 Gate。
- **版本对账**：releaseId、Git commit+未提交差异说明、后端版本、Worker版本、HAP hash、Provider/model/protocol、迁移集、evalVersion、来源缓存时间对应同一候选。至少 3 次完整彩排，真实点击与受理/执行/核验状态一致。
- **演示**：长期目标及约束/范围→自主选择真实工具→私有信息缺口等待→用户离开并通过 Capture/Attachment 补料→关联/充分性评估→确认接续同 Mission→新证据使旧计划/批准失效并修订→鸿蒙批准新 Action 及读回→确认成果归入→后续 Mission 检索；中途重启保留历史；附失败/注入反例。固定种子可用，实时结果与缓存必须分开标记。

## 10. Stretch 工作包

### WP-X1：显式个人偏好和只读跨项目摘要

Target 放行且实际用户需求成立后才领取，3–5 日预算中择一。Mission 内时间、资源、否决与确认约束已属 WP-10 Minimum，本包只考虑用户明确要求的跨 Mission 偏好复用和只读跨项目摘要；需要持久化时新增 UserProjectPreference，保留版本与明确来源，不从聊天推断人格。跨项目只读摘要逐项目检查 membership，默认不把项目 A 的私有正文送入 B 的任务；多项目 Mission 和自动跨项目写入继续后置。验收偏好撤销、成员撤权、排序解释和跨项目隔离；开关关闭回到单项目。无需求不建通用画像引擎。

### WP-X2：一次周期性只读检查

与 WP-X1 择一，Target 后 3–5 日预算。WP-30 仅接续已经等待且资料到达的 Mission，不是周期调度。Worker 已有不等于主动检查已完成：新增明确订阅、时区/静默、nextCheckAt、稳定触发键和通知消费记录；只有有意义的新变化才发一次提醒，复用 USER 预算和现有送达机制。无变化保持安静，未经用户订阅不循环付费研究。测试时区/夏令时、重复触发、重启补偿、静默期、撤订阅和实际送达。若当前通知链只支持应用内展示，就按应用内待处理事件交付，不宣称后台系统推送。

## 11. 迁移、兼容和回退统一要求

- M1/M2/M3 采用增表、索引、默认版本字段和可空/有默认值关联，保留旧字段语义；空库迁移重放和旧库副本升级均验证。JSON 带 schemaVersion，已完成步骤含 toolVersion/protocolVersion，未知版本恢复失败需明确暂停，不盲改旧输入。
- 运行时关闭顺序：停止领取新任务 → 等待短事务结束/暂停 Worker → 关闭写工具 → 关闭新入口；保留 GET 历史读取。紧急安全开关在领取和提交两处检查，关闭后不能提交未完成写步骤。
- 不通过删表“回滚”。回退旧应用前保留数据库和任务记录，确认旧 Prisma 对新增表/可空关联兼容；已创建 Action 保留。旧后端缺少 Mission API 时新客户端处理 404/503，隐藏入口而非无限重试。
- 不改变旧 Capture/Action/Artifact 返回字段和时态含义；事务函数提取要跑旧调用方回归。AgentMission 是新执行状态，不能把它的 SUCCEEDED 映射为 Action.DONE。
- 材料事件接续、自动恢复、成果归入、定时检查与小艺配置有独立开关；关闭不影响普通项目使用。Migration、Worker、后端、HAP 的回退范围分别写明。

## 12. 工作包依赖、停止条件和交付表

依赖：00B 最早启动，不等 00A 或 Runtime；10→11→12，00A 仅实际路径的阻断项在相应工具接入/验收前合流；20 的 Adapter 可在10后开发、集成放行需12；21依赖20/11；30依赖12/21，31依赖11/21稳定接口，可交错准备，最终联调通过30；40依赖API稳定及30/31最终集成；32/41/42 和30自动恢复分支为 Target；50全程准备、最终依赖所选范围；51最后。Critical Path 与路线图第6.5节一致。单人交错准备不按多人并发扣除工期。

必须停下对应范围并报告的条件：无法证明业务写与回执原子性；真实工具协议与JSON替代均不通过；来源/用户边界无法建立；恢复会重复副作用；目标设备/签名缺失。模型/设备问题不阻塞无关本地工作，但阻止相应发布 Gate。小艺、跨项目画像、周期主动触发和自动恢复不成为 Minimum 前置；人审材料接续、Mission 约束及最小成果归入是 Minimum。

每包交付检查：

- [ ] 目标用户行为可实际完成，已接入调用方。
- [ ] 修改范围、数据/API/工具版本与依赖明确。
- [ ] 正向、失败、越权、重试及本包竞态场景通过。
- [ ] 所涉Web/鸿蒙契约一致，旧调用方回归通过。
- [ ] 外部条件分别有MODEL/SEARCH/DEVICE/PLATFORM结果或明确未验收项。
- [ ] 证据含命令、退出码、版本、数据来源和费用模式。
- [ ] 功能开关、升级/回退和已发生副作用的处理可执行。
- [ ] 已有授权时才提交/推送，提交范围仅本包；用户已授权逐阶段 commit；仅暂存阶段相关文件，不自动 push。

### 实施记录与偏差

后续执行者在此表追加真实结果；本轮不预填通过。偏差格式：原规划→当前代码约束→采用方案→受影响Gate；普通实现选择记录后继续，只有上方停止条件或授权缺口暂停对应动作。

| WP | 实际修改/版本 | 执行过的验证与证据 | 未完成Gate | 偏差 |
|---|---|---|---|---|
| 初次规划基线 | 两份规划文档；当时未实施业务代码 | 初次源码和官方文档核对 | 不能据此宣布实施 Gate 通过 | 以路线图范围取舍为准 |
| 第二轮规划修订 | 仅修订两份文档，保留 dfa42ea 及已有未完成工作树 | 规划契约、依赖、估时与修改范围核对 | 本轮未新增模型/设备/平台验收 | 接续人审属 Minimum、自动恢复属 Target；Output 单生命周期；成果复用 Artifact，新增持久关联 |

| WP-10/11/12 本地实现 | 持久 Runtime/独立 Worker、通用 Output、显式约束、原子 Action 批准及 Web 面板 | 3 文件 44 测试（Mission 19）、tsc、受影响 ESLint、Web build；隔离空库重放和旧库副本升级；evidence/r3/20261020-r31-r32/R3.1/results.json | 真实模型/设备/平台未验收 | 保持严格 JSON 为默认协议，原生工具模式可配置；后续 R3.2 扩同一 Output/Context/Registry |
