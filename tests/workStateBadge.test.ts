import { describe, expect, it } from "vitest";
import { nextActorLabel, primaryActionTone, stopRequestBadge, workStateLabel, workTone } from "@/lib/client/workStateBadge";

describe("委托状态徽标只读 WorkState 投影", () => {
  it("色调按下一步该谁", () => {
    expect(workTone({ phase: "WAITING_USER" })).toBe("user");
    expect(workTone({ phase: "WAITING_APPROVAL" })).toBe("user");
    expect(workTone({ phase: "RUNNING" })).toBe("agent");
    expect(workTone({ phase: "WAITING_OBSERVATION" })).toBe("observing");
    expect(workTone({ phase: "QUEUED" })).toBe("queued");
    expect(workTone({ phase: "PAUSED" })).toBe("paused");
    expect(workTone({ phase: "FAILED" })).toBe("failed");
    expect(workTone({ phase: "UNKNOWN" })).toBe("system");
    expect(workTone({ phase: "UNAVAILABLE" })).toBe("system");
  });

  it("COMPLETED 只靠 terminal 区分成功与取消，缺 terminal 不推断为成功", () => {
    const at = { at: null, atSource: "NO_TIME" as const };
    expect(workStateLabel({ phase: "COMPLETED", terminal: { status: "SUCCEEDED", reasonCode: "SUCCEEDED", ...at } })).toBe("条件已验收");
    expect(workStateLabel({ phase: "COMPLETED", terminal: { status: "CANCELLED", reasonCode: "CANCELLED", ...at } })).toBe("已取消（不是成功）");
    expect(workTone({ phase: "COMPLETED", terminal: { status: "CANCELLED", reasonCode: "CANCELLED", ...at } })).toBe("cancelled");
    expect(workStateLabel({ phase: "COMPLETED" })).toBe("已结束");
    expect(workTone({ phase: "COMPLETED" })).toBe("cancelled");
  });

  it("未结算的停止请求单独成徽标，已结算或无请求时不出现", () => {
    const stop = (state: "PAUSE_REQUESTED" | "CANCEL_REQUESTED" | "PAUSE_SETTLED" | "NONE", settled: boolean) => ({ stopRequest: { state, requestedAt: null, settled, note: null } });
    expect(stopRequestBadge(stop("PAUSE_REQUESTED", false))).toBe("暂停请求待结算");
    expect(stopRequestBadge(stop("CANCEL_REQUESTED", false))).toBe("取消请求待结算");
    expect(stopRequestBadge(stop("PAUSE_SETTLED", true))).toBeNull();
    expect(stopRequestBadge(stop("NONE", false))).toBeNull();
    expect(stopRequestBadge({})).toBeNull();
  });

  it("主按钮：轮到你实心，忆程或系统描边，失败砖红；未知执行方不显示", () => {
    expect(primaryActionTone({ phase: "WAITING_USER", nextActor: "USER" })).toBe("solid");
    expect(primaryActionTone({ phase: "RUNNING", nextActor: "AGENT" })).toBe("outline");
    expect(primaryActionTone({ phase: "UNKNOWN", nextActor: "SYSTEM" })).toBe("outline");
    expect(primaryActionTone({ phase: "FAILED", nextActor: "SYSTEM" })).toBe("failed");
    expect(primaryActionTone(undefined)).toBe("solid");
    expect(nextActorLabel("AGENT")).toBe("忆程");
    expect(nextActorLabel("UNKNOWN")).toBeNull();
  });
});
