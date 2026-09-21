process.env.PROJECT_MEMORY_CONSOLIDATION_ENABLED = "1";
process.env.TEMPORAL_MEMORY_ENABLED = "1";

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  confirmConsolidation,
  listConsolidationProposals,
  listConsolidationReceipts,
  revokeConsolidation,
  similarityScore,
} from "@/lib/services/memoryConsolidationService";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import { proposeTemporalRelation, confirmRelation } from "@/lib/services/temporalLedgerService";

const createdProjectIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) {
    await db.project.delete({ where: { id } }).catch(() => {});
  }
});

async function newProject(title: string) {
  const project = await db.project.create({
    data: { title, description: "归并测试", goal: "R2 归并验收", scenario: "RESEARCH" },
  });
  createdProjectIds.push(project.id);
  return project;
}

async function seedCard(projectId: string, title: string, summary: string, importance = 3) {
  const capture = await db.capture.create({ data: { projectId, rawText: `${title}\n${summary}`, sourceType: "测试" } });
  return db.knowledgeCard.create({
    data: {
      projectId,
      captureId: capture.id,
      type: "experiment_log",
      title,
      summary,
      keywords: [],
      relatedTasks: [],
      nextActions: [],
      importance,
    },
  });
}

describe("memory consolidation (可撤销归并)", () => {
  it("scores near-duplicate text higher than unrelated text", () => {
    const dup = similarityScore("召回率实验结论\n切片粒度调优后召回率提升到78%", "召回率实验结论\n切片粒度调优后召回率提升到 78%");
    const unrelated = similarityScore("召回率实验结论\n切片粒度调优后召回率提升到78%", "下周答辩安排\n准备演示脚本与分工");
    expect(dup).toBeGreaterThan(0.8);
    expect(unrelated).toBeLessThan(0.2);
  });

  it("proposes merges, archives duplicates on confirm, and keeps originals recoverable", async () => {
    const project = await newProject("归并确认与撤销");
    const master = await seedCard(project.id, "召回率实验结论", "切片粒度调优后召回率提升到 78%", 4);
    const duplicate = await seedCard(project.id, "召回率实验结论", "切片粒度调优后召回率提升到78%", 2);

    const proposals = await listConsolidationProposals(project.id);
    const proposal = proposals.find((item) => item.masterCardId === master.id);
    expect(proposal).toBeTruthy();
    expect(proposal!.cards.map((card) => card.id).sort()).toEqual([duplicate.id, master.id].sort());
    expect(proposal!.mergedPreview).toContain("合并自");
    expect(proposal!.preservedSources.length).toBeGreaterThan(0);

    const receipt = await confirmConsolidation(project.id, {
      masterCardId: master.id,
      mergedCardIds: [duplicate.id],
      reason: "同一条实验结论重复记录",
      requestId: `merge-${project.id}`,
      similarityScore: proposal!.similarityScore,
    });
    expect(receipt.status).toBe("ACTIVE");
    expect(receipt.mergedCardIds).toEqual([duplicate.id]);

    // 原始 Capture、关系与历史都不删除：只标记归档
    const archived = await db.knowledgeCard.findUniqueOrThrow({ where: { id: duplicate.id } });
    expect(archived.archivedAt).not.toBeNull();
    const captureStillThere = await db.capture.findUniqueOrThrow({ where: { id: archived.captureId } });
    expect(captureStillThere.rawText).toContain("召回率");
    const lifecycle = await db.memoryLifecycleEvent.findMany({ where: { cardId: duplicate.id, eventType: "ARCHIVE" } });
    expect(lifecycle.some((event) => event.reason === `merge_receipt:${receipt.id}`)).toBe(true);

    // 搜索默认突出归并后的当前记录
    const results = await searchProjectCards({ projectId: project.id, query: "召回率 切片粒度" });
    expect(results.some((item) => item.cardId === master.id)).toBe(true);
    expect(results.some((item) => item.cardId === duplicate.id)).toBe(false);

    // 同 requestId 重放返回同一回执
    const replay = await confirmConsolidation(project.id, {
      masterCardId: master.id,
      mergedCardIds: [duplicate.id],
      requestId: `merge-${project.id}`,
    });
    expect(replay.id).toBe(receipt.id);
    expect(await db.memoryMergeReceipt.count({ where: { projectId: project.id } })).toBe(1);

    const different = await seedCard(project.id, "另一条重复候选", "不应复用同一个请求标识");
    await expect(confirmConsolidation(project.id, {
      masterCardId: master.id,
      mergedCardIds: [different.id],
      requestId: `merge-${project.id}`,
    })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED", status: 409 });

    // 撤销：恢复归档，回执标记 REVOKED
    const revoked = await revokeConsolidation(project.id, receipt.id);
    expect(revoked.status).toBe("REVOKED");
    const restored = await db.knowledgeCard.findUniqueOrThrow({ where: { id: duplicate.id } });
    expect(restored.archivedAt).toBeNull();
    const resultsAfter = await searchProjectCards({ projectId: project.id, query: "召回率 切片粒度" });
    expect(resultsAfter.some((item) => item.cardId === duplicate.id)).toBe(true);

    const receipts = await listConsolidationReceipts(project.id);
    expect(receipts).toHaveLength(1);
    expect(receipts[0].status).toBe("REVOKED");
  });

  it("does not merge an already archived card", async () => {
    const project = await newProject("已归档记录不归并");
    const master = await seedCard(project.id, "主记录", "相同内容");
    const archived = await seedCard(project.id, "重复记录", "相同内容");
    await db.knowledgeCard.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });

    await expect(confirmConsolidation(project.id, {
      masterCardId: master.id,
      mergedCardIds: [archived.id],
      requestId: `archived-${project.id}`,
    })).rejects.toMatchObject({ code: "MERGED_CARD_ARCHIVED", status: 409 });
    expect(await db.memoryMergeReceipt.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("does not undo a later explicit archive when revoking a merge", async () => {
    const project = await newProject("撤销不覆盖后续操作");
    const master = await seedCard(project.id, "归并主记录", "重复内容");
    const duplicate = await seedCard(project.id, "归并重复记录", "重复内容");
    const receipt = await confirmConsolidation(project.id, {
      masterCardId: master.id,
      mergedCardIds: [duplicate.id],
      requestId: `later-archive-${project.id}`,
    });
    await db.memoryLifecycleEvent.create({
      data: {
        projectId: project.id,
        cardId: duplicate.id,
        eventType: "ARCHIVE",
        reason: "用户随后明确保留归档",
        actor: "user",
        createdAt: new Date(Date.now() + 1_000),
      },
    });

    await revokeConsolidation(project.id, receipt.id);
    expect((await db.knowledgeCard.findUniqueOrThrow({ where: { id: duplicate.id } })).archivedAt).not.toBeNull();
  });

  it("never proposes or merges cards linked by supersede relations", async () => {
    const project = await newProject("取代关系不归并");
    const older = await seedCard(project.id, "方案A可行性结论", "方案A在当前数据上可行，准备继续推进");
    const newer = await seedCard(project.id, "方案A可行性结论", "方案A在当前数据上可行，准备继续推进");

    // SUPERSEDES 让旧卡变为 SUPERSEDED（而非争议）：正好覆盖「已确认关系不允许静默归并」分支
    const relation = await proposeTemporalRelation(project.id, newer.id, {
      relatedCardId: older.id,
      relationType: "SUPERSEDES",
      reason: "复测后改用新方案",
    });
    await confirmRelation(project.id, relation.id);

    const proposals = await listConsolidationProposals(project.id);
    expect(proposals.some((item) => item.masterCardId === older.id || item.masterCardId === newer.id)).toBe(false);

    await expect(confirmConsolidation(project.id, {
      masterCardId: newer.id,
      mergedCardIds: [older.id],
      requestId: `conflict-${project.id}`,
    })).rejects.toMatchObject({ code: "CONSOLIDATION_CONFLICT", status: 409 });

    const untouched = await db.knowledgeCard.findUniqueOrThrow({ where: { id: older.id } });
    expect(untouched.archivedAt).toBeNull();
  });

  it("keeps consolidation scoped to a single project", async () => {
    const projectA = await newProject("归并项目A");
    const projectB = await newProject("归并项目B");
    const cardA = await seedCard(projectA.id, "A项目重复记录", "同一条事实在A项目里出现两次");
    const duplicateA = await seedCard(projectA.id, "A项目重复记录", "同一条事实在A项目里出现两次");
    const cardB = await seedCard(projectB.id, "B项目记录", "B项目的独立事实");

    const proposalsB = await listConsolidationProposals(projectB.id);
    expect(proposalsB.some((item) => item.cards.some((card) => card.id === cardA.id))).toBe(false);

    await expect(confirmConsolidation(projectB.id, {
      masterCardId: cardB.id,
      mergedCardIds: [duplicateA.id],
      requestId: `cross-${projectB.id}`,
    })).rejects.toMatchObject({ code: "CARD_NOT_FOUND", status: 404 });

    const receipt = await confirmConsolidation(projectA.id, {
      masterCardId: cardA.id,
      mergedCardIds: [duplicateA.id],
      requestId: `cross-${projectA.id}`,
    });
    expect(receipt.projectId).toBe(projectA.id);
    await expect(revokeConsolidation(projectB.id, receipt.id)).rejects.toMatchObject({ code: "MERGE_RECEIPT_NOT_FOUND" });
  });
});
