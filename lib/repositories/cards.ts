import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CardDraft, CardLink, LinkableCard } from "@/lib/types";
import type { KnowledgeType } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import type { KnowledgeCardUpdateInput } from "@/lib/validation/schemas";

export async function loadRecentCards(projectId: string, limit = 50): Promise<LinkableCard[]> {
  const cards = await db.knowledgeCard.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, title: true, keywords: true },
  });
  return cards.map((card) => ({ ...card, keywords: card.keywords as string[] }));
}

export async function saveCaptureResult(input: {
  projectId: string;
  rawText: string;
  sourceType?: string | null;
  draft: CardDraft;
  links: CardLink[];
}) {
  const captureId = randomUUID();
  const cardId = randomUUID();
  return db.$transaction(async (tx) => {
    await tx.capture.create({
      data: { id: captureId, projectId: input.projectId, rawText: input.rawText, sourceType: input.sourceType },
    });
    const card = await tx.knowledgeCard.create({
      data: {
        id: cardId,
        projectId: input.projectId,
        captureId,
        type: input.draft.type as KnowledgeType,
        title: input.draft.title,
        summary: input.draft.summary,
        keywords: input.draft.keywords,
        relatedTasks: input.draft.relatedTasks,
        nextActions: input.draft.nextActions,
        importance: input.draft.importance,
      },
    });
    if (input.links.length) {
      await tx.cardRelation.createMany({
        data: input.links.map((link) => ({
          currentCardId: cardId,
          relatedCardId: link.relatedCardId,
          reason: link.reason,
          score: link.score,
        })),
      });
    }
    await tx.project.update({ where: { id: input.projectId }, data: { updatedAt: new Date() } });
    return { ...card, relations: input.links };
  });
}

export async function updateKnowledgeCard(projectId: string, cardId: string, input: KnowledgeCardUpdateInput) {
  return db.$transaction(async (tx) => {
    const card = await tx.knowledgeCard.findFirst({ where: { id: cardId, projectId } });
    if (!card) throw new AppError("CARD_NOT_FOUND", "没有找到这个项目中的知识卡片", 404);

    const updated = await tx.knowledgeCard.update({
      where: { id: cardId },
      data: {
        ...(input.type !== undefined ? { type: input.type as KnowledgeType } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
        ...(input.relatedTasks !== undefined ? { relatedTasks: input.relatedTasks } : {}),
        ...(input.nextActions !== undefined ? { nextActions: input.nextActions } : {}),
        ...(input.importance !== undefined ? { importance: input.importance } : {}),
      },
    });
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    return updated;
  });
}

export async function deleteKnowledgeCard(projectId: string, cardId: string) {
  return db.$transaction(async (tx) => {
    const card = await tx.knowledgeCard.findFirst({
      where: { id: cardId, projectId },
      select: { captureId: true },
    });
    if (!card) throw new AppError("CARD_NOT_FOUND", "没有找到这个项目中的知识卡片", 404);

    await tx.capture.delete({ where: { id: card.captureId } });
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
  });
}
