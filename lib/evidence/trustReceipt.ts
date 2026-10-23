import type {
  EvidenceClaim,
  EvidenceSupportState,
  EvidenceTrustReceipt,
  TemporalCardSummary,
  TemporalTopLevelState,
  TemporalSupportState,
} from "@/lib/types";
import { evidenceAssessment, type EvidenceAssessment } from "./assessment";
import { ruleVerdict } from "./semanticRules";

export interface ClaimDraft {
  text: string;
  cardIds: string[];
}

export interface CardEvidenceState {
  cardId: string;
  belongsToProject: boolean;
  current: boolean;
  supportState: TemporalSupportState;
  topLevelState?: TemporalTopLevelState;
  supersededBy: TemporalCardSummary | null;
  text?: string;
  revision?: string;
  sourceTime?: string;
  semanticChecks?: Record<string, EvidenceAssessment["semanticVerdict"]>;
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
  const assessments: EvidenceAssessment[] = [];
  const supersededIds: string[] = [];
  let hasUnknown = requestedIds.length === 0;
  let hasConflict = false;

  for (const cardId of requestedIds) {
    const evidence = evidenceById.get(cardId);
    const sentences = evidence?.text ? [evidence.text, ...Array.from(new Intl.Segmenter("zh", { granularity: "sentence" }).segment(evidence.text), s => s.segment.trim())] : [];
    const rules = sentences.map(text => ruleVerdict(draft.text, text));
    const rule = rules.find(result => result?.status === "CONTRADICTS") ?? rules.find(result => result?.status === "ENTAILS");
    const admissible = !!evidence?.belongsToProject;
    // Like Mission, a verbatim match is structural evidence; only a configured Judge
    // can grant ENTAILS. A deterministic numeric/negative contradiction still fails closed.
    const semanticVerdict = admissible ? rule?.status === "CONTRADICTS" ? "CONTRADICTS" : evidence?.semanticChecks?.[draft.text] ?? "NOT_CHECKED" : "NOT_CHECKED";
    assessments.push(evidenceAssessment({ sourceId: `card:${cardId}`, observedAt: new Date().toISOString(),
      sourceRevision: evidence?.revision ?? "", sourceTime: evidence?.sourceTime ?? null,
      textRange: evidence?.text ? { start: 0, end: evidence.text.length } : null,
      citationAdmissibility: admissible ? "ADMITTED" : "REJECTED", temporalState: evidence?.topLevelState ?? "UNKNOWN",
      semanticVerdict, method: rule?.status === "CONTRADICTS" ? "RULE" : evidence?.semanticChecks?.[draft.text] ? "JUDGE" : rule ? "RULE" : "NONE",
      reasonCode: !admissible ? "SOURCE_NOT_ADMITTED" : rule?.status === "CONTRADICTS" ? rule.reasonCode : evidence?.semanticChecks?.[draft.text] ? "MODEL_JUDGMENT" : rule?.reasonCode ?? "SEMANTIC_NOT_CHECKED" }));
    if (!evidence || !evidence.belongsToProject) {
      hasUnknown = true;
      continue;
    }
    const topLevelState = evidence.topLevelState ?? (
      evidence.supportState === "SUPERSEDED" ? "SUPERSEDED" :
        evidence.supportState === "CONFLICT" || evidence.supportState === "PENDING" ? "CONTESTED" :
          evidence.supportState === "REVOKED" ? "UNKNOWN" :
            evidence.current ? "CURRENT" : "UNKNOWN"
    );
    if (!evidence.current || topLevelState === "SUPERSEDED") {
      supersededIds.push(cardId);
      continue;
    }
    if (topLevelState === "CONTESTED") {
      hasConflict = true;
    }
    if (semanticVerdict === "CONTRADICTS") hasConflict = true;
    // Unknown 是“系统尚不能证明时态结论”，不是“事实为假”。在证据归属
    // 和 current 仍成立时保留旧的来源支持语义；只有缺失/跨项目引用才
    // 让整条 claim 进入 INSUFFICIENT。
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
    assessments,
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
      schemaVersion: 2,
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
