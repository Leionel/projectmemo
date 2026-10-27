# R4 审查追踪 · PR-0

基线 c8c7072；本表落实本地 R4 v1.2 §12A–12E。状态「合同」表示已存在可运行类型/负例测试，尚未接入真实产品路径。

PR-1 更新：角色消息、分责 Prompt、根预算持久预占、workspace 只读适配器、动态调查/GoalGap 和真实步骤 API 已接入，并有三领域隔离库+Provider stub 旅程；对应质量/实模 Gate 仍未签收。后续 UI 行由 PR-2/4 继续，原追踪表保留最初领取位置。

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
