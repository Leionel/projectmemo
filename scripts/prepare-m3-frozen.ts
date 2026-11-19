/** Generates the frozen M3 rule/report fixtures once. Tests read the committed JSON; do not regenerate casually. */
import fs from "node:fs";
import path from "node:path";
import { challengeQuestions, metricChallengeQuestions } from "../lib/challenges/rules";
import { compareMetricRecords, parseMetricRecords } from "../lib/experiments/metrics";
import { assessRevision, type DraftView, type QualitySource } from "../lib/evaluation/contentQuality";
import type { Source } from "../lib/mission/contracts";

const dir = path.resolve("planning/v2-first-loop/evaluation");
fs.mkdirSync(dir, { recursive: true });
const source = (id: string, text: string): Source => (({ id, hash: id.padEnd(64, "0").slice(0, 64), projectId: "p", conversationId: null,
  kind: "capture", entityType: "capture", entityId: id.split(":")[1], revision: "1", text, observedAt: "2026-11-17T00:00:00.000Z" }) as unknown as Source);
const block = (id: string, sourceIds: string[], text = "稿件段落 " + id) => ({ blockId: id, kind: "PROJECT_OBSERVATION", text, sourceIds, citations: sourceIds.map(sourceId => ({ sourceId })) });

const evidenceCases = [];
for (let count = 1; count <= 10; count++) {
  const sources = Array.from({ length: Math.min(count, 16) }, (_, index) => source("capture:e" + count + "-" + index, "来源 " + index + " 的原文记录"));
  const linked = count === 9 ? [] : sources.slice(0, Math.min(countsFor(count), sources.length)).map(s => s.id);
  const blocks = count === 9 ? [{ blockId: "inference", kind: "INFERENCE", text: "只有推断，没有引用", sourceIds: [] }]
    : [block("b" + count, linked), { blockId: "note", kind: "INFERENCE", text: "推断段", sourceIds: [] }];
  const expectedError = count === 9;
  const frozen = expectedError ? null : challengeQuestions("EVIDENCE", { blocks }, sources)[0];
  evidenceCases.push({ id: "rule-evidence-" + count, kind: "EVIDENCE", synthetic: true, realAuthorized: false,
    sources, content: { blocks }, expectedError, expected: frozen?.expected ?? [] });
}
function countsFor(count: number) { return count === 10 ? 3 : count; }

const metric = (runId: string, value: number, overrides: Record<string, unknown> = {}) => ({ runId, method: "baseline", metric: "accuracy",
  value, unit: "%", period: "2026-11", direction: "HIGHER_BETTER", dataset: "classroom-v1", split: "test", seed: "42",
  evaluationCode: "eval-v1", environment: "local", phase: "final", batchSize: "16", ...overrides });
const metricCases = [];
const metricVariants: Array<{ id: string; rows: unknown[]; expectedError?: boolean }> = [
  { id: "same", rows: [metric("a", 80), metric("b", 84)] },
  { id: "unknown-dataset", rows: [metric("a", 80, { dataset: null }), metric("b", 84)] },
  { id: "unknown-unit", rows: [metric("a", 80), metric("b", 84, { unit: null })] },
  { id: "unit-mismatch", rows: [metric("a", 80), metric("b", 0.84, { unit: "ratio" })] },
  { id: "seed-mismatch", rows: [metric("a", 80), metric("b", 84, { seed: "7" })] },
  { id: "direction-mismatch", rows: [metric("a", 80), metric("b", 84, { direction: "LOWER_BETTER" })] },
  { id: "metric-mismatch", rows: [metric("a", 80), metric("b", 84, { metric: "f1" })] },
  { id: "missing-row", rows: [metric("a", 80)] , expectedError: true },
  { id: "duplicate-row", rows: [metric("a", 80), metric("a", 84)], expectedError: true },
  { id: "unknown-condition-and-unit", rows: [metric("a", 80, { phase: null }), metric("b", 84, { unit: null })] },
];
for (const variant of metricVariants) {
  const text = JSON.stringify(variant.rows);
  let expected: string[] = [], expectedError = !!variant.expectedError;
  if (!expectedError) {
    try {
      const records = parseMetricRecords(text, "JSON");
      const comparison = compareMetricRecords(records[0], records[1]);
      const questions = metricChallengeQuestions([source("capture:m-" + variant.id, text)] as never);
      expected = questions[0].expected;
    } catch { expectedError = true; }
  }
  metricCases.push({ id: "rule-metric-" + variant.id, kind: "METRIC", synthetic: true, realAuthorized: false,
    sources: [source("capture:m-" + variant.id, text)], content: { blocks: [block("b", ["capture:m-" + variant.id])] }, expectedError, expected });
}
const rules = { schemaVersion: 1, frozenAt: "2026-11-17", sourceTruth: "SYNTHETIC_ONLY", realAuthorizedSources: 0,
  note: "All cases are synthetic. No real authorized project source is claimed; real-source validation remains UNVERIFIED.",
  cases: [...evidenceCases, ...metricCases] };
fs.writeFileSync(path.join(dir, "challenge-rules.v1.json"), JSON.stringify(rules, null, 2) + "\n");

const qsources: QualitySource[] = [
  { id: "capture:q1", hash: "q1".padEnd(64, "0"), text: "登录流程已完成；移动端输入回归尚未记录；分享入口未验证。" },
  { id: "capture:q2", hash: "q2".padEnd(64, "0"), text: "补测记录：移动端输入回归已补测，分享入口仍未验证，结果尚未独立复现。" },
];
const previous: DraftView = { text: "项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。未知项：分享入口未验证。",
  blocks: [{ blockId: "a", text: "项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:q1"], citations: [{ sourceId: "capture:q1" }] },
    { blockId: "n", text: "未知项：分享入口未验证。", kind: "INFERENCE", sourceIds: [] }], sourceIds: ["capture:q1"], missingInformation: ["分享入口未验证"] };
const good: DraftView = { text: "本轮工作重点：今天先核对第二版交付依据。项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。补测记录：移动端输入回归已补测，分享入口仍未验证，结果尚未独立复现。分享入口未验证仍按未知保留。",
  blocks: [{ blockId: "a", text: "项目资料记载：登录流程已完成；移动端输入回归尚未记录；分享入口未验证。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:q1"], citations: [{ sourceId: "capture:q1" }] },
    { blockId: "b", text: "补测记录：移动端输入回归已补测，分享入口仍未验证，结果尚未独立复现。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:q2"], citations: [{ sourceId: "capture:q2" }] },
    { blockId: "n", text: "本轮工作重点：今天先核对第二版交付依据。分享入口未验证仍按未知保留。", kind: "INFERENCE", sourceIds: [] }],
  sourceIds: ["capture:q1", "capture:q2"], missingInformation: ["分享入口未验证"] };
const clone = (input: DraftView): DraftView => JSON.parse(JSON.stringify(input));
const contexts: Array<{ id: string; current: DraftView; previous?: DraftView | null; redirectQuote?: string; requiredUnknowns?: string[]; expectedFailed: string[] }> = [];
contexts.push({ id: "report-good", current: clone(good), previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: [] });
const copy = clone(good); copy.text = "今天先核对第二版交付依据。".repeat(8);
copy.blocks = [{ blockId: "copy", text: copy.text, kind: "INFERENCE", sourceIds: [] }]; copy.sourceIds = []; copy.missingInformation = [];
contexts.push({ id: "report-copy-request", current: copy, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["EVIDENCE_BOUND", "NOT_COPY_OF_USER_REQUEST", "REDIRECT_ADDRESSED"] });
const titleOnly = clone(good); titleOnly.text = "本轮工作重点：今天先核对第二版交付依据。今天午饭吃面条，下午去操场散步。";
titleOnly.blocks = [{ blockId: "title", text: "本轮工作重点：今天先核对第二版交付依据。", kind: "INFERENCE", sourceIds: [] }, { blockId: "filler", text: "今天午饭吃面条，下午去操场散步。", kind: "INFERENCE", sourceIds: [] }];
titleOnly.sourceIds = [];
contexts.push({ id: "report-title-only", current: titleOnly, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["EVIDENCE_BOUND", "REDIRECT_ADDRESSED", "UNKNOWN_PRESERVED"] });
const unrelatedCitation = clone(good); unrelatedCitation.sourceIds = ["capture:foreign"]; unrelatedCitation.blocks[0].sourceIds = ["capture:foreign"]; unrelatedCitation.blocks[0].citations = [{ sourceId: "capture:foreign" }];
contexts.push({ id: "report-unrelated-citation", current: unrelatedCitation, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["CITATIONS_RESOLVE", "EVIDENCE_BOUND"] });
const trivial = clone(previous); trivial.text = trivial.text.replace("未知项：分享入口未验证。", "未知项：分享入口仍未验证。");
contexts.push({ id: "report-trivial-edit", current: trivial, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["EFFECTIVE_REVISION", "EVIDENCE_BOUND", "REDIRECT_ADDRESSED"] });
const missingUnknown = clone(good); missingUnknown.missingInformation = [];
missingUnknown.text = "本轮工作重点：今天先核对第二版交付依据。项目资料记载：登录流程已完成；移动端输入回归已补测。";
missingUnknown.blocks = [missingUnknown.blocks[0], { blockId: "clean", text: "项目资料记载：登录流程已完成；移动端输入回归已补测。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:q1"], citations: [{ sourceId: "capture:q1" }] }];
missingUnknown.sourceIds = ["capture:q1"];
contexts.push({ id: "report-missing-unknown", current: missingUnknown, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["UNKNOWN_PRESERVED"] });
const dropOld = clone(good); dropOld.sourceIds = ["capture:q2"]; dropOld.blocks = [dropOld.blocks[1], dropOld.blocks[2]];
contexts.push({ id: "report-drop-old-evidence", current: dropOld, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["OLD_EVIDENCE_RETAINED", "EVIDENCE_BOUND"] });
const weak = clone(good); weak.text = "移动端输入回归已补测。"; weak.blocks = [{ blockId: "short", text: "移动端输入回归已补测。", kind: "PROJECT_OBSERVATION", sourceIds: ["capture:q2"], citations: [{ sourceId: "capture:q2" }] }]; weak.sourceIds = ["capture:q2"];
contexts.push({ id: "report-weak-evidence", current: weak, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["EVIDENCE_BOUND", "REDIRECT_ADDRESSED", "UNKNOWN_PRESERVED", "CITATIONS_RELEVANT"] });
const noRedirect = clone(good); noRedirect.text = noRedirect.text.replace("本轮工作重点：今天先核对第二版交付依据。", ""); noRedirect.blocks[2].text = "分享入口未验证仍按未知保留。";
contexts.push({ id: "report-no-redirect", current: noRedirect, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["EFFECTIVE_REVISION", "REDIRECT_ADDRESSED"] });
const irrelevantCitation = clone(good); irrelevantCitation.blocks[1].text = "今天午饭吃面条，下午散步。"; irrelevantCitation.blocks[1].citations = [{ sourceId: "capture:q2" }];
contexts.push({ id: "report-irrelevant-citation", current: irrelevantCitation, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["CITATIONS_RELEVANT"] });
const empty = clone(good); empty.text = ""; empty.blocks = []; empty.sourceIds = []; empty.missingInformation = [];
contexts.push({ id: "report-empty", current: empty, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: ["CURRENT_HAS_CONTENT", "EFFECTIVE_REVISION", "EVIDENCE_BOUND", "CITATIONS_RESOLVE", "REDIRECT_ADDRESSED", "UNKNOWN_PRESERVED"] });
const withUnknownAndEvidence = clone(good);
contexts.push({ id: "report-unknown-and-evidence", current: withUnknownAndEvidence, previous: null, redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: ["分享入口未验证"], expectedFailed: [] });
// Fill to 12 with two explicit comparability-style report contexts that reuse the same deterministic checks.
const sameAsGood = clone(good); contexts.push({ id: "report-evidence-kept", current: sameAsGood, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: [], expectedFailed: [] });
const noUnknownRequirement = clone(good); contexts.push({ id: "report-no-unknown-requirement", current: noUnknownRequirement, previous: clone(previous), redirectQuote: "今天先核对第二版交付依据", requiredUnknowns: [], expectedFailed: [] });
contexts.splice(12);
for (const context of contexts) {
  const checks = assessRevision({ previous: context.previous ?? null, current: context.current, sources: qsources,
    redirectQuote: context.redirectQuote, userRequest: context.redirectQuote, requiredUnknowns: context.requiredUnknowns });
  context.expectedFailed = checks.filter(check => check.status === "FAIL").map(check => check.name);
}
const reports = { schemaVersion: 1, frozenAt: "2026-11-17", sourceTruth: "SYNTHETIC_ONLY", realAuthorizedSources: 0,
  note: "Synthetic report contexts for deterministic scoring only; no real authorized report or human semantic verdict.",
  cases: contexts.map(context => ({ id: context.id, synthetic: true, realAuthorized: false, previous: context.previous ?? null,
    current: context.current, redirectQuote: context.redirectQuote ?? null, requiredUnknowns: context.requiredUnknowns ?? [],
    expectedFailed: [...new Set(context.expectedFailed)].sort() })) };
fs.writeFileSync(path.join(dir, "challenge-report-contexts.v1.json"), JSON.stringify(reports, null, 2) + "\n");
console.log(JSON.stringify({ rules: rules.cases.length, reports: reports.cases.length }, null, 2));
