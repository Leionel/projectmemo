import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { changeAnswerSchema, type EvidenceSlice, type ReviewBase, type ChangeReviewResult } from "@/lib/types/changeReview";
import type { z } from "zod";

export function validateReviewQuotes(quotes: Array<{ ref: string; quote: string }>, evidence: EvidenceSlice[]) {
  for (const quote of quotes) {
    const source = evidence.find(s => s.ref === quote.ref);
    if (!source || !source.text.includes(quote.quote)) throw new AppError("UNSUPPORTED_REVIEW_QUOTE", "候选引用不在实际读取的原文中", 409);
  }
}
export function normalizeChangeAnswer(answer: z.infer<typeof changeAnswerSchema>, base: ReviewBase, provider: string, usageUnknown: boolean): ChangeReviewResult {
  const candidates = answer.candidates.map(candidate => {
    validateReviewQuotes(candidate.evidence, base.evidence);
    if (!base.goal.includes(candidate.goalQuote) && !JSON.stringify(base.constraints).includes(candidate.goalQuote))
      throw new AppError("UNSUPPORTED_GOAL_PREMISE", "候选前提没有对应原目标或约束", 409);
    const temporalUnknown = candidate.evidence.some(q => base.evidence.find(s => s.ref === q.ref)?.source.temporalState === "CONTESTED");
    return { ...candidate, unknown: [...new Set([...candidate.unknown, ...(temporalUnknown ? ["引用资料存在冲突，不能作为已证实前提"] : [])])],
      candidateId: jsonHash({ missionId: base.missionId, premise: candidate.premise.normalize("NFC").trim(),
        sources: candidate.evidence.map(q => q.ref).sort() }).slice(0, 32) };
  }).sort((a, b) => {
    const rank = { DIRECT: 0, PLAUSIBLE: 1, UNCLASSIFIED: 2, UNRELATED: 3 };
    return rank[a.relevance] - rank[b.relevance] || a.candidateId.localeCompare(b.candidateId);
  });
  const useful = candidates.filter(c => ["DIRECT", "PLAUSIBLE"].includes(c.relevance) && c.changeKind !== "UNRELATED" &&
    ["PROJECT_OBSERVATION", "APPLICABLE_REQUIREMENT", "APPLICABLE_METHOD"].includes(c.goalLink));
  return { schemaVersion: 2, candidates, summary: useful.length ? answer.summary : "本轮资料尚未形成影响原目标的依据，保留当前计划。" + answer.summary,
    decision: !useful.length ? "KEEP_PLAN" : answer.decision,
    provider, usageUnknown };
}
