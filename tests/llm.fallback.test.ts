import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { structureCaptureWithMeta } from "@/lib/agent";

describe("S03: LLM Capture and Deterministic Fallback Audit", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  const project = {
    title: "人工智能创意赛",
    description: "知识资产沉淀",
    goal: "完成复赛作品"
  };

  it("should use deterministic mock when LLM_MODE is mock", async () => {
    process.env.LLM_MODE = "mock";
    const res = await structureCaptureWithMeta({
      project,
      rawText: "今天完成了消融对比实验，结果符合预期。",
      historyKeywords: []
    });

    expect(res.status).toBe("SUCCESS");
    expect(res.provider).toBe("mock");
    expect(res.fallbackReason).toBeNull();
    expect(res.data.title).toBeTruthy();
    expect(res.data.keywords.length).toBeGreaterThan(0);
  });

  it("should gracefully fallback to mock and log reason when LLM call fails or times out", async () => {
    process.env.LLM_MODE = "openai-compatible";
    process.env.LLM_BASE_URL = "http://127.0.0.1:9999/v1"; // Invalid endpoint
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_MODEL_NAME = "gpt-4o-mini";
    process.env.LLM_TIMEOUT_MS = "100";

    const res = await structureCaptureWithMeta({
      project,
      rawText: "讨论了初赛汇报 PPT 的框架与论据组织。",
      historyKeywords: []
    });

    expect(res.status).toBe("FALLBACK");
    expect(res.provider).toBe("mock-fallback");
    expect(res.fallbackReason).toBeTruthy();
    expect(res.data.title).toBeTruthy();
  });
});
