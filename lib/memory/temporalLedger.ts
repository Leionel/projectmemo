import type {
  TemporalCardSummary,
  TemporalDecisionItem,
  TemporalDecisionStatus,
  TemporalEvidenceRef,
  TemporalRelationData,
  TemporalTopLevelState,
  TemporalSupportState,
} from "@/lib/types";

function time(value: string | Date | null): number | null {
  if (value === null) return null;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function isTemporalRelationActive(relation: TemporalRelationData, asOf: Date): boolean {
  const point = asOf.getTime();
  const confirmedAt = time(relation.confirmedAt);
  const revokedAt = time(relation.revokedAt);
  const validFrom = time(relation.validFrom);
  const validTo = time(relation.validTo);
  return relation.confirmed &&
    confirmedAt !== null && confirmedAt <= point &&
    (revokedAt === null || revokedAt > point) &&
    (validFrom === null || validFrom <= point) &&
    (validTo === null || validTo > point);
}

function statusLabel(status: TemporalDecisionStatus): string {
  switch (status) {
    case "CURRENT": return "当前有效";
    case "SUPERSEDED": return "已取代";
    case "CONFLICT": return "存在冲突";
    case "PENDING": return "待确认";
    case "REVOKED": return "已撤销";
    default: return "证据不足";
  }
}

function newest(relations: TemporalRelationData[]): TemporalRelationData | null {
  return [...relations].sort((a, b) => {
    const aTime = time(a.confirmedAt) ?? time(a.createdAt) ?? 0;
    const bTime = time(b.confirmedAt) ?? time(b.createdAt) ?? 0;
    return bTime - aTime;
  })[0] ?? null;
}

function displayReasonFor(
  status: TemporalDecisionStatus,
  relation: TemporalRelationData | null,
): { topLevelState: TemporalTopLevelState; reasonCode: string; displayReason: string } {
  const supplied = relation?.reason?.trim();
  if (status === "CURRENT") {
    return {
      topLevelState: "CURRENT",
      reasonCode: "ACTIVE_SUPPORT",
      displayReason: supplied || "存在已确认且仍在有效期内的支持关系。",
    };
  }
  if (status === "SUPERSEDED") {
    return {
      topLevelState: "SUPERSEDED",
      reasonCode: "SUPERSEDED_BY_CONFIRMED_RELATION",
      displayReason: supplied || "该事实已被已确认的新事实取代。",
    };
  }
  if (status === "CONFLICT") {
    return {
      topLevelState: "CONTESTED",
      reasonCode: "CONTRADICTED_OR_MULTIPLE_SUPERSEDERS",
      displayReason: supplied || "存在冲突或多个取代方向，系统不把其中一方当作已证实结论。",
    };
  }
  if (status === "PENDING") {
    return {
      topLevelState: "CONTESTED",
      reasonCode: "RELATION_PENDING_CONFIRMATION",
      displayReason: supplied || "存在尚未确认的关系，当前结论不能自动升级。",
    };
  }
  if (status === "REVOKED") {
    return {
      topLevelState: "UNKNOWN",
      reasonCode: "RELATION_REVOKED",
      displayReason: supplied || "相关关系已撤销，系统不再据此证明当前事实。",
    };
  }
  return {
    topLevelState: "UNKNOWN",
    reasonCode: "NO_SUPPORTING_EVIDENCE",
    displayReason: supplied || "尚无足够的时态关系证据，当前结论保持未知。",
  };
}

export function evaluateTemporalCard(
  card: TemporalCardSummary,
  relations: TemporalRelationData[],
  asOf: Date,
): TemporalDecisionItem {
  const involved = relations.filter((relation) =>
    relation.currentCard.id === card.id || relation.relatedCard.id === card.id);
  const active = involved.filter((relation) => isTemporalRelationActive(relation, asOf));
  const superseders = active.filter((relation) =>
    relation.relationType === "SUPERSEDES" && relation.relatedCard.id === card.id);
  const contradictions = active.filter((relation) => relation.relationType === "CONTRADICTS");
  const pending = involved.filter((relation) =>
    relation.relationType !== "RELATED" && (time(relation.createdAt) ?? 0) <= asOf.getTime() &&
    (!relation.confirmed || time(relation.confirmedAt) === null || time(relation.confirmedAt)! > asOf.getTime()) &&
    (time(relation.revokedAt) === null || time(relation.revokedAt)! > asOf.getTime()) &&
    (time(relation.validTo) === null || time(relation.validTo)! > asOf.getTime()));
  const revoked = involved.filter((relation) =>
    relation.relationType !== "RELATED" && relation.revokedAt !== null && time(relation.revokedAt)! <= asOf.getTime());
  const supporting = active.filter((relation) =>
    relation.relationType === "SUPPORTS" || relation.relationType === "DERIVED_FROM" ||
    (relation.relationType === "SUPERSEDES" && relation.currentCard.id === card.id));

  let status: TemporalDecisionStatus;
  let supportState: TemporalSupportState;
  let reasonRelation: TemporalRelationData | null = null;

  if (superseders.length > 1 || contradictions.length > 0) {
    status = "CONFLICT";
    supportState = "CONFLICT";
    reasonRelation = newest(contradictions.length > 0 ? contradictions : superseders);
  } else if (superseders.length === 1) {
    status = "SUPERSEDED";
    supportState = "SUPERSEDED";
    reasonRelation = superseders[0];
  } else if (pending.length > 0) {
    status = "PENDING";
    supportState = "PENDING";
    reasonRelation = newest(pending);
  } else if (supporting.length > 0) {
    status = "CURRENT";
    supportState = "SUPPORTED";
    reasonRelation = newest(supporting);
  } else if (revoked.length > 0) {
    status = "REVOKED";
    supportState = "REVOKED";
    reasonRelation = newest(revoked);
  } else {
    status = "INSUFFICIENT";
    supportState = "INSUFFICIENT";
  }

  const supersededByRelation = newest(superseders);
  const normalized = displayReasonFor(status, reasonRelation);
  const evidenceRefs: TemporalEvidenceRef[] = [
    {
      entityKind: "card",
      entityId: card.id,
      field: "title+summary",
      observedAt: card.createdAt,
    },
    ...involved
      .filter((relation) => relation.relationType !== "RELATED" && (time(relation.createdAt) ?? 0) <= asOf.getTime())
      .map((relation) => ({
        entityKind: "relation" as const,
        entityId: relation.id,
        field: "temporal-validity",
        observedAt: relation.confirmedAt ?? relation.createdAt,
        relationType: relation.relationType,
      })),
  ];
  return {
    card,
    current: status !== "SUPERSEDED",
    status,
    statusLabel: statusLabel(status),
    supportState,
    ...normalized,
    supersededBy: supersededByRelation?.currentCard ?? null,
    temporalReason: reasonRelation?.reason ?? null,
    evidenceRefs,
    relations: involved.sort((a, b) => (time(b.createdAt) ?? 0) - (time(a.createdAt) ?? 0)),
  };
}

export function buildTemporalTimeline(
  cards: TemporalCardSummary[],
  relations: TemporalRelationData[],
  asOf: Date,
): TemporalDecisionItem[] {
  return cards
    .map((card) => evaluateTemporalCard(card, relations, asOf))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return (time(b.card.createdAt) ?? 0) - (time(a.card.createdAt) ?? 0);
    });
}

export function wouldCreateSupersessionCycle(
  relations: Array<{ currentCardId: string; relatedCardId: string }>,
  currentCardId: string,
  relatedCardId: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const relation of [...relations, { currentCardId, relatedCardId }]) {
    const targets = adjacency.get(relation.currentCardId) ?? [];
    targets.push(relation.relatedCardId);
    adjacency.set(relation.currentCardId, targets);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (visit(target)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  return [...adjacency.keys()].some((node) => visit(node));
}
