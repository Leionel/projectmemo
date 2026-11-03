/**
 * A1 参考探针：missionWorkState 纯投影显示行为（复刻 preparation WORK_STATE_PROBE 思路）。
 *
 * 重要边界：本文件只调用纯函数 missionWorkState，不连接数据库、不调用服务、不代表业务修复，
 * 也不能把纯投影输出算成“服务缺陷已确认”。它的用途是给 Lead/A2 一个显示层参照。
 *
 * 运行：npx.cmd tsx scripts/final-a/probe-work-state-pure.ts
 * 退出码：0 = 探针跑完；非零 = 脚本失败。
 */
import { missionWorkState } from "../../lib/mission/workState";
import { gitHead, probeSourceTree, runProbe } from "./lib/probeSupport";

type PureInput = Parameters<typeof missionWorkState>[0];
const fixtureTime = new Date("2026-11-03T03:00:00.000Z");
const delegationObservedAt = "2026-10-01T00:00:00.000Z";

function project(label: string, input: PureInput, note: string) {
  const result = missionWorkState(input, fixtureTime);
  return {
    id: label,
    input: {
      status: input.status,
      version: input.version,
      lastErrorJson: input.lastErrorJson ?? null,
      leaseUntil: input.leaseUntil ? new Date(input.leaseUntil).toISOString() : null,
      nextAttemptAt: input.nextAttemptAt ? new Date(input.nextAttemptAt).toISOString() : null,
      planJson: input.planJson ?? null,
      pauseRequestedAt: (input as PureInput & { pauseRequestedAt?: Date }).pauseRequestedAt
        ? "(input 类型不含该字段，仅作为运行时多余属性验证)"
        : null,
      cancelRequestedAt: (input as PureInput & { cancelRequestedAt?: Date }).cancelRequestedAt
        ? "(input 类型不含该字段，仅作为运行时多余属性验证)"
        : null,
      eventTypes: (input.events ?? []).map(event => event.type ?? null),
    },
    result: {
      phase: result.phase,
      nextActor: result.nextActor,
      requiresUser: result.requiresUser,
      reasonCode: result.reasonCode,
      reasonText: result.reasonText,
      actionLabel: result.actionLabel,
      originalRef: result.originalRef,
      checkedAt: result.checkedAt,
      observedAt: result.observedAt,
      nextCheckAt: result.nextCheckAt,
      nextBoundary: result.nextBoundary,
      freshness: result.freshness,
    },
    note,
  };
}

const base: PureInput = {
  id: "synthetic-pure-projection-mission",
  status: "READY",
  version: 1,
  planJson: {},
  continuationPolicyJson: { mode: "MANUAL" },
};

const budgetWaitingEvent = {
  id: "synthetic-event-budget",
  type: "DAILY_BUDGET_WAITING",
  payloadJson: { budgetRetained: true },
};

const result = await runProbe("probe-work-state-pure", "probe-work-state-pure.json", async () => {
  const cases = [
    project(
      "PURE-FS-A01-CANCELLED",
      { ...base, status: "CANCELLED", version: 3, lastErrorJson: null },
      "只有取消、没有 UNKNOWN：phase=COMPLETED、reasonCode=CANCELLED，取消事实由 reasonCode/文案保留（与 preparation WORK_STATE_PROBE 一致）。",
    ),
    project(
      "PURE-FS-A01-SUCCEEDED-UNKNOWN",
      { ...base, status: "SUCCEEDED", version: 3, lastErrorJson: { code: "EXTERNAL_UNKNOWN" } },
      "成功终态 + UNKNOWN：phase=UNKNOWN，成功终态在 workState 内不可见（只保留 reasonCode=EXTERNAL_UNKNOWN）。",
    ),
    project(
      "PURE-FS-A01-CANCELLED-UNKNOWN",
      { ...base, status: "CANCELLED", version: 3, lastErrorJson: { code: "EXTERNAL_UNKNOWN" } },
      "取消终态 + UNKNOWN：phase=UNKNOWN，workState 内取消终态不可见；没有“已取消”事实，也没有成功勾选。",
    ),
    project(
      "PURE-FS-A02-PAUSE-IN-FLIGHT",
      {
        ...base,
        status: "RUNNING",
        version: 3,
        leaseUntil: new Date("2026-11-03T03:10:00.000Z"),
        ...({ pauseRequestedAt: new Date("2026-11-03T03:00:00.000Z") } as object),
      },
      "RUNNING + 有效 lease + pauseRequestedAt：phase=RUNNING、reasonCode=LEASE_ACTIVE；输入类型没有请求字段，纯投影无法表达“已请求停止、未结算”。",
    ),
    project(
      "PURE-FS-A02-CANCEL-IN-FLIGHT",
      {
        ...base,
        status: "RUNNING",
        version: 3,
        leaseUntil: new Date("2026-11-03T03:10:00.000Z"),
        ...({ cancelRequestedAt: new Date("2026-11-03T03:00:00.000Z") } as object),
      },
      "RUNNING + 有效 lease + cancelRequestedAt：与 PAUSE 完全同形，纯投影没有取消请求维度。",
    ),
    project(
      "PURE-FS-A03-DAILY-BUDGET-WAITING",
      {
        ...base,
        status: "READY",
        version: 2,
        nextAttemptAt: new Date("2026-11-03T05:00:00.000Z"),
        events: [budgetWaitingEvent],
        approvals: [],
      },
      "READY + nextAttemptAt + DAILY_BUDGET_WAITING 事件直接传入：纯投影能给出 QUEUED/DAILY_BUDGET_WAITING/“今日调用额度已用完”；服务层是否把该事件传进来由 probe-fs-a.ts 单独验证。",
    ),
    project(
      "PURE-FS-A03-WITHOUT-EVENT",
      { ...base, status: "READY", version: 2, nextAttemptAt: new Date("2026-11-03T05:00:00.000Z"), events: [], approvals: [] },
      "同样的 READY + 未来 nextAttemptAt，但不传 DAILY_BUDGET_WAITING：退化为 QUEUED/READY（服务路径当前表现）。",
    ),
    project(
      "PURE-FS-A04-FIXED-OBSERVATION",
      {
        ...base,
        status: "READY",
        version: 2,
        planJson: { delegation: { lastObservedAt: delegationObservedAt } },
      },
      "固定 delegation.lastObservedAt：checkedAt=fixtureTime（读取时刻），observedAt=2026-10-01T00:00:00.000Z（成功观察时刻），两者不互相覆盖。",
    ),
  ];
  return {
    generatedAt: new Date().toISOString(),
    baseSha: gitHead(),
    sourceTree: probeSourceTree(),
    mode: "PURE_PROJECTION_REFERENCE" as const,
    disclaimer:
      "纯投影 ≠ 服务缺陷已确认：本文件只验证 missionWorkState 纯函数的显示行为，不连接数据库、不调用服务、不代表修复或最终签收。服务级证据见 probe-fs-a01-a07.json / probe-concurrency.json。",
    fixtureTime: fixtureTime.toISOString(),
    referenceFile: "docs/FINAL/ProjectMemo_2026_11_03-12_决赛冲刺规划/00_总控/preparation-20261103/WORK_STATE_PROBE.json",
    implementation: {
      script: "scripts/final-a/probe-work-state-pure.ts",
      command: "npx.cmd tsx scripts/final-a/probe-work-state-pure.ts",
      pureFunction: "lib/mission/workState.ts:missionWorkState",
    },
    cases,
    summary: {
      total: cases.length,
      displayObservations: {
        "终态+UNKNOWN": "phase 被 UNKNOWN 覆盖；终态只可能在 readback 外层 missionStatus 保留（本纯函数看不到）。",
        "停止请求在途": "纯函数输入无 pauseRequestedAt/cancelRequestedAt，无法表达“请求已收到、未结算”。",
        "额度等待": "只要调用方把 DAILY_BUDGET_WAITING 作为最新事件传入，纯函数可以正确显示；缺口在服务层事件筛选（见服务级证据）。",
        "观察时间": "checkedAt 与 observedAt 分离，读取不会推进成功观察时间。",
      },
    },
    notes: [
      "与 preparation-20261103/WORK_STATE_PROBE.json 叠加核对：CANCELLED phase=COMPLETED、终态+UNKNOWN 显示 UNKNOWN、在途暂停请求没有独立显示字段，三条结论一致。",
      "本探针不作为“业务取消被执行成成功”“Runner 无停止保护”或“来源/权限守卫失效”的证据；这些问题只能由服务级/并发/独立验收证据回答。",
    ],
  };
});

process.exitCode = result;
