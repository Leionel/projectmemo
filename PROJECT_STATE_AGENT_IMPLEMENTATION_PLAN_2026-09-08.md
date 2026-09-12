# ProjectMemo：项目状态记忆与可验证主动推进实施计划

日期：2026-09-08。性质：实施交接文档；本文新增能力均未因计划写成而完成。

## 1. 决策与交付范围

采用你提供的方案定位：**持续维护有证据、具时间有效性的项目状态，在值得关注的变化发生时解释影响，并让用户确认后推进。**

本计划围绕一条完整链路组织交付：

> 录入项目变化 → 预览并确认 → 当前状态与上次状态对比 → 点开证据 → 确认行动 → 补充结果 → 状态再次变化。

范围更新：按用户追加意见，原文的 P0、P1 全部纳入正式实施范围，详见第 8 节。小艺真实对账、Temporal Ledger / Trust Receipt 真实展示、最小 Snapshot / Diff、真实用户验证仍是第一批交付门槛；Intervention Budget、偏好调整、Change Brief、Meeting State Diff、Action Feasibility 不再只是远期建议。全部纳入计划不代表同时开工或保证复赛前全部完成；实际版本范围按各任务验收结果冻结。P2 的调度、外部连接器和自动记忆整理继续暂缓。

本文不另建图数据库、不重写现有 Agent、不新增一套通用任务管理系统。竞品定位、论文数字和 9 月 30 日日期来自用户输入，本轮没有重新核验；它们作为设计背景，不能直接写进已验证的研究结论或官方赛程承诺。

## 2. 当前依据：什么可以复用

本轮重新读取了 Prisma schema、Temporal Ledger、Trust Receipt、changeImpactService、功能开关和现有计划。旧复审报告只作为回归清单，不能替代当前验收。

| 能力 | 当前代码入口 | 实施判断 |
|---|---|---|
| 时间关系 | `prisma/schema.prisma` 的 CardRelation；`lib/memory/temporalLedger.ts`；`lib/repositories/temporalRelations.ts` | 已有确认、撤销、生效区间及关系计算，必须复用 |
| 决策时间线 | `lib/services/temporalLedgerService.ts`；`app/api/projects/[id]/decisions/timeline/route.ts` | 可作为真实 UI 数据源 |
| 证据回执 | `lib/evidence/trustReceipt.ts` | 已有逐 claim 的 cardIds 和状态；当前主要检查来源/时态，不等于证明文本语义蕴含 |
| 变更预览与确认 | `lib/services/changeImpactService.ts`；`decisions/impact-preview`、`decisions/confirm-change` | 最新代码已增加持久提案内容绑定、取消集合校验和匹配评分；本轮未运行新回归，不能继续称旧缺陷已实测存在，也不能宣布验收通过 |
| 行动完成与反思 | `lib/services/actionService.ts` | 复用完成事务及结果卡，不另建 Action 系统 |
| 规则干预 | `lib/services/agentContextService.ts`；AgentIntervention | 有规则、去重、接受/延期/忽略字段；没有独立 Budget / Policy 决策模型 |
| 交付物证据 | `lib/services/milestoneService.ts`；Milestone / Deliverable / DeliverableEvidence | 可提供缺口数据；人工核对原件与提取成功应分开表达 |
| 项目状态 | `lib/projectDashboard.ts` | 现有派生统计可复用输入；schema 尚无 ProjectStateSnapshot，不能视为已有历史状态 |
| 鸿蒙入口 | `harmonyos/entry/src/main/ets/pages/ProjectHome.ets`、现有 components | 嵌入现有概览与证据页面，避免继续堆主 Tab |
| 小艺 | `ProjectMemo_2.1_PLAN.md` 的 W03；`scripts/verify-xiaoyi-public.ts` | 沿用既有四能力和对账方案；当前公网与平台状态需现场验证 |

最近复审记录为 20 文件 / 125 项 Vitest 通过、TypeScript 有错误，属于当时版本证据。本计划没有重跑测试，也没有把旧 HAP、离线 Hypium 或节点 SUCCESS 当作当前端到端通过。

## 3. 先统一语义，避免把“状态”做成又一个分数

### 3.1 四个维度分开

| 维度 | 取值/来源 | 约束 |
|---|---|---|
| 记忆处理过程 | 观察、结构化、关联、确认、整理、归档 | 不是一个覆盖所有业务的数据库状态枚举；复用 Capture、卡片、关系和后续 Episode |
| 时间有效性 | 当前已有 CURRENT / SUPERSEDED / CONFLICT / PENDING / REVOKED / INSUFFICIENT | 沿用后端值；显示“存在冲突”可对应原文 Contested，不另造冲突判定器 |
| 结论支持程度 | SUPPORTED / CONTESTED / INSUFFICIENT | 属于具体 claim；有效卡片并不自动支持任意一句结论 |
| 对问题的判断 | TRUE / FALSE / UNKNOWN | 每个 predicate 定义含义，不能把 UNKNOWN 默认为 FALSE |

例如 `hasRecordedCompletion` 可由完成记录回答 FALSE；`actuallyCompleted` 在只有 TODO 和没有回执时应为 UNKNOWN。界面写“系统尚无完成回执”，不能写“实验肯定没完成”。用户补充明确的未完成记录，才能支持相应未完成结论。

同样，`TemporalDecisionItem.current` 目前只是“未被取代”的宽泛布尔值。状态构建不能仅据此将 PENDING、REVOKED、INSUFFICIENT 当作已确认事实；应使用明确状态和相应规则。

### 3.2 状态字段的第一版来源

| 字段 | V1 来源 | 无法确定时 |
|---|---|---|
| goal / deadline | Project 的显式字段 | 标记未设置；不由模型补日期 |
| stage | 用户确认的项目阶段；V1 可先不提供编辑能力 | UNKNOWN，不按卡片数量猜阶段 |
| confirmedProgress | 明确完成记录、人工确认的交付物证据，并标明确认方式 | 不从正文“成功”等关键词推断 |
| activeDecisions | 已确认且当前有效的关系链 | 无确认关系显示待确认/证据不足 |
| openActions | ActionItem 的 TODO / DOING | 只描述系统记录 |
| evidenceGaps | expectedEvidence 与已确认关联的差额 | 区分“缺关联证据”和“现实未完成” |
| risks | 既有确定性规则与显式风险记录 | 显示规则原因；缺输入不能强判无风险 |
| health | AT_RISK / ON_TRACK / UNKNOWN | 有已支持风险才 AT_RISK；输入完整且规则均为否才 ON_TRACK，否则 UNKNOWN |
| nextCriticalTransition | 基于已配置交付物/截止日期的规则候选 | “暂无足够信息”，不写泛化口号 |

V1 不输出“理解度 80%”“高置信度 98%”。Project Understanding 展示哪些字段已知、哪些未知即可；相同附件派生的多张卡不能算多个独立来源。

## 4. 复赛执行包与依赖

下列工期是第一批交付的单人有效开发时间估算，不是承诺。默认 T0 为实际开工日；现有修复验证后可缩减。第一批约 7–10 个开发日，用户试用另需自然日，尽早启动。纳入全部 P0/P1 后，第 8.2 节追加任务初估另需 7–12 个开发日；这不包含平台等待，也不能挤掉第一批验收。

| ID | 交付物 | 前置 | 估算 | 结束标准 |
|---|---|---|---|---|
| R0 | 当前代码可信基线 | 无 | 0.5–1 日 | 回归结果、版本 manifest、未关闭问题清单 |
| R1 | 一条真实决策演化与逐句证据 UI | R0 的相关缺陷关闭 | 1–2 日 | A→B 可追溯，旧 A 不作为当前结论来源 |
| R2 | Snapshot / Diff 全栈最小闭环 | R1 的语义契约 | 2–3 日 | 确认变更后生成状态历史，重启后仍能比较 |
| R3 | 小艺现有能力真实对账 | R0；不依赖 R2 | 0.5–2 日，外部等待另计 | 平台、后端、App 的请求及业务 ID 对齐 |
| R4 | 用户试用与复赛证据包 | R2 可用；R3 单列平台结果 | 1–2 日准备；7–14 日观察 | 原始匿名记录、分母、失败案例、同版本录屏 |

执行顺序：R0 → R1 → R2 → R4；R3 在环境允许时独立推进。平台阻塞不阻止本地状态能力实施，但不能据此把小艺能力标记完成。

### R0：修复回归关口

1. 保存当前 commit、dirty diff 清单、关键文件哈希、Node/SDK 版本；不得 reset 或覆盖正在进行的修改。
2. 重跑合法提案被改 payload、跨项目输入、取消项超出预览集合、重复确认。以当前代码为准，不要求重复实现已有修复。
3. 加入多卡干扰、同名/相近标题、时间失效与撤销关系、匹配并列场景。评分只能生成候选；有歧义必须选择，不得自动取代。
4. 检查附件二次校对、旧值检索、真实 claim 来源、演示 FAQ / Widget 的数据来源。若尚未接真实数据，明确标识示例或移出正式演示。
5. 分别运行类型检查与测试。类型错误必须修复，不能用测试运行成功抵消。

通过条件：没有可复现的未授权事实替换/跨项目写入；演示涉及的证据与成功文案符合真实写入。非演示扩展缺陷可登记后延期。

### R1：把已有 Ledger / Receipt 接成可信体验

修改入口：`temporalLedgerService.ts`、`trustReceipt.ts`、`ClaimAuditorDrawer.ets`、`EvidenceSpineView.ets`、`common/ExportFormatter.ets`、`ProjectHome.ets`。必要时扩充 `lib/types` 及鸿蒙响应模型。

- 展示“原决策 → 替代决策 → 确认时间 → 原因 → 证据”。取代方向固定为新卡 SUPERSEDES 旧卡。
- 抽屉接收当前 claim 的引用集合与后端回执，不传全项目卡片充当证据，也不按“方案 A”“超标”等词判断状态。
- V1 状态结论使用确定性模板和结构化字段，因此可验证“这条证据为何支持此句”。自由生成的文本如果只有相关卡片，显示“相关来源/语义未核验”，不升级成已支持。
- 历史成果显示“生成时回执”和“当前重新检查”两个时间口径；先不自动重写旧成果。若成果未保存 claim 引用，明确无法逐句回溯，不用当前全项目卡片补造历史。
- 附件修订如果仍无版本链，先保留原始提取文本、记录人工修订来源，并经确认建立取代关系；既有 DeliverableEvidence 不自动转绑。

验收：确认 A→B 后，当前展示 B、历史仍可看 A；撤销/冲突后状态同步；导出与页面一致；离线/接口失败不展示缓存为最新核验结果。

### R2：Snapshot / Diff 最小纵向切片

第一条切片只支持“决策被取代 + 一个行动完成”两类真实变化。先让数据库→服务→接口→鸿蒙→重启恢复跑通，再扩充交付物缺口、风险和 deadline，禁止先做全量事件平台。

建议新增文件：

- `lib/types/projectState.ts`：版本化契约。
- `lib/projectState/buildSnapshot.ts`：从一致输入构建状态的纯函数。
- `lib/projectState/computeDiff.ts`：按稳定实体 ID 比较，输出带来源的变化。
- `lib/services/projectStateService.ts`：读源数据、存快照、按需刷新。
- `app/api/projects/[id]/state/route.ts`、`state/refresh/route.ts`、`state/diff/route.ts`、`state/check-in/route.ts`。
- `harmonyos/entry/src/main/ets/services/ProjectStateService.ets`。
- `harmonyos/entry/src/main/ets/components/ProjectStatePanel.ets`、`ProjectStateDiffSheet.ets`。
- `tests/projectState.test.ts`、`tests/projectState.integration.test.ts`。

以上均为拟新增路径；业务写入仍经过既有服务，不在 ArkTS 客户端复制判定逻辑。

## 5. R2 数据与接口契约

### 5.1 新增模型：只先加两张表

**ProjectStateSnapshot**

| 字段 | 类型/约束 | 用途 |
|---|---|---|
| id / projectId | ID / 外键 | 项目内状态身份 |
| schemaVersion / policyVersion | integer / string | 内容结构、规则版本 |
| sourceHash | string | 对相关源字段及关系规范排序后散列 |
| evaluationKey | string | 时间规则生效边界；相同区间不重复生成 |
| contentHash | string | 对业务 payload 散列，排除生成时间 |
| observedAt / evaluatedAt | UTC 时间 | 数据观察时间 / 规则评估时间 |
| previousSnapshotId | nullable ID | 同项目上一有效状态 |
| payload | Json，运行时校验 | 状态、证据引用、未知项、规则解释 |

唯一约束建议 `(projectId, sourceHash, policyVersion, evaluationKey)`。schema 版本变化同时升级 policyVersion；普通刷新不产生新快照。不要只按 contentHash 全局去重：A→B→A 也要保留再次发生的 A。

**ProjectStateCursor**：`projectId`、`consumerKey`、`lastSeenSnapshotId`、`updatedAt`；项目与 consumerKey 唯一。当前无用户系统时，consumerKey 用本地安装身份并经现有项目授权访问；不能宣称跨设备/多人同步已完成。若只有单端，可明确使用项目共享游标简化，但必须在 UI 说明共享行为。

V1 不必持久化 Diff 表；保存起止 snapshotId 与算法版本即可复算。每条变化使用稳定 key，例如 `decision:<cardId>:validity`，不按数组位置比较。

### 5.2 payload 最小形状

```text
snapshotId, projectId, schemaVersion, evaluatedAt
goal, deadline, stage, health
facts[]: key, text, truth, temporalStatus, evidenceRefs[], ruleId
openActions[]: actionId, recordedStatus, resultCardId?
gaps[]: deliverableId, missingEvidenceTypes[], truth
risks[]: stableKey, truth, severity, evidenceRefs[], ruleId
unknowns[]: predicate, missingInputs[], suggestedInputAction
```

`evidenceRefs` 包含实体种类、ID、源字段/片段、观察时间、确认方式和必要的来源版本/摘要哈希。只保留 ID 不足以审计可变记录。历史快照保留当时摘要，源被删除时显示“来源已删除”，不把不存在的原件当作可打开证据。

### 5.3 一致性和刷新

- 在短数据库事务中读取相关实体、计算稳定版本并写入快照；事务内不调用 LLM、索引服务或网络。
- 既有业务确认成功后调用快照刷新。刷新失败不能把已经提交的业务写入伪装为失败或诱导重复提交：返回 `stateRefreshPending`，界面提示并允许重试。
- App 进入项目时显式刷新，再读取状态，作为崩溃后的补偿。不承诺进程关闭后仍持续检测；若以后需要后台主动行为，再增加持久事件/worker。
- 并发相同刷新由数据库唯一约束收敛；冲突后读取已生成记录。previousSnapshotId 在同一串行事务内确定，避免并发产生不同“上一版”。
- 纯时间流逝也会改变 deadline 风险：evaluationKey 按下一个规则边界变化，不是任意每秒时间戳。测试“没有新增卡片，跨过截止边界”仍产生正确变化。
- 这是“系统当时观察到的状态历史”，不宣称完整双时间数据库。历史 as-of 重建不能简单将当前可变字段套进过去日期。

### 5.4 HTTP 契约

| 接口（均位于 `/api/projects/[id]`） | 输入 | 输出/行为 |
|---|---|---|
| GET `/state` | 无 | 最新快照或 EMPTY；不隐式生成 |
| POST `/state/refresh` | 无可信事实输入 | snapshot、changed、reused；服务端读取事实 |
| GET `/state/diff?from=…&to=…` | 两个快照 ID | added/changed/resolved/regressed/unknown 项；跨项目 ID 拒绝 |
| POST `/state/check-in` | displayedSnapshotId、consumerKey | 用户确实读完后更新游标；只推进不倒退 |

没有历史时返回 BASELINE_CREATED，文案“这是第一份状态记录”；没有变化时 NO_MATERIAL_CHANGE。旧版本不兼容返回 REBUILD_REQUIRED 并保留旧记录；不能自动伪造迁移后的历史结论。普通查询失败显示错误和重试，不用空数组表达“一切正常”。

### 5.5 鸿蒙交互

概览新增一块“当前状态”，顺序为：本次变化 → 最大已知风险/未知 → 建议下一步 → 查看证据。点变化打开底部详情或独立详情页，复用已有导航方式。

- 当前状态与上次已读时间都可见；用户点击“已了解”才更新游标，刷新/后台加载不吞掉变化。
- “补充结果”打开现有行动完成流程；“保持未知”只记录反馈，不伪造完成或删除风险。
- 操作中禁重复提交；退出后再进保留服务器已提交结果；失败保留用户输入。
- 状态使用文字和图标，不只靠颜色；长证据可滚动，大字号不遮挡主要按钮。
- 手机完成最小验收；平板、折叠屏只报告实际验证过的布局，不把宽度限制当作完整适配。

## 6. R3：小艺真实对账，不再扩工具数量

沿用 `ProjectMemo_2.1_PLAN.md` W03 及部署手册。第一步记录本地候选版本、公网部署版本/构建哈希、接口与平台参数映射，判断是否存在 drift；不能沿用旧 404 作为当前结论。

先做一次真实平台调用，保存 request_id、agent_run_id、业务 card/action ID，并在 App 找到同一记录；通过后再按既有方案做 20 轮正常调用和负向/重试测试。

命令入口为 `npm.cmd run verify:w03`、`npm.cmd run verify:w03-public`。`verify:w03-live` 会确认写入，只针对已约定的专用测试项目执行；不要混入真实参赛项目。

平台阻塞时交付具体失败回执、部署版本、缺失权限/字段，而不是继续加新 Skill。小艺后续 Inspect/Explain 可复用 R2 状态接口，但 Capture/Recall/Inspect/Confirm 与 App 应使用同一服务和事实源。不要复制整套 App 到语音入口。

## 7. R4：真实用户验证与演示

目标来自原文：8–15 名学生、7–14 天，覆盖科研/竞赛/课程等真实项目。如果复赛前时间不足，先做 3–5 人短期可用性试用并如实报告人数与天数，不能把短测包装成长周期效果。

### 7.1 招募与记录

由项目负责人招募并说明记录范围；本计划不代发邀请。使用项目匿名 ID，原始项目文本默认不进入公开报告。记录 eventId、匿名用户/项目、功能版本、时间、snapshotId、interventionId、曝光、反馈、行动创建/完成、证据纠错和人工判定。

### 7.2 指标必须有分母

| 指标 | 口径 |
|---|---|
| 提醒有用率 | 用户明确标记“值得提醒”的曝光干预数 / 有明确评价的曝光干预数；同时报告评价覆盖率 |
| 接受/延期/忽略率 | 各反馈的唯一干预数 / 实际曝光的唯一干预数；无反馈另列 |
| 证据错误率 | 抽查中来源错误或不支持文本的 claim 数 / 人工抽查 claim 数 |
| 漏提醒率 | 人工复盘认定应提醒却未提醒的事件数 / 人工认定应提醒的事件总数；不能只看系统日志 |
| Time-to-Action | 首次曝光到行动创建/开始的时间，选定一种后固定；未行动作为未完成观察另列 |
| 状态恢复耗时 | 用户回答“现在变了什么/依据是什么”所需时间；可对同等任务比较普通时间线与 State Diff，轮换顺序并报告小样本限制 |

不预设“提升 30%”；不将接受率当作实际任务完成率。保留被忽略、有错误、没有改善的案例。

### 7.3 五分钟演示脚本

1. 展示已确认方案 A 的状态及原证据。
2. 输入方案 B 替代 A，预览具体旧卡、受影响行动；用户确认。
3. 展示 A→B 的 State Diff；点开原文与确认时间。
4. 问一个系统不知道的问题，展示“无完成回执/保持未知”，不硬判任务没完成。
5. 补充真实结果，出现结果卡和新的变化；小艺已通过平台对账时再演示同 ID 入口。

验收材料必须绑定同一个 release candidate：代码/关键 dirty 文件哈希、测试日志、HAP 哈希、设备类型、后端部署版本、平台对账、录屏和已知限制。演示数据显式标明示例，不能用固定回答宣称实时检索。

## 8. 完整 P0 / P1 实施范围与 P2 边界

本节替代初稿“这些能力均留到后续”的范围安排。P0/P1 是优先级，不是已完成标识。R0–R4 保留，新增 M/B/C/F/T 任务补齐全部 P0/P1；P2 仅保留接口演进方向。

| 原文能力 | 实施任务与归属 | 复用点与验收 |
|---|---|---|
| 完整 Memory Lifecycle | 增加人工确认/归档记录、变更原因；明确何时进入整理 | 不删除原始 Capture；撤销后时态、检索、回执同步 |
| Decision Evolution / RESOLVES | 先用 sourceInterventionId 与结果卡表达风险处理，必要时再扩关系类型 | 有结果不必然风险已消除，需风险规则重评 |
| Project Change Brief | `projectChangeBriefService.ts`，由两个快照的 diff 生成“变化/影响/建议” | 先确定性模板，后可选模型润色；每句保留 changeKey 和 evidenceRefs，无变化不生成周报式填充 |
| Intervention Budget / Why now | `interventionPolicyService.ts`，记录触发与抑制决策 | 见下节；不新增一个自由发挥的 LLM 触发器 |
| 反馈偏好调整 | 显式设置优先，累计反馈后给可撤销的规则调整建议 | 拒绝某次不等于永久屏蔽主题；延期是时间偏好，不是负面质量标签 |
| Action Feasibility | 候选行动附依赖、截止时间、用户估时 | READY/BLOCKED/UNKNOWN；缺工时不编造 90 分钟；BLOCKED 可创建“待解阻”任务但不伪称可立即执行 |
| Meeting State Diff | 文本会议输入→基于 snapshotId 的变更提案→预览→确认 | 复用 changeImpactService；日期歧义先澄清；快照过期需重预览，不能直接应用 |
| Inbox 状态输入 | 提取结果增加变化候选；不自动确认取代/截止变动 | 解析失败可人工补充；沿用附件版本与证据边界 |
| Project Understanding | 用 R2 的 known/unknown 字段做覆盖清单 | 不独立开发模型评分系统，不宣称“理解百分比” |
| Memory Consolidation（P2，暂缓） | `projectEpisodeService.ts` + 后续 Episode 表 | 20 卡/7 天/里程碑仅为可配置触发建议；摘要保留来源与时间窗口，不替代或删除原文 |
| Scheduling / 外部证据（P2，暂缓） | 后续单独评估日历、GitHub/文件接入 | 获得真实需求后再做授权、同步和删除语义，不阻塞本方案 |

### 8.1 Budget 的可执行契约

规则候选 → 时间有效性与证据检查 → 去重/延期/静默期 → 每日预算 → 记录决策 → 允许时解释与展示。LLM 仅润色已有结构化理由，不决定无证据的触发。

在 P0 的 B1 任务中新增 `InterventionPolicy`（作用域、时区、预算、静默时段、版本）和 `InterventionDecision`（candidateKey、snapshotId、FIRE/SUPPRESS、reasonCode、whyNow、evidenceRefs、channel、policyVersion、createdAt）。现有 AgentIntervention 继续负责用户处理状态，不用它承载全部“未发出”的历史。

初始建议预算 3 次/天、静默 23:00–08:00，只作为可调整默认值。V1 无用户账户时采用明确的单用户部署范围；不要把跨项目统一预算实现成每项目各 3 次却称全局 3 次。

抑制原因至少包括 DUPLICATE、SNOOZED、QUIET_HOURS、BUDGET_EXHAUSTED、INSUFFICIENT_EVIDENCE、NO_MATERIAL_CHANGE。计数使用配置时区的自然日，UTC 存储；跨午夜、并发候选、重复刷新须测试。应用内“生成”、用户“曝光”、系统通知“送达”分开记，未验证送达不可宣称收到。

短期只做应用内提示，系统通知不可用就显示 UNSUPPORTED。未来有真实后台 worker 后才承诺离线主动介入；决策去重、预算扣减与生成记录应原子提交，失败重试不二次扣费。

偏好学习首版使用可解释计数与建议，允许查看/重置；不把原文公式直接当作有效算法，不需要训练模型。验收包括“保持未知后同一内容不反复打扰，但有新证据时可重新评估”。

### 8.2 P0：三个必须形成闭环的能力

#### M1：Memory Lifecycle——系统知道哪一版还有效

**用户操作**：录入“采用方案 A” → 确认该决策 → 后来输入“改为方案 B” → 预览取代关系 → 确认后默认检索 B，仍可追溯 A。有互相矛盾的证据时显示冲突；无足够信息时保持未知。

**第一版交付**：

1. 复用 Ledger 的时间状态；补单条记忆的人工确认来源。没有关系的独立事实也需明确如何确认，不能为了变成 CURRENT 虚构 SUPPORTS 关系。
2. 建议增加 `MemoryLifecycleEvent` 审计记录，字段含 cardId、projectId、eventType、reason、actor/source、createdAt、关联 relationId。确认、撤销、归档、恢复须可追踪；人工确认是来源声明，不是自动证明事实真实。
3. 归档是可恢复的检索/展示偏好，与时间有效性正交。归档当前决策不自动让旧决策重新生效，也不删除源文件或关系。
4. 附件多次人工纠错形成修订链；旧抽取结果保留，默认当前检索不再采用被确认取代的数值。
5. 卡片、搜索、状态面板、证据回执和导出使用同一状态规则。

**代码入口**：扩充 `temporalLedgerService.ts`、`temporalLedger.ts`、`temporalRelations.ts` 和 schema；拟新增 `memoryLifecycleService.ts`、`cards/[cardId]/lifecycle/route.ts`。事件写入与对应业务变更同事务提交；来源只能指向当前项目。

**验收**：独立事实确认、A→B→C、关系撤销、矛盾证据、附件纠错、归档恢复均有用例；普通检索不会让旧值冒充当前值；不能仅凭 title 关键词决定状态。

**依赖/估算**：R0、R1；增量约 1–2 日。R1 与 M1 重叠的修复只做一次。自动摘要 Consolidation 仍属 P2，不要求生命周期首版实现自动整理。

#### S1：Project State Snapshot / Diff——系统说清“变了什么”

对应 R2，沿用第 5 节的数据和接口，不另立第二套任务。完成最小纵向切片后，补齐决策、行动、交付物缺口、风险、截止时间和未知项。

**用户可见结果**：进入项目看到“方案已由 A 改为 B；一项任务已完成；一项交付仍缺确认材料”，每项可打开来源和前后版本。首次访问明确是基线，没有变化就直接说没有重要变化。

**验收增加**：确认/撤销 M1 事件会刷新状态；规则版本升级不与业务进展混写；不能把记录数增长当成项目进展。Project Understanding 直接展示这些字段的已知/未知情况，不再开一个独立项目。

#### B1：Intervention Budget + 偏好调整——系统知道什么时候该提醒

**用户操作**：看到“为什么现在提醒”，可接受、延期、忽略；设置每日上限和静默时间；可查看最近被抑制的提醒及原因。

**第一版交付**：

1. 实现第 8.1 节的预算、去重、静默、抑制日志，接入既有 evaluate 流程。
2. UI 每条提醒解释“什么变化触发、为什么是现在、依据是什么”；不要求用户读内部 ruleId。
3. 增加独立反馈事件，至少记录 interventionId、反馈类型、发生时间及可选理由；曝光与反馈分开，重复请求幂等。
4. 最小偏好适应：用户可直接设置；针对同一规则/主题，初始策略为 14 天内至少 3 次独立明确忽略且没有接受时，提出一次“降低此类提醒频率”建议。阈值是待试用调优的产品默认，不是研究结论。
5. 用户确认建议后才改变策略版本，支持恢复默认和撤销；延期只影响本次时间，单次忽略不永久屏蔽。新证据/风险升级重新评估，但仍遵守用户的硬预算和静默设置。

**代码入口**：拟新增 `interventionPolicyService.ts`、`interventionFeedbackService.ts`、Policy/Decision/Feedback 数据模型；扩充现有 interventions 更新路由；在现有设置页增加策略控件，不新增主 Tab。

**验收**：跨项目共享预算、跨午夜、并发扣减、重复反馈、静默期、延期到期、建议触发/撤销均符合规则；刷新不重复产生提醒；界面不把未送达称为已送达。

**依赖/估算**：R0、S1；约 2–3 日。此阶段完成的是应用内可控介入；若要声称关闭 App 后仍主动提醒，必须另验后台执行和真实通知送达。

### 8.3 P1：三个把状态转成日常价值的能力

#### C1：Project Change Brief——回来就知道下一步关注什么

**用户操作**：点击“自上次查看以来”，看到“变化 → 影响 → 建议”。例如“方案 B 已确认 → 方案 A 的实验不再对应当前路线 → 建议检查关联任务”，每句可点证据。

**实现范围**：以两个 snapshotId 的 Diff 为唯一事实输入；先输出确定性模板。可选 LLM 只做语言组织，新增事实必须拒绝或退回模板。不要在生成简报时重新检索整库并引入未绑定结论。

**代码/API**：拟新增 `projectChangeBriefService.ts`、`state/brief/route.ts` 和 `ProjectChangeBrief.ets`。V1 可按请求从固定快照重建，不强制新增表；若缓存生成内容，键包含两端快照、模板/模型版本，保存每句 changeKey 和 evidenceRefs。

**验收**：首次、无变化、已取代证据、生成失败、旧游标五种场景都有准确文案；读简报不自动创建行动；“已了解”复用 R2 游标，不能无意跳过未读变化。

**依赖/估算**：S1、R1；约 1–2 日。无需等待 B1，即使没有自动提醒也可以手动看简报。

#### F1：Action Feasibility——建议先判断能否开始

**用户操作**：在行动候选上看到 READY / BLOCKED / UNKNOWN，以及依赖、截止时间、估时来源；缺信息时可补充，受阻时可创建“先解决依赖”的任务。

**实现范围**：第一版仅支持手工/结构化依赖、用户填写估时和已有 deadline，不接日历、不推断空闲时间。READY 只表示已声明的硬依赖满足，不保证现实一定能按时完成。任一已证实硬依赖不满足为 BLOCKED；没有已知阻塞但关键依赖未知为 UNKNOWN。

**数据/API**：拟新增 `actionFeasibilityService.ts`、行动候选的结构化 requirements/estimatedMinutes/assessment 输入版本、`actions/feasibility/route.ts`。依赖引用 action/card/deliverable 的项目内 ID，保留判定时间和来源；以当前源状态评估，不信任客户端传入 READY。

**确认语义**：创建任务与执行任务分开。用户可以明知受阻而创建跟踪任务，但不得自动执行依赖未满足的操作；实际执行前重评。信息发生变化时旧评估标过期。

**验收**：依赖缺失、已完成依赖被撤销、循环依赖、跨项目引用、无估时、截止已过、评估后状态变化；估时缺失显示未估算，不自动填 90 分钟。

**依赖/估算**：R0、现有行动服务；连接 S1 提供状态依据，约 1–2 日。C1 可以先展示“待评估候选”，不必互相阻塞。

#### T1：Meeting State Diff——会议结论能安全进入项目

**用户操作**：粘贴会议文本 → 对照会前快照 → 查看新增要求、决策替代、截止变化、候选行动 → 逐项确认 → 查看会后 Diff。

**实现范围**：文本输入为首版，暂不加入录音/转写。模型负责抽取候选和原文片段，服务端负责授权、有效性、依赖及确认。对于“周五”，使用明确的会议时间/时区展示绝对日期让用户确认；缺上下文则要求补充。

**数据/API**：扩展 `changeImpactService.ts` 的持久提案契约，包含 baseSnapshotId、sourceTextHash、proposalVersion、typedChanges、evidenceSpans、selectedChangeIds；拟新增 `meetings/impact-preview`、`meetings/confirm` 路由。客户端只能提交已预览变更的选择；编辑事实或日期须重新生成提案版本。

**事务边界**：同次确认选中的互相兼容变更原子提交；部分勾选如缺前置项，应解释并拒绝组合。确认时核对相关源字段版本，涉及字段已变更则返回冲突并重预览；无关变化可重新校验后继续。重复确认返回相同业务 ID；取消预览不改项目事实。

**验收**：歧义日期、不存在旧决策、多个同名决策、部分勾选、事实修改、过期预览、并发重试、模型失败和取消。会上说“准备做”不能被写成 DONE，会议文本中的操作指令也不能绕过确认。

**依赖/估算**：M1、S1、R0 的提案绑定验收；行动创建复用 F1 评估，约 2–3 日。模型不可用时保留原文，允许人工编辑结构化候选，不伪造抽取成功。

### 8.4 实施顺序与版本完成定义

推荐开工顺序：R0 → R1/M1 → R2/S1 → B1 → C1 → F1 → T1。这里的顺序是单人排期建议，真实依赖按各任务标注；R3 可独立推进，R4 在首个可用版本就启动，不能等全部 P1 写完才找用户。

- **第一批核心版本**：R0–R4 的对应验收关闭，可证明已有可信状态闭环。
- **P0 完整版本**：M1、S1、B1 均通过；必须包含可撤销的偏好调整，不能只有提醒次数展示。
- **P1 完整版本**：C1、F1、T1 均通过；必须完成真实确认写入及失败恢复，不能只有展示界面。

全部纳入计划后的粗估约 14–22 个有效开发日，加自然观察周期及外部等待。每完成一条纵向流程重新估算，已有实现以回归通过抵扣，不按表机械重做。若实际复赛剩余时间不足，冻结通过验收的版本并逐项披露其余状态，不把未验收任务称为完成。

## 9. 测试矩阵与执行命令

| 类别 | 必测场景 | 通过要求 |
|---|---|---|
| 状态语义 | A→B、撤销、冲突、未确认、无来源、缺完成回执 | 预期状态与真实来源完全对应 |
| Diff | 首次、无变化、行动完成、A→B→A、跨截止边界 | 不漏真实变化，不把重新排序当变化 |
| 写入 | 并发刷新、确认后刷新失败、崩溃重启、重复确认 | 无重复业务写入；可补偿状态刷新 |
| 隔离 | 跨项目快照/证据/游标、修改提案 payload | 拒绝且数据库无副作用 |
| UI | 慢请求、失败重试、离线缓存、长文本、大字号、重复点击 | 状态真实，输入不丢，主要操作可用 |
| 回执 | 不相关当前卡、撤销卡、旧版成果、附件多版本 | 不把“相关/存在”当作语义证明 |
| 小艺 | 真实平台同 ID、重试、鉴权/项目越界 | 按既有 W03 回执逐项关闭 |

在独立测试数据库和测试项目执行，先确认 `.env` 指向；不要对实际开发库运行 seed/reset。新增迁移需同步现有测试 fixture 建表路径。

```powershell
npm.cmd run db:generate
npm.cmd exec tsc -- --noEmit
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run harmony:test
npm.cmd run harmony:build
```

以上是实施后的验证命令，本次只写文档，没有执行或宣称通过。针对新流补项目现有 e2e 用例后再执行 `npm.cmd run test:e2e`。没有模拟器/平台环境的项标 BLOCKED，并写原因，不能改成 PASS。

## 10. 发布、回退与停止条件

- 复用 `lib/config/features.ts`，新增默认关闭的 `PROJECT_STATE_ENABLED`；后续 Budget 单独开关。显式传 defaultValue=false，不能依赖现有默认 true。
- 数据迁移采用新增表/字段；在数据库副本验证旧数据读入、重复迁移和回退读取。关闭功能后旧核心流程仍可运行，历史快照不删除。
- 历史数据只生成迁移时基线，不伪造过去每天快照；旧字符串 JSON 等兼容问题先归一化并记录异常。
- 发现提案可越权修改、旧证据被当成当前事实、业务重复写入：停止该路径上线，保留失败用例后修复。
- 如纯函数与现有数据无法明确区分完成/未知：先缩小 claim，不引入猜测性规则补全。
- 外部部署/设备未满足：停止相应集成验收，继续本地可完成任务并披露限制。
- 剩余时间不足：依次裁掉自动摘要、额外状态字段、美化动效；不裁掉来源追溯、异常文案、重复提交保护和核心验收。

## 11. 实施记录与接手入口

实施记录写入相邻文件 `PROJECT_STATE_AGENT_IMPLEMENTATION_NOTES_2026-09-08.md`。每完成一个 R 编号，记录实际改动、测试命令/退出码、证据路径、与本文偏差、剩余阻塞。状态只使用 NOT_STARTED / IN_PROGRESS / VERIFIED / BLOCKED，VERIFIED 必须带对应版本的回执。

建议下一次直接从以下任务开始：

> 执行 R0，先读取当前 diff 与本计划第 2、3、4 节；复核已经修改的提案绑定与旧卡匹配，补最小负向用例。不要按旧报告重复改已修复项。R0 相关问题关闭后实现 R1，再完成 R2 的决策取代/行动完成纵向切片。每阶段更新 implementation notes，未做平台/设备验证不得写完成。

## 12. 文档自检与未验证假设

已完成：原文主要需求逐项映射、复赛/后续边界、现有代码复用点、数据与 API 契约、纵向任务依赖、未知语义、失败补偿、验收和回退。

仍需实施验证：Prisma/SQLite 一致性与并发实测、鸿蒙新界面体验、最新修复回归、公网部署版本、平台可用性、真实用户招募与观察周期。未因计划完整而给这些事项通过评级。

参考输入：用户粘贴方案全文；`ProjectMemo_2.1_PLAN.md`；`REMATCH_FEATURE_PLAN_2026-09-07.md`；`HANDOVER_RECHECK_LATEST_2026-09-08.md`。旧计划用于复用约束，本文优先定义新增状态能力的执行范围；不覆盖旧文件中的历史验收记录。
