import fs from "node:fs";
import path from "node:path";
import { evaluateTemporalCard, wouldCreateSupersessionCycle } from "@/lib/memory/temporalLedger";
import type { TemporalCardSummary, TemporalDecisionStatus, TemporalRelationData } from "@/lib/types";

type DecisionCase = {
  kind: "decision";
  id: string;
  category: string;
  card: TemporalCardSummary;
  relations: TemporalRelationData[];
  asOf: string;
  manualLabel: { status: TemporalDecisionStatus; current: boolean; reason: string | null };
};

type CycleCase = {
  kind: "cycle";
  id: string;
  category: string;
  edges: Array<{ currentCardId: string; relatedCardId: string }>;
  proposed: { currentCardId: string; relatedCardId: string };
  manualLabel: { cycle: boolean };
};

type BenchmarkCase = DecisionCase | CycleCase;

const AS_OF = "2026-08-26T00:00:00.000Z";

function card(id: string, day = 20): TemporalCardSummary {
  return { id, title: `决策 ${id}`, summary: `决策 ${id} 的可追溯内容`, createdAt: `2026-08-${day}T00:00:00.000Z` };
}

function relation(id: string, type: TemporalRelationData["relationType"], overrides: Partial<TemporalRelationData> = {}): TemporalRelationData {
  return {
    id,
    relationType: type,
    reason: `${id} 的人工标注关系理由`,
    confidence: 0.9,
    confirmed: true,
    confirmedAt: "2026-08-23T00:00:00.000Z",
    revokedAt: null,
    validFrom: "2026-08-23T00:00:00.000Z",
    validTo: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    currentCard: card(`${id}-new`, 23),
    relatedCard: card(`${id}-old`),
    ...overrides,
  };
}

function buildCases(): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  for (let index = 1; index <= 12; index += 1) {
    const item = relation(`supersedes-${index}`, "SUPERSEDES");
    cases.push({ kind: "decision", id: `S-${index}`, category: "明确取代", card: item.relatedCard, relations: [item], asOf: AS_OF, manualLabel: { status: "SUPERSEDED", current: false, reason: item.reason } });
  }
  for (let index = 1; index <= 10; index += 1) {
    const item = relation(`supports-${index}`, index % 2 === 0 ? "SUPPORTS" : "DERIVED_FROM");
    cases.push({ kind: "decision", id: `P-${index}`, category: "补充支持", card: item.currentCard, relations: [item], asOf: AS_OF, manualLabel: { status: "CURRENT", current: true, reason: item.reason } });
  }
  for (let index = 1; index <= 10; index += 1) {
    const item = relation(`conflict-${index}`, "CONTRADICTS");
    cases.push({ kind: "decision", id: `C-${index}`, category: "矛盾冲突", card: item.relatedCard, relations: [item], asOf: AS_OF, manualLabel: { status: "CONFLICT", current: true, reason: item.reason } });
  }
  for (let index = 1; index <= 8; index += 1) {
    const item = relation(`pending-${index}`, "SUPERSEDES", { confirmed: false, confirmedAt: null, validFrom: null });
    cases.push({ kind: "decision", id: `U-${index}`, category: "未确认提议", card: item.relatedCard, relations: [item], asOf: AS_OF, manualLabel: { status: "PENDING", current: true, reason: item.reason } });
  }
  for (let index = 1; index <= 8; index += 1) {
    const item = relation(`revoked-${index}`, "SUPERSEDES", { revokedAt: "2026-08-25T00:00:00.000Z", validTo: "2026-08-25T00:00:00.000Z" });
    cases.push({ kind: "decision", id: `R-${index}`, category: "方案回滚", card: item.relatedCard, relations: [item], asOf: AS_OF, manualLabel: { status: "REVOKED", current: true, reason: item.reason } });
  }
  for (let index = 1; index <= 7; index += 1) {
    cases.push({ kind: "decision", id: `I-${index}`, category: "证据不足", card: card(`insufficient-${index}`), relations: [], asOf: AS_OF, manualLabel: { status: "INSUFFICIENT", current: true, reason: null } });
  }
  for (let index = 1; index <= 3; index += 1) {
    cases.push({ kind: "cycle", id: `Y-${index}`, category: "取代关系成环", edges: [{ currentCardId: "b", relatedCardId: "a" }, { currentCardId: "c", relatedCardId: "b" }], proposed: { currentCardId: "a", relatedCardId: "c" }, manualLabel: { cycle: true } });
  }
  for (let index = 1; index <= 2; index += 1) {
    cases.push({ kind: "cycle", id: `N-${index}`, category: "合法取代链", edges: [{ currentCardId: "b", relatedCardId: "a" }], proposed: { currentCardId: `new-${index}`, relatedCardId: "b" }, manualLabel: { cycle: false } });
  }
  return cases;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Math.round((numerator / denominator) * 1000) / 1000;
}

const cases = buildCases();
const predictions = cases.map((item) => {
  if (item.kind === "cycle") {
    return { ...item, prediction: { cycle: wouldCreateSupersessionCycle(item.edges, item.proposed.currentCardId, item.proposed.relatedCardId) } };
  }
  const prediction = evaluateTemporalCard(item.card, item.relations, new Date(item.asOf));
  return { ...item, prediction: { status: prediction.status, current: prediction.current, reason: prediction.temporalReason } };
});

const decisions = predictions.filter((item): item is Extract<typeof item, { kind: "decision" }> => item.kind === "decision");
const cycles = predictions.filter((item): item is Extract<typeof item, { kind: "cycle" }> => item.kind === "cycle");
const conflictTp = decisions.filter((item) => item.manualLabel.status === "CONFLICT" && item.prediction.status === "CONFLICT").length;
const conflictFp = decisions.filter((item) => item.manualLabel.status !== "CONFLICT" && item.prediction.status === "CONFLICT").length;
const conflictFn = decisions.filter((item) => item.manualLabel.status === "CONFLICT" && item.prediction.status !== "CONFLICT").length;
const conflictPrecision = ratio(conflictTp, conflictTp + conflictFp);
const conflictRecall = ratio(conflictTp, conflictTp + conflictFn);
const predictedSuperseded = decisions.filter((item) => item.prediction.status === "SUPERSEDED");
const reasonPredictions = decisions.filter((item) => item.prediction.reason !== null);

const metrics = {
  caseCount: cases.length,
  conflictDetectionF1: ratio(2 * conflictPrecision * conflictRecall, conflictPrecision + conflictRecall),
  supersessionPrecision: ratio(predictedSuperseded.filter((item) => item.manualLabel.status === "SUPERSEDED").length, predictedSuperseded.length),
  currentFactAccuracy: ratio(decisions.filter((item) => item.prediction.current === item.manualLabel.current).length, decisions.length),
  evidencePrecision: ratio(reasonPredictions.filter((item) => item.prediction.reason === item.manualLabel.reason).length, reasonPredictions.length),
  unconfirmedAutoActivation: decisions.filter((item) => item.category === "未确认提议" && item.prediction.current === false).length,
  supersessionCyclesAccepted: cycles.filter((item) => item.manualLabel.cycle && !item.prediction.cycle).length,
  crossProjectRelationWrites: 0,
};

const output = {
  benchmark: "ProjectMemo Temporal Evidence Ledger deterministic benchmark v1",
  generatedAt: new Date().toISOString(),
  datasetNote: "60 组人工定义模式化样例；跨项目写入指标由 tests/temporalLedger.test.ts 集成测试验证。后续仍需补充真实项目盲测集。",
  thresholds: { conflictDetectionF1: 0.85, supersessionPrecision: 0.9, currentFactAccuracy: 0.9, evidencePrecision: 0.95, unconfirmedAutoActivation: 0, crossProjectRelationWrites: 0, supersessionCyclesAccepted: 0 },
  metrics,
  passed: metrics.caseCount >= 60 && metrics.conflictDetectionF1 >= 0.85 && metrics.supersessionPrecision >= 0.9 && metrics.currentFactAccuracy >= 0.9 && metrics.evidencePrecision >= 0.95 && metrics.unconfirmedAutoActivation === 0 && metrics.crossProjectRelationWrites === 0 && metrics.supersessionCyclesAccepted === 0,
  cases: predictions,
};

const outputDirectory = path.resolve("evidence/2.1/temporal");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, "benchmark.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: output.passed, metrics }, null, 2));
if (!output.passed) process.exitCode = 1;
