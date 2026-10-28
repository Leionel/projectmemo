# R4 审查追踪

## PR-6 联网搜索审查补充（2026-10-27，实现检查点，整体待验收）

公开范围、原来源/引用、研究总结确认、原 turn worker 与恢复负例已实现。新增 21 项研究/恢复/迁移检查及鸿蒙构建通过；完整质量矩阵、Web E2E、在线设备与 ECS 仍待验收。见实施记录与 `evidence/r4-agent-experience/20261027-pr6/delivery-checkpoint.json`。

| 审查项 | 计划落点 | 必须证明的行为 |
|---|---|---|
| P0-1 多查询研究 | 原 INVESTIGATE + ResearchCoverage；[方案](R4_PR6_WEB_RESEARCH_PLAN.md) §4–5 | 新观察改变查询/读取/停止；五条结果不自动表示充分。 |
| P0-2 用户 URL | 服务端登记原用户消息 URL，原 sourceId Fetch | 不先搜索、不接模型伪造网址、读不全明确范围。 |
| P0-3 时效 | 公开查询规划 + 来源适用版本/生效片段 | 发布时间、抓取时间、适用届次与生效状态分开，冲突保留。 |
| P0-4 阅读层级 | 共享来源 readLevel / retrievalMethod / 范围 | 摘要不冒充正文，网页片段不冒充论文/PDF/仓库全文。 |
| P0-5 长研究 | 原 turn 接收/推进分离、checkpoint、lease/fencing、外部 operation 预占 | 断线/重启复用原结果；UNKNOWN 不无意重放；取消后不发布迟到结果。 |
| P1-6 检索覆盖 | 原 12 开发题 + 24 独立覆盖题；[评测合同](R4_EVALUATION_PROTOCOL.md) | 六场景实测、原始来源/时效/冲突与用户成本；Provider 选择不只看价格。 |
| 生成式研究 UI | 原 investigation/evidence/comparison 等可信 catalog；[UI 协议](R4_UI_PROTOCOL.md) | 真实进展、引用回读、条件建议、继续/验证/保存的原绑定。 |
| 研究长期沉淀 | 原会话研究草稿 → 原确认 → Artifact + manifest/版本/回执 | 不是把回答全文直接当公共知识；不伪造 Mission 输出。 |
| Prompt V2 | [研究职责合同](R4_PROMPT_CONTRACTS.md) | 六项逻辑职责可合并调用，公开查询输入仍隔离，根预算仍唯一。 |
| 独立审查基线 | 本地 bf7ca1a / 远端 c8c7072 已实查 | 提供可解析提交或审查包后再签收独立代码审查；本轮未 push。 |

PR-5 更新：六项专责策略已接原调用方；原行动完成回执进入 D1/D2 Goal State 与同会话重评，聊天比较可直接预览原冻结候选，确认/幂等/源版本保持原链。Capture 收窄仅原文、Artifact 旧检查点冻结范围、Legacy 私聊隔离有回归。44 次实模的协议、内容、归属失败与后续修正分别保留。独立质量、真机和生产门槛未因测试通过关闭。

基线 c8c7072；本表落实本地 R4 v1.2 §12A–12E。状态「合同」表示已存在可运行类型/负例测试，尚未接入真实产品路径。

PR-1 更新：角色消息、分责 Prompt、根预算持久预占、workspace 只读适配器、动态调查/GoalGap 和真实步骤 API 已接入，并有三领域隔离库+Provider stub 旅程；对应质量/实模 Gate 仍未签收。后续 UI 行由 PR-2/4 继续，原追踪表保留最初领取位置。

PR-2 更新：模型 UI Plan 已进入原 turn；当前来源/权限/版本重绑定、原 execution 确认、幂等回放、审批原位转真实回执、Web 十种原生语义块、稳定草稿与停止已实现。原 WorkCard 继续承接 D1/D2；新 comparison/change/timeline 的业务投影后续接入。实模开发对照用了 24 次，三领域新增原文进入判断，但只有科研得到合法模型 UI；竞赛坏 JSON 安全降级，课程 UI 前触及评测额度，三例均未给行动。工程验证与产品质量 Gate 分开记录于实施记录与实模回执。

PR-3 更新：原 SOURCE_ARRIVED → 原会话 change/ASK，权限/版本重校、原停止/延后/去重，以及 Action 完成结果的同会话重评已接入。48 次实模保留三领域 C3 的确认/幂等/结果闭环；科研另做 C1/C2。原失败、竞赛澄清和最终 UI 额度降级见本轮证据；独立评分和完整跨域消融尚未签收。

PR-4 更新：ArkTS 十种原生语义块、原绑定、调查模式/进展/停止、按用户隔离的有界草稿已实现。86 项测试和最终 HAP 构建通过；实际模拟器确认→回执、原行动、草稿、变化入口、深色与系统放大字已核对。目标真机/键盘/全套读屏与完整控件旅程仍待验收。

| 审查要求 | PR-0 落点 / 当前事实 | 实际能力接入与验收 |
|---|---|---|
| 消息角色与完整预算 | `lib/agent/promptSpec.ts`：角色、数据、能力、预占合同 | PR-1 接原 Provider/持久配额；旧单 user 尚在 |
| Route/Investigate/Goal/Answer/UI 分工 | `R4_PROMPT_CONTRACTS.md` 十一项登记 | PR-1/2 实际 Prompt、schema 与配对比较 |
| 动态调查 | `investigationDecisionSchema`、`InvestigationStep`、预算校验；三领域分支 fixture | PR-1 实际中途观察→下一决定；非固定两步 |
| Project Evidence Explorer | `ExperienceEntityRef`、EvidenceLink 和 read scope | PR-1 workspace actor adapter；不得虚构 mission actor |
| Goal Progress/Gap | `goalGapSchema` 条件/状态/适用证据/未知 | PR-1 实际参与工具选择和推荐；不延至 PR-5 首次实现 |
| D1 变化理解 | change block 合同保留 goalQuote/changeKind/relevance/unknowns | PR-3 首条合法事件链，PR-5 深化跨领域 |
| D2 取舍 | comparison 候选、expectedObservation/branches/stopCondition | PR-5 原候选的真实比较与采用 |
| N6 结果反馈 | receipt、GoalGap REPORTED、CREATED 等合同 | PR-5 实测或授权适配器结果改变判断 |
| 自然表达与状态字典 | 文案规则及状态分层已冻结 | PR-2/4 字典、实际长短回答与理解度测试 |
| 模型 UI Plan | `presentationPlanSchema`；模型没有执行字段 | PR-2 真实模型选择不同合法布局 |
| 服务端绑定 | `experienceContract.ts` 纯 hydration，保持模型顺序/强调 | PR-1/2 实际鉴权、原对象 catalog 与双重版本检查 |
| 受限富文本 | richTextNodeSchema；正文/标题/列表/代码/表格 | PR-2 Web safe renderer；PR-4 ArkTS 可读降级 |
| 对话内操作 | AllowedAction 的候选/原 execution/hash/版本/期限 | PR-2/3 原预览确认事务与真实回执 |
| 真调查进度 | Step 状态/时间/观察 hash/coverage/usage | PR-1 持久轨迹；PR-2/4 用户投影 |
| 草稿持续性 | 稳定 blockKey/draftKey；旧 WorkCard key 风险仍在 | PR-2 修消息条数 key、页面返回和并发草稿回归 |
| Capture 保真 | Prompt 登记与失败定义 | PR-5 原 Schema 下保留猜测语气 |
| Artifact 覆盖 | Prompt 登记与无依据断言指标 | PR-5 覆盖/版本/出处的实际成果 |
| 旧 Copilot 兼容 | 原 DTO 仅加可选 presentation；旧服务未切换 | PR-5/6 旧历史/API、私有范围与风格回归 |
| 主动发现 | fixture 的 Event/Review 引用；没有后台扫描 | PR-3 合法事件→发现→追问；PR-6 扩覆盖/降噪 |
| 双端与跨领域 | 同一合成 JSON，ArkTS 镜像与类型一致性检查 | PR-3/4 实际渲染、业务/设备旅程；三领域独立质量 |
| 质量、效果与费用 | `R4_EVALUATION_PROTOCOL.md` C0–C3/硬失败/留出规则 | 后续独立样本与人工评审，原失败不覆盖 |

冻结的是跨批次接口，未交付行不得因表中出现而改为完成。当前原 Focus 和 F3 的质量、设备、ECS 门槛继续按原记录保留。
