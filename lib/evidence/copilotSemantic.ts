import { ruleVerdict } from "./semanticRules";
import type { ClaimJudge } from "@/lib/mission/claimVerifier";
import type { EvidenceAssessment } from "./assessment";

/** 默认只运行本地规则；显式启用时最多三次共享 Judge，由调用方保留配额与审计。 */
export async function assessCopilotSemantics(claims: Array<{ text: string; cardIds: string[] }>, cards: Array<{ id: string; summary: string }>, judge?: ClaimJudge) {
  const checks = new Map<string, Record<string, EvidenceAssessment["semanticVerdict"]>>();
  let calls = 0;
  for (const claim of claims.slice(0, 12)) {
    const sources = cards.filter(card => claim.cardIds.includes(card.id));
    if (sources.length !== 1 || !judge || calls >= 3 || claim.text.length > 1000 || JSON.stringify(sources).length > 8000) continue;
    // Rules retain precedence, including counterevidence. Only unresolved claims use a model.
    if (sources.some(card => ruleVerdict(claim.text, card.summary)?.status === "CONTRADICTS")) continue;
    calls++;
    try {
      const result = await judge({ claimId: `copilot:${calls}`, text: claim.text, kind: "PROJECT_OBSERVATION",
        evidence: sources.map(card => ({ sourceId: `card:${card.id}`, kind: "PROJECT", knowledgeClass: "PROJECT_OBSERVATION",
          text: card.summary, context: card.summary, hash: "", fullSource: true })) });
      // Verdict concerns the combined evidence, not each individual source.
      if (sources.length === 1) checks.set(sources[0].id, { ...checks.get(sources[0].id), [claim.text]: result.verdict });
    } catch { /* Explicitly remains NOT_CHECKED; a failed Judge never provides support. */ }
  }
  return checks;
}
