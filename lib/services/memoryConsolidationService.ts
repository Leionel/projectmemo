import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";
import type {
  ConsolidationCardSummary,
  ConsolidationProposal,
  ConsolidationReceipt,
} from "@/lib/types/consolidation";
import type { Prisma } from "@/lib/generated/prisma/client";

/** 相似度阈值：低于它不生成建议，避免把不同事实当成重复 */
const SIMILARITY_THRESHOLD = 0.55;
const MAX_PROPOSALS = 20;
/** 归并候选上限，防止大项目两两比较退化 */
const MAX_CANDIDATE_CARDS = 300;

function ensureConsolidationEnabled() {
  if (!isFeatureEnabled("PROJECT_MEMORY_CONSOLIDATION_ENABLED", false)) {
    throw new AppError("MEMORY_CONSOLIDATION_DISABLED", "记忆归并功能当前已关闭", 503);
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

/** 中文友好归一化：去空白与标点，保留字符序列用于二元组比较 */
function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>();
  if (value.length === 1) {
    result.add(value);
    return result;
  }
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

/** 二元组 Jaccard：对中英混排都稳定，且不引入模型判定 */
export function similarityScore(left: string, right: string): number {
  const a = bigrams(normalizeText(left));
  const b = bigrams(normalizeText(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function cardText(card: { title: string; summary: string }): string {
  return `${card.title}\n${card.summary}`;
}

function proposalIdFor(leftId: string, rightId: string): string {
  const [first, second] = [leftId, rightId].sort();
  return createHash("sha256").update(`merge:${first}:${second}`).digest("hex").slice(0, 24);
}

interface CandidateCard {
  id: string;
  title: string;
  summary: string;
  importance: number;
  createdAt: Date;
  topLevelState: string;
}

function toSummary(card: CandidateCard): ConsolidationCardSummary {
  return {
    id: card.id,
    title: card.title,
    summary: card.summary,
    importance: card.importance,
    createdAt: iso(card.createdAt),
    topLevelState: card.topLevelState,
  };
}

/** 主记录建议：重要度高者优先，其次更早创建，最后用 ID 保证稳定 */
function pickMaster(cards: CandidateCard[]): CandidateCard {
  return cards.reduce((best, item) => {
    if (item.importance !== best.importance) return item.importance > best.importance ? item : best;
    if (item.createdAt.getTime() !== best.createdAt.getTime()) return item.createdAt < best.createdAt ? item : best;
    return item.id.localeCompare(best.id) < 0 ? item : best;
  });
}

/**
 * 生成归并建议（只读，不写库）。
 * UNKNOWN 不当作重复事实；已存在取代/反驳关系的卡片不静默合并——
 * 它们的关系本身就是证据，必须由用户在关系视图里处理。
 */
export async function listConsolidationProposals(projectId: string): Promise<ConsolidationProposal[]> {
  ensureConsolidationEnabled();
  const rows = await db.knowledgeCard.findMany({
    where: { projectId, archivedAt: null },
    select: { id: true, title: true, summary: true, importance: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: MAX_CANDIDATE_CARDS,
  });
  if (rows.length < 2) return [];

  const temporalStates = await getTemporalSearchStates(projectId, rows.map((row) => row.id), new Date());
  const candidates: CandidateCard[] = rows
    .map((row) => ({
      ...row,
      topLevelState: temporalStates.get(row.id)?.topLevelState ?? "CURRENT",
    }))
    // 争议中的记录内容本身有分歧，归并会把分歧藏起来：排除。
    // UNKNOWN（证据不足）保留为候选，但只作为「建议」交用户判断，
    // 相似度一律来自文本，不把 UNKNOWN 当成两条记录是同一事实的证据。
    .filter((row) => row.topLevelState !== "CONTESTED");

  // 已确认的取代/反驳关系对：这些卡片之间存在明确证据关系，不参与自动归并
  const relations = await db.cardRelation.findMany({
    where: {
      relationType: { in: ["SUPERSEDES", "CONTRADICTS"] },
      revokedAt: null,
      OR: [{ currentCardId: { in: candidates.map((row) => row.id) } }, { relatedCardId: { in: candidates.map((row) => row.id) } }],
    },
    select: { currentCardId: true, relatedCardId: true },
  });
  const excludedPairs = new Set(relations.map((row) => [row.currentCardId, row.relatedCardId].sort().join("|")));

  const proposals: ConsolidationProposal[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i];
      const right = candidates[j];
      if (excludedPairs.has([left.id, right.id].sort().join("|"))) continue;
      const score = similarityScore(cardText(left), cardText(right));
      if (score < SIMILARITY_THRESHOLD) continue;
      const pair = [left, right];
      const master = pickMaster(pair);
      const other = pair.find((item) => item.id !== master.id)!;
      const unknownCount = pair.filter((item) => item.topLevelState === "UNKNOWN").length;
      proposals.push({
        proposalId: proposalIdFor(left.id, right.id),
        reason: unknownCount > 0
          ? `标题与摘要相似度 ${(score * 100).toFixed(0)}%，可能是同一条事实的重复记录；其中 ${unknownCount} 条证据仍不足，请人工确认后再归并`
          : `标题与摘要相似度 ${(score * 100).toFixed(0)}%，可能是同一条事实的重复记录`,
        similarityScore: Number(score.toFixed(4)),
        masterCardId: master.id,
        cards: [toSummary(master), toSummary(other)],
        mergedPreview: `${master.title}\n${master.summary}\n\n（合并自：${other.title} — ${other.summary}）`,
        preservedSources: ["原始 Capture 全文", "附件修订链", "已确认关系", "历史状态快照"],
      });
      if (proposals.length >= MAX_PROPOSALS) return proposals;
    }
  }
  return proposals.sort((a, b) => b.similarityScore - a.similarityScore || a.proposalId.localeCompare(b.proposalId));
}

export interface ConsolidationConfirmInput {
  masterCardId: string;
  mergedCardIds: string[];
  reason?: string;
  requestId: string;
  similarityScore?: number;
}

function consolidationInputHash(masterCardId: string, mergedCardIds: string[]): string {
  return createHash("sha256").update(JSON.stringify({
    masterCardId,
    mergedCardIds: [...mergedCardIds].sort(),
  })).digest("hex");
}

function assertReceiptReplay(
  row: { masterCardId: string; mergedCardIds: unknown; inputHash: string | null },
  masterCardId: string,
  mergedCardIds: string[],
  inputHash: string,
) {
  const storedIds = Array.isArray(row.mergedCardIds) ? [...(row.mergedCardIds as string[])].sort() : [];
  const sameLegacyInput = row.masterCardId === masterCardId &&
    JSON.stringify(storedIds) === JSON.stringify([...mergedCardIds].sort());
  if ((row.inputHash !== null && row.inputHash !== inputHash) || (row.inputHash === null && !sameLegacyInput)) {
    throw new AppError("REQUEST_ID_REUSED", "该 requestId 已用于不同的归并请求，请换一个新的请求标识", 409);
  }
}

async function serializeReceipt(row: {
  id: string;
  projectId: string;
  masterCardId: string;
  mergedCardIds: unknown;
  reason: string;
  similarityScore: number;
  status: string;
  createdAt: Date;
  revokedAt: Date | null;
}): Promise<ConsolidationReceipt> {
  const master = await db.knowledgeCard.findUnique({ where: { id: row.masterCardId }, select: { title: true } });
  return {
    id: row.id,
    projectId: row.projectId,
    masterCardId: row.masterCardId,
    masterCardTitle: master?.title ?? "",
    mergedCardIds: Array.isArray(row.mergedCardIds) ? (row.mergedCardIds as string[]) : [],
    reason: row.reason,
    similarityScore: row.similarityScore,
    status: row.status as ConsolidationReceipt["status"],
    createdAt: iso(row.createdAt),
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
  };
}

/**
 * 确认归并：主记录保持不变，被归并卡标记归档并留下生命周期事件与回执。
 * 不删除 Capture、附件修订、关系与历史快照；撤销按回执恢复。
 */
export async function confirmConsolidation(projectId: string, input: ConsolidationConfirmInput): Promise<ConsolidationReceipt> {
  ensureConsolidationEnabled();
  if (!input.requestId || input.requestId.trim().length === 0) {
    throw new AppError("VALIDATION_ERROR", "requestId 不能为空", 422);
  }
  const mergedCardIds = [...new Set(input.mergedCardIds ?? [])].filter((id) => id !== input.masterCardId);
  if (mergedCardIds.length === 0) {
    throw new AppError("VALIDATION_ERROR", "至少选择一条要归并的记录", 422);
  }
  const inputHash = consolidationInputHash(input.masterCardId, mergedCardIds);

  // 先重放已提交结果：即使随后卡片状态又发生变化，同一请求仍返回原回执。
  const replay = await db.memoryMergeReceipt.findFirst({ where: { projectId, requestId: input.requestId } });
  if (replay) {
    assertReceiptReplay(replay, input.masterCardId, mergedCardIds, inputHash);
    return serializeReceipt(replay);
  }

  // 争议中的记录不合并：先解决争议，否则归并会把分歧藏进主记录。
  // 时态判定走独立读取，放在事务外，避免与写事务共用连接。
  const temporalStates = await getTemporalSearchStates(projectId, [input.masterCardId, ...mergedCardIds], new Date());
  for (const [, state] of temporalStates) {
    if (state.topLevelState === "CONTESTED") {
      throw new AppError("CONSOLIDATION_CONTESTED", "其中存在争议中的记录，请先处理争议再归并", 409);
    }
  }

  let receipt: Parameters<typeof serializeReceipt>[0];
  try {
    receipt = await db.$transaction(async (tx) => {
      const existing = await tx.memoryMergeReceipt.findFirst({ where: { projectId, requestId: input.requestId } });
      if (existing) {
        assertReceiptReplay(existing, input.masterCardId, mergedCardIds, inputHash);
        return existing;
      }

      const cards = await tx.knowledgeCard.findMany({
        where: { projectId, id: { in: [input.masterCardId, ...mergedCardIds] } },
        select: { id: true, archivedAt: true },
      });
      const found = new Set(cards.map((card) => card.id));
      for (const id of [input.masterCardId, ...mergedCardIds]) {
        if (!found.has(id)) {
          throw new AppError("CARD_NOT_FOUND", "要归并的记录不存在或不属于当前项目", 404);
        }
      }
      const master = cards.find((card) => card.id === input.masterCardId)!;
      if (master.archivedAt !== null) {
        throw new AppError("MASTER_CARD_ARCHIVED", "主记录已归档，请先恢复后再归并", 409);
      }
      if (cards.some((card) => card.id !== input.masterCardId && card.archivedAt !== null)) {
        throw new AppError("MERGED_CARD_ARCHIVED", "被归并记录中有已归档项，请先恢复或重新选择", 409);
      }

      // 冲突/取代关系不允许静默合并：必须由用户在关系视图里显式处理
      const conflicting = await tx.cardRelation.findFirst({
        where: {
          relationType: { in: ["SUPERSEDES", "CONTRADICTS"] },
          revokedAt: null,
          OR: [
            { currentCardId: input.masterCardId, relatedCardId: { in: mergedCardIds } },
            { currentCardId: { in: mergedCardIds }, relatedCardId: input.masterCardId },
            { currentCardId: { in: mergedCardIds }, relatedCardId: { in: mergedCardIds } },
          ],
        },
        select: { id: true },
      });
      if (conflicting) {
        throw new AppError("CONSOLIDATION_CONFLICT", "这些记录之间存在取代或反驳关系，不能静默合并，请先在关系视图处理", 409);
      }

      // 先创建回执，再把回执 ID 写进生命周期原因；撤销只匹配本次归并。
      const created = await tx.memoryMergeReceipt.create({
        data: {
          projectId,
          masterCardId: input.masterCardId,
          mergedCardIds: mergedCardIds as unknown as Prisma.InputJsonValue,
          reason: input.reason?.trim() ? input.reason.trim() : "用户确认归并重复记录",
          similarityScore: input.similarityScore ?? 0,
          status: "ACTIVE",
          requestId: input.requestId,
          inputHash,
        },
      });

      const now = new Date();
      for (const cardId of mergedCardIds) {
        const archived = await tx.knowledgeCard.updateMany({
          where: { id: cardId, projectId, archivedAt: null },
          data: { archivedAt: now },
        });
        if (archived.count !== 1) {
          throw new AppError("MERGED_CARD_ARCHIVED", "被归并记录的状态已变化，请重新选择", 409);
        }
        await tx.memoryLifecycleEvent.create({
          data: {
            projectId,
            cardId,
            eventType: "ARCHIVE",
            reason: `merge_receipt:${created.id}`,
            actor: "user",
          },
        });
      }
      return created;
    });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code !== "P2002") throw error;
    const raced = await db.memoryMergeReceipt.findFirst({ where: { projectId, requestId: input.requestId } });
    if (!raced) throw error;
    assertReceiptReplay(raced, input.masterCardId, mergedCardIds, inputHash);
    receipt = raced;
  }
  return serializeReceipt(receipt);
}

/** 撤销归并：恢复被归档的卡，回执标记 REVOKED；原始数据从未被删除 */
export async function revokeConsolidation(projectId: string, receiptId: string): Promise<ConsolidationReceipt> {
  ensureConsolidationEnabled();
  const result = await db.$transaction(async (tx) => {
    const receipt = await tx.memoryMergeReceipt.findFirst({ where: { id: receiptId, projectId } });
    if (!receipt) throw new AppError("MERGE_RECEIPT_NOT_FOUND", "归并回执不存在或不属于当前项目", 404);
    if (receipt.status === "REVOKED") return receipt;

    const mergedCardIds = Array.isArray(receipt.mergedCardIds) ? (receipt.mergedCardIds as unknown as string[]) : [];
    // 只有“最近一次生命周期事件仍是本回执归档”的卡才恢复；
    // 归并后若用户又手工归档/恢复，撤销不能覆盖后来的明确操作。
    for (const cardId of mergedCardIds) {
      const latest = await tx.memoryLifecycleEvent.findFirst({
        where: { projectId, cardId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (latest?.eventType !== "ARCHIVE" || latest.reason !== `merge_receipt:${receipt.id}`) continue;
      const restored = await tx.knowledgeCard.updateMany({
        where: { id: cardId, projectId, archivedAt: { not: null } },
        data: { archivedAt: null },
      });
      if (restored.count === 1) {
        await tx.memoryLifecycleEvent.create({
          data: {
            projectId,
            cardId,
            eventType: "RESTORE",
            reason: `merge_revoke:${receipt.id}`,
            actor: "user",
          },
        });
      }
    }
    return tx.memoryMergeReceipt.update({
      where: { id: receipt.id },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  });
  return serializeReceipt(result);
}

export async function listConsolidationReceipts(projectId: string): Promise<ConsolidationReceipt[]> {
  ensureConsolidationEnabled();
  const rows = await db.memoryMergeReceipt.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } });
  const receipts: ConsolidationReceipt[] = [];
  for (const row of rows) receipts.push(await serializeReceipt(row));
  return receipts;
}
