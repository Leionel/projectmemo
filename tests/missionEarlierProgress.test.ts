import { describe, expect, it } from "vitest";
import { buildEarlierProgress, type EarlierStep } from "@/lib/mission/earlierProgress";

const step = (ordinal: number, extra: Partial<EarlierStep> = {}): EarlierStep => ({ ordinal, tool: "search_memory", status: "SUCCEEDED", historical: false, withheld: false, note: "查找依据" + ordinal, ...extra });

describe("早期进展摘要", () => {
  it("没有被挤出的内容时不产生字段", () => {
    expect(buildEarlierProgress([], [])).toBeUndefined();
  });
  it("来源受限的步骤只留序号和工具", () => {
    const value = buildEarlierProgress([step(1, { withheld: true, note: "受限内容", failure: "受限原因", sources: ["受限来源"] })], [])!;
    expect(value.steps[0]).toEqual({ ordinal: 1, tool: "search_memory", status: "SUCCEEDED", withheld: true });
    expect(JSON.stringify(value)).not.toContain("受限");
  });
  it("超长时先合并最早的步骤并如实计数，保留用户回答", () => {
    const rows = Array.from({ length: 120 }, (_, i) => step(i + 1, { note: "很长的说明".repeat(30), sources: ["来源甲", "来源乙", "来源丙", "来源丁"] }));
    const value = buildEarlierProgress(rows, [{ seq: 3, answer: "本周先稳演示" }], 5)!;
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(2400);
    expect(value.inputs[0].answer).toBe("本周先稳演示");
    expect(value.steps.at(-1)!.ordinal).toBe(120);
    expect(value.rolledUp.steps).toBe(5 + 120 - value.steps.length);
    expect(value.rolledUp.byTool.search_memory).toBe(120 - value.steps.length);
    expect(value.steps[0].sources!.length).toBeLessThanOrEqual(3);
  });
  it("摘要声明自己不是证据", () => {
    expect(buildEarlierProgress([step(1)], [])!.policy).toContain("不是证据");
  });
});
