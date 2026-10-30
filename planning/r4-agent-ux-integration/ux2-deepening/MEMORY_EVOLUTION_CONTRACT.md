# UX-2 R2：记忆演化、假设与纠正合同

本文件为待实施合同，不表示已建表或已接入模型。执行仍由原 ConversationTurn/Mission/Worker 负责，源事实仍在原 Capture、附件修订、原工具观察、Action 和回执中。

## 1. 数据对象与替代方案

| 方案 | 优点 | 不足／裁决 |
|---|---|---|
| 所有内容放 Card/idea 或 Markdown | 展示和导出简单 | 不能独立表达认知身份、状态、原话纠正和跨修订依赖；不采用为主架构 |
| 扩 EpisodeRevision.claims JSON | 复用冻结来源、发布和阶段背景 | 局部 claimId、共享项目范围和窗口语义不适合所有私有认知；继续用作阶段成果 |
| 所有纠正放 AgentDirectiveEvent | 可复用 seq、有效期、撤回与协调 | 易把解释争议混入目标／权限；普通主张纠正不采用此存储归属 |
| **Claim + 追加事件 + 派生 Digest** | 补稳定身份、历史和上下文消费，原对象仍保留 | 推荐；三种新语义在原数据库，必须接原 SourcePolicy、协调和预算 |

### 1.1 AgentClaim：稳定身份

最小字段：

```text
id, ownerUserId, scopeKey, projectId?, missionId?, conversationId?
kind = HYPOTHESIS | INTERPRETATION | PREFERENCE
originRef(kind,id,revision,locator,contentHash)
canonicalStatement, conditions, currentRevision, statusProjection
createdAt, updatedAt
unique(ownerUserId, scopeKey, originKey)
```

scopeKey 为服务端生成的非空规范键，避免 SQLite 的 NULL 唯一性语义破坏幂等。Hypothesis 必须属于项目；USER 偏好只保存明确用户偏好，不容纳全局业务授权、永久目标或模型自设规则。跨项目查询可以组合两个有权 scope，不能把项目事实无声晋升为账户记忆。

originKey 包含原对象和修订／locator，不用相似文本作为身份。旧数据按用户实际操作或真实调查需要渐进注册，不批量根据总结猜主张。语义相似只产生合并候选；不能自动把两个实验或两个人的陈述合成一条。

### 1.2 AgentClaimEvent：追加历史

```text
claimId, ownerUserId, revision, requestId, payloadHash, eventKind, actorKind
actorUserId?, originalUserMessageRef?, userQuote?, modelInterpretation?
targetRevision, targetHash, evidenceManifest, assessment, reason
originTurnId?, originMissionId?, stepId?, agentRunId?
validFrom, validUntil?, sourceWatermark, createdAt
unique(claimId,revision); unique(ownerUserId,requestId)
```

eventKind 包括提出、关联调查、追加观察／评估、用户纠正、撤回纠正、到期／取代；不把各类事件拼成一个不可追溯的新正文。actorKind 为 USER/MODEL/TOOL/SYSTEM。用户原话来自认证请求或原消息，模型解释单独保存；模型不能填 actorUserId 冒充用户。

### 1.3 AgentContextDigest：综合缓存

字段包括 owner/scope、inputManifest、rootFingerprint、sourceWatermark、claimHeads、intentHash、reusePolicyHash、compilerSpecVersion、budgetRootRef、生成 provider/usage、覆盖、有效边界、摘要／未完成承诺／相关假设 refs、状态和失败原因。

状态为 DRAFT/CURRENT/STALE/FAILED/QUARANTINED。它是可重建缓存，原始事实不依赖它存活。摘要不独立投票，不直接覆写 Card、正式目标或 Episode。共享发布从原成果／Episode 的预览确认进入，先检查私有内容是否可披露。

## 2. 通用主张定位

locator 使用原对象、修订和内容 hash，加具体 blockId／claimId；需要文本片段时明确 offsetEncoding、规范化版本和片段 hash。推荐沿当前 JavaScript 文本使用 UTF16_CODE_UNITS，检查代理对边界，禁止把 DOM HTML 偏移当原文偏移。

支持目标：原 Conversation message/presentation block、Mission output block、Episode revision claim、Card 的当前解释、Artifact 的已知块。文档证据另带 attachment revision/fileHash/physicalPage/span；实验另带文件修订、列／行与条件。它们不是同一种“页码”。

服务器必须从当前有权原对象解析 locator，核对 targetHash/revision 和选中原文。重复片段无法唯一定位就提示选具体块。未映射 Artifact 只允许定位整项／已知块，不伪造逐句来源；旧客户端保留正文和原对象入口。

## 3. 纠正与授权的技术裁决

| 用户实际意图 | 记录位置 | 对后续消费的效果 |
|---|---|---|
| 先做什么／禁止什么／暂停／撤回目标 | 原 Directive + Admission | 原 intentHash、generation、lease、批准 guard |
| 模型误解、把自报写成实证、错误归因 | ClaimEvent USER_CORRECTION | 纠正作用于原主张，不改变原材料、正式目标和工具许可 |
| 原始数字或材料有误 | 新 Capture／AttachmentRevision、原 Temporal Relation | 保留原文与历史，原 source/readset 失效 |
| 不再参考某来源／判断 | 原 SUPPRESS_USE；扩 claim 来源 resolver | 限制后续复用，历史可见；不会删除证据或反向证明其为假 |
| 少提醒／稍后再说 | 原 Anchor、GoalQuestionPreference、USER Policy | 只改变注意力；不默默停止调查或改变事实 |

纠正命令绑定 claim/target 版本、用户原话、scope、requestId 和 expectedSeq。并发时沿原用户写锁顺序，再锁目标／Mission；旧目标返回 409。已提交同请求先读原回执；撤回也追加事件，不能删除旧原话。

**复用原协调，不建第二套 cognition 控制器：**

- 真实工作目标仍由原 intentHash 表达。
- 解释纠正和撤回进入原 reusePolicyHash 的相关 scope 有效视图；没有相关纠正时保持旧空视图兼容，有历史则保留 epoch，防止撤回后旧批准复活。
- 用户纠正复用原 User.continuitySeq 的控制时钟和写锁；不为每次模型评估增加用户控制序号。普通模型评估只更新 claim revision/readset。
- 抽出并复用原 turnCoordination 的失效入口，传入相关 scope、原事件和 reuse hash；不能只增加 UI stale。
- 旧 publication 无新绑定且存在相关纠正时拒绝新效果，保留正文；已提交效果仍按原幂等回读。作用域、时间边界和旧客户端策略继承 CT-1。

这套复用需要实施探针验证 transaction 锁顺序和 legacy hash；不能因为事件已落库就判纠正功能完成。

## 4. Hypothesis / Dream 生命周期

```text
PROPOSED → INVESTIGATING → SUPPORTED / REFUTED / INCONCLUSIVE
任一状态 → EXPIRED（适用期、来源、目标条件失效）
新观察／用户纠正 → 新修订和重新评估；历史不覆盖
```

提出至少包含：可审计的触发、与当前目标的关系、可测试陈述、关键条件、下一信息需求、当前支持／反证／未知。用户问题可以是触发，不能自动作为支持。无证据的头脑风暴可以留在普通回答；需要长期跟进时标明猜测性质、验证方向和期限，不包装成事实。

INVESTIGATING 关联实际原 turn/Mission/step；排队或等待用户不能仅因模型说“我在研究”就显示运行。活动状态读取 UX-1 WorkState。SUPPORTED 表示在记录条件下有当前证据支持，不等于 Fact VERIFIED、方法复现或项目完成；REFUTED 必须有适用反证；条件不可比／覆盖不足进入 INCONCLUSIVE。

模型可以提出评估，但服务端核对引用、原页／条件、版本、scope、覆盖及真实观察。语义是否正确仍需质量评测，不声称 hash 可证明科学结论。仅模型置信度、同根多份摘要、用户点击采纳不能晋升状态。

到期无新事件时有效视图也变 EXPIRED；保存“当时受支持”的原修订。新证据只使相关假设获得重验资格，不保证必须发模型。用户收起／停止关注与认识状态分开，不能用“忽略”把假设改成反驳。

### 4.1 动态验证与原执行链

在原 Investigation/Mission 增加受限的读取、记录假设和附加评估能力，复用工具注册、原上下文和步骤协议。模型依新观察决定读网页、PDF 页、论文、指标、请求材料、核算或结束，没有固定验证顺序。

同一次工具观察可关联多个假设，模型／HTTP 账本只记原请求一次。没有持续许可时不因假设存在自动派后台模型；当前用户请求已授权的调查可以自行读和评估，不逐工具重复确认。

固定核算仍先原批准，读取最新 job 回执。假设不能自行运行训练、扩大网络范围、增加费用或完成 Action。结果回到原 ClaimEvent、原 Mission 输出及 Action/resultCardId；自报保持 REPORTED。

## 5. Memory Evolution / Compiler

### 5.1 触发和依赖

触发：原材料新增／修订、真实 Action 结果、相关指令或纠正、已授权观察的有意义变化、有效边界、用户主动整理。去重键是 owner/scope＋根版本／内容 fingerprint＋编译规范，不是“又抓取了一次”的时间戳。

ImpactJob 先标相关 digest/claim 需重核，沿原依赖路径记录原因。它现有事务负责确定性影响，不能在其中等待网络或模型。语义编译作为原 turn/Mission 的一个受限工作能力执行；背景编译由原获准委托承接。没有合法预算根就只做失效标记和原文 fallback。

编译不是把上一份摘要再缩短。输入含原始来源清单、需要保留的原因／决定、原结果、未完成承诺、相关认知修订和排除范围。每个结论保留叶来源；旧 digest 可作为导航线索，不能成为自己的支持根。

### 5.2 编译步骤与提交

1. 读取有权的增量来源和最近边界，冻结 input manifest、claim heads、intent/reuse hash。
2. 确定性检查同内容、重复来源和既有覆盖；无变化返回原 current digest，不调用模型。
3. 在原预算中调用版本化综合策略；缺证据可产生未知／候选假设，不制造新的用户原话。
4. 校验结构、locator、来源闭包、适用条件和覆盖；模型／网络在事务外。
5. 发布事务重读 owner/scope、当前输入版本、有效时间、intent/reuse hash 与租约／generation，CAS 发布。迟到旧结果隔离为历史草稿；费用照记。

失败保留上一份历史结果、失败原因与原账本；不能继续把旧摘要显示为当前。UNKNOWN 保留原 operationId 和预占，不换新编译键重发。用户撤回纠正后重新检查当前来源，不盲目恢复旧摘要／批准。

### 5.3 记忆选择、压缩和整理

重要性由当前任务、时效、来源资格、未完成承诺、信息价值和覆盖共同决定；频繁召回不等于更真实。重复卡片整理仍用原 consolidation 预览／确认／撤销；语义综合不冒充它的业务效果。

同内容的新附件修订可以做确定性重绑定，但必须留下新版本检查，不复活旧批准。材料变更、语义条件变化、来源未知时返回原文核对。上下文不足显示覆盖并允许动态扩大读取，不靠截断制造结论。

memory.md / dream.md 导出带 scope、effectiveAt、最近边界、原对象／来源和 hash；不包含凭据或隐含授权。导入文件作为不可信 Capture，不能还原成用户指令或已验证状态。

## 6. 来源、派生和 F07

沿原 sourcePolicy 扩 claim、digest、episode revision resolver，保留 source root 及引用用途：TRIGGER、SUPPORT、COUNTER、BACKGROUND。来源存在、可读、当前、适用和支持主张是不同判断。

链未知、循环或超有界遍历时保持 UNKNOWN，不把二手结论当独立证据。同根多摘要只计一条依赖，不能用摘要相互引用增强置信度。归档只改变常用视图，不改变事实有效性。

F07 的实施顺序：

1. 同请求先读已提交原效果；新采纳在原事务核对 owner/project、当前 ACTIVE、撤权、授权 revision 和原候选。
2. 为候选捕获／采纳的连接身份、scope／grant binding 和观察 revision 提供持久绑定，不能只接受 UI 传“当前 revision”。冻结请求开始快照和成功提交版本，不能误比较递增前后值。旧无绑定行返回需重新核对，不猜测回填。
3. 原 connection.revision 包含普通刷新 CAS，不等于授权代际；先复用当前不可原地重开的连接身份＋授权范围 hash，区分观察换版和撤权。新连接／新 ref 读到同 SHA 也不使旧 Capture 自动获新授权；未来若增加原地重授，必须补显式 grant epoch 并另验，不能预设当前已有。
4. 校验采纳后 Capture 的上游依赖，保留外部来源类别和当前复用资格。历史查看、网络访问、保留快照复用明确分开；旧不明策略不当永久许可。
5. Web/ArkTS 同步可用操作与拒绝原因；并发撤权／采纳、已提交回放、跨项目／跨用户及派生摘要均测试。

新 guard 是 UX-2A 前置，本轮不修改业务代码。类似快捷确认先检查原服务已有合同：Episode 的事务 sourceHash 继续复用；Card PATCH／合并操作不被重新解释为无版本的事实批准。

## 7. 关键消费路径清单

纠正／停用／来源变化至少覆盖：检索候选、Workspace/ContextBuilder、Investigation、摘要压缩、Artifact 再利用、Episode 发布或当前视图、经验注入、Hypothesis 评估、待批提案、恢复后的缓存、导出和双端原对象读回。

正文历史可以保留；可执行操作和支持资格须当前重验。缓存 key 包含 owner、scope、相关源版本、claim heads、intent/reuse hash、编译版本和时间段；TTL 不越最近边界。

## 8. 实施探针

先验证：locator 的中文／emoji／重复段落；旧 Episode claim 注册；用户纠正与批准竞争；撤回与新来源同时到达；无事件到期；Digest 自引用；重复根来源；同 SHA 连接换代；读取页不隐含 sync；模型超时和旧 generation；多设备旧草稿；账户偏好和项目数据隔离。合同通过后才扩大自动综合与后台触发。
