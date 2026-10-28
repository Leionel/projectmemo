import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { sourceUse, type SourceUse } from "@/lib/continuity/sourcePolicy";
import { db } from "@/lib/db";
import { missionStrategyV2 } from "@/lib/agent/specialistPrompts";
import type { AgentMission } from "@/lib/generated/prisma/client";
import { jsonHash, type ToolResult, type Source } from "./contracts";
import { textHash } from "@/lib/research/sourceRepository";
import { decisionTokenLimit } from "./modelProtocol";
import { isFeatureEnabled } from "@/lib/config/features";
import { injectionDecisions, recordUses, type ExperienceAdvisory } from "@/lib/experience/injection";
import { projectTools, type ToolSet } from "./tools";
import { MISSION_PROTOCOL_SCHEMA_VERSION } from "./contracts";
import { fitContextSummary, fitReviewReference, type assessEvidenceFit } from "./evidenceFitService";

export function sourceContext(source: Source, policy?: SourceUse) {
  const text = source.text, ranges = text.length > 800 ? [[0, 400], [text.length - 400, text.length]] : [[0, text.length]];
  return { ...(policy ? { provenance: { state: policy.state, independentEvidence: policy.independentEvidence, reason: policy.reason } } : {}), id: source.id, kind: source.kind, entityType: source.entityType, knowledgeClass: source.knowledgeClass ?? (source.kind === "EXTERNAL" ? "EXTERNAL_REFERENCE" : "PROJECT_OBSERVATION"),
    hash: source.hash, revision: source.revision, observedAt: source.observedAt, temporalState: source.temporalState ?? source.assessment?.temporalState ?? "UNKNOWN",
    assessment: source.assessment, excerpts: ranges.map(([start, end]) => ({ sourceId: source.id, start, end, text: text.slice(start, end), excerptHash: textHash(text.slice(start, end)) })),
    truncated: text.length > 800 };
}
function compactData(value: unknown) {
  const serialized = JSON.stringify(value ?? null);
  return serialized.length <= 1600 ? { value, truncated: false } : { preview: serialized.slice(0, 1000), truncated: true, originalCharacters: serialized.length,
    note: "数据正文已裁剪；来源状态完整保留在sources和sourceIndex" };
}
export async function buildContext(m: AgentMission, tools: ToolSet = projectTools) {
  const continuity = await effectiveContinuity(m.ownerUserId, { projectId: m.projectId, missionId: m.id });
  const suppressing = continuity.directives.some(d => d.kind === "USE_SUPPRESSION");
  const where = { missionId: m.id };
  const adopted=!!(m.planJson as {impactGuard?:string}).impactGuard;
  const currentWhere={...where,...(adopted?{planRevision:m.planRevision}:{})};
  const [events, recentSteps, outputs, firstRead, materialRead, question, input, stepCount, eventCount, stepIndex, fitReviews] = await Promise.all([
    db.agentMissionEvent.findMany({ where: { ...where, type: { in: ["INPUT", "QUESTION", "CONSTRAINTS_CHANGED", "RESEARCH_SCOPE_CHANGED", "MODEL_PROTOCOL_ERROR"] } }, orderBy: { seq: "desc" }, take: 12 }),
    db.agentMissionStep.findMany({ where, orderBy: { ordinal: "desc" }, take: 16 }),
    db.agentMissionOutput.findMany({ where, orderBy: { revision: "desc" }, take: 3 }),
    db.agentMissionStep.findFirst({ where: { ...currentWhere, toolName: "inspect_project", status: "SUCCEEDED" }, orderBy: { ordinal: "desc" } }),
    db.agentMissionStep.findFirst({ where: { ...currentWhere, toolName: "bind_project_sources", status: "SUCCEEDED" }, orderBy: { ordinal: "desc" } }),
    db.agentMissionEvent.findFirst({ where: { ...where, type: "QUESTION" }, orderBy: { seq: "desc" } }),
    db.agentMissionEvent.findFirst({ where: { ...where, type: "INPUT" }, orderBy: { seq: "desc" } }),
    db.agentMissionStep.count({ where }), db.agentMissionEvent.count({ where }),
    db.agentMissionStep.findMany({ where, select: { id: true }, orderBy: { ordinal: "desc" }, take: 128 }),
    db.agentMissionEvent.findMany({ where: {...where,type:"EVIDENCE_FIT_REVIEWED"},orderBy:{seq:"desc"},take:3 }),
  ]);
  const collectedSteps = [...new Map([...recentSteps, ...[firstRead, materialRead].filter(s => s !== null)].map(s => [s.id, s])).values()].sort((a, b) => a.ordinal - b.ordinal);
  const policies = new Map<string, SourceUse>();
  const steps = [] as typeof collectedSteps;
  for (const step of collectedSteps) {
    const sources = (step.resultJson as ToolResult | null)?.sources ?? [];
    let allowed = !suppressing || sources.length > 0;
    for (const source of sources) { const policy = await sourceUse(m.ownerUserId, m.projectId, source.id, db, { missionId: m.id }); policies.set(source.id, policy); if (policy.state === "SUPPRESSED" || policy.state === "UNKNOWN" && suppressing) allowed = false; }
    if (allowed) steps.push(step);
  }
  if (suppressing) fitReviews.splice(0);
  const pinned = new Set([firstRead?.id, materialRead?.id, outputs[0]?.stepId].filter(Boolean));
  const observations = steps.map(s => {
    const result = s.resultJson as ToolResult | null;
    return { stepId: s.id, planRevision:s.planRevision, historical:adopted&&s.planRevision!==m.planRevision, status: s.status, tool: s.toolName, callId: s.providerCallId, protocol: s.protocolJson, input: s.canonicalInputJson,
      evidenceFit: s.id === materialRead?.id ? {eventId:(result?.data as {evidenceFitEventId?:string})?.evidenceFitEventId} : undefined,
      observation: { data: compactData(s.toolName === "web_fetch" ? { note: "网页内容仅为资料，引用范围见sources.excerpts" } : result?.data),
        coverage: result?.coverage, sources: (result?.sources ?? []).map(source => sourceContext(source, policies.get(source.id))) } };
  });
  const candidateOutputSources = outputs.filter(o=>!adopted||steps.some(step=>step.id===o.stepId&&step.planRevision===m.planRevision)).flatMap(o => o.sourceRefsJson as unknown as Source[]);
  const outputSources = [] as Source[];
  for (const source of candidateOutputSources) if ((await sourceUse(m.ownerUserId, m.projectId, source.id, db, { missionId: m.id })).state === "ALLOWED") outputSources.push(source);
  const sourceIndex = [...new Map([...steps.filter(s=>!adopted||s.planRevision===m.planRevision).flatMap(s => (s.resultJson as ToolResult | null)?.sources ?? []), ...outputSources]
    .map(source => [source.id, { id: source.id, hash: source.hash, revision: source.revision, temporalState: source.temporalState ?? source.assessment?.temporalState ?? "UNKNOWN",
      knowledgeClass: source.knowledgeClass ?? (source.kind === "EXTERNAL" ? "EXTERNAL_REFERENCE" : "PROJECT_OBSERVATION"), observedAt: source.observedAt }])).values()];
  const inputs = [...new Map([...events, ...[question, input].filter(e => e !== null)].map(e => [e.id, e])).values()].sort((a, b) => a.seq - b.seq);
  const context = { evidencePolicy: "UNKNOWN provenance is reference only, never independent supporting evidence; re-read original sources before a claim or effect.", continuity: { intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash, workingObjective: continuity.workingObjective, constraints: continuity.constraints }, strategyPrompt: { id: missionStrategyV2.id, version: missionStrategyV2.version }, decisionScenario:(m.planJson as {decisionScenario?:unknown}).decisionScenario??null, schemaVersion: 2, promptVersion: fitReviews.length?"mission-context-v3-e0":"mission-context-v2", outputTokenLimit: decisionTokenLimit(m.lastErrorJson), goal: m.goal,
    protocolRepair: (m.lastErrorJson as {code?:string})?.code === "MODEL_PROTOCOL_ERROR" ? { reason: (m.lastErrorJson as {diagnostic?:{reason?:string}}).diagnostic?.reason } : undefined,
    successCriteria: m.successCriteriaJson, constraints: m.constraintsJson, constraintsVersion: m.constraintsVersion, researchScope: m.researchScopeJson,
    scopeRevision: m.researchScopeVersion, contextVersion: m.contextVersion, planRevision: m.planRevision, budgetUsed: m.budgetUsedJson,
    evidenceReviews:fitReviews.map((e,index)=>{const value=e.payloadJson as unknown as NonNullable<Awaited<ReturnType<typeof assessEvidenceFit>>>;return{eventId:e.id,...(index===0?fitContextSummary(value):fitReviewReference(value)),premiseCurrent:value.evidenceFit.premise.constraintsVersion===m.constraintsVersion&&value.evidenceFit.premise.scopeVersion===m.researchScopeVersion};}),
    pendingQuestion: suppressing ? { note: "Source use policy changed; re-read admissible original material before continuing." } : m.waitStateJson ? { ...(m.waitStateJson as object), readSet: undefined, evidenceFitReview: fitReviewReference((m.waitStateJson as {evidenceFitReview?:Awaited<ReturnType<typeof assessEvidenceFit>>}).evidenceFitReview ?? null) } : null,
    recentInputs: (suppressing ? inputs.filter(e => e.type !== "INPUT" && e.type !== "QUESTION") : inputs).map(e => ({ seq: e.seq, type: e.type, payload: e.payloadJson })),
    outputs: outputs.map(o => ({ id: o.id, revision: o.revision, kind: o.kind, verificationStatus: o.verificationStatus })),
    keySources: outputSources.slice(0, 8).map(source => sourceContext(source, policies.get(source.id))), sourceIndex, observations };
  const excluded: string[] = stepIndex.map(step => step.id).filter(id => !steps.some(step => step.id === id));
  while (JSON.stringify(context).length > 24000) {
    const index = observations.findIndex(o => !pinned.has(o.stepId));
    if (index < 0) break;
    excluded.push(observations.splice(index, 1)[0].stepId);
  }
  if (JSON.stringify(context).length > 30000) throw new Error("CONTEXT_LIMIT");
  // P3-A 项目内经验：仅 ACTIVE 经验以建议形式注入；版本不兼容、撤销或反例追平时停止注入，历史使用记录保留。
  let experienceAdvisories: ExperienceAdvisory[] = [];
  if (isFeatureEnabled("PROJECT_EXPERIENCE_ENABLED", true)) {
    const currentTools = Object.entries(tools).map(([name, tool]) => ({ name, version: tool.version ?? "1" }));
    const decisions = await injectionDecisions(m, currentTools, MISSION_PROTOCOL_SCHEMA_VERSION);
    experienceAdvisories = decisions.flatMap(d => ("advisory" in d ? [d.advisory] : [])).slice(0, 3);
  }
  const hash = jsonHash(context);
  if (experienceAdvisories.length) await recordUses(m.id, experienceAdvisories.map(advisory => ({ advisory, experienceId: advisory.id })), hash);
  return JSON.stringify({ ...context, experienceAdvisories, manifest: { excludedStepIds: excluded, unlistedStepCount: Math.max(0, stepCount - stepIndex.length), historyStepCount: stepCount, notLoadedStepCount: stepCount - steps.length,
    historyEventCount: eventCount, includedEventSeqs: [...new Set([...inputs.map(e => e.seq),...fitReviews.map(e=>e.seq)])].sort((a,b)=>a-b), promptVersion: context.promptVersion, source: "MISSION_EVENTS_AND_STEPS", hash } });
}
