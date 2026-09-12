import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  archiveCard,
  confirmCardFact,
  listLifecycleEvents,
  restoreCard,
} from "@/lib/services/memoryLifecycleService";
import { confirmTemporalRelation, revokeTemporalRelation } from "@/lib/repositories/temporalRelations";
import { getDecisionTimeline } from "@/lib/services/temporalLedgerService";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import { correctAttachmentText } from "@/lib/services/attachmentService";

describe("Memory lifecycle audit and archive (M1)", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await db.project.create({
      data: {
        title: "记忆生命周期测试项目",
        description: "验证人工确认、关系审计、归档恢复与附件修订链",
        goal: "M1 验收",
        scenario: "COMPETITION",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
  });

  async function seedCard(title: string, summary?: string) {
    const capture = await db.capture.create({
      data: { projectId, rawText: title, sourceType: "测试" },
    });
    return db.knowledgeCard.create({
      data: {
        projectId,
        captureId: capture.id,
        type: "meeting_note",
        title,
        summary: summary ?? `${title} 的摘要`,
        keywords: ["测试"],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
  }

  it("confirms a standalone fact as a source declaration without fabricating SUPPORTS relations", async () => {
    const card = await seedCard("实验场地：低温实验室 B203");
    await confirmCardFact(projectId, card.id, { reason: "已与现场负责同学核对" });

    const events = await listLifecycleEvents(projectId, card.id);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("CONFIRM");
    expect(events[0].reason).toBe("已与现场负责同学核对");
    expect(events[0].actor).toBe("user");

    // 人工确认不虚构 SUPPORTS 关系
    const relations = await db.cardRelation.count({
      where: { currentCardId: card.id, relatedCardId: card.id },
    });
    expect(relations).toBe(0);
  });

  it("rejects lifecycle actions for cards from another project", async () => {
    const other = await db.project.create({
      data: { title: "外部项目", description: "", goal: "", scenario: "COMPETITION" },
    });
    try {
      const capture = await db.capture.create({
        data: { projectId: other.id, rawText: "外部卡片", sourceType: "测试" },
      });
      const foreignCard = await db.knowledgeCard.create({
        data: {
          projectId: other.id,
          captureId: capture.id,
          type: "meeting_note",
          title: "外部卡片",
          summary: "",
          keywords: [],
          relatedTasks: [],
          nextActions: [],
          importance: 1,
        },
      });
      await expect(confirmCardFact(projectId, foreignCard.id)).rejects.toThrow();
      await expect(archiveCard(projectId, foreignCard.id)).rejects.toThrow();
    } finally {
      await db.project.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it("records relation confirm and revoke in the same transaction with relation linkage", async () => {
    const oldCard = await seedCard("方案A：密集模型基线");
    const newCard = await seedCard("方案B：轻量量化管线");

    const relation = await db.cardRelation.create({
      data: {
        currentCardId: newCard.id,
        relatedCardId: oldCard.id,
        relationType: "SUPERSEDES",
        reason: "显存受限切换方案",
        score: 100,
      },
    });

    await confirmTemporalRelation(projectId, relation.id);

    const oldEvents = await listLifecycleEvents(projectId, oldCard.id);
    const newEvents = await listLifecycleEvents(projectId, newCard.id);
    expect(oldEvents.some((e) => e.eventType === "RELATION_CONFIRM" && e.relationId === relation.id)).toBe(true);
    expect(newEvents.some((e) => e.eventType === "RELATION_CONFIRM" && e.relationId === relation.id)).toBe(true);

    await revokeTemporalRelation(projectId, relation.id);
    const revokedEvents = await listLifecycleEvents(projectId, oldCard.id);
    expect(revokedEvents.some((e) => e.eventType === "RELATION_REVOKE" && e.relationId === relation.id)).toBe(true);

    // 已撤销关系不能被再次确认，必须新建提议
    await expect(confirmTemporalRelation(projectId, relation.id)).rejects.toThrow();
  });

  it("surfaces contradiction as CONFLICT instead of silently picking a side", async () => {
    const factCard = await seedCard("实测吞吐：1200 tokens/s");
    const contradicting = await seedCard("另一组记录：实测吞吐 900 tokens/s");

    const relation = await db.cardRelation.create({
      data: {
        currentCardId: contradicting.id,
        relatedCardId: factCard.id,
        relationType: "CONTRADICTS",
        reason: "两次测试结果互相矛盾",
        score: 80,
      },
    });
    await confirmTemporalRelation(projectId, relation.id);

    const timeline = await getDecisionTimeline(projectId);
    const conflicted = timeline.items.find((item) => item.card.id === factCard.id);
    expect(conflicted?.status).toBe("CONFLICT");
  });

  it("archives a card as a display preference without changing temporal validity", async () => {
    const supersededCard = await seedCard("旧口径：周报周五提交");
    const currentCard = await seedCard("新口径：周报周一提交");

    const relation = await db.cardRelation.create({
      data: {
        currentCardId: currentCard.id,
        relatedCardId: supersededCard.id,
        relationType: "SUPERSEDES",
        reason: "提交节奏调整",
        score: 100,
      },
    });
    await confirmTemporalRelation(projectId, relation.id);

    // 归档当前有效决策：不得让被取代的旧决策重新生效
    const archived = await archiveCard(projectId, currentCard.id, { reason: "暂不关注" });
    expect(archived.archivedAt).not.toBeNull();

    const timelineAfterArchive = await getDecisionTimeline(projectId);
    const stillSuperseded = timelineAfterArchive.items.find((item) => item.card.id === supersededCard.id);
    expect(stillSuperseded?.status).toBe("SUPERSEDED");

    // 默认检索不包含已归档卡片
    const searchResults = await searchProjectCards({ projectId, query: "周报", limit: 10, typeFilter: "all" });
    expect(searchResults.some((r) => r.cardId === currentCard.id)).toBe(false);

    await restoreCard(projectId, currentCard.id);
    const restored = await db.knowledgeCard.findUnique({ where: { id: currentCard.id } });
    expect(restored?.archivedAt).toBeNull();

    const events = await listLifecycleEvents(projectId, currentCard.id);
    const archiveIndex = events.findIndex((e) => e.eventType === "ARCHIVE");
    const restoreIndex = events.findIndex((e) => e.eventType === "RESTORE");
    expect(archiveIndex).toBeGreaterThanOrEqual(0);
    expect(restoreIndex).toBeGreaterThanOrEqual(0);
  });

  it("keeps an attachment revision chain instead of overwriting prior extraction text", async () => {
    const capture = await db.capture.create({
      data: { projectId, rawText: "附件原始提取", sourceType: "测试" },
    });
    const attachment = await db.attachment.create({
      data: {
        projectId,
        type: "PDF",
        storageKey: "test/revision.pdf",
        fileName: "实验记录.pdf",
        mimeType: "application/pdf",
        size: 100,
        sha256: "sha-revision-1",
        extractedText: "原始机器提取：温度 300 度",
        extractionStatus: "SUCCESS",
      },
    });
    void capture;

    const first = await correctAttachmentText(projectId, attachment.id, "人工校对：温度 350 度");
    const second = await correctAttachmentText(projectId, attachment.id, "人工校对：温度 355 度");
    expect(first.attachment.extractedText).toContain("350");
    expect(second.attachment.extractedText).toContain("355");

    const revisions = await db.attachmentRevision.findMany({
      where: { attachmentId: attachment.id },
      orderBy: { revisionIndex: "asc" },
    });
    expect(revisions).toHaveLength(3);
    expect(revisions[0].source).toBe("EXTRACTION");
    expect(revisions[0].text).toContain("300 度");
    expect(revisions[1].source).toBe("MANUAL_CORRECTION");
    expect(revisions[1].text).toContain("350");
    expect(revisions[2].text).toContain("355");

    // 旧提取对应的历史卡片被新校对取代，检索不再把旧值当当前值
    const timeline = await getDecisionTimeline(projectId);
    const supersededOld = timeline.items.find((item) => item.card.title.includes("原始机器提取") || item.card.title.includes("附件原始提取"));
    if (supersededOld) {
      expect(supersededOld.status).toBe("SUPERSEDED");
    }
  });
});
