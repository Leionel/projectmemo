import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { json, jsonHash } from "@/lib/mission/contracts";
import { buildTrajectoryIndex, type TrajectoryEntry, type TrajectoryIndex } from "./trajectoryIndex";
import {
  applicabilityOf, conditionCoverage, conditionKeyOf, conditionLines, CONDITION_SCHEMA_VERSION,
} from "./conditions";

/**
 * CT-8 候选经验提炼（纯规则，无模型调用）。
 * 独立样本依据原任务/运行/数据来源，不依据文件数量或新 UUID；未采用不算反例；
 * 工程成功、用户采用、行动完成、自述效果、独立实测分别记录；条件不完整降为案例参考。
 * 状态机：CANDIDATE →（≥2 个独立、条件完整且来源有效的支持样本）SHADOW →（仅用户操作）ACTIVE/REVOKED。
 * 同步重算当前证据，不把样本 ID 做永久并集；失效支持保留为历史但不计数。
 */

export type ExperienceKind = "WORKFLOW" | "GUARDRAIL";
export type SampleClassification = "SUPPORT" | "COUNTER" | "CASE_REFERENCE" | "UNKNOWN";

export type ExperienceSample = {
  id: string;
  missionId: string;
  stepId: string | null;
  operationId: string | null;
  independenceKey: string;
  classification: SampleClassification;
  counted: boolean;
  reason: string;
  conditionKey: string;
  conditionComplete: boolean;
  resultLabels: TrajectoryEntry["resultLabels"];
  sourceIds: string[];
  origin: { missionId: string; outputId: string | null; adoptionIds: string[]; actionIds: string[]; stepId: string | null; operationId: string | null };
  observedAt: string;
};

export type ExperienceCandidate = {
  kind: ExperienceKind;
  patternHash: string;
  conditionKey: string;
  pattern: { sequence?: string[]; tool?: string; reasonClass?: string };
  title: string;
  statement: string;
  applicability: ReturnType<typeof applicabilityOf>;
  toolVersions: Record<string, string>;
  protocolVersions: number[];
  samples: ExperienceSample[];
  supportMissionIds: string[];
  counterMissionIds: string[];
  caseMissionIds: string[];
  unknownMissionIds: string[];
  supportCount: number;
  counterCount: number;
  conditionComplete: boolean;
  origin: ExperienceSample["origin"] | null;
  resultLabels: Record<string, number>;
};

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const goalHint = (goal: string) => (goal.length > 40 ? `${goal.slice(0, 40)}…` : goal);

function toolVersionsOf(entry: TrajectoryEntry, tools: string[]): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const call of entry.tools) if (tools.includes(call.name)) versions[call.name] = call.version;
  return versions;
}

function protocolVersionsOf(entry: TrajectoryEntry): number[] {
  return [...new Set(entry.tools.map(t => t.protocolSchemaVersion).filter((v): v is number => v !== null))];
}

function conditionText(entry: TrajectoryEntry): { conditions: string[]; unknown: string[] } {
  return conditionLines(entry.conditions);
}

function sampleOf(entry: TrajectoryEntry, classification: SampleClassification, reason: string, counted: boolean): ExperienceSample {
  const labels = entry.resultLabels;
  const negative = labels.negative[0];
  return {
    id: hash({ missionId: entry.missionId, independenceKey: entry.independenceKey, classification, reason }),
    missionId: entry.missionId,
    stepId: negative?.stepId ?? entry.tools.at(-1)?.stepId ?? null,
    operationId: negative?.operationId ?? entry.tools.at(-1)?.operationId ?? null,
    independenceKey: entry.independenceKey,
    classification, counted, reason,
    conditionKey: conditionKeyOf(entry.conditions),
    conditionComplete: conditionCoverage(entry.conditions).complete,
    resultLabels: labels, sourceIds: entry.sourceIds.slice(0, 32),
    origin: { missionId: entry.missionId, outputId: entry.outputId, adoptionIds: entry.adoptionIds,
      actionIds: entry.actionOutcomes.map(a => a.actionId), stepId: entry.tools.at(-1)?.stepId ?? null,
      operationId: entry.tools.at(-1)?.operationId ?? null },
    observedAt: (entry.finishedAt ?? new Date()).toISOString(),
  };
}

/** Only explicit negative results count; never-adopted and unknown outcomes stay UNKNOWN. */
function workflowSample(entry: TrajectoryEntry, sourceState: { suppressed: boolean; unknown: boolean }): ExperienceSample {
  const labels = entry.resultLabels;
  if (!entry.engineeringCompleted) return sampleOf(entry, "UNKNOWN", "ENGINEERING_NOT_COMPLETED", false);
  if (!labels.adopted) return sampleOf(entry, "UNKNOWN", "NOT_ADOPTED_NOT_COUNTER", false);
  if (sourceState.suppressed) return sampleOf(entry, "UNKNOWN", "SOURCE_SUPPRESSED", false);
  if (sourceState.unknown) return sampleOf(entry, "UNKNOWN", "SOURCE_LINEAGE_UNKNOWN", false);
  if (labels.negative.length) return sampleOf(entry, "COUNTER", `NEGATIVE:${labels.negative[0].kind}`, true);
  const observed = labels.actionCompletedWithReceipt || labels.independentMeasurement || labels.userAttested;
  const coverage = conditionCoverage(entry.conditions);
  if (!observed) return sampleOf(entry, "CASE_REFERENCE", "ADOPTED_OUTCOME_UNKNOWN", false);
  if (!coverage.complete) return sampleOf(entry, "CASE_REFERENCE", `CONDITION_INCOMPLETE:${coverage.criticalMissing.join(",")}`, false);
  return sampleOf(entry, "SUPPORT", labels.independentMeasurement ? "INDEPENDENT_MEASUREMENT" : labels.actionCompletedWithReceipt ? "ACTION_COMPLETED_RECEIPT" : "USER_ATTESTED", true);
}

function guardrailSample(entry: TrajectoryEntry, observation: TrajectoryEntry["guardrailObservations"][number], sourceState: { suppressed: boolean; unknown: boolean }): ExperienceSample {
  if (sourceState.suppressed) return sampleOf(entry, "UNKNOWN", "SOURCE_SUPPRESSED", false);
  if (sourceState.unknown) return sampleOf(entry, "UNKNOWN", "SOURCE_LINEAGE_UNKNOWN", false);
  const coverage = conditionCoverage(entry.conditions);
  // Later success is recorded but never labelled as proof that the original cause was resolved.
  if (!coverage.complete) return sampleOf(entry, "CASE_REFERENCE", `CONDITION_INCOMPLETE:${coverage.criticalMissing.join(",")}`, false);
  return sampleOf(entry, "SUPPORT", observation.laterSameToolSucceeded ? "FAILURE_OBSERVED_RETRY_UNVERIFIED" : "FAILURE_OBSERVED_NOT_RETRIED", true);
}

async function sourceStateFor(ownerUserId: string, projectId: string, entry: TrajectoryEntry) {
  let suppressed = false, unknown = false;
  for (const id of entry.sourceIds.slice(0, 24)) {
    const policy = await sourceUse(ownerUserId, projectId, id);
    if (policy.state === "SUPPRESSED") suppressed = true;
    if (policy.state === "UNKNOWN") unknown = true;
  }
  return { suppressed, unknown };
}

function mergeSamples(samples: ExperienceSample[]): ExperienceSample[] {
  const seen = new Set<string>();
  return samples.map(sample => {
    const key = sample.independenceKey;
    if (sample.classification !== "SUPPORT" && sample.classification !== "COUNTER") return sample;
    if (seen.has(key)) return { ...sample, counted: false, reason: "DUPLICATE_INDEPENDENCE" };
    seen.add(key); return sample;
  });
}

function aggregate(samples: ExperienceSample[]) {
  const support = samples.filter(s => s.classification === "SUPPORT" && s.counted);
  const counter = samples.filter(s => s.classification === "COUNTER" && s.counted);
  return { support, counter,
    supportMissionIds: [...new Set(support.map(s => s.missionId))],
    counterMissionIds: [...new Set(counter.map(s => s.missionId))],
    caseMissionIds: [...new Set(samples.filter(s => s.classification === "CASE_REFERENCE").map(s => s.missionId))],
    unknownMissionIds: [...new Set(samples.filter(s => s.classification === "UNKNOWN").map(s => s.missionId))],
  };
}

function labelsSummary(samples: ExperienceSample[]) {
  return {
    engineeringCompleted: samples.filter(s => s.resultLabels.engineeringCompleted).length,
    draftExists: samples.filter(s => s.resultLabels.draftExists).length,
    adopted: samples.filter(s => s.resultLabels.adopted).length,
    actionCreated: samples.filter(s => s.resultLabels.actionCreated).length,
    actionCompletedWithReceipt: samples.filter(s => s.resultLabels.actionCompletedWithReceipt).length,
    userAttested: samples.filter(s => s.resultLabels.userAttested).length,
    independentMeasurement: samples.filter(s => s.resultLabels.independentMeasurement).length,
    explicitNegative: samples.filter(s => s.resultLabels.negative.length).length,
  };
}

export function statementOf(kind: ExperienceKind, entry: TrajectoryEntry, pattern: ExperienceCandidate["pattern"], support: ExperienceSample[], counter: ExperienceSample[], caseSamples: ExperienceSample[], unknown: ExperienceSample[]): string {
  const lines = conditionText(entry);
  const conditionBrief = lines.conditions.slice(0, 3).join("；") || "当时条件记录不完整";
  const unknownBrief = lines.unknown.length ? `未记录的适用条件：${lines.unknown.slice(0, 3).join("、")}。` : "";
  const evidenceBrief = support.some(s => s.reason === "INDEPENDENT_MEASUREMENT") ? "有独立工具/固定核算回执"
    : support.some(s => s.reason === "ACTION_COMPLETED_RECEIPT") ? "有带复盘回执的行动完成"
      : support.length ? "只有用户自述效果" : "尚无已验证的后续结果";
  if (kind === "WORKFLOW") {
    return `在“${goalHint(entry.goal)}”这类任务中，曾在 ${conditionBrief} 的条件下按 ${(pattern.sequence ?? []).join(" → ")} 推进，成果经你采用（${evidenceBrief}；支持 ${support.length}、反例 ${counter.length}、案例 ${caseSamples.length}、未知 ${unknown.length}）。${unknownBrief}这是案例建议：只有当前数据/划分/单位/环境与条件一致时才可参考，不改变目标、权限或预算。`;
  }
  return `${pattern.tool ?? "该工具"} 曾在 ${conditionBrief} 因 ${pattern.reasonClass ?? "失败原因未记录"} 中断；失败原因绑定原步骤。后来的重试不被当作“原因已解决”的证明。${unknownBrief}执行前先核对当时条件与失败原因，不改变权限。`;
}

export function extractCandidates(index: TrajectoryIndex): ExperienceCandidate[] {
  const candidates = new Map<string, ExperienceCandidate>();
  const upsert = (candidate: ExperienceCandidate) => {
    const existing = candidates.get(candidate.conditionKey + ":" + candidate.patternHash);
    if (!existing) { candidates.set(candidate.conditionKey + ":" + candidate.patternHash, candidate); return; }
    existing.samples.push(...candidate.samples);
  };

  for (const entry of index.entries) {
    if (entry.engineeringCompleted && entry.adoptionCount > 0 && entry.successSequence.length > 0) {
      const sequence = entry.successSequence;
      const conditions = entry.conditions;
      const patternHash = hash({ kind: "WORKFLOW", sequence });
      const conditionKey = conditionKeyOf(conditions);
      const sample = workflowSample(entry, { suppressed: false, unknown: false });
      upsert({
        kind: "WORKFLOW", patternHash, conditionKey,
        pattern: { sequence },
        title: `工作方法：${sequence.join(" → ")}`,
        statement: statementOf("WORKFLOW", entry, { sequence }, [sample].filter(s => s.classification === "SUPPORT"), [], [sample].filter(s => s.classification === "CASE_REFERENCE"), [sample].filter(s => s.classification === "UNKNOWN")),
        applicability: applicabilityOf({ facets: conditions, conditions: conditionText(entry).conditions, tools: sequence, notApplicableWhen: ["数据集、划分、单位、随机种子或环境不一致", "没有可核对的真实结果"] }),
        toolVersions: toolVersionsOf(entry, sequence), protocolVersions: protocolVersionsOf(entry),
        samples: [sample], supportMissionIds: [], counterMissionIds: [], caseMissionIds: [], unknownMissionIds: [],
        supportCount: 0, counterCount: 0, conditionComplete: conditionCoverage(conditions).complete,
        origin: sample.origin, resultLabels: labelsSummary([sample]),
      });
    }
    for (const observation of entry.guardrailObservations) {
      const conditions = entry.conditions;
      const patternHash = hash({ kind: "GUARDRAIL", tool: observation.tool, reasonClass: observation.reasonClass });
      const conditionKey = conditionKeyOf(conditions);
      const sample = guardrailSample(entry, observation, { suppressed: false, unknown: false });
      const pattern = { tool: observation.tool, reasonClass: observation.reasonClass };
      upsert({
        kind: "GUARDRAIL", patternHash, conditionKey, pattern,
        title: `防护：${observation.tool} 因 ${observation.reasonClass} 失败`,
        statement: statementOf("GUARDRAIL", entry, pattern, [sample].filter(s => s.classification === "SUPPORT"), [], [sample].filter(s => s.classification === "CASE_REFERENCE"), [sample].filter(s => s.classification === "UNKNOWN")),
        applicability: applicabilityOf({ facets: conditions, conditions: conditionText(entry).conditions, tools: [observation.tool], notApplicableWhen: ["失败原因或当时条件未核对", "把后来的成功当作原因已解决"] }),
        toolVersions: toolVersionsOf(entry, [observation.tool]), protocolVersions: protocolVersionsOf(entry),
        samples: [sample], supportMissionIds: [], counterMissionIds: [], caseMissionIds: [], unknownMissionIds: [],
        supportCount: 0, counterCount: 0, conditionComplete: conditionCoverage(conditions).complete,
        origin: sample.origin, resultLabels: labelsSummary([sample]),
      });
    }
  }
  // Attach same-pattern entries that did not create the candidate: not-adopted stays UNKNOWN,
  // explicit negatives become COUNTER; READY/unfinished missions do not add samples at all.
  for (const entry of index.entries) {
    if (!entry.engineeringCompleted && !entry.hasOutput && entry.adoptionCount === 0) continue;
    const key = conditionKeyOf(entry.conditions);
    for (const candidate of candidates.values()) {
      if (candidate.conditionKey !== key) continue;
      if (candidate.kind === "WORKFLOW") {
        const sequence = candidate.pattern.sequence ?? [];
        if (entry.successSequence.length !== sequence.length || !entry.successSequence.every((tool, i) => tool === sequence[i])) continue;
        if (candidate.samples.some(s => s.missionId === entry.missionId)) continue;
        candidate.samples.push(workflowSample(entry, { suppressed: false, unknown: false }));
      } else {
        for (const observation of entry.guardrailObservations) {
          if (observation.tool !== candidate.pattern.tool || observation.reasonClass !== candidate.pattern.reasonClass) continue;
          if (candidate.samples.some(s => s.missionId === entry.missionId && s.stepId === observation.stepId)) continue;
          candidate.samples.push(guardrailSample(entry, observation, { suppressed: false, unknown: false }));
        }
      }
    }
  }
  return [...candidates.values()].map(candidate => {
    const samples = mergeSamples(candidate.samples);
    const counts = aggregate(samples);
    return { ...candidate, samples, supportCount: counts.support.length, counterCount: counts.counter.length,
      supportMissionIds: counts.supportMissionIds, counterMissionIds: counts.counterMissionIds,
      caseMissionIds: counts.caseMissionIds, unknownMissionIds: counts.unknownMissionIds,
      resultLabels: labelsSummary(samples) };
  });
}

const SHADOW_SUPPORT_THRESHOLD = 2;

/** Recompute evidence for each candidate; source-invalid or out-of-index samples stay as history, never as support. */
export async function syncExperiences(ownerUserId: string, projectId: string): Promise<number> {
  const index = await buildTrajectoryIndex(ownerUserId, projectId);
  const continuity = await effectiveContinuity(ownerUserId, { projectId });
  const syncFingerprint = jsonHash({ trajectory: index.fingerprint, reusePolicyHash: continuity.reusePolicyHash });
  const suppressedRows = continuity.directives.some(d => d.kind === "USE_SUPPRESSION");
  const states = new Map<string, { suppressed: boolean; unknown: boolean }>();
  for (const entry of index.entries) {
    // Project-wide suppression alone does not automatically invalidate a sample; source roots decide that.
    states.set(entry.missionId, await sourceStateFor(ownerUserId, projectId, entry));
  }
  const candidates = extractCandidates(index).map(candidate => {
    const samples = candidate.samples.map(sample => {
      const state = states.get(sample.missionId) ?? { suppressed: suppressedRows, unknown: false };
      if (sample.classification === "SUPPORT" || sample.classification === "CASE_REFERENCE") {
        if (state.suppressed) return { ...sample, classification: "UNKNOWN" as const, counted: false, reason: "SOURCE_SUPPRESSED" };
        if (state.unknown) return { ...sample, classification: "UNKNOWN" as const, counted: false, reason: "SOURCE_LINEAGE_UNKNOWN" };
      }
      return sample;
    });
    const merged = mergeSamples(samples);
    const counts = aggregate(merged);
    const representative = index.entries.find(e => e.missionId === merged[0]?.missionId);
    const statement = representative
      ? statementOf(candidate.kind, representative, candidate.pattern,
        merged.filter(s => s.classification === "SUPPORT" && s.counted), merged.filter(s => s.classification === "COUNTER" && s.counted),
        merged.filter(s => s.classification === "CASE_REFERENCE"), merged.filter(s => s.classification === "UNKNOWN"))
      : candidate.statement;
    return { ...candidate, samples: merged, statement, supportCount: counts.support.length, counterCount: counts.counter.length,
      supportMissionIds: counts.supportMissionIds, counterMissionIds: counts.counterMissionIds,
      caseMissionIds: counts.caseMissionIds, unknownMissionIds: counts.unknownMissionIds, resultLabels: labelsSummary(merged) };
  });

  let changed = 0;
  for (const candidate of candidates) {
    const existing = await db.agentExperience.findUnique({ where: {
      projectId_ownerUserId_kind_patternHash_conditionKey: { projectId, ownerUserId, kind: candidate.kind, patternHash: candidate.patternHash, conditionKey: candidate.conditionKey },
    } });
    const origin = candidate.origin;
    const counters = candidate.samples.filter(s => s.classification === "COUNTER" && s.counted).map(s => ({
      missionId: s.missionId, sampleId: s.id, stepId: s.stepId, operationId: s.operationId,
      reason: s.resultLabels.negative[0]?.reason ?? s.reason, note: "明确负结果；未采用不算反例",
    }));
    const evidence = {
      schemaVersion: 2, conditionSchemaVersion: CONDITION_SCHEMA_VERSION, samples: candidate.samples.slice(0, 64),
      uniqueSupportCount: candidate.supportCount, uniqueCounterCount: candidate.counterCount,
      caseReferenceCount: candidate.caseMissionIds.length, unknownCount: candidate.unknownMissionIds.length,
      resultLabels: candidate.resultLabels,
      coverage: { missionsExamined: index.entries.length, truncated: index.truncated, complete: index.entries.length > 0 && !index.truncated },
      fingerprint: syncFingerprint, recomputedAt: new Date().toISOString(),
    };
    const priorEvidence = jsonHash(existing?.evidenceJson ?? {});
    const nextEvidence = jsonHash(evidence);
    if (existing && existing.lastSyncFingerprint === syncFingerprint && existing.evidenceVersion > 0) continue;
    const status = !existing ? (candidate.supportCount >= SHADOW_SUPPORT_THRESHOLD ? "SHADOW" : "CANDIDATE")
      : existing.status === "REVOKED" || existing.status === "ACTIVE" ? existing.status
        : candidate.supportCount >= SHADOW_SUPPORT_THRESHOLD ? "SHADOW" : "CANDIDATE";
    const data = {
      title: candidate.title, statement: candidate.statement,
      applicabilityJson: json(candidate.applicability),
      toolVersionsJson: json(candidate.toolVersions), protocolVersionsJson: json(candidate.protocolVersions),
      counterExamplesJson: json(counters),
      evidenceJson: json(evidence), resultLabelsJson: json(candidate.resultLabels),
      originJson: json(origin), sampleMissionIdsJson: json(candidate.samples.map(s => s.missionId).filter((v, i, all) => all.indexOf(v) === i).slice(0, 64)),
      supportCount: candidate.supportCount, counterCount: candidate.counterCount,
      status, lastSyncedAt: new Date(), lastSyncFingerprint: syncFingerprint,
      evidenceVersion: existing ? (nextEvidence === priorEvidence ? existing.evidenceVersion : existing.evidenceVersion + 1) : 1,
    };
    if (!existing) { await db.agentExperience.create({ data: { projectId, ownerUserId, kind: candidate.kind, patternHash: candidate.patternHash, conditionKey: candidate.conditionKey, ...data } }); changed += 1; }
    else if (nextEvidence !== priorEvidence || existing.supportCount !== candidate.supportCount || existing.counterCount !== candidate.counterCount ||
      existing.status !== status || jsonHash(existing.counterExamplesJson) !== jsonHash(counters)) {
      await db.agentExperience.update({ where: { id: existing.id }, data });
      changed += 1;
    } else {
      await db.agentExperience.update({ where: { id: existing.id }, data: { lastSyncedAt: new Date(), lastSyncFingerprint: syncFingerprint } });
    }
  }
  return changed;
}
