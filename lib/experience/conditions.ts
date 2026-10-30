import { createHash } from "node:crypto";
import { record } from "@/lib/conversation/repository";
import type { AgentMission, AgentMissionStep } from "@/lib/generated/prisma/client";
import { jsonHash } from "@/lib/mission/contracts";
import type { Source } from "@/lib/mission/contracts";

/**
 * CT-8 条件化结果经验：条件来自原 Mission 的真实字段（研究范围、指标映射、资源约束、
 * 工具/协议版本），不是由模型自报或相似度推断。条件未知保持 UNKNOWN，不能当作“无条件”。
 */

export type ConditionFacets = {
  problemType: string;
  goalClass: string;
  dataset: string | null;
  split: string | null;
  unit: string | null;
  seed: string | null;
  evaluationCode: string | null;
  environment: string | null;
  metric: string | null;
  method: string | null;
  researchTopic: string | null;
  researchHosts: string[];
  resourceLimits: string[];
  forbiddenApproaches: string[];
  executionBoundary: string;
  successCriteria: string[];
  toolVersions: Record<string, string>;
  protocolVersions: number[];
};

export type ConditionCoverage = { complete: boolean; known: number; total: number; missing: string[]; criticalMissing: string[] };

export type ExperienceApplicabilityV2 = {
  schemaVersion: 2;
  problemType: string;
  goalClass: string;
  conditions: string[];
  unknownConditions: string[];
  notApplicableWhen: string[];
  tools: string[];
  facets: Omit<ConditionFacets, "toolVersions" | "protocolVersions">;
  coverage: ConditionCoverage;
};

export type ConditionMatchState = "MATCH" | "MISMATCH" | "UNKNOWN";
export type ConditionMatch = {
  state: ConditionMatchState;
  reasons: string[];
  mismatched: string[];
  unknown: string[];
  coverage: { compared: number; matched: number; complete: boolean };
};

export const CONDITION_SCHEMA_VERSION = 2;

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const clean = (value: unknown, max = 120): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
};
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((v): v is string => !!v))].sort();

function goalKeywordClass(goal: string): string {
  const text = goal.toLowerCase();
  if (/实验|指标|评测|对比|baseline|metric|benchmark|split|ablation|训练|推理/.test(text)) return "EXPERIMENT";
  if (/论文|文献|综述|研究|paper|literature|survey/.test(text)) return "RESEARCH";
  if (/部署|发布|上线|运维|deploy|release/.test(text)) return "DELIVERY";
  if (/报告|文档|总结|汇报|材料|report|document/.test(text)) return "DOCUMENT";
  if (/行动|待办|跟进|提醒|action|follow/.test(text)) return "ACTION";
  if (/代码|实现|修复|重构|测试|code|fix|refactor/.test(text)) return "CODE";
  return "GENERAL";
}

function criteriaTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return unique(raw.map(item => typeof item === "string" ? item : record(item).type as string | undefined));
}

function problemTypeOf(goal: string, tools: Array<{ name: string }>, criteria: string[]): string {
  if (tools.some(t => ["inspect_experiment_metrics", "compare_experiment_metrics", "propose_metric_verification"].includes(t.name)) ||
    criteria.some(c => c === "FIXED_METRIC_JOB_RECORDED")) return "EXPERIMENT_COMPARISON";
  if (tools.some(t => ["web_search", "web_fetch", "read_paper_metadata"].includes(t.name))) return "EXTERNAL_RESEARCH";
  if (tools.some(t => ["inspect_document", "read_document_page", "read_document_section", "read_document_table"].includes(t.name))) return "DOCUMENT_READING";
  if (tools.some(t => ["read_repository_ci", "read_ci_jobs", "read_ci_log"].includes(t.name))) return "CODE_CI";
  if (criteria.some(c => c === "ACTION_CREATED" || c === "ACTION_RESULT_RECORDED")) return "ACTION_DELIVERY";
  if (criteria.some(c => c === "DRAFT_EXISTS" || c === "SOURCE_COUNT") || /报告|文档|总结|汇报|材料/.test(goal)) return "PROJECT_DELIVERY";
  return "GENERAL";
}

/** Metric facets come from the original tool input/mapping/job, never from model prose. */
function metricFacetsFromStep(step: Pick<AgentMissionStep, "canonicalInputJson">): Partial<Pick<ConditionFacets, "dataset" | "split" | "unit" | "seed" | "evaluationCode" | "environment" | "metric" | "method">> {
  const input = record(step.canonicalInputJson);
  const mapping = record(input.mapping);
  const job = record(input.job);
  const left = record(record(job.left).mapping), right = record(record(job.right).mapping);
  const chosen = mapping.dataset ? mapping : left.dataset ? left : right;
  const pick = (key: string) => clean(chosen[key], 120) ?? clean(record(record(input.rightSource).mapping)[key], 120);
  return {
    dataset: pick("dataset"), split: pick("split"), unit: pick("unit"), seed: pick("seed"),
    evaluationCode: pick("evaluationCode"), environment: pick("environment"), metric: pick("metric") ?? clean(input.metric, 120),
    method: pick("method") ?? clean(input.method, 120),
  };
}

export function facetsFromMission(m: Pick<AgentMission, "goal" | "successCriteriaJson" | "constraintsJson" | "researchScopeJson">,
  steps: Array<Pick<AgentMissionStep, "toolName" | "toolVersion" | "status" | "canonicalInputJson" | "protocolJson">>,
  scenario?: string | null): ConditionFacets {
  const criteria = criteriaTypes(m.successCriteriaJson);
  const constraints = record(m.constraintsJson);
  const scope = record(m.researchScopeJson);
  const tools = unique(steps.filter(s => s.status === "SUCCEEDED").map(s => s.toolName));
  const problemType = problemTypeOf(m.goal, steps.map(s => ({ name: s.toolName })), criteria);
  const metric = steps.map(metricFacetsFromStep).find(f => Object.values(f).some(Boolean)) ?? {};
  const toolVersions: Record<string, string> = {};
  for (const step of steps) if (tools.includes(step.toolName)) toolVersions[step.toolName] = step.toolVersion || "1";
  const protocolVersions = [...new Set(steps.map(s => record(s.protocolJson).schemaVersion).filter((v): v is number => typeof v === "number"))];
  return {
    problemType,
    goalClass: `${scenario ?? "UNKNOWN"}:${goalKeywordClass(m.goal)}`,
    dataset: clean(metric.dataset) ?? null,
    split: clean(metric.split) ?? null,
    unit: clean(metric.unit) ?? null,
    seed: clean(metric.seed) ?? null,
    evaluationCode: clean(metric.evaluationCode) ?? null,
    environment: clean(metric.environment) ?? null,
    metric: clean(metric.metric) ?? null,
    method: clean(metric.method) ?? null,
    researchTopic: clean(scope.topic, 300) ?? null,
    researchHosts: unique(Array.isArray(scope.allowedHosts) ? scope.allowedHosts.map(v => clean(v)) : []),
    resourceLimits: unique(Array.isArray(constraints.resourceLimits) ? constraints.resourceLimits.map(v => clean(v, 160)) : []),
    forbiddenApproaches: unique(Array.isArray(constraints.forbiddenApproaches) ? constraints.forbiddenApproaches.map(v => clean(v, 160)) : []),
    executionBoundary: clean(constraints.executionBoundary, 40) ?? "UNKNOWN",
    successCriteria: criteria,
    toolVersions,
    protocolVersions,
  };
}

/** Conversation conditions are deliberately sparser: missing dataset/split/environment stays UNKNOWN. */
export function facetsFromConversation(input: {
  goal: string; scenario?: string | null; constraints: string[];
  researchScope?: { topic?: string; allowedHosts?: string[] } | null;
  tools?: Array<{ name: string; version: string }>;
}): ConditionFacets {
  const keywordClass = goalKeywordClass(input.goal);
  return {
    problemType: keywordClass === "EXPERIMENT" ? "EXPERIMENT_COMPARISON" : keywordClass === "RESEARCH" ? "EXTERNAL_RESEARCH" : "GENERAL",
    goalClass: `${input.scenario ?? "UNKNOWN"}:${keywordClass}`,
    dataset: null, split: null, unit: null, seed: null, evaluationCode: null, environment: null, metric: null, method: null,
    researchTopic: clean(input.researchScope?.topic, 300) ?? null,
    researchHosts: unique(input.researchScope?.allowedHosts ?? []),
    resourceLimits: [], forbiddenApproaches: [], executionBoundary: input.constraints.some(c => /只读|不创建行动|(?:不要|禁止|不得|不允许)(?:创建行动|新增行动|外部写入|写入业务)/.test(c)) ? "READ_ANALYZE" : "PROPOSE_ACTION",
    successCriteria: [],
    toolVersions: Object.fromEntries((input.tools ?? []).map(t => [t.name, t.version || "1"])),
    protocolVersions: [],
  };
}

const FACET_KEYS = ["problemType", "goalClass", "dataset", "split", "unit", "seed", "evaluationCode", "environment", "metric", "method",
  "researchTopic", "researchHosts", "resourceLimits", "forbiddenApproaches", "executionBoundary"] as const;

function facetValue(facets: Partial<ConditionFacets>, key: typeof FACET_KEYS[number]): string | null {
  const value = (facets as Record<string, unknown>)[key];
  if (Array.isArray(value)) return value.length ? unique(value.map(v => String(v))).join("|") : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function conditionKeyOf(facets: ConditionFacets): string {
  const values: Record<string, string> = {};
  for (const key of FACET_KEYS) values[key] = facetValue(facets, key) ?? "UNKNOWN";
  return sha({ schemaVersion: CONDITION_SCHEMA_VERSION, facets: values, criteria: facets.successCriteria });
}

export function conditionCoverage(facets: ConditionFacets): ConditionCoverage {
  const critical: Array<keyof ConditionFacets> = facets.problemType === "EXPERIMENT_COMPARISON"
    ? ["dataset", "split", "unit", "environment"]
    : facets.problemType === "EXTERNAL_RESEARCH" ? ["researchTopic"] : ["goalClass"];
  const missing: string[] = [];
  const criticalMissing: string[] = [];
  for (const key of FACET_KEYS) {
    const value = facetValue(facets, key);
    if (!value) { missing.push(key); if ((critical as string[]).includes(key)) criticalMissing.push(key); }
  }
  return { complete: criticalMissing.length === 0, known: FACET_KEYS.length - missing.length, total: FACET_KEYS.length, missing, criticalMissing };
}

function humanValue(key: string, value: string | null): string | null {
  if (!value) return null;
  const labels: Record<string, string> = {
    problemType: "任务类型", goalClass: "目标与验收类型", dataset: "数据集", split: "划分", unit: "单位", seed: "随机种子",
    evaluationCode: "评测代码", environment: "环境/设备", metric: "指标", method: "方法", researchTopic: "公开研究主题",
    researchHosts: "公开来源范围", resourceLimits: "资源限制", forbiddenApproaches: "禁用方法", executionBoundary: "执行边界",
  };
  return `${labels[key] ?? key}：${value}`;
}

export function conditionLines(facets: ConditionFacets, max = 6): { conditions: string[]; unknown: string[] } {
  const conditions: string[] = [], unknown: string[] = [];
  for (const key of FACET_KEYS) {
    const value = facetValue(facets, key);
    const line = humanValue(key, value);
    if (line) conditions.push(line); else unknown.push(key);
  }
  return { conditions: conditions.slice(0, max), unknown: unknown.slice(0, 8) };
}

export function applicabilityOf(input: { facets: ConditionFacets; conditions: string[]; tools: string[]; notApplicableWhen?: string[] }): ExperienceApplicabilityV2 {
  const coverage = conditionCoverage(input.facets);
  const lines = conditionLines(input.facets);
  return {
    schemaVersion: CONDITION_SCHEMA_VERSION,
    problemType: input.facets.problemType,
    goalClass: input.facets.goalClass,
    conditions: [...lines.conditions, ...input.conditions.filter(v => !lines.conditions.includes(v))].slice(0, 10),
    unknownConditions: lines.unknown.map(key => `未记录：${key}`),
    notApplicableWhen: input.notApplicableWhen ?? [],
    tools: input.tools.slice(0, 8),
    facets: {
      problemType: input.facets.problemType, goalClass: input.facets.goalClass,
      dataset: input.facets.dataset, split: input.facets.split, unit: input.facets.unit, seed: input.facets.seed,
      evaluationCode: input.facets.evaluationCode, environment: input.facets.environment, metric: input.facets.metric,
      method: input.facets.method, researchTopic: input.facets.researchTopic, researchHosts: input.facets.researchHosts,
      resourceLimits: input.facets.resourceLimits, forbiddenApproaches: input.facets.forbiddenApproaches,
      executionBoundary: input.facets.executionBoundary, successCriteria: input.facets.successCriteria,
    },
    coverage,
  };
}

export function readApplicability(raw: unknown): ExperienceApplicabilityV2 | null {
  const value = record(raw);
  if (value.schemaVersion !== CONDITION_SCHEMA_VERSION || typeof value.facets !== "object" || value.facets === null) return null;
  return {
    schemaVersion: 2,
    problemType: String(value.problemType ?? "UNKNOWN"),
    goalClass: String(value.goalClass ?? "UNKNOWN"),
    conditions: Array.isArray(value.conditions) ? value.conditions.filter((v): v is string => typeof v === "string").slice(0, 10) : [],
    unknownConditions: Array.isArray(value.unknownConditions) ? value.unknownConditions.filter((v): v is string => typeof v === "string").slice(0, 10) : [],
    notApplicableWhen: Array.isArray(value.notApplicableWhen) ? value.notApplicableWhen.filter((v): v is string => typeof v === "string").slice(0, 10) : [],
    tools: Array.isArray(value.tools) ? value.tools.filter((v): v is string => typeof v === "string").slice(0, 8) : [],
    facets: value.facets as ExperienceApplicabilityV2["facets"],
    coverage: record(value.coverage) as ConditionCoverage,
  };
}

/**
 * Compare an experience's recorded conditions with the current task.
 * Known-vs-known mismatch -> MISMATCH. One-sided missing -> UNKNOWN (never “unconditional”).
 * A facet absent on both sides is genuinely not applicable to this problem type and is skipped.
 */
export function compareConditions(rawApplicability: unknown, current: ConditionFacets): ConditionMatch {
  const applicability = readApplicability(rawApplicability);
  if (!applicability) return { state: "UNKNOWN", reasons: ["LEGACY_CONDITION_SCHEMA"], mismatched: [], unknown: FACET_KEYS as unknown as string[], coverage: { compared: 0, matched: 0, complete: false } };
  if (applicability.problemType !== current.problemType && applicability.problemType !== "GENERAL" && current.problemType !== "GENERAL")
    return { state: "MISMATCH", reasons: [`PROBLEM_TYPE_MISMATCH:${applicability.problemType}->${current.problemType}`],
      mismatched: ["problemType"], unknown: [], coverage: { compared: 1, matched: 0, complete: false } };
  const mismatched: string[] = [], unknown: string[] = [];
  let matched = 0, compared = 0;
  for (const key of FACET_KEYS) {
    if (key === "problemType") { matched += 1; continue; }
    const left = facetValue(applicability.facets, key), right = facetValue(current, key);
    if (!left && !right) continue;
    compared += 1;
    if (!left || !right) { unknown.push(key); continue; }
    if (left !== right) mismatched.push(key); else matched += 1;
  }
  const state: ConditionMatchState = mismatched.length ? "MISMATCH" : unknown.length ? "UNKNOWN" : "MATCH";
  return { state,
    reasons: mismatched.length ? [`CONDITION_MISMATCH:${mismatched.join(",")}`] : unknown.length ? [`CONDITION_UNKNOWN:${unknown.join(",")}`] : ["CONDITION_MATCH"],
    mismatched, unknown,
    coverage: { compared, matched, complete: !mismatched.length && !unknown.length && compared > 0 } };
}

/** Bounded, deterministic fingerprint for “did any real result change since last sync?” */
export function trajectoryFingerprint(entries: Array<{ missionId: string; status: string; outputId?: string | null; adoptionIds?: string[]; actionIds?: string[]; failureStepIds?: string[] }>): string {
  return jsonHash(entries.map(e => [e.missionId, e.status, e.outputId ?? null, (e.adoptionIds ?? []).sort(), (e.actionIds ?? []).sort(), (e.failureStepIds ?? []).sort()]));
}

export function sourceRootsFromSteps(steps: Array<{ resultJson: unknown }>): string[] {
  return unique(steps.flatMap(s => (Array.isArray(record(s.resultJson).sources) ? record(s.resultJson).sources as Source[] : []).map(source => source.id)));
}
