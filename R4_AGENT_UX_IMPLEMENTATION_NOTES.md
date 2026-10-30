# R4 Agent UX Integration 实施记录

## UX-3A 完整实施 · 2026-10-30

基线 HEAD bb48d1a，分支 codex/ux3-proactive-collaboration。在 bb48d1a 启动检查点之上完成完整 UX-3A 责任合同、原子修订、Worker Presence 与双端接入。

- 统一 ResponsibilityView 与共享 DTO：
  - 绑定相关来源授权版本至 `controlVersion`：将 continuationPolicy 中的连接 revision、状态、revokedAt、signalKind 以及用户项目角色完整纳入 controlVersion 的哈希计算，杜绝未绑定来源权限的扩大授权修订。
  - 区分目标截止时间（constraints.deadline）与持续许可有效期（continuationPolicy.expiresAt），permissionState 细分为 STOPPED、EXPIRED、WITHIN_TIME_BOUNDARY。
  - 累计消耗与长期总包：放宽上限至 maxModels 240、maxTools 640、maxMetadataRequests 960，支持 dailyBurst；累计消耗（cumulativeUsed）与 UNKNOWN 永不清零、不跨天重置。
- 在原 Mission 服务边界完成原子修订（`reviseMissionResponsibility` / `PATCH /api/missions/[id]/responsibility`）：
  - 幂等性：同 requestId 同载荷返回已有责任快照；异载荷抛 409 REQUEST_ID_REUSED。
  - 事务内强校验 expectedControlVersion 与 OWNER 角色，任何来源撤权或版本更新均拒绝旧修订（409 MISSION_CHANGED）。
  - 修订合同原子使所有 PENDING/APPROVED 方案标为 EXPIRED，READY/WAITING_APPROVAL 步骤标为 OBSOLETE，不留下半份扩大授权。
  - 记录审计事件 `RESPONSIBILITY_REVISED`，版本号 CAS 递增。
- Worker Presence 真实观测：
  - 新增 `lib/mission/workerPresence.ts`，记录 workerId、心跳、扫描与领取事实；状态细化为 UNOBSERVED、RECENT（60秒内活跃）、STALE（超时）。
  - 接入 `scripts/mission-worker.ts` 与 `workerCycle.ts`，扫描与领取事实可观测。
- 双端接入：
  - Web：新增 `components/MissionResponsibilityPanel.tsx` 并嵌入 `MissionPanel.tsx`，直观展示目标、截止/到期时间、累计消耗/总包、Worker 状态，就地支持原子修订。
  - ArkTS：`Mission.ets` 新增 `MissionResponsibilityView`、`MissionResponsibilityRevisionInput`；`MissionService.ets` 接入 `responsibility` 与 `reviseResponsibility`。
- 验证记录：
  - 新增 `tests/ux3ResponsibilityRevision.test.ts`（来源授权绑定防扩权、幂等与异载荷拒绝、待批方案与步骤失效、累计预算与 UNKNOWN 保留、Worker Presence 状态跃迁 3 项通过）；
  - `tests/ux3Responsibility.test.ts` 与 `tests/ux3WorkerCycle.test.ts` 全部通过（7项）；
  - `npm.cmd run harmony:test` 86 项全过；
  - `npm.cmd run build` 成功完成 Turbopack 编译与 Next.js 路由生成；
  - `npm.cmd run lint` 0 errors 0 warnings。

## UX-3A 启动检查点 · 2026-10-30

基线 HEAD 96429cb，分支 codex/ux3-proactive-collaboration。按用户要求复查 UX-2 后开始 UX-3；UX-2 权限、跨会话综合、输入版本和推测链四文件11项复跑通过。既有全量1226项与模拟器证据另按 UX-2 记录保存，未重复宣称真实模型／自然日质量通过。

本检查点复用原 Worker、Mission 数据和租约；没有启动后台进程、迁移数据库、付费调用、部署或外部写入。

- 原 worker 的 Conversation `||` Mission 短路改为逐轮轮换，空队列回退，单轮最多运行一个成功 slice；各扫描独立记录失败，坏扫描不跳过其余扫描及队列。仍由原数据库 lease/epoch 和累计预算决定执行资格。当前证明的是两类队列的公平机会，不是跨用户／项目公平或固定耗时 SLA。
- 新增 `readMissionResponsibility` 及原 Mission 下 `/responsibility` 只读接口；事务快照投影原目标、成功标准、当前重点、deadline、许可 expiresAt、累计消耗／未知、等待状态和有界事件身份。读取零派发；缺少 Worker 心跳证据时显示 UNOBSERVED，不显示“后台正常”；日期跨许可边界无需新事件就改变快照版本并停止展示下一检查。
- 该接口当前是服务检查点，未接双端 UI，合成版本尚不作为修改授权。统一责任预览／原子修订、来源授权版本绑定、真实 presence、wake 水位竞争、跨用户公平、后台长跑及双端纵向验收继续原 3A；3B/C/D 的认知联动、分支发现、注意力和三日旅程范围不变。不能把本检查点标为完整 UX-3A 或 UX-3 放行。

验证：新 Worker/责任测试4项通过；原 Mission runtime 31项通过；与 UX-2 关键回归联合复跑7文件46项通过；tsc 与受影响文件 eslint 通过。首轮责任测试因 approval 无 createdAt 字段失败，已改按原 id 有界排序并重跑。证据目录 evidence/r4-agent-ux/20261030-ux3；联合复跑结果见 targeted-start.log/exit。用户原四项修改 hash 与交接值一致。

## UX-1 · 2026-10-30

基线 e8281d6b8bb8781447eb1ebfb1a60ebcfcd0dd3a，实施分支 codex/ux1-agent-integration。复用原 CT-1～6、ConversationTurn、Mission Runner、指令事件、来源策略与批准／Action 回执；没有迁移真实数据库或新增执行框架。本轮模型／HTTP 传输测试使用隔离夹具，新增付费模型调用 0。

### A · 共享状态与候选

- 新增纯 workState 投影及可选共享 DTO。Focus、项目语境、Mission 摘要／详情、Handoff、Readback 区分等待用户、等待观察、待批准、排队、有效租约、暂停、失败和 UNKNOWN。精确 question/approval ref 只绑定原对象。
- 原 Runner 提问写 waitingFor=USER；无变化观察只在没有尚待回答的问题时标记 OBSERVATION，不替用户解决原问题。旧记录不足以判断时保持未知；持续服务关闭和许可到期不继续承诺检查。
- 全局按状态有界读取候选，合并已有投影数据，最多协调十二个候选项目，不再逐项目调用整套摘要查询。返回覆盖和计数范围；当前显示范围不冒充全部事项。普通失败不固定抢占用户问题、重要提醒与行动。
- 两端遵循相同 primaryContext 和 fallback 选择；工作指令／复用策略进入观察 hash。generatedAt/checkedAt 不制造重复变化；有效时间边界、回前台和原版本变化触发重读。

### B · 双端原位协作

- Web 默认打开焦点视图，显式会话／原对象深链打开协作；主卡和列表去重，主动作指向原问题／批准／行动。当前重点、原目标和实际进度分层，统计收入筛选入口。
- 委托页显示当前重点，提供原对象协作深链；暂停／取消直接可达。提问正文避免在状态摘要重复出现；步骤和技术设置仍可展开，十类语义块与动态工具选择保留。
- ArkTS 同步 WorkState、Focus、Continuity、Mission/Readback DTO 与纯展示适配；当前重点、等待原因、就近协作、暂停和边界刷新沿原页面实现。没有把网页截图当作原生验收。
- 指引草稿复用原 ConversationDraftStore/sessionStorage。丢回包保留原 commandId/expectedSeq，关闭重开可重放；4xx 要求核对后再操作，5xx／断网保留原请求。账号切换继续使用原草稿隔离和清理。

### C · 原任务与回执

沿原多日接续、纠正和并发测试验证原 Mission 恢复、旧提案拒绝、同一 Action/resultCardId、新会话及不同 session 读回；原 generation/lease、预算与 UNKNOWN 结算逻辑保留。新 UX 服务用例验证超过六个项目、观察等待与真实问题并存、私人归属和读取无派发；Web E2E 验证焦点到原问题、就近指引和刷新读回。

### 验证记录

证据目录：evidence/r4-agent-ux/20261030-ux1/。保留首轮失败、修订及最终回执。

- 全量服务：143 文件／1197 项通过（unit-release.log）。新增持久草稿与最后增量另有受影响检查；最终汇总由 acceptance-summary.json 固定源码与检查边界。
- 较早全量暴露旧查询 mock、原生命周期计数、折叠控件选择器；修为当前方法／语义后受影响 35 项通过。随后 7 文件／45 项通过。
- 较早 Web 4 失败／23 通过／2 跳过：新夹具项目描述不足十字、旧状态文字、重复问题正文、旧卡片位置；修订后继续完整回归，失败日志不覆盖。
- ArkTS 阶段曾因新标签映射的对象字面量未获编译器接受失败，改为显式分支；86 项原生测试与 HAP 构建通过。最终源码再次构建与检查，摘要记录产物 hash。
- HDC 当前返回 Empty，未安装或覆盖任何设备应用数据。目标真机、真实自然日用户、独立质量留出集、正式小艺与生产部署仍未签收。

### UX-2 接续

最终交付检查：完整 Web 27 通过／2 个既有场景跳过；最后源码重建后 6 项关键 Web 旅程通过；受影响 11 文件／55 项通过；types、lint、鸿蒙 86 项及 HAP 全部通过。unsigned HAP SHA256 为 469dd63103d668826e1974ef6dd08a194000dc9f5dd684fe9468ffc68425dc7b。原四项工作树修改逐字节保留；Next 生成的 next-env 路径恢复检查前状态。工程闭环完成，真机、真实多日和独立语义质量 Gate 保留。

根据用户随后提供的“Memory Evolution × Dream Verification × Agent Experience”深化要求，UX-2 当前先做代码审计、技术研究和增量规划，不修改 UX-2 业务代码。需要重新比较纠正的存储归属、稳定假设对象、增量综合和 Context Composer；保留原工具／Generative UI／双端范围及原 UX-J04/05/06/09/10/14。F07 修复仍是 UX-2A 前置，不在 UX-1 中冒充已修复。


## UX-2A 首个可恢复检查点（2026-10-30）

状态：进行中，用户提示 5h 额度将尽后停止扩展，保留完整 A/B/C 目标。本检查点不是 UX-2A 或完整 UX-2 放行。

已实现：F07 新采纳事务核对当前连接及持久来源绑定；授权身份与刷新 CAS 分离，304 不误撤权；Capture 经 signal 追原连接；撤权后保留历史与已提交请求回放。Web/ArkTS 显示不可采纳原因。新增稳定 Claim/Event、UTF-16 原文定位及认证纠正 API；用户原话与原文分开，纠正／撤回追加历史，共用 continuitySeq、reusePolicyHash 与原在途／Mission 失效入口，intentHash 和正式目标保持不变。原 Investigation 和 Mission ContextBuilder 已加入带覆盖的用户解释纠正输入。

验证：8 个文件／45 项定向测试、tsc、15 个受影响 TS/TSX 文件 lint、鸿蒙 86 项测试通过；Prisma generate 通过。测试均为独立库、合成数据／mock HTTP；保存首次失败及修复后的原日志于 evidence/r4-agent-ux/20261030-ux2。首次失败为新增测试遗漏 scenario 和旧合成候选缺少新来源绑定，修复 fixture 后通过。四项用户既有修改哈希不变；未部署、未迁移真实库、未发付费模型或外部写。

接续顺序：
1. 加入真实双客户端的原文定位、纠正／撤回、旧版本和离线同请求恢复入口；当前新增纠正 API 尚无完整用户入口，不能声称双端纠正已交付。
2. 扩回归：纠正与批准／租约／迟到模型真实竞争、无事件到期、全消费路径及来源变化；确认上下文实用性，补 scope/原件解析与历史读取负例。补缺失血缘／SUPPRESS_USE 的 claim、Episode、Artifact、经验和待批方案覆盖。
3. 验证旧库副本增量升级、全部上下文入口的既有回归、Web E2E、HAP；当前只做新迁移在隔离库重放，未运行全量业务套件、Web E2E 或本次 HAP 构建。
4. 在同一分支继续 UX-2B Digest／增量编译／Composer，再做 UX-2C 稳定假设／动态工具／原任务结果链；两阶段均未开始。沿冻结 R2 全部合同，不降级为只读卡片。
5. 真实模型、隐藏题独立评分、自然日和目标设备 Gate 单列；此检查点没有这些验收证据。

所有 Deviations：先落实 F07 与纠正失效纵向基础，因额度提示暂停后续范围；原 R2 规划不缩减。新增 API 的定位以认证原件的原始文本／结构化 JSON 为准，尚未完成物理页／块级 UI 映射；未知映射不得伪造。


## UX-2 完整实施（2026-10-30，接续 6abfcab 未提交工作树）

状态：UX-2A/B/C 工程实现、审查修复、双端与模拟器验收完成。本轮模型／网络测试全部为隔离库合成响应；正式质量评测未启动。基线 6abfcab 之上的未提交改动与本轮修复一并提交；未部署、未迁移真实库、未新增后台执行器、未 push。

### 实现（在 6abfcab 检查点之上，保留全部目标）

- A 纠正与双端：Web `ClaimCorrection`／`ScopedMessageCorrection`（跨项目显式选择适用项目，不自动扩散）；ArkTS `ClaimCorrection`／`AgentMemoryService` 接入 FocusConversation 与 MemoryTimeline；`ConversationDraftStore.flush()` 改为 `Promise<boolean>`，纠正先持久草稿再派发。
- B 综合与上下文：`AgentContextDigest` 与迁移 `20261030120000_ux2_context_digest`；`publishMissionDigest`／`publishConversationDigest` 在原 fenced 发布事务内保存，不新增模型调用；Mission ContextBuilder 与 R4 Investigation 消费有效综合；`readExperiences` 纯读不触发同步；GET `/api/projects/[id]/agent-memory` 私有派生视图。
- 新输入版本：Project `contextRevision` 与迁移 `20261030123000_ux2_project_input_version`；复用原 ProjectImpactJob 幂等回执递增，重放不递增；turn.readManifestJson 持久 sourceRevisionReadSet，`assertTurnCurrent` 前置核查。
- C 稳定推测：`hypothesisService`（PROPOSED→EXPIRED 生命周期、逐句 exact quote、独立性与版本核查、SUPPORTED/REFUTED 不足降级 INCONCLUSIVE）；`cognitiveReadSet` 绑定实际消费版本，原 turn coordinator／Runner／批准／业务确认／核算全链核查；`COGNITIVE_RECOORDINATE` 复用原 generation/lease 与预算，已派发 sandbox 不丢弃原 UNKNOWN。

### 本轮审查发现并修复

1. 纠正原文读取权限（原 GET 可绕过 restricted 保护）：`resolveClaimText` 重写为共用 `lib/memory/claimReadable.ts`——CLAIM 复用 readHypotheses 的 RESTRICTED 判定（含依赖项目失权与根来源 OWNER 校验）；MESSAGE 改为对话归属＋关联项目（homeProjectId 或 ConversationProject）＋消息自身与 observedProjectIds 全部成员校验，与 readConversation 的屏蔽规则一致，模型观察集合不再作为放行依据；MISSION_OUTPUT 补 OWNER 角色校验。`readClaimCorrections` 同步过滤不可读 corrections；WITHDRAW 仍不要求源可读（有测试锁定）。
2. AgentMemoryPanel／ClaimCorrection 项目切换：view 绑定 projectId（加载失败清空），纠控件按 project+source 加 key 重建，杜绝跨项目陈旧资料。
3. 输入版本覆盖补口：行动复盘 `commitActionResult`、会议确认 `confirmMeetingChanges` 补 `enqueueImpact`（稳定 receipt，重放不递增）；此前只有测试主动 enqueue 的事实会推进版本。
4. 上下文容量：新 `lib/memory/facetBudget.ts`——hypotheses 先淘汰并与自身 readSet 同步裁剪，mission 侧按剩余容量（29400）分配并在 manifest 记 `omittedCognition`，conversation 侧 6000 上限；大历史不再因新增 facets 抛 CONTEXT_LIMIT，覆盖不足显式标注。
5. Runner 不再硬编码 `role:"OWNER"`：`buildContext.sourceInput` 携带真实 membership role／revision。
6. 经验视图：`experienceView` 增加指令级 `suppressed` 标注；注入路径原有完整 lineage 检查保留。
7. ArkTS 两个真实缺陷（模拟器验收发现）：MemoryTimeline 唯一入口传 `openRepo:'1'`，而 AgentMemoryPanel 只在非 repoMode 分支——记忆面板此前在设备上不可达，已在 repoMode 分支补渲染；ClaimCorrection 未绑定 ConversationDraftStore，记忆页纠正永远报"草稿尚未保存"——`aboutToAppear` 绑定并在保存前 await。

### 验证记录（证据目录 evidence/r4-agent-ux/20261030-ux2/）

- 全量单测首轮：292 文件／1226 项，3 失败（unit-final-full.json）。修复：missionRuntimeDiagnostics 的 buildContext mock 缺新 `sourceInput` 契约；documentReader 2 项为本机 PATH 优先选中 mingw `pdftotext 4.00`（非 Poppler），设 `PDFTOTEXT_PATH` 指向 TeX Live Poppler 24.03 后 8/8 通过——环境问题，非代码缺陷。
- 最终全量单测：292 文件／1226 项全部通过（unit-final2.json，exit 0；documentReader 两项按上述环境变量运行）。
- 新增自动化：`ux2ClaimSourceRights`（5 项：观察集合不放行、跨项目失权、OWNER 降级、推测受限屏蔽与撤回保留）、`ux2ConversationDigest`（对话发布→新讨论消费→撤权 RESTRICTED→抑制 STALE→新输入 PROJECT_INPUT_CHANGED）、`ux2InputVersion`（行动复盘推进版本且重放不递增；大量推测按剩余容量进入并显式 omitted）。
- Web E2E：29 通过／0 失败／2 个既有跳过；含新增"记忆页显示带来源综合与待核实，并回原讨论接续"旅程与既有纠正旅程。
- ArkTS：harmony:test 86 通过；HAP 构建通过。正式 signed HAP SHA256 `b7f0eaecbf575718a5cfc50f04b03e689b4176646d9e3a2818234e4f4596575c`，unsigned `67a8b6870a9c55f23a10dc2e0f0f76aee622c2b5b98ad2512e022bf9caba2b18`。
- 模拟器验收（隔离，127.0.0.1:6555）：验收 HAP（临时 development/4401 构建）SHA256 `701c50ec8339f955d5fee0fc93d27c525a80c408995d07517e62665a428fa206`；后端 `next dev -p 4401`＋隔离库 `prisma/harmony-ux2.db`（43 迁移）＋`scripts/harmony-ux2-fixture.ts` 种子身份 ux2-acceptance（LLM_MODE=mock）。实机操作：登录→项目→记忆页显示"当前理解／待核实"→选择推测并保存纠正（POST /agent-claims 200，AgentClaimEvent USER_CORRECTION controlSeq 1、continuitySeq 递增）→撤回（WITHDRAW_CORRECTION seq 2）→重复撤回被 409 拒绝→综合变为"历史理解 · 需要重新核对"→"回原讨论接续"打开原会话并显示原引用。截图 emulator-ux2-*.jpeg 与后端日志、DB 回执查询脚本（check-claims-all.ts）均在证据目录。
- 环境与边界：4400 被 aTrustAgent 占用（EACCES），经用户同意临时把 Constants 改为 development/4401 构建验收包，验收后按原字节还原（SHA256 `dc1cb22e32f49a6200c8d59a0a2fbd64dba7f44a2bf66371d1e68428fed0bbe8`）。还原前验收机曾以 review 构建把测试账号发往生产登录一次（401 失败，无任何写入），如实记录。验收期间 `.env`、真实库、用户其他文件未动；用户模拟器上的 contest-demo 会话已按验收流程登出。

### Gate 分层（不相互替代）

- 已签收：工程实现、原执行链与事务边界（合成模型＋隔离库）；双端交互与模拟器真实操作（隔离身份＋mock 模型）。
- 未签收：真实模型语义质量与 C0–C3 消融、独立盲评、三类项目×多用户×三自然日真实使用、真机（非模拟器）验收、生产部署。本记录不得据此宣称这些通过。

---

## 2026-10-30 UX-3A/B 责任与主动发现交付记录

基线：b71c384（feat(mission): complete UX-3A responsibility view, atomic revision, worker presence and dual-client preview）

### 实现与进展

1. **UX-3A 责任模型与双端接续（已完成并提交）**：
   - `lib/mission/responsibility.ts`：统一 `readMissionResponsibility` 与 `reviseMissionResponsibility`；将来源连接快照（revision、status、revokedAt、signalKind）及成员角色绑定入 `controlVersion`，防扩权逃逸；时间边界分离 `deadline` 与 `permissionExpiresAt`；长期总包 Cumulative 预算与 UNKNOWN 永不清零；原子失效待批方案与运行步骤。
   - `lib/mission/workerPresence.ts`：进程心跳与健康观测，状态跃迁 `UNOBSERVED` -> `RECENT` (<=60s) -> `STALE` (>60s)。
   - 双端预览：Web `MissionResponsibilityPanel` 与 HarmonyOS ArkTS `MissionResponsibilityView` DTO 及 `MissionService.responsibility()` / `reviseResponsibility()`。
2. **UX-3B 主动发现与记忆联动（当前阶段完成）**：
   - 跟踪分支 head 发现：支持 `trackBranchHead: true`，检测到新 commit 时创建 `CANDIDATE` 信号（不自动采纳为事实或完成 Action），发射 `INVESTIGATION_BRANCH_HEAD_DISCOVERED`；
   - 确定性核对与零变化保持：`delegationObservation.ts` 对 checks/runs 按 ID 排序规范化并忽略易变时间戳，同状态 CI 或条目换序计算出一致 snapshotHash，触发 `INVESTIGATION_NO_NEW_INFORMATION`，状态置为 `WAITING_INPUT`（`waitingFor: "OBSERVATION"`），零新增模型、零重复提醒；HTTP 观察开销计入 `budgetUsedJson.tools`；
   - 错误状态与无变化严格隔离：网络抖动或临时失败由 Runner 指数退避重试或转为 `PAUSED`（REVIEW_REQUIRED），结构化 `lastErrorJson` 记录 recovery 信息与重试入口，数据上与 `waitingFor: "OBSERVATION"` 严格区分，不污染长期结论；
   - 授权撤销硬隔离：连接被撤权（revokedAt）后任务进入 `PAUSED`（REVIEW_REQUIRED），`nextAttemptAt: null`，绝不自动复活；
   - 认知与推测联动（Cognitive Integration）：`investigationInputHash` 纳入 `composeHypotheses` 的 `cognitiveReadSet`；推测过期（EXPIRED）或被用户纠正（USER_CORRECTION）后 inputHash 变化，任务被唤醒为 `READY`，重置旧待批方案并触发重协调。

### 自动化验证

- `tests/ux3ProactiveDiscovery.test.ts`（4项通过）：
  - A-J03: 同状态CI或条目换序零新增模型调用、零重复提醒；必要HTTP检查计入原账本；
  - A-J04: 可恢复观察失败（网络抖动、退避）不污染长期结论，失败状态与“已核对无变化”在数据上严格区分；
  - A-J10: 分支新head候选发现与撤权后不自动复活；
  - A-J12: 推测到期/纠正后更新 inputHash，唤醒任务进行重协调。
- 回归测试：`tests/ux3ResponsibilityRevision.test.ts`、`tests/ux3Responsibility.test.ts`、`tests/ux3WorkerCycle.test.ts`（7项通过）。
- 代码规范：`npm.cmd run lint` 0 errors, 0 warnings。

---

## 2026-10-30 UX-3C 注意力与跨端协作交付记录

### 实现与进展

1. **跨入口去重与打扰预算控制（A-J08）**：
   - `decidePrivateMissionAttention`：私有委托注意力决策基于规范化的 `candidateKey`（包含 missionId、contextVersion、questionId、reason、localDate 与 policyVersion）；同事项决策命中 `prior` 时直接复用，不重复扣除用户的每日全局打扰预算；
   - 区分用户 STOP 与普通入队：用户显式配置 STOP 时判定为 `USER_STOPPED`（SUPPRESS），绝不越权打扰；
2. **安静时段与关键漏报防护（A-J07）**：
   - 智能静默：夜间安静时段（如 22:00-08:00），一般事项判定为 `QUEUE`，不发起系统推送（`systemPush: false`），但待办问题在任务 `waitStateJson` 中对客户端完全可见（`status: "AVAILABLE"`）；
   - 紧急穿透防漏报：距离 deadline 不足 1 小时的 CRITICAL 或 CONFLICT 关键问题判定为 `urgent: true`，穿透安静时段申请打扰预算并升级为 `URGENT`，防止全静音刷分导致关键事项严重漏报；
   - 静默时段结束后随时间推进自动恢复为 `DIGEST`；
3. **严格分离状态语义（A-J09）**：
   - `lib/mission/attentionReceipt.ts` 扩展支持 `PLATFORM_ACCEPTED` 与 `SEEN` 两级回执；
   - 明确状态阶梯：`AVAILABLE`（就绪） -> `PLATFORM_ACCEPTED`（平台/卡片收下） -> `SEEN`（用户看见） -> `APPROVED`（用户显式批准） -> `EXECUTED`（执行完成）；
   - 严格安全不变量：用户查阅置为 `SEEN` 绝不自动批准方案；方案 `agentMissionApproval` 依然保持 `PENDING`，步骤保持 `WAITING_APPROVAL`，未批准前绝对不产生 `resultCardId`，Runner 绝对不执行写入；
4. **鸿蒙端模型与服务对接（A-J14）**：
   - `harmonyos/entry/src/main/ets/models/Mission.ets`：更新 `MissionAttentionReceipt` 支持 `status`（`PLATFORM_ACCEPTED` / `SEEN`），更新 `MissionAttentionDelivery` 支持 `platformAcceptedAt`、`channel` 与 `seenAt`；
   - 保持真实语义：私人任务 `systemPush: false` 真实表达，不伪造已通过系统平台推送送达。

### 自动化验证

- `tests/ux3AttentionContinuity.test.ts`（3项通过）：
  - A-J07: 安静时段保留有效问题可见，关键紧急问题升级可见，静默结束重新判断；
  - A-J08: 同事项跨入口共用 candidateKey，用户打扰预算只扣一次；
  - A-J09 & A-J14: 严格区分 AVAILABLE/PLATFORM_ACCEPTED/SEEN/APPROVED/EXECUTED，SEEN 绝不当作已批准。
- 鸿蒙测试：`npm.cmd run harmony:test` 86项通过，0 failure，0 error。
- 代码规范：`npm.cmd run lint` 0 errors, 0 warnings。


