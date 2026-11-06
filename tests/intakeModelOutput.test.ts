import { describe, expect, test } from "vitest";
import { IntakeModelOutputError, parseUnderstandingOutput } from "@/lib/intake/modelOutput";

const valid = {
  summary: "阶段汇报材料。",
  quotes: [{ materialId: "m1", quote: "当前采用方案 B", meaning: "方案已定" }],
  suggested: { title: "调度汇报", description: "整理阶段汇报并找出还缺的验证。", goal: "完成阶段汇报", scenario: "COURSE_DESIGN" },
  constraints: [], unknowns: [], successCriteria: [],
  nextQuestion: { text: "实验用了论文的边界条件吗？", why: "决定结论是否成立" },
};
const parse = (value: unknown) => parseUnderstandingOutput({ data: typeof value === "string" ? value : JSON.stringify(value), status: "SUCCESS" });

describe("项目前理解的模型输出", () => {
  test("合规输出原样保留", () => {
    expect(parse(valid)).toEqual(valid);
  });

  test("超长和超量只裁剪，不废掉整次理解", () => {
    const out = parse({ ...valid, summary: "长".repeat(2000),
      quotes: Array.from({ length: 20 }, () => ({ materialId: "m1", quote: "引".repeat(600), meaning: "义".repeat(600) })) });
    expect(out.summary).toHaveLength(1200);
    expect(out.quotes).toHaveLength(12);
    expect(out.quotes[0].quote).toHaveLength(400);
  });

  test("多余字段、围栏和简写都能收敛", () => {
    const out = parse("```json\n" + JSON.stringify({ ...valid, extra: 1, unknowns: ["缺边界条件"], constraints: [{ text: "不联网", basis: "MAYBE", note: "x" }],
      suggested: { ...valid.suggested, scenario: "OTHER", confidence: 1 }, nextQuestion: null }) + "\n```");
    expect(out.unknowns[0]).toEqual({ text: "缺边界条件", whyItMatters: "" });
    expect(out.constraints[0]).toEqual({ text: "不联网", basis: "INFERRED" });
    expect(out.suggested.scenario).toBe("COURSE_DESIGN");
    expect(out.nextQuestion.text).toBe("缺边界条件");
  });

  test("缺少核心内容、非 JSON 和被截断的输出明确失败", () => {
    expect(() => parse({ ...valid, summary: "" })).toThrow(IntakeModelOutputError);
    expect(() => parse("不是 JSON")).toThrow(IntakeModelOutputError);
    expect(() => parseUnderstandingOutput({ data: "{", status: "FAILED", fallbackReason: "MODEL_OUTPUT_TRUNCATED" })).toThrow("截断");
  });
});
