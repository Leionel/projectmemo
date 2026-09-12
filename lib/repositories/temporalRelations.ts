import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { wouldCreateSupersessionCycle } from "@/lib/memory/temporalLedger";
import { recordLifecycleEventInTx } from "@/lib/services/memoryLifecycleService";
import type { TemporalRelationProposalInput } from "@/lib/validation/schemas";
import type { CardRelationType } from "@/lib/generated/prisma/client";

const cardSummarySelect = { id: true, title: true, summary: true, createdAt: true } as const;

export async function loadTemporalProject(projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      cards: { select: cardSummarySelect, orderBy: { createdAt: "desc" } },
    },
  });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "没有找到这个项目", 404);
  const relations = await db.cardRelation.findMany({
    where: {
      currentCard: { projectId },
      relatedCard: { projectId },
    },
    include: {
      currentCard: { select: cardSummarySelect },
      relatedCard: { select: cardSummarySelect },
    },
    orderBy: { createdAt: "desc" },
  });
  return { cards: project.cards, relations };
}

async function assertRelationCards(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  projectId: string,
  currentCardId: string,
  relatedCardId: string,
) {
  if (currentCardId === relatedCardId) {
    throw new AppError("RELATION_SELF_LOOP", "一张卡片不能与自身建立时态关系", 409);
  }
  const cards = await tx.knowledgeCard.findMany({
    where: { id: { in: [currentCardId, relatedCardId] }, projectId },
    select: { id: true },
  });
  if (cards.length !== 2) {
    throw new AppError("RELATION_CARD_NOT_FOUND", "关系两端必须属于当前项目", 404);
  }
}

async function assertNoSupersessionCycle(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  currentCardId: string,
  relatedCardId: string,
  excludeRelationId?: string,
) {
  const relations = await tx.cardRelation.findMany({
    where: {
      relationType: "SUPERSEDES",
      revokedAt: null,
      ...(excludeRelationId ? { id: { not: excludeRelationId } } : {}),
    },
    select: { currentCardId: true, relatedCardId: true },
  });
  if (wouldCreateSupersessionCycle(relations, currentCardId, relatedCardId)) {
    throw new AppError("SUPERSESSION_CYCLE", "取代关系不能形成环", 409);
  }
}

export async function createTemporalRelationProposal(
  projectId: string,
  currentCardId: string,
  input: TemporalRelationProposalInput,
) {
  return db.$transaction(async (tx) => {
    await assertRelationCards(tx, projectId, currentCardId, input.relatedCardId);
    const duplicate = await tx.cardRelation.findFirst({
      where: {
        currentCardId,
        relatedCardId: input.relatedCardId,
        relationType: input.relationType as CardRelationType,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError("RELATION_ALREADY_EXISTS", "这两张卡片已有同类型的生效或待确认关系", 409);
    }
    if (input.relationType === "SUPERSEDES") {
      await assertNoSupersessionCycle(tx, currentCardId, input.relatedCardId);
    }
    return tx.cardRelation.create({
      data: {
        currentCardId,
        relatedCardId: input.relatedCardId,
        relationType: input.relationType as CardRelationType,
        reason: input.reason,
        score: Math.round((input.confidence ?? 0) * 100),
        confidence: input.confidence ?? null,
        confirmed: false,
        validFrom: input.validFrom ? new Date(input.validFrom) : null,
        validTo: input.validTo ? new Date(input.validTo) : null,
      },
      include: {
        currentCard: { select: cardSummarySelect },
        relatedCard: { select: cardSummarySelect },
      },
    });
  });
}

export async function confirmTemporalRelation(projectId: string, relationId: string) {
  return db.$transaction(async (tx) => {
    const relation = await tx.cardRelation.findFirst({
      where: { id: relationId, currentCard: { projectId }, relatedCard: { projectId } },
      include: {
        currentCard: { select: cardSummarySelect },
        relatedCard: { select: cardSummarySelect },
      },
    });
    if (!relation) throw new AppError("RELATION_NOT_FOUND", "没有找到这个项目中的关系", 404);
    if (relation.revokedAt) throw new AppError("RELATION_REVOKED", "已撤销的关系不能重新确认，请新建提议", 409);
    if (relation.confirmed) return relation;
    if (relation.relationType === "SUPERSEDES") {
      await assertNoSupersessionCycle(tx, relation.currentCardId, relation.relatedCardId, relation.id);
    }
    const now = new Date();
    const updated = await tx.cardRelation.update({
      where: { id: relation.id },
      data: { confirmed: true, confirmedAt: now, validFrom: relation.validFrom ?? now },
      include: {
        currentCard: { select: cardSummarySelect },
        relatedCard: { select: cardSummarySelect },
      },
    });
    // 事件与业务变更同事务提交：确认、撤销必须可追踪
    await recordLifecycleEventInTx(tx, {
      projectId,
      cardId: relation.currentCardId,
      eventType: "RELATION_CONFIRM",
      reason: relation.reason,
      relationId: relation.id,
    });
    await recordLifecycleEventInTx(tx, {
      projectId,
      cardId: relation.relatedCardId,
      eventType: "RELATION_CONFIRM",
      reason: relation.reason,
      relationId: relation.id,
    });
    return updated;
  });
}

export async function revokeTemporalRelation(projectId: string, relationId: string) {
  return db.$transaction(async (tx) => {
    const relation = await tx.cardRelation.findFirst({
      where: { id: relationId, currentCard: { projectId }, relatedCard: { projectId } },
      include: {
        currentCard: { select: cardSummarySelect },
        relatedCard: { select: cardSummarySelect },
      },
    });
    if (!relation) throw new AppError("RELATION_NOT_FOUND", "没有找到这个项目中的关系", 404);
    if (relation.revokedAt) return relation;
    const now = new Date();
    const updated = await tx.cardRelation.update({
      where: { id: relation.id },
      data: {
        revokedAt: now,
        validTo: relation.validTo && relation.validTo < now ? relation.validTo : now,
      },
      include: {
        currentCard: { select: cardSummarySelect },
        relatedCard: { select: cardSummarySelect },
      },
    });
    await recordLifecycleEventInTx(tx, {
      projectId,
      cardId: relation.currentCardId,
      eventType: "RELATION_REVOKE",
      reason: relation.reason,
      relationId: relation.id,
    });
    await recordLifecycleEventInTx(tx, {
      projectId,
      cardId: relation.relatedCardId,
      eventType: "RELATION_REVOKE",
      reason: relation.reason,
      relationId: relation.id,
    });
    return updated;
  });
}
