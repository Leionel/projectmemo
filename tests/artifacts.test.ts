import { describe, expect, it } from "vitest";
import { generateMockArtifact } from "@/lib/generators/templates";
import { artifactTypes } from "@/lib/types";
import { createMockCard } from "@/lib/agent/mockAgent";

describe("artifact templates", () => {
  const context = {
    project: { title: "测试项目", description: "一个用于验证成果生成的项目。", goal: "完成可演示 MVP" },
    cards: [createMockCard("风险：开发时间不够，需要保证 MVP 闭环。"), createMockCard("初赛需要准备 README 和 PPT 文档。")],
  };

  it.each(artifactTypes)("generates useful Chinese content for %s", (type) => {
    const content = generateMockArtifact(type, context);
    expect(content).toContain("测试项目");
    expect(content.length).toBeGreaterThan(120);
    expect(content).not.toContain("TODO");
  });
});
