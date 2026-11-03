# A2 服务实现回执（final-a-workpacket-v1 / 只读四问工作包）

- 生成时间：2026-11-03（UTC+8）
- 工作树：`D:/Projects/hongmen-final-a-mission-packet`，分支 `codex/final-a-mission-packet`
- 基线：`485d485378637e1da3280ed092739d441c8cf749`
- A1 合同/探针：`f267aec`（合同）→ `543162f`（A1 回执）→ `b243f62`（A1 补丁）→ `3a62dce`（回执补记）→ `304adfe`（回执更正）
- **A2 服务提交：`d42831468de0595304382a6021b1171a3cdd6f60`**（当前 HEAD）
- 独立验收（E 轨）：`verify/a2-verification.json`，**48 PASS / 0 FAIL / 3 NOT_RUN / 0 BLOCKED（51 checks），A2 服务合同 ACCEPTED_SIGNED**；C/D 双端消费、设备/真实模型/Worker/自然日、受影响回归的独立复跑仍为 NOT_RUN。
- 合同版本：`final-a-workpacket-v1`，`schemaVersion = 1`
- 性质：只读组合；`LLM_MODE=mock`，0 次模型调用；独立临时 SQLite；无 schema/迁移；无新状态库/Runner/Planner；不改 Web 布局/官网/ArkTS。

## 1. 改动范围

| 文件 | 改动 |
|---|---|
| `lib/mission/readback.ts` | 重构为单事务收集 + 事务外版本复查/重试 + 四问工作包；新增 `readAt`、`observation`、可选 `workPacket`；旧字段/顺序/语义保留；`observedAt` 冻结为读取时刻并加 `@deprecated` |
| `lib/mission/materialUseProjection.ts` | 增加可选 `userId`；逐 item（≤8）调用原 `SourcePolicy.sourceUse` 输出 `currentUse`；`availability` 增加 `availabilityMeaning`；历史 facts 永不因撤权删除；AgentRun 窗口改为先按 `trace.missionId` 过滤再取 40 条 |
| `lib/mission/missionService.ts` | `missionDetail` 事件白名单加入 `DAILY_BUDGET_WAITING`；`workState` 传入 `unknownSteps` |
| `lib/mission/workspaceSummary.ts` | `missionSummarySelect` 事件白名单加入 `DAILY_BUDGET_WAITING`；补 `pauseRequestedAt/cancelRequestedAt/pauseReason`（Focus 摘要可显示停止在途） |
| `tests/finalAWorkPacketService.test.ts` | 18 项服务级正常/负例/FS-A03~07/零副作用/摘要停止在途 |
| `tests/finalAConcurrencyService.test.ts` | 1 项真实双连接并发（第二 `PrismaClient`，同临时库 WAL） |
| `scripts/final-a/generate-samples.ts` | 12 状态 + 旧服务变体真实 JSON 样本生成器（临时库/mock） |
| `evidence/final-a/20261103/samples/a2/` | 12 状态真实 readback JSON + `a2-legacy-server-without-workpacket.json` + `a2-index.json` + `a2-service-verification.json` |

## 2. 契约增量（服务端实际返回）

`GET /api/missions/[id]/readback` 返回 `{ readback }`：

- 保留：`workState / schemaVersion(1) / missionId / projectId / missionVersion / missionStatus / observedAt / missionUpdatedAt / materialUses / evidenceReviews / reviewProgress / callCoverage / resourceUsage / sourceConversation / selected / adoptions / actionReceipts / realityOutcome(NOT_INFERRED)`。
- 新增：
  - `readAt: string`：本次读取时刻（与旧 `observedAt` 同值）。
  - `observation: { readAt, state: OBSERVED|NOT_OBSERVED|FAILED_LAST, lastSuccessfulAt, lastFailedAt, lastNoNewInformationAt, nextCheckAt, authority: ORIGINAL_DELEGATION_RECORDS_ONLY }`。
  - `workPacket?: WorkPacket`：`final-a-workpacket-v1` 四问工作包（同 `a2-index.json` 与 A1 回执；含 `identity/snapshot/authority/observations/done/basis/stopped/next/blockers/coverage/realityOutcome`）。
- `workState` 增量（A1）：`terminal / unsettledEffect / stopRequest`；服务端新版本总是输出。
- `materialUses.items[]` 增量：`availabilityMeaning = "REVISION_MATCH_ONLY_NOT_CURRENT_PERMISSION"`、`currentUse: { state: ALLOWED|SUPPRESSED|UNKNOWN, independentEvidence, reason, policy:"SOURCE_POLICY_V1", checkedAt, appliesTo:"CURRENT_USE_ONLY" } | null`。
- `coverage` 增量：`runScope:"MISSION_FILTERED"`、`runLimit`、`runsInspected`、`eventsInspected/stepsInspected/outputsInspected` 等；保留截断说明与“未找到 ≠ 从未发生”。
- 旧服务降级：整个 `workPacket` 缺失即旧后端；`workState` 缺三个增量字段、`materialUses.items` 缺 `currentUse/availabilityMeaning`、`coverage` 缺 `runScope` 时，客户端必须按“未知/未应用策略”显示，不能当作允许、无变化或成功。变体样本见 `samples/a2/a2-legacy-server-without-workpacket.json`（`removedPaths` 列出被移除路径；readback 保留基线 18 字段）。

## 3. FS-A03～A07 服务级结算

| Issue | 修复 | 证据 |
|---|---|---|
| FS-A03 每日额度等待 | `missionDetail`、`missionSummarySelect`、`readback` 三处事件白名单加入 `DAILY_BUDGET_WAITING`；`QUEUED/DAILY_BUDGET_WAITING` + `nextCheckAt` 三处一致，`budgetUsedJson` 不清零；command 输入校验白名单未动（避免额度事件替换原问题绑定） | `finalAWorkPacketService.test.ts` FS-A03 用例；`samples/a2/a2-daily-budget-waiting.json` |
| FS-A04 读取时间 vs 成功观察 | 有界窗口（`INVESTIGATION_NO_NEW_INFORMATION / INVESTIGATION_OBSERVATION_CHANGED / EXECUTION_STOPPED / MODEL_PROTOCOL_ERROR`，`seq desc take 21`）派生 `lastSuccessfulAt`（优先 `delegation.lastObservedAt`）/`lastFailedAt`/`lastNoNewInformationAt`；读取不推进成功观察时间；失败晚于成功 → `FAILED_LAST`，不得显示“无变化” | FS-A04 用例；`samples/a2/a2-observation-no-change.json` |
| FS-A05 当前来源许可 vs 历史 | 逐 item 调 `sourceUse(userId, projectId, sourcePointer.id, tx, { missionId })`；`currentUse` 单独表达当前可用性；`independentEvidence` 只在 ALLOWED 时为真；历史 facts/摘录始终保留；SourcePolicy 抛错时保守 `UNKNOWN` 不中断整份读回 | FS-A05 用例（SUPPRESS_USE / 来源链未知 / 许可变化但 mission.version 未变）；`a2-legacy...` 之外的 12 状态样本 |
| FS-A06 材料窗口覆盖 | AgentRun 原生 SQL 先按 `json_extract(trace,'$.missionId')` 过滤再 `LIMIT 41`，同项目无关运行不能挤掉本委托；`coverage.runScope=MISSION_FILTERED` 与截断说明保留 | FS-A06 用例（45 条无关运行 + 本委托 >40 运行） |
| FS-A07 并发修订/无事件越界 | 同一 `db.$transaction(..., {timeout:10000})` 收集全部事实（含 `readMissionResponsibility(userId,id,tx)` 同一快照）；事务外复查 7 个版本字段，已推进且重试 <2 次 → 整包重读并标记 `RETRIED`，仍推进 → 本次内部一致快照 + `VERSION_ADVANCED` + `SNAPSHOT_VERSION_ADVANCED` blocker；`primaryAction.requires` 携带全部版本 + `submissionGuard`；无新事件但越过许可/期限/审批/个人记忆边界时权限 `EXPIRED`、主操作重核 | FS-A07 用例 + `finalAConcurrencyService.test.ts`；`a2-service-verification.json` |

## 4. 验证（Lead 复核）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `npm.cmd exec tsc -- --noEmit` | 0 | 全仓（含 A2 + A1-fix）无类型错误 |
| `npm.cmd test -- tests/finalAWorkPacketService.test.ts tests/finalAConcurrencyService.test.ts` | 0 | 2 files / 19 tests passed（18 + 1） |
| 受影响回归 12 files（missionContinuation、missionMaterialUseProjection、s2ResourceReadback、s2CallCoverage、s2AuditFixes、auditS2CallCoverageWindow、missionNativeContract、missionWorkspaceSummary、agentUxWorkState、copilotContinuation、missionReadbackPanel、missionEvidenceFitIntegration） | 0 | 12 files / 84 tests passed |
| `npm.cmd exec -- tsx scripts/final-a/generate-samples.ts` | 0 | 13 个 JSON 写入 `samples/a2/`，`baseSha=headSha=d428314` 前的候选（记录为 3a62dce，A2 提交后未重跑生成器） |
| 独立验收（Verifier，`git archive d428314` 干净 shadow） | 0 | 51 checks：48 PASS / 0 FAIL / 3 NOT_RUN；含独立 fixture 27/27、并发 fixture 3/3、边界 8/8、证据完整性 7/7、干净 shadow tsc exit 0 |

`a2-index.json` 记录 12 个状态样本（运行/排队/等待用户/等待批准/观察无变化/失败/停止请求中/已暂停/UNKNOWN/取消/成功/额度等待）的状态、`phase`、`primaryAction.kind`、`observationState`、字节数；`a2-running.json` 关键字段：`missionStatus=RUNNING`、`phase=RUNNING`、`primaryAction=WAIT_FOR_OBSERVATION / 查看委托进展（执行中） / SYSTEM_WORKER`、`observationState=NOT_OBSERVED`。

真实 JSON 读取前后副作用（服务测试断言 + 12 个样本 `observed.readSideEffects` 四项均 true）：`mission.version/status/planRevision/contextVersion/constraintsVersion/researchScopeVersion/updatedAt/budgetUsedJson/lastErrorJson/waitStateJson` 不变；事件 2→2、AgentRun 0→0、Step 0→0、Output 1→1、Receipt 0→0、AgentDirectiveEvent 0→0、`user.continuitySeq` 不变；无新增 Output/Receipt/AgentRun。

真实双连接并发（第二 `PrismaClient` + 同临时库 WAL）：writer 真实提交 44～49 次（SQLITE_BUSY 重试 0）；32 个读响应 `VERSION_STABLE 30 / RETRIED 1 / VERSION_ADVANCED 1`；每个响应内部一致（`missionVersion == workState.originalRef.version == identity.missionVersion == stopped.workState.originalRef.version`，identity/authority/requires 的 `controlVersion` 与全版本同源），**内部不一致 = 0**；读取不新增事件/草稿/回执。`RETRIED/VERSION_ADVANCED` 用“事务已读、复查未返回”的服务端受控点经第二连接真实写入确定性复现（单进程 better-sqlite3 同步驱动无法在事务中途自然插入第二连接写入）。

A1-RESIDUAL-01（独立验收在 A1 HEAD 发现）：`missionSummarySelect` 补 `pauseRequestedAt/cancelRequestedAt/pauseReason`；新增断言覆盖 RUNNING+有效 lease+暂停/取消请求时，`missionWorkspaceSummary` 的 `workState` 为 `RUNNING / STOP_REQUESTED_IN_FLIGHT / PAUSE_REQUESTED|CANCEL_REQUESTED / settled=false`、`actionLabel=核对停止结算`，且 detail/readback/workPacket 同解释（`CHECK_STOP_SETTLEMENT`）。

## 5. 不变量与守卫

- 读取只读：不创建/修改 Mission、Step、Output、Receipt、Event、AgentRun、预算或连续性；不调模型/HTTP/工具；不推进成功观察时间、不核销 UNKNOWN、不授予执行资格。
- 写入仍走原 `commandMission / continuation / adoption / Action` 路径：服务端重查 owner、项目、版本、来源许可、lease、预算与幂等；`primaryAction.requires` 只是提交时必须重查的版本要求，不是客户端凭据。
- 关键事实：来源撤销/USE_SUPPRESSION 可推进 `controlVersion` 而 **不推进 `mission.version`**；此时 `snapshot.consistency` 仍可能为 `VERSION_STABLE`，守卫由 `requires.controlVersion` + `requiredSourceRevisions` + `currentUse` 来源阻断 + 提交时 SourcePolicy 复查承担（不依赖单一 version 字段）。
- 无 schema/迁移；无新表/Runner/Planner；未改 `prisma/`、`app/`、`components/`、`harmonyos/`、依赖或密钥。

## 6. C / D 接线（A2 后可消费）

- 端点不变：`GET /api/missions/[id]/readback`（参数不变，响应增量）；原 `missionDetail` / `responsibility` 仍可用。
- 新客户端：优先读 `workPacket`（四问 + 唯一 `primaryAction` + 所有 `blockers` + `coverage` + `realityOutcome`），提交时携带 `requires` 的版本字段并走原路由；`observation` 用于区分“读取”和“成功观察”；`materialUses.items[].currentUse` 决定“当前依据”是否可用，`facts` 只作历史留痕。
- 旧后端/缺字段：`workPacket` 缺失退回原详情；`readAt/observation` 缺失按读取时刻显示并说明摘要不可用；`currentUse` 缺失不得推断允许；`terminal/unsettledEffect/stopRequest` 缺失按旧 WorkState 展示并标注未知。
- 不变量：不在客户端重算 phase/优先级/授权；`VERSION_ADVANCED` 时不得沿用旧 `requires` 直接提交；`REVIEW_APPROVAL` 只指向当前有效提案；问题/审批/成果/回执均使用原对象 ID 与版本。

## 7. 残余风险与未签收项

1. **独立验收（E 轨）A2 已完成**：`verify/a2-verification.json` = 48 PASS / 0 FAIL / 3 NOT_RUN，A2 服务合同 `ACCEPTED_SIGNED`；本回执仍不等于产品最终签收（NOT_RUN 的客户端/设备/模型/自然日轨另记）。
2. **C/D 未接线**：Web/鸿蒙尚未消费新增字段；设备与真实交互证据 NOT_RUN。
3. **真实模型/Worker 自然日/独立用户试用**：NOT_RUN，不能由本回执并入通过。
4. `readback` 延迟因责任视图 + ≤8×SourcePolicy 谱系 + 事务外复查而增加；只记录，未做墙钟性能断言。
5. 许可变化不推进 Mission 版本时无法由版本复查发现，依赖 `requires.controlVersion/requiredSourceRevisions` + 来源阻断 + 提交时服务端重查；不是 exactly-once 保证。
6. `workspaceSummary` 仍只列活跃任务：终态 + 未结算 UNKNOWN 不出现在 Focus 摘要；是否增加终态提醒需 C/D/E 与主控裁决。
7. 旧客户端仍可能把 `readback.observedAt`（读取时刻）当成“刚检查成功”；需 C/D 接线纠正，服务端字段语义已冻结。
8. SourcePolicy 判定异常时 `currentUse` 保守记 `UNKNOWN`（不中断读回），可能比实际更保守。
