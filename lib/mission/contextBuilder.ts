import { verifyMissionResult } from "./resultVerifier";
import { AppError } from "@/lib/api";
import { metricInputSources } from "./metricInputSources";
import { record } from "@/lib/conversation/repository";
import { jsonHash as sourceJsonHash } from "./contracts";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { sourceUse, type SourceUse } from "@/lib/continuity/sourcePolicy";
import { validateSources } from "./repository";
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
    assessment: source.assessment, document:source.document, excerpts: ranges.map(([start, end]) => ({ sourceId: source.id, start, end, text: text.slice(start, end), excerptHash: textHash(text.slice(start, end)) })),
    truncated: text.length > 800 };
}
function compactData(value: unknown) {
  if(value&&typeof value==="object"&&(value as {kind?:string}).kind==="DOCUMENT_CATALOG")return {value,truncated:false};
  const serialized = JSON.stringify(value ?? null);
  return serialized.length <= 1600 ? { value, truncated: false } : { preview: serialized.slice(0, 1000), truncated: true, originalCharacters: serialized.length,
    note: "数据正文已裁剪；来源状态完整保留在sources和sourceIndex" };
}
export async function buildContext(m: AgentMission, tools: ToolSet = projectTools) {
  const continuity = await effectiveContinuity(m.ownerUserId, { projectId: m.projectId, missionId: m.id });
  const delegation = (m.planJson as { delegation?: { candidateSources?: unknown } }).delegation;
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
    if(step.toolName==="propose_metric_verification"&&step.status==="SUCCEEDED"){
      const approval=await db.agentMissionApproval.findUnique({where:{stepId:step.id}});if(approval){try{const inputs=metricInputSources(approval.readSetJson as unknown as Source[],record(record(approval.proposalJson).args).sourceBindings);step.resultJson={...record(step.resultJson),sources:inputs} as unknown as typeof step.resultJson;}catch{/* Unknown input lineage remains excluded by validation. */}}
    }
    const sources = (step.resultJson as ToolResult | null)?.sources ?? [];
    let allowed = !suppressing || sources.length > 0;
    // An old inspect_project snapshot embeds Action text in a project-level source.
    // Check those original Action roots too; a fresh read can return a filtered snapshot.
    if (step.toolName === "inspect_project") {
      const actions = (step.resultJson as { data?: { actions?: Array<{ id: string }> } } | null)?.data?.actions ?? [];
      for (const action of actions) if ((await sourceUse(m.ownerUserId, m.projectId, "action:" + action.id, db, { missionId: m.id })).state !== "ALLOWED") allowed = false;
    }
    for (const source of sources) { const policy = await sourceUse(m.ownerUserId, m.projectId, source.id, db, { missionId: m.id }); policies.set(source.id, policy); if (policy.state === "SUPPRESSED" || policy.state === "UNKNOWN" && suppressing) allowed = false; }
    if(["inspect_experiment_metrics","compare_experiment_metrics","propose_metric_verification"].includes(step.toolName)){try{await validateSources(m.projectId,sources,db,m.id);}catch{allowed=false;}}
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
  const actionReadbacks=[];
  for(const approval of await db.agentMissionApproval.findMany({where:{missionId:m.id,status:"CONSUMED"},include:{step:true}})){
    const id=(approval.step.resultJson as {data?:{actionId?:string}}|null)?.data?.actionId;if(!id)continue;
    const action=await db.actionItem.findFirst({where:{id,projectId:m.projectId,isSimulated:false}});if(!action)continue;
    if((await sourceUse(m.ownerUserId,m.projectId,"action:"+id,db,{missionId:m.id})).state!=="ALLOWED")continue;
    actionReadbacks.push({actionId:id,sourceId:"action:"+id,revision:sourceJsonHash(action),reportedState:action.status,hasResultReceipt:!!action.resultCardId,note:"当前服务端状态指针；创建时的TODO回执不是当前状态。需要结果内容或引用时使用inspect_action回读原行动。"});
  }
  let completionReadback:unknown={canFinish:false,reason:"OUTPUT_REQUIRED"};
  if(outputs[0])try{completionReadback={canFinish:true,...await verifyMissionResult(db,m,outputs[0].id),note:"服务端验收条件已满足；若草稿回答了目标，选择finish，不重复保存相同草稿。NEEDS_REVIEW标识内容核验状态，不冒充现实效果。"};}
  catch(error){if(!(error instanceof AppError))throw error;completionReadback={canFinish:false,outputId:outputs[0].id,reason:error.code,checks:error.details};}
  const context = { completionReadback,actionReadbacks,investigationDelegation: delegation ? { policy: m.continuationPolicyJson, newSourcePointers: delegation.candidateSources ?? [] } : undefined, evidencePolicy: "UNKNOWN provenance is reference only, never independent supporting evidence; re-read original sources before a claim or effect.", continuity: { intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash, workingObjective: continuity.workingObjective, constraints: continuity.constraints }, strategyPrompt: { id: missionStrategyV2.id, version: missionStrategyV2.version }, decisionScenario:(m.planJson as {decisionScenario?:unknown}).decisionScenario??null, schemaVersion: 2, promptVersion: fitReviews.length?"mission-context-v3-e0":"mission-context-v2", outputTokenLimit: decisionTokenLimit(m.lastErrorJson), goal: m.goal,
    protocolRepair: (m.lastErrorJson as {code?:string})?.code === "MODEL_PROTOCOL_ERROR" ? { reason: (m.lastErrorJson as {diagnostic?:{reason?:string}}).diagnostic?.reason } : undefined,
    successCriteria: m.successCriteriaJson, constraints: m.constraintsJson, constraintsVersion: m.constraintsVersion, researchScope: m.researchScopeJson,
    scopeRevision: m.researchScopeVersion, contextVersion: m.contextVersion, planRevision: m.planRevision, budgetLimits:m.budgetJson,budgetUsed: m.budgetUsedJson,
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
