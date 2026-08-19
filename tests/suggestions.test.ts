import { describe, expect, it, vi } from "vitest";
import { generateSuggestions } from "@/lib/suggestions";

describe("proactive suggestions", () => {
  it("prioritizes risks and close deadlines", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-11T00:00:00Z"));
    const suggestions = generateSuggestions({ cards: [{ type: "risk" }, { type: "task" }, { type: "requirement" }], deadline: new Date("2026-07-20T00:00:00Z") });
    expect(suggestions.map((item) => item.id)).toEqual(expect.arrayContaining(["risks", "deadline", "reflect"]));
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(suggestions.length).toBeLessThanOrEqual(4);
    vi.useRealTimers();
  });

  it("never renders an empty suggestion area", () => {
    const suggestions = generateSuggestions({ cards: [], deadline: null });
    expect(suggestions).toHaveLength(2);
  });

  it("labels expired deadlines with the number of overdue days", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-13T00:00:00Z"));
    const suggestions = generateSuggestions({ cards: [], deadline: new Date("2026-07-10T00:00:00Z") });
    expect(suggestions.find((item) => item.id === "deadline")?.title).toBe("已逾期 3 天");
    vi.useRealTimers();
  });
});
