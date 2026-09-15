import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { buildTemporalTimeline } from "@/lib/memory/temporalLedger";
import {
  confirmTemporalRelation,
  createTemporalRelationProposal,
  loadTemporalProject,
  revokeTemporalRelation,
} from "@/lib/repositories/temporalRelations";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";
import type {
  TemporalCardSummary,
  TemporalRelationData,
  TemporalTimelineResponse,
} from "@/lib/types";
import type { TemporalRelationProposalInput } from "@/lib/validation/schemas";

function ensureEnabled() {
  if (!isFeatureEnabled("TEMPORAL_MEMORY_ENABLED", true)) {
    throw new AppError("TEMPORAL_MEMORY_DISABLED", "时态证据账本当前已关闭", 503);
  }
}

function serializeCard(card: { id: string; title: string; summary: string; createdAt: Date }): TemporalCardSummary {
  return { ...card, createdAt: card.createdAt.toISOString() };
}

export function serializeTemporalRelation(relation: {
  id: string;
  relationType: string;
  reason: string;
  confidence: number | null;
  confirmed: boolean;
  confirmedAt: Date | null;
  revokedAt: Date | null;
  validFrom: Date | null;
  validTo: Date | null;
  createdAt: Date;
  currentCard: { id: string; title: string; summary: string; createdAt: Date };
  relatedCard: { id: string; title: string; summary: string; createdAt: Date };
}): TemporalRelationData {
  return {
    id: relation.id,
    relationType: relation.relationType as TemporalRelationData["relationType"],
    reason: relation.reason,
    confidence: relation.confidence,
    confirmed: relation.confirmed,
    confirmedAt: relation.confirmedAt?.toISOString() ?? null,
    revokedAt: relation.revokedAt?.toISOString() ?? null,
    validFrom: relation.validFrom?.toISOString() ?? null,
    validTo: relation.validTo?.toISOString() ?? null,
    createdAt: relation.createdAt.toISOString(),
    currentCard: serializeCard(relation.currentCard),
    relatedCard: serializeCard(relation.relatedCard),
  };
}

export async function getDecisionTimeline(projectId: string, asOf = new Date()): Promise<TemporalTimelineResponse> {
  if (Number.isNaN(asOf.getTime())) throw new AppError("INVALID_AS_OF", "时间点格式无效", 422);
  const enabled = isFeatureEnabled("TEMPORAL_MEMORY_ENABLED", true);
  const { cards, relations } = await loadTemporalProject(projectId);
  const serializedCards = cards.map(serializeCard);
  const serializedRelations = enabled ? relations.map(serializeTemporalRelation) : [];
  const items = buildTemporalTimeline(serializedCards, serializedRelations, asOf);

  // 人工确认来源是声明性注记：不改变时态状态，仅随时间线展示
  if (items.length > 0) {
    const events = await db.memoryLifecycleEvent.findMany({
      where: { projectId, eventType: "CONFIRM", cardId: { in: items.map((item) => item.card.id) } },
      orderBy: { createdAt: "desc" },
      select: { cardId: true, createdAt: true },
    });
    const confirmedAt = new Map<string, string>();
    for (const event of events) {
      if (!confirmedAt.has(event.cardId)) confirmedAt.set(event.cardId, event.createdAt.toISOString());
    }
    for (const item of items) {
      item.confirmedSourceAt = confirmedAt.get(item.card.id) ?? null;
    }
  }

  return {
    projectId,
    asOf: asOf.toISOString(),
    enabled,
    items,
  };
}

export async function getTemporalSearchStates(projectId: string, cardIds: string[], asOf = new Date()) {
  if (!isFeatureEnabled("TEMPORAL_MEMORY_ENABLED", true) || cardIds.length === 0) return new Map();
  const timeline = await getDecisionTimeline(projectId, asOf);
  return new Map(timeline.items.filter((item) => cardIds.includes(item.card.id)).map((item) => [item.card.id, item]));
}

export async function proposeTemporalRelation(projectId: string, cardId: string, input: TemporalRelationProposalInput) {
  ensureEnabled();
  const relation = serializeTemporalRelation(await createTemporalRelationProposal(projectId, cardId, input));
  const stateRefreshPending = await refreshProjectStateAfterMutation(projectId);
  return { ...relation, stateRefreshPending };
}

export async function confirmRelation(projectId: string, relationId: string) {
  ensureEnabled();
  const relation = serializeTemporalRelation(await confirmTemporalRelation(projectId, relationId));
  await refreshProjectStateAfterMutation(projectId);
  return relation;
}

export async function revokeRelation(projectId: string, relationId: string) {
  ensureEnabled();
  const relation = serializeTemporalRelation(await revokeTemporalRelation(projectId, relationId));
  await refreshProjectStateAfterMutation(projectId);
  return relation;
}
