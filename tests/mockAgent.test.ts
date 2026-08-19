import { describe, expect, it } from "vitest";
import { classifyRawText, createMockCard, extractKeywords } from "@/lib/agent/mockAgent";

describe("mock agent", () => {
  it("uses stable high-signal classification priority", () => {
    expect(classifyRawText("风险：baseline 实验来不及完成")).toBe("risk");
    expect(classifyRawText("运行失败 traceback，模型加载报错")).toBe("code_issue");
    expect(classifyRawText("准确率下降，需要对比 baseline")).toBe("experiment_log");
    expect(classifyRawText("老师建议组会后调整定位")).toBe("meeting_note");
    expect(classifyRawText("初赛需要准备作品介绍文档")).toBe("requirement");
    expect(classifyRawText("复赛阶段可能需要演示视频和源代码")).toBe("requirement");
    expect(classifyRawText("需要设计一个主动提醒模块")).toBe("task");
    expect(classifyRawText("今天阅读了一篇模型论文")).toBe("paper_note");
  });

  it("creates a valid and deterministic card", () => {
    const card = createMockCard("RAG 检索效果不稳定，可能是知识切片粒度太粗。" );
    expect(card.type).toBe("risk");
    expect(card.keywords).toContain("RAG");
    expect(card.nextActions.length).toBeGreaterThan(0);
    expect(card.importance).toBe(5);
  });

  it("deduplicates and limits keywords", () => {
    const words = extractKeywords("RAG RAG Agent Memory 检索 知识库 切片 召回 baseline Demo MVP README");
    expect(new Set(words).size).toBe(words.length);
    expect(words.length).toBeLessThanOrEqual(6);
  });
});
