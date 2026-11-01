# 现有记忆能力、数据范围与增量架构

审计日期：2026-11-01。首次读取业务基线为 `e403f803fabde9b42b63fb131b9d6ce3ecd8306d`；核对期间 HEAD 前进到只改交接文档的 `1c3b6a5`。这里依据实际读取的源码，不把 Roadmap 的“计划交付”当作实现。

本轮只在 `docs/FINAL/Memory` 新增规划。工作树原有 `AGENTS.md`、ProjectHealthCard、RepositorySources 删除、Health/Metric/Impact/State 原生组件、打包配置、生成配置和历史截图修改均不属于本次工作；没有读取真实业务数据库来推测用户画像。

## 1. 已有能力对账

表中的“有代码”表示读到了实现与调用方；“历史工程验收”表示读到了对应记录，不代表本次重新跑过测试。下文路径均相对仓库根目录，行号是本次读取位置。

| 能力 | 当前源码落点 | 实际覆盖与限制 |
|---|---|---|
| 资料与知识卡 | `prisma/schema.prisma:157` 的 KnowledgeCard；`lib/mission/memorySearch.ts:15` | 卡片绑定项目和原 Capture。可以检索标题/摘要、定向读旧卡片；不是账户个人画像 |
| 时态与证据关系 | `lib/memory/temporalLedger.ts:16`、`lib/services/temporalLedgerService.ts` | 按确认、撤回和有效期计算关系；归档不等于事实失效，Unknown 不当 False |
| 生命周期与整理 | `lib/services/memoryLifecycleService.ts:29`、`lib/services/memoryConsolidationService.ts` | 人工确认是来源声明；归档、合并与来源关系继续走既有服务，不是第二套个人记忆 |
| 稳定主张及事件 | `prisma/schema.prisma:1543`、`:1565`；`lib/memory/claimService.ts:28` | AgentClaim / AgentClaimEvent 已存在。owner 与 project 都必填，纠正和假设是不同 kind |
| 解释纠正 | `lib/memory/claimLocator.ts:6`、`lib/memory/claimService.ts:28`、`lib/memory/claimEffective.ts:6` | 原文 hash、UTF-16 区间、expectedSeq/revision、同请求回放与原消费者失效已接入。ClaimCorrection 是组件/用例名称，没有另一个同名 Prisma 模型 |
| 有条件的假设 | `lib/memory/hypothesisService.ts:27`、`:91`、`:163` | 原输出内记录同一 claim 的证据与反例；读取时复核来源、权限和期限。SUPPORTED 是条件判断，不是客观事实认证 |
| 当前/历史综合 | `lib/memory/digestService.ts:17`、`:62`、`:125`；`lib/memory/conversationDigest.ts` | Digest 有来源、claim 版本、intent/reuse hash。当前筛选先看最近 8 条，再按问题选最多 2 条；旧而重要的信息可能进不了候选集 |
| 项目当前语境 | `lib/services/projectAgentContextService.ts:9`、`lib/projectAgentContext.ts:10` | 聚合原任务、行动和提醒，按 WorkState/优先级选择下一步；有覆盖受限标识，不是全量记忆综合器 |
| Workspace 范围选择 | `lib/services/workspaceContextService.ts:14`、`:65` | 先查成员权限，再选择最多三个项目做深入观察；账户可访问的目录不等于本轮可读取全部项目正文 |
| Conversation 上下文 | `lib/conversation/investigationService.ts:187` | 消费项目 Digest、Hypothesis、纠正与经验；当前项目路由在这些记忆注入之前已经发生 |
| Mission 上下文 | `lib/mission/contextBuilder.ts:47` | 消费有效指令、原步骤/输入、来源、Digest、Hypothesis 和 Experience；不是只拼最近聊天。没有账户个人记忆 facet |
| 项目指令 | `prisma/schema.prisma:1036` 的 AgentDirectiveEvent；`lib/types/continuity.ts:3`；`lib/continuity/directiveService.ts:31` | User 持有总序号，但事件仍要求 projectId。账户拥有者字段不能被理解成账户作用域 |
| 动态准入与在途改道 | `lib/continuity/admission.ts`、`turnCoordination.ts:30`、`invalidation.ts:6` | 已有 generation、lease、原操作预算和 UNKNOWN 处理。新增记忆应扩它们的读集，不能另建执行器 |
| 资料停用及派生血缘 | `lib/continuity/sourcePolicy.ts:10` | 跟踪 card、artifact、claim、episode、experience、工具观察等原始根。未知链不构成独立证据；当前入口接受 projectId，不是账户记忆的现成鉴权器 |
| 跨会话接续 | `lib/continuity/handoff.ts`；`prisma/schema.prisma:383` 的 Conversation 与 Binding | 返回原 Mission/Action，读原状态和结果；不能拿 Handoff 副本充当新的事实源 |
| 责任与持续观察 | `lib/mission/responsibility.ts:47`、`:162`；`investigationDelegation.ts:237`；`delegationObservation.ts:15` | 责任视图绑定目标、许可和累计预算。扫描、动态读步骤和执行分开；不是随时拥有无限后台运行权 |
| Attention | `lib/services/interventionPolicyService.ts:120`、`:621`；`lib/mission/attentionReceipt.ts:14` | 已有用户范围策略、安静时间、去重和私有委托决策；已读、批准与执行回执仍不同 |
| 结果经验 CT-8 | `prisma/schema.prisma:1384`；`lib/experience/injection.ts:64`、`:91`；`service.ts` | 项目内、用户所有，按条件、工具/协议版本、反例、有效期匹配；仅 ACTIVE 且有合格支持才注入。不是跨项目个人偏好 |
| Episode / Reentry | `lib/services/projectEpisodeService.ts:667`、`:843`；`components/ReentryBrief.tsx` | 保留阶段经过和来源新鲜度，接回项目；共享 Episode 不应承载私有个人推断 |
| Web 全局记忆 | `app/memory/page.tsx:7`、`lib/server/globalWorkspace.ts:13` | 按 membership 聚合项目卡片、分页和时态。页面叫“全局”不代表数据是 Personal Memory |
| Web 项目认知 | `components/AgentMemoryPanel.tsx`；`app/projects/[id]/[section]/page.tsx:47` | 当前理解、待核实、纠正、经验和原调查入口已经存在，需整理层级而非重造功能 |
| 鸿蒙对应入口 | `pages/Index.ets` 的 GlobalMemoryTab/SettingsTab；`pages/MemoryTimeline.ets:703`、`:719`；`services/AgentMemoryService.ets:3` | 全局档案与项目面板已实现；AgentMemoryService 仍是项目 API，没有账户记忆接口 |
| 设置 | `components/GlobalSettings.tsx:31`；`harmonyos/entry/src/main/ets/pages/Index.ets:1741`；`services/SettingsService.ets` | 现有模型、账户、提醒等设置可以复用入口结构，不能把全局模型配置当用户记忆容器 |

表内 `pages/`、`services/` 的鸿蒙路径前缀为 `harmonyos/entry/src/main/ets/`。上述源码位置在规划核对时存在；引用的功能开关仍决定部署环境是否可用。

## 2. 验收材料能证明到哪一步

| 材料 | 可以支持的结论 | 不能支持的结论 |
|---|---|---|
| `R4_AGENT_UX_IMPLEMENTATION_NOTES.md:98` 之后 UX-2 完整实施段 | A/B/C 有工程实现记录；隔离模型/库的双端与模拟器纠正、撤回、失效和接续路径有记录 | 不能宣称真实模型或三个月使用质量已通过 |
| `evidence/r4-agent-ux/20261030-ux1/acceptance-summary.json` | UX-1 当时的单测、E2E、类型、lint、HAP 结果分层保存 | 不代表当前 HEAD 全量回归，更不代表 Personal Memory 已存在 |
| `tests/ux2DigestRuntime.test.ts:16`、`ux2HypothesisRuntime.test.ts:42` | 真实服务配脚本模型可覆盖综合消费、反证、原 Action/resultCardId、到期与在途竞争 | D1/D3/D5 标签或时间推进不等于自然日用户研究 |
| `tests/ux2ClaimSourceRights.test.ts:24` 起 | 跨项目消息、成员撤权、OWNER 降级和原文屏蔽有工程用例 | 不证明所有设备缓存和生产日志都已清除 |
| `tests/ux3ThreeDayContinuity.test.ts:27`、`ux3ProactiveDiscovery.test.ts:27`、`:272`、`:408` | 时间推进、重启、无变化零调用、来源失效、观察失败区分有测试 | 不把模拟器、脚本模型、真实自然日混为一类 |
| `planning/r4-post-ux2-implementation/R4_CT8_TO_CT10_INDEPENDENT_AUDIT_2026-10-31.md` | 经验、来源失效、浏览器与日历边界有独立审查及回归记录 | 不代表真实 OAuth、真实外部写入或长期效果已签收 |
| `docs/UI_UX_HANDOVER_2026-11-01.md`、`evidence/ui-handover-fix/20261101/validation.json` | 后续 UI 修订和三次分步页面构建、90 项鸿蒙测试有记录 | 记忆页新布局截图仍有待验收内容，不当已完成个人记忆体验 |

本次没有重跑这些业务测试。新的账户范围、个人记忆消费、个人记忆清除传播均未实现，也没有相应设备或真实模型验收。

## 3. 最值得处理的架构缺口

1. **缺少账户级认知合同。** Claim、Digest、Directive、Experience 的 projectId 均必填；不能靠一个 `userId` 过滤就宣布具备个人记忆。
2. **纠正和偏好不能共用一套含糊语义。** “这句话是猜测”纠正原主张；“以后先给结论”改变协作默认；“这个项目不能联网”是工作限制。三者需分流。
3. **最近窗口不足以覆盖长期重要信息。** Digest 最近 8 条和 Hypothesis 最近 16 条是有界展示/消费窗口；不应成为长期有效约束的唯一入口。
4. **没有个人记忆使用回执。** ExperienceUse 能复用设计，不能直接存一条非经验的个人记忆，现有外键只指向 Experience。
5. **删项目以后仍用其个人派生内容的规则尚未定义。** 现有 SourcePolicy 处理项目血缘；新增跨层晋升后必须扩展消费验证，而不是靠 UI 隐藏。
6. **个人上下文与共享输出之间缺一道明确的披露边界。** 私有推理能用，不代表项目成员、通知卡片和外部系统也能看。

## 4. 存储方案比较与裁决

| 方案 | 优点 | 真正成本/问题 | 裁决 |
|---|---|---|---|
| 新建“我的记忆”项目或特殊 projectId | 现有页面似乎可直接复用 | 冒充成员权限、删除级联和作用域；会混进项目目录、Mission 和共享内容 | 拒绝 |
| 给 User 或设置表加一段 profile JSON / memory.md | 上线快 | 难以逐条纠正、保存来源、做并发版本和删除传播 | 仅可做可重建导出，不作权威存储 |
| 新 PersonalMemory/Event 表，另配提取和检索 | 不改旧项目表 | 容易复制 Claim/Event 与失效系统，形成两套纠正和血缘逻辑 | 仅在统一 Claim 的迁移探针否决后作为备选，服务合同仍必须共用 |
| 扩展现有 AgentClaim/Event 的作用域，账户策略另存 | 稳定身份、修订和事件可以复用 | projectId 可空会影响大量查询，必须完整审计；不是改一列就结束 | 推荐，先做范围保护再接用户入口 |

推荐扩展的是同一个认知账本，原始项目数据仍留在 Capture/Card/Attachment/Episode/Mission/Action。首批不建账户级 Digest，不复制项目的综合内容。等单条个人记忆确实过多时，再讨论同一编译器的账户摘要投影。

### 4.1 拟新增或调整的持久合同

下表均为拟议字段，不能直接当作已完成的 Prisma 迁移。

| 对象 | 增量 | 必须满足的约束 |
|---|---|---|
| AgentClaim | `scopeType: PROJECT | ACCOUNT`、ACCOUNT 下 `projectId=null`；个人语义 kind、使用条件与有效范围；保留 stable id/currentRevision | 旧记录全部回填 PROJECT；PROJECT 必须有 projectId；ACCOUNT 必须无 projectId/conversationId/missionId 这类项目归属字段，原出处放 manifest |
| AgentClaimEvent | 复用 revision/requestId/payloadHash/actorKind/userQuote/targetHash；增加个人记忆动作及作用域可验证的来源 manifest | 用户原话与模型解释分别存；ACCOUNT 事件不进入原项目 ClaimCorrection 的 controlSeq 解释链 |
| UserMemoryPolicy | 新增一张账户控制表，userId 唯一；使用、显式提取、候选推断及允许的模型处理范围；settingsVersion/contentRevision/privacyRevision、提取起点 | 开关相互独立；关闭读取不等于删除；默认不从历史记录追溯提取；所有变更持有原 User 写锁 |
| UserMemoryControlReceipt | 拟新增最小控制回执，唯一 owner+requestId，保存 operation/target/payloadHash/resultVersion/清除状态，不复制记忆正文 | 策略修改没有 claim 可挂；硬删除正文后也要防止旧请求重放而重建条目，因此不能仅依赖会被清除的 ClaimEvent |
| ProjectMembership | `personalMemoryMode: INHERIT | ALLOW | PROJECT_ONLY` 与版本 | 仅影响此成员自己的私有上下文；项目负责人不能替别人打开或读取个人记忆 |
| 原 Turn/Step/AgentRun 元数据 | 个人记忆 readSet、选择原因、策略版本、使用阶段 | 先复用 JSON manifest/trace，写入原输出事务；历史可查询，不另设永久“个人聊天库” |

新增数据库 CHECK 或等效持久约束检查 scopeType 与归属字段的组合；同时在 TypeScript/ArkTS 使用判别联合。`scopeKey` 由服务端规范化生成，客户端不能自填。索引至少覆盖 owner+scopeType+kind+状态与有效边界；旧 `owner+scopeKey+originKey` 唯一性继续成立。

最危险的迁移错误是把未知 projectId 变成 `undefined`，让 Prisma 静默省略范围条件。所有项目查询必须显式 `scopeType: PROJECT` 和已验证 projectId。不能将 `null`/空串/特殊项目作为“匹配全部”处理。

### 4.2 个人记忆条目的语义

个人条目至少有：原话或模型候选、规范化陈述、类别、条件、来源、使用范围、状态、修订、形成时间、有效边界。事实类标注为“用户自述”，不会因用户确认而变成外部验证结果。

- 明确偏好：用户希望怎样回答、拆解任务或协作。
- 稳定背景：用户明确提供的角色、能力或设备背景，保留时间条件。
- 长期关注：用户授权保存的方向，用于关联建议，不创建目标授权。
- 候选理解：模型从反复交互归纳的可能规律；未确认不参与个性化决策。

生效状态与可用性分开：条目可为 CANDIDATE、ACTIVE、PAUSED、SUPERSEDED、WITHDRAWN、DELETED；读取再给出有效、到期、来源不可用、范围不匹配或待澄清的原因。不要把全部问题都塞进“已过期”。

ACCOUNT 的首次原话可以是用户主动填写的 USER_ENTRY，由事件保存文本，origin 指向该事件；也可以来自可验证的用户直接消息。不能为了适配项目 ClaimLocator 而先造一个项目。项目派生内容继续引用真实项目根；用户接受候选只确认这段理解，并未自动切断它与来源的关系。

账户使用许可还要区分允许存储与允许交给当前模型处理。个人内容服从用户对处理方式/服务的许可，并与本轮原有云模型许可同时满足。项目的 `llmContextApproved` 不能默默授权发送账户个人背景。这个限制通过策略和调用前守卫执行，不能仅写在隐私说明里。

密码、Token、私钥、支付凭据不进入记忆；确需保管时复用专用凭据服务。健康、财务、身份等敏感内容禁止自动提取和候选画像。首个切片不开放这类个人记忆的持久保存，后续需单独审查具体用途和清除机制。

## 5. 两层之间怎样共享

“项目范围”也不等于“项目全体成员可见”。原资料/已发布成果按现有项目权限读取；owner 私有的 Mission、Claim、Digest 和 Conversation 保留自己的访问边界。新增个人记忆永远先按账户 owner 判断，不能仅因两个用户在同一项目中就共享。

| 场景 | 是否可用 | 生效方式 |
|---|---|---|
| 用户在“我的记忆”写“技术回答先给结论” | 可跨允许的个人协作场景 | 直接保存准确原话，范围清楚时无需再确认一次 |
| 用户在项目中说“这次先给结论” | 仅当前请求 | 不写长期偏好 |
| 项目里反复选 CPU | 只可形成带原因的候选 | 核对是否资源限制；不能自动激活个人偏好 |
| 项目 A 的研究结果 | 默认仅 A | 如需在 B 使用，走明确的跨项目资料选择；不包装成个人背景 |
| 从多个项目归纳“用户常先检查基线” | 可提出候选 | 保存不同来源和例外；确认抽象内容、使用条件和跨层许可后才可用 |
| A 已撤权/删除，其派生个人条目仍存在 | 默认停止使用 | 派生内容不因已确认而脱离来源；读取与在途发布均复核 |
| 用户独立重述一条自己的通用偏好 | 可以形成独立用户来源 | 新建重述事件和清楚的保留范围，不把旧项目材料批量洗成独立来源 |

### 晋升合同

“保存为我的偏好”冻结 `candidateId + candidateRevision + contentHash + originManifest + targetUseScope + expectedPolicyVersion`。服务端认证当前 owner，复核每个来源仍可访问，保存用户确认的原话与准入理由。重复确认同请求回放；载荷变化拒绝；旧候选版本返回 409 并保留草稿。

项目派生条目仍保留根依赖。若确认的是抽象协作规律，明确的 promotionGrant 只允许使用预览过的抽象陈述，不允许读取或转述原项目全文。内部可复核根权限与版本；模型要读原文时，必须重新取得当前项目集合的读取许可。

项目专有事实、他人资料、实验数值和保密信息不能通过“抽象”按钮自动获得账户通用资格。跨项目发现的是关联问题，最终证据仍来自用户允许读取的项目。

## 6. 归档、撤权和清除传播

归档只改变默认展示。独立个人偏好可继续有效，派生条目仍检查来源权限与原语义，不因为项目不在首页便丢失，也不因为归档便变成事实无效。

退出项目、OWNER 降级、撤权、删除、来源停用和原记录修订，需要重新计算派生资格。ACCOUNT 条目不能依赖 project 的 Cascade 就算处理完成：它本来就没有 projectId。必须显式走来源依赖检查，且在查询、派发与发布前 fail closed。显示时隐去不可访问的原文、项目名称和命中片段。

用户可另行确认一段真正独立的自述，使它以后不依赖原项目。此时必须展示将保留的个人内容；不能静默剪断依赖。旧事件里的已撤权项目内容仍按原清除/脱敏政策处理。

暂停、撤回、删除的区别：暂停保留内容和历史，停止使用；撤回终止当前有效版本，后续恢复要显式操作；删除立即阻止新消费，再清除正文、候选、派生摘要、向量、缓存和含原文的使用记录。审计可保留最少不含正文的操作标记，不能以“追加事件不能删”为由永久保留被删原话。

备份保留时限、日志清除周期和可恢复删除窗口要在实施前结合当前运维能力定值。API 应分别返回 `blockedFromUseAt` 与各存储的 purge 状态；只完成停用时不能显示“所有数据已彻底删除”。

删除还要留下不含正文的最小禁止重提取标记，关联原 source/locator 身份。清空全部个人记忆时推进账户提取起点，默认不重新扫此前的聊天；用户再明确添加一条内容是新的写入，不等同于后台自动复活。禁止提取标记本身也属于留存范围，需提供解释和管理，不能藏成永久秘密画像。

## 7. 接口边界

保留现有 `/api/projects/:id/agent-memory`、`agent-claims` 和项目指令接口。新增账户接口建议为 `/api/me/memory`、`/api/me/memory/policy` 及条目详情/commands/uses。它们只从 session 取 owner，拒绝客户端传任意 userId 查别人的记忆。

复用原幂等、CAS、事务和错误映射模式。写事务里提交条目修订、账户计数、控制回执和必要失效；模型、网络与文本综合在事务外运行。无资格的条目不能靠客户端隐藏或按钮禁用阻止使用。

### 7.1 服务输入与输出草案

| 用例 | 输入要点 | 输出与禁止事项 |
|---|---|---|
| 列表/检索 | session、cursor、类别/状态、用途；项目用途需当前项目绑定 | 只返回本账户且有当前资格的视图；不可访问来源不返回片段；声明覆盖 |
| 添加/修改 | requestId、operation、expectedPolicyVersion、原话、类别、条件、期限；修改另带 claimId/expectedRevision | 原事件与控制回执同事务；客户端不能指定 owner、actorKind 或伪造准入已通过 |
| 候选晋升 | candidateId/revision、预览内容 hash、来源 manifest、目标使用范围 | 检查候选、原话、当前权限和范围；旧预览拒绝，不能接受任意“confirmed=true” |
| 策略/项目例外 | requestId、expectedVersion、精确变更项 | 返回新策略与 privacyRevision；服务端决定影响域，客户端不能自称只是样式变更来绕过隐私失效 |
| 使用记录 | claimId、cursor、时间窗口 | 返回真实阶段与原对象指针；原对象失权后隐藏标题/内容，不以模型自述充当记录 |
| 删除/清除状态 | requestId、claimId/expectedRevision 或明确的清空命令 | 立即停止消费，后续返回分存储清除状态；重试不返回已删原话，不重新建行 |

拟议新增条目请求示例：

```json
{
  "requestId": "client-generated-stable-id",
  "operation": "ADD_EXPLICIT",
  "expectedPolicyVersion": 0,
  "entry": {
    "quote": "以后技术讨论先给结论，再按需要展开",
    "kind": "PREFERENCE",
    "appliesTo": { "topics": ["TECHNICAL_DISCUSSION"] }
  }
}
```

接口由已认证身份解析 ACCOUNT，不从此 JSON 接受 owner。`appliesTo` 是经验证的用途白名单，不能包含任意数据库过滤语句或工具许可。无策略行的版本零初始化也要在原 User 锁内完成。

命令返回稳定 receiptId/requestId、目标 id、已提交 revision、当时生效状态、当前策略水位和失效结果。重放先核对 payloadHash，再返回原操作回执；若对象后来已修订/删除，返回历史操作身份并让客户端读取当前视图，不能把旧状态重新发布成当前状态。

沿用仓库 401/403/404/409/422/503 错误分类；新增错误码须双端适配。找不到/无权读不泄露原文，版本冲突保留草稿，读回不可用不宣称删除失败或保存成功。回执与事件不应长期保存完整请求正文，尤其不能在删除正文后还从回执复原。

作用域入口必须统一为明确的 ACCOUNT 或 PROJECT 联合类型。现有 SourcePolicy 继续管理项目原根；新增账户解析分支复用其血缘规则与消费检查，不把 `sourceUse(null, ...)` 当成兼容。未知的 `personal-memory:` 来源默认拒绝进入证据或授权路径。

## 8. 实施前要做的探针

1. 在旧库副本上增加 ACCOUNT 范围后，所有原项目列表、纠正、导出、来源追踪和删除级联仍只读 PROJECT 行；构造同 owner 和不同 owner 的碰撞负例。
2. 比较统一 Claim 与备选账户薄表的实际迁移面。若必须动大量无关 API，允许改用薄表，但事件、准入、血缘、Composer 和清除服务保持统一，不另建 Runner。
3. 遍历原文读取、Digest、Hypothesis、Artifact、Experience、Proposal、设备草稿与缓存，确认删除/撤权没有绕路消费。
4. 对在途模型、外部读、未知回包和另端修改做真实屏障竞争，不能只检验 `stale` 标记。
5. 检查 JSON 使用记录的查询量。先保留最小可核对轨迹；只有索引和分页实测不足时，才增加可重建的查询投影。
