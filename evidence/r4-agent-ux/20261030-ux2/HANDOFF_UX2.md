# UX-2 实现交接 Prompt（2026-10-30，UTC+8）

你接手 ProjectMemo 的 UX-2 完整实施。请直接接续真实工作树，完成实现、审查、必要修复、Web/HarmonyOS 验收和实施记录。不要重新规划 R4，不要回退到只完成 UX-2A。用户已明确“继续 UX-2”，并已打开模拟器，允许全部完成后用它验收。本文件中的状态是交接快照，先核实当前代码和检查结果。

## 1. 工作范围与边界

- 仓库 `D:\Projects\hongmen`，PowerShell，Node 24，使用 `npm.cmd`。
- 当前分支 `codex/ux2-memory-evolution`。当前 HEAD `6abfcab`，其后大量 UX-2 改动尚未提交，不代表已完成。
- 保留 UX-2A/B/C 全部目标：精确纠正与来源保护；带依赖的综合与真实上下文消费；稳定推测的支持、反证、未定、到期及后续调查。原动态工具、Goal Reasoning、PR-6、CT-4～6、AgentExperience/GenUI、Mission/Action/resultCardId 均保留。
- 不建立第二套 Runner、Planner、记忆数据库、通知系统或新的后台执行器。
- 不部署生产，不迁移真实数据库，不覆盖 `.env`，不做真实外部写入或真实数据清空。
- 用户历史授权过付费调用，但正式质量评测必须先冻结 campaign 上限和逐请求账本；本轮没有调用付费模型。不要启动无界评测。
- 交接前查询到 Codex 5h 窗口已用 90%；重新查实时额度，不将旧值当当前值。
- 不主动创建子 Agent。先读适用 AGENTS.md；按需要使用 HarmonyOS skill。
- 不绿不推。只 stage 本任务文件；不要 `git add .`，也不要因剩余额度少而跳过检查或宣称完成。

## 2. 必读材料

1. 根 `AGENTS.md`、当前 HEAD/工作树、`R4_AGENT_UX_IMPLEMENTATION_NOTES.md`。
2. `R4_AGENT_UX_INTEGRATION_ROADMAP.md`。
3. `planning/r4-agent-ux-integration/ux2-deepening/` 下 `UX2_DEEPENING_ROADMAP.md`、`MEMORY_EVOLUTION_CONTRACT.md`、`AGENT_CONTEXT_AND_UX.md`、`CODE_AND_RESEARCH_AUDIT.md`、`EVAL_AND_IMPLEMENTATION.md`。
4. 与改动有关的 CT-1～6 实现、来源阅读器、经验注入、原批准与原回执机制。旧 PASS 和规划文件不能替代当前验收。

本任务源自用户的 Memory Evolution × Dream Verification × Agent Experience 深化要求。完整工程交付与真实模型语义质量、独立人评、三自然日及真机验收分别签收，不能相互代替。

## 3. 不可覆盖的用户原有修改

交接时 SHA-256 已重新核对一致：

| 文件 | SHA-256 |
|---|---|
| `AGENTS.md` | `dbff8a9d83193830b2fd06c5c131b9324c0a8e472be2c8aa2f66deff990e2750` |
| `docs/FINAL/AGENT_REVIEW/AGENT_EVOLUTION_ROADMAP.md` | `7328e70a94cbd17f400c23ef418d0a62f396a408ea9a1926c9d1f057f211f631` |
| `harmonyos/build-profile.json5` | `442618a372bd9a74d204e7162ffe6844b6fc49dbf4c09b8cc5bc58c6709a1924` |
| `tsconfig.json` | `af1b4fbd345a0d2b7e23394aca3540b524a3d4826fca6a51169b13b2a325ee4a` |

还有大量原有 untracked 文件、原验收目录、原型与规划材料，保留。`next-env.d.ts` 被本任务 E2E 生成器改过，结束时仅恢复这项自身生成差异到 HEAD；不要覆盖用户 tsconfig。Prisma 生成目录忽略，schema 修改后运行 `npm.cmd run db:generate`。

## 4. 已提交的阶段基础

- `2017c31`：UX-1 工程检查点。
- `e1b3382`：R2 记忆演化与长期责任深化规划，12 个规划文件。
- `6abfcab`：UX-2A 服务端基础检查点，32 个文件，未 push。

6abfcab 包括：

- GitHub signal 采纳来源绑定（F07）：`lib/sensing/repoGrantBinding.ts`、`repoSource.ts`、`ExternalSignal.sourceBindingJson`，新效果事务验证 owner/project/connection identity/scope/revision；旧请求先回原效果；同 SHA 换连接不能沿用授权，普通刷新不误当撤权，旧不明来源不猜回填。
- `AgentClaim/AgentClaimEvent`、精确 RAW_V1 UTF16 locator、解释纠正/撤回、原 continuitySeq 写锁与 reusePolicyHash、原 turn/Mission invalidation。
- 原 Mission ContextBuilder 和 R4 Investigation 已消费有效用户纠正。模型不能据此修改永久目标或许可。

## 5. 当前未提交实现

### A. 纠正与双端

- Web `components/ClaimCorrection.tsx`：原始文本选择；保存用户原话；原 requestId/载荷持久草稿；网络失败后只重放原请求；撤回历史；账号切换绑定；陈旧响应 epoch。
- `ScopedMessageCorrection`：跨项目消息要求明确适用项目，不能自动扩散至所有项目。已接 `ConversationPanel.tsx`。
- HarmonyOS `models/AgentMemory.ets`、`services/AgentMemoryService.ets`、`components/ClaimCorrection.ets`，接 `pages/FocusConversation.ets`；原 `ConversationDraftStore.flush()` 改为 `Promise<boolean>`，纠正必须先持久草稿再派发。
- ArkUI `.onTextSelectionChange` 已在本机 SDK 文档中核实，服务端仍验证 UTF16 范围、原文和 hash。模拟器尚未验证重复句/emoji 的实际选择。
- `lib/memory/claimService.ts` 支持 `kind=CLAIM`，可纠正稳定推测。WITHDRAW 允许源删除后按原控制记录撤回。
- `assertContinuityBinding` 已补旧客户端只有 intentHash 的边界：仅空 reuse 兼容，发生纠正或撤回后，旧绑定不能产生新效果。

### B. 综合与上下文

- 新 `AgentContextDigest`，迁移 `20261030120000_ux2_context_digest`。
- `lib/memory/synthesisContract.ts`：可选结构化综合及 hypotheses。
- `lib/memory/digestService.ts`、`conversationDigest.ts`：综合从原 Mission `save_mission_output` 或原 Conversation answer 同一个模型调用产出，在原 fenced 发布事务内保存；不新增编译模型调用、不绕过原预算。
- 原 `lib/mission/outputService.ts`、`tools.ts`、`contextBuilder.ts`；原 `conversation/model.ts`、`turnService.ts`、`investigationService.ts` 已接入。
- 读取综合重新核对原来源、权限、纠正、当前 Action/resultCardId/委托状态；STALE 历史不进入当前 Composer。模型综合不能作为独立证据。
- `lib/experience/service.ts` 新增纯读 `readExperiences`，保留原会同步数据的 list 行为。新记忆视图不能因 GET 自动同步/调用模型。
- GET `/api/projects/[id]/agent-memory` 返回 private derived view。
- Web `AgentMemoryPanel.tsx` 接项目知识页与全局记忆现有入口；鸿蒙同名组件接 `MemoryTimeline.ets`，渐进展示综合、条件、待核实与回原任务入口。

### 新输入版本（刚完成接线，待全面回归）

- Project `contextRevision`，迁移 `20261030123000_ux2_project_input_version`。
- 复用 `lib/decision/impactJobs.ts` 的原 `ProjectImpactJob` 幂等变更回执：仅新 receipt 同事务递增，重放不递增，消费/扫描不递增。`repoSource` 新 ADOPT 也加入原 impact receipt。
- `lib/memory/inputReadSet.ts` 验证实际模型输入时的 project revision + member role。
- 原 directory/contextBuilder 捕获输入版本；原 Runner 决策前与提交前核查，step.protocolJson 持久绑定。
- 原 Conversation turn.readManifestJson 持久输入版本，`assertTurnCurrent` 检查并由原 generation 协调。下一 generation 清空模型派生 readsets，原预算与 UNKNOWN 留在原账本。
- Digest/Hypothesis 保存实际模型输入版本，不能发布时读最新版本冒充模型已看到新材料。
- 这只是变更标记，未新增调度器/模型后台任务。

### C. 稳定推测（已接入，仍需审查与扩充验收）

- `lib/memory/hypothesisService.ts`：AgentClaim kind HYPOTHESIS + 原 append-only Event；同一 claimId/expectedRevision 更新；支持 PROPOSED/INVESTIGATING/SUPPORTED/REFUTED/INCONCLUSIVE/EXPIRED。
- 原输出/消息事务内记录，来源必须是本次真实可用来源；逐句 exact quote、原 Source Policy、独立性与版本检查；缺支持或支持反证冲突时，模型请求的 SUPPORTED/REFUTED 降为 INCONCLUSIVE。
- 当前默认复核期限 7 天，是待记录的工程策略，不是真理有效期；过期无事件也即时失效。
- 来源链未知不是独立证据；模型作者、摘要/Artifact/推测不能被复制成多源支持。
- `composeHypotheses` 给原上下文单独认知 facet，不伪造 Source，不改变 user continuitySeq，不把模型判断放入用户授权。
- `cognitiveReadSet` 绑定实际消费版本；原 turn coordinator/Runner/批准/业务确认核查。私有认知发布前变化可在原 Runner 重新协调，预算不重置。
- 已派发 sandbox job 不因后来认知变化丢弃原 UNKNOWN/原结算；不能自动重复派发。
- 已改 `mission/approvalService.ts`、`metricVerification.ts`、`missionService.ts` 与 `copilot/confirmation.ts`，需重点复核回放先于新效果 guard 的顺序。
- Web/ArkTS 页面已加待核实卡片、条件、支持/反例、原任务/原讨论接续、CLAIM 精确纠正。历史 assessments 服务端已输出，客户端历史展示可继续补齐。

## 6. 已执行验证与证据

统一新证据目录 `evidence/r4-agent-ux/20261030-ux2/`。保留旧失败日志；旧 checkpoint.json 属于 6abfcab，不能覆盖为新版本通过。

- `web-ui-third.log`：实际 Playwright 纠正→刷新→旧提案409→撤回历史通过。`web-correction.png`。合成身份/资料；不能作为真实模型质量。
- `ux2CorrectionControls.test.ts`：网络丢包/重挂载原请求重放、源不可读仍撤回等；当时 2 项通过。
- `ux2ClaimCorrection.test.ts`：精确 locator/emoji、序号、撤回、跨项目、到期、旧绑定等。
- `ux2MigrationUpgrade.test.ts`：旧库副本增量升级/空库迁移、保留旧行/未知旧 grant，不改原库。
- `ux2CorrectionRecoordination.test.ts`：双 OS 进程、原 turn 真执行链，模型在途纠正→generation 变化→旧结果不发布→后续模型实际收到纠正、原调用费用保留。模型网络是本地合成响应。
- `digest-first.log`：3 文件9项通过；原 Mission 输出产综合→真实 ContextBuilder 消费→源变 stale→纯读取无调用/无写入。
- `hypothesis-first.log`：3 项中 1 项因测试用了不存在 DTO 字段失败，已修正；不要删除该失败记录。
- `hypothesis-second.log`：4 文件8项通过：hypothesisRuntime、digestRuntime、correctionRecoordination、continuityRecoordination。含 D1/D3/D5 模拟时间同一推测、原批准→真实独立库 Action→结果卡片回读、在途新增输入触发原 Runner 改道、预算累计、receipt 重放不推进输入版本。
- 此后又加 digest cognitiveReadSet、历史根权限核查、approval guard 等；最终全量结果仍待收集，不能以旧定向 PASS 覆盖新差异。
- `cognitive-harmony-tests.log`：86 pass，0 failures/errors。
- `cognitive-hap-first.log`：ArkTS/HAP BUILD SUCCESSFUL。unsigned HAP 6693127 bytes，sha256 `52a8588d53569518fcd8c9e87392011462c869c01c108a569f5297cbbd314c25`。signed 也生成了；模拟器安装时核对所装产物自身 hash，不能拿 unsigned hash 冒充。
- 本地 hdc 已看到模拟器 `127.0.0.1:6555`；尚未安装本次 HAP、尚未执行本次模拟器验收。
- 早先全量 `unit-ui-diagnostic.log`：148files/1212tests，1209pass/3fail，3fail 是独立默认测试库缺新表；已仅迁移 `file:D:/Projects/hongmen/prisma/test-vitest.db` 并重跑受影响5files28项通过，记录 `test-db-migrate.log`、`ui-affected-final.log`。
- 最新仅给上述独立默认测试库应用 B/C 两迁移，总43 migrations：`test-db-migrate-bc.log`。没有迁移真实开发库。

## 7. 交接时仍在运行的检查

先看日志/exit 文件与进程，不要同库重复启动第二轮：

- 全量单测：`unit-bc-full.log`、结束时写 `unit-bc-full.exit`。使用 `progress-reporter.mjs`，最后观察到 `continuityRecoordination.test.ts` collected，未宣告结果。
- tsc：`bc-types.log`、`bc-types.exit`；交接查看日志为空，未读取 exit，不等于已经确认成功。
- 全量 lint：`bc-lint.log`、`bc-lint.exit`；最后仅看到 eslint 启动。
- 当前对话 unified exec session：全量 `60579`，tsc `11651`，lint `80443`。新对话可能无法复用 session，查对应日志和有明确命令行的进程即可。
- 包裹这些启动的工具脚本最后因额度重置时间格式化出现 RangeError；发生在启动命令已返回 session 之后，不代表这些 shell 检查停止或通过。
- 原单元测试配置禁止文件并行，部分测试共享 Prisma singleton/切换 DATABASE_URL；不要自行开启文件并行。

交接文档写完后补查：`bc-types.exit=0`；`bc-lint.exit=1`，唯一报告为 `tests/ux2HypothesisRuntime.test.ts:69` 的 `let detail` 从未重新赋值，需改 `const` 并跑受影响 lint。全量单测仍在运行，最近进度为 `missionContinuation.test.ts` collected。这几项优先采用本段较新的状态。

## 8. 接手后优先审查的未决点

以下是必须核验的风险，不是确认存在的全部缺陷：

1. **原文纠正读取权限**：`resolveClaimText` 对 MESSAGE/CLAIM/MISSION_OUTPUT 目前有简化查询。重点验证跨项目消息失去其中一个项目权限、OWNER降级、私有来源撤权后，能否经 agent-claims GET 绕过原 readConversation/readHypotheses 的 restricted 保护。应复用原权限/依赖检查，不因记录 owner 正确就返回所有文本。WITHDRAW 仍需允许撤回原控制记录，不能要求源再次可读。
2. **跨项目 UI 陈旧状态**：AgentMemoryPanel 在 projectId 变化后，epoch 能挡迟到响应，但要确认旧 view 是否立即清空、fetch 失败后是否仍显示旧项目资料。原 ClaimCorrection identity/key、账号切换、异步草稿读取同样复核。
3. **输入版本覆盖**：逐一核对真实 Capture/附件/关系/行动结果/来源采纳等入口哪些已有 enqueueImpact，哪些仍依赖原 sourceHash。不能只对测试中主动 enqueue 的新增事实有效。新事实到达必须使旧综合需要重核，扫描/重放不得虚假递增。
4. **真实并发/预算**：新增输入、纠正、模型迟到、缓存、批准并发，原 readset 的捕获时机必须在模型输入之前；必须保留原 generation/lease、预算累计和 UNKNOWN；不能只 UI stale，也不能二次派发沙箱。
5. **Cognitive readset 完整性**：原上下文实际消费的每个推测/综合都绑定；本轮自更新的推测后，发布提案绑定 post-write revision；相反不能借此重新读取外部变化的版本并把旧模型结果洗成当前。缓存综合的内含推测跨有效期也必须失效。
6. **来源/抑制/独立性**：SOURCE_USE SUPPRESSED 在综合、待核实推测、经验、上下文、Artifact、提案和接续路径生效；二手结论不独立。历史根隐私检查和跨项目 scope 不得被最新一次重述洗掉。
7. **上下文容量**：当前 hypotheses 有界4条/项目，原摘要最多2条/9000字符，原 Mission context总上限30000；须保证大历史不会因新增 facets 不可控抛 CONTEXT_LIMIT，覆盖不足有明确指针而非冒充完整读取。
8. **客户端与真实旅程缺口**：完整 Conversation→digest/hypothesis→新会话实际消费还缺专项自动化；多项目纠正选择、鸿蒙持久失败/emoji选择、记忆页及原会话接续还未模拟器验证。原工具深读、论文、指标与来源页面应复用，核实而非假定全部满足 R2。
9. **真实质量 Gate**：当前脚本是合成模型/模拟日历，只证明工程和原执行链。自然日、多用户/三类项目、独立盲评及真实模型 C0/C1/C2/C3 消融未做，照 R2 分开记录，不能改名工程测试为质量验收。

## 9. 推荐接续顺序

1. 收集运行中检查、核对 diff 和用户文件 hash。修真正失败，避免重复全量浪费额度。
2. 优先完成上节权限/失效/readset 等审查和必要负例，确保新原文入口不会破坏 CT 信任边界。
3. 补原 Conversation 发布与新会话实际消费、抑制/撤权/UNKNOWN/到期/跨项目测试；完整原 Mission/Action 回执旅程继续复用已有测试和服务。
4. 完成剩余双端交互和真实工具来源验收，更新 Web E2E。保留动态调查，不改成固定工具序列。
5. 稳定后跑受影响测试、tsc、lint、必要全量测试、Web build/E2E、harmony:test/build。按风险重跑，不因每个文案小改无意义重复所有重检查。
6. **再用用户打开的模拟器验收**。hdc 路径：`D:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe`。先确认 target；使用本次 signed HAP、隔离身份/测试库/测试后端，原 Constants 与用户构建配置不改。不要把 App 登录导向真实库以便写测试数据。保留截图、所装产物 hash、实际操作与服务端回执，说明模拟器/真机边界。
7. 更新统一 Roadmap 和 `R4_AGENT_UX_IMPLEMENTATION_NOTES.md`，记录真实已完成/未完成 Gate、失败原因、根预算、Claim/Mission/Action/resultCardId，生成新验收证据/源码hash，不覆盖旧 checkpoint。
8. 仅提交本任务明确改动。最终说明实际改变、执行检查、模拟器是否通过和剩余独立质量 Gate。没有做的不能称通过；不部署、不擅自push。

实现遇到现有能力先检索源码，不要从头重建。遇到不熟悉的新能力按 AGENTS 先研究维护活跃、许可证明确的成熟开源实现；不要为现成版本校验/原事务接线引入新框架。
