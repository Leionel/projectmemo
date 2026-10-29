import { AppError } from "@/lib/api";
import type { ConversationSource } from "@/lib/types/conversation";
import type { ResearchCoverage } from "@/lib/types/conversationResearch";

/** Binding and date arithmetic are deterministic; semantic applicability remains a research assessment. */
export function bindResearchCoverage(coverage: ResearchCoverage, sources: ConversationSource[]) {
  const canonical = (id: string) => {
    const matches = sources.filter(s => s.id === id || s.sourceId === id);
    if (matches.length !== 1) throw new AppError("RESEARCH_COVERAGE_UNBOUND", "研究判断未绑定唯一实际来源", 409);
    return matches[0].id;
  };
  for (const facet of coverage.facets) {
    facet.sourceIds = facet.sourceIds.map(canonical);
    facet.conflicts = facet.conflicts.map(c => ({ ...c, sourceIds: c.sourceIds.map(canonical) }));
    const refs = [...facet.sourceIds, ...facet.conflicts.flatMap(c => c.sourceIds)];
    if (refs.some(id => !sources.some(s => s.id === id)) || facet.conflicts.some(c => new Set(c.sourceIds).size < 2)) throw new AppError("RESEARCH_COVERAGE_UNBOUND", "覆盖或冲突未绑定不同的实际来源", 409);
    const evidence = sources.filter(s => facet.sourceIds.includes(s.id));
    if (facet.coverage === "READ_SUFFICIENT" && (!evidence.length || evidence.every(s => s.readScope === "SUMMARY" || !s.excerpt.trim()))) facet.coverage = evidence.length ? "SUMMARY_ONLY" : "UNKNOWN";
    if (facet.kind === "PROJECT_FACT" && facet.coverage === "READ_SUFFICIENT" && evidence.every(s => s.knowledgeClass === "EXTERNAL_REFERENCE")) facet.coverage = "UNKNOWN";
  }
  for (const a of coverage.temporalAssessments ?? []) {
    a.sourceId = canonical(a.sourceId);
    const source = sources.find(s => s.id === a.sourceId);
    if (!source?.excerpt.includes(a.quote)) throw new AppError("UNSUPPORTED_QUOTE", "生效判断没有可核对的实际片段", 409);
    if (a.edition && !a.quote.includes(a.edition)) a.edition = null;
    const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && a.quote.includes(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
    a.effectiveFrom = date(a.effectiveFrom); a.effectiveUntil = date(a.effectiveUntil);
    a.status = a.effectiveFrom && a.effectiveUntil && a.effectiveFrom > a.effectiveUntil ? "CONFLICTED" : a.effectiveFrom && a.effectiveFrom > coverage.asOf ? "FUTURE" : a.effectiveUntil && a.effectiveUntil < coverage.asOf ? "SUPERSEDED" :
      a.effectiveFrom && a.effectiveUntil && a.effectiveFrom <= coverage.asOf && coverage.asOf <= a.effectiveUntil ? "CURRENT" : "UNKNOWN";
  }
  return coverage;
}
