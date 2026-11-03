# primaryAction.requires 字段 → 原端点合同映射

- 检查点：`4b69614`（codex/final-a-mission-packet，D:\Projects\hongmen-final-a-mission-packet）
- 范围：A-新1（第二批），为 C/D 接线提供后端合同证据；**经主控批准的最小修补只落在 `lib/mission/missionService.ts` 的 input 原问题身份来源（见 §8.1）**，其余服务端未改
- 合同定义：`lib/types/workPacket.ts` 的 `WorkPacketRequires`（L201-L213，随 `WorkPacketPrimaryAction` L215-L223 输出）
- 生成位置：`lib/mission/workPacket.ts` `buildMissionWorkPacket` L463-L485（`requires` L468-L480，`primaryAction` L481-L485）；读回发布 `lib/mission/readback.ts` L435-L448
- 独立负例证据：`tests/finalARequiresGuards.test.ts`（24 例，独立临时 SQLite，真实 route handler / 真实服务函数）
  运行：`npm.cmd test -- tests/finalARequiresGuards.test.ts` → **24 passed / exit 0**

## 0. 结论摘要（C/D 接线先读这一节）

1. **`requires` 是读取建议，不是执行令牌。** 工作包自身标注 `authority.note = VIEW_ONLY_NO_EXECUTION_PERMISSION`（`lib/types/workPacket.ts` L75）与 `submissionGuard = SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY`（L198）；读取不推进 Mission 版本、不核销 UNKNOWN、不签发资格（本套件「读取 = 责任快照；读取不扩授权」用例断言读取前后 `version` 不变）。真正提交仍由原端点重查 owner/项目/版本/来源/权限/lease/预算/幂等。
2. **`requires` 的 11 个字段里没有一个端点整体接受。** 所有命令/确认端点都是 strict schema：把 `requires` 形状整包提交会在业务查询之前得到 **422 VALIDATION_ERROR**（`lib/api.ts` L17-L19），套件首两条用例逐端点取证。C/D 必须逐字段改名映射，禁止 `...requires` 展开。
3. 按“能否作为请求字段”分四类：
   - **直接映射（改名后发送）**：`missionVersion→expectedVersion`、`questionId→questionId`（仅 input；续接为 questionId，且两处同源=当前未解决原问题 id）、`approvalId→URL 路径参数`、`proposalHash→proposalHash`、`contextVersion→expectedContextVersion`（仅 continuation confirm / adoption confirm）、`constraintsVersion→expectedConstraintsVersion`（仅 PATCH constraints）、`researchScopeVersion→expectedScopeVersion`（仅 PATCH research-scope）、`controlVersion→expectedControlVersion`（仅 PATCH responsibility）。
   - **服务端重导出，禁止发送**：`planRevision`（服务端用 `approval.expectedPlanRevision` 复核）、`requiredSourceRevisions`（服务端从原 readSet / sourceRefs / sourcePointers 重查）、`boundaryAt`（服务端用真实 permit/approval 到期时间判定）。
   - **只在读取侧有意义、无提交目标**：ANSWER_QUESTION 之外的 WAIT_FOR_OBSERVATION / VIEW_RESULT / CHECK_* 主操作没有提交端点；requires 只用于提示必须重读。
   - **特定端点专用**：只有责任修订端点接受 `controlVersion` 的改名形式；只有各自端点接受 `expected*Version`；`assessmentHash`/`fitHash`/`previewHash`/`expectedOutputRevision` 来自各自 preview 响应，不在 requires 里。
4. **`requiredSourceRevisions` 不是请求字段。** 读回值由服务端按来源策略推导为 `${sourcePointer.id}@${hash}`（`workPacket.ts` L465-L467；或输入 `requiredSourceRevisions` 覆盖，生产路径未使用）。续接确认的请求字段是结构化 `sourcePointers: [{id, hash}]`；批准/归入没有来源字段，服务端分别从 `approval.readSetJson`、`output.sourceRefsJson` 重查。来源哈希变化在 continuation / approval / adoption 三处都以 **409 SOURCE_CHANGED** 拒绝（套件三例）。
5. **`controlVersion` 在 commandSchema 不可提交**（strict → 422）；唯一校验点是 `PATCH /api/missions/[id]/responsibility` 的 `expectedControlVersion`（`responsibility.ts` L197-L199，**入口即拒**）。input/approval/pause/resume/replan 只校验各自维度的版本并在执行 fence/原来源重查，不核 aggregate controlVersion；这与“读取建议不扩授权”一致，不是可绕过缺口（见 §7）。
6. **`boundaryAt` 分两种执行语义**（套件分别取证）：
   - 批准到期：**入口即拒**——`commandMission` approval 分支 `a.expiresAt<=new Date()`（`missionService.ts` L90）→ 409 APPROVAL_CHANGED；
   - 持续调查许可到期：**入口不拒、执行 fence 才拒**——`resume` 只核对生命周期/版本（L104-L105）；`fenced()` 调 `assertInvestigationDelegation`（`runtimeStore.ts` L30 → `investigationDelegation.ts` L25-L27）→ 409 DELEGATION_EXPIRED；
   - `constraints.deadline`、个人记忆依赖边界只参与重核建议，**没有执行 guard**（残余，见 §8）。
7. **完成回执端点（`PATCH /api/projects/[id]/actions/[actionId]`）不受 mission requires 栅栏约束。** `actionUpdateSchema` 不是 strict、无任何版本字段（`lib/validation/schemas.ts` L88-L97），requires 形状字段被静默忽略；完成回执由服务端生成 `resultCardId` 且重复完成幂等（`lib/services/actionService.ts` L109-L148）。C/D 不要把 done.actionReceipts 当成需要带版本提交的目标。

## 1. requires 各字段的读取来源与语义

| 字段 | 读取来源（生成代码） | 含义 / 边界 |
|---|---|---|
| `missionVersion` | `mission.version`（workPacket.ts L468-469） | 提交时“我看到的委托版本” |
| `planRevision` | `mission.planRevision`（L470） | 计划修订号；服务端只与 `approval.expectedPlanRevision` 比较 |
| `contextVersion` | `mission.contextVersion`（L471） | 上下文版本；续接/归入确认的 expectedContextVersion |
| `constraintsVersion` | `mission.constraintsVersion`（L472） | 约束编辑的 expectedConstraintsVersion |
| `researchScopeVersion` | `mission.researchScopeVersion`（L473） | 研究范围编辑的 expectedScopeVersion |
| `controlVersion` | `responsibility.controlVersion`（L238, L474；责任快照 L64-L78） | 责任合同聚合哈希；只在责任修订 PATCH 校验；null = 旧服务缺失，不得填 `""` |
| `questionId` | `basis.questionId ?? wait.questionId`（L248, L475） | 当前未解决原问题事件 id；ANSWER_QUESTION 目标 L369 |
| `approvalId` | 仅 `REVIEW_APPROVAL` 时 `workState.exactApprovalRef`（L308-L316, L476） | 当前有效 PENDING 批准；过期/失效时为 null |
| `proposalHash` | 仅 `REVIEW_APPROVAL` 时 `matchedApproval.proposalHash`（L464, L477） | 原提案哈希；批准入口必须携带 |
| `requiredSourceRevisions` | 输入覆盖，否则 `materialUses` 中 `availability=CURRENT && currentUse.state=ALLOWED` 的 `${id}@${hash}`（L465-L467） | 只读推导；不是请求字段 |
| `boundaryAt` | `authorityNextBoundary = earliest(批准到期, 许可到期, deadline, 个人记忆边界, workState.nextBoundary)`（L319-L325, L479） | 最早有效边界；不是请求字段；不同成分的执行语义不同 |

`workState.nextBoundary`：持续调查策略 `expiresAt`（`workState.ts` L72）、待批批准 `expiresAt`（L105）、RUNNING 租约 `leaseUntil`（L119）。

## 2. 字段 → 端点总表（请求 schema 是否接受 / 校验位置 / 入口 vs fence）

端点简称：
- IN = `POST /api/missions/[id]/input`（`app/api/missions/[id]/input/route.ts` → `commandMission(...,"input")`）
- AP = `POST /api/missions/[id]/approvals/[approvalId]`（→ `commandMission(...,"approval", approvalId)`）
- PA/CA/RE/RP = `POST /api/missions/[id]/pause|cancel|resume|replan`（→ `commandMission(...,action)`）
- CN = `PATCH /api/missions/[id]/constraints`、RS = `PATCH .../research-scope`（→ `editMission`）
- CP = `PATCH /api/missions/[id]/continuation-policy`（→ `editContinuationPolicy`）
- RR = `PATCH /api/missions/[id]/responsibility`（→ `reviseMissionResponsibility`）
- CV = `POST /api/missions/[id]/continuations/preview`、CC = `.../continuations/confirm`（→ `continuationService`）
- AV = `POST /api/missions/[id]/outputs/[outputId]/artifact-preview`、AC = `.../artifact-confirm`（→ `artifactAdoptionService`）
- AC2 = `PATCH /api/projects/[id]/actions/[actionId]`（完成回执，→ `updateProjectAction`）
- 命令 schema 定义：`commandSchema`（`lib/mission/contracts.ts` L26）；`editSchema`（`missionService.ts` L115）；`policyEditSchema`（L129）；`reviseResponsibilitySchema`（`responsibility.ts` L165-L175）；`previewSchema/confirmSchema`（`continuationService.ts` L17-L18）；`previewSchema/confirmSchema`（`artifactAdoptionService.ts` L12-L13）；`actionUpdateSchema`（`lib/validation/schemas.ts` L88-L97）。
- 入口错误统一映射：`ZodError→422 VALIDATION_ERROR`、`AppError→其 status/code`（`lib/api.ts` L10-L25）。

| requires 字段 | 原端点及真实请求字段 | schema 是否接受 | 服务端校验（file:line） | 失败码 | 入口/fence | C/D 映射 |
|---|---|---|---|---|---|---|
| `missionVersion` | IN：`expectedVersion`；AP/PA/CA/RE/RP：`expectedVersion`；CN/RS：`expectedVersion`；CP：`expectedVersion`；CC：`expectedVersion` | 接受（改名） | `commandMission` L74（`m.version!==body.expectedVersion`）；`editMission` L120；`editContinuationPolicy` L134；`confirmContinuation` L89 | 409 MISSION_CHANGED / ASSESSMENT_CHANGED（CC 先 version 后 context） | 入口 | 发 `expectedVersion: requires.missionVersion`；RR/AC2/CC 之外的 preview 不接受 missionVersion |
| `planRevision` | **无端点接受** | 不接受 | AP：`a.expectedPlanRevision!==m.planRevision`（missionService.ts L90）；执行期 `approvalService.ts` L26 | 409 APPROVAL_CHANGED | 入口（批准）/执行 fence（commitApprovedAction L26） | **禁止发送**；计划推进后必须重新预览批准 |
| `contextVersion` | CC：`expectedContextVersion`；AC：`expectedContextVersion` | 接受（仅这两处改名） | CC L89（`m.contextVersion!==body.expectedContextVersion`）；AC L39 | 409 ASSESSMENT_CHANGED（CC）/ 409 OUTPUT_CHANGED（AC） | 入口 | 发 `expectedContextVersion: requires.contextVersion` 到 CC/AC；IN/AP/PA 等不接受 contextVersion |
| `constraintsVersion` | CN：`expectedConstraintsVersion` | 接受（改名） | `editMission` L120（`m.constraintsVersion!==body.expectedConstraintsVersion`） | 409 MISSION_CHANGED | 入口 | 发 `expectedConstraintsVersion`；schema 中标 optional 但缺失同样 409（实现不补默认值，套件已证） |
| `researchScopeVersion` | RS：`expectedScopeVersion` | 接受（改名） | `editMission` L120（`m.researchScopeVersion!==body.expectedScopeVersion`） | 409 MISSION_CHANGED | 入口 | 发 `expectedScopeVersion` 到 RS；CN 的 `expectedScopeVersion` 在 constraints 分支不使用 |
| `controlVersion` | RR：`expectedControlVersion` | 接受（仅 RR；其他端点 strict 拒） | `reviseMissionResponsibility` L196-L199（`currentSnapshot.controlVersion!==body.expectedControlVersion`） | 409 MISSION_CHANGED | 入口 | 只在责任修订发 `expectedControlVersion`；命令端点不得发送（422）；读取建议不扩授权 |
| `questionId` | IN：`questionId`；CC：`questionId`；CV：`questionId`（preview 体） | 接受 | IN：`commandMission` L77-L83（`expectedQuestionId = wait?.resolved!==true && typeof wait.questionId==="string" ? wait.questionId : q?.id`，与 workState/requires 同源；等待期间出现观察事件不再导致合法回答被拒）；CC：`continuationService` L23（`wait.questionId!==body.questionId`，含 cancel/pause 复核） | 409 INPUT_CHANGED | 入口 | IN 发 `questionId: requires.questionId`（=当前未解决原问题 id；旧数据回退最新事件 id）；CC 用 preview 返回的 questionId（同一当前问题）。修补说明见 §8.1 |
| `approvalId` | AP：URL 路径参数 `/approvals/[approvalId]` | 接受（路径） | `commandMission` L89（`{id:approvalId, missionId:id, status:"PENDING"}`）+ L90；跨 mission → 查不到 | 409 APPROVAL_CHANGED；跨账号 404 MISSION_NOT_FOUND（`repository.ts` L13-L17） | 入口 | 用 `requires.approvalId` 拼路径；服务端同时重查归属/状态/到期 |
| `proposalHash` | AP：`proposalHash` | 接受 | `commandMission` L90（`a.proposalHash!==body.proposalHash`） | 409 APPROVAL_CHANGED（缺失也 409） | 入口 | 必发 `proposalHash: requires.proposalHash`；重新预览后必须用新哈希 |
| `requiredSourceRevisions` | **无端点接受**；来源分别由 CC 的 `sourcePointers[{id,hash}]`、AP 的服务端 readSet、AC 的服务端 sourceRefs 承担 | 不接受（CC 的 sourcePointers 是结构化数组，不是字符串数组） | CC：`continuationService.ts` L26（`source.hash!==pointer.hash` → SOURCE_CHANGED）；AP：`missionService.ts` L94 `validateSources(readSetJson)` → `repository.ts` L55 SOURCE_CHANGED；AC：`artifactAdoptionService.ts` L21 `validateSources(sourceRefsJson)` | 409 SOURCE_CHANGED（三处） | 入口（三处均为确认/批准入口重查） | **禁止发送**；CC 的 sourcePointers 由 CV 预览候选/用户选择产生；AP/AC 不带来源字段 |
| `boundaryAt` | **无端点接受** | 不接受 | AP：`missionService.ts` L90 `a.expiresAt<=new Date()`；执行期 `assertInvestigationDelegation`（`runtimeStore.ts` L30 → `investigationDelegation.ts` L25-L27） | 409 APPROVAL_CHANGED（入口）；409 DELEGATION_EXPIRED（fence）；RUNNING 租约到期 → 409 LEASE_LOST（`runtimeStore.ts` L28） | 批准=入口；持续调查许可/租约=fence；deadline/个人记忆边界=无 guard | **禁止发送**；客户端只需在边界越过后改为重读/重核，不得用旧版本继续提交 |

## 3. 各端点真实请求字段（逐字核对，C/D 照此发；多一个键即 422）

| 端点 | 真实 schema 字段 | 说明 |
|---|---|---|
| IN | `requestId`, `expectedVersion`, `questionId?`, `answer?`, `decision?`, `proposalHash?`, `evidenceReview?`（`contracts.ts` L26，`.strict()`） | `questionId` 必须等于当前未解决原问题 id（`waitState.questionId`；没有 wait 记录的旧数据回退最新 QUESTION/观察事件 id），**不是**“最新事件 id”。evidenceReview 字段：`{schemaVersion:1, mode: ANSWERING_EVIDENCE|BACKGROUND_ONLY|CONDITIONAL_ANALYSIS, note, premiseHash, confirmedPremise:true}`（`lib/types/missionEvidenceFit.ts` L18-L22）；`premiseHash` 取 `missionDetail().evidencePremise.premiseHash`，不在 requires 里。纯文字答复只允许 `CONDITIONAL_ANALYSIS`（L83），否则 409 FIT_MATERIAL_REQUIRED / FIT_* |
| AP | `requestId`, `expectedVersion`, `decision:"APPROVED"|"REJECTED"`, `proposalHash`（commandSchema）；`approvalId` 在路径 | 另发其它 requires 键 → 422 |
| PA/CA/RE/RP | `requestId`, `expectedVersion`（其余 commandSchema 字段虽可解析但不参与这些动作） | 状态机校验：pause L106、cancel L107、resume L104-L105、replan L99-L103；replan 会把 PENDING/APPROVED 批准置 EXPIRED、READY/WAITING_APPROVAL 步骤置 OBSOLETE |
| CN | `requestId`, `expectedVersion`, `expectedConstraintsVersion?`, `expectedScopeVersion?`, `constraints?`, `scope?`, `llmContextApproved?`（editSchema L115） | constraints 分支必须给 `constraints`（`editMission` L121 否则 422 INVALID_EDIT）；`expectedConstraintsVersion` 缺失会 409（L120 比较 undefined） |
| RS | 同上；用 `scope` + `expectedScopeVersion` | researchScopeSchema：`{academicMetadata, enabled, topic, publicTerms, allowedCategories, excludedTerms, allowedHosts}`（`lib/types/mission.ts` L58-L66） |
| CP | `requestId`, `expectedVersion`, `policy`（policyEditSchema L129） | policy 为 `{mode:"MANUAL"}|{mode:"LOW_RISK_READ_ANALYZE"}|boundedInvestigationPolicy`（`lib/types/mission.ts` L40-L44）；BOUNDED 需先创建 MANUAL 委托再改（`createMission` L23 拒绝直接创建 BOUNDED） |
| RR | `requestId`, `expectedControlVersion`, `goal?`, `successCriteria?`, `workingObjective?`, `constraints?`, `researchScope?`, `continuationPolicy?`, `llmContextApproved?`（reviseResponsibilitySchema L165-L175） | 只能用 `expectedControlVersion`；`missionVersion` 等 → 422 |
| CV | `questionId`, `sourcePointers[{id,hash}]`(1-8, 去重), `evidenceReview?`（previewSchema L17） | 无版本字段；服务端重查 status/questionId/cancel/pause（L23）与来源哈希/权限（L26） |
| CC | CV 全部 + `requestId`, `expectedVersion`, `expectedContextVersion`, `assessmentHash`, `fitHash?`, `answer`, `confirmedGap:true`（confirmSchema L18） | 版本/上下文/评估哈希（L89）、fitHash（L90）；assessmentHash 覆盖 version/contextVersion/constraintsVersion/scopeVersion/sourcePointers 等（assess L42-L43） |
| AV | `artifactType`(默认 weekly_report), `expectedOutputRevision`（previewSchema L12） | 服务端重查委托未取消/停止、输出 id+revision、来源（L16-L21） |
| AC | AV 全部 + `requestId`, `previewHash`, `expectedContextVersion`（confirmSchema L13） | 幂等：requestId/旧回执 replay（L33-L40）；上下文/预览哈希（L39）；来源重查在 prepare（L38→L21） |
| AC2 | `title?`, `description?`, `priority?`, `status?`, `dueAt?`, `resultText?`（actionUpdateSchema L88-L97，**非 strict**） | `status:"DONE"` 走 `completeProjectAction`（actionService L142-L148）：≤5 字 400 INVALID_ACTION_RESULT；并发变化 409 ACTION_CHANGED；已完成后重复返回同一 `resultCardId`；无任何 mission/版本栅栏 |

## 4. C/D 应按主操作（primaryAction.kind）发送的字段

| kind | 端点 | 应发字段 | 不应发 |
|---|---|---|---|
| ANSWER_QUESTION | IN | `requestId`、`expectedVersion=requires.missionVersion`、`questionId=requires.questionId`、`answer`（+ 有 evidencePremise 时 `evidenceReview`） | 整包 requires、`requiredSourceRevisions`、`controlVersion`、`planRevision`、`boundaryAt` |
| REVIEW_APPROVAL | AP | `requestId`、`expectedVersion=requires.missionVersion`、`decision`、`proposalHash=requires.proposalHash`；路径用 `requires.approvalId` | 过期后旧 approvalId/proposalHash（重新预览后重取） |
| RESUME_DELEGATION | RE | `requestId`、`expectedVersion` | 许可/时间字段；许可到期会由执行 fence 拒绝，UI 应引导重核 |
| RECHECK_AUTHORITY | 只读重读；需要修订责任时用 RR | RR：`requestId`、`expectedControlVersion=requires.controlVersion`、变更字段 | 命令端点不得发 controlVersion |
| WAIT_FOR_OBSERVATION / VIEW_RESULT / CHECK_UNKNOWN_EFFECT / CHECK_STOP_SETTLEMENT / REVIEW_FAILURE | 无提交；只读/导航 | — | 全部 requires 字段 |
| （委托面板）约束/范围修改 | CN / RS | `requestId`、`expectedVersion=requires.missionVersion`、`expectedConstraintsVersion` / `expectedScopeVersion`、变更体 | requires 其它字段 |
| （原问题补料） | CV → CC | CV：`questionId`、`sourcePointers`（候选/用户选择）；CC：preview 返回值 + `requestId`、`expectedVersion`、`expectedContextVersion`、`assessmentHash`、`answer`、`confirmedGap:true` | `requiredSourceRevisions`（用 preview 的 structured pointers 代替） |
| （成果归入） | AV → AC | AV：`expectedOutputRevision`；AC：preview 返回值 + `requestId`、`artifactType`、`expectedOutputRevision`、`expectedContextVersion`、`previewHash` | requires 任何字段 |
| （完成回执） | AC2 | `status:"DONE"`、`resultText`（≥5 字） | requires 任何字段（会被静默忽略；不要假设有版本保护） |

## 5. 不可发送清单（strict 端点 → 422 VALIDATION_ERROR）

向 IN / AP / PA / CA / RE / RP / CN / RS / CP / RR / CV / CC / AV / AC 中的**任何**端点发送下列键都是 422（除非该端点的真实字段名恰好相同）：

`missionVersion`、`planRevision`、`contextVersion`、`constraintsVersion`、`researchScopeVersion`、`controlVersion`、`questionId`（CV/CC/IN 之外）、`approvalId`（AP 之外；AP 用路径）、`proposalHash`（AP/IN 之外）、`requiredSourceRevisions`、`boundaryAt`。

需要改名后才能发送的字段名：`expectedVersion`、`expectedContextVersion`、`expectedConstraintsVersion`、`expectedScopeVersion`、`expectedControlVersion`、`expectedOutputRevision`、`previewHash`、`assessmentHash`、`fitHash`、`sourcePointers`、`evidenceReview`。

另：`AC2` 不是 strict schema——发送未知键**不会** 422，而是被 Zod object 默认行为剥离（本套件已证：带 `missionVersion/controlVersion/requiredSourceRevisions` 的完成回执仍 200）。因此 C/D 不要以“没报错”推断服务端校验了这些字段。

## 6. requiredSourceRevisions “服务端重导出”的三处负例证据

字段本身无任何端点接受；服务端按原记录重新校验，来源哈希变化一律入口拒绝：

1. **continuation**（`continuationService.ts` L26）：原 `sourcePointers` 指向的 capture 哈希变化 → CV 与 CC 均 409 SOURCE_CHANGED；套件同时断言 readback `requires.requiredSourceRevisions === ["capture:<id>@<hash>"]` 且该数组被 strict 端点 422 拒绝。
2. **approval**（`missionService.ts` L94 → `repository.ts` L48-L56）：批准入口对 `approval.readSetJson` 中原始来源重算 `sourceHash`，不一致 → 409 SOURCE_CHANGED；请求体无来源字段。
3. **adoption**（`artifactAdoptionService.ts` L21）：确认入口对 `output.sourceRefsJson` 重算，来源变化 → 409 SOURCE_CHANGED；previewHash 也覆盖 sourceManifest（L22-L25），同一变化在哈希比对前已被来源重查拦下。

补充：批准后的执行路径还有第二道 fence：`approvalService.commitApprovedAction` L26 复核 `approval.status/expectedPlanRevision/expiresAt/proposalHash===jsonHash(proposalJson)`，L27 再 `validateSources`。所以“入口已过、执行前来源又变”仍会被 execution fence 拒绝。

## 7. controlVersion / boundaryAt 专项结论

### 7.1 controlVersion
- `commandSchema` 不接受（strict → 422）；`editSchema/policyEditSchema/continuation confirmSchema/adoption confirmSchema` 也都不接受。
- 唯一入口校验：`PATCH /api/missions/[id]/responsibility` 的 `expectedControlVersion`（`responsibility.ts` L196-L199）→ 409 MISSION_CHANGED。责任合同修订会同时失效 PENDING/APPROVED 批准与 READY/WAITING_APPROVAL 步骤（L280-L288），并递增 version/contextVersion/planRevision（L300-L321）。
- input/approval/pause/resume/replan 不核 aggregate controlVersion，是分层设计而非绕过：这些路径分别重查 mission version、原批准哈希/到期/计划版本、readSet 来源、continuity 与执行 fence（`runtimeStore.ts` L26-L40 的 lease/owner/delegation/stop/context/fence）。因此 C/D 只需要在 RECHECK_AUTHORITY→责任修订时使用控制版本；不得把 controlVersion 当“万能提交令牌”。

### 7.2 boundaryAt
- 值来源是最早有效边界（`workPacket.ts` L319-L325），不是请求字段。
- 批准到期：`workState.nextBoundary` 取 PENDING 批准 expiresAt（`workState.ts` L105），`boundaryAt` 同值（套件断言）；批准入口 L90 直接拒绝 → **入口即拒**。
- 持续调查许可到期：`permissionExpiresAt=policy.expiresAt`；`resume`/`input` 等入口不核 → **执行 fence**：`fenced()` L30 → `assertInvestigationDelegation` L25-L27 → 409 DELEGATION_EXPIRED（套件先证明 resume 202、再证明 fenced 409）。
- RUNNING 且 `workState.nextBoundary=leaseUntil`（L119）时等价于租约边界，fence 为 409 LEASE_LOST（`runtimeStore.ts` L28）。
- `constraints.deadline` 与个人记忆依赖边界：只出现在读取/重核建议（`workPacket.ts` L298-L304 blockers），**没有执行 guard**（`assertToolConstraints` 只用 deadline 限制 propose_action 的 dueAt，`constraintsService.ts` L9）。这是残余，见 §8。

## 8. 残余 / 缺口 / late-guard（需 E 复核或后续裁决）

1. **【已修补 · 经主控批准】readback `requires.questionId` 与 IN 的期望身份曾不一致（合法回答 409）。**
   - 修补前缺陷：IN 用“最新 QUESTION/INVESTIGATION_* 事件 id”比对 `body.questionId`（原 `missionService.ts` L78 `q?.id!==body.questionId`），而 requires/`workState.exactQuestionRef` 用 `waitState.questionId`（`workPacket.ts` L248/L369、`workState.ts` L108-L112）。等待回答期间原委托一旦写入 `INVESTIGATION_NO_NEW_INFORMATION` / `INVESTIGATION_OBSERVATION_CHANGED`（delegation observation 的真实事件类型），最新事件 id ≠ 原问题 id → C/D 完全按 requires 提交也被 409 INPUT_CHANGED。
   - 最小修补（`lib/mission/missionService.ts` L76-L84，仅 input 分支）：提前解析 `wait`；`expectedQuestionId = wait?.resolved!==true && typeof wait.questionId==="string" ? wait.questionId : q?.id`；校验改为 `m.status==="WAITING_INPUT" && body.answer && expectedQuestionId!=null && expectedQuestionId===body.questionId`。未放宽跨问题/已解决旧问题；`resolved===true` 的旧问题不接受；无 wait 记录的旧数据回退 `q?.id`（原兼容）；commandReplay/请求哈希/expectedVersion/status 检查顺序与幂等语义不变。
   - 回归证据（本套件 3 例）：① 同一 fixture（等待期间追加观察事件）按 requires 原样提交 → 202、状态 READY、contextVersion+1、planRevision 不变；② 问题后无观察事件的正常路径 → 202、原行为不变；③ 跨问题 id、`resolved===true` 的旧问题 id、READY 后重复回答 → 仍 409 INPUT_CHANGED。
   - 结论：`requires.questionId` 对 `POST /input` 的正确映射 = **当前未解决原问题 ID**（= `waitState.questionId`；旧数据回退最新事件 ID），与 `continuation confirm` 的 `questionId` 同源；C/D 可直接原样携带。
2. **late-guard：`boundaryAt` 中的 deadline / 个人记忆边界不阻断执行**，只出现在读取重核建议；执行器没有对应 fence。若验收要求“边界越过后禁止继续执行”，需另立服务端守卫（本轮不建议改入口，按任务要求只记录）。
3. **`adoption confirm` 不以 planRevision / missionVersion 为栅栏**：只核对 output revision + 来源 + previewHash + contextVersion；`replan` 只推进 planRevision（不推进 contextVersion），因此 replan 后仍可归入旧草稿。确认对象是具体输出内容与来源，属可接受的“用户确认内容”语义，但 C/D 不应把它描述为“计划已复核”。
4. **`commandMission` 的 approval/input 分支不核 controlVersion / permissionState（聚合权限）**；执行依赖后续 fence 与来源重查。若要求“许可过期立即禁止批准入口”，当前只在持续调查许可到期时由 fence 拦；批准入口只拦 approval.expiresAt。属 late-guard，文档化，不改入口。
5. **`input` 的 evidenceReview 路径不携带 fitHash**：只校验 `premiseHash`（`evidenceFitService.assessEvidenceFit` L23）与 mode；propose/continuation 路径才校验 fitHash/assessmentHash。requires 不暴露 premiseHash，C/D 必须从 `missionDetail.evidencePremise` 取。
6. **`requiredSourceRevisions` 只覆盖 CURRENT+ALLOWED 的来源**；它不是“续接必发清单”，CC 需要 preview 的 assessmentHash 与原问题，单靠 requires 不能完成提交。
7. **无法入口证明项**：`boundaryAt` 的个人记忆边界与 deadline 没有真实负例（无 guard 可证伪），只能在映射表标注“无执行校验”；租约/许可 fence 已由套件覆盖。

## 9. 复现与验证

```powershell
# 目录 D:\Projects\hongmen-final-a-mission-packet，HEAD 4b69614（+ 本轮未提交修补）
npm.cmd test -- tests/finalARequiresGuards.test.ts
# → Test Files 1 passed (1); Tests 24 passed (24); exit 0

# 受影响既有回归（8 文件，含 requires 套件）：
npm.cmd test -- tests/finalARequiresGuards.test.ts tests/missionContinuation.test.ts `
  tests/missionContinuation.review.test.ts tests/missionContinuationPanel.test.ts `
  tests/missionNativeContract.test.ts tests/ux3Responsibility.test.ts `
  tests/ux3ResponsibilityControls.test.ts tests/ux3ResponsibilityRevision.test.ts
# → Test Files 8 passed (8); Tests 73 passed (73); exit 0

# 类型：npm.cmd exec tsc -- --noEmit → exit 2，剩余诊断全部位于并行 Agent 的未完成文件
# （evidence/.../verify/fixtures/baseline-requires.ts、scripts/final-a/a1-contract-samples.ts、
#  scripts/final-a/perf-readback.ts、tests/finalAEvidenceReviewWindow.test.ts），
# 本套件与 lib/mission/missionService.ts 无新增诊断。
```

套件覆盖（24 例）：strict 整包盲发 422 ×2、missionVersion→expectedVersion（input 旧版本 409/当前 202、pause/resume）、planRevision→approval.expectedPlanRevision 409、contextVersion→CC 409 ASSESSMENT_CHANGED / AC 409 OUTPUT_CHANGED、constraintsVersion/scopeVersion 409 MISSION_CHANGED、questionId 409 INPUT_CHANGED 与正确受理、approvalId 跨 mission 409 + 跨账号 404 + 无凭据 401 + 过期批准 409、proposalHash 缺失/篡改 409 与正确受理、controlVersion 读取一致性 + 旧值 409 + 当前值 200 + 盲发 422、requiredSourceRevisions 三处 409 SOURCE_CHANGED（continuation/approval/adoption）、boundaryAt 批准入口一致性与持续调查许可 fence 409 DELEGATION_EXPIRED、Action 完成回执无栅栏且幂等、questionId 身份修补 3 例（观察事件后 202 / 无观察事件回归 202 / 跨问题+已解决旧问题+非等待状态 409）。

## 10. 本轮改动（未提交，由主控统一提交）

| 文件 | 改动 |
|---|---|
| `lib/mission/missionService.ts` | 仅 input 分支的原问题身份来源（L76-L84）：waitState 未解决原问题优先、旧数据回退最新事件；经主控批准的最小修补，见 §8.1 |
| `tests/finalARequiresGuards.test.ts` | 新增 24 例独立负例矩阵（独立临时 SQLite、真实路由/服务） |
| `evidence/final-a/20261103/post-checkpoint/REQUIRES_ENDPOINT_MAP.md` | 本映射文档 |

未改两端 UI/ArkTS/官网、schema/迁移、读取授权；未执行 git add/commit/push。

本文件仅为合同证据与 C/D 接线说明：不改两端 UI/ArkTS/官网，不改 schema/迁移，不扩读取授权。
