# UX-2 R2：当前代码与公开系统对账

审计基线：2017c31（UX-1），以当前工作树为准。本轮未运行 UX-2 写入探针或付费模型。原 [UX-0 对账](D:/Projects/hongmen/planning/r4-agent-ux-integration/CODE_DEMO_AUDIT.md) 是 e8281d6 时点的记录；F01/02/03/09/10 的 UX-1 修改与验收见实施记录，F07 未在 UX-1 夹带修复。

## 1. UX-1 与 CT 的实际状态

UX-1：共享 WorkState、焦点选择、原位方向控制、草稿／请求恢复、双端 DTO 和原回执接续已实现。本地检查包括全量 143 文件／1197 测试、随后受影响 55 项、完整 Web 27 通过／2 跳过、最后重建 Web 6 项、鸿蒙 86 项和 HAP。HDC 无设备；不能宣称真实手机和自然日用户验收完成。

CT-1 的指令／失效、CT-2 CI、CT-3 有界调查、CT-4 PDF、CT-5 指标／固定核算、CT-6 Crossref 均在当前提交链。继承的质量欠账仍包括 PR-6 独立语义、真实失败日志域名、复杂 PDF/OCR、完整新工具 Conversation+GenUI 实模质量、真实多日及目标设备；原合成 pilot 不证明现实研究成功。

本轮保护 AGENTS.md、旧 Agent Evolution Roadmap、harmonyos/build-profile.json5、tsconfig.json 四项既有修改。UX-2/3 只改规划；不修改这些业务实现或启动 worker。

## 2. L0～L3 代码映射

| 层／语义 | 当前实现位置 | 覆盖了什么 | 真实差距 |
|---|---|---|---|
| L0 原始经历 | [Capture/Card schema](D:/Projects/hongmen/prisma/schema.prisma)、[cards repository](D:/Projects/hongmen/lib/repositories/cards.ts)、Attachment/Revision | 原话、附件修订、卡片、原来源类型和历史 | 卡片摘要不自动具有逐句血缘；外部资料转 Capture 的上游来源不能丢失 |
| L0 工具观察 | [PR-6 researchTools](D:/Projects/hongmen/lib/conversation/researchTools.ts)、[documents/observations](D:/Projects/hongmen/lib/documents/observations.ts)、[metrics](D:/Projects/hongmen/lib/experiments/metrics.ts)、[academic](D:/Projects/hongmen/lib/research/academic.ts) | 快照、物理页、条件、元数据、真实固定核算回执；原权限与版本检查 | 尚无跨这些观察的稳定“同一假设”及其反证历史 |
| L1 时态／使用资格 | [temporalLedger](D:/Projects/hongmen/lib/memory/temporalLedger.ts)、[sourcePolicy](D:/Projects/hongmen/lib/continuity/sourcePolicy.ts)、[memoryLifecycle](D:/Projects/hongmen/lib/services/memoryLifecycleService.ts) | 争议／取代／当前／未知、用户确认、归档、抑制、部分派生链 | CURRENT 是当前记录；确认是用户声明；二者都不是独立实证 |
| L1 主张 | [AgentExperience types](D:/Projects/hongmen/lib/types/agentExperience.ts)、[Episode types](D:/Projects/hongmen/lib/types/episode.ts)、Mission output blocks | GoalGap、EvidenceLink、Episode claim、Output INFERENCE，局部定位和来源 | 缺通用跨端 locator、跨会话身份及独立生命周期 |
| L1～L2 意图 | [admission](D:/Projects/hongmen/lib/continuity/admission.ts)、[directiveService](D:/Projects/hongmen/lib/continuity/directiveService.ts) | 原话准入、scope、期限、撤回、STOP、有效 hash | 类型只有工作目标／限制／停止／停用来源；解释纠正尚未实现 |
| L2 阶段经历 | [projectEpisodeService](D:/Projects/hongmen/lib/services/projectEpisodeService.ts)、EpisodeRevision | 分节原因、冻结来源和 claim；模板／模型压缩；发布确认事务内重算 sourceHash | claimId 由 c1/c2 等局部顺序生成，不能独立贯穿不同修订；项目共享语义不适合直接承载私有用户综合 |
| L2 记录整理 | [memoryConsolidationService](D:/Projects/hongmen/lib/services/memoryConsolidationService.ts) | 有界重复建议、归档归并、原回执、撤销不覆盖后续修改 | 不是长期语义综合器；原确认的 inputHash 主要绑定对象 ID，不应直接升级成“新综合事实已获批准” |
| L2 依赖失效 | [impactJobs](D:/Projects/hongmen/lib/decision/impactJobs.ts)、[decision/impact](D:/Projects/hongmen/lib/decision/impact.ts) | 原 mutation receipt 去重、事务内 PLAN_STALE、原批准失效、Mission 版本和 lease 更新 | 当前主要面向计划；需要扩认知依赖，但不应在事务中运行语义整理 |
| L2 经验 | [experience/service](D:/Projects/hongmen/lib/experience/service.ts)、[trajectoryIndex](D:/Projects/hongmen/lib/experience/trajectoryIndex.ts)、[injection](D:/Projects/hongmen/lib/experience/injection.ts) | 案例、SHADOW/ACTIVE、撤销、适用条件、使用记录；工程／采用／自报结果分开 | listExperiences 会 sync；新只读页要有纯读路径；更深入条件经验仍属 CT-8 |
| L3 当前任务 | [workspaceContextService](D:/Projects/hongmen/lib/services/workspaceContextService.ts)、[Investigation](D:/Projects/hongmen/lib/conversation/investigationService.ts)、[Mission contextBuilder](D:/Projects/hongmen/lib/mission/contextBuilder.ts) | 身份／项目范围、有效意图、原文动态读取、来源检查、原结果和预算 | 上下文分布在多个入口；部分目录仍用原 status 摘要，需消费 UX-1 WorkState；长期综合、稳定假设及纠正还未统一接入 |

L3 现有裁剪包括原文头尾片段和工具数据预览。这是有覆盖说明的工程上限，不能把被裁掉的中间内容当作“不存在”。新 Composer 要能据缺口请求原文／指定页，不把摘要当最终证据。

## 3. 必须正面解决的差距

### M01：稳定认知身份

现有 GoalGap 随 turn manifest 保存，Mission 输出和 Episode 有版本，但缺独立的假设身份与跨会话状态查询。用户今天反驳昨天的推测时，不能只按相似文本找“最近那一条”。新 Claim/Event 补这个缺口，旧主张先通过原对象＋修订＋局部 locator 包装，不批量语义猜测回填。

### M02：纠正不等于指令

Directive 已承担用户控制和执行失效；Temporal Relation 承担记录间取代／反驳；Lifecycle 承担用户确认／归档。任何一个都不完整表达“模型把我的自报理解成实证”。R2 推荐 ClaimEvent 记录这种解释纠正，沿原复用 hash 和协调机制传播。工作指令仍用 Directive，事实材料仍用 Capture/Revision/Relation。

### M03：私有综合与共享 Episode

Episode 已有冻结来源和不可变发布，应该复用其 manifest／确认经验。它没有独立 owner 私有域；不能把私人 Conversation、用户偏好或未公开 Mission 写进去，再凭项目成员身份展示。新的 Digest 是 owner/scope 隔离的派生缓存；分享阶段总结仍经过原发布与来源披露校验。

### M04：F07 和外部来源转存的血缘

[repoSource.actOnSignal](D:/Projects/hongmen/lib/sensing/repoSource.ts) 的新 CANDIDATE 采纳路径在创建 Capture 前缺当前 ACTIVE/revision 校验；旧命令重放已存在，应保留。ExternalSignal 当前缺捕获时授权 revision 的明确绑定，不能只在客户端补一个当前连接 revision 就算完整修复。

同类问题还需检查：该路径创建 sourceType=仓库信号的 Capture，而 sourcePolicy 的 capture 分支主要检查记录存在。静态调用链表明，不能未经探针就声称采纳后仍能完整追到原授权和来源版本。UX-2A 必须核查并补上游关系，防止外部片段转存后被当成独立用户证据。此项是待实施验证的风险，不是本轮运行结果。

补充版本语义：原 SourceConnection.revision 在每次刷新提交（包括 304／已知错误）也递增，不是纯授权代际；当前 REVOKED 连接不能原地恢复。实现不能把一次无变化刷新当成撤权，也不能把“撤销再授权”假定为现有产品功能。需要区分当前连接／授权身份、观察版本与并发 CAS，并测试新连接／新 ref 读到同 SHA、以及未来若支持原地重授时的历史隔离。

### M05：确认合同与新 UI 的含义

Episode 发布已有事务内 sourceHash 重算，不重做。整理确认和普通 Card PATCH 的版本／内容保护不能默认满足“批准新事实”的含义；原整理是归档关系操作。UX-2 新快捷动作需明确目标、预览、原版本及实际效果，再补原服务的必要 guard，不能借旧接口绕过。

### M06：从记录到后续判断的闭环

如果纠正只存 metadata、假设只显示卡片、综合只导出 Markdown，Agent 后续工具选择不会稳定改变。必须同时接 ContextBuilder、Investigation、原 source/readset guard、Artifact 再利用、经验读取和待批提案失效；以真实下一步和原回执验收。

## 4. 公开系统对照：能验证什么，借鉴什么

以下为 2026-10-30 查询时的公开资料。产品说明只证明公开行为，不能据此推断其数据库、内部 Prompt 或后台算法。

| 系统／证据 | 公开可验证机制 | ProjectMemo 裁决 |
|---|---|---|
| [ChatGPT Dreaming](https://openai.com/index/chatgpt-memory-dreaming/) | 官方描述后台综合聊天历史，并以延续有用背景、遵循偏好、随时间更新评价记忆；用户可查看／调整摘要 | 借鉴事件后的长期综合与行为评测；不臆测隐藏调度或内部 schema，不把 Dreaming 当研究假设 |
| [Claude Memory](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context) | 当前帮助页区分项目记忆、账户记忆、历史检索和记忆控制 | 借鉴明确范围和用户修改入口；本项目项目事实不默认进入账户综合 |
| [Meta Muse](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) | 官方公开目标延续、记忆、连接权限、敏感操作前核对及活动审计 | 借鉴长期目标与可见控制；公开页未给出可复用的记忆 schema，不采用流传的内部 Prompt 作为机制证据 |
| [Letta 当前源码](https://github.com/letta-ai/letta-code/blob/8f6f77306d36b7b087f642ef9e1785b5af9075a9/src/agent/memory-filesystem.ts)、[冲突处理](https://github.com/letta-ai/letta-code/blob/8f6f77306d36b7b087f642ef9e1785b5af9075a9/src/agent/memory-conflict-repair.ts) | 可见按 agent/scope 定位的 memory filesystem、Git 同步和冲突修复；另有 memory worker | 借鉴版本、冲突和作用域；本项目继续 Prisma 和原 Runner，不搬入 Git 记忆真源或第二 worker |
| [Mem0 当前 main.py](https://github.com/mem0ai/mem0/blob/26cdefb46600c0fa5953c4b5ee5003c125539fc4/mem0/memory/main.py)、[Update 文档](https://docs.mem0.ai/core-concepts/memory-operations/update) | 当前代码能核对身份过滤、additive extraction、显式 update 和 history；不能沿用旧介绍推断每次 add 自动改写所有旧事实 | 借鉴稳定 ID、范围与变化历史；业务事实更新仍要保留原证据／版本语义，不直接套向量记忆覆盖操作 |
| [LangGraph Memory](https://docs.langchain.com/oss/python/concepts/memory)、[Store 基类](https://github.com/langchain-ai/langgraph/blob/6f2df053f4487ce6ea8decc0d7482c8e46e0f132/libs/checkpoint/langgraph/store/base/__init__.py) | 区分线程检查点和跨线程 namespace store，可选热路径／后台记忆；代码有 get/put/search/TTL 等接口 | 借鉴分层和更新时机；namespace 不替代本项目权限，持久存储不替代证据／认知有效性 |

此处 Muse 指 Meta 产品；同名学术 MUSE 和其他 Muse 开源项目不混算为其实现。Letta 的旧 memory URL 已重定向到 legacy V1 文档，不能把旧 SDK 结构当最新代码；本次同时读了当前 letta-code 的具体文件。

工程可借鉴仓库均满足本项目维护度筛选：Letta 25,290 stars，letta-code 3,738，Mem0 68,064，LangGraph 44,120；查询时均未 archived，最近 push 在 2026-10。前三者 Apache-2.0，LangGraph MIT。数字只用于本轮选材，不作为设计正确性的证明；本轮不引入这些依赖。

## 5. 方案比较后的裁决

保留当前系统有价值的部分：原数据和回执、Episode 修订、Temporal/SourcePolicy、Intent 时间视图、Mission/Turn durable 运行和 Experience。新增稳定 Claim/Event 与可重建 Digest，把缺失的认知语义接进原上下文和原工具循环。

这比只增加 memory.md/dream.md 多了身份、时态、依赖、并发和消费合同；比引入完整外部记忆 Agent 少了重复 Runner、重复权限、重复账本和跨端适配。最终价值要由纠正传播、负迁移、实际调查改道和任务完成评测证明。
