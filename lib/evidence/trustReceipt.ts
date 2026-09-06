import type {
  EvidenceClaim,
  EvidenceSupportState,
  EvidenceTrustReceipt,
  TemporalCardSummary,
  TemporalSupportState,
} from "@/lib/types";

export interface ClaimDraft {
  text: string;
  cardIds: string[];
}

export interface CardEvidenceState {
  cardId: string;
  belongsToProject: boolean;
  current: boolean;
  supportState: TemporalSupportState;
  supersededBy: TemporalCardSummary | null;
}

export interface TrustReceiptEvaluation {
  receipt: EvidenceTrustReceipt;
  acceptedCardIds: string[];
  rejectedCardIds: string[];
}

const refusalCopy: Record<Exclude<EvidenceSupportState, "SUPPORTED">, string> = {
  CONTESTED: "当前项目记忆存在冲突或尚未确认的证据，无法给出确定结论。请先确认哪一版记录代表当前事实。",
  INSUFFICIENT: "当前项目记忆不足以支持这个结论。我不知道；请先补充相关记录或缩小问题范围。",
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function evaluateClaim(
  draft: ClaimDraft,
  evidenceById: Map<string, CardEvidenceState>,
): EvidenceClaim {
  const requestedIds = unique(draft.cardIds);
  const currentIds: string[] = [];
  const supersededIds: string[] = [];
  let hasUnknown = requestedIds.length === 0;
  let hasConflict = false;

  for (const cardId of requestedIds) {
    const evidence = evidenceById.get(cardId);
    if (!evidence || !evidence.belongsToProject) {
      hasUnknown = true;
      continue;
    }
    if (!evidence.current || evidence.supportState === "SUPERSEDED") {
      supersededIds.push(cardId);
      continue;
    }
    if (evidence.supportState === "CONFLICT" || evidence.supportState === "PENDING") {
      hasConflict = true;
    }
    currentIds.push(cardId);
  }

  let support: EvidenceSupportState = "SUPPORTED";
  if (hasConflict) support = "CONTESTED";
  else if (hasUnknown || currentIds.length === 0) support = "INSUFFICIENT";

  return {
    text: draft.text.trim() || "回答中的事实性结论",
    support,
    cardIds: currentIds,
    supersededCardIds: supersededIds,
  };
}

export function evaluateTrustReceipt(input: {
  claims: ClaimDraft[];
  fallbackClaimText: string;
  fallbackCardIds: string[];
  evidence: CardEvidenceState[];
  retrievalMode: EvidenceTrustReceipt["retrievalMode"];
  evaluatedAt?: Date;
}): TrustReceiptEvaluation {
  const evidenceById = new Map(input.evidence.map((item) => [item.cardId, item]));
  const drafts = input.claims.length > 0
    ? input.claims
    : [{ text: input.fallbackClaimText, cardIds: input.fallbackCardIds }];
  const claims = drafts.map((claim) => evaluateClaim(claim, evidenceById));

  const supportState: EvidenceSupportState = claims.some((claim) => claim.support === "CONTESTED")
    ? "CONTESTED"
    : claims.some((claim) => claim.support === "INSUFFICIENT")
      ? "INSUFFICIENT"
      : "SUPPORTED";
  const acceptedCardIds = unique(claims.flatMap((claim) => claim.cardIds));
  const rejectedCardIds = unique([
    ...claims.flatMap((claim) => claim.supersededCardIds),
    ...drafts.flatMap((claim) => claim.cardIds).filter((cardId) => !acceptedCardIds.includes(cardId)),
  ]);

  return {
    receipt: {
      supportState,
      abstained: supportState !== "SUPPORTED",
      claims,
      retrievalMode: input.retrievalMode,
      refusalReason: supportState === "SUPPORTED" ? null : refusalCopy[supportState],
      evaluatedAt: (input.evaluatedAt ?? new Date()).toISOString(),
    },
    acceptedCardIds,
    rejectedCardIds,
  };
}

export function guardedAnswerMessage(receipt: EvidenceTrustReceipt, supportedMessage: string): string {
  return receipt.supportState === "SUPPORTED"
    ? supportedMessage
    : receipt.refusalReason ?? refusalCopy.INSUFFICIENT;
}
