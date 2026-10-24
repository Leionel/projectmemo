import { db } from "@/lib/db";
import type { AgentMission } from "@/lib/generated/prisma/client";
import { jsonHash, type ToolResult, type Source } from "./contracts";
import { textHash } from "@/lib/research/sourceRepository";
import { decisionTokenLimit } from "./modelProtocol";

export function sourceContext(source: Source) {
  const text = source.text, ranges = text.length > 800 ? [[0, 400], [text.length - 400, text.length]] : [[0, text.length]];
  return { id: source.id, kind: source.kind, entityType: source.entityType, knowledgeClass: source.knowledgeClass ?? (source.kind === "EXTERNAL" ? "EXTERNAL_REFERENCE" : "PROJECT_OBSERVATION"),
    hash: source.hash, revision: source.revision, observedAt: source.observedAt, temporalState: source.temporalState ?? source.assessment?.temporalState ?? "UNKNOWN",
    assessment: source.assessment, excerpts: ranges.map(([start, end]) => ({ sourceId: source.id, start, end, text: text.slice(start, end), excerptHash: textHash(text.slice(start, end)) })),
    truncated: text.length > 800 };
}
function compactData(value: unknown) {
  const serialized = JSON.stringify(value ?? null);
  return serialized.length <= 1600 ? { value, truncated: false } : { preview: serialized.slice(0, 1000), truncated: true, originalCharacters: serialized.length,
    note: "数据正文已裁剪；来源状态完整保留在sources和sourceIndex" };
}
export async function buildContext(m: AgentMission) {
  const where = { missionId: m.id };
  const adopted=!!(m.planJson as {impactGuard?:string}).impactGuard;
  const currentWhere={...where,...(adopted?{planRevision:m.planRevision}:{})};
  const [events, recentSteps, outputs, firstRead, materialRead, question, input, stepCount, eventCount, stepIndex] = await Promise.all([
    db.agentMissionEvent.findMany({ where: { ...where, type: { in: ["INPUT", "QUESTION", "CONSTRAINTS_CHANGED", "RESEARCH_SCOPE_CHANGED", "MODEL_PROTOCOL_ERROR"] } }, orderBy: { seq: "desc" }, take: 12 }),
    db.agentMissionStep.findMany({ where, orderBy: { ordinal: "desc" }, take: 16 }),
    db.agentMissionOutput.findMany({ where, orderBy: { revision: "desc" }, take: 3 }),
    db.agentMissionStep.findFirst({ where: { ...currentWhere, toolName: "inspect_project", status: "SUCCEEDED" }, orderBy: { ordinal: "desc" } }),
    db.agentMissionStep.findFirst({ where: { ...currentWhere, toolName: "bind_project_sources", status: "SUCCEEDED" }, orderBy: { ordinal: "desc" } }),
    db.agentMissionEvent.findFirst({ where: { ...where, type: "QUESTION" }, orderBy: { seq: "desc" } }),
    db.agentMissionEvent.findFirst({ where: { ...where, type: "INPUT" }, orderBy: { seq: "desc" } }),
    db.agentMissionStep.count({ where }), db.agentMissionEvent.count({ where }),
    db.agentMissionStep.findMany({ where, select: { id: true }, orderBy: { ordinal: "desc" }, take: 128 }),
  ]);
  const steps = [...new Map([...recentSteps, ...[firstRead, materialRead].filter(s => s !== null)].map(s => [s.id, s])).values()].sort((a, b) => a.ordinal - b.ordinal);
  const pinned = new Set([firstRead?.id, materialRead?.id, outputs[0]?.stepId].filter(Boolean));
  const observations = steps.map(s => {
    const result = s.resultJson as ToolResult | null;
    return { stepId: s.id, planRevision:s.planRevision, historical:adopted&&s.planRevision!==m.planRevision, status: s.status, tool: s.toolName, callId: s.providerCallId, protocol: s.protocolJson, input: s.canonicalInputJson,
      observation: { data: compactData(s.toolName === "web_fetch" ? { note: "网页内容仅为资料，引用范围见sources.excerpts" } : result?.data),
        coverage: result?.coverage, sources: (result?.sources ?? []).map(sourceContext) } };
  });
  const outputSources = outputs.filter(o=>!adopted||steps.some(step=>step.id===o.stepId&&step.planRevision===m.planRevision)).flatMap(o => o.sourceRefsJson as unknown as Source[]);
  const sourceIndex = [...new Map([...steps.filter(s=>!adopted||s.planRevision===m.planRevision).flatMap(s => (s.resultJson as ToolResult | null)?.sources ?? []), ...outputSources]
    .map(source => [source.id, { id: source.id, hash: source.hash, revision: source.revision, temporalState: source.temporalState ?? source.assessment?.temporalState ?? "UNKNOWN",
      knowledgeClass: source.knowledgeClass ?? (source.kind === "EXTERNAL" ? "EXTERNAL_REFERENCE" : "PROJECT_OBSERVATION"), observedAt: source.observedAt }])).values()];
  const inputs = [...new Map([...events, ...[question, input].filter(e => e !== null)].map(e => [e.id, e])).values()].sort((a, b) => a.seq - b.seq);
  const context = { decisionScenario:(m.planJson as {decisionScenario?:unknown}).decisionScenario??null, schemaVersion: 2, promptVersion: "mission-context-v2", outputTokenLimit: decisionTokenLimit(m.lastErrorJson), goal: m.goal,
    protocolRepair: (m.lastErrorJson as {code?:string})?.code === "MODEL_PROTOCOL_ERROR" ? { reason: (m.lastErrorJson as {diagnostic?:{reason?:string}}).diagnostic?.reason } : undefined,
    successCriteria: m.successCriteriaJson, constraints: m.constraintsJson, constraintsVersion: m.constraintsVersion, researchScope: m.researchScopeJson,
    scopeRevision: m.researchScopeVersion, contextVersion: m.contextVersion, planRevision: m.planRevision, budgetUsed: m.budgetUsedJson,
    pendingQuestion: m.waitStateJson ? { ...(m.waitStateJson as object), readSet: undefined } : null,
    recentInputs: inputs.map(e => ({ seq: e.seq, type: e.type, payload: e.payloadJson })),
    outputs: outputs.map(o => ({ id: o.id, revision: o.revision, kind: o.kind, verificationStatus: o.verificationStatus })),
    keySources: outputSources.slice(0, 8).map(sourceContext), sourceIndex, observations };
  const excluded: string[] = stepIndex.map(step => step.id).filter(id => !steps.some(step => step.id === id));
  while (JSON.stringify(context).length > 24000) {
    const index = observations.findIndex(o => !pinned.has(o.stepId));
    if (index < 0) break;
    excluded.push(observations.splice(index, 1)[0].stepId);
  }
  if (JSON.stringify(context).length > 30000) throw new Error("CONTEXT_LIMIT");
  return JSON.stringify({ ...context, manifest: { excludedStepIds: excluded, unlistedStepCount: Math.max(0, stepCount - stepIndex.length), historyStepCount: stepCount, notLoadedStepCount: stepCount - steps.length,
    historyEventCount: eventCount, includedEventSeqs: inputs.map(e => e.seq), promptVersion: context.promptVersion, source: "MISSION_EVENTS_AND_STEPS", hash: jsonHash(context) } });
}
