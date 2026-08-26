import { describe, it, expect } from "vitest";
import { cosineSimilarity, generateDeterministicEmbedding } from "@/lib/memory/embedding";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import { db } from "@/lib/db";

describe("S04: Hybrid Search and Card Embeddings", () => {
  it("should calculate cosine similarity accurately", () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const vecC = [0, 1, 0];

    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 5);
    expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0, 5);
  });

  it("should generate deterministic normalized embeddings", () => {
    const text1 = "Agent Memory 长期记忆";
    const text2 = "Agent Memory 长期记忆";
    const text3 = "完全不相干的做菜菜谱";

    const emb1 = generateDeterministicEmbedding(text1);
    const emb2 = generateDeterministicEmbedding(text2);
    const emb3 = generateDeterministicEmbedding(text3);

    expect(emb1).toEqual(emb2);
    const simSame = cosineSimilarity(emb1, emb2);
    const simDiff = cosineSimilarity(emb1, emb3);

    expect(simSame).toBeCloseTo(1.0, 4);
    expect(simSame).toBeGreaterThan(simDiff);
  });

  it("should return ranked results with explainable reasons in hybrid search", async () => {
    const testProject = await db.project.create({
      data: {
        title: "Hybrid Search Test Project",
        description: "Testing hybrid ranking",
        goal: "Verify recall and scoring",
        scenario: "COMPETITION",
      },
    });

    try {
      // 创建 2 张测试卡片
      const capture1 = await db.capture.create({
        data: { projectId: testProject.id, rawText: "关于 Agent Episodic Memory 和 Semantic Memory 的架构设计" },
      });
      await db.knowledgeCard.create({
        data: {
          projectId: testProject.id,
          captureId: capture1.id,
          type: "paper_note",
          title: "Agent 记忆体系论文精读",
          summary: "区分了情节记忆与语义记忆的存储形式和召回策略",
          keywords: ["Agent", "Memory", "论文", "语义记忆"],
          relatedTasks: [],
          nextActions: [],
          importance: 5,
        },
      });

      const capture2 = await db.capture.create({
        data: { projectId: testProject.id, rawText: "明天组会准备 PPT 讲稿" },
      });
      await db.knowledgeCard.create({
        data: {
          projectId: testProject.id,
          captureId: capture2.id,
          type: "meeting_note",
          title: "周例会讨论要点",
          summary: "讨论答辩准备情况",
          keywords: ["组会", "PPT"],
          relatedTasks: [],
          nextActions: [],
          importance: 3,
        },
      });

      const results = await searchProjectCards({
        projectId: testProject.id,
        query: "记忆架构与语义召回",
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe("Agent 记忆体系论文精读");
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].reason).toBeTruthy();
      expect(results[0].retrievalMode).toBe("keyword_fallback");
      expect(results.every((result) => result.semanticScore === 0)).toBe(true);
      expect(results.every((result) => result.source === "Keyword + metadata index")).toBe(true);
    } finally {
      await db.project.delete({ where: { id: testProject.id } });
    }
  });
});
