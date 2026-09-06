import { evaluateTrustReceipt, type CardEvidenceState } from "@/lib/evidence/trustReceipt";
import type { EvidenceSupportState, TemporalSupportState } from "@/lib/types";

interface BenchmarkCase {
  id: string;
  expected: EvidenceSupportState;
  cardId: string;
  evidence: CardEvidenceState[];
}

function card(cardId: string, supportState: TemporalSupportState, current = true, belongsToProject = true): CardEvidenceState {
  return { cardId, belongsToProject, current, supportState, supersededBy: null };
}

const cases: BenchmarkCase[] = [];
for (let index = 0; index < 8; index += 1) {
  cases.push({ id: `known-${index}`, expected: "SUPPORTED", cardId: `current-${index}`, evidence: [card(`current-${index}`, "INSUFFICIENT")] });
  cases.push({ id: `expired-${index}`, expected: "INSUFFICIENT", cardId: `expired-${index}`, evidence: [card(`expired-${index}`, "SUPERSEDED", false)] });
  cases.push({ id: `conflict-${index}`, expected: "CONTESTED", cardId: `conflict-${index}`, evidence: [card(`conflict-${index}`, "CONFLICT")] });
  cases.push({ id: `unknown-${index}`, expected: "INSUFFICIENT", cardId: `unknown-${index}`, evidence: [] });
  cases.push({ id: `foreign-${index}`, expected: "INSUFFICIENT", cardId: `foreign-${index}`, evidence: [card(`foreign-${index}`, "SUPPORTED", true, false)] });
}

const results = cases.map((item) => ({
  item,
  result: evaluateTrustReceipt({
    claims: [{ text: `人工标注问题 ${item.id} 的事实结论`, cardIds: [item.cardId] }],
    fallbackClaimText: "",
    fallbackCardIds: [],
    evidence: item.evidence,
    retrievalMode: "keyword_fallback",
    evaluatedAt: new Date("2026-09-02T00:00:00.000Z"),
  }),
}));

const supportedPredictions = results.filter(({ result }) => result.receipt.supportState === "SUPPORTED");
const claimEvidencePrecision = supportedPredictions.filter(({ item }) => item.expected === "SUPPORTED").length / Math.max(1, supportedPredictions.length);
const supportedClaims = results.flatMap(({ result }) => result.receipt.claims).filter((claim) => claim.support === "SUPPORTED");
const currentSourceUsage = supportedClaims.filter((claim) => claim.cardIds.length > 0 && claim.supersededCardIds.length === 0).length / Math.max(1, supportedClaims.length);
const shouldAbstain = results.filter(({ item }) => item.expected !== "SUPPORTED");
const abstentionRecall = shouldAbstain.filter(({ result }) => result.receipt.abstained).length / Math.max(1, shouldAbstain.length);
const unsupportedConfidentClaims = results.filter(({ item, result }) => item.expected !== "SUPPORTED" && result.receipt.supportState === "SUPPORTED").length;
const crossProjectCitations = results.reduce((count, { item, result }) => count + (item.id.startsWith("foreign-") ? result.acceptedCardIds.length : 0), 0);
const actionsFromInsufficient = results.filter(({ result }) => result.receipt.supportState !== "SUPPORTED" && !result.receipt.abstained).length;

const metrics = {
  cases: cases.length,
  claimEvidencePrecision,
  currentSourceUsage,
  abstentionRecall,
  unsupportedConfidentClaims,
  crossProjectCitations,
  actionsFromInsufficient,
};
console.log(JSON.stringify(metrics, null, 2));

if (
  claimEvidencePrecision < 0.95 ||
  currentSourceUsage < 0.90 ||
  abstentionRecall < 0.90 ||
  unsupportedConfidentClaims !== 0 ||
  crossProjectCitations !== 0 ||
  actionsFromInsufficient !== 0
) {
  process.exitCode = 1;
}
