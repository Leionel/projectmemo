# 终态 + 未结算 UNKNOWN 的现有摘要/Focus 入口（A-新2）

日期：2026-11-03（UTC+8；Focus 扩入口与复核为同日 15:0x–15:2x）。工作目录 `D:\Projects\hongmen-final-a-mission-packet`，分支 `codex/final-a-mission-packet`，固定主控检查点 `4b696141435825a3582816e8e449c0e0cf013f29`（HEAD 已核对为该提交）。
数据来源：`tests/helpers/continuityDatabase` 生成的独立临时 SQLite（重放 `prisma/migrations` 全部迁移），未使用开发库、未调用模型、未做外部写入；模型/付费调用 0。两个入口都是服务端只读投影，浏览器/UI 未改动（UI 接线由 C/D 负责）。

## 0. 结论

1. **项目委托摘要入口**（`missionWorkspaceSummary`，Web 项目页与 `GET /api/missions/summary` 共用）新增**可选**字段 `terminalUnsettled`；旧客户端忽略，`enabled/totalActive/items` 语义不变。
2. **全局 Focus 入口**（`loadGlobalFocus`，`/focus` 页面与 `GET /api/workspace/focus` 共用）把同一窗口命中的终态未结算条目**并入现有 `waiting` 数组**（复用原 `FocusEntry` 渲染路径），不新增顶层数组；`counts.waiting` 计入这些 `requiresUser=true` 条目，`coverage.terminalUnsettled` 与 `hasMore` 如实标注有界覆盖。
3. 两类未结算事实都能从上述两个入口重新找到：`lastErrorJson` 含 `UNKNOWN`（LAST_ERROR）与**原 Step 状态 UNKNOWN**（STEP），并与原 `workState.terminal` 并列显示（`requiresUser=true`），不把终态擦掉、不把取消写成成功；两个入口共用同一 `presentMissionSummary`/`missionUnknownStepCounts` 投影，字段一致。
4. 不是新收件箱：无新表/迁移/路由/UI/状态库，只复用原 Mission/Step 与同一 `WorkState` 投影；读取零写入、不改变终态生命周期；窗口覆盖有界且如实标注 `inspected/limit/truncated/note`。

## 1. 入口与前置条件

### 1.1 入口一：项目委托摘要（`lib/mission/workspaceSummary.ts`）

- 函数：`missionWorkspaceSummary(userId, projectId)`；消费方（本轨不改）：`app/projects/[id]/page.tsx` 与 `app/api/missions/summary/route.ts`。
- 前置条件保持原文：`assertOwner` 先执行（非 Owner 仍 404）；`MISSION_ENABLED` 或 `MISSION_UI_ENABLED` 关闭时仍返回旧合同 `{enabled:false,totalActive:0,items:[]}`，**不携带**新字段、不抛错。
- 新增查询只在 feature 打开后执行；终态窗口读取失败时降级为空窗口 + 明确 note，不让整个摘要 500，也不把失败说成“不存在”。

### 1.2 入口二：全局 Focus（`lib/server/globalFocus.ts`）

- 函数：`loadGlobalFocus(userId, archived)`；消费方（本轨不改）：`app/focus/page.tsx`（`FOCUS_AGENT_ENABLED` 开或关都读同一对象）与 `GET /api/workspace/focus`。
- 授权沿用原 `missionWhere`：`ownerUserId=userId` **且**项目 membership 为 `OWNER`、遵守 `archived` 范围；因此跨账号、仅 MEMBER 项目、同项目但非本人 Mission 都不会出现在结果中（测试覆盖）。
- `MISSION_ENABLED`/`MISSION_UI_ENABLED` 关闭时 `missionEnabled=false`、`waiting/running=[]`，且不输出 `coverage.terminalUnsettled`（旧合同）。
- 新增终态只读窗口在既有 queries 之外执行；查询或 UNKNOWN Step 计数失败时降级为空窗口 + note（`complete=false`），不让整个 Focus 读取失败。

## 2. 字段形状

### 2.1 摘要入口（`lib/mission/presentation.ts`）

```ts
export type MissionTerminalUnsettledSummary = {
  items: MissionWorkspaceItem[]; // 只含窗口内实际检查到的终态+未结算条目
  inspected: number;             // 本次实际检查的本项目终态委托条数（可能为 limit 或 limit+1）
  limit: number;                 // 单次窗口上限（当前 6）；items 不超过 limit
  truncated: boolean;            // 窗口外仍有未检查的终态委托：窗口内未找到 ≠ 全库没有
  note: string;                  // 覆盖边界说明（空窗口/成功检查/已截断/读取失败各自不同）
  identityNote: string;          // 只读身份说明：同一 id/version，读取不核销 UNKNOWN、不改生命周期
};
export type MissionWorkspaceSummary = {
  enabled: boolean; totalActive: number; items: MissionWorkspaceItem[];
  terminalUnsettled?: MissionTerminalUnsettledSummary; // 可选：旧客户端忽略；缺失=未知，不等于“没有”
};
```

### 2.2 Focus 入口（`lib/types/globalFocus.ts`）

```ts
export type GlobalFocus = {
  coverage?: {
    complete: boolean; consideredProjectIds: string[]; countsAreBounded: boolean;
    /** 可选增量：终态 + 未结算 UNKNOWN 的有界窗口覆盖说明（旧客户端忽略）。 */
    terminalUnsettled?: { inspected: number; limit: number; truncated: boolean; note: string };
  };
  // ...原字段不变；命中的终态条目复用既有 waiting: FocusEntry[]
};
```

- 命中的终态条目就是原 `FocusEntry`：`id/projectId/projectTitle/title/detail/status/activity/...` + 既有可选 `workState` + `actionLabel`；**没有新增顶层数组、没有新增条目类型**。
- `detail` 等于 `workState.reasonText`；`actionLabel` 取自 `workState.actionLabel`；`title` 为原 Mission goal。
- `counts.waiting` = 合并后的 responsive 数（非终态需用户处理 + 终态未结算命中）；`hasMore` 计入终态窗口截断与合并显示溢出；`coverage.complete` 在终态窗口截断/失败时为 false。

每个条目里的 `workState` 是既有共享投影（`lib/mission/workState.ts`，主控已合入）：

- `workState.terminal`：`{status:"SUCCEEDED"|"CANCELLED", at, atSource:"FINISHED_AT"|"UPDATED_AT"|"NO_TIME", reasonCode}`；
- `workState.unsettledEffect`：`{present:true, code, source:"LAST_ERROR"|"STEP", reasonText, resolvedByRead:false}`；
- `workState.requiresUser=true`、`phase="COMPLETED"`、`actionLabel`（成功/取消各自的“查看原结果并核对未知调用”措辞）。

## 3. 覆盖窗口分别说明

| 维度 | 非终态 active/待回应窗口（原有，未改语义） | 终态 unsettled 窗口（本轮新增，两个入口一致） |
| --- | --- | --- |
| 目的 | “需要你处理/继续”的活动委托 | 找回“已结束但仍有未结算 UNKNOWN”的原委托，供核对 |
| where.status | 摘要：`notIn [SUCCEEDED,CANCELLED]`；Focus：4 个 waiting 状态 + `READY/RUNNING` | `in [SUCCEEDED,CANCELLED]` |
| 分区/上限 | 摘要：需关注 4 状态各 `take 3` + 运行中 `take 3` → `items` 再截 3；Focus：每类 `take 6+1`，正文每类 ≤6 | `take limit+1`（6+1=7，`orderBy updatedAt desc, id desc`）→ 筛选后摘要 `items` ≤6；Focus 正文最多再受原 `LIMIT=6` 约束 |
| 筛选 | 原状态白名单 | `workState.unsettledEffect?.present === true`（lastErrorJson 含 UNKNOWN 或原 Step UNKNOWN；Step 用窗口内 missionId 精确 `groupBy` 计数） |
| 计数 | 摘要：`totalActive=count(非终态)`；Focus：`counts.waiting`=responsive 数 | 摘要：`inspected/limit/truncated`；Focus：`coverage.terminalUnsettled.inspected/limit/truncated`，并计入 `counts.waiting` |
| 条目去向 | 摘要 `items`；Focus `waiting` | 摘要只进 `terminalUnsettled.items`（不进 `items`、不改 `totalActive`）；Focus 并入 `waiting`（不新增数组） |
| 空结果 | 原行为 | 空数组 + note 明确“窗口内未找到 ≠ 全库没有”（或“当前项目没有终态委托”） |
| 失败 | 原行为 | 降级为空窗口 + note（`读取失败，未确认不存在`），原 items/totalActive/waiting 不受影响；Focus `complete=false` |

关键实现细节：

- 两个入口都复用 `missionSummarySelect`（原摘要白名单）并只补 `finishedAt`，使 `terminal.at/atSource` 与原详情/读回取同一来源；未改共享 select 本身，其他调用方语义不变。
- UNKNOWN Step 计数统一调用导出的 `missionUnknownStepCounts`（`lib/mission/workspaceSummary.ts`）：对窗口内 missionId 做一次 `groupBy` 精确计数（与 `missionDetail`/`readMissionBack` 同一定义，最多 7 个 mission），不把“任意 Step 窗口里的 UNKNOWN 条数”当成总数。
- 新增只读查询：摘要入口 终态窗口 1 条 + UNKNOWN Step 计数 1 条；Focus 入口 终态窗口 1 条 + UNKNOWN Step 计数 1 条（窗口为空时跳过）。全部在 `ownerUserId`/OWNER membership 下有界，无全表扫描、无模型、无写入。
- Focus 的 `primaryContext`/`consideredProjectIds` 仍只由原非终态候选构建（不新增注意力枚举）；只有终态未结算条目时 `primaryContext=null`，`focusPrimary()` 按原逻辑回退到 `waiting` 中 `requiresUser=true` 的条目，C/D 现有 Focus 组件即可展示。

## 4. 真实响应 JSON 片段

以下均为最终实现经独立临时库的真实调用取样（为可读性加了换行，字段值未改；`id`/`checkedAt` 每次运行会变，`terminal.at` 与 `unsettledEffect` 来自原记录、可复现）。

### 4.1 摘要入口 `missionWorkspaceSummary`（2026-11-03 14:51 取样）

```json
{
  "enabled": true,
  "totalActive": 0,
  "items": [],
  "terminalUnsettled": {
    "items": [
      {
        "id": "cmw0bxazd0003l48ot29gt2dl",
        "goal": "终态委托 succeeded-external-unknown",
        "status": "SUCCEEDED",
        "version": 2,
        "attention": "原委托完成条件已通过；仍有未知调用结果未结算，现实效果以原结果为准",
        "workState": {
          "phase": "COMPLETED", "nextActor": "USER", "requiresUser": true,
          "reasonCode": "SUCCEEDED",
          "reasonText": "原委托完成条件已通过；仍有未知调用结果未结算，现实效果以原结果为准",
          "actionLabel": "查看原结果并核对未知调用",
          "originalRef": { "kind": "MISSION", "id": "cmw0bxazd0003l48ot29gt2dl", "version": 2 },
          "checkedAt": "2026-11-03T06:51:14.711Z", "observedAt": null,
          "terminal": { "status": "SUCCEEDED", "at": "2026-02-04T03:00:00.000Z", "atSource": "FINISHED_AT", "reasonCode": "SUCCEEDED" },
          "unsettledEffect": { "present": true, "code": "EXTERNAL_UNKNOWN", "source": "LAST_ERROR", "reasonText": "原请求或外部效果尚未结算，读取不会自动核销", "resolvedByRead": false },
          "stopRequest": { "state": "NONE", "requestedAt": null, "settled": true, "note": "原委托已完成；停止请求不再具有执行含义" }
        },
        "activity": null, "activityAt": null, "outputRevision": null
      },
      {
        "id": "cmw0bxazm0004l48o2pzjeery",
        "goal": "终态委托 cancelled-unknown-step",
        "status": "CANCELLED",
        "version": 2,
        "attention": "原委托已取消，历史结果保留；仍有未知调用结果未结算，不能视为成功完成",
        "workState": {
          "phase": "COMPLETED", "nextActor": "USER", "requiresUser": true,
          "reasonCode": "CANCELLED",
          "reasonText": "原委托已取消，历史结果保留；仍有未知调用结果未结算，不能视为成功完成",
          "actionLabel": "查看取消前原结果并核对未知调用",
          "originalRef": { "kind": "MISSION", "id": "cmw0bxazm0004l48o2pzjeery", "version": 2 },
          "checkedAt": "2026-11-03T06:51:14.713Z", "observedAt": null,
          "terminal": { "status": "CANCELLED", "at": "2026-02-03T03:00:00.000Z", "atSource": "FINISHED_AT", "reasonCode": "CANCELLED" },
          "unsettledEffect": { "present": true, "code": null, "source": "STEP", "reasonText": "原 2 个步骤结果尚未结算，读取不会自动核销", "resolvedByRead": false },
          "stopRequest": { "state": "CANCEL_SETTLED", "requestedAt": "2026-02-03T02:59:00.000Z", "settled": true, "note": "取消请求已结算：原委托已取消，历史结果保留，不能视为成功完成" }
        },
        "activity": null, "activityAt": null, "outputRevision": null
      }
    ],
    "inspected": 4,
    "limit": 6,
    "truncated": false,
    "note": "仅检查了本项目最近 4 条终态委托（按最后修订时间）；窗口内未找到不等于全库没有（更早或非本项目的终态委托不在窗口内），请从原委托列表/详情核对。",
    "identityNote": "条目 id/status/version 与原委托、详情与读回一致；workState 并列显示 terminal 与 unsettledEffect（requiresUser=true，仅能在原委托中核对/结算）。读取只投影既有事实：不核销 UNKNOWN、不改变终态、version、updatedAt 或生命周期。"
  }
}
```

同一 fixture 下，逐条与 `missionDetail` / `readMissionBack` 对比断言：`item.version === detail.version === readMissionBack.missionVersion`，`item.workState.terminal` 与 `unsettledEffect` 与两者**逐字段相等**。

### 4.2 Focus 入口 `loadGlobalFocus` / `GET /api/workspace/focus`（2026-11-03 15:15 取样）

```json
{
  "coverage": {
    "complete": true,
    "consideredProjectIds": [],
    "countsAreBounded": true,
    "terminalUnsettled": {
      "inspected": 4,
      "limit": 6,
      "truncated": false,
      "note": "非终态待回应窗口与终态 unsettled 窗口分别有界：终态窗口按最后修订时间只检查当前授权范围内最近 6 条已结束（成功/取消）委托；窗口内未找到不等于全库没有，更早或跨项目的终态委托请从原项目/委托列表核对。终态条目只提示核对，读取不会结算 UNKNOWN。"
    }
  },
  "discussions": [],
  "primaryContext": null,
  "counts": { "waiting": 2, "running": 0, "actions": 0, "reminders": 0 },
  "nextDeadline": null,
  "schemaVersion": 1,
  "missionEnabled": true,
  "archived": false,
  "hasMore": false,
  "waiting": [
    {
      "id": "cmw0cszio00098w8ohoh2b9tx",
      "projectId": "cmw0cszht00058w8onw9gwjc8",
      "projectTitle": "Focus 终态窗口 main",
      "title": "Focus 委托 succeeded-external-unknown",
      "detail": "原委托完成条件已通过；仍有未知调用结果未结算，现实效果以原结果为准",
      "status": "SUCCEEDED",
      "activity": "", "activityAt": "", "recordedAt": "", "dueAt": "", "projectDeadline": "", "recordFields": [],
      "workState": {
        "phase": "COMPLETED", "nextActor": "USER", "requiresUser": true,
        "reasonCode": "SUCCEEDED",
        "reasonText": "原委托完成条件已通过；仍有未知调用结果未结算，现实效果以原结果为准",
        "actionLabel": "查看原结果并核对未知调用",
        "originalRef": { "kind": "MISSION", "id": "cmw0cszio00098w8ohoh2b9tx", "version": 2 },
        "checkedAt": "2026-11-03T07:15:52.989Z", "observedAt": null,
        "terminal": { "status": "SUCCEEDED", "at": "2026-02-04T03:00:00.000Z", "atSource": "FINISHED_AT", "reasonCode": "SUCCEEDED" },
        "unsettledEffect": { "present": true, "code": "EXTERNAL_UNKNOWN", "source": "LAST_ERROR", "reasonText": "原请求或外部效果尚未结算，读取不会自动核销", "resolvedByRead": false },
        "stopRequest": { "state": "NONE", "requestedAt": null, "settled": true, "note": "原委托已完成；停止请求不再具有执行含义" }
      },
      "actionLabel": "查看原结果并核对未知调用"
    },
    {
      "id": "cmw0csziw000a8w8olptxbkil",
      "projectId": "cmw0cszht00058w8onw9gwjc8",
      "projectTitle": "Focus 终态窗口 main",
      "title": "Focus 委托 cancelled-unknown-step",
      "detail": "原委托已取消，历史结果保留；仍有未知调用结果未结算，不能视为成功完成",
      "status": "CANCELLED",
      "activity": "", "activityAt": "", "recordedAt": "", "dueAt": "", "projectDeadline": "", "recordFields": [],
      "workState": {
        "phase": "COMPLETED", "nextActor": "USER", "requiresUser": true,
        "reasonCode": "CANCELLED",
        "reasonText": "原委托已取消，历史结果保留；仍有未知调用结果未结算，不能视为成功完成",
        "actionLabel": "查看取消前原结果并核对未知调用",
        "originalRef": { "kind": "MISSION", "id": "cmw0csziw000a8w8olptxbkil", "version": 2 },
        "checkedAt": "2026-11-03T07:15:52.989Z", "observedAt": null,
        "terminal": { "status": "CANCELLED", "at": "2026-02-03T03:00:00.000Z", "atSource": "FINISHED_AT", "reasonCode": "CANCELLED" },
        "unsettledEffect": { "present": true, "code": null, "source": "STEP", "reasonText": "原 1 个步骤结果尚未结算，读取不会自动核销", "resolvedByRead": false },
        "stopRequest": { "state": "CANCEL_SETTLED", "requestedAt": "2026-02-03T02:59:00.000Z", "settled": true, "note": "取消请求已结算：原委托已取消，历史结果保留，不能视为成功完成" }
      },
      "actionLabel": "查看取消前原结果并核对未知调用"
    }
  ],
  "running": [], "actions": [], "reminders": [], "records": []
}
```

测试同时断言：同一 `id` 在 Focus 的 `waiting[]` 与 `missionWorkspaceSummary.terminalUnsettled.items[]` 中 `status/detail(attention)/actionLabel/phase/nextActor/requiresUser/reasonCode/reasonText/terminal/unsettledEffect` 完全一致（见 Focus 测试用例 2）。

## 5. C/D 消费字段（契约建议）

### 5.1 摘要入口（项目内）

- 入口：`summary.terminalUnsettled?`。**缺失/undefined 表示旧后端或未提供 = 未知**，不显示“没有未结算”、不显示成功。
- 列表项：`items[].id`（跳原 Mission 详情/读回，唯一来源）、`status`、`version`、`goal`、`attention`（可直接作为说明文案）、`activity/activityAt/outputRevision`。
- 事实展示：`workState.terminal`（成功 vs 取消必须分开）、`workState.unsettledEffect`（`present/code/source/reasonText`；`resolvedByRead=false` 明确读取不会核销）、`workState.requiresUser`、`workState.actionLabel`。
- 覆盖边界：`inspected/limit/truncated` 用于“已检查 N 条终态委托 / 窗口已截断”的诚实提示；`note`、`identityNote` 原样展示或等价措辞。

### 5.2 Focus 入口（全局授权范围）

- 入口：现有 `waiting` 数组（**不是**新数组）。终态条目与普通待回应委托同构，按 `workState.requiresUser===true` 归入 C 现有 `FocusAgentWorkspace` 的“需要你判断”分组；D 按原 `GlobalFocus.waiting` 模型消费即可。
- 点击/主操作：`FocusEntry.id` + `projectId` → 原 Mission 详情（`/projects/{projectId}/missions?mission={id}`）；文案用 `FocusEntry.actionLabel`（服务端已给“查看原结果并核对未知调用”），不要用状态猜“查看委托进展”。
- 事实展示：同一个 `workState.terminal` / `unsettledEffect` / `requiresUser`；`detail` 已是服务端 `reasonText`。
- 覆盖边界：`coverage.terminalUnsettled.{inspected,limit,truncated,note}`；`hasMore` 已计入终态窗口截断与合并显示溢出。旧后端无该 coverage 字段时按“未知”处理。
- `requiresUser=true` 只是“需要你核对”的提示，**不是执行令牌**；核对/结算仍走原 Mission 详情、读回与原 command/approval 路径，本入口不新增端点。
- 旧服务 JSON 无新字段时应保持“未知”，不构造默认成功，不因缺字段显示“全部已结算”。

## 6. 为什么不是新收件箱

- 没有新表、迁移、索引、缓存、状态库、后台执行器或事件类型；没有新 API 路由；A 不改 Web/ArkTS UI。
- 摘要入口只读复用既有 `AgentMission`（同一 `missionSummarySelect` 白名单 + `finishedAt`）；Focus 入口同样只复用原 Mission 查询与 `waiting` 数组，终态条目**不新增顶层数组**、不成为新的生命周期状态。
- 不写库：不改 `status/version/updatedAt/finishedAt/lastErrorJson`，不核销 UNKNOWN，不推进成功观察时间；两个入口读取前后 Mission/Step/Event/Output/Approval 五表逐行一致（测试覆盖）。
- 与原 Focus 的关系：终态命中项只是“重新找到并要求用户核对”的既有待回应条目；原权限/版本/幂等/命令路径全部不变，`primaryContext` 选择逻辑也不变。
- 可回滚：撤销本轨 2 个入口的改动与测试即恢复旧响应（无迁移/数据变更），旧客户端自始至终忽略新增字段。

## 7. 验证（命令与退出码）

1. 摘要入口新测试（独立临时库，9 例）：
   `npm.cmd test -- tests/finalATerminalUnknownSummary.test.ts` → **9/9 PASS，exit 0**。
   覆盖：SUCCEEDED+EXTERNAL_UNKNOWN 与 CANCELLED+UNKNOWN Step 均找回；与 `missionDetail`/`readMissionBack` 同 `missionVersion`/identity；正常 SUCCEEDED/CANCELLED 不出现；无终态项目空窗口 + note；7 条终态截断（`truncated=true`、`inspected=limit+1`、`items=limit`）；非 Owner/外部用户 404；feature 关闭返回旧合同且无新字段；读取前后 5 表逐行一致 + 终态 lifecycle 不变；终态窗口读取失败降级为空 + note 且恢复后可再找回。
2. Focus 入口新测试（独立临时库，7 例）：
   `npm.cmd test -- tests/finalATerminalUnknownFocus.test.ts` → **7/7 PASS，exit 0**。
   覆盖：两类终态未结算条目出现在 `loadGlobalFocus` 与 `GET /api/workspace/focus` 的 `waiting`；`workState` 同时有 terminal+unsettledEffect、`requiresUser=true`、`actionLabel` 正确；`focusPrimary` 可选为主项；与 `missionWorkspaceSummary` 同 id 的 WorkState 字段完全一致；正常终态不出现；跨账号/仅 MEMBER/非本人 Mission 隔离；7 条终态时 `truncated=true/inspected=7/limit=6`、合并后正文仍 ≤6、`counts.waiting=8`、`hasMore=true`；读取前后 5 表逐行一致 + lifecycle 不变；feature 关闭维持旧合同；终态窗口读取失败降级为空 + note，恢复后可再找回。
3. 既有锚点（Focus/摘要相关，10 文件）：
   `npm.cmd test -- tests/finalATerminalUnknownFocus.test.ts tests/focusRunning.test.ts tests/globalFocusPresentation.test.ts tests/agentUxWorkState.test.ts tests/agentUxJourney.test.ts tests/projectAgentContext.test.ts tests/globalWorkspace.integration.test.ts tests/finalATerminalUnknownSummary.test.ts tests/missionWorkspaceSummary.test.ts tests/finalAWorkStateContract.test.ts` → **10 文件 79/79 PASS，exit 0**（含原 `globalWorkspace.integration` 的 Focus/双重归属/关闭开关/API 身份断言）。
4. Focus UI/回执消费锚点（4 文件）：
   `npm.cmd test -- tests/focusUiQuality.test.ts tests/focusCollaboration.test.ts tests/focusConversation.test.ts tests/agentUxControls.test.ts` → **4 文件 50/50 PASS，exit 0**。
5. 类型：`npm.cmd exec tsc -- --noEmit` → **exit 0**（本轨两个入口改动 + Focus 类型后全树类型通过；此前的并行轨 WIP 诊断已随各自修改消失）。
6. 未运行（按任务边界）：完整 Vitest、Next build、E2E、hvigor/HAP、设备；本轨不新增 UI，故不做浏览器验收。

## 8. 残余与边界（不夸大）

- 覆盖范围：摘要入口 = 当前 `projectId` + 当前 Owner；Focus 入口 = 当前用户为 OWNER 且 `ownerUserId` 为本人的项目（遵守 `archived` 范围）。跨账号、仅 MEMBER 项目、非本人 Mission 都不扫描。
- 窗口上限 6 条（`take 7` 探测截断）：更早的终态委托可能未检查；`truncated=true`/`note` 已明示“未找到≠全库没有”，完整核对仍从原委托列表/详情进入。窗口内命中条数也可能少于 6（其余检查项不满足未结算条件），`inspected` 与条目数分开表达。
- Focus 的正文 `waiting` 仍受原 `LIMIT=6` 约束：若非终态待回应已占满，终态命中会体现在 `counts.waiting`/`hasMore` 但不在正文；这是原分页语义，不是“没有”。
- Focus 的 `primaryContext`/`consideredProjectIds` 仍只由原非终态候选构建（不新增注意力枚举）。只有终态未结算时 `primaryContext=null`，`focusPrimary()` 回退到 `waiting` 中 `requiresUser=true` 条目；若同一用户还有其它非终态主项，则主项沿用原选择，终态条目仍在 `waiting` 列表。
- 旧版 `/focus` 页面（`FOCUS_AGENT_ENABLED=false`）的 `MissionGroup` 只按 `WAITING_INPUT/WAITING_APPROVAL/PAUSED/FAILED/READY/RUNNING` 分组渲染，`SUCCEEDED/CANCELLED` 条目不会进入该组（可能仅作为 hero 候选被选中）；新版 `FocusAgentWorkspace` 按 `workState.requiresUser` 正常展示。UI 接线与旧页适配属 C/D 范围，本轨未改 UI。
- `lastErrorJson` 是否“UNKNOWN”沿用既有 `WorkState` 规则（错误码含 `UNKNOWN`），语义与详情/读回一致，不是本入口新定义的分类。
- UNKNOWN Step 计数用窗口内 missionId 的 `groupBy` 精确统计；若未来同一 mission 的 Step 规模极大，该计数仍只按 7 个 missionId 有界查询，不扩表扫描。
- 降级语义：读取失败时 `items=[]`（摘要）或 `waiting` 不含该窗口（Focus，`complete=false`），与“正常空窗口/无终态”靠 `note` 区分；消费者必须显示 note，不能把失败当“没有未结算调用”。
- 本入口只负责“找回/提示”，不负责结算；UNKNOWN 仍只能在原请求/原委托中核对，读取不会自动核销，也不改变任何 lifecycle/版本/时间。

## 9. 改动文件（本轨；未 git add/commit）

- `lib/mission/presentation.ts`：新增可选 `MissionTerminalUnsettledSummary` 与 `terminalUnsettled?` 字段。
- `lib/mission/workspaceSummary.ts`：新增有界终态窗口 + 未结算筛选 + 失败降级；导出统一精确计数 `missionUnknownStepCounts`；`presentMissionSummary` 接受可选 `unknownSteps`；原 items/totalActive 逻辑与共享 select 未改语义。
- `lib/server/globalFocus.ts`：新增有界终态窗口（`select {...missionSummarySelect, project, finishedAt:true}`），命中项并入现有 `waiting`，`counts.waiting`/`hasMore`/`coverage.complete` 如实体现在合并与截断，`coverage.terminalUnsettled` 输出有界说明；失败降级。
- `lib/types/globalFocus.ts`：`coverage.terminalUnsettled?` 可选类型（旧客户端忽略）。
- `tests/finalATerminalUnknownSummary.test.ts`（9 例）、`tests/finalATerminalUnknownFocus.test.ts`（7 例）：独立临时库；Focus 用例同时走真实 `loadGlobalFocus` 与真实 `/api/workspace/focus` 路由（Bearer 会话）。
- `evidence/final-a/20261103/post-checkpoint/TERMINAL_UNKNOWN_ENTRY.md`：本文档。

工作树说明：写作时同树另有其他并行轨未提交文件（如 `lib/mission/materialUseProjection.ts`、`lib/mission/readback.ts`、`lib/continuity/sourcePolicy.ts`、`scripts/final-a/perf-readback.ts`、`tests/finalARequiresGuards.test.ts`、`tests/finalAEvidenceReviewWindow.test.ts` 及 `post-checkpoint/verify/`），不属本交付、未由本轨修改；本轨未执行 `git add/commit`，未 reset/clean/stash，未新建 worktree。
