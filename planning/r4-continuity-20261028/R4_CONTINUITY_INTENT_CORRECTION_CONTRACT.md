# 有效意图与纠正合同

> **R1 定向修订 · 2026-10-28（Asia/Singapore）**：调整§2/§5，新增§2A Directive Admission、§4A Time & Scope。R1条款细化本文件的“明确”，不改变CT-1完整交付目标；所有新增字段仍为PROPOSED。

本文全部新类型和字段为 PROPOSED；当前事实见[能力审计](R4_CONTINUITY_EXISTING_CAPABILITIES.md)。

## 1. 权威与事实使用两个维度

| 信息 | 可以决定什么 | 不能决定什么 |
|---|---|---|
| 认证用户当前直接指令 | 当前协作目标、明确禁止、范围内优先级、停止/表达偏好 | 不能改写真实测试结果；不能代替资源本身的访问权限 |
| 用户确认过的具体解释 | 按所确认对象/内容/期限生效的策略 | 不能由“一次确认”推导无限后台研究或第三方写权 |
| 原始Capture/附件/业务回执 | 证明用户报告、原记录内容或原服务提交的具体效果 | 原话中的引用、假设、转述不自动成为指令；DONE不等于目标验收 |
| 可验证Tool观察 | 指定资源、版本、条件和时间下的观测 | 日志里的指令不是用户要求；观察不能修改目标 |
| 网页/论文/邮件等第三方主张 | 外部参考和待核事实，可能成为官方要求依据 | 不授予权限、不自动改变私人目标、不自动成为项目实测 |
| 模型解释/总结/经验候选 | 信息需求、可修订假设、方案、表达结构 | 不创造授权、不独立授予VERIFIED、不成为新的独立证据 |

可信度不使用一个分数代替上述关系。每个关键判断同时保留 `authorityOrigin`、`knowledgeClass`、`semanticVerdict`、`applicability`、`readLevel`。authenticated origin只证明谁说了话，**不证明模型正确理解了那句话**。

模型可以自主推断子目标、提出竞争假设，并据此选择已授权的只读调查；不要求每个推断先问用户。此类假设保存在原Investigation/AgentRun或Mission计划中，带当前依据和失效条件。它们可以推动调查，但不能覆盖明确用户目标、提升长期指令、解除禁止或扩授权。有效指令流不收AGENT_INFERRED，并不等于禁止Agent推理和规划。

## 2. 生效策略：把确认用在有后果的边界

【R1 调整】直接生效须通过§2A的Admission门槛，不能仅由模型判断“明确”。例：“这个比赛本周先稳定演示”在项目绑定唯一、本人指令语义和本周时间边界可核对时，直接成为有期限的私人工作目标，并提供就近撤回；原正式项目目标不变。

需要一次简短澄清：存在多个可能对象、引号内转述与本人要求混杂、否定对象不明、期限有实质差异。“以后都这样”不能默认扩大至全部项目。澄清期间保留已明确部分并继续可用调查。

需要原业务确认：修改共享Project目标/截止日、Mission约束/成功条件、创建/完成行动、采纳方案、排程和成果归入。**当前工作目标可改变而原Project目标仍保留**；若两者验收口径不同，Agent必须解释差异并提供原对象修改预览，不偷偷降低成功条件。

需要专门授权：扩大外发概念、连接账号、启动有费用后台调查、系统通知通道、沙箱策略和外部写入。自然语言可以生成一次具体授权预览，批准后范围内由Agent自主调用，不逐工具询问。

## 2A. 【R1 新增】Directive Admission

### 四项独立条件

| 条件 | 服务端可核查的证明 | 单独成立时仍不能推出什么 |
|---|---|---|
| A1 来源真实 | 当前认证actor；同owner的USER原消息，或持久化的认证控制请求；原文hash/位置 | 不能证明用户是在发指令；转发、引用、假设都可能出现在本人消息里 |
| A2 本人正在表达该指令 | 有版本的受限指令准入规则，或用户确认过的具体解释；拒绝否定反转/引号/转述/条件未成立等歧义 | 模型的speech-act标签、置信度和逐字quote本身都不是证明 |
| A3 对象/范围/期限确定 | 服务端原binding或唯一明确对象；原时间短语按已知用户时区解析；scope和期限没有被提取器扩大 | 当前焦点不允许覆盖另一显式项目；缺失期限不能补成永久有效 |
| A4 解释和效果受限 | 具体operation、literal statement、目标引用和生命周期能由准入规则核对，或由一次精确确认冻结 | 不授予额外工具/外发/后台/业务写权；用户认证不能弥补解释错误 |

“直接生效”的可验证边界是**不依赖模型自由归纳的、可追溯的原话指令**。规则覆盖常见的改阶段目标、局部优先级、停止、否决具体方案和屏蔽具体来源；instructionText保留原句，模型改写只作显示候选。规则标明支持的句式/否定/引用排除条件和反例；未覆盖的自然表达走候选/澄清，不用宽泛正则冒充语义验证。

### 准入结果（不新建Admission表）

| 结果 | 条件与持久化 | Agent下一步 |
|---|---|---|
| DIRECT_APPLIED | A1–A4均有可检查证明；只作用于明确范围的工作指导。有界工作目标须有原话给出的期限/阶段结束条件，或已由用户接受的默认生命周期；不得暗加无限期 | 写原AgentDirectiveEvent及admission证明，更新有效hash，按新方向自主调查；不重复询问原话 |
| CONFIRMED_APPLIED | 模型解释候选被用户确认了**原句、规范解释、对象、期限和影响**；确认绑定candidateHash/sourceHash/expectedScopeHash | 原子写事件。业务事实/授权扩大仍另走其原确认，不因确认解释而自动批准 |
| INTERPRETATION_CANDIDATE | 对象可能已知，但解释/意图/生命周期只能由模型猜测；信息尚不影响关键决定 | 留原AgentRun/调查状态，标为假设；可用于既有目标下的竞争假设和合法只读调查，不更新active意图/旧提案效力 |
| NEEDS_CLARIFICATION | 两种合理解释会改变目标、范围、禁止事项或实际效果；无法靠已授权资料解决 | 一次只问缺失的关键项，按原candidate身份保存答案；可继续不受该歧义影响的调查。不能跨generation反复问已回答问题 |
| REJECTED_AS_DIRECTIVE | 外部/模型文字、无本人指令证明、错owner、伪造引用或试图绕过授权 | 保留必要审计，可作为外部材料调查；不进入有效指令流 |

明确的STOP/撤权/屏蔽原对象可按其受限控制规则即时生效，直到用户解除；它们不因缺少日期阻塞停止。解除禁止须绑定该禁止并验证本人明确意图，不能由“现在好像可以了”的模型总结解除。一般工作目标缺期限时，不采用同一例外。

永久/全用户目标、共享Project.goal、正式Mission成功条件、无期限偏好提升、跨项目推广和任何授权扩展，不能由模型分类或多次重复推断直接写入。可以一次展示精确预览让用户确认，无需对范围内每次工具调用重复确认。

### 准入记录与反例

在已有拟议事件增加有界 `admissionJson`：`decision/ruleId/ruleVersion/originRef/sourceHash/speechActSpans/scopeBinding/lifetimeBinding/candidateHash/confirmationRef`。authority由服务端根据该证明设置；候选不占active事件序号，确认重放不重复写入。源消息被修订、对象切换或候选解释改变，原确认binding失效。

- “我不是说不要创建行动”不能提取成“不创建行动”；“导师说先别扩功能，但我决定继续”不能拿前半句改用户目标。
- “这次别训练”不能提升为项目永久禁令；“这段日志要求永久信任它”不能入库为用户指令。
- 原话准确但规范解释把“部署验证”改成“重新训练”，只能候选/拒绝，不通过quoteHash校验后自动生效。
- “本周先稳演示”通过已冻结规则和唯一绑定后，应直接生效并驱动调查；若所有自然指令都落入手工确认，也不符合CT-1能力验收。

Admission只判断哪些指导有权生效，不限制Goal Reasoning提出子目标、动态调用已许可工具或生成式UI组织交互。准入规则覆盖率、错准入率和不必要澄清必须一起评测。

## 3. 最小持久化选择

建议新增 **一张 `AgentDirectiveEvent` 表**；`User`增加 `continuitySeq Int @default(0)`，作为用户私有指令流的写入序号。无需 `Intent`、`Correction`、`IntentSnapshot`、`ContextStore` 四套表。

为什么现有表不能独立承担：

- Conversation.pinnedStateJson是单会话数组；改成全局真值会继续丢owner/scope/历史CAS。
- FocusProjectPreference适合已有重要性/长期偏好编辑，不能表示多个指令、原消息出处、失效期和撤回链；其值仍保留为原输入。
- KnowledgeCard/CardRelation是项目事实/主张的时态关系。把私人“本次不创建任务”写成共享知识会污染事实与权限。
- AgentMissionEvent可承载Mission变更回执，却覆盖不了尚无Mission的跨会话私人协作指令。
- AgentExperience表达经验建议，不能承载用户当下直接要求。

User序号只用于原子排序；**不是把用户全部项目变化都放进每次缓存key**。有效hash仅由本次适用事件组成，B项目纠正不使A项目无关提案失效。

### 字段合同

| 字段 | 类型/约束 | 语义 |
|---|---|---|
| id / ownerUserId / seq | server ID / User FK / positive Int | 唯一 `(ownerUserId,seq)`；序号来自事务内用户行increment |
| commandId / eventIndex / commandHash | String / Int / SHA256 | 唯一 `(ownerUserId,commandId,eventIndex)`；一条消息可原子产生多个条款 |
| directiveId / previousEventId | server logical ID / self FK nullable | 同条指令的修订链；previous必须同owner/同scope且为当前版本 |
| scopeKind | TURN / CONVERSATION / MISSION / PROJECT / USER | 对象引用经服务端解析，不接收模型伪造owner |
| projectId / missionId / conversationId / turnId / scopeKey | nullable FK + canonical key | 按scope校验必要字段；USER只在明确授权提升时使用；conversation不是project的替代品 |
| kind | WORKING_GOAL / PRIORITY / CONSTRAINT / STOP_RULE / PREFERENCE / CORRECTION / USE_SUPPRESSION | CORRECTION有typed target和纠正类别；不存独立事实副本 |
| operation | SET / REPLACE / WITHDRAW / SUPPRESS_USE | append-only效力变化；物理删除流程单列 |
| authority | USER_EXPLICIT / USER_CONFIRMED | server写入；AGENT_INFERRED候选留原AgentRun，不进有效流 |
| sourceMessageId / sourceTurnId | nullable authenticated references | 消息型要求必须来自同owner的USER消息；表单型命令绑定认证请求和具体内容hash |
| quoteRange / quoteHash / instructionText | bounded JSON / SHA256 / Text | 保留逐字原话及位置；引用上下文不可被外部材料替换 |
| interpretationJson / interpretationVersion | typed bounded JSON / String | 模型理解可修订；不是授权对象，也不替代原话 |
| targetRef / appliesWhen | typed JSON | 纠正绑定的原判断/方案/来源；条件不清时留候选，不由模型宣称事实更正完成 |
| validFrom / validUntil / timezone | DateTime / nullable / IANA zone | 同时记录原时间短语；不以抓取时间或服务器时区替代用户时间 |
| createdAt / schemaVersion | DateTime / Int | 操作时间与适用时间分离 |

数据库加CHECK/服务端Zod共同保证scope形状；User/Project/Conversation/Mission删除行为在迁移时明确：私人内容随合规删除清理，运行审计只留最小无内容墓碑。迁移须验证原始SQL是否保留这些约束，不能只检查Prisma schema。

### 有效视图（不另存事实表）

```ts
type EffectiveIntent = {
  scope: { userId: string; projectIds: string[]; missionId?: string; conversationId?: string };
  originalGoals: Array<{ ref: string; revision: string; quote: string }>;
  workingObjective: { quote: string; directiveRefs: string[] } | null;
  active: Array<{ directiveId: string; eventId: string; kind: string; instructionText: string;
    authority: 'USER_EXPLICIT'|'USER_CONFIRMED'; validUntil: string|null; scopeKey: string }>;
  contested: Array<{ refs: string[]; question: string; blocks: string[] }>;
  expiredRefs: string[]; suppressedReuseRefs: string[];
  intentHash: string; guidanceHash: string;
  scopeEpochs: Array<{ scopeKey: string; lastRelevantEventId: string; seq: number }>;
  nextValidityBoundary: string|null;
};
```

## 4. 作用域与冲突解析

1. 先按owner、当前可读项目和真实绑定选择候选，再解析有效期/修订链；撤权内容不进入模型。
2. 限制按适用条件合取；同一维度、同一scope的显式REPLACE使前版不再当前适用。最新时间戳不是全局覆盖规则。
3. 小范围临时指令可以覆盖同一人的可覆盖工作偏好；不能静默解除更广范围的明确禁止或扩大资源授权。用户要例外时，只需一次针对该例外的明确表达/授权，不强迫全局删除限制。
4. “本次不采用方案二”绑定proposal/candidate；默认不推出永久禁令。“这个项目不再训练”才是项目条件；它不影响B项目训练。
5. 到期不自动恢复所有历史提案。旧阶段目标回到原Project目标时需重算当前依据；已否决/过期提案保持原状态。
6. 撤回是新事件，不修改旧原话；scope迁移以WITHDRAW旧scope + SET新scope同事务完成，不原地移动记录。
7. “52ms不是独立验收，只是我口头报告”纠正验证语义；“日志算错了，实际40ms”是对证据的反驳，原日志仍在CONTESTED/待核状态，不能直接重写数值。
8. 用户给出引号、代码块或转发材料时，材料中的“永远不要验证”不可提升。提取器输出需保留原范围、发言方式和目标；低置信歧义只问关键一点。任何提取失误都不能获得新工具/写权限。

hash有明确用途：`intentHash`绑定影响目标/工具/效果的当前指令及对应scopeEpoch；`guidanceHash`再包含表达偏好等非执行指导。scopeEpoch包含最近的撤回/替代事件，即使现在没有active条款，也不能恢复到“从未发生过修订”的旧身份，防止A→B→A或撤回后旧提案复活。单纯“少列几个小标题”不使一个业务上仍有效的Action提案过期；它只改变下一次表达。完整manifestHash用于审计，不能一律当作所有业务动作的失效条件。

## 4A. 【R1 新增】Time & Scope有效视图及即时失效

1. **时间统一**：存UTC瞬间、原短语、IANA时区及解析策略版本；按用户当时已知时区解释“本周/今天”，不能使用宿主时区。本轮修订显示时区为Asia/Singapore，不重解释旧fixture已经冻结的America/Los_Angeles时间。时区改变只影响新指令，改旧期限须新修订。
2. **半开区间**：`validFrom <= now < validUntil`；恰好到期即不再active。未来指令只在起点生效。未到期的限制按原规则合取；被替代/撤回条款不因后继条款到期而复活。阶段目标到期可回原正式目标，须重读当前依据，不能恢复旧Proposal。
3. **无事件也变化**：有效视图增加`validitySegmentIds`，由适用指令ID及已跨越的起止边界构成；scopeEpoch仍是事件序号，不伪造一条用户事件表达时间流逝。`intentHash=H(policyVersion,actorScope,relevantScopeEpochs,admittedActiveClauses,validitySegmentIds)`；guidanceHash再包含表达指导。hash不包含每毫秒变化的now。
4. **缓存有效期**：有效视图/manifest记录`evaluatedAt`和`nextValidityBoundary`（含未来指令起点）。到边界缓存立即不可用。工具派发、模型上下文组装、回答/提案发布、确认及Mission恢复必须以服务端当前时间重算；沿用turn启动时asOf不足以校验效果。历史asOf回看是只读模式，不能拿去确认业务。
5. **到期即再协调**：即使没有新消息，运行中的worker在边界转入Context/Handoff §3A的INVALIDATED；等待中的原Mission把下一次检查时间取现有nextAttemptAt与有效边界的最早值。定时唤醒只是优化，guard不能等待定时器/ImpactJob；到期本身不自动授权付费调用。
6. **撤回/替代**：事务递增相关scopeEpoch，原事件保留，未提交的相关Proposal当场不可确认；批次重放返回原回执及当前有效投影，不把旧APPLIED显示成现在仍active。已执行业务效果仅回读，不被倒改。
7. **跨项目迁移**：一个command内WITHDRAW A + SET B，校验两个项目访问权、两份expectedScopeHash、目标范围Admission，全部提交或回滚。两端epoch都更新，只有相关未提交效果失效；不复制A的来源/授权到B，不移动原Mission/Action。跨项目偏好复制亦须明确指令，不从措辞相似推出。
8. **时钟与确认竞争**：效果的逻辑生效点是原确认事务内最终guard；比较当前时间、效力hash和原业务版本后提交同一事务。HTTP派发许可的线性化点另见Context§3A。注入时钟测试T−ε/T/T+ε、DST和时钟回退；发现live时钟倒退时暂停效果并重新校时，不能用过去asOf使已失效批准复活。

SUPPRESS_USE不因工作目标到期自动解除；其作用域/用途及撤销规则单独存在。当前指导、允许消费哪些来源、用户是否拥有外发/写权是不同判断，三者分别重验。

## 5. 写入与传播事务

建议薄服务 `lib/conversation/directiveService.ts`（新，名称待实现核对），由原turn受理/UI控制命令调用，不运行独立Agent。

```text
authenticated command → 校验原USER消息/具体表单绑定
 → 解析唯一scope与expectedScopeHash，检查原对象权限
 → 事务：锁用户行 → 校验command重放/载荷
        → fold受影响scope并CAS → 分配连续seq → 写事件
        → 将受影响原提案/任务挂入既有失效与impact路径
        → 保存原Conversation控制回执及必要停止标记
 → 返回实际生效范围、旧新差异、影响对象、撤回binding
```

【R1 调整】模型和网络均在事务外。事务入口必须携带§2A的Admission证明；原话hash不能替代该证明。候选留原审计，不修改有效目标/授权；通过准入的字面指导或精确确认的解释才进入有效流。

一条command的事件批次完整提交或全部回滚。重试按owner+commandId读取整批，commandHash不同报REQUEST_ID_REUSED；同scope两端并发只有一个expectedScopeHash获胜，失败端保留草稿并显示差异。跨scope无关变更可重试本地计算，不触发新模型调用。

对同owner的控制写入与业务效果，采用一致的事务锁顺序（用户指令序号行→原Conversation/Mission/提案行），避免引入互相反向加锁。原确认事务内读取适用指令并比较hash，不能在事务外读好后只比较旧变量；多owner项目只读取当前actor的私人指导和原共享目标。

【R1 调整】新控制命令可在已有turn执行期间接收。STOP/撤权置停止；通过准入的目标修订/使用抑制按Context/Handoff §3A进入INVALIDATED，不一律设置stopRequested结束整个任务。租约持有者在下一调用、发布和写入边界重验。已发出的HTTP保留真实审计，迟到内容不能直接发布为当前建议。

【R1 调整】费用预占不代表已获最终派发权。外部派发在原operation预占后，按Context§3A的DISPATCH_COMMITTED事务再次校验grant/intent/时间/使用抑制；这是许可线性化点。扩大查询、改目标、generation变化或重启均不会给UNKNOWN操作一份新身份。

相关失效以 `intentHash` 读集为准：待确认Proposal显示STALE，原Mission需要再协调/按原服务replan，原Action不自动取消；已COMMITTED效果仍可精确重放同一回执，不能因新意图隐藏已发生效果。纠正回执列明已生效范围及仍需业务确认的部分。

## 6. 服务/API增量

| 入口（拟议） | 调用方/输入 | 返回与边界 |
|---|---|---|
| resolveEffectiveIntent(actor, scope, asOf) | 原workspace/Investigation/Mission/D1/D2 | 同一typed视图和hash；只读，无模型、无事实写入 |
| acceptDirectiveCommand(actor, command) | 原turn受理或uiActions | expectedScopeHash/requestId/原话binding；实际事件及撤回绑定 |
| GET `/api/conversations/:id/continuity` | Web/ArkTS及原work读回 | 当前范围内意图/冲突/承诺；不会列出全用户私聊 |
| POST `/api/conversations/:id/continuity/commands` | 自然语言确认/控制动作 | 不接模型URL或任意service名称；只接受白名单命令、认证引用和版本 |
| existing effect guards + continuityManifest | commands/work/approval/review/runner | 复用原source/ownership/幂等后，检查当前适用intentHash |

项目级查询限用户自己的私人指导；共享团队目标仍通过原Project服务。成员可保存自己的工作偏好，但不能据此修改owner私有Mission。

## 7. 迁移、兼容、回滚

先additive新表/序号及可选DTO，保持ConversationBlocks schemaVersion 1和旧历史原样。空库全迁移重放、旧库副本升级、两端旧DTO读取同时验证。

旧pinned字符串按 `LEGACY_UNSCOPED` 读取为当前会话临时约束，附来源不全标记；不自动推广项目或用户全局。首次需要跨项目或解除旧限制时，呈现原句和范围修订入口。对已有会话一旦用户逐条整理，记录对应旧数组hash已被解析，避免legacy字符串再次复活。该映射可放Conversation.pinnedStateJson的兼容伴随元数据或新的独立可选JSON键，不能直接破坏旧数组读取。

开关关闭停新提取/新自动调查，但**已经生效的停止、撤权和禁止仍由guard读取**；否则关闭特性会重新放行用户已禁止的动作。紧急回退为只读和原回执读回，不删表、不清历史、不回退到无指令校验的写入版本。之后旧binary回退必须满足schema与guard兼容，否则只允许前向修复。
