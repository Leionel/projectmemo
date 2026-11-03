# Track A 第二轮 独立验收 — BEFORE_FIX 特征化基线

- 执行者：post-checkpoint-verifier（独立验收角色，未改 lib/tests/app/components/harmonyos/prisma）
- 仓库/分支：`D:\Projects\hongmen-final-a-mission-packet` / `codex/final-a-mission-packet`
- 固定检查点：`4b696141435825a3582816e8e449c0e0cf013f29`（HEAD 一致；未 fetch/merge/reset/clean/stash）
- 时间：2026-11-03 UTC+8。基线运行开始时工作树为 clean（`git status --porcelain` 空）。
- 运行位置：**干净 shadow**（`git archive HEAD` 导出源码到 `%TEMP%\pm-post-verify-base`，junction `node_modules`，复制 `lib/generated/prisma`；证据见 `baseline-provenance.json`）。原因：三个实现 teammate 正在主工作树改 `lib/`、`tests/`、`scripts/`，基线必须在他们的修改落盘前完成且不受污染。基线运行期间主工作树确实出现了他人的未提交修改（见文末边界记录），**未使用主工作树 lib 做基线**。
- 隔离：每个 fixture 各自 `mkdtemp` 独立 SQLite（WAL），按序重放 `prisma/migrations`，动态 import lib；`LLM_MODE=mock`、无模型/网络/付费调用、未读 `.env`、未触碰真实库。
- 本文件所有断言由独立验收编写，未复用实现者测试断言。

## 命令与退出码（全部 exit 0）

| # | fixture | 命令（shadow 根目录） | 输出 | exit / 日志 |
|---|---|---|---|---|
| 1 | `baseline-terminal.ts` | `npx.cmd tsx verify-fixtures/baseline-terminal.ts <out>\baseline-a-terminal.json` | `verify/baseline-a-terminal.json` | 0 / `verify/logs/baseline-terminal.{log,exit}` |
| 2 | `baseline-evidence-window.ts` | `npx.cmd tsx verify-fixtures/baseline-evidence-window.ts <out>\baseline-a-evidence-window.json` | `verify/baseline-a-evidence-window.json` | 0 / `verify/logs/baseline-evidence-window.{log,exit}` |
| 3 | `baseline-requires.ts` | `npx.cmd tsx verify-fixtures/baseline-requires.ts <out>\baseline-a-requires.json` | `verify/baseline-a-requires.json` | 0 / `verify/logs/baseline-requires.{log,exit}` |
| 4 | `baseline-readback-instrument.ts` | `npx.cmd tsx verify-fixtures/baseline-readback-instrument.ts <out>\baseline-a-readback-instrument.json` | `verify/baseline-a-readback-instrument.json` | 0 / `verify/logs/baseline-readback-instrument.{log,exit}` |

fixture 源码副本：`verify/fixtures/*.ts`（与 shadow 运行版本一致）。Node v24.16.0 / npm 11.15.0。

---

## 1) 终态 + 未结算 UNKNOWN 可达性（入口缺口 vs 状态不可表达）

Fixture：真实 `createMission` 建委托后把原记录置为 `SUCCEEDED` / `CANCELLED`，并写 `lastErrorJson={code:"EXTERNAL_UNKNOWN",phase:"TOOL"}`；真实服务读取：`missionWorkspaceSummary`、`loadGlobalFocus`（`GET /api/workspace/focus` 同一实现）、`missionDetail`、`readMissionBack`、`GET /api/missions/summary`、`GET /api/missions/[id]/readback`。

真实 JSON 片段（SUCCEEDED 场景，`baseline-a-terminal.json`）：

```json
"summary": { "service": { "enabled": true, "totalActive": 0, "itemIds": [], "itemKeys": [] },
             "route": { "status": 200, "missionFound": false } },
"focus":   { "missionFound": false, "counts": { "waiting": 0, "running": 0, "actions": 0, "reminders": 0 } },
"readback1.workState": {
  "phase": "COMPLETED", "nextActor": "USER", "reasonCode": "SUCCEEDED",
  "reasonText": "原委托完成条件已通过；仍有未知调用结果未结算，现实效果以原结果为准",
  "terminal": { "status": "SUCCEEDED", "atSource": "FINISHED_AT" },
  "unsettledEffect": { "present": true, "code": "EXTERNAL_UNKNOWN", "source": "LAST_ERROR", "resolvedByRead": false },
  "stopRequest": { "state": "NONE", "settled": true } },
"readback1.workPacket.primaryAction": { "kind": "CHECK_UNKNOWN_EFFECT", "label": "查看原结果并核对未知调用" }
```

CANCELLED 场景同样：`workState.terminal.status="CANCELLED"` + `unsettledEffect.present=true`（取消文案明确"不能视为成功完成"），`primaryAction.kind=CHECK_UNKNOWN_EFFECT`；`summary`/`focus` 均 `missionFound=false`。

**结论（BEFORE_FIX 复现，属"入口缺口"而非"状态不可表达"）**：
- `missionWorkspaceSummary` 的 where 硬排除 `SUCCEEDED/CANCELLED`，`GlobalFocus` 的 waiting/running 也只查 `WAITING_INPUT|WAITING_APPROVAL|PAUSED|FAILED` 与 `READY|RUNNING` → 终态任务在两个现有入口**完全找不到**（items/counts 为 0，totalActive 不含该任务）。
- 但同一 `missionWorkState` 投影在 `missionDetail`/`readMissionBack` 已能完整并列表达 `terminal` + `unsettledEffect`（且 `readMissionBack` 主操作已给出 `CHECK_UNKNOWN_EFFECT`）。
- 读前后零变更：`identical: true`；非 Owner `GET readback` 404（`baseline-a-terminal.json.routeEvidence.nonOwner`）。
- 因此 AFTER 的最小正确修复方向是"入口可发现（有界、不建新收件箱、不改生命周期）"，而不是新增状态表达。

## 2) 证据审查有界窗口（BEFORE_FIX 复现"目标问题审查被挤出"）

Fixture：真实 `event()` 写 `QUESTION`（目标 question 使用真实事件 id），目标 question 的 `EVIDENCE_FIT_REVIEWED` 经真实 `recordFitReview()` 写入，再用真实 `readMissionBack({questionId: 目标QUESTION事件id})` 读取；构造 22 条（目标 + 21 条更新其他问题）与 21 条（目标最早 + 20 条更新其他问题）两个边界。

真实 JSON 片段（`baseline-a-evidence-window.json`，22 条场景）：

```json
"dbFacts": { "totalFitReviews": 22, "targetReviewPresent": true, "targetReviewSeq": 3 },
"readback.legacyEvidenceReviews": { "itemCount": 0, "truncated": true, "itemQuestionIds": [], "itemEventIds": [] },
"readback.packetEvidenceReviews": { "itemCount": 0, "truncated": true, "items": [] },
"readback.coverageEvidenceWindow": { "name": "EVIDENCE_REVIEWS", "limit": 3, "returned": 0, "truncated": true,
  "note": "有界窗口已截断：仅包含最近记录，未包含的记录不等于从未发生。" }
```

21 条边界场景同样 `itemCount=0 / truncated=true`；对照组（2 条审查）`itemCount=1 / truncated=false` 且命中目标问题（`premise.questionId` 与目标一致）。

**结论（BEFORE_FIX 复现）**：当前 `readback.ts` 先 `findMany(... take: 21)` 再 `slice(0,20).filter(questionId)`, 更新的其他 question 审查可以把目标 question 自己的审查挤出窗口；虽然 `truncated` 位为 true（没把截断说成"没有"），但目标问题审查**没被命中**，读者无法确认该问题已审查过。读回本身零写入（granular `readbackOnly.identical=true`、`missionDetail` 读取也零变更）。AFTER 需验证"先按原问题筛再限额、命中 ≤3、截断仍诚实"。

## 3) `primaryAction.requires` 在 12 个原端点的真实接受/拒绝矩阵

Fixture：每个端点用真实服务建最小合法状态（`WAITING_INPUT`+QUESTION / `WAITING_APPROVAL`+step+approval / `PAUSED` / 默认 `READY` / 真实 capture 材料 / 真实 output），用真实 `AuthSession` cookie 调真实 route handler。每端点：base 对照 1 次 + 11 个 requires 字段各单独注入 1 次 + `requires` 整包盲发 1 次 + 真实 fence 负例。共 132 个矩阵单元。

真实 JSON 片段（`baseline-a-requires.json`）：

```json
"byEndpoint.pause": {
  "baseControl": { "status": 202, "classified": "BASE_VALID_ACCEPTED" },
  "entryRejects": ["missionVersion","planRevision","contextVersion","constraintsVersion","researchScopeVersion",
                   "controlVersion","approvalId","requiredSourceRevisions","boundaryAt"],
  "fullForwardStatus": 422,
  "fullForwardRejectedKeys": ["missionVersion","planRevision","contextVersion","constraintsVersion",
                              "researchScopeVersion","controlVersion","approvalId","requiredSourceRevisions","boundaryAt"] },
"matrix[pause/missionVersion]": { "status": 422, "errorCode": "VALIDATION_ERROR",
  "layer": "ENTRY_ZOD_REJECTS_UNKNOWN_FIELD", "rejectedKeys": ["missionVersion"] },
"verdict": { "matrixCells": 132, "entryRejectedCells": 119, "entryRejectedCases": 13,
  "allEndpointsRejectBlindRequiresForward": true }
```

真实 fence 负例（错误码均来自真实服务，全部命中预期）：`input` 旧 `expectedVersion`→409 `MISSION_CHANGED`；错误 `questionId`→409 `INPUT_CHANGED`；`approvals` 错 `proposalHash`→409 `APPROVAL_CHANGED`；错路径 `approvalId`→409 `APPROVAL_CHANGED`；`pause/cancel/resume/continuation-policy` 旧 `expectedVersion`→409 `MISSION_CHANGED`；`resume` 非 PAUSED→409 `MISSION_NOT_PAUSED`；`replan` 非 WAITING_APPROVAL→409 `INVALID_TRANSITION`；`constraints` 旧 `expectedConstraintsVersion`→409 `MISSION_CHANGED`；`research-scope` 旧 `expectedScopeVersion`→409 `MISSION_CHANGED`；`responsibility` 错 `expectedControlVersion`→409 `MISSION_CHANGED`；`continuations confirm` 旧 `expectedContextVersion`→409 `ASSESSMENT_CHANGED`；`artifact-confirm` 旧 `expectedContextVersion`→409 `OUTPUT_CHANGED`。

已核实的"字段→真实端点字段/服务端 fence"映射（`fieldSemantics`，逐条由矩阵与负例支撑）：

| requires 字段 | 真实请求字段（端点） | 服务端 fence |
|---|---|---|
| missionVersion | `expectedVersion`（input/approvals/pause/cancel/resume/replan/continuation-policy/continuations confirm） | 比较 `m.version` |
| planRevision | **无请求字段** | 提案固化的 `approval.expectedPlanRevision` 与 `m.planRevision` 比较 |
| contextVersion | `expectedContextVersion`（continuations confirm / artifact-confirm） | 比较 `m.contextVersion` |
| constraintsVersion | `expectedConstraintsVersion`（constraints PATCH） | 比较 `m.constraintsVersion` |
| researchScopeVersion | `expectedScopeVersion`（research-scope PATCH） | 比较 `m.researchScopeVersion` |
| controlVersion | `expectedControlVersion`（responsibility PATCH） | 服务端重算 `readMissionResponsibility.controlVersion` 后比较 |
| questionId | `questionId`（input / continuations confirm） | 匹配当前 QUESTION / waitState |
| approvalId | 路径参数 `approvalId`（approvals POST） | 按 missionId+status=PENDING 查原审批 |
| proposalHash | `proposalHash`（approvals POST） | 比较 `approval.proposalHash` |
| requiredSourceRevisions | **无请求字段** | `validateSources` 从原 Source 指针/sourceRefsJson 重查 |
| boundaryAt | **无请求字段** | 提交时重读责任/权限/边界 |

**结论（BEFORE_FIX）**：`requires` 是"提交前服务端应重查的版本/原对象要求说明"，不是可直接盲发的请求体。逐个单发时 119/132 单元被 strict schema 以 `422 VALIDATION_ERROR`（`unrecognized_keys`）拒绝；`planRevision`/`requiredSourceRevisions`/`boundaryAt` 在 12 个端点全部被拒绝（无任何请求字段）；整包盲发在 12 个端点全部 422（拒绝 9~11 个键）。`questionId`/`proposalHash` 因 `commandSchema` 可选字段在部分端点"入口接受但服务端按 action 分支决定是否使用"，不代表任意端点可发。AFTER 需验证：真实 409/404/401 错误码、`requiredSourceRevisions` 非请求字段与服务端重导出说明可核。

## 4) readback 事务数 / 查询特征 / 重读上限 / SourcePolicy≤8 / GET 零副作用 / 无跨请求缓存

观测手段**不改产品源码**：在 import `lib/db` 前把自建 PrismaClient（同一 `PrismaBetterSqlite3` adapter，开启 `query` 事件日志）挂到 `globalThis.prisma` 供 `lib/db` 复用；再包装该实例的 `$transaction` 计数（probe 已确认 `$transaction` 为 own writable property）。真实 `readMissionBack` + 真实 GET route。

真实 JSON 片段（`baseline-a-readback-instrument.json`）：

```json
"stableReadback": { "transactions": [2], "queries": [118],
  "latencyMs": { "min": 93.12, "median": 128.51, "max": 278.69 },
  "consistency": "VERSION_STABLE", "retries": 0,
  "materialUseItems": 8, "sourceLimit": 8, "sourceLimitReached": true,
  "readOnly": { "identical": true } },
"retryOnce":       { "transactions": 4, "queries": 90, "consistency": "RETRIED", "retries": 1 },
"continuousAdvance": { "transactions": 6, "queries": 138, "consistency": "VERSION_ADVANCED", "retries": 2,
                       "advancedBlocker": true },
"crossRequestCache": { "seenNewVersionAfterDbBump": true, "readAtDiffers": true,
  "first":  { "status": 200, "cacheControl": "no-store", "transactions": 2, "version": 1, "planRevision": 1 },
  "second": { "status": 200, "cacheControl": "no-store", "transactions": 2, "version": 6, "planRevision": 3 } }
```

- 稳定读回每次固定 **2 个只读事务**（12 次采样唯一值 `[2]`），查询数唯一值 `[118]`（本例含 10 个来源 → 8 个 materialUse item 与逐来源当前许可判定）。
- 强制推进 1 次 → 4 事务 / `RETRIED` retries=1；持续推进两轮 → 6 事务 / retries=2 后停止并返回 `VERSION_ADVANCED` + `SNAPSHOT_VERSION_ADVANCED` 阻断 → **最多 2 次重读**成立。
- `materialUseProjection` 上限 8：10 个来源只返回 8 个 item，`coverage.sourceLimit=8`、`sourceLimitReached=true`。
- 读回零写入（mission 行 version/updatedAt/nextEventSeq 与 events/steps/outputs 计数前后一致）；GET `cache-control: no-store`；两次 GET 之间从外部推进 DB 版本后第二次 GET 读到新版本（version 1→6、planRevision 1→3）且 `readAt` 不同 → 无跨请求缓存、无共享旧版本。
- 基线数字（BEFORE）已固定，AFTER 用**同一脚本**复跑可复算；注意 AFTER 若改实现，`queries`/`latencyMs` 允许变化但必须可复算且事务数/重读上限不得回退。

## 工作树边界确认

- 本角色只新增 `evidence/final-a/20261103/post-checkpoint/verify/**`（本目录）；未修改 lib/tests/app/components/harmonyos/prisma/docs，未 `git add/commit/push`，未建 worktree，未跑全量测试/next build/hvigor。
- 基线期间主工作树出现的**他人**改动（保留不动）：`lib/mission/{materialUseProjection,missionService,presentation,workspaceSummary}.ts`（终态入口实现者）、`tests/finalARequiresGuards.test.ts`、`tests/finalATerminalUnknownSummary.test.ts`、`scripts/final-a/perf-readback.ts`、`evidence/final-a/20261103/post-checkpoint/REQUIRES_ENDPOINT_MAP.md`、`perf/runs/readback-perf-BEFORE.json`。
- 基线不依赖这些改动；AFTER 复验将基于 Lead 通知的提交 SHA 的干净 shadow（或干净工作树）重新运行同一组 fixture。

## AFTER 验收清单（待 Lead 通知 SHA 后逐项执行）

1. 终态入口：`readMissionBack`/`missionWorkspaceSummary`/`GlobalFocus` 能找回 SUCCEEDED/CANCELLED+UNKNOWN；summary 与 detail/readback 同 identity/version；旧客户端忽略新字段；非 Owner 404；读前后零变更；截断诚实。
2. 证据窗口：目标 question 命中且 ≤3；截断真；无 question 不回退；读零写入。
3. requires：负例矩阵真实 409/404/401 与错误码（自造 fixture、不抄实现者断言）；`requiredSourceRevisions` 非请求字段与服务端重导出说明可核。
4. 性能：同一脚本复跑 BEFORE/AFTER 数字一致可复算；SourcePolicy≤8；稳定事务数=2；最多 2 次重读；GET 零副作用；无跨请求缓存。
5. git 边界：无 schema/迁移/UI/ArkTS/官网/新表/Runner/Planner；docs 未入 git；无密钥。

---

## POST 独立验收结果（最终提交后补充，详见 `a-post-checkpoint-verification.json`）

- 验收对象：`4793261`（requires）/ `e7c1da8`（终态+Focus 入口）/ `3ec63e62`（证据窗口+同请求复用，= 最终 HEAD）。全部在 `git archive 3ec63e62` 的干净 shadow 内用本目录同一组 fixture 独立复跑；BEFORE 数字另在 `4b69614` 干净 shadow 用同一脚本重算并逐项对齐（4/4 PASS）。
- `overallVerdict: PASS`；7 个 section 全 PASS，无 FAIL/NOT_RUN/BLOCKED，`cannotSignOff` 为空：
  - 终态入口 23/23（missionWorkspaceSummary.terminalUnsettled + GlobalFocus/GET focus waiting；identity/version 与 detail/readback 一致；旧字段/旧 Focus 键不变；非 Owner 404；读零变更；7/8 条截断诚实；Step UNKNOWN 亦命中）
  - 证据窗口 14/14（21 条更新其他问题后目标审查命中 3/3；21/22 边界；同问题 22 条 truncated=true 且 windowLimit/displayLimit/inspected 可核；未选中问题保持旧语义不伪造命中；读零写入）
  - requires 15/15（12 端点 401 UNAUTHORIZED、非 Owner 404；15 项真实 409+错误码；跨问题 409；整包盲发 12/12 端点 422；requiredSourceRevisions 非请求字段但由服务端从真实来源重导出；controlVersion/boundaryAt 与服务端重算值一致；GET 查询参数 422）
  - 性能 8/8（同一脚本两次复跑数字一致：事务 [2]、查询 [88]、retry 1/2 次、SourcePolicy 8≤8、GET 零副作用、两次 GET 不共享版本、no-store；BEFORE 同脚本为事务 [2]/查询 [118]；实现方 perf 证据独立复核 SELECT 100/100/78、事务 2、SourcePolicy 6、零写入、窗口 hits 0→3/3）
  - BEFORE 可复现 4/4；git 边界 16/16（终态范围 10 项 + 三提交各自范围 3 项 + 祖先链/顺序/工作树 3 项：无 schema/迁移/UI/ArkTS/官网/新表/Runner/Planner，docs 规划目录 ignored/untracked/未入提交，无密钥）；aux 脚本 6/6（perf 脚本仅临时 SQLite、无网络/无模型；a1 脚本 diff 仅 +sourcePolicyChecks:1 且 exit 0 写 14 样本）
- 残余（不阻塞签收，已写入 JSON `residualRisks`）：终态窗口为本项目最近 7 条终态的有界窗口，不是跨项目全库收件箱；终态条目只提示核对、不结算 UNKNOWN；GlobalFocus 的 primaryContext 仍只由非终态候选构建（终态项只进 waiting 展示）；延迟为单机本地临库口径，不是线上性能承诺。
