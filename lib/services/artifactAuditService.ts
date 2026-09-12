import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";
import type {
  ArtifactAuditRecheckItem,
  ArtifactAuditResponse,
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

function buildAuditMessage(untraceable: boolean, recheck: ArtifactAuditRecheckItem[]): string {
  if (untraceable) {
    return "该成果生成时未保存逐句证据引用，无法逐句回溯；系统不会用当前知识库补造历史。";
  }
  const superseded = recheck.filter((item) => item.supportState === "SUPERSEDED" || item.supersededBy !== null);
  const conflicted = recheck.filter((item) => item.supportState === "CONFLICT" || item.supportState === "PENDING");
  if (superseded.length > 0) {
    return `生成时引用的 ${recheck.length} 项证据中有 ${superseded.length} 项已被新决策取代，以下方当前重新检查为准。`;
  }
  if (conflicted.length > 0) {
    return `生成时引用的 ${recheck.length} 项证据中存在 ${conflicted.length} 项冲突或待确认记录，请先确认哪一版代表当前事实。`;
  }
  // 无确认关系的独立事实按时间线语义为“证据不足”：记录未被取代，但不足以单独支撑结论
  const insufficient = recheck.filter((item) => item.supportState === "INSUFFICIENT");
  if (insufficient.length > 0) {
    return `生成时引用的 ${recheck.length} 项证据均未被取代，其中 ${insufficient.length} 项尚无确认的关系支撑，状态为证据不足。`;
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

  if (refs.length === 0) {
    return {
      artifactId: artifact.id,
      artifactType: artifact.artifactType as ArtifactTypeValue,
      generatedAt: artifact.createdAt.toISOString(),
      untraceable: true,
      message: buildAuditMessage(true, []),
      generationRefs: [],
      recheck: [],
      recheckedAt: recheckedAt.toISOString(),
    };
  }

  const states = await getTemporalSearchStates(projectId, refs.map((ref) => ref.cardId), recheckedAt);
  const recheck = refs.map((ref) => buildRecheckItem(ref, states.get(ref.cardId)));

  return {
    artifactId: artifact.id,
    artifactType: artifact.artifactType as ArtifactTypeValue,
    generatedAt: artifact.createdAt.toISOString(),
    untraceable: false,
    message: buildAuditMessage(false, recheck),
    generationRefs: toGenerationRefs(refs),
    recheck,
    recheckedAt: recheckedAt.toISOString(),
  };
}
