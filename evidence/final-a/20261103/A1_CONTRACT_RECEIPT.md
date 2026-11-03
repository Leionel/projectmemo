# A1 合同与探针切片回执（final-a-workpacket-v1）

- 生成时间：2026-11-03（UTC+8）
- 工作树：`D:/Projects/hongmen-final-a-mission-packet`，分支 `codex/final-a-mission-packet`
- 准备基线：`485d485378637e1da3280ed092739d441c8cf749`
- **A1 代码/探针提交：`f267aec674dbb9c28f6fa79bf428816016d2bee5`**（本回执为其后一份文档提交）
- A1 合同回执提交：`543162f9424659c00f3f2abdee4a43fe2189aabc`
- **A1 收尾补丁提交：`b243f62a2970ffc1bd070ba6c2933690c230d72f`**（RUNNING 执行中主操作、个人记忆边界重核、租约过期不误标 AUTHORITY）
- 合同版本：`final-a-workpacket-v1`，`schemaVersion = 1`
- 证据性质：纯函数 + 独立临时 SQLite 服务级探针；`LLM_MODE=mock`，0 次模型调用，无网络/无外部写入
- 本切片**只证明合同与探针层**。FS-A01～A07 的服务级修复、真实并发与双端接线仍在 A2/验收阶段，未对外签收。

## 1. 交付文件

| 文件 | 内容 |
|---|---|
| `lib/types/workState.ts` | WorkState 增量可选字段：`terminal` / `unsettledEffect` / `stopRequest`（旧客户端忽略） |
| `lib/mission/workState.ts` | 唯一 `missionWorkState` 投影的判定顺序与停止在途/终态/未结算语义 |
| `lib/types/workPacket.ts` | 冻结四问 DTO：identity / snapshot / authority / observations / done / basis / stopped / next / blockers / coverage / realityOutcome |
| `lib/mission/workPacket.ts` | 纯构造器 `buildMissionWorkPacket(input, now?)`：确定性组合、主操作选择、阻断展开、版本要求 |
| `tests/finalAWorkStateContract.test.ts` | 31 项纯合同用例（冲突组合） |
| `tests/finalAWorkPacketContract.test.ts` | 27 项纯合同用例（四问/主操作/阻断/旧后端降级） |
| `scripts/final-a/` | FS-A01～A07 特征化探针（服务级）、真实双连接并发探针、A1 纯函数样本生成器、README |
| `evidence/final-a/20261103/probe-*.json` | BEFORE_FIX 探针回执（baseSha=485d485） |
| `evidence/final-a/20261103/samples/FS-A0*.json` | BEFORE_FIX 服务级真实 JSON 样本 |
| `evidence/final-a/20261103/samples/a1-pure/` | A1 纯函数真实 JSON 样本（14 个文件，含 index） |

复跑命令（均只写临时库/证据目录，不读 `.env`）：

```powershell
npx.cmd tsx scripts/final-a/probe-fs-a.ts              # FS-A01~A06 服务级（BEFORE_FIX）
npx.cmd tsx scripts/final-a/probe-fs-a07-concurrency.ts # FS-A07 真实双连接（BEFORE_FIX）
npx.cmd tsx scripts/final-a/probe-work-state-pure.ts    # 纯投影参考
npx.cmd tsx scripts/final-a/a1-contract-samples.ts      # A1 纯函数样本
npm.cmd test -- tests/finalAWorkStateContract.test.ts tests/finalAWorkPacketContract.test.ts tests/agentUxWorkState.test.ts tests/missionWorkspaceSummary.test.ts
```

A1 实测：4 files / 69 tests passed；`tsc --noEmit` exit 0。

## 2. 实际 JSON 样本（节选，完整文件见 `samples/a1-pure/`）

### 2.1 终态 SUCCEEDED 与未结算 UNKNOWN 并存（FS-A01）

`FS-A01-SUCCEEDED-UNKNOWN.json` → `workState`：

```json
{
  "phase": "COMPLETED",
  "nextActor": "USER",
  "requiresUser": true,
  "reasonCode": "SUCCEEDED",
  "reasonText": "原委托完成条件已通过；仍有未知调用结果未结算，现实效果以原结果为准",
  "actionLabel": "查看原结果并核对未知调用",
  "checkedAt": "2026-11-03T03:00:00Z",
  "observedAt": "2026-11-01T08:00:00Z",
  "terminal": { "status": "SUCCEEDED", "at": "2026-11-02T12:00:00Z", "atSource": "FINISHED_AT", "reasonCode": "SUCCEEDED" },
  "unsettledEffect": { "present": true, "code": "EXTERNAL_UNKNOWN", "source": "LAST_ERROR", "reasonText": "原请求或外部效果尚未结算，读取不会自动核销", "resolvedByRead": false },
  "stopRequest": { "state": "NONE", "requestedAt": null, "settled": true, "note": "原委托已完成；停止请求不再具有执行含义" }
}
```

`FS-A01-CANCELLED-UNKNOWN.json` 中 `reasonCode = "CANCELLED"`、`terminal.status = "CANCELLED"`、文案“原委托已取消…不能视为成功完成”，主操作 `CHECK_UNKNOWN_EFFECT`；不存在成功勾选或恢复动作。

### 2.2 RUNNING + 停止请求在途（FS-A02）

`FS-A02-RUNNING-PAUSE-IN-FLIGHT.json` → `workState` 与主操作：

```json
{
  "phase": "RUNNING",
  "reasonCode": "STOP_REQUESTED_IN_FLIGHT",
  "reasonText": "已收到停止请求，等待本轮调用结算，不会继续派发新步骤",
  "actionLabel": "核对停止结算",
  "stopRequest": { "state": "PAUSE_REQUESTED", "requestedAt": "2026-11-03T02:59:00Z", "settled": false }
}
```

```json
{
  "kind": "CHECK_STOP_SETTLEMENT",
  "label": "核对停止结算",
  "target": { "kind": "MISSION", "id": "synthetic-final-a-mission", "version": 7 },
  "requires": { "missionVersion": 7, "planRevision": 4, "contextVersion": 3, "constraintsVersion": 2, "researchScopeVersion": 1,
    "controlVersion": "control-v7", "questionId": null, "approvalId": null, "proposalHash": null,
    "requiredSourceRevisions": [], "boundaryAt": "2026-11-03T03:01:00Z" },
  "submissionGuard": "SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY",
  "readOnly": true
}
```

旧 `UNKNOWN` 错误同时保留在 `unsettledEffect` / `blockers[UNKNOWN_EFFECT]`；`PAUSED` 已结算时 `stopRequest.state = "PAUSE_SETTLED"`，主操作为 `RESUME_DELEGATION`（恢复仍由服务端重核条件）。

### 2.3 每日额度等待（FS-A03）

`FS-A03-DAILY-BUDGET-WAITING.json` → `workState`：

```json
{
  "phase": "QUEUED",
  "reasonCode": "DAILY_BUDGET_WAITING",
  "reasonText": "今日调用额度已用完，等待许可时区的次日；累计用量保留",
  "nextCheckAt": "2026-11-04T00:00:00Z"
}
```

`authority.budget.cumulativeUsed` 原样保留、`policy = CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE`、`monetaryCost = null`；阻断 `BUDGET:DAILY_BUDGET_WAITING` 与 `nextCheckAt` 同时可见。

### 2.4 读取时间与成功观察时间（FS-A04）

`FS-A04-OBSERVATION-TIME-COMPARE.json`：

```json
{
  "fixedLastSuccessfulAt": "2026-11-01T08:00:00.000Z",
  "earlier": { "readAt": "2026-11-03T03:00:00.000Z", "workStateObservedAt": "2026-11-01T08:00:00.000Z", "workStateCheckedAt": "2026-11-03T03:00:00.000Z" },
  "later":   { "readAt": "2026-11-03T04:00:00.000Z", "workStateObservedAt": "2026-11-01T08:00:00.000Z", "workStateCheckedAt": "2026-11-03T04:00:00.000Z" }
}
```

`readback.observedAt`（旧字段）冻结为“读取时刻”，新增 `readAt` 同值；成功观察只看 `workState.observedAt` / `workPacket.observations.lastSuccessfulAt`。`observations.state` 为 `OBSERVED | NOT_OBSERVED | FAILED_LAST`；`lastFailedAt` 晚于成功观察时为 `FAILED_LAST`，不得显示“无变化”。`NO_CHANGE` 只是 `lastNoNewInformationAt` 的观察结论，不是生命周期。

### 2.5 来源当前许可 vs 历史留痕（FS-A05）

`FS-A05-SOURCE-CURRENT-USE-SUPPRESSED.json`：

```json
{
  "availability": "CURRENT",
  "availabilityMeaning": "REVISION_MATCH_ONLY_NOT_CURRENT_PERMISSION",
  "currentUse": { "state": "SUPPRESSED", "independentEvidence": false, "reason": "ROOT_SUPPRESSED",
                  "policy": "SOURCE_POLICY_V1", "checkedAt": "2026-11-03T03:00:00Z", "appliesTo": "CURRENT_USE_ONLY" },
  "facts": [ { "kind": "BOUND", "refId": "step-1" }, { "kind": "OUTPUT_REFERENCE", "refId": "output-1", "revision": 1 } ]
}
```

阻断为 `SOURCE:CURRENT_USE_SUPPRESSED`（`blocksActions: true`）；历史 facts/摘录保留，不因撤权删除。

### 2.6 版本推进与时间跨界（FS-A07）

- `FS-A07-SNAPSHOT-VERSION-ADVANCED.json`：`snapshot.consistency = "VERSION_ADVANCED"` + 阻断 `WORK_STATE:SNAPSHOT_VERSION_ADVANCED`，`requires` 携带全部版本字段，提交时服务端重查。
- `FS-A07-TIME-BOUNDARY-CROSSED.json`：无新事件但 `permissionExpiresAt` 已过 → `authority.permissionState = "EXPIRED"`，主操作 `RECHECK_AUTHORITY`，`requires.boundaryAt` 记录原边界。

## 3. 增量字段、可选性与旧后端降级

`readback`（`GET /api/missions/[id]/readback`）保持原字段与语义不变，仅追加：

| 字段 | 类型 | 语义 |
|---|---|---|
| `readAt` | `string` | 本次读取时刻（新字段） |
| `observation` | `{ readAt, state, lastSuccessfulAt, lastFailedAt, lastNoNewInformationAt, nextCheckAt, authority }` | 观察维度摘要，与 `workPacket.observations` 同源 |
| `workPacket?` | `WorkPacket`（可选） | 四问工作包；旧后端没有该字段时客户端退回原详情，**不得构造默认成功事实** |
| `observedAt`（旧） | `string` | 冻结为读取时刻（`@deprecated` 名称），禁止用于“成功观察” |

`workState` 新增字段服务端新版本总是输出；类型上为可选以兼容旧缓存/旧后端：`terminal: {...}|null`、`unsettledEffect: {...}`、`stopRequest: {...}`。

真实 null 与缺失严格区分：`lastSuccessfulAt / lastFailedAt / lastNoNewInformationAt / permissionExpiresAt / deadline / nextBoundary / controlVersion / monetaryCost` 等在服务端响应中显式给 `null`；`workPacket` 整体缺失才表示旧后端。

未知枚举/旧数据：`missionStatus` 原样保留（不新增第二生命周期枚举）；未知状态或事件类型不让构造器抛错，`permissionState` 未知时归 `UNKNOWN` 并保持保守阻断。

## 4. 状态冲突裁决表（纯投影实测）

| 原 status / 事实 | `phase` | `reasonCode` | 主操作 | `stopRequest` | 并列保留的事实 |
|---|---|---|---|---|---|
| SUCCEEDED（无 UNKNOWN） | COMPLETED / NONE | SUCCEEDED | VIEW_RESULT | NONE | `terminal.at=finishedAt`（FINISHED_AT） |
| CANCELLED（无 UNKNOWN） | COMPLETED / NONE | CANCELLED | VIEW_RESULT（取消文案） | 有 cancelAt→CANCEL_SETTLED | 无成功/恢复语义 |
| SUCCEEDED/CANCELLED + UNKNOWN | COMPLETED / USER | 原终态 | CHECK_UNKNOWN_EFFECT | 结算事实保留 | `unsettledEffect.present=true`；UNKNOWN 不被终态擦掉 |
| PAUSED / FAILED + UNKNOWN | UNKNOWN / SYSTEM | `error.code` | RECHECK_AUTHORITY（`REVIEW_FAILURE` 用于 FAILED） | 事实保留 | `terminal=null` |
| RUNNING + 有效 lease + 暂停/取消请求 | RUNNING / SYSTEM | STOP_REQUESTED_IN_FLIGHT | CHECK_STOP_SETTLEMENT | PAUSE/CANCEL_REQUESTED，settled=false | 旧 UNKNOWN 仍由 `unsettledEffect` 并列保留；不得出现继续派发建议 |
| RUNNING + 有效 lease 无请求 | RUNNING / AGENT | LEASE_ACTIVE | WAIT_FOR_OBSERVATION（“查看委托进展（执行中）”，waitingOn=SYSTEM_WORKER） | NONE | `nextBoundary=leaseUntil`；不出现继续/恢复文案 |
| RUNNING + lease 过期 | UNAVAILABLE / SYSTEM | LEASE_UNCONFIRMED | WAIT_FOR_OBSERVATION（“等待租约重新确认”）；停止在途时 CHECK_STOP_SETTLEMENT | 事实保留 | `freshness=UNAVAILABLE`；LEASE blocker；**不**误标 AUTHORITY 许可重核 |
| 个人记忆依赖边界越过（无新事件） | 原 phase 不变 | 原 reasonCode | RECHECK_AUTHORITY | 事实保留 | `TIME_BOUNDARY:PERSONAL_MEMORY_BOUNDARY_PASSED` blocker；`requires.boundaryAt`=最早边界 |
| READY + DAILY_BUDGET_WAITING + 未来 nextAttemptAt | QUEUED / AGENT | DAILY_BUDGET_WAITING | WAIT_FOR_OBSERVATION | NONE | `nextCheckAt` 保留，累计用量不清零 |
| PAUSED 已结算（用户暂停） | PAUSED / USER | PAUSED | RESUME_DELEGATION（重新核对条件） | PAUSE_SETTLED | — |
| 任意终态 | COMPLETED | 原终态 | — | — | `terminal` 始终输出；操作类阻断不噪音展开，仅保留 UNKNOWN/SOURCE/版本类 |

补充：`NO_CHANGE`（`INVESTIGATION_NO_NEW_INFORMATION`）只是最近一次成功观察的结论，可与 `WAITING_OBSERVATION` 并存；观察失败、尚未观察、来源不可用不得显示“没有变化”。

## 5. 原动作身份与版本要求

唯一主操作 `workPacket.next.primaryAction`：

- `kind`：`ANSWER_QUESTION | REVIEW_APPROVAL | RESUME_DELEGATION | RECHECK_AUTHORITY | CHECK_UNKNOWN_EFFECT | CHECK_STOP_SETTLEMENT | WAIT_FOR_OBSERVATION | REVIEW_FAILURE | VIEW_RESULT | NONE`
- `target`：原对象身份 `{ kind: MISSION|QUESTION|APPROVAL|OUTPUT|ACTION|SOURCE, id, version }`；问题/审批不带版本号时 `version=null`；不会指向替代对象。
- `requires`：`missionVersion / planRevision / contextVersion / constraintsVersion / researchScopeVersion / controlVersion / questionId / approvalId / proposalHash / requiredSourceRevisions[] / boundaryAt`。写入/重试时必须原样回传，由原 `commandMission / continuation / adoption / Action` 路径重查 owner、项目、版本、来源、权限、lease、预算与幂等。
- `submissionGuard = SERVER_RECHECKS_OWNER_PROJECT_VERSION_SOURCE_PERMISSION_LEASE_BUDGET_IDEMPOTENCY`，`readOnly = true`：读取工作包**不授予任何执行或写入资格**。
- 关键事实：来源撤销/USE_SUPPRESSION 会推进 `controlVersion` 而 **不改变 `mission.version`**（FS-A07 探针 40 轮中 26 轮如此）。因此只凭 `expectedVersion` 的调用方无法发现来源许可变化；工作包同时给出 `controlVersion` 与来源阻断，提交仍以服务端 SourcePolicy 复查为准。

## 6. FS-A01～A07 探针结果与结算边界

基线 485d485、`git archive` 干净快照、独立临时 SQLite、mock、0 模型调用：

| ID | 基线 verdict | 证据 | A1 已结算 | A2 待结算 |
|---|---|---|---|---|
| FS-A01 | REPRODUCED | `probe-fs-a01-a07.json` | 终态/取消/UNKNOWN 并列的纯投影语义与 DTO | 服务层把新字段接入 detail/summary/readback；终态+未知在摘要入口的呈现由 C/D 决定 |
| FS-A02 | REPRODUCED | 同上 | 停止请求在途/已结算纯投影；不再误导继续 | readback/summary 传入 pause/cancel 字段并显示 |
| FS-A03 | REPRODUCED | 同上 | QUEUED/DAILY_BUDGET_WAITING 纯投影与预算不清零合同 | 事件白名单接入 detail/summary/readback（A2） |
| FS-A04 | NOT_REPRODUCED（服务层） | 同上 | 读取/观察时间分离合同与样本 | readback 增加 `readAt`/`observation`；客户端不得把 `observedAt` 当成功观察（C/D） |
| FS-A05 | REPRODUCED | 同上 | `availability` vs `currentUse` 合同、历史留痕保留 | `materialUseProjection` 接 SourcePolicy 并返回 `currentUse`（A2） |
| FS-A06 | REPRODUCED | 同上 | 覆盖语义 `NOT_FOUND_IS_NOT_NEVER` | AgentRun 窗口先按 Mission 过滤（A2） |
| FS-A07 | REPRODUCED | `probe-concurrency.json` | 单快照/重试/VERSION_ADVANCED/全版本 `requires` 合同 | readback 事务外复查 + 重试 + `workPacket.snapshot`（A2） |

FS-A07 真实双连接（40 轮）基线数字：跨接口版本不一致 13/40、constraints 不一致 13/40、许可变化但 `mission.version` 不变 26/40、同一 `readMissionBack` 响应内不一致 0。说明缺口在“跨接口独立快照/公共版本号”，A2 的单事务工作包与全版本 `requires` 用于闭合。

## 7. C / D 可开始接线的范围（A1 冻结）

- **Web（C）**：可读取 `GET /api/missions/[id]/readback` 的新增 `readAt`、`observation` 与可选 `workPacket`；四问取 `workPacket.done/basis/stopped/next`，唯一主操作取 `next.primaryAction`，其余阻断全部展示 `workPacket.blockers`。旧后端无 `workPacket` 时退回原 readback/detail，不伪造成功。原 `MissionPanel/MissionReadback/MissionResponsibilityPanel` 的职责归并清单由 C 在 Web 组件内实施；不得在组件内另算 phase/优先级/授权。工作包字段语义由 A 维护，缺项报 A 修合同。
- **鸿蒙（D）**：对 `readback` JSON 增加可选字段解析：`readAt: string`、`observation{...}`、`workPacket?`；`workState` 增加可选 `terminal/unsettledEffect/stopRequest`。旧后端字段缺失时必须可空并通过；`primaryAction.requires` 原样携带到原 command/approval/Action 请求；导航目标使用 `target{kind,id,version}` 原对象身份，过期/换版返回原委托而不是替代结果。
- **共同禁止**：A 不修改 Web 布局/官网/ArkTS；C/D 不在客户端重建状态机或权限算法；工作包读取不产生写入、不推进预算、不结算 UNKNOWN。

## 8. 未决风险与 A2 下一步

A2（服务实现）待完成并单独提交：

1. `readMissionBack` 单事务内组合 responsibility + 四问工作包；事务外版本复查/重试（`VERSION_STABLE | RETRIED | VERSION_ADVANCED`）。
2. FS-A03 事件白名单接入 detail/summary/readback；FS-A04 `readAt`/`observation`；FS-A05 `currentUse` 接 SourcePolicy；FS-A06 mission-first 窗口；FS-A07 快照一致性。
3. 独立库服务级正常/负例 + 第二 PrismaClient 真实并发测试 + 12 状态真实 JSON 样本 + GET 前后零副作用。
4. 独立验收（Verifier）另跑 PASS/FAIL/NOT_RUN；真实模型、设备、自然日与独立用户试用不在本切片内。

残余风险（A1 时点）：

- 基线 `readback.observedAt` 仍存在被旧客户端当作“成功观察”的用法风险，合同已冻结词义但客户端需 C/D 接线修正。
- `materialUses.availability = CURRENT` 只代表版本匹配，不代表当前许可；A2 接线前旧客户端仍可能照搬。
- `workspaceSummary` 仍只列活跃任务，终态+未结算 UNKNOWN 不会出现在摘要；该入口是否增加终态提醒需 C/D/E 与主控裁决，不属 A1 合同层。
- FS-A04 在服务层基线为 NOT_REPRODUCED（时间已分离），但仍需 A2 增加显式字段防止误用。
- 真实模型、Worker 自然日、设备与签名安装、独立用户试用均 NOT_RUN，不能由本回执并入通过。
