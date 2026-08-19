import { describe, expect, it } from "vitest";
import { artifactCreateSchema, captureCreateSchema, knowledgeCardDraftSchema, knowledgeCardUpdateSchema, projectCreateSchema, projectUpdateSchema } from "@/lib/validation/schemas";
import { apiError } from "@/lib/api";

describe("input validation", () => {
  it("rejects short project and capture input", () => {
    expect(projectCreateSchema.safeParse({ title: "A", description: "短", goal: "", scenario: "COMPETITION" }).success).toBe(false);
    expect(captureCreateSchema.safeParse({ rawText: "短" }).success).toBe(false);
  });

  it("rejects malformed LLM JSON payloads", () => {
    expect(knowledgeCardDraftSchema.safeParse({ type: "unknown", title: "x", summary: "bad", keywords: [], nextActions: [], importance: 9 }).success).toBe(false);
  });

  it("accepts only real YYYY-MM-DD calendar dates", () => {
    const base = { title: "日期测试", description: "用于验证项目日期字段的严格规则。", goal: "保证日期可靠", scenario: "COMPETITION" } as const;
    expect(projectCreateSchema.safeParse({ ...base, deadline: "2028-02-29" }).success).toBe(true);
    expect(projectCreateSchema.safeParse({ ...base, deadline: "2026-02-29" }).success).toBe(false);
    expect(projectCreateSchema.safeParse({ ...base, deadline: "2026-2-09" }).success).toBe(false);
  });

  it("validates partial project updates without turning omitted fields into null", () => {
    expect(projectUpdateSchema.safeParse({ title: "更新后的项目" }).success).toBe(true);
    expect(projectUpdateSchema.safeParse({}).success).toBe(false);
    expect(projectUpdateSchema.parse({ title: "更新后的项目" }).deadline).toBeUndefined();
    expect(projectUpdateSchema.parse({ deadline: "" }).deadline).toBeNull();
  });

  it("strictly validates editable knowledge card fields", () => {
    expect(knowledgeCardUpdateSchema.safeParse({ title: "修正后的卡片标题" }).success).toBe(true);
    expect(knowledgeCardUpdateSchema.safeParse({}).success).toBe(false);
    expect(knowledgeCardUpdateSchema.safeParse({ title: "短" }).success).toBe(false);
    expect(knowledgeCardUpdateSchema.safeParse({ type: "unknown" }).success).toBe(false);
    expect(knowledgeCardUpdateSchema.safeParse({ importance: 0 }).success).toBe(false);
    expect(knowledgeCardUpdateSchema.safeParse({ keywords: Array.from({ length: 9 }, (_, index) => `关键词${index}`) }).success).toBe(false);
    expect(knowledgeCardUpdateSchema.safeParse({ relatedTasks: ["x".repeat(101)] }).success).toBe(false);
    expect(knowledgeCardUpdateSchema.safeParse({ nextActions: [] }).success).toBe(false);
  });

  it("accepts generated or manually edited artifacts within the content limit", () => {
    expect(artifactCreateSchema.safeParse({ artifactType: "weekly_report" }).success).toBe(true);
    expect(artifactCreateSchema.parse({ artifactType: "readme", content: "  人工润色版本  " }).content).toBe("人工润色版本");
    expect(artifactCreateSchema.safeParse({ artifactType: "readme", content: "   " }).success).toBe(false);
    expect(artifactCreateSchema.safeParse({ artifactType: "readme", content: "x".repeat(50001) }).success).toBe(false);
  });

  it("maps malformed request JSON to a recoverable 400 response", async () => {
    const response = apiError(new SyntaxError("Unexpected token"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_JSON" } });
  });
});
