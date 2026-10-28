import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";
import { evidenceAssessment } from "@/lib/evidence/assessment";
import { sourceHash } from "./repository";
import type { Actor, Source, ToolResult } from "./contracts";
import { searchAdoptedArtifacts } from "./artifactProvenanceService";

export const memoryQuerySchema = z.object({ query: z.string().trim().min(1).max(256), limit: z.number().int().min(1).max(8).default(8),
  afterId: z.string().min(1).max(160).optional(), sourceIds: z.array(z.string().min(1).max(180)).max(8).default([]) }).strict();

/** SQL 按主题筛选后分页；既不只扫最新 N 条，也不补算或发送远程嵌入。已知来源可定向读取归档记录。 */
export async function searchMissionMemory(actor: Pick<Actor, "userId" | "projectId"> & { missionId?: string; conversationId?: string }, raw: unknown): Promise<ToolResult> {
  const input = memoryQuerySchema.parse(raw);
  const terms = [...new Set(input.query.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9_]+/gu) ?? [])]
    .flatMap(term => term.length > 4 && /^[\p{Script=Han}]+$/u.test(term) ? [term, ...Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2))] : [term]).slice(0, 16);
  const ids = input.sourceIds.map(id => id.replace(/^card:/, ""));
  const where = ids.length ? { projectId: actor.projectId, id: { in: ids } } : { projectId: actor.projectId, archivedAt: null,
    OR: terms.flatMap(term => [{ title: { contains: term } }, { summary: { contains: term } }]) };
  const [cards, matched, active, total] = await Promise.all([
    db.knowledgeCard.findMany({ where: { ...where, ...(input.afterId ? { id: { gt: input.afterId, ...(ids.length ? { in: ids } : {}) } } : {}) }, orderBy: { id: "asc" }, take: input.limit + 1 }),
    db.knowledgeCard.count({ where }), db.knowledgeCard.count({ where: { projectId: actor.projectId, archivedAt: null } }), db.knowledgeCard.count({ where: { projectId: actor.projectId } }),
  ]);
  const unfilteredPage = cards.slice(0, input.limit), page: typeof cards = [];
  for (const card of unfilteredPage) if ((await sourceUse(actor.userId, actor.projectId, "card:" + card.id, db, { missionId: actor.missionId, conversationId: actor.conversationId })).state === "ALLOWED") page.push(card);
  const now = new Date();
  const states = await getTemporalSearchStates(actor.projectId, page.map(card => card.id), now);
  const sources: Source[] = [];
  for (const card of page) {
    const id = `card:${card.id}`, hash = await sourceHash(actor.projectId, id);
    const fresh = await db.knowledgeCard.findFirst({ where: { projectId: actor.projectId, id: card.id }, select: { title: true, summary: true } });
    if (!hash || fresh?.title !== card.title || fresh.summary !== card.summary) throw new AppError("SOURCE_CHANGED", "记忆刚发生变化，请重新检索", 409);
    const temporal = states.get(card.id)?.topLevelState ?? "UNKNOWN", text = `${card.title}\n${card.summary}`;
    // Preserve the source coordinate system for later exact-range citations.
    const excerpt = text;
    sources.push({ id, kind: "PROJECT", entityType: "CARD", revision: hash, hash, text: excerpt, observedAt: now.toISOString(),
      temporalState: temporal, knowledgeClass: "PROJECT_OBSERVATION", assessment: evidenceAssessment({ sourceId: id, sourceRevision: hash,
        observedAt: now.toISOString(), sourceTime: card.createdAt.toISOString(), citationAdmissibility: "ADMITTED", temporalState: temporal,
        textRange: { start: 0, end: excerpt.length }, reasonCode: text.length > excerpt.length ? "EXCERPT_ONLY" : "CITATION_ONLY" }) });
  }
  const artifacts = !ids.length && !input.afterId ? await searchAdoptedArtifacts(actor.projectId, input.query, 2, actor.userId, { missionId: actor.missionId, conversationId: actor.conversationId }) : { results: [], sources: [] };
  const coverage = { schemaVersion: 1, policy: ids.length ? "TARGETED_INCLUDE_ARCHIVED" : "TITLE_SUMMARY_PAGE", totalCards: total, activeCards: active,
    archivedExcluded: ids.length ? 0 : total - active, matchedCards: matched, returnedCards: page.length, usePolicyExcluded: unfilteredPage.length - page.length,
    nextCursor: cards.length > input.limit ? page.at(-1)!.id : null, requestedSourceIds: input.sourceIds,
    sourceIdsNotOnThisPage: input.sourceIds.filter(id => !page.some(card => `card:${card.id}` === id || card.id === id)),
    complete: !input.afterId && matched <= input.limit && page.length === unfilteredPage.length, limitations: ["仅匹配标题与摘要；无结果不表示项目中不存在该事实", "归档记录须使用 sourceIds 定向读取", "成果最多附带两条"] };
  return { data: { results: page.map(card => ({ cardId: card.id, title: card.title, summary: card.summary.slice(0, 1200), archived: !!card.archivedAt,
      temporal: states.get(card.id)?.topLevelState ?? "UNKNOWN" })), artifacts: artifacts.results, coverage },
    sources: [...sources, ...artifacts.sources], coverage, status: coverage.complete ? "SUCCESS" : "PARTIAL" };
}
