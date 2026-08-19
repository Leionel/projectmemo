import { describe, expect, it } from "vitest";
import { linkRelatedCards } from "@/lib/memory/linker";
import { createMockCard } from "@/lib/agent/mockAgent";

describe("keyword linker", () => {
  it("ranks cards by shared keyword count and ignores zero overlap", () => {
    const draft = createMockCard("RAG 检索和知识库切片需要优化");
    const links = linkRelatedCards(draft, [
      { id: "a", title: "RAG 问题", keywords: ["RAG", "检索", "切片"] },
      { id: "b", title: "检索笔记", keywords: ["检索"] },
      { id: "c", title: "会议记录", keywords: ["老师建议"] },
    ]);
    expect(links.map((item) => item.relatedCardId)).toEqual(["a", "b"]);
    expect(links[0].reason).toContain("RAG");
    expect(links[0].score).toBe(3);
  });
});
