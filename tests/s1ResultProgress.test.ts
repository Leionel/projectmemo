import { describe, expect, test } from "vitest";
import { reviewProgressOf } from "@/lib/mission/reviewProgress";

/**
 * S1-C 结果分类：已执行 / 已观察 / 独立支持 / 用户报告 / 反例 / 未知。
 * 这是原 Step/Output/Action/回执的投影，不是完成真值；本文件只验证投影边界。
 */
describe("S1-C 结果分类投影", () => {
  test("没有步骤时六类都为 0，且策略明确不是现实完成", () => {
    const progress = reviewProgressOf({ steps: [], outputs: [], actions: [] });
    expect(progress.classes.map(c => c.key)).toEqual(["executed", "observed", "independentlySupported", "userReported", "counterExamples", "unknown"]);
    expect(progress.classes.every(c => c.count === 0)).toBe(true);
    expect(progress.policy).toBe("PROJECTION_FROM_EXISTING_STEPS_OUTPUTS_ACTIONS_RECEIPTS_NOT_REALITY_COMPLETION");
  });

  test("执行与观察分开：跑过工具不等于带回来源", () => {
    const progress = reviewProgressOf({ steps: [
      { status: "SUCCEEDED", resultJson: { data: { ok: true } } },
      { status: "SUCCEEDED", resultJson: { data: { ok: true }, sources: [{ id: "capture:1" }] } },
    ], outputs: [], actions: [] });
    expect(progress.counts.executed.steps).toBe(2);
    expect(progress.counts.observed.steps).toBe(1);
  });

  test("逐句核对：支持与反例分别计数，未知不当作失败", () => {
    const progress = reviewProgressOf({ steps: [], actions: [], outputs: [
      { id: "o1", revision: 1, claimChecksJson: [
        { status: "ENTAILS" }, { status: "CONTRADICTS" }, { status: "NOT_ENOUGH_INFORMATION" }, { status: "NOT_CHECKED" }] },
    ] });
    expect(progress.counts.independentlySupported.claims).toBe(1);
    expect(progress.counts.counterExamples.claims).toBe(1);
    expect(progress.counts.unknown.claims).toBe(2);
  });

  test("用户报告与演示数据分开：完成行动仍只是用户报告", () => {
    const progress = reviewProgressOf({ steps: [], outputs: [], actions: [
      { id: "a1", status: "DONE", resultCardId: "card-1", isSimulated: false },
      { id: "a2", status: "DONE", resultCardId: null, isSimulated: false },
      { id: "a3", status: "DONE", resultCardId: "card-3", isSimulated: true },
    ] });
    expect(progress.counts.userReported.actionReceipts).toBe(1);
    expect(progress.counts.executed.actions).toBe(2);
    expect(progress.coverage.actionsInspected).toBe(2);
  });

  test("未知步骤单独计入 unknown，不折叠成无变化", () => {
    const progress = reviewProgressOf({ steps: [{ status: "UNKNOWN", resultJson: {} }], outputs: [], actions: [], unknownSteps: 1 });
    expect(progress.counts.unknown.steps).toBe(1);
    expect(progress.classes.find(c => c.key === "unknown")?.count).toBe(1);
  });
});
