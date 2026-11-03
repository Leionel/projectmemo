# A 第二批收尾回执（requires 合同 / 终态入口 / readback 量测与证据窗口）

- 日期：2026-11-03（UTC+8）
- 工作树：`D:/Projects/hongmen-final-a-mission-packet`，分支 `codex/final-a-mission-packet`
- 固定主控检查点：`4b696141435825a3582816e8e449c0e0cf013f29`（A 树已 ff-only 同步；不追随其他 Agent 分支）
- 本轮提交（线性于检查点之上，未 push/未合并 master/未部署）：
  - A-新1 requires 合同与 input 身份：`479326131bedb385b0d89f710d960708ae7e9461`
  - A-新2 终态+未结算 UNKNOWN 入口：`e7c1da88c15e1516032e2514dd60b7e0b006fb9d`
  - A-新3 证据窗口 + 同请求只读复用：`3ec63e62470d0033f3cd6404c047ad720ecae72c`（当前 HEAD）
- 性质：服务端合同/只读投影/量测；`LLM_MODE=mock`，0 模型调用；独立临时 SQLite；无 schema/迁移；无新收件箱/状态库/Runner/Planner；无跨请求缓存；不改官网/Web 布局/ArkTS。
- 独立验收：见文末（Verifier 干净 shadow 复核）。

## 1. 用户收益（可复述，不引入新术语）

1. **C/D 可以安全接线，不会再“按工作包原样提交”被拒**：`primaryAction.requires` 是读取建议不是执行令牌；11 个字段没有任何端点整体接受（strict schema 盲发 422）。本轮给出字段→端点→真实校验位置的映射与可发/禁发清单。
2. **修掉一个真实合同缺口**：等待回答期间若原委托先写入观察事件，之前 readback 给出的 `requires.questionId`（原问题 id）会被 input 端点以 409 INPUT_CHANGED 拒绝——C/D 完全按合同接线也无法回答。现在 input 以 `waitState` 当前未解决原问题为准（与 workState/requires 同源），合法回答 202；已解决旧问题/跨问题/非等待状态仍 409。
3. **终态 + 未结算 UNKNOWN 不再“消失”**：`SUCCEEDED/CANCELLED + lastErrorJson UNKNOWN 或 UNKNOWN Step` 之前只存在于详情/读回，Focus 与项目委托摘要完全看不到。现在 `/api/workspace/focus` 的 waiting 与 `/api/missions/summary` 的 `terminalUnsettled` 能找回，并直接给“查看原结果并核对未知调用”的主动作；不建新收件箱、不改生命周期。
4. **以前会被挤掉的证据审查能看到了**：证据审查窗口改为先按选中原问题过滤再限额；其他问题的新审查不再把目标问题的审查挤出窗口（BEFORE 命中 0 → AFTER 3/3），并把“窗口内未找到≠从未发生”写进覆盖说明。
5. **读回更省且不牺牲安全**：每次 readback 的驱动级查询 100→78（-22%），事务仍 2、SourcePolicy 检查仍 6（≤8）、重试语义与零副作用不变；只做同请求只读复用，不跨权限/版本缓存。

## 2. 受影响合同

| 合同 | 变化 | 兼容 |
|---|---|---|
| `POST /api/missions/[id]/input`（request body） | 语义收紧/修正：`questionId` 绑定“当前未解决原问题 id”（`waitState.questionId`；无 wait 记录旧数据回退最新 QUESTION/观察事件 id） | 字段名/schema 不变；旧数据仍可用；跨问题/已解决旧问题仍 409 |
| `MissionWorkspaceSummary`（`GET /api/missions/summary`） | 新增可选 `terminalUnsettled: {items, inspected, limit, truncated, note, identityNote}` | 旧客户端忽略；`enabled/totalActive/items` 不变 |
| `GlobalFocus`（`GET /api/workspace/focus`） | `waiting` 可包含终态+未结算条目（requiresUser=true）；`counts.waiting/hasMore` 计入；新增可选 `coverage.terminalUnsettled {inspected,limit,truncated,note}` | 旧客户端忽略新 coverage；waiting 条目形状不变（FocusEntry+workState） |
| `readback.evidenceReviews` | 只增覆盖字段 `questionFiltered/questionId/windowLimit/displayLimit/inspected/note`；`truncated` 语义明确为选中问题的窗口溢出 | `{items,truncated}` 保留；旧客户端忽略 |
| `readback.materialUses.coverage` | 只增只读 `sourcePolicyChecks`（=本请求 currentUse 判定次数） | 判定逻辑不变 |
| `lib/mission/responsibility.readMissionResponsibility` / `lib/continuity/sourcePolicy.sourceUse` | 仅新增**可选**参数（同请求复用）；缺省路径行为不变 | 所有既有调用方零改动 |

`primaryAction.requires` 字段映射（详见 `REQUIRES_ENDPOINT_MAP.md`）：

- 可直接改名发送：`missionVersion→expectedVersion`（input/approval/pause/cancel/resume/replan/constraints/research-scope/continuation-policy/continuations confirm）、`questionId→questionId`（input；续接 confirm）、`approvalId→` 路径参数、`proposalHash→proposalHash`、`contextVersion→expectedContextVersion`（continuation confirm / artifact confirm）、`constraintsVersion→expectedConstraintsVersion`（PATCH constraints）、`researchScopeVersion→expectedScopeVersion`（PATCH research-scope）、`controlVersion→expectedControlVersion`（仅 PATCH responsibility）。
- **服务端重导出、禁止发送**：`planRevision`（批准用 `approval.expectedPlanRevision` 复核）、`requiredSourceRevisions`（续接用 `sourcePointers[{id,hash}]`；批准/归入由服务端重查 readSet/sourceRefs）、`boundaryAt`（批准到期入口拒；持续调查许可/租约执行 fence 拒；deadline/个人记忆边界仅重核建议）。
- 禁止 `...requires` 整包展开（strict schema 422）。

## 3. 真实负例与回归（不抄实现者断言）

| 证据 | 内容 | 结果 |
|---|---|---|
| `tests/finalARequiresGuards.test.ts` | 24 例独立负例矩阵：12 端点×11 字段；strict 盲发 422、旧 missionVersion 409、proposalHash/approvalId 跨对象 409、questionId 身份、expected*Version、source hash 三处 409 SOURCE_CHANGED、controlVersion 仅 responsibility、boundaryAt 入口 vs fence、Action 回执无 mission 版本栅栏 | 24/24 pass，exit 0 |
| `tests/finalATerminalUnknownSummary.test.ts` | 摘要找回：两级 UNKNOWN 来源、identity/version 与详情/读回一致、正常终态排除、截断/覆盖、非 Owner 404、feature 关闭旧合同、读前后零变更、失败降级 | 9/9 pass |
| `tests/finalATerminalUnknownFocus.test.ts` | 真实 `loadGlobalFocus` + `GET /api/workspace/focus`：waiting 找回、与摘要同 WorkState 字段一致、跨账号/MEMBER 隔离、7 条截断、零写入、关闭开关、失败降级 | 7/7 pass |
| `tests/finalAEvidenceReviewWindow.test.ts` | 先筛后限命中 3/3、同问题 22 条截断、未选中问题不回退、复用路径与缺省路径 `sourceUse` 结果一致且 SUPPRESSED 不短路、零写入 | 5/5 pass |
| 既有锚点 | Focus/摘要 10 文件 79/79；Focus UI/回执 4 文件 50/50；perf 轨定向 20 文件 159/159；Lead 最终门 13 文件 155/155；`tsc --noEmit` exit 0 | 全绿 |

## 4. 量测（确定性计数，N=30；详见 `perf/PERF_RECEIPT.md`）

| 指标/读 | 检查点原始 | 仅证据窗口修复 | +同请求复用 |
|---|---|---|---|
| SELECT 查询 | 100 | 100 | **78（-22%）** |
| 驱动级语句 | 104 | 104 | **82** |
| 事务 | 2 | 2 | 2 |
| SourcePolicy 检查 | 6 | 6 | 6（≤8） |
| 证据窗口命中 | 0（被挤出） | **3/3** | 3/3 |
| 受控重试 | 200q/4tx；300q/6tx | 同 | **156q/4tx；234q/6tx** |
| 零业务写入 | 0 | 0 | 0 |
| 延迟 p50（两次） | 72.4/101.5ms | 77.2/57.9ms | 70.5/72.6ms（仅量级参考） |

热点：`effectiveContinuity` 32→12 查询；`ownedMission/membership` 6→4；逐 source 安全判定 30 查询刻意不动；合计 -22 与实测一致。仅同一请求同一 user+mission scope 复用，无跨请求/版本缓存。

## 5. C / D 接线要点

- ANSWER_QUESTION：`POST /input` 发 `{requestId, expectedVersion=requires.missionVersion, questionId=requires.questionId, answer}`；有证据前提时 `premiseHash` 取 `missionDetail().evidencePremise.premiseHash`。
- REVIEW_APPROVAL：`POST /approvals/{requires.approvalId}` 发 `{requestId, expectedVersion, decision, proposalHash=requires.proposalHash}`；`requires.approvalId=null` 时不得批准。
- RESUME_DELEGATION：`POST /resume {requestId, expectedVersion}`；许可过期属执行 fence，UI 文案写“提交后重核”而非“已恢复执行”。
- 责任修订：`PATCH /responsibility {requestId, expectedControlVersion=requires.controlVersion,...}`。
- 续接/归入：必须先用各自 preview（continuations preview / artifact-preview）拿 `assessmentHash/fitHash/previewHash/expectedOutputRevision`，再 confirm；`requiredSourceRevisions` 不作为请求字段发送。
- 终态+未结算：Focus waiting / 摘要 `terminalUnsettled` 只是找回入口；核对/结算仍回原详情/读回/原 command，读取不核销 UNKNOWN。
- 证据审查：`readback.evidenceReviews` 只展示当前原问题的窗口；`questionFiltered/truncated/note` 用于避免“未找到=没有”的误读。

## 6. 不变量与边界

- 读取零写入：事件/AgentRun/Step/Output/Receipt/预算/版本/updatedAt/continuitySeq 在 POST/摘要/Focus/读回前后逐项不变（测试与证据断言）。
- 终态生命周期不变：不改变 SUCCEEDED/CANCELLED 的 status/version/updatedAt/finishedAt/lastErrorJson。
- 不新增表/迁移/状态库/执行器/收件箱；不复制真实库；不写 `.env`/密钥；不改官网/Web 布局/ArkTS；`lib/db.ts` 未改。
- 回滚：三提交可逐个 revert；A-新1 回滚 input 身份 4 行；A-新2 删除两个窗口查询/字段；A-新3 撤销调用方传参或恢复 readback 窗口查询。均无数据迁移。

## 7. 残余与 NOT_RUN

1. **NOT_RUN**：Web/Harmony 客户端实际消费（C/D 轨）、设备/真实模型/真实 Worker/自然日/独立用户试用、全量 Vitest/Next build/E2E/hvigor（重任务未在本轨排队）。
2. `boundaryAt` 中 `constraints.deadline` 与个人记忆依赖边界只参与重核建议，无执行 guard（已文档化）；持续调查许可过期是执行 fence 才拒（resume 入口 202），C/D 不得把受理当“已执行”。
3. Action 完成回执（`PATCH /api/projects/[id]/actions/[actionId]`）非 strict、无 mission 版本栅栏，C/D 不应把它当作受 `requires` 保护的目标。
4. Focus 正文 waiting 仍受原 LIMIT=6；非终态占满时终态命中只体现在 `counts.waiting`/`hasMore`。旧版 `/focus` 页的 MissionGroup 分组可能不渲染终态条目（新版 FocusAgentWorkspace 按 requiresUser 展示）——属 C 的 UI 适配范围。
5. 终态窗口只覆盖当前用户 OWNER + 当前项目/授权范围最近 6 条；跨项目/跨账号不扫描；“窗口内未找到≠全库没有”已在 note/identityNote 写明。
6. 量测为 SQLite 单机本地口径：查询数是确定性收益；延迟受共享机器负载影响，不作墙钟性能承诺；未做线上并发/吞吐压测。
7. 证据审查窗口只修 readback；`contextBuilder` 等其他消费方未改。
8. `title/`docs 目录被 gitignore：本文件入库；主控本地文档回执另存 `docs/FINAL/.../07_执行准备/06_A第二批收尾回执.md`，不作为提交物。

## 8. 独立验收（Verifier）

验收对象：`4793261`（requires）/ `e7c1da8`（terminal）/ `3ec63e62`（=HEAD，perf+window）；全部在 `git archive 3ec63e62` 干净 shadow 内用独立 fixture 复跑，BEFORE 数字另在 `4b69614` shadow 同脚本重算对齐。

- **overallVerdict = PASS，无不能签收项（cannotSignOff=[]）**；7 个 section 全 PASS，runs=17 全 exit 0（非 0 退出仅 3 个 BEFORE-POST 预期失败），failure 日志 "none"。
- 分母：终态入口 23/23、证据窗口 14/14、requires 15/15、性能 8/8、BEFORE 可复现 4/4、git 边界 16/16、脚本安全 6/6。
- 关键独立实测：
  - 终态+UNKNOWN 在摘要 `terminalUnsettled` 与 Focus waiting/`GET /api/workspace/focus` 均找回，id/version/status 与 detail/readback 同源；普通终态不误入、非 Owner 404、读前后 DB 零变更、截断诚实（8 条时 inspected=7/limit=6/truncated=true）；Step UNKNOWN 亦命中。
  - 证据窗口：21 条其他问题新审查后目标审查命中 3/3 且事件 id 可核；同问题 22 条只回最近 3 + truncated/windowLimit/displayLimit/inspected 可核；未选中问题保持旧语义不伪造命中；读零写入。
  - requires：12 端点 401 / 非 Owner 404；15 项真实 409+错误码；input 新身份 waitState.questionId=202、旧观察事件 id=409、跨问题=409；整包盲发 12/12 端点 422；`requiredSourceRevisions` 非请求字段但服务端重导出；controlVersion/boundaryAt 与服务端重算一致。
  - 性能：同脚本两次复跑事务[2]/查询[88] 一致，BEFORE 同脚本[2]/[118] 可复现；重读 1/2 次封顶；SourcePolicy 8≤8；GET 零副作用；两次 GET 之间外部推进后读到新版本（无跨请求缓存）；`no-store`。实现方证据另复核 SELECT 100/100/78、事务 2、SourcePolicy 6、零写入、窗口 0→3/3。
  - git 边界：26 个变更文件全在 lib/mission、lib/continuity、lib/server、lib/types、tests/finalA*、scripts/final-a、evidence 允许范围内；无 schema/迁移/UI/ArkTS/官网/新表/Runner/Planner/密钥；docs 规划目录 ignored/untracked/未入提交。
  - 主工作树（含 verify 下全部 .ts fixture）`tsc --noEmit` exit 0。
- 证据：`evidence/final-a/20261103/post-checkpoint/verify/a-post-checkpoint-verification.json`（7 sections/80 项断言）、`baseline-summary.md`、`post-logs/*.log|exit`、`post-runs/*.json`、`fixtures/*`、`git-boundary-3ec63e62470d.json`、`script-safety.json`、`run-manifest.json`。
- 残余（不阻塞）：终态窗口是“本项目最近 7 条终态”的有界窗口而非跨项目全库收件箱；终态条目只提示核对、不结算 UNKNOWN；GlobalFocus primaryContext 仍只由非终态候选构建；延迟为单机临时库口径。
