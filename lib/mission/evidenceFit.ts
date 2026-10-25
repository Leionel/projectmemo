import { createHash } from "node:crypto";
import { evidenceFitRequirementSchema, type EvidenceFit, type EvidenceFitRequirement, type FitCheckResult, type FitGroup, type FitMaterial, type FitPremise, type FitSpan } from "@/lib/types/missionEvidenceFit";

export const EVIDENCE_FIT_RULE_VERSION = "e0-resource-v1";
const hash = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");
const norm = (v: string) => v.normalize("NFKC").toLowerCase().replace(/gpu\s*内存/g, "显存").replace(/batch\s*size/g, "batch").replace(/[\s，,（()）、:：=]/g, "");
const stage = (v: string) => /^(推理|inference)$/i.test(v.trim()) ? "INFERENCE" : /^(训练|training)$/i.test(v.trim()) ? "TRAINING" : null;

/** Conditions come from the frozen question/confirmed constraints, never from material text. */
export function makeFitPremise(requirement: EvidenceFitRequirement, input: { questionId: string; question: string; goal: string; constraints: unknown; constraintsVersion: number; scopeVersion: number }): FitPremise {
  const r = evidenceFitRequirementSchema.parse(requirement);
  const grounded = r.checks.every(c => {
    const origin = c.basis.kind === "QUESTION" ? input.question : JSON.stringify(input.constraints);
    return origin.includes(c.basis.quote) && norm(c.basis.quote).includes(norm(c.expected));
  });
  // Units and limit are required to be in the original question/constraints as well.
  const basis = `${input.question}\n${JSON.stringify(input.constraints)}`;
  const unitPresent = basis.includes(r.measurement.unit);
  const limitText=String(r.measurement.upperLimit).replaceAll(".","\\.");
  const limitPresent = r.measurement.upperLimit === undefined || new RegExp(`(?:预算|上限|不超过)\\s*${limitText}\\s*${r.measurement.unit}`, "i").test(basis);
  const value = { ...r, questionId: input.questionId, goalHash: hash(input.goal), constraintsVersion: input.constraintsVersion, scopeVersion: input.scopeVersion, basisStatus: grounded && unitPresent && limitPresent ? "GROUNDED" as const : "UNRESOLVED" as const };
  return { ...value, premiseHash: hash(value) };
}
function span(text: string, start: number, end: number): FitSpan { return { start, end, excerptHash: hash(text.slice(start, end)) }; }
function clauses(text: string) {
  return [...text.matchAll(/[^\n。；;]+[。；;]?/g)].map(m => ({ text: m[0], start: m.index! }));
}
function checkGroup(p: FitPremise, source: FitMaterial, text: string, start: number, ordinal: number): FitGroup {
  const original = text;
  // Remove negative/unperformed clauses before matching. Their mere keywords are not observations.
  const negative = /未测|尚未|没有测|未进行|未执行|尚无|待测|未测试|计划|预计|预期|假设|例如|建议|not\s+(?:tested|measured)/i.test(text);
  const external = /(?:论文|文献|他人|公开报告|paper\b).{0,12}(?:报告|记录|显示|指出|reported|reports|shows)|(?:来源|摘自|转引).{0,6}(?:论文|文献|paper\b)/i.test(text);
  const groupSpan = span(source.text, start, start + text.length);
  const results: FitCheckResult[] = p.checks.map(c => {
    let observed: string | null = null, status: FitCheckResult["status"] = "UNKNOWN", reasonCode = "MISSING_EXPLICIT_CONDITION";
    const entityPattern=c.id==="SUBJECT"?/模型\s*([a-z0-9_-]+)/gi:/设备\s*([a-z0-9_-]+)|服务器\s*([a-z0-9_-]+)/gi;
    const expectedEntity=[...c.expected.matchAll(entityPattern)].map(m=>(m[1]??m[2]).toLowerCase());
    const observedEntities=[...text.matchAll(entityPattern)].map(m=>(m[1]??m[2]).toLowerCase());
    const hasContraryEntity=expectedEntity.length>0&&observedEntities.length>0&&!observedEntities.some(v=>expectedEntity.includes(v));
    const expectedBatch=/batch\s*=?\s*(\d+)/i.exec(c.expected)?.[1], actualBatch=/batch\s*=?\s*(\d+)/i.exec(text)?.[1];
    const expectedPrecision=/FP(?:16|32|64)|BF16/i.exec(c.expected)?.[0], actualPrecision=/FP(?:16|32|64)|BF16/i.exec(text)?.[0];
    if (c.id === "SUBJECT" && external) { observed = "用户提供的外部参考"; status = "MISMATCH"; reasonCode = "EXTERNAL_SUBJECT"; }
    else if(!negative&&c.id!=="STAGE"&&(hasContraryEntity||expectedBatch&&actualBatch&&expectedBatch!==actualBatch||expectedPrecision&&actualPrecision&&expectedPrecision.toUpperCase()!==actualPrecision.toUpperCase())){
      observed=hasContraryEntity?observedEntities.join("、"):actualBatch??actualPrecision??null;status="MISMATCH";reasonCode="EXPLICIT_CONDITION_MISMATCH";
    }
    else if (c.id === "STAGE") {
      const expected = stage(c.expected), training = /训练|training/i.test(text), inference = /推理|inference/i.test(text);
      if (expected && training !== inference && !negative) { observed = training ? "TRAINING" : "INFERENCE"; status = observed === expected ? "MATCH" : "MISMATCH"; reasonCode = status === "MATCH" ? "EXPLICIT_STAGE" : "STAGE_MISMATCH"; }
    } else if (!negative && norm(text).includes(norm(c.expected))) { observed = c.expected; status = "MATCH"; reasonCode = "EXPLICIT_CONDITION"; }
    return { checkId: c.id, expected: c.expected, observed, status, reasonCode, spans: observed === null ? [] : [groupSpan] };
  });
  // A measurement must be explicitly described as a measured/peak value. Capacity/budget/requirements are not results.
  const values = [...text.matchAll(/(?:显存|GPU\s*内存)(?:实测|测得|峰值|使用量|占用|为|：|:|\s){0,4}\s*(\d+(?:\.\d+)?)\s*(GB|MB)\b/gi)];
  const measure = !negative && !/(?:预算|要求|上限|不超过).{0,8}(?:显存|GPU\s*内存)/i.test(text) && values.length === 1 && values[0][2].toUpperCase() === p.measurement.unit ? Number(values[0][1]) : null;
  const reasons: string[] = [];
  if (negative) reasons.push("UNPERFORMED_OR_NEGATED");
  if (measure === null) reasons.push("NO_UNAMBIGUOUS_MEASUREMENT");
  if (source.sourceState !== "CURRENT") reasons.push(`SOURCE_${source.sourceState}`);
  if (p.measurement.period && !norm(text).includes(norm(p.measurement.period))) reasons.push("MISSING_PERIOD");
  if (new Set(text.match(/模型\s*[A-Za-z0-9_-]+/gi)??[]).size>1) reasons.push("MULTIPLE_SUBJECTS");
  if (new Set([...text.matchAll(/(?:设备|服务器)\s*([a-z0-9_-]+)/gi)].map(m=>m[1])).size>1) reasons.push("MULTIPLE_ENVIRONMENTS");
  if(text.length>1500)reasons.push("OBSERVATION_TOO_LONG");
  if (p.basisStatus !== "GROUNDED") reasons.push("PREMISE_NOT_GROUNDED");
  const mismatched = results.some(c => c.status === "MISMATCH");
  const fitStatus = mismatched ? "NOT_FIT" : results.every(c => c.status === "MATCH") && reasons.length === 0 ? "FIT" : "UNKNOWN";
  return { sourceId: source.id, hash: source.hash, revision: source.revision, observationGroup: `${source.id}#${ordinal}`, sourceState: source.sourceState,
    origin: external ? "USER_PROVIDED_REFERENCE" : "USER_RECORD", basis: "E0_EXPLICIT_TEXT", checks: results, spans: [span(source.text, start, start + original.length)], fitStatus, reasonCodes: reasons,
    measurementValue: measure, measurementResult: fitStatus!=="FIT" || measure === null || p.measurement.upperLimit === undefined ? "UNKNOWN" : measure > p.measurement.upperLimit ? "EXCEEDS_LIMIT" : "WITHIN_LIMIT" };
}
/** Pure, bounded E0: source/group-local comparisons. No model, DB, clock or cross-source joins. */
export function evaluateEvidenceFit(premise: FitPremise, materials: FitMaterial[], ruleVersion = EVIDENCE_FIT_RULE_VERSION): EvidenceFit {
  if (materials.length > 8 || new Set(materials.map(s => s.id)).size !== materials.length) throw new Error("FIT_SOURCE_LIMIT_OR_DUPLICATE");
  if (ruleVersion !== EVIDENCE_FIT_RULE_VERSION) throw new Error("FIT_RULE_VERSION");
  const groups: FitGroup[] = [], limited: string[] = [];
  for (const source of [...materials].sort((a, b) => a.id.localeCompare(b.id))) {
    if (source.text.length > 12000 || source.coverage.loadedCharacters !== source.text.length) throw new Error("FIT_COVERAGE_INVALID");
    const parts = clauses(source.text);
    // Review measured or explicitly requested-but-unperformed observations, never combine paragraphs.
    const observations = parts.filter(p => /显存|GPU\s*内存|训练|推理/i.test(p.text));
    if (observations.length > 4) limited.push(source.id);
    for (const [i, part] of observations.slice(0, 4).entries()) groups.push(checkGroup(premise, source, part.text, part.start, i));
    if (!observations.length) groups.push(checkGroup(premise, source, "", 0, 0));
  }
  const conflicts: string[] = [];
  // An explicit shared run identity can reveal a conflict, but is never used to fill missing conditions.
  const runs = new Map<string, FitGroup[]>();
  for (const g of groups) {
    if(g.checks.some(c=>c.status==="MISMATCH"))continue;
    const s = materials.find(s => s.id === g.sourceId)!;
    const text = s.text.slice(g.spans[0].start, g.spans[0].end);
    const run = /(?:运行|run(?:Id)?[=:：\s]*)\s*([a-z0-9_-]+)/i.exec(text)?.[1];
    if (run && g.measurementValue !== null) runs.set(run, [...(runs.get(run) ?? []), g]);
  }
  for (const [run, entries] of runs) if (new Set(entries.map(g => g.measurementValue)).size > 1) conflicts.push(`RUN_CONFLICT:${run}`);
  const truncatedSourceIds = materials.filter(s => s.coverage.truncated).map(s => s.id);
  const eligibleGroups = groups.filter(g => g.fitStatus === "FIT" && !truncatedSourceIds.includes(g.sourceId) && !limited.includes(g.sourceId)).map(g => g.observationGroup);
  const measured=groups.filter(g=>g.measurementValue!==null);
  const fitStatus = conflicts.length ? "UNKNOWN" : eligibleGroups.length ? "FIT" : measured.length>0&&measured.every(g=>g.fitStatus==="NOT_FIT") ? "NOT_FIT" : "UNKNOWN";
  return { schemaVersion: 1, ruleVersion, normalizationVersion: "RAW_UTF16_V1", premise, fitStatus, groups, eligibleGroups, excludedGroups: groups.filter(g => g.fitStatus === "NOT_FIT").map(g => g.observationGroup),
    unresolvedChecks: [...new Set([...groups.flatMap(g => g.checks.filter(c => c.status !== "MATCH").map(c => c.checkId)), ...groups.flatMap(g => g.reasonCodes), ...truncatedSourceIds.map(id => `COVERAGE_INCOMPLETE:${id}`), ...limited.map(id => `GROUP_LIMIT:${id}`), ...(materials.length ? [] : ["NO_MATERIAL"]), ...conflicts])],
    conflicts, coverage: { sourceCount: materials.length, truncatedSourceIds, groupLimitSourceIds: limited }, semanticVerification: "NOT_CHECKED" };
}
