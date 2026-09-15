import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { CardDraft, CardLink, LinkableCard } from "@/lib/types";
import { Prisma, type KnowledgeType } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import type { KnowledgeCardUpdateInput } from "@/lib/validation/schemas";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";

export function normalizeKeywords(keywords: unknown): string[] {
  if (Array.isArray(keywords)) {
    return keywords.map((k) => String(k).trim()).filter(Boolean);
  }
  if (typeof keywords === "string") {
    const trimmed = keywords.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((k) => String(k).trim()).filter(Boolean);
        }
      } catch {
        // ignore
      }
    }
    if (trimmed.length > 0) {
      return trimmed.split(/[,，、;\s]+/).map((k) => k.trim()).filter(Boolean);
    }
  }
  return [];
}

export async function loadRecentCards(projectId: string, limit = 50): Promise<LinkableCard[]> {
  const cards = await db.knowledgeCard.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, title: true, keywords: true },
  });
  return cards.map((card) => ({ ...card, keywords: normalizeKeywords(card.keywords) }));
}

export async function saveCaptureResult(
  input: {
    projectId: string;
    rawText: string;
    sourceType?: string | null;
    /** 客户端幂等身份；NULL 保持旧调用方可写入。 */
    requestId?: string | null;
    /** requestId 对应的规范化 payload 摘要，用于冲突检测。 */
    requestHash?: string | null;
    draft: CardDraft;
    links: CardLink[];
    /** 附件纠错等场景：卡与附件关联在同事务内写入 */
    attachmentId?: string | null;
  },
  /** 允许调用方传入事务客户端（如附件纠错的修订事务），复用同一份保存逻辑 */
  client: Prisma.TransactionClient = db as unknown as Prisma.TransactionClient,
) {
  const captureId = randomUUID();
  const cardId = randomUUID();
  const save = async (tx: Prisma.TransactionClient) => {
    await tx.capture.create({
      data: {
        id: captureId,
        projectId: input.projectId,
        rawText: input.rawText,
        sourceType: input.sourceType,
        requestId: input.requestId ?? null,
        requestHash: input.requestHash ?? null,
      },
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
        attachmentId: input.attachmentId ?? null,
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
  };
  if (client === (db as unknown as Prisma.TransactionClient)) {
    // 默认路径保持原有的独立事务语义
    return db.$transaction(save);
  }
  return save(client);
}

export async function updateKnowledgeCard(projectId: string, cardId: string, input: KnowledgeCardUpdateInput) {
  const updated = await db.$transaction(async (tx) => {
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
  const stateRefreshPending = await refreshProjectStateAfterMutation(projectId);
  return { ...updated, stateRefreshPending };
}

export async function deleteKnowledgeCard(projectId: string, cardId: string) {
  await db.$transaction(async (tx) => {
    const card = await tx.knowledgeCard.findFirst({
      where: { id: cardId, projectId },
      select: { captureId: true },
    });
    if (!card) throw new AppError("CARD_NOT_FOUND", "没有找到这个项目中的知识卡片", 404);

    await tx.capture.delete({ where: { id: card.captureId } });
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
  });
  await refreshProjectStateAfterMutation(projectId);
}
