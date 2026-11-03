import { describe, expect, it } from "vitest";
import { missionWorkState } from "@/lib/mission/workState";

/**
 * A1 纯投影合同测试：不连数据库、不调模型、不使用真实时间。
 * 覆盖冲突组合（终态×UNKNOWN、停止请求×租约、额度等待、时间推进、旧输入/未知枚举），
 * 不只测理想单一状态。
 */

const now = new Date("2026-11-03T04:00:00.000Z");
const later = new Date(+now + 60 * 60 * 1000);
const base = { id: "mission-contract", version: 7, status: "READY" };
const lease = new Date(+now + 60_000);
const observedAt = "2026-11-01T00:00:00.000Z";
const delegation = { delegation: { lastObservedAt: observedAt } };
const state = (extra: Record<string, unknown>, at: Date = now) => missionWorkState({ ...base, ...extra }, at);

describe("终态事实：成功与取消必须可区分，终态优先于 UNKNOWN", () => {
  it("SUCCEEDED 保留终态事实，终态时间取 finishedAt", () => {
    const result = state({
      status: "SUCCEEDED",
      finishedAt: new Date("2026-11-01T00:00:00.000Z"),
      updatedAt: new Date("2026-11-02T00:00:00.000Z"),
    });
    expect(result).toMatchObject({
      phase: "COMPLETED",
      nextActor: "NONE",
      requiresUser: false,
      reasonCode: "SUCCEEDED",
      terminal: { status: "SUCCEEDED", atSource: "FINISHED_AT", reasonCode: "SUCCEEDED" },
      unsettledEffect: { present: false, code: null, source: "NONE", reasonText: null, resolvedByRead: false },
      stopRequest: { state: "NONE", requestedAt: null, settled: true },
    });
    expect(result.terminal?.at).toBe("2026-11-01T00:00:00.000Z");
    expect(result.actionLabel).toBe("查看原结果");
  });

  it("CANCELLED 不显示成功完成或可恢复，动作与成功不同", () => {
    const result = state({ status: "CANCELLED", cancelRequestedAt: new Date("2026-11-02T00:00:00.000Z") });
    expect(result).toMatchObject({ phase: "COMPLETED", reasonCode: "CANCELLED", terminal: { status: "CANCELLED", reasonCode: "CANCELLED" }, stopRequest: { state: "CANCEL_SETTLED", settled: true } });
    expect(result.actionLabel).toBe("查看取消前的原结果");
    expect(result.reasonText).toContain("不能视为成功完成");
    expect(result.reasonText).not.toContain("完成条件已通过");
    expect(result.actionLabel).not.toContain("成功");
    expect(result.actionLabel).not.toContain("恢复");
  });

  it("只有 updatedAt 时标记 UPDATED_AT；两者都缺时 at=null 且标记 NO_TIME（不伪装修订时间）", () => {
    const withUpdated = state({ status: "SUCCEEDED", updatedAt: new Date("2026-11-02T00:00:00.000Z") });
    expect(withUpdated.terminal).toMatchObject({ at: "2026-11-02T00:00:00.000Z", atSource: "UPDATED_AT" });
    const bare = state({ status: "CANCELLED" });
    expect(bare.terminal).toMatchObject({ at: null, atSource: "NO_TIME", status: "CANCELLED" });
    expect(bare.phase).toBe("COMPLETED");
  });

  it("SUCCEEDED 与未结算 UNKNOWN 同时可见：终态不被擦掉，UNKNOWN 不被隐藏", () => {
    const result = state({ status: "SUCCEEDED", lastErrorJson: { code: "EXTERNAL_UNKNOWN", message: "外部效果未结算" } });
    expect(result).toMatchObject({
      phase: "COMPLETED",
      reasonCode: "SUCCEEDED",
      nextActor: "USER",
      requiresUser: true,
      terminal: { status: "SUCCEEDED", reasonCode: "SUCCEEDED" },
      unsettledEffect: { present: true, code: "EXTERNAL_UNKNOWN", source: "LAST_ERROR", resolvedByRead: false },
    });
    expect(result.actionLabel).toBe("查看原结果并核对未知调用");
    expect(result.reasonText).toContain("仍有未知调用结果未结算");
    expect(result.reasonText).toContain("完成条件已通过");
  });

  it("CANCELLED 与未结算 UNKNOWN 同时可见：取消事实不被成功语义替换", () => {
    const result = state({ status: "CANCELLED", lastErrorJson: { code: "TOOL_UNKNOWN" }, cancelRequestedAt: new Date("2026-11-02T00:00:00.000Z") });
    expect(result).toMatchObject({
      phase: "COMPLETED",
      reasonCode: "CANCELLED",
      nextActor: "USER",
      requiresUser: true,
      terminal: { status: "CANCELLED", reasonCode: "CANCELLED" },
      unsettledEffect: { present: true, code: "TOOL_UNKNOWN", source: "LAST_ERROR" },
      stopRequest: { state: "CANCEL_SETTLED", settled: true },
    });
    expect(result.actionLabel).toBe("查看取消前原结果并核对未知调用");
    expect(result.reasonText).toContain("不能视为成功完成");
    expect(result.actionLabel).not.toContain("成功");
  });

  it("终态 + 原 Step 未结算结果（无 lastError）同样保留未结算效果", () => {
    const result = state({ status: "SUCCEEDED", unknownSteps: 2 });
    expect(result).toMatchObject({ phase: "COMPLETED", nextActor: "USER", unsettledEffect: { present: true, code: null, source: "STEP" } });
    expect(result.unsettledEffect?.reasonText).toContain("2 个步骤");
  });

  it("终态残留的历史停止请求不再具有执行含义", () => {
    const result = state({ status: "SUCCEEDED", pauseRequestedAt: new Date("2026-11-02T00:00:00.000Z") });
    expect(result.stopRequest).toMatchObject({ state: "NONE", settled: true, requestedAt: "2026-11-02T00:00:00.000Z" });
  });
});

describe("非终态 UNKNOWN：保持原有 UNKNOWN 显示（RUNNING 停止在途除外）", () => {
  it("PAUSED + TOOL_UNKNOWN 仍是 UNKNOWN 查询原请求", () => {
    const result = state({ status: "PAUSED", lastErrorJson: { code: "TOOL_UNKNOWN" } });
    expect(result).toMatchObject({
      phase: "UNKNOWN", reasonCode: "TOOL_UNKNOWN", nextActor: "SYSTEM", requiresUser: false,
      actionLabel: "查询原请求", terminal: null, unsettledEffect: { present: true, code: "TOOL_UNKNOWN", source: "LAST_ERROR" },
    });
  });

  it("FAILED + UNKNOWN 不把失败改写成终态", () => {
    const result = state({ status: "FAILED", lastErrorJson: { code: "MODEL_UNKNOWN" } });
    expect(result.phase).toBe("UNKNOWN");
    expect(result.terminal).toBeNull();
    expect(result.unsettledEffect?.present).toBe(true);
  });

  it("RUNNING + 有效 lease + 停止请求在途 + UNKNOWN：停止在途优先显示，UNKNOWN 事实仍并列保留", () => {
    const requestedAt = new Date("2026-11-03T03:59:00.000Z");
    const result = state({ status: "RUNNING", leaseUntil: lease, pauseRequestedAt: requestedAt, lastErrorJson: { code: "TOOL_UNKNOWN" } });
    expect(result).toMatchObject({
      phase: "RUNNING", nextActor: "SYSTEM", reasonCode: "STOP_REQUESTED_IN_FLIGHT", actionLabel: "核对停止结算",
      stopRequest: { state: "PAUSE_REQUESTED", settled: false },
      unsettledEffect: { present: true, code: "TOOL_UNKNOWN", source: "LAST_ERROR", resolvedByRead: false },
    });
    // 不得出现“查询原请求”的第二主操作建议，也不得建议继续/恢复派发。
    expect(result.actionLabel).not.toContain("查询原请求");
    expect(result.actionLabel).not.toContain("继续");
    expect(result.actionLabel).not.toContain("恢复");
  });

  it("RUNNING 但 lease 已过期时不触发在途优先：UNKNOWN 仍按原规则显示，停止请求作为事实保留", () => {
    const result = state({ status: "RUNNING", leaseUntil: now, pauseRequestedAt: new Date("2026-11-03T03:59:00.000Z"), lastErrorJson: { code: "TOOL_UNKNOWN" } });
    expect(result.phase).toBe("UNKNOWN");
    expect(result.stopRequest).toMatchObject({ state: "PAUSE_REQUESTED", settled: false });
  });
});

describe("停止请求维度：已收到不等于已结算", () => {
  it("RUNNING 且 lease 有效 + 暂停请求在途：保持 RUNNING，但不得建议继续/恢复派发", () => {
    const requestedAt = new Date("2026-11-03T03:59:00.000Z");
    const result = state({ status: "RUNNING", leaseUntil: lease, pauseRequestedAt: requestedAt });
    expect(result).toMatchObject({
      phase: "RUNNING",
      nextActor: "SYSTEM",
      requiresUser: false,
      reasonCode: "STOP_REQUESTED_IN_FLIGHT",
      actionLabel: "核对停止结算",
      stopRequest: { state: "PAUSE_REQUESTED", requestedAt: requestedAt.toISOString(), settled: false },
    });
    expect(result.reasonText).toContain("等待本轮调用结算");
    expect(result.reasonText).toContain("不会继续派发新步骤");
    expect(result.actionLabel).not.toContain("继续");
    expect(result.actionLabel).not.toContain("恢复");
    expect(result.nextBoundary).toBe(lease.toISOString());
  });

  it("RUNNING 且 lease 有效 + 取消请求在途", () => {
    const result = state({ status: "RUNNING", leaseUntil: lease, cancelRequestedAt: new Date("2026-11-03T03:59:00.000Z") });
    expect(result).toMatchObject({ phase: "RUNNING", reasonCode: "STOP_REQUESTED_IN_FLIGHT", stopRequest: { state: "CANCEL_REQUESTED", settled: false } });
    expect(result.actionLabel).toBe("核对停止结算");
  });

  it("暂停与取消请求同时在途时取消优先，且仍不出现继续派发建议", () => {
    const result = state({
      status: "RUNNING",
      leaseUntil: lease,
      pauseRequestedAt: new Date("2026-11-03T03:58:00.000Z"),
      cancelRequestedAt: new Date("2026-11-03T03:59:00.000Z"),
    });
    expect(result.stopRequest).toMatchObject({ state: "CANCEL_REQUESTED", settled: false, requestedAt: "2026-11-03T03:59:00.000Z" });
    expect(result.reasonCode).toBe("STOP_REQUESTED_IN_FLIGHT");
    expect(result.actionLabel).not.toContain("继续");
  });

  it("RUNNING 无停止请求时保持原有 LEASE_ACTIVE 表达", () => {
    const result = state({ status: "RUNNING", leaseUntil: lease });
    expect(result).toMatchObject({ phase: "RUNNING", nextActor: "AGENT", reasonCode: "LEASE_ACTIVE", stopRequest: { state: "NONE", settled: true } });
    expect(result.actionLabel).toBe("查看委托进展");
  });

  it("RUNNING 但 lease 过期：原 LEASE_UNCONFIRMED 保护保留，停止请求作为事实并列", () => {
    const result = state({ status: "RUNNING", leaseUntil: now, pauseRequestedAt: new Date("2026-11-03T03:59:00.000Z") });
    expect(result).toMatchObject({ phase: "UNAVAILABLE", reasonCode: "LEASE_UNCONFIRMED", nextActor: "SYSTEM" });
    expect(result.stopRequest).toMatchObject({ state: "PAUSE_REQUESTED", settled: false });
    expect(result.freshness).toBe("UNAVAILABLE");
  });

  it("暂停已结算：PAUSED + pauseRequestedAt → PAUSE_SETTLED", () => {
    const result = state({ status: "PAUSED", pauseRequestedAt: new Date("2026-11-03T03:00:00.000Z"), pauseReason: "USER" });
    expect(result).toMatchObject({ phase: "PAUSED", nextActor: "USER", stopRequest: { state: "PAUSE_SETTLED", settled: true, requestedAt: "2026-11-03T03:00:00.000Z" } });
    expect(result.terminal).toBeNull();
  });

  it("只有 pauseReason=USER（旧记录无请求时间）也判为已结算", () => {
    const result = state({ status: "PAUSED", pauseReason: "USER" });
    expect(result.stopRequest).toMatchObject({ state: "PAUSE_SETTLED", settled: true, requestedAt: null });
  });

  it("取消已结算：CANCELLED + 两种请求时间时取消优先", () => {
    const result = state({
      status: "CANCELLED",
      pauseRequestedAt: new Date("2026-11-03T02:00:00.000Z"),
      cancelRequestedAt: new Date("2026-11-03T03:00:00.000Z"),
    });
    expect(result.stopRequest).toMatchObject({ state: "CANCEL_SETTLED", settled: true, requestedAt: "2026-11-03T03:00:00.000Z" });
  });
});

describe("每日额度等待", () => {
  const budgetEvent = { id: "budget", type: "DAILY_BUDGET_WAITING", payloadJson: {} };
  const nextAttemptAt = new Date("2026-11-04T00:00:00.000Z");

  it("READY + 额度等待事件 + 未来 nextAttemptAt → QUEUED 且保留累计用量语义", () => {
    const result = state({ status: "READY", events: [budgetEvent], nextAttemptAt });
    expect(result).toMatchObject({ phase: "QUEUED", nextActor: "AGENT", reasonCode: "DAILY_BUDGET_WAITING", nextCheckAt: nextAttemptAt.toISOString() });
    expect(result.reasonText).toContain("累计用量保留");
    expect(result.terminal).toBeNull();
  });

  it("nextAttemptAt 已过时不假装额度已恢复：退回普通排队，时间事实保留", () => {
    const past = new Date("2026-11-02T00:00:00.000Z");
    const result = state({ status: "READY", events: [budgetEvent], nextAttemptAt: past });
    expect(result).toMatchObject({ phase: "QUEUED", reasonCode: "READY", nextCheckAt: past.toISOString() });
  });

  it("额度等待不产生停止请求或终态", () => {
    const result = state({ status: "READY", events: [budgetEvent], nextAttemptAt });
    expect(result.stopRequest).toMatchObject({ state: "NONE", settled: true });
    expect(result.unsettledEffect?.present).toBe(false);
  });
});

describe("观察时间与读取时间分离", () => {
  it("反复投影时 observedAt 稳定，checkedAt 前进", () => {
    const first = state({ status: "WAITING_INPUT", planJson: delegation, waitStateJson: { waitingFor: "OBSERVATION" } }, now);
    const second = state({ status: "WAITING_INPUT", planJson: delegation, waitStateJson: { waitingFor: "OBSERVATION" } }, later);
    expect(first.observedAt).toBe(observedAt);
    expect(second.observedAt).toBe(observedAt);
    expect(first.checkedAt).toBe(now.toISOString());
    expect(second.checkedAt).toBe(later.toISOString());
    expect(Date.parse(second.checkedAt)).toBeGreaterThan(Date.parse(first.checkedAt));
  });

  it("没有委托观察记录时 observedAt 为 null，刷新不会填成读取时间", () => {
    const first = state({ status: "READY" }, now);
    const second = state({ status: "READY" }, later);
    expect(first.observedAt).toBeNull();
    expect(second.observedAt).toBeNull();
  });

  it("失败读取不推进成功观察时间", () => {
    const failed = state({ status: "PAUSED", planJson: delegation, lastErrorJson: { code: "TOOL_UNKNOWN" } }, later);
    expect(failed.observedAt).toBe(observedAt);
    expect(failed.checkedAt).toBe(later.toISOString());
  });
});

describe("旧输入与未知枚举", () => {
  it("最小旧输入不崩溃，增量字段以事实形式给出", () => {
    const result = missionWorkState({ id: "old", version: 1, status: "WAITING_INPUT" }, now);
    expect(result.phase).toBe("UNKNOWN");
    expect(result.terminal).toBeNull();
    expect(result.unsettledEffect).toMatchObject({ present: false, source: "NONE" });
    expect(result.stopRequest).toMatchObject({ state: "NONE", settled: true });
    expect(result.observedAt).toBeNull();
  });

  it("未知 status 枚举不抛错，按未知处理", () => {
    const result = state({ status: "ARCHIVED_OR_FUTURE_STATE" });
    expect(result.phase).toBe("UNKNOWN");
    expect(result.terminal).toBeNull();
    expect(result.stopRequest?.state).toBe("NONE");
  });

  it("空/null 可选字段与异常事件不抛错", () => {
    const result = state({
      status: "WAITING_INPUT",
      waitStateJson: null,
      planJson: { delegation: null },
      continuationPolicyJson: undefined,
      lastErrorJson: null,
      events: [{ id: "weird", type: "UNKNOWN_TYPE", payloadJson: null }],
      approvals: [{ id: "a", expiresAt: undefined, proposalJson: null }],
    });
    expect(result).toBeTruthy();
    expect(result.terminal).toBeNull();
  });

  it("过期批准不能作为当前审批绑定（保留原合同断言）", () => {
    const result = state({ status: "WAITING_APPROVAL", approvals: [{ id: "old", expiresAt: now }] });
    expect(result).toMatchObject({ phase: "WAITING_APPROVAL", exactApprovalRef: null, reasonCode: "APPROVAL_EXPIRED" });
  });
});

describe("边界与等待组合", () => {
  const policy = { mode: "BOUNDED_INVESTIGATION", expiresAt: "2026-11-03T05:00:00.000Z" };

  it("观察等待在许可内保持 WAITING_OBSERVATION，跨边界后失效为 PAUSED", () => {
    const mission = { status: "WAITING_INPUT", waitStateJson: { waitingFor: "OBSERVATION" }, continuationPolicyJson: policy };
    expect(state(mission).phase).toBe("WAITING_OBSERVATION");
    expect(state(mission, new Date(policy.expiresAt))).toMatchObject({ phase: "PAUSED", nextActor: "USER", reasonCode: "DELEGATION_EXPIRED" });
    expect(state(mission).stopRequest).toMatchObject({ state: "NONE", settled: true });
  });

  it("增量字段随 JSON 序列化保持稳定，旧客户端可忽略", () => {
    const result = state({ status: "RUNNING", leaseUntil: lease, pauseRequestedAt: now });
    const parsed = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      phase: "RUNNING",
      terminal: null,
      unsettledEffect: { present: false },
      stopRequest: { state: "PAUSE_REQUESTED", settled: false },
    });
  });
});
