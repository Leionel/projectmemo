import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import type { MemoryLifecycleEvent, MemoryLifecycleEventType, Prisma } from "@/lib/generated/prisma/client";

export type LifecycleActor = string;

export interface LifecycleActionInput {
  reason?: string;
  actor?: LifecycleActor;
}

export type { MemoryLifecycleEventType };

function normalizeReason(reason?: string): string | null {
  const trimmed = reason?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 200) : null;
}

async function requireCard(projectId: string, cardId: string) {
  const card = await db.knowledgeCard.findFirst({ where: { id: cardId, projectId } });
  if (!card) throw new AppError("CARD_NOT_FOUND", "记忆卡片不存在或不属于当前项目", 404);
  return card;
}

/**
 * 单条记忆的人工确认来源。这是“来源声明”：记录谁在何时确认了这条记录，
 * 不虚构 SUPPORTS 关系，也不自动把该事实升级为已证明。
 */
export async function confirmCardFact(projectId: string, cardId: string, input: LifecycleActionInput = {}) {
  await requireCard(projectId, cardId);
  return db.$transaction(async (tx) => {
    return tx.memoryLifecycleEvent.create({
      data: {
        projectId,
        cardId,
        eventType: "CONFIRM",
        reason: normalizeReason(input.reason),
        actor: input.actor ?? "user",
      },
    });
  });
}

/** 归档：可恢复的检索/展示偏好，与时间有效性正交；不影响关系与历史快照 */
export async function archiveCard(projectId: string, cardId: string, input: LifecycleActionInput = {}) {
  return db.$transaction(async (tx) => {
    const card = await tx.knowledgeCard.findFirst({ where: { id: cardId, projectId } });
    if (!card) throw new AppError("CARD_NOT_FOUND", "记忆卡片不存在或不属于当前项目", 404);
    const now = new Date();
    const updated = await tx.knowledgeCard.update({
      where: { id: card.id },
      data: { archivedAt: card.archivedAt ?? now },
    });
    await tx.memoryLifecycleEvent.create({
      data: {
        projectId,
        cardId,
        eventType: "ARCHIVE",
        reason: normalizeReason(input.reason),
        actor: input.actor ?? "user",
      },
    });
    return updated;
  });
}

/** 恢复归档卡片；不改变其时态状态 */
export async function restoreCard(projectId: string, cardId: string, input: LifecycleActionInput = {}) {
  return db.$transaction(async (tx) => {
    const card = await tx.knowledgeCard.findFirst({ where: { id: cardId, projectId } });
    if (!card) throw new AppError("CARD_NOT_FOUND", "记忆卡片不存在或不属于当前项目", 404);
    const updated = await tx.knowledgeCard.update({
      where: { id: card.id },
      data: { archivedAt: null },
    });
    await tx.memoryLifecycleEvent.create({
      data: {
        projectId,
        cardId,
        eventType: "RESTORE",
        reason: normalizeReason(input.reason),
        actor: input.actor ?? "user",
      },
    });
    return updated;
  });
}

export function serializeLifecycleEvent(event: MemoryLifecycleEvent) {
  return {
    id: event.id,
    projectId: event.projectId,
    cardId: event.cardId,
    eventType: event.eventType as MemoryLifecycleEventType,
    reason: event.reason,
    actor: event.actor,
    relationId: event.relationId,
    createdAt: event.createdAt.toISOString(),
  };
}

export async function listLifecycleEvents(
  projectId: string,
  cardId: string,
  options: { take?: number } = {},
) {
  await requireCard(projectId, cardId);
  const events = await db.memoryLifecycleEvent.findMany({
    where: { projectId, cardId },
    orderBy: { createdAt: "desc" },
    take: Math.min(options.take ?? 50, 200),
  });
  return events.map(serializeLifecycleEvent);
}

/** 供关系确认/撤销在同一个事务内写入审计事件使用 */
export async function recordLifecycleEventInTx(
  tx: Prisma.TransactionClient,
  data: {
    projectId: string;
    cardId: string;
    eventType: MemoryLifecycleEventType;
    reason?: string | null;
    actor?: string;
    relationId?: string | null;
  },
) {
  await tx.memoryLifecycleEvent.create({
    data: {
      projectId: data.projectId,
      cardId: data.cardId,
      eventType: data.eventType,
      reason: normalizeReason(data.reason ?? undefined),
      actor: data.actor ?? "user",
      relationId: data.relationId ?? null,
    },
  });
}
