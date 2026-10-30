# R4 Agent UX Integration 实施记录

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
