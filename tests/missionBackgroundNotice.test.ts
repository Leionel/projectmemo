import { describe, expect, it } from "vitest";
import { missionBackgroundNotice } from "@/lib/mission/presentation";

describe("交代委托前的后台实情", () => {
  it("云模型不可用时先说明无法执行，而不是后台在线", () => {
    const notice = missionBackgroundNotice({ cloud: { available: false, reason: "DAILY_QUOTA_EXHAUSTED" }, background: { worker: "RECENT", inspecting: true, lastHeartbeatAt: null } });
    expect(notice).toEqual({ tone: "warn", text: expect.stringContaining("额度已用完") });
  });

  it("只有心跳近期且巡检成功才说关闭页面后会继续", () => {
    const ok = missionBackgroundNotice({ cloud: { available: true, reason: "CONFIGURED" }, background: { worker: "RECENT", inspecting: true, lastHeartbeatAt: "2026-11-04T01:00:00.000Z" } });
    expect(ok?.tone).toBe("ok");
    const stalled = missionBackgroundNotice({ cloud: { available: true, reason: "CONFIGURED" }, background: { worker: "RECENT", inspecting: false, lastHeartbeatAt: null } });
    expect(stalled).toEqual({ tone: "warn", text: expect.stringContaining("巡检没有完成") });
    for (const worker of ["STALE", "UNOBSERVED"] as const) {
      expect(missionBackgroundNotice({ background: { worker, inspecting: false, lastHeartbeatAt: null } })?.text).toContain("不会自动继续");
    }
  });

  it("旧服务没有返回后台字段时不作推断", () => {
    expect(missionBackgroundNotice({})).toBeNull();
    expect(missionBackgroundNotice({ cloud: { available: true, reason: "CONFIGURED" } })).toBeNull();
  });
});
