# UX-2 R2：Memory Evolution × Dream Verification

日期：2026-10-30，北京时间。代码基线为 UX-1 本地提交 2017c31；本目录只做审计、研究和规划。UX-1 的正式证据见 [实施记录](D:/Projects/hongmen/R4_AGENT_UX_IMPLEMENTATION_NOTES.md) 和 [检查摘要](D:/Projects/hongmen/evidence/r4-agent-ux/20261030-ux1/acceptance-summary.json)。生产、目标设备、自然日用户及独立质量 Gate 各自保留。

本修订替代原 Roadmap 中“Dream 仅联合只读投影”和“解释纠正默认写 AgentDirectiveEvent”的技术建议。它保留原 UX-2 的工具、动态调查、双端和验收范围，并增加稳定认知对象、事件驱动综合与实际上下文消费。

配套文件：

- [当前代码和公开系统对账](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/CODE_AND_RESEARCH_AUDIT.md)。
- [记忆演化、假设、纠正与可信合同](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/MEMORY_EVOLUTION_CONTRACT.md)。
- [上下文、工具与双端体验](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/AGENT_CONTEXT_AND_UX.md)。
- [评测、实施顺序与 UX-2A Prompt](D:/Projects/hongmen/planning/r4-agent-ux-integration/ux2-deepening/EVAL_AND_IMPLEMENTATION.md)。

## 1. 需要补的不是更多记录，而是记录之间可持续使用的关系

当前系统已经能保存原始资料、附件版本、项目阶段、当前指令、任务、结果和部分经验；也能自主读原文、使用工具并接续任务。真正的缺口是：同一判断跨会话是否仍有同一身份，为什么形成，哪些材料支持或反驳，条件变了后哪些内容失效，以及这些变化如何影响下一次实际调查。

用户能感知的改进有四项：

1. D1 说过的背景和原因，D3 不必重复解释；旧结论过期时仍能看到当时依据。
2. 指出“这只是我的报告”后，检索、回答、建议、成果和接续都按纠正后的语义工作。
3. 昨天的研究假设今天能继续验证；新实验反驳时，Agent 改变下一步，而不是重复旧建议。
4. 原文很多时先看简明、有出处的当前理解；需要深入时 Agent 能返回原文，而非依赖层层摘要。

## 2. 两种 Dream 必须分开

**后台整理（Dreaming）**是把新经历整理成带来源、版本和适用范围的综合结果。**研究假设（Dream/Hypothesis）**是尚待验证的认知对象。整理可以产生候选假设，但整理成功不等于假设受支持；假设受支持也不等于现实目标完成。

用户界面继续使用“已记录／待核实／变化经过”。“最近整理”放在变化详情，不额外建立一级导航。memory.md / dream.md 是可导出的上下文投影，数据库中的原记录、版本、权限与回执决定当前有效性。

## 3. 六种语义、四层处理

| 语义 | 原有承载 | 本次增量 |
|---|---|---|
| Fact / Evidence | Capture、Card、AttachmentRevision、ExternalSource、工具观察、Temporal Ledger | 保留原始观察／自报／推断层级；补精确 locator 和派生闭包 |
| Episode | ProjectEpisode、EpisodeRevision、快照与决定记录 | 保留阶段和原因；私有跨会话综合不能直接写入共享 Episode |
| Intent | AgentDirectiveEvent、Effective Continuity | 继续原准入、范围、期限、停止和撤回；不让模型记忆变成目标授权 |
| Commitment | Action、Mission、WorkState、Readback、resultCardId | 作为综合和上下文中的未完成承诺；保留责任方、等待条件和真实结果 |
| Hypothesis | GoalGap、Investigation、Output INFERENCE、Decision 候选 | 增加稳定身份、修订／证据历史、有效状态、原调查关联与重验资格 |
| Experience | AgentExperience、trajectory、Use | 读取原案例与适用条件、反例和撤销；更深入效果学习继续 CT-8 |

L0 是原始经历和证据；L1 做定位、归属与结构化；L2 做综合、时态和假设演化；L3 按当前任务组织上下文。每层都保留通向 L0 的证据边，不能让 L2 总结反过来成为新的独立原始事实。

## 4. 推荐架构与相对现有系统的增量

推荐在原 Prisma 数据库增加三个有明确用途的对象，名称待实施时按相邻模块调整：

- **AgentClaim**：稳定的认知主张身份，含 owner、scope、origin locator、种类、当前修订指针。Hypothesis 是其中一种，不复制原始资料。
- **AgentClaimEvent**：追加的提出、证据关联、评估、用户纠正、撤回等历史；模型判断与用户原话分别记录。
- **AgentContextDigest**：可丢弃、可重建的综合缓存，绑定来源清单、事件水位、当前目标／复用策略、编译版本和覆盖。它不成为新的事实源。

比较依据：仅扩 Card 的 idea 类型难以容纳独立假设状态和精确纠正；仅复用 Episode 的局部 c1/c2 不能表达跨版本认知身份，且 Episode 是项目级共享阶段对象；把所有纠正放 Directive 会混淆用户对事实解释的异议与工作授权。新增对象补的是这些缺失语义，原 Capture/Temporal/Intent/Mission/Experience 仍各司其职。

不新增 Memory 数据库、向量系统、Runner 或 Planner。ImpactJob 继续负责便宜的失效与资格标记；语义整理和验证作为原 Conversation/Mission 的受限能力执行，沿同一 lease、步骤、模型／工具预算和 UNKNOWN 账本。原 Episode 可引用经过核对的综合结果，正式共享发布仍走原确认。

## 5. 一个完整 UX-2 内的三个检查阶段

| 阶段 | 真实用户旅程 | 服务／数据增量 | 双端及工具范围 | 必须提供的证据 |
|---|---|---|---|---|
| **UX-2A 可信基础与完整证据交互** | 从原判断追到网页／PDF／论文／实验记录；纠正其中一句，旧提案失效，新会话能读回纠正 | F07 guard 与来源绑定；claim locator、Claim/Event；纠正与停用分流；原复用策略和消费保护 | Web 深读／比较与就近纠正；鸿蒙轻量纠正、原件、原任务；PR-6、CT-4～6 全保留 | UX-J04/05/06/09/10/14 中相关工程负例、端侧操作和来源闭包 |
| **UX-2B Memory Evolution 与 Context Composer** | 新结果到达，旧综合需重核；回来时 Agent 带着有效背景继续，并能返回原文 | Digest、事件水位／依赖清单、增量编译、原上下文双入口消费、只读经验读取 | 已记录／变化经过与任务内语境；不新建控制台 | 无变化零模型、纠正传播、摘要递归负例、上下文消融及真实下一步变化 |
| **UX-2C Dream Verification 与动态调查** | D1 提出可验证假设，D3 被新证据反驳，D5 接回同一认知对象和原任务 | 有效生命周期、调查关联、支持／反证与条件评估、原预算下重验资格 | 动态 Investigation/GoalGap/Presentation；论文与项目指标比较，获批固定核算和真实回执 | 完整多轮／跨项目／跨工具旅程；正负结果均可改道，不能只评存储成功 |

A/B/C 是内部依赖与检查，不是三个可缩水放行的产品。B 的失效合同要在 A 第一次写入纠正时就成立；C 的稳定身份也要在 A 定义。实现可交错，完整 UX-2 必须同时覆盖三阶段及原六项 UX-J 验收。

## 6. 权限与自主性的裁决

在当前请求或已批准持续委托的范围、预算和来源许可内，Agent 可以自行提取、综合、形成可测试假设、选择工具、读取原文、记录评估和改变调查路径；这些认知更新不要求用户逐项审批。

新的目标／限制仍走原 Directive Admission；新的背景付费执行仍需已有持续许可；固定核算、内部业务变更与未来外部写仍走各自原批准。新假设、综合文本和模型解释都不能扩展这些许可。没有背景模型许可时先做失效标记，当前会话仍可在已批准预算中继续调查。

用户纠正优先进入 ClaimEvent；“先别联网”“本周先做什么”仍进入 Directive；“以后别参考此来源”仍走 SUPPRESS_USE；“少提醒”仍走个人偏好。纠正会改变复用资格并使原消费者重核，不能只有记录没有消费。

## 7. 与 UX-3、CT-7～10 的接口

UX-2 提供 dirty reason、有效认知版本、重验资格、原承诺及来源依赖；UX-3 决定何时在责任范围内唤醒、是否值得打扰和怎样跨端接续。二者共用原 Mission/Attention，Hypothesis 本身不是后台执行许可。

CT-7 把部署观察作为新的 L0 证据；CT-8 深化条件经验、反例归因和负迁移评测；CT-9 提供 Browser/外部应用观察；CT-10 增加具体外部写和效果回执。UX-2 不等待这些 adapter 才完成，但其来源和结果必须能接入同一合同。

小艺以后可查询“当前判断、为什么变化、还等什么”并打开原 App。正式账号、设备、后台投递和语音可执行范围仍按真实平台签收，不能让认知状态变成审批令牌。

## 8. 完成边界和未关闭 Gate

UX-2 的工程完成必须包含真实数据身份、原服务执行／回执、上下文实际使用、动态换工具／结束决定、纠正跨消费传播和双端功能；单独建表、导出 Markdown 或只做待核实卡片都不算完成。

本轮只是规划。待实施探针包括：通用 locator 的跨端一致性、旧数据血缘、纠正与确认并发、后台预算归属、同 SHA 不同连接 revision、综合的增量成本、假设状态语义判断，以及设备阅读定位。真实模型、人评、自然日使用和目标设备单独验收。

## 9. 实施状态（2026-10-30 收尾）

三阶段工程目标已在原系统内实现并提交（实施记录见 R4_AGENT_UX_IMPLEMENTATION_NOTES.md「UX-2 完整实施」）：A 的纠正／撤回／来源保护与双端入口，B 的 AgentContextDigest 与两个原消费入口，C 的稳定推测、cognitiveReadSet 与原批准／确认／Runner 链接。新增输入版本复用原 ImpactJob 回执；上下文容量用 facetBudget 显式裁剪并标注 omitted。审查修复了纠正原文读取权限绕过、行动复盘与会议确认缺失的输入版本推进、Runner 硬编码角色、以及模拟器验收发现的两个 ArkTS 缺陷（记忆面板不可达、纠正草稿未绑定）。

已签收：工程与原执行链（合成模型、隔离库）、Web E2E、ArkTS 86 项、HAP 构建、模拟器真实操作（隔离身份）。仍未签收：真实模型语义质量与消融、独立盲评、多用户三类项目三自然日、真机与生产部署。本节不改变第 8 节的完成边界。
