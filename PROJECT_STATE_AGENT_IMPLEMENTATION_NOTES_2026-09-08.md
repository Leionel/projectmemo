# 实施记录：项目状态记忆与可验证主动推进

> 2026-09-12 收尾入口：`IN_PROGRESS_CLOSEOUT_PLAN_2026-09-12.md`。该方案针对七项 IN_PROGRESS 和最新验收缺口，按 E1–E7 执行；方案写成不改变以下实施状态。验收发现以 `ACCEPTANCE_REVIEW_2026-09-12.md` 为准，后续修复需新回执关闭。

对应计划：`PROJECT_STATE_AGENT_IMPLEMENTATION_PLAN_2026-09-08.md`。

## 2026-09-08：完成实施计划编写及现有代码入口核对

未实施业务代码，未运行新增功能测试，未部署。

| 任务 | 状态 | 当前说明 |
|---|---|---|
| R0 可信基线 | NOT_STARTED | 新提案绑定与匹配修复需以当前版本重跑回归 |
| R1 真实证据 UI | NOT_STARTED | 已有 Ledger / Receipt，需按计划补语义和展示验收 |
| R2 Snapshot / Diff | NOT_STARTED | 计划数据结构尚未迁移/实现 |
| R3 小艺真实对账 | NOT_STARTED | 沿用 W03；本记录不覆盖既有平台进展 |
| R4 用户验证 | NOT_STARTED | 招募、观察和证据包尚未在本计划下执行 |
| M1 完整记忆生命周期（P0） | NOT_STARTED | 纳入正式范围；复用 R1，补独立事实确认与归档审计 |
| S1 状态变化（P0） | NOT_STARTED | 对应 R2，使用同一任务和验收，不重复建设 |
| B1 介入预算与偏好调整（P0） | NOT_STARTED | 补规则策略、抑制日志、反馈及可撤销调整 |
| C1 项目变化简报（P1） | NOT_STARTED | 由固定快照 Diff 生成，逐句关联来源 |
| F1 行动可行性（P1） | NOT_STARTED | 结构化依赖、三态判断、执行前重评 |
| T1 会议状态变化（P1） | NOT_STARTED | 文本抽取、逐项预览、版本绑定与原子确认 |

## 2026-09-12：执行 R0 → R1/M1 → R2/S1 → B1 → C1 → F1 → T1

基线：起点 commit `f150c65`（工作树无 tracked 修改），Node v24.16.0。基线与关键文件哈希存于 `evidence/project-state-r0-20260912/`。所有提交直接落在 master，每阶段一个 commit，提交前 `tsc --noEmit` 与全量 Vitest 通过。

| 任务 | 状态 | 回执与说明 |
|---|---|---|
| R0 可信基线 | VERIFIED | commit `60a5b96`。重跑全量回归（当时 20 文件/128 测试通过）+ tsc 0 错误；补 3 个负向用例（同名卡并列不自动取代、已取代卡排除/撤销恢复、相近标题唯一胜出）；确认链路支持从持久化歧义候选集手动选择；Widget/EntryFormAbility 演示默认值显式标注「示例数据」 |
| R1 真实证据 UI | IN_PROGRESS | commit `7432640`。`GeneratedArtifact.sourceRefs` 生成时固化引用快照（迁移 20260912000000）；`GET /artifacts/[id]/audit` 返回生成时回执 + 当前重检（结构化 supportState/supersededBy/confirmedAt/reason），未存引用的旧成果如实报「无法逐句回溯」；ClaimAuditorDrawer 每次打开实时拉取（loading/失败重试/untraceable 三态），不再传全项目卡片或按标题关键词判断；导出与页面同口径；MemoryTimeline 展示 原决策→替代决策→确认时间→原因。自动化测试 5 项通过；鸿蒙界面未做真机验证 |
| M1 记忆生命周期 | IN_PROGRESS | commit `1c2fca6`。`MemoryLifecycleEvent` 审计（人工确认来源声明、关系确认/撤销同事务写入并携带 relationId、归档/恢复）；`KnowledgeCard.archivedAt` 为可恢复检索偏好（默认检索与项目详情过滤，时间有效性与历史不受影响——归档当前决策不会让旧决策重新生效，有用例）；`AttachmentRevision` 修订链保留旧提取文本，纠错不再覆盖。测试 6 项通过；注意 `correctAttachmentText` 中 processCapture 因 SQLite 嵌套事务限制在事务外执行，审计写入在事务内 |
| R2/S1 快照与 Diff | IN_PROGRESS | commits `bd89152`（后端）+ `1fe65ea`（鸿蒙）。`ProjectStateSnapshot` 唯一键 (projectId, sourceHash, policyVersion, evaluationKey)，deadline 相位（normal/approaching/passed）作为规则边界，A→B→A 保留新历史行；`buildSnapshot`/`computeDiff` 纯函数（稳定键、排序免疫、证据引用带内容哈希）；`projectStateService` 复用/P2002 收敛/previousSnapshotId 串行事务/check-in 只推进不倒退；GET /state 不隐式生成；4 路由由 `PROJECT_STATE_ENABLED`（默认 false）门控。纯函数 12 + 集成 7 测试通过；鸿蒙状态面板/变化详情 Sheet/设备身份已实现，未做真机验证 |
| B1 介入预算 | IN_PROGRESS | commit `c37346b`。`InterventionPolicy`（全局共享预算 3 次/天、静默 23:00–08:00 跨午夜、配置时区自然日计数、版本化）+ `InterventionDecision`（FIRE/SUPPRESS + DUPLICATE/SNOOZED/QUIET_HOURS/BUDGET_EXHAUSTED/INSUFFICIENT_EVIDENCE/TOPIC_REDUCED）+ `InterventionFeedback`（同键幂等）；evaluate 管道：证据→去重/延期→静默→降频主题→预算→FIRE，决策/预算/干预同事务，演示候选绕过；why-now 确定性模板并写入 evidence；降频建议（14 天≥3 次忽略且 0 接受）确认/忽略/撤销/恢复默认均可解释；`INTERVENTION_BUDGET_ENABLED`（默认 false）门控。测试 7 项通过（跨午夜、跨项目共享预算、本地日翻转、幂等反馈）；鸿蒙 why-now 卡片与设置策略控件已实现，未做真机验证 |
| C1 变化简报 | IN_PROGRESS | commit `6465387`。`buildChangeBrief` 确定性模板（变化→影响→建议，逐句 changeKey/kind/evidenceCount），首次/无变化/已取代/旧游标文案有测试；`GET /state/brief` 返回 BASELINE/OK/NO_MATERIAL_CHANGE；鸿蒙 ProjectChangeBrief Sheet 由服务端简报驱动，读简报不创建行动。未做真机验证 |
| F1 行动可行性 | IN_PROGRESS | commit `c955604`。`ActionRequirement`（action/card/deliverable 硬/软依赖，跨项目/自依赖/环检测拒绝）+ 用户估时；评估不持久化（每次按当前源状态重评，旧结论自然过期）；支撑记录被取代→BLOCKED，待确认→UNKNOWN，已完成依赖被取消→BLOCKED，截止已过单列 overdue，估时缺失如实「未估算」。测试 6 项通过；ActionBoard「查可行性」弹窗 + 「先解决依赖」任务真实创建，未做真机验证 |
| T1 会议状态变化 | IN_PROGRESS | commit `3c24bcc`。确定性规则抽取（DECISION_SUPERSEDE 复用共享评分、ACTION_CREATE、DEADLINE_CHANGE、FACT_RECORD，逐项携带原文片段）；相对日期仅在提供会议日期时解析，否则 NEEDS_CLARIFICATION；预览绑定 baseSnapshotId+sourceTextHash+proposalVersion；确认校验版本（修改须重预览）、拒绝待澄清项与不兼容组合、重查源状态（预览后被取代→409 重预览）；原子提交（取代写入卡片+关系+生命周期事件，行动恒为 TODO——「准备做」不会被写成 DONE），重复确认同业务 ID，取消不改事实，会后刷新返回 Diff 快照。测试 7 项通过 |
| R3 小艺真实对账 | NOT_STARTED | 沿用 W03 方案；本轮未做平台调用 |
| R4 用户验证 | NOT_STARTED | 未启动 |

### 验证回执（2026-09-12）

| 命令 | 结果 |
|---|---|
| `npm.cmd exec tsc -- --noEmit` | 退出码 0 |
| `npm.cmd test` | 27 文件 / 186 测试全部通过，退出码 0 |
| `npm.cmd run lint` | 0 错误（4 条 `_e` 未使用警告），退出码 0 |
| `npm.cmd run build` | Next.js 生产构建成功，退出码 0 |
| `npm.cmd run harmony:test` | hvigor BUILD SUCCESSFUL，27/27 通过 |
| `npm.cmd run harmony:build` | HAP 构建成功：`entry-default-unsigned.hap` sha256 `369f3e1b5f3b048c2b6da9739750e54370060b434087c6446781a2406c1834d0` |

迁移（均已 `prisma migrate deploy` 到默认库，未对开发库运行 seed/reset）：20260912000000_artifact_source_refs、20260912010000_memory_lifecycle、20260912020000_project_state_snapshots、20260912030000_intervention_policy、20260912040000_action_feasibility。

### 与计划的偏差

1. **T1 抽取使用确定性规则而非模型**：计划写「模型负责抽取候选」，V1 改为规则抽取（`extractor: "rules"` 显式标注），理由是模型不可用时服务仍需可用且测试可重复；确认语义与计划一致，模型润色/抽取留作后续增强。
2. **T1 未建鸿蒙粘贴导入界面**：预览/确认 API 与事务语义已完成并有测试；App 内「粘贴会议文本→逐项勾选→确认」界面未实现，为 T1 收尾项。
3. **F1 的依赖/估时编辑仅通过 API**：App 端只提供查看评估与创建「先解决依赖」任务；依赖增删与估时填写界面未实现。
4. **B1 曝光记录**：反馈事件与状态更新已打通（幂等），但「应用内曝光」的客户端上报尚未接入；系统通知保持 UNSUPPORTED 语义，未宣称送达。
5. **correctAttachmentText 事务边界**：`processCapture` 内部自带事务，为避免 SQLite 嵌套事务死锁，卡片创建在审计事务之前执行；取代关系、修订链、附件更新在同一事务内。
6. **R1 成果逐句回溯粒度**：sourceRefs 以卡片为粒度（生成上下文），不是句子级 claim 绑定；旧成果如实标注不可回溯，未补造历史。
7. **R2/S1 gaps**：交付物缺口按期望证据类型与已确认证据差额计算，只表达「缺关联证据」，未推断「现实未完成」。

### 剩余阻塞与风险

- 全部鸿蒙新界面（状态面板、证据抽屉、策略控件、简报、可行性弹窗）未经真机/模拟器交互验证；Automated ArkTS 编译与单测通过不等于体验通过。
- `PROJECT_STATE_ENABLED` 与 `INTERVENTION_BUDGET_ENABLED` 默认关闭；开启前需在测试库演练（含并发刷新、跨午夜）。
- 真机快速连续操作、反向打断、慢放、大字号、深色主题等 UI 矩阵未执行。
- R3 依赖平台环境；R4 依赖招募。

## 2026-09-12（第二轮）：独立验收发现 5 项缺陷，全部修复并复测

外部验收报告：`ACCEPTANCE_REVIEW_2026-09-12.md`；隔离探针：`evidence/acceptance-20260912/probe.ts`，修复前结果存档 `results-before-fix.json`，修复后 `results.json`。

| 缺陷 | 修复 | 回执 |
|---|---|---|
| P1 状态回退复用历史行（A→B→A 最新停在 B） | 快照唯一键加入 previousSnapshotId（迁移 20260912210000），refresh 仅当最新行对应当前源版本时复用，回旧值必产生新行 | 探针 recurrence：a2≠a、reused=false、latestGoal=A；新增字段往返集成测试 |
| P1 快照未复用 Ledger，CONTRADICTS 被当作支持 | buildSnapshot 改为调用 evaluateTemporalCard 统一计算（含 validFrom/validTo 边界），源输入补携带 temporal 字段 | 探针 conflictFacts：truth=UNKNOWN、CONFLICT；新增 CONTRADICTS 与未来生效期纯函数测试 |
| P1 可行性把证据不足兜底为 MET | card 依赖严格按 supportState 映射：仅 SUPPORTED=MET，SUPERSEDED/REVOKED=UNMET，其余=UNKNOWN | 探针 unconfirmedDependency：UNKNOWN；新增 idea 卡与撤销支持关系测试 |
| P2 contentHash 含观察时间 | contentHash 改用剔除 observedAt 的业务投影；sourceHash 对源数组按 ID 规范排序 | 探针 stableContentHash=true；新增 1 秒时差哈希稳定测试 |
| P2 源读取不在快照事务内 | loadSourceInput 接受事务客户端，loadTemporalProject 增加可选 client 参数，全部读取移入 $transaction | 代码审阅 + 全量测试通过；未做并发故障注入（如实记录） |
| 顺带修复：Diff 漏比 goal/deadline/health | computeProjectStateDiff 增加 project:goal、project:deadline、state:health 变化项（往返测试覆盖） | 往返集成测试断言 B→A diff materialChange=true |

验证：`tsc --noEmit` 0 错误；`vitest` 28 文件 / 191 测试全部通过；验收探针五项全绿。鸿蒙代码本轮未改动（沿用 ea2fa19 的 HAP 构建）。功能缺口（T1 导入界面、F1 依赖编辑界面、B1 曝光上报、R1 逐句粒度）保持如实记录，不因后端测试通过而关闭。

## 2026-09-12（第三轮）：执行收尾方案 E1（S1 状态与历史正确性）

依据 `IN_PROGRESS_CLOSEOUT_PLAN_2026-09-12.md`。上一轮（387e502）已完成 E1 第 1/2/4/5 步（统一 Ledger、状态映射、事务读写、稳定比较）与 §2.4 探针转断言；本轮补齐其余步骤：

1. **sequence 历史身份**（迁移 20260912220000）：快照增加项目内递增 sequence，唯一键 `(projectId, sequence)`，旧行按 (evaluatedAt, id) 回填（开发库验证：存量行 seq=1、游标保留）。latest/previous/check-in 全部按 sequence 排序。
2. **仅最新复用 + 有界重试**：refresh 仅当最新行 sourceHash+policyVersion+evaluationKey 全匹配时复用；回旧值必产生新 sequence；并发冲突整事务重试 ≤3 次并重读源。
3. **policyVersion v2**：跨版本 diff 在行级与 payload 级双查，返回 REBUILD_REQUIRED；v1 历史行保留。
4. **补偿刷新**：confirmChangeImpact 成功后尝试刷新，未刷新（关闭/失败）返回 `stateRefreshPending=true`；鸿蒙状态面板进入项目即显式刷新（移除手动建基线 CTA，§5.3 口径）。
5. **独立测试库**（§2.3）：vitest 显式 `DATABASE_URL=file:./prisma/test-vitest.db`，全量测试脱离开发库。

回执：`evidence/closeout-20260912/E1/receipt.md`（命令、退出码、用例对照、剩余限制）。验证：tsc 0 错误；vitest 28 文件 / 194 测试通过（独立库）；验收探针复跑全绿（`E1/probe-results.json`）。

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| S1 | PASS | 尚未执行 | IN_PROGRESS |
| M1（E1 共享部分） | PASS | 尚未执行 | IN_PROGRESS |

## 2026-09-12（第四轮）：执行收尾方案 E2（M1 修订闭环）

1. 附件纠错原子化：结构化在事务外，单事务写 Capture/Card、取代关系（含生命周期事件）、修订链、附件更新；索引提交后尽力执行。
2. 幂等重放：同附件同文本重复纠错返回既有卡（idempotentReplay），不重复建卡建链。
3. 修订历史：`GET /attachments/[id]/revisions` + 纠错弹窗可折叠修订列表。
4. 人工确认来源进读取端：时间线 item 附加 confirmedSourceAt，MemoryTimeline 显示声明式注记；来源声明不改变时态状态（测试锁定），F1 依赖保持 UNKNOWN。

回执：`evidence/closeout-20260912/E2/receipt.md`。验证：tsc 0；vitest 197 通过（独立库）；harmony:test 27/27。

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| M1 | PASS | 尚未执行 | IN_PROGRESS |

## 2026-09-12（第五轮）：执行收尾方案 E3（R1 逐句 claim 来源）

1. 模板绑定 claim 生成：`generateMockArtifactWithClaims` 在渲染确定性模板时同步登记逐句映射（text 与正文逐字一致）；修复模板记录急切求值导致 claim 重复登记的缺陷（改为惰性渲染）。
2. LLM 路径无映射时存 `UNMAPPED_MODEL`，audit 明确"相关来源，语义未核验"，不冒充 SUPPORTED；映射上线前的旧成果标 `LEGACY_NO_CLAIMS`。
3. audit 返回 claims[]（state: CURRENT/SUPERSEDED/UNCONFIRMED/MISSING + 逐卡状态）；抽屉新增"逐句核验"区块、导出新增逐句核验表，与页面同源。
4. 迁移 20260912230000（GeneratedArtifact.claims）；两个库均已 deploy。

回执：`evidence/closeout-20260912/E3/receipt.md`。验证：tsc 0；vitest 200 通过（独立库）；harmony:test 27/27。

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| R1 | PASS | 尚未执行 | IN_PROGRESS |

## 2026-09-12（第六轮）：执行收尾方案 E4（F1 编辑界面与判定）

1. API：`removeRequirementIds` 删除依赖；估时校验前移，非法估时与新增依赖同请求时不留部分依赖（测试锁定）。
2. 新增 `ActionFeasibilityEditor.ets`：依赖增删、硬/参考切换、估时设置/清空，行动/记录卡/交付物三类候选，保存后服务端重评；可行性弹窗加入口。
3. "先解决依赖"创建防重复。

回执：`evidence/closeout-20260912/E4/receipt.md`。验证：tsc 0；vitest 可行性 8 用例通过；harmony:test 27/27。

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| F1 | PASS | 尚未执行 | IN_PROGRESS |

## 2026-09-12（第七轮）：执行收尾方案 E5（T1 会议导入界面）

新增 MeetingService/models/MeetingImportSheet（bindSheet 半模态，工作台入口）：粘贴→预览（分类展示+原文片段+逐项勾选，待澄清项禁确认）→确认（只发版本化提案选择集，409 自动重预览，幂等重试）→完成页（变更 ID+去向+会后 Diff 一键查看）。工作台记录入口拆分"开始记录/导入会议文本"。

回执：`evidence/closeout-20260912/E5/receipt.md`。验证：harmony:test 27/27（后端无改动）。

| 项 | 代码验收 | 设备验收 | 总状态 |
|---|---|---|---|
| T1 | PASS | 尚未执行 | IN_PROGRESS |

### 后续入口

> 从 T1 鸿蒙会议导入界面与 B1 曝光上报开始补齐，然后在一台真机上按计划第 9 节 UI 矩阵过一遍新界面；平台可用时执行 R3 对账（`verify:w03`），再开 R4。
