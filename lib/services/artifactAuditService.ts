import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";
import type {
  ArtifactAuditRecheckItem,
  ArtifactAuditResponse,
  ArtifactClaimAuditItem,
  ArtifactClaimsAuditStatus,
  ArtifactGenerationRef,
  ArtifactTypeValue,
  TemporalDecisionItem,
} from "@/lib/types";

interface StoredSourceRef {
  cardId: string;
  observedAt: string;
  titleSnapshot: string;
  summarySnapshot: string;
}

interface StoredClaim {
  claimId: string;
  text: string;
  section: string;
  verification: string;
  cardIds: string[];
}

function parseStoredClaims(raw: unknown): { status: "TEMPLATE_BOUND" | "UNMAPPED_MODEL"; claims: StoredClaim[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const candidate = raw as { status?: unknown; claims?: unknown };
  if (candidate.status !== "TEMPLATE_BOUND" && candidate.status !== "UNMAPPED_MODEL") return null;
  const claims: StoredClaim[] = [];
  if (Array.isArray(candidate.claims)) {
    for (const item of candidate.claims) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.claimId !== "string" || typeof entry.text !== "string") continue;
      claims.push({
        claimId: entry.claimId,
        text: entry.text,
        section: typeof entry.section === "string" ? entry.section : "",
        verification: entry.verification === "TEMPLATE_BOUND" ? "TEMPLATE_BOUND" : "UNVERIFIED_SEMANTICS",
        cardIds: Array.isArray(entry.cardIds) ? entry.cardIds.filter((id): id is string => typeof id === "string") : [],
      });
    }
  }
  return { status: candidate.status, claims };
}

function parseStoredSourceRefs(raw: unknown): StoredSourceRef[] {
  if (!Array.isArray(raw)) return [];
  const refs: StoredSourceRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.cardId !== "string" || candidate.cardId.length === 0) continue;
    refs.push({
      cardId: candidate.cardId,
      observedAt: typeof candidate.observedAt === "string" ? candidate.observedAt : "",
      titleSnapshot: typeof candidate.titleSnapshot === "string" ? candidate.titleSnapshot : "",
      summarySnapshot: typeof candidate.summarySnapshot === "string" ? candidate.summarySnapshot : "",
    });
  }
  return refs;
}

function toGenerationRefs(refs: StoredSourceRef[]): ArtifactGenerationRef[] {
  return refs.map((ref) => ({
    cardId: ref.cardId,
    observedAt: ref.observedAt,
    titleSnapshot: ref.titleSnapshot,
    summarySnapshot: ref.summarySnapshot,
  }));
}

function buildRecheckItem(ref: StoredSourceRef, item: TemporalDecisionItem | undefined): ArtifactAuditRecheckItem {
  if (!item) {
    // 时间线中没有该卡（例如已被物理删除或属于其他项目）：如实报告为证据不足，不编造状态
    return {
      cardId: ref.cardId,
      titleSnapshot: ref.titleSnapshot,
      summarySnapshot: ref.summarySnapshot,
      supportState: "INSUFFICIENT",
      statusLabel: "证据不足",
      supersededBy: null,
      supersededByTitle: null,
      supersededConfirmedAt: null,
      supersededReason: null,
    };
  }

  let supersededByTitle: string | null = null;
  let supersededConfirmedAt: string | null = null;
  let supersededReason: string | null = null;
  if (item.supersededBy) {
    supersededByTitle = item.supersededBy.title;
    for (const relation of item.relations) {
      if (
        relation.relationType === "SUPERSEDES" &&
        relation.confirmed &&
        relation.revokedAt === null &&
        relation.currentCard.id === item.supersededBy.id
      ) {
        supersededConfirmedAt = relation.confirmedAt;
        supersededReason = relation.reason;
        break;
      }
    }
  }

  return {
    cardId: ref.cardId,
    titleSnapshot: ref.titleSnapshot,
    summarySnapshot: ref.summarySnapshot,
    supportState: item.supportState,
    statusLabel: item.statusLabel,
    supersededBy: item.supersededBy,
    supersededByTitle,
    supersededConfirmedAt,
    supersededReason,
  };
}

const CLAIM_STATE_LABELS: Record<ArtifactClaimAuditItem["state"], string> = {
  CURRENT: "引用当前有效",
  SUPERSEDED: "引用已被取代",
  UNCONFIRMED: "引用存在但尚无确认支撑",
  MISSING: "来源已删除",
  UNVERIFIED: "相关来源，语义未核验",
};

function buildAuditMessage(
  untraceable: boolean,
  recheck: ArtifactAuditRecheckItem[],
  claimsStatus: ArtifactClaimsAuditStatus,
  claims: ArtifactClaimAuditItem[],
): string {
  if (untraceable) {
    return "该成果生成时未保存逐句证据引用，无法逐句回溯；系统不会用当前知识库补造历史。";
  }
  if (claimsStatus === "UNMAPPED_MODEL") {
    return "该成果由模型生成且未提供逐句引用映射：下方来源为上下文级引用，语义未核验，不视为已核验结论。";
  }
  if (claimsStatus === "LEGACY_NO_CLAIMS") {
    return `该成果保存于逐句映射上线前：仅有 ${recheck.length} 项上下文级来源，无法逐句回溯。`;
  }
  const supersededClaims = claims.filter((claim) => claim.state === "SUPERSEDED").length;
  const unconfirmedClaims = claims.filter((claim) => claim.state === "UNCONFIRMED").length;
  if (supersededClaims > 0) {
    return `逐句映射 ${claims.length} 条，其中 ${supersededClaims} 条引用已被新决策取代，以下方当前重新检查为准。`;
  }
  if (unconfirmedClaims > 0) {
    return `逐句映射 ${claims.length} 条：均未被取代，其中 ${unconfirmedClaims} 条引用尚无确认支撑，系统不将其视为已核验结论。`;
  }
  if (claims.length > 0) {
    return `逐句映射 ${claims.length} 条，引用经当前重新检查仍然有效。`;
  }
  const superseded = recheck.filter((item) => item.supportState === "SUPERSEDED" || item.supersededBy !== null);
  const conflicted = recheck.filter((item) => item.supportState === "CONFLICT" || item.supportState === "PENDING");
  if (superseded.length > 0) {
    return `生成时引用的 ${recheck.length} 项证据中有 ${superseded.length} 项已被新决策取代，以下方当前重新检查为准。`;
  }
  if (conflicted.length > 0) {
    return `生成时引用的 ${recheck.length} 项证据中存在 ${conflicted.length} 项冲突或待确认记录，请先确认哪一版代表当前事实。`;
  }
  return `生成时引用的 ${recheck.length} 项证据经当前重新检查仍然有效。`;
}

export async function getArtifactAudit(projectId: string, artifactId: string): Promise<ArtifactAuditResponse> {
  const artifact = await db.generatedArtifact.findFirst({
    where: { id: artifactId, projectId },
  });
  if (!artifact) {
    throw new AppError("ARTIFACT_NOT_FOUND", "成果不存在或不属于当前项目", 404);
  }

  const recheckedAt = new Date();
  const refs = parseStoredSourceRefs(artifact.sourceRefs);
  const storedClaims = parseStoredClaims(artifact.claims);

  if (refs.length === 0 && !storedClaims) {
    return {
      artifactId: artifact.id,
      artifactType: artifact.artifactType as ArtifactTypeValue,
      generatedAt: artifact.createdAt.toISOString(),
      untraceable: true,
      message: buildAuditMessage(true, [], "NONE", []),
      generationRefs: [],
      recheck: [],
      claimsStatus: "NONE",
      claims: [],
      recheckedAt: recheckedAt.toISOString(),
    };
  }

  const cardIdsForRecheck = [
    ...new Set([...refs.map((ref) => ref.cardId), ...(storedClaims?.claims.flatMap((claim) => claim.cardIds) ?? [])]),
  ];
  const states = await getTemporalSearchStates(projectId, cardIdsForRecheck, recheckedAt);
  const recheck = refs.map((ref) => buildRecheckItem(ref, states.get(ref.cardId)));

  // 逐句核验：仅模板绑定映射参与；来源缺失显示"来源已删除"
  let claimsStatus: ArtifactClaimsAuditStatus = storedClaims ? storedClaims.status : "LEGACY_NO_CLAIMS";
  const claimItems: ArtifactClaimAuditItem[] = (storedClaims?.claims ?? []).map((claim): ArtifactClaimAuditItem => {
    const cardStates = claim.cardIds.map((cardId) => {
      const item = states.get(cardId);
      return {
        cardId,
        supportState: item?.supportState ?? "MISSING",
        statusLabel: item?.statusLabel ?? "来源已删除",
      };
    });
    let state: ArtifactClaimAuditItem["state"];
    if (cardStates.some((card) => card.supportState === "MISSING")) state = "MISSING";
    else if (cardStates.some((card) => card.supportState === "SUPERSEDED")) state = "SUPERSEDED";
    else if (cardStates.every((card) => card.supportState === "SUPPORTED")) state = "CURRENT";
    else state = "UNCONFIRMED";
    return {
      claimId: claim.claimId,
      text: claim.text,
      section: claim.section,
      verification: claim.verification as ArtifactClaimAuditItem["verification"],
      cardIds: claim.cardIds,
      state,
      stateLabel: CLAIM_STATE_LABELS[state],
      cardStates,
    };
  });

  return {
    artifactId: artifact.id,
    artifactType: artifact.artifactType as ArtifactTypeValue,
    generatedAt: artifact.createdAt.toISOString(),
    untraceable: false,
    message: buildAuditMessage(false, recheck, claimsStatus, claimItems),
    generationRefs: toGenerationRefs(refs),
    recheck,
    claimsStatus,
    claims: claimItems,
    recheckedAt: recheckedAt.toISOString(),
  };
}
