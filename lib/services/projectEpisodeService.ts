import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import { PROJECT_STATE_POLICY_VERSION } from "@/lib/types/projectState";
import {
  EPISODE_SCHEMA_VERSION,
  type EpisodeClaim,
  type EpisodeClaimFreshness,
  type EpisodeData,
  type EpisodeFreshnessReport,
  type EpisodeRevisionData,
  type EpisodeScopeReport,
  type EpisodeSection,
  type EpisodeSourceKind,
  type EpisodeSourceRef,
  type EpisodeSourceState,
  type EpisodeSummary,
} from "@/lib/types/episode";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";
import type { Prisma } from "@/lib/generated/prisma/client";

/** 单次检查点的来源上限；超出部分如实返回排除数量与原因，不静默截断 */
const MAX_CARDS = 60;
const MAX_RELATIONS = 40;
const MAX_ACTION_RESULTS = 30;
const MAX_ATTACHMENT_REVISIONS = 20;

export interface EpisodePreviewInput {
  windowStart: string;
  windowEnd: string;
  kind?: string;
  baseSnapshotId?: string | null;
  endSnapshotId?: string | null;
}

function ensureEpisodeEnabled() {
  if (!isFeatureEnabled("PROJECT_EPISODES_ENABLED", false)) {
    throw new AppError("PROJECT_EPISODES_DISABLED", "阶段检查点功能当前已关闭", 503);
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function iso(value: Date): string {
  return value.toISOString();
}

function toDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("VALIDATION_ERROR", `${field} 不是有效的 ISO 8601 时间`, 422);
  }
  return parsed;
}

interface CollectedSources {
  refs: EpisodeSourceRef[];
  cards: Array<{ id: string; title: string; summary: string; createdAt: Date; importance: number }>;
  relations: Array<{ id: string; relationType: string; currentTitle: string; relatedTitle: string; relatedCardId: string; confirmedAt: Date | null }>;
  actionResults: Array<{ actionId: string; actionTitle: string; resultCardId: string; resultTitle: string; resultSummary: string; completedAt: Date | null }>;
  attachmentRevisions: Array<{ revisionId: string; attachmentId: string; revisionIndex: number; fileName: string; createdAt: Date }>;
  baseSnapshotId: string | null;
  endSnapshotId: string | null;
  endSnapshotPolicyVersion: string | null;
  contestedCount: number;
  unknownCount: number;
  excluded: string[];
  excludedCount: number;
  scope: EpisodeScopeReport;
}

/**
 * 按固定顺序收集窗口内候选来源并冻结观察版本。
 * 摘要不递归当来源：只取原始卡片、附件修订、行动结果卡、状态快照与已确认关系。
 */
async function collectSources(projectId: string, windowStart: Date, windowEnd: Date, baseSnapshotId?: string | null, endSnapshotId?: string | null): Promise<CollectedSources> {
  const excluded: string[] = [];

  const allCards = await db.knowledgeCard.findMany({
    where: { projectId, createdAt: { gte: windowStart, lte: windowEnd } },
    select: { id: true, title: true, summary: true, createdAt: true, importance: true, archivedAt: true },
    orderBy: [{ importance: "desc" }, { createdAt: "asc" }],
  });
  const activeCards = allCards.filter((card) => card.archivedAt === null);
  const cards = activeCards.slice(0, MAX_CARDS);
  if (activeCards.length > cards.length) {
    excluded.push(`记录超出单次检查点上限（${activeCards.length} 条，仅纳入重要度最高的 ${cards.length} 条）`);
  }

  const cardIdsInWindow = new Set(allCards.map((card) => card.id));
  const allRelations = await db.cardRelation.findMany({
    where: {
      confirmed: true,
      revokedAt: null,
      OR: [{ confirmedAt: { gte: windowStart, lte: windowEnd } }, { confirmedAt: null, createdAt: { gte: windowStart, lte: windowEnd } }],
    },
    select: {
      id: true,
      relationType: true,
      confirmedAt: true,
      currentCard: { select: { id: true, title: true } },
      relatedCard: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "asc" },
  }).then((rows) => rows.filter((row) => cardIdsInWindow.has(row.currentCard.id) && cardIdsInWindow.has(row.relatedCard.id)));
  const relations = allRelations
    .map((row) => ({
      id: row.id,
      relationType: row.relationType as string,
      currentTitle: row.currentCard.title,
      relatedTitle: row.relatedCard.title,
      relatedCardId: row.relatedCard.id,
      confirmedAt: row.confirmedAt,
    }))
    .slice(0, MAX_RELATIONS);
  if (allRelations.length > relations.length) {
    excluded.push(`已确认关系超出上限（${allRelations.length} 条，仅纳入前 ${relations.length} 条）`);
  }

  const completedActions = await db.actionItem.findMany({
    where: { projectId, completedAt: { gte: windowStart, lte: windowEnd }, resultCardId: { not: null } },
    select: {
      id: true,
      title: true,
      completedAt: true,
      resultCard: { select: { id: true, title: true, summary: true, archivedAt: true } },
    },
    orderBy: { completedAt: "asc" },
  });
  const actionResults = completedActions
    .filter((action) => action.resultCard !== null && action.resultCard.archivedAt === null)
    .slice(0, MAX_ACTION_RESULTS)
    .map((action) => ({
      actionId: action.id,
      actionTitle: action.title,
      resultCardId: action.resultCard!.id,
      resultTitle: action.resultCard!.title,
      resultSummary: action.resultCard!.summary,
      completedAt: action.completedAt,
    }));

  const allRevisions = await db.attachmentRevision.findMany({
    where: { attachment: { projectId }, createdAt: { gte: windowStart, lte: windowEnd } },
    select: { id: true, attachmentId: true, revisionIndex: true, createdAt: true, attachment: { select: { fileName: true } } },
    orderBy: { createdAt: "asc" },
  });
  const attachmentRevisions = allRevisions.slice(0, MAX_ATTACHMENT_REVISIONS).map((row) => ({
    revisionId: row.id,
    attachmentId: row.attachmentId,
    revisionIndex: row.revisionIndex,
    fileName: row.attachment.fileName,
    createdAt: row.createdAt,
  }));
  if (allRevisions.length > attachmentRevisions.length) {
    excluded.push(`附件修订超出上限（${allRevisions.length} 条，仅纳入前 ${attachmentRevisions.length} 条）`);
  }

  let resolvedBase = baseSnapshotId ?? null;
  let resolvedEnd = endSnapshotId ?? null;
  const snapshots = await db.projectStateSnapshot.findMany({
    where: { projectId, evaluatedAt: { lte: windowEnd } },
    select: { id: true, evaluatedAt: true, policyVersion: true },
    orderBy: { sequence: "asc" },
  });
  if (!resolvedBase) {
    const base = [...snapshots].reverse().find((snapshot) => snapshot.evaluatedAt <= windowStart);
    resolvedBase = base?.id ?? null;
  }
  if (!resolvedEnd) {
    resolvedEnd = snapshots.length > 0 ? snapshots[snapshots.length - 1].id : null;
  }
  const endSnapshot = resolvedEnd ? snapshots.find((snapshot) => snapshot.id === resolvedEnd) ?? null : null;

  // 争议/未知直接来自统一时态判定，不在检查点里重新发明状态
  const temporalStates = await getTemporalSearchStates(projectId, allCards.map((card) => card.id), windowEnd);
  let contestedCount = 0;
  let unknownCount = 0;
  for (const card of allCards) {
    const state = temporalStates.get(card.id);
    if (state?.topLevelState === "CONTESTED") contestedCount += 1;
    if (state?.topLevelState === "UNKNOWN") unknownCount += 1;
  }

  const refs: EpisodeSourceRef[] = [];
  for (const card of cards) {
    refs.push({
      refId: `s${refs.length + 1}`,
      kind: "CARD",
      entityId: card.id,
      revisionIndex: null,
      observedAt: iso(card.createdAt),
      contentHash: sha256(`${card.title}\n${card.summary}`),
      title: card.title,
    });
  }
  for (const relation of relations) {
    refs.push({
      refId: `s${refs.length + 1}`,
      kind: "CARD",
      entityId: relation.relatedCardId,
      revisionIndex: null,
      observedAt: iso(relation.confirmedAt ?? new Date(0)),
      contentHash: sha256(`${relation.relationType}:${relation.id}`),
      title: relation.relatedTitle,
    });
  }
  for (const result of actionResults) {
    refs.push({
      refId: `s${refs.length + 1}`,
      kind: "ACTION_RESULT",
      entityId: result.resultCardId,
      revisionIndex: null,
      observedAt: iso(result.completedAt ?? new Date(0)),
      contentHash: sha256(`${result.resultTitle}\n${result.resultSummary}`),
      title: result.resultTitle,
    });
  }
  for (const revision of attachmentRevisions) {
    refs.push({
      refId: `s${refs.length + 1}`,
      kind: "ATTACHMENT_REVISION",
      entityId: revision.revisionId,
      revisionIndex: revision.revisionIndex,
      observedAt: iso(revision.createdAt),
      contentHash: sha256(`${revision.attachmentId}:${revision.revisionIndex}:${revision.fileName}`),
      title: revision.fileName,
    });
  }
  if (resolvedBase) {
    refs.push({
      refId: `s${refs.length + 1}`,
      kind: "SNAPSHOT",
      entityId: resolvedBase,
      revisionIndex: null,
      observedAt: windowStart.toISOString(),
      contentHash: sha256(`snapshot:${resolvedBase}`),
      title: "阶段起点快照",
    });
  }
  if (resolvedEnd && resolvedEnd !== resolvedBase) {
    refs.push({
      refId: `s${refs.length + 1}`,
      kind: "SNAPSHOT",
      entityId: resolvedEnd,
      revisionIndex: null,
      observedAt: windowEnd.toISOString(),
      contentHash: sha256(`snapshot:${resolvedEnd}`),
      title: "阶段终点快照",
    });
  }

  return {
    refs,
    cards,
    relations,
    actionResults,
    attachmentRevisions,
    baseSnapshotId: resolvedBase,
    endSnapshotId: resolvedEnd,
    endSnapshotPolicyVersion: endSnapshot?.policyVersion ?? null,
    excludedCount: excluded.length,
    contestedCount,
    unknownCount,
    excluded,
    scope: {
      windowStart: iso(windowStart),
      windowEnd: iso(windowEnd),
      baseSnapshotId: resolvedBase,
      endSnapshotId: resolvedEnd,
      candidateCount: allCards.length + allRelations.length + completedActions.length + allRevisions.length,
      includedCount: refs.length,
      excludedCount: Math.max(0, allCards.length + allRelations.length + completedActions.length + allRevisions.length - refs.length),
      excludedReasons: excluded,
      contestedCount,
      unknownCount,
    },
  };
}

/** 确定性模板：模型只负责压缩语言；未接入前直接用结构化模板，保证事实不新增 */
function buildTemplateClaims(sources: CollectedSources, windowStart: Date, windowEnd: Date): { claims: EpisodeClaim[]; summary: EpisodeSummary } {
  const claims: EpisodeClaim[] = [];
  const sections: Array<{ section: EpisodeSection; text: string }> = [];
  const cardRefByEntity = new Map(sources.refs.filter((ref) => ref.kind === "CARD").map((ref) => [ref.entityId, ref.refId]));
  const resultRefByEntity = new Map(sources.refs.filter((ref) => ref.kind === "ACTION_RESULT").map((ref) => [ref.entityId, ref.refId]));
  const attachmentRefByEntity = new Map(sources.refs.filter((ref) => ref.kind === "ATTACHMENT_REVISION").map((ref) => [ref.entityId, ref.refId]));

  for (const revision of sources.attachmentRevisions) {
    const refId = attachmentRefByEntity.get(revision.revisionId);
    if (!refId) continue;
    claims.push({
      claimId: `c${claims.length + 1}`,
      kind: "FACT",
      section: "CONFIRMED_CHANGES",
      text: `附件《${revision.fileName}》生成修订 #${revision.revisionIndex}`,
      sourceRefIds: [refId],
    });
  }

  claims.push({
    claimId: `c${claims.length + 1}`,
    kind: "FACT",
    section: "GOALS",
    text: `阶段范围为 ${iso(windowStart).slice(0, 10)} 至 ${iso(windowEnd).slice(0, 10)}，共纳入 ${sources.refs.length} 个可追溯来源。`,
    sourceRefIds: sources.refs.filter((ref) => ref.kind === "SNAPSHOT").map((ref) => ref.refId),
  });

  const changeTexts: string[] = [];
  for (const card of sources.cards) {
    const refId = cardRefByEntity.get(card.id);
    if (!refId) continue;
    claims.push({
      claimId: `c${claims.length + 1}`,
      kind: "FACT",
      section: "CONFIRMED_CHANGES",
      text: `新增记录《${card.title}》：${card.summary}`,
      sourceRefIds: [refId],
    });
    changeTexts.push(`《${card.title}》`);
  }
  sections.push({
    section: "CONFIRMED_CHANGES",
    text: changeTexts.length > 0
      ? `本阶段新增了 ${changeTexts.length} 条已记录内容，包括${changeTexts.slice(0, 3).join("、")}${changeTexts.length > 3 ? "等" : ""}。`
      : "检查点范围内没有新增的已确认记录。",
  });

  const trailTexts: string[] = [];
  const relationLabels: Record<string, string> = { SUPERSEDES: "取代", SUPPORTS: "支持", CONTRADICTS: "反驳", DERIVED_FROM: "派生自" };
  for (const relation of sources.relations) {
    const refId = cardRefByEntity.get(relation.relatedCardId);
    const label = relationLabels[relation.relationType] ?? relation.relationType;
    claims.push({
      claimId: `c${claims.length + 1}`,
      kind: "FACT",
      section: "DECISION_TRAIL",
      text: `确认《${relation.currentTitle}》${label}《${relation.relatedTitle}》`,
      sourceRefIds: refId ? [refId] : [],
    });
    trailTexts.push(`《${relation.currentTitle}》${label}《${relation.relatedTitle}》`);
  }
  sections.push({
    section: "DECISION_TRAIL",
    text: trailTexts.length > 0 ? `本阶段确认了 ${trailTexts.length} 条关系演化：${trailTexts.slice(0, 3).join("；")}。` : "本阶段没有新确认的关系演化。",
  });

  const resultTexts: string[] = [];
  for (const result of sources.actionResults) {
    const refId = resultRefByEntity.get(result.resultCardId);
    claims.push({
      claimId: `c${claims.length + 1}`,
      kind: "FACT",
      section: "COMPLETED_ACTIONS",
      text: `完成行动「${result.actionTitle}」，结果记录《${result.resultTitle}》：${result.resultSummary}`,
      sourceRefIds: refId ? [refId] : [],
    });
    resultTexts.push(`「${result.actionTitle}」`);
  }
  sections.push({
    section: "COMPLETED_ACTIONS",
    text: resultTexts.length > 0 ? `本阶段完成了 ${resultTexts.length} 项行动：${resultTexts.slice(0, 3).join("、")}。` : "检查点范围内没有带结果回执的已完成行动。",
  });

  const openQuestions: string[] = [];
  if (sources.contestedCount > 0) {
    openQuestions.push(`有 ${sources.contestedCount} 条记录处于争议状态，结论不能当作确定事实使用`);
  }
  if (sources.unknownCount > 0) {
    openQuestions.push(`有 ${sources.unknownCount} 条记录证据不足（UNKNOWN），需要补充输入后才能判断`);
  }
  const excludedNote = sources.excluded.length > 0 ? `另有 ${sources.excludedCount} 个候选来源因超出预算被排除，可缩小时间窗分批检查。` : "";
  sections.push({
    section: "OPEN_QUESTIONS",
    text: [openQuestions.join("；"), excludedNote].filter(Boolean).join("。") || "检查点范围内没有待解决的争议或未知项。",
  });

  sections.push({
    section: "NEXT_STEPS",
    text: "下一步建议来自当前仍为 READY 的行动；确认检查点后可选择行动安排到未来时间。",
  });

  return {
    claims,
    summary: {
      schemaVersion: EPISODE_SCHEMA_VERSION,
      goals: "",
      sections,
    },
  };
}

/** 建议不是已执行的事实：单独标注 kind=SUGGESTION，确认后才能创建或排程 */
function appendNextStepClaims(claims: EpisodeClaim[], summary: EpisodeSummary, candidates: NextStepCandidate[]) {
  for (const candidate of candidates) {
    claims.push({
      claimId: `c${claims.length + 1}`,
      kind: "SUGGESTION",
      section: "NEXT_STEPS",
      text: `建议继续推进：「${candidate.title}」（${candidate.reason}）`,
      sourceRefIds: [],
      suggestedActionId: candidate.actionId,
      suggestedReason: candidate.reason,
    });
  }
  const nextSection = summary.sections.find((section) => section.section === "NEXT_STEPS");
  if (nextSection) {
    nextSection.text = candidates.length > 0
      ? `当前可开始的行动：${candidates.map((candidate) => `「${candidate.title}」`).join("、")}。`
      : "当前没有评估为 READY 的行动；受阻或证据不足的行动不会进入时间安排。";
  }
}

function isLlmConfigured(): boolean {
  return process.env.LLM_MODE === "openai-compatible" && Boolean(process.env.LLM_API_KEY);
}

interface SummaryCompressionResult {
  summary: EpisodeSummary;
  generationMode: "TEMPLATE" | "MODEL" | "MODEL_FALLBACK_TEMPLATE";
  provider: string | null;
  fallbackReason: string | null;
}

/**
 * 模型只压缩段落语言，不接触 claim 与来源结构；输出必须与输入节一一对应，
 * 任何缺节、改节名或疑似新增事实都会回退模板，绝不把模型输出存为 PUBLISHED 事实。
 */
async function compressEpisodeSummary(summary: EpisodeSummary): Promise<SummaryCompressionResult> {
  const base: SummaryCompressionResult = { summary, generationMode: "TEMPLATE", provider: null, fallbackReason: null };
  if (!isLlmConfigured()) return base;
  try {
    const { chatJsonWithMeta } = await import("@/lib/agent/llmAgent");
    const input = summary.sections.map((section) => ({ section: section.section, text: section.text }));
    const prompt = [
      "你是项目阶段总结的文案编辑。下面是一个学生项目阶段检查点的分节段落。",
      "任务：只改写每段的语言，使其更通顺简洁；禁止新增任何事实、数字或结论，禁止删掉具体数字和记录标题，禁止改变段落含义。",
      "输出 JSON：{\"sections\":[{\"section\":\"<与输入相同的节名>\",\"text\":\"<改写后的段落>\"}]}，节数、节名与顺序必须与输入完全一致。",
      "输入：",
      JSON.stringify({ sections: input }),
    ].join("\n");
    const result = await chatJsonWithMeta(prompt, (value: unknown) => {
      const parsed = value as { sections?: Array<{ section?: string; text?: string }> };
      if (!Array.isArray(parsed.sections) || parsed.sections.length !== input.length) {
        throw new Error("压缩输出的节数与输入不一致");
      }
      const byKey = new Map<string, string>(input.map((section) => [section.section, section.text]));
      const compressed = parsed.sections.map((section) => {
        const key = String(section.section ?? "");
        const text = String(section.text ?? "");
        const original = byKey.get(key);
        if (!original || text.length === 0) throw new Error("压缩输出缺少有效段落");
        // 保守防漂移：原文中的数字（估时/数量/日期片段）必须保留
        const numbersOriginal = original.match(/\d+/g) ?? [];
        for (const number of numbersOriginal) {
          if (!text.includes(number)) throw new Error(`压缩输出丢失数字 ${number}`);
        }
        return { section: key as EpisodeSection, text };
      });
      return compressed;
    });
    if (result.status !== "SUCCESS") return base;
    return {
      summary: { schemaVersion: summary.schemaVersion, goals: summary.goals, sections: result.data },
      generationMode: "MODEL",
      provider: result.provider,
      fallbackReason: null,
    };
  } catch (error) {
    return {
      summary,
      generationMode: "MODEL_FALLBACK_TEMPLATE",
      provider: null,
      fallbackReason: error instanceof Error ? error.message.slice(0, 240) : "llm_error",
    };
  }
}

interface NextStepCandidate {
  actionId: string;
  title: string;
  reason: string;
}

/** 下一步候选只来自未完成行动与可行性判定，不由模板自由发挥 */
async function collectNextStepCandidates(projectId: string, limit = 3): Promise<NextStepCandidate[]> {
  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");
  const pendingRows = await db.actionItem.findMany({
    where: { projectId, status: "TODO" },
    select: { id: true, title: true, priority: true, dueAt: true, createdAt: true },
  });
  // SQLite 不支持 Prisma 的 nulls first/last，截止时间升序（缺失排后）在内存中排序
  const pending = pendingRows.sort((a, b) => {
    const dueA = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
    const dueB = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
    if (dueA !== dueB) return dueA - dueB;
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
    return a.id.localeCompare(b.id);
  }).slice(0, 20);
  const candidates: NextStepCandidate[] = [];
  for (const action of pending) {
    try {
      const assessment = await assessActionFeasibility(projectId, action.id);
      if (assessment.feasibility === "READY") {
        candidates.push({
          actionId: action.id,
          title: action.title,
          reason: assessment.deadline ? "依赖已满足，且有截止时间" : "依赖已满足，当前可开始",
        });
      }
    } catch {
      // 单个行动判定失败不阻塞检查点生成；该行动只是不进入候选
    }
    if (candidates.length >= limit) break;
  }
  return candidates;
}

function serializeRevision(row: {
  id: string;
  episodeId: string;
  revision: number;
  baseSnapshotId: string | null;
  endSnapshotId: string | null;
  sourceHash: string;
  sourceRefs: unknown;
  claims: unknown;
  summary: unknown;
  generationMode: string;
  provider: string | null;
  fallbackReason: string | null;
  status: string;
  createdAt: Date;
}): EpisodeRevisionData {
  return {
    id: row.id,
    episodeId: row.episodeId,
    revision: row.revision,
    baseSnapshotId: row.baseSnapshotId,
    endSnapshotId: row.endSnapshotId,
    sourceHash: row.sourceHash,
    sourceRefs: row.sourceRefs as EpisodeSourceRef[],
    claims: row.claims as EpisodeClaim[],
    summary: row.summary as EpisodeSummary,
    generationMode: row.generationMode as EpisodeRevisionData["generationMode"],
    provider: row.provider,
    fallbackReason: row.fallbackReason,
    status: row.status as EpisodeRevisionData["status"],
    createdAt: iso(row.createdAt),
  };
}

function serializeEpisode(
  row: {
    id: string;
    projectId: string;
    kind: string;
    title: string;
    windowStart: Date;
    windowEnd: Date;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    revisions: Array<Parameters<typeof serializeRevision>[0]>;
  },
  freshness?: EpisodeFreshnessReport,
): EpisodeData {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    title: row.title,
    windowStart: iso(row.windowStart),
    windowEnd: iso(row.windowEnd),
    status: row.status as EpisodeData["status"],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    revisions: row.revisions.map(serializeRevision),
    ...(freshness ? { freshness } : {}),
  };
}

async function loadEpisode(projectId: string, episodeId: string) {
  const row = await db.projectEpisode.findFirst({
    where: { id: episodeId, projectId },
    include: { revisions: { orderBy: { revision: "asc" } } },
  });
  if (!row) throw new AppError("EPISODE_NOT_FOUND", "阶段检查点不存在或不属于当前项目", 404);
  return row;
}

export interface EpisodePreviewResult {
  episode: EpisodeData;
  scope: EpisodeScopeReport;
}

/** 生成阶段检查点预览（DRAFT）。取消预览不写任何项目事实。 */
export async function previewProjectEpisode(projectId: string, input: EpisodePreviewInput): Promise<EpisodePreviewResult> {
  ensureEpisodeEnabled();
  const windowStart = toDate(input.windowStart, "windowStart");
  const windowEnd = toDate(input.windowEnd, "windowEnd");
  if (windowStart.getTime() >= windowEnd.getTime()) {
    throw new AppError("INVALID_EPISODE_WINDOW", "阶段起点必须早于终点", 422);
  }
  const kind = ["MANUAL", "MILESTONE", "SNAPSHOT_RANGE"].includes(input.kind ?? "") ? input.kind! : "MANUAL";

  const sources = await collectSources(projectId, windowStart, windowEnd, input.baseSnapshotId ?? null, input.endSnapshotId ?? null);
  const { claims, summary } = buildTemplateClaims(sources, windowStart, windowEnd);
  appendNextStepClaims(claims, summary, await collectNextStepCandidates(projectId));
  const compressed = await compressEpisodeSummary(summary);
  const sourceHash = sha256(JSON.stringify(sources.refs.map((ref) => [ref.kind, ref.entityId, ref.revisionIndex, ref.observedAt, ref.contentHash])));

  const title = `阶段检查点 · ${iso(windowStart).slice(0, 10)} ~ ${iso(windowEnd).slice(0, 10)}`;
  const episode = await db.projectEpisode.create({
    data: {
      projectId,
      kind,
      title,
      windowStart,
      windowEnd,
      status: "DRAFT",
      revisions: {
        create: {
          revision: 1,
          baseSnapshotId: sources.baseSnapshotId,
          endSnapshotId: sources.endSnapshotId,
          sourceHash,
          sourceRefs: sources.refs as unknown as Prisma.InputJsonValue,
          claims: claims as unknown as Prisma.InputJsonValue,
          summary: compressed.summary as unknown as Prisma.InputJsonValue,
          generationMode: compressed.generationMode,
          provider: compressed.provider,
          fallbackReason: compressed.fallbackReason,
          status: "DRAFT",
        },
      },
    },
    include: { revisions: { orderBy: { revision: "asc" } } },
  });

  return { episode: serializeEpisode(episode), scope: sources.scope };
}

export interface EpisodeConfirmInput {
  revision: number;
  requestId: string;
  /** 预览返回的 sourceHash；不匹配说明来源已变化，需要重新预览 */
  expectedSourceHash?: string;
}

/** 按 requestId 幂等确认：重复请求重放原结果，来源变化返回 409 */
export async function confirmEpisodeRevision(projectId: string, episodeId: string, input: EpisodeConfirmInput): Promise<EpisodeData> {
  ensureEpisodeEnabled();
  if (!input.requestId || input.requestId.trim().length === 0) {
    throw new AppError("VALIDATION_ERROR", "requestId 不能为空", 422);
  }

  return db.$transaction(async (tx) => {
    const episode = await tx.projectEpisode.findFirst({
      where: { id: episodeId, projectId },
      include: { revisions: { orderBy: { revision: "asc" } } },
    });
    if (!episode) throw new AppError("EPISODE_NOT_FOUND", "阶段检查点不存在或不属于当前项目", 404);

    const revision = episode.revisions.find((item) => item.revision === input.revision);
    if (!revision) throw new AppError("EPISODE_REVISION_NOT_FOUND", "要确认的检查点版本不存在", 404);

    if (revision.status === "PUBLISHED") {
      if (revision.requestId === input.requestId) {
        return serializeEpisode(episode);
      }
      throw new AppError("EPISODE_REVISION_ALREADY_PUBLISHED", "该检查点版本已用其他请求确认过", 409);
    }
    if (episode.status !== "DRAFT") {
      throw new AppError("EPISODE_STATE_CONFLICT", `检查点当前状态为 ${episode.status}，不能确认新版本`, 409);
    }
    if (input.expectedSourceHash !== undefined && input.expectedSourceHash !== revision.sourceHash) {
      throw new AppError("EPISODE_SOURCE_CHANGED", "检查点的来源在预览后发生了变化，请重新生成预览", 409);
    }

    const published = await tx.episodeRevision.updateMany({
      where: { id: revision.id, status: "DRAFT" },
      data: { status: "PUBLISHED", requestId: input.requestId },
    });
    if (published.count === 0) {
      // 并发下另一请求已完成确认：重新读取并按幂等语义返回
      const refreshed = await tx.projectEpisode.findFirst({
        where: { id: episodeId, projectId },
        include: { revisions: { orderBy: { revision: "asc" } } },
      });
      if (!refreshed) throw new AppError("EPISODE_NOT_FOUND", "阶段检查点不存在或不属于当前项目", 404);
      return serializeEpisode(refreshed);
    }
    const updated = await tx.projectEpisode.update({
      where: { id: episode.id },
      data: { status: "PUBLISHED" },
      include: { revisions: { orderBy: { revision: "asc" } } },
    });
    return serializeEpisode(updated);
  });
}

export async function listProjectEpisodes(projectId: string): Promise<EpisodeData[]> {
  ensureEpisodeEnabled();
  const rows = await db.projectEpisode.findMany({
    where: { projectId, status: { not: "ARCHIVED" } },
    include: { revisions: { orderBy: { revision: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  const result: EpisodeData[] = [];
  for (const row of rows) {
    const latest = row.revisions[row.revisions.length - 1];
    if (row.status === "PUBLISHED" && latest) {
      const report = await evaluateEpisodeFreshness(projectId, latest);
      await persistStaleness(row.id, report);
      result.push(serializeEpisode({ ...row, status: mapFreshnessStatus(report.status, row.status) }, report));
    } else {
      result.push(serializeEpisode(row));
    }
  }
  return result;
}

function mapFreshnessStatus(status: EpisodeFreshnessReport["status"], current: string): string {
  if (current !== "PUBLISHED" && current !== "PARTIALLY_STALE" && current !== "STALE") return current;
  return status;
}

async function persistStaleness(episodeId: string, report: EpisodeFreshnessReport) {
  if (report.status === "FRESH") return;
  await db.projectEpisode.updateMany({
    where: { id: episodeId, status: "PUBLISHED" },
    data: { status: report.status },
  });
}

export async function getProjectEpisode(projectId: string, episodeId: string): Promise<EpisodeData> {
  ensureEpisodeEnabled();
  const row = await loadEpisode(projectId, episodeId);
  const latest = row.revisions[row.revisions.length - 1];
  if (row.status === "PUBLISHED" || row.status === "PARTIALLY_STALE" || row.status === "STALE") {
    if (latest) {
      const report = await evaluateEpisodeFreshness(projectId, latest);
      await persistStaleness(row.id, report);
      return serializeEpisode({ ...row, status: mapFreshnessStatus(report.status, row.status) }, report);
    }
  }
  return serializeEpisode(row);
}

/**
 * 来源变化后的局部失效评估：只定位受影响的 claim，不让整份检查点作废。
 * 归档不改变事实有效性，因此 ARCHIVED 来源仍视为可用。
 */
export async function evaluateEpisodeFreshness(
  projectId: string,
  revision: { id: string; endSnapshotId: string | null; sourceRefs: unknown; claims: unknown },
): Promise<EpisodeFreshnessReport> {
  const refs = revision.sourceRefs as EpisodeSourceRef[];
  const claims = revision.claims as EpisodeClaim[];
  const states = new Map<string, EpisodeSourceState>();

  const cardRefs = refs.filter((ref) => ref.kind === "CARD" || ref.kind === "ACTION_RESULT");
  const temporalStates = cardRefs.length > 0
    ? await getTemporalSearchStates(projectId, [...new Set(cardRefs.map((ref) => ref.entityId))], new Date())
    : new Map();

  for (const ref of refs) {
    if (ref.kind === "CARD" || ref.kind === "ACTION_RESULT") {
      const card = await db.knowledgeCard.findFirst({ where: { id: ref.entityId, projectId } });
      if (!card) {
        states.set(ref.refId, { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "DELETED", displayReason: "来源记录已被删除" });
        continue;
      }
      const state = temporalStates.get(ref.entityId);
      const topLevel = state?.topLevelState ?? "CURRENT";
      if (topLevel === "SUPERSEDED") {
        states.set(ref.refId, { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "SUPERSEDED", displayReason: `来源已被《${state?.supersededBy?.title ?? "新记录"}》取代` });
      } else if (topLevel === "CONTESTED") {
        states.set(ref.refId, { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "CONTESTED", displayReason: "来源记录当前处于争议状态" });
      } else {
        // UNKNOWN（证据不足）是记录的初始正常态，不构成来源漂移；只有取代/争议/删除才触发失效
        states.set(ref.refId, { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "AVAILABLE", displayReason: "来源当前有效" });
      }
      continue;
    }
    if (ref.kind === "ATTACHMENT_REVISION") {
      const row = await db.attachmentRevision.findFirst({ where: { id: ref.entityId } });
      if (!row) {
        states.set(ref.refId, { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "DELETED", displayReason: "来源附件修订已被删除" });
        continue;
      }
      const newer = await db.attachmentRevision.findFirst({
        where: { attachmentId: row.attachmentId, revisionIndex: { gt: row.revisionIndex } },
      });
      states.set(ref.refId, newer
        ? { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "SUPERSEDED", displayReason: "附件已生成新修订" }
        : { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "AVAILABLE", displayReason: "来源当前有效" });
      continue;
    }
    if (ref.kind === "SNAPSHOT") {
      const snapshot = await db.projectStateSnapshot.findFirst({ where: { id: ref.entityId, projectId } });
      if (!snapshot) {
        states.set(ref.refId, { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "DELETED", displayReason: "来源快照不存在" });
      } else if (snapshot.policyVersion !== PROJECT_STATE_POLICY_VERSION) {
        states.set(ref.refId, { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "POLICY_CHANGED", displayReason: "评估规则版本已更新，旧结论不能直接比较" });
      } else {
        states.set(ref.refId, { refId: ref.refId, kind: ref.kind, entityId: ref.entityId, state: "AVAILABLE", displayReason: "来源当前有效" });
      }
    }
  }

  const affectedClaims: EpisodeClaimFreshness[] = [];
  for (const claim of claims) {
    const badRefs = claim.sourceRefIds
      .map((refId) => states.get(refId))
      .filter((state): state is EpisodeSourceState => Boolean(state) && state!.state !== "AVAILABLE");
    if (badRefs.length > 0) {
      affectedClaims.push({ claimId: claim.claimId, affected: true, reason: badRefs.map((state) => state.displayReason).join("；") });
    }
  }

  const factClaims = claims.filter((claim) => claim.kind === "FACT");
  const affectedFactIds = new Set(affectedClaims.map((item) => item.claimId));
  const affectedFactRatio = factClaims.length > 0
    ? factClaims.filter((claim) => affectedFactIds.has(claim.claimId)).length / factClaims.length
    : 0;
  // 基线快照是检查点有效性的锚点：终点快照被删除或规则升级时整份检查点过期
  const endRef = revision.endSnapshotId
    ? refs.find((ref) => ref.kind === "SNAPSHOT" && ref.entityId === revision.endSnapshotId)
    : undefined;
  const endRefState = endRef ? states.get(endRef.refId) : undefined;
  const baselineInvalid = endRefState ? endRefState.state === "DELETED" || endRefState.state === "POLICY_CHANGED" : false;
  const status: EpisodeFreshnessReport["status"] =
    baselineInvalid || affectedFactRatio > 0.5 ? "STALE" : affectedClaims.length > 0 ? "PARTIALLY_STALE" : "FRESH";

  return {
    status,
    affectedClaims,
    sources: [...states.values()],
    evaluatedAt: new Date().toISOString(),
  };
}

/** 刷新生成新的 DRAFT revision；不覆盖旧版。只有规则文案变化而事实未变时，模板段落会如实说明 */
export async function refreshProjectEpisode(projectId: string, episodeId: string): Promise<EpisodeData> {
  ensureEpisodeEnabled();
  const episode = await loadEpisode(projectId, episodeId);
  if (episode.status === "ARCHIVED") {
    throw new AppError("EPISODE_ARCHIVED", "已归档的检查点不能刷新", 409);
  }

  const sources = await collectSources(projectId, episode.windowStart, new Date(Math.min(episode.windowEnd.getTime(), Date.now())));
  const { claims, summary } = buildTemplateClaims(sources, episode.windowStart, episode.windowEnd);
  appendNextStepClaims(claims, summary, await collectNextStepCandidates(projectId));
  const compressed = await compressEpisodeSummary(summary);
  const sourceHash = sha256(JSON.stringify(sources.refs.map((ref) => [ref.kind, ref.entityId, ref.revisionIndex, ref.observedAt, ref.contentHash])));
  const nextRevision = episode.revisions[episode.revisions.length - 1].revision + 1;

  const updated = await db.projectEpisode.update({
    where: { id: episode.id },
    data: {
      status: "DRAFT",
      revisions: {
        create: {
          revision: nextRevision,
          baseSnapshotId: sources.baseSnapshotId,
          endSnapshotId: sources.endSnapshotId,
          sourceHash,
          sourceRefs: sources.refs as unknown as Prisma.InputJsonValue,
          claims: claims as unknown as Prisma.InputJsonValue,
          summary: compressed.summary as unknown as Prisma.InputJsonValue,
          generationMode: compressed.generationMode,
          provider: compressed.provider,
          fallbackReason: compressed.fallbackReason,
          status: "DRAFT",
        },
      },
    },
    include: { revisions: { orderBy: { revision: "asc" } } },
  });
  return serializeEpisode(updated);
}

export async function getLatestPublishedEpisode(projectId: string): Promise<EpisodeData | null> {
  const row = await db.projectEpisode.findFirst({
    where: { projectId, status: { in: ["PUBLISHED", "PARTIALLY_STALE", "STALE"] } },
    include: { revisions: { orderBy: { revision: "asc" } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;
  const latest = row.revisions.find((item) => item.status === "PUBLISHED") ?? row.revisions[row.revisions.length - 1];
  if (!latest) return null;
  const report = await evaluateEpisodeFreshness(projectId, latest);
  const data = serializeEpisode(row, report);
  data.revisions = [serializeRevision(latest)];
  return data;
}
