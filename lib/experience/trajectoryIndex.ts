import { db } from "@/lib/db";
import { record } from "@/lib/conversation/repository";
import { createHash } from "node:crypto";
import { jsonHash } from "@/lib/mission/contracts";
import type { Source } from "@/lib/mission/contracts";
import { facetsFromMission, type ConditionFacets } from "./conditions";

/**
 * CT-8 轨迹索引：对项目内最近委托建立带分层结果标签和条件的只读投影。
 * 结果层级严格分开，绝不互相替代：
 *  engineeringCompleted      原 Mission SUCCEEDED（既定工程验收）
 *  draftExists               保存过私有成果草稿
 *  adoption                  MissionArtifactReceipt：用户确认归入成果
 *  actionCreated             经批准创建的真实 Action
 *  actionCompletedWithReceipt 带 resultCardId 的行动完成（复盘回执链）
 *  userAttested              用户亲笔结果卡/自述效果（不是工具实测）
 *  independentMeasurement    固定核算/独立工具回执（实验指标等）
 *  negative                  明确负结果（固定核算失败、行动取消等），未采用、未知不算反例
 * 失败原因只读取本条 Step 绑定的 failureJson；不再用委托最后一条全局错误套到所有失败步骤。
 */

export type TrajectoryToolCall = {
  stepId: string; ordinal: number; name: string; version: string; protocolSchemaVersion: number | null;
  status: string; operationId: string; effectKey: string | null; failure: TrajectoryFailure | null;
  input: Record<string, unknown>;
};
export type TrajectoryFailure = { code: string; reason: string | null; message: string | null; phase: string | null; category: string | null };
export type TrajectoryGuardrailObservation = {
  stepId: string; operationId: string; tool: string; reasonClass: string; failure: TrajectoryFailure;
  laterSameToolSucceeded: boolean; repairVerified: false;
};
export type TrajectoryActionOutcome = { actionId: string; status: string; resultCardId: string | null };
export type TrajectoryMetricOutcome = {
  stepId: string; status: "SETTLED" | "FAILED" | "UNKNOWN"; receiptHash: string | null;
  dataset: string | null; split: string | null; unit: string | null; seed: string | null; environment: string | null; metric: string | null;
};
export type TrajectoryResultLabels = {
  engineeringCompleted: boolean; draftExists: boolean; adopted: boolean; actionCreated: boolean;
  actionCompletedWithReceipt: boolean; userAttested: boolean; independentMeasurement: boolean;
  negative: Array<{ kind: string; stepId: string | null; operationId: string | null; reason: string }>;
};
export type TrajectoryEntry = {
  missionId: string;
  goal: string;
  status: string;
  finishedAt: Date | null;
  tools: TrajectoryToolCall[];
  successSequence: string[];
  engineeringCompleted: boolean;
  hasOutput: boolean;
  outputId: string | null;
  outputVerification: string | null;
  adoptionIds: string[];
  adoptionCount: number;
  actionOutcomes: TrajectoryActionOutcome[];
  metricOutcomes: TrajectoryMetricOutcome[];
  realOutcome: "USER_ATTESTED" | "NOT_INFERRED";
  guardrailObservations: TrajectoryGuardrailObservation[];
  rejectedApprovals: number;
  resultLabels: TrajectoryResultLabels;
  conditions: ConditionFacets;
  sourceIds: string[];
  independenceKey: string;
  fingerprint: string;
};

export type TrajectoryIndex = { projectId: string; ownerUserId: string; entries: TrajectoryEntry[]; truncated: boolean; fingerprint: string };

const MISSION_LIMIT = 20;

function failureOf(raw: unknown): TrajectoryFailure | null {
  const value = record(raw);
  if (!value || !("code" in value || "reason" in value)) return null;
  return { code: String(value.code ?? "TOOL_FAILURE"), reason: value.reason ? String(value.reason) : null,
    message: value.message ? String(value.message) : null, phase: value.phase ? String(value.phase) : null, category: value.category ? String(value.category) : null };
}

function metricFacetsOf(input: unknown) {
  const value = record(input), mapping = record(value.mapping), job = record(value.job);
  const left = record(record(job.left).mapping), right = record(record(job.right).mapping);
  const chosen = mapping.dataset ? mapping : left.dataset ? left : right;
  const pick = (key: string) => {
    const v = chosen[key] ?? record(record(value.rightSource).mapping)[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  return { dataset: pick("dataset"), split: pick("split"), unit: pick("unit"), seed: pick("seed"), environment: pick("environment"), metric: pick("metric") };
}

export async function buildTrajectoryIndex(ownerUserId: string, projectId: string): Promise<TrajectoryIndex> {
  const project = await db.project.findFirst({ where: { id: projectId, memberships: { some: { userId: ownerUserId, role: "OWNER" } } }, select: { scenario: true } });
  const missions = await db.agentMission.findMany({
    where: { ownerUserId, projectId },
    orderBy: { createdAt: "desc" },
    take: MISSION_LIMIT + 1,
    select: { id: true, goal: true, status: true, finishedAt: true, successCriteriaJson: true, constraintsJson: true, researchScopeJson: true, planJson: true },
  });
  const truncated = missions.length > MISSION_LIMIT;
  const entries: TrajectoryEntry[] = [];
  for (const m of missions.slice(0, MISSION_LIMIT)) {
    const [steps, output, receipts, rejectedApprovals] = await Promise.all([
      db.agentMissionStep.findMany({ where: { missionId: m.id }, orderBy: { ordinal: "asc" },
        select: { id: true, ordinal: true, toolName: true, toolVersion: true, status: true, protocolJson: true, resultJson: true, effectKey: true, providerCallId: true, canonicalInputJson: true, failureJson: true, verificationJson: true } }),
      db.agentMissionOutput.findFirst({ where: { missionId: m.id }, orderBy: { revision: "desc" }, select: { id: true, verificationStatus: true, sourceRefsJson: true, contentJson: true } }),
      db.missionArtifactReceipt.findMany({ where: { missionId: m.id }, select: { id: true, artifactId: true } }),
      db.agentMissionApproval.count({ where: { missionId: m.id, status: "REJECTED" } }),
    ]);
    const actions: TrajectoryActionOutcome[] = [];
    const metricOutcomes: TrajectoryMetricOutcome[] = [];
    const negative: TrajectoryResultLabels["negative"] = [];
    for (const s of steps) {
      if (s.toolName === "propose_metric_verification") {
        const protocol = record(s.protocolJson), job = record(record(record(s.canonicalInputJson).job));
        const receiptHash = protocol.sandboxJob && typeof record(protocol.sandboxJob).receiptHash === "string" ? record(protocol.sandboxJob).receiptHash as string : null;
        const facetValues = metricFacetsOf(s.canonicalInputJson);
        if (receiptHash) metricOutcomes.push({ stepId: s.id, status: "SETTLED", receiptHash, ...facetValues });
        else if (protocol.sandboxFailure) {
          metricOutcomes.push({ stepId: s.id, status: "FAILED", receiptHash: null, ...facetValues });
          negative.push({ kind: "METRIC_VERIFICATION_FAILED", stepId: s.id, operationId: s.effectKey ?? s.providerCallId ?? s.id,
            reason: String(record(protocol.sandboxFailure).code ?? "SANDBOX_JOB_FAILED") });
        } else if (record(protocol.sandboxJob).phase) metricOutcomes.push({ stepId: s.id, status: "UNKNOWN", receiptHash: null, ...facetValues });
        void job;
      }
      const actionId = record(record(s.resultJson).data).actionId;
      if (typeof actionId === "string" && s.effectKey) {
        const action = await db.actionItem.findFirst({ where: { id: actionId, projectId, dedupeKey: s.effectKey, isSimulated: false },
          select: { status: true, resultCardId: true } });
        if (action) {
          actions.push({ actionId, status: action.status, resultCardId: action.resultCardId });
          if (action.status === "CANCELLED") negative.push({ kind: "ACTION_CANCELLED", stepId: s.id,
            operationId: s.effectKey ?? actionId, reason: "ACTION_CANCELLED" });
        }
      }
    }
    const succeededLater = (tool: string, afterIndex: number) => steps.some((s, i) => i > afterIndex && s.toolName === tool && s.status === "SUCCEEDED");
    const guardrailObservations: TrajectoryGuardrailObservation[] = steps.map((s, index) => ({ s, index }))
      .filter(({ s }) => s.status === "FAILED" && failureOf(s.failureJson))
      .map(({ s, index }) => {
        const failure = failureOf(s.failureJson)!;
        return { stepId: s.id, operationId: s.effectKey ?? s.providerCallId ?? s.id, tool: s.toolName,
          reasonClass: failure.reason ?? failure.code, failure, laterSameToolSucceeded: succeededLater(s.toolName, index), repairVerified: false as const };
      });
    const ordered = steps.filter(s => s.status === "SUCCEEDED").map(s => s.toolName);
    const successSequence = ordered.filter((tool, i) => i === 0 || tool !== ordered[i - 1]);
    const outputSources = Array.isArray(output?.sourceRefsJson) ? output!.sourceRefsJson as unknown as Source[] : [];
    const sourceIds = [...new Set([...steps.flatMap(s => Array.isArray(record(s.resultJson).sources) ? (record(s.resultJson).sources as Source[]).map(x => x.id) : []),
      ...outputSources.map(s => s.id)])].sort();
    const conditions = facetsFromMission(m,
      steps.map(s => ({ toolName: s.toolName, toolVersion: s.toolVersion, status: s.status, canonicalInputJson: s.canonicalInputJson, protocolJson: s.protocolJson })),
      project?.scenario ?? null);
    const labels: TrajectoryResultLabels = {
      engineeringCompleted: m.status === "SUCCEEDED",
      draftExists: !!output,
      adopted: receipts.length > 0,
      actionCreated: actions.length > 0,
      actionCompletedWithReceipt: actions.some(a => a.status === "DONE" && !!a.resultCardId),
      userAttested: actions.some(a => !!a.resultCardId),
      independentMeasurement: metricOutcomes.some(o => o.status === "SETTLED"),
      negative,
    };
    // Independence is anchored to the original task/run and shared data roots, not UUID or file count.
    const independenceKey = createHash("sha256").update(JSON.stringify({
      goal: m.goal.trim(), criteria: m.successCriteriaJson, sources: sourceIds,
      output: output ? jsonHash({ sources: (Array.isArray(output.sourceRefsJson) ? output.sourceRefsJson as unknown as Array<{ id?: string; revision?: string; hash?: string }> : []).map(s => [s.id, s.revision, s.hash]), content: output.contentJson }) : null,
      actions: actions.map(a => a.actionId).sort(),
    })).digest("hex");
    const entry: TrajectoryEntry = {
      missionId: m.id, goal: m.goal, status: m.status, finishedAt: m.finishedAt,
      tools: steps.map(s => ({ stepId: s.id, ordinal: s.ordinal, name: s.toolName, version: s.toolVersion,
        protocolSchemaVersion: typeof record(s.protocolJson).schemaVersion === "number" ? record(s.protocolJson).schemaVersion as number : null,
        status: s.status, operationId: s.effectKey ?? s.providerCallId ?? s.id, effectKey: s.effectKey,
        failure: failureOf(s.failureJson), input: record(s.canonicalInputJson) })),
      successSequence, engineeringCompleted: labels.engineeringCompleted, hasOutput: !!output,
      outputId: output?.id ?? null, outputVerification: output?.verificationStatus ?? null,
      adoptionIds: receipts.map(r => r.id), adoptionCount: receipts.length, actionOutcomes: actions,
      metricOutcomes, realOutcome: labels.userAttested ? "USER_ATTESTED" : "NOT_INFERRED",
      guardrailObservations, rejectedApprovals: rejectedApprovals, resultLabels: labels,
      conditions, sourceIds, independenceKey,
      fingerprint: jsonHash({ missionId: m.id, status: m.status, outputId: output?.id ?? null, receipts: receipts.map(r => r.id).sort(),
        actions: actions.map(a => [a.actionId, a.status, a.resultCardId]), metric: metricOutcomes.map(o => [o.stepId, o.status, o.receiptHash]),
        failures: steps.filter(s => s.failureJson).map(s => [s.id, s.failureJson]) }),
    };
    entries.push(entry);
  }
  const fingerprint = jsonHash(entries.filter(e => e.engineeringCompleted || e.hasOutput || e.adoptionCount > 0 ||
    e.actionOutcomes.length > 0 || e.guardrailObservations.length > 0).map(e => e.fingerprint).sort());
  return { projectId, ownerUserId, entries, truncated, fingerprint };
}
