import { assertTurnCurrent } from "@/lib/continuity/turnCoordination";
import { currentGeneration, generationCallId } from "./turnRuntime";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { workspaceDirectory, observeProjects, type WorkspaceDirectory } from "@/lib/services/workspaceContextService";
import { goalGapSchema, investigationDecisionSchema, type GoalGap, type InvestigationBudget, type InvestigationDecision, type InvestigationStep } from "@/lib/types/agentExperience";
import type { ConversationActor, ConversationRef, ConversationSource } from "@/lib/types/conversation";
import { assertProject, lockConversation, ownedConversation, record } from "./repository";
import { bindAnswerEvidence } from "./answerEvidence";
import { validateReadSources } from "./service";
import { answerSchema, conversationModelSpec } from "./model";
import type { z } from "zod";
import { answerV2, investigateV1, investigateInternalV1, investigateReadV1, routeV2, type InvestigationFrame } from "./promptSpecs";
import { discoverMaterialPointers, experienceSourceRef, readWorkspaceTool, workspaceReadTools, type MaterialPointer } from "./toolAdapter";
import { assertTurnLease, mutateTurn, turnOperation, turnElapsedMs } from "./turnRuntime";
import { readResearchScope, validateWebSource } from "./researchScope";
import { readConversationResearchTool, registerUserUrls, reuseWebSources, userUrls } from "./researchTools";
import { researchCoverageSchema, type ResearchCoverage } from "@/lib/types/conversationResearch";
import { readSourceObservation } from "./sourceObservation";
import { bindResearchCoverage } from "./researchCoverage";
import { admitDirective } from "@/lib/continuity/admission";
import { isFeatureEnabled } from "@/lib/config/features";
import { readConversationRepositoryTool } from "./repositoryTools";
import type { RepositoryCiCall } from "@/lib/types/repositoryCi";
import { readConversationDocumentTool } from "./documentTools";
import type { DocumentCall } from "@/lib/types/document";
import { bindInvestigationGoal } from "./experienceContract";

export type R4State = {
  schemaVersion: 1; policyVersion: "r4-v1"; phase: "ROUTING" | "READING_SOURCE" | "EVALUATING" | "WAITING_MODEL" | "WAITING_USER" | "READY" | "UNKNOWN";
  budget: InvestigationBudget; projectIds: string[]; goalGaps: GoalGap[]; steps: InvestigationStep[];
  observedProjectIds: string[];
  decision: InvestigationDecision | null; stopReason: string | null; pointers: MaterialPointer[];
  researchCoverage?: ResearchCoverage;
};
export type R4Observation = { sources: ConversationSource[]; refs: ConversationRef[]; coverage: Record<string, unknown> };
export function investigationBudget(mode: "QUICK" | "STANDARD" | "DEEP" = "STANDARD"): InvestigationBudget {
  const profiles = {
    QUICK: { maxModelCalls: 5, maxToolReads: 1, maxInputTokens: 24000, maxOutputTokens: 12000, maxElapsedMs: 70000 },
    STANDARD: { maxModelCalls: 9, maxToolReads: 5, maxInputTokens: 80000, maxOutputTokens: 24000, maxElapsedMs: 110000 },
    DEEP: { maxModelCalls: 12, maxToolReads: 8, maxInputTokens: 160000, maxOutputTokens: 32000, maxElapsedMs: 180000 },
  };
  return { mode, deepApproved: mode === "DEEP", maxProjects: 3, ...profiles[mode] };
}
export function r4State(manifest: unknown): R4State | null {
  const state = record(record(manifest).experience);
  return state.policyVersion === "r4-v1" ? state as R4State : null;
}
export function turnTimeoutMs(turn: { readManifestJson: unknown }) {
  return Math.min(195000, (r4State(turn.readManifestJson)?.budget?.maxElapsedMs ?? 105000) + 15000);
}
export async function saveR4State(actor: ConversationActor, id: string, turnId: string, state: R4State, sources: ConversationSource[] = []) {
  await db.$transaction(async tx => {
    await lockConversation(tx, id);
    const c = await ownedConversation(actor, id, tx), turn = await tx.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
    assertTurnLease(turn);
    await assertTurnCurrent(turn, actor.userId, currentGeneration(), tx);
    if (record(turn.readManifestJson).stopRequested === true) throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
    if (c.activeTurnId !== turnId || c.version !== turn.baseVersion + 1 || !["OBSERVING", "GENERATING"].includes(turn.status))
      throw new AppError("TURN_CHANGED", "原讨论已中断或上下文已变化", 409);
    await validateReadSources(actor, sources, tx);
    for (const p of state.projectIds) await assertProject(actor, p, tx);
    const prior = record(turn.readManifestJson);
    const events = (prior.progressEvents ?? []) as Array<{ seq: number; phase: string; at: string; stepId: string | null }>;
    const stepId = state.steps.at(-1)?.id ?? null;
    if (events.at(-1)?.phase !== state.phase || events.at(-1)?.stepId !== stepId)
      events.push({ seq: (events.at(-1)?.seq ?? 0) + 1, phase: state.phase, at: new Date().toISOString(), stepId });
    await tx.conversationTurn.update({ where: { id: turnId }, data: { readManifestJson: json({ ...prior, progressEvents: events.slice(-64),
      schemaVersion: 1, experience: state, sourceRefs: sources.map(s => ({ projectId: s.projectId, id: s.sourceId, revision: s.revision, ...(s.external ? { webSource: s } : {}) })) }) } });
  });
}
async function validateContext(actor: ConversationActor, directory: WorkspaceDirectory, observations?: R4Observation, pointers: MaterialPointer[] = []) {
  for (const p of directory.summaries) await assertProject(actor, p.id);
  if (observations) {
    await validateReadSources(actor, observations.sources);
    for (const ref of observations.refs.filter(r => r.kind === "MISSION")) {
      const member = await assertProject(actor, ref.projectId);
      if (member.role !== "OWNER" || !await db.agentMission.findFirst({ where: { id: ref.id, projectId: ref.projectId, ownerUserId: actor.userId, version: ref.version } }))
        throw new AppError("MISSION_CHANGED", "原委托权限或状态已变化", 409);
    }
  }
  // Pointer metadata was also disclosed to the model, even before the body was read.
  const { sourceHash } = await import("@/lib/mission/repository");
  for (const p of pointers.filter(v => !v.sourceId.startsWith("web:"))) if ((p.sourceId.startsWith("repo:") ? (await readSourceObservation(actor, p.projectId, p.sourceId.slice(5))).revision : await sourceHash(p.projectId, p.sourceId)) !== p.revision)
    throw new AppError("SOURCE_CHANGED", "本轮定位的资料已变化，请重新讨论", 409);
}

function normalizeGoals(frame: InvestigationFrame, directory: WorkspaceDirectory, observations: R4Observation): GoalGap[] {
  if (new Set(frame.goalAssessments.map(g => g.projectId)).size !== frame.goalAssessments.length)
    throw new AppError("MODEL_PROTOCOL_INVALID", "目标判断出现重复项目", 409);
  return frame.goalAssessments.map((g, index) => {
    const p = directory.summaries.find(p => p.id === g.projectId);
    const goalSource = observations.sources.find(s => s.projectId === g.projectId && s.sourceId === "project:" + g.projectId);
    if (!p || !goalSource || g.goalQuote !== p.goal.slice(0, 1500)) throw new AppError("GOAL_CHANGED", "目标引用不匹配，请重新核对原项目", 409);
    const criteria = g.criteria.map((criterion, ordinal) => {
      const bound = bindAnswerEvidence(criterion.observations, observations.sources);
      if (!bound) throw new AppError("UNSUPPORTED_QUOTE", "目标判断引用未通过原文核对", 409);
      const evidence = criterion.observations.map((o, i) => {
        const quote = bound[i], s = observations.sources.find(s => s.id === quote.sourceId)!;
        if (s.projectId !== p.id) throw new AppError("INVALID_ROUTE", "目标证据属于其他项目", 409);
        return { source: experienceSourceRef(s), excerptHash: s.excerptHash, quote: quote.quote, observedAt: s.observedAt,
          readScope: s.readScope ?? (s.sourceId.startsWith("card:") ? "SUMMARY" as const : "EXCERPT" as const),
          claim: criterion.requirement, relation: o.relation, applicability: s.temporalState === "CONTESTED" ? "UNKNOWN" as const : o.applicability,
          verification: "REPORTED" as const, reason: "项目记录与模型判断；尚未作为独立验收结论" };
      });
      let state = criterion.state;
      if (state === "VERIFIED") state = "REPORTED";
      if (state === "NOT_APPLICABLE" || !evidence.length || evidence.every(e => e.applicability !== "DIRECT")) state = "UNKNOWN";
      if (state === "BLOCKED" && !evidence.some(e => e.relation === "CONTRADICTS" && e.applicability === "DIRECT")) state = "UNKNOWN";
      return { id: `${p.id}-criterion-${ordinal}`, requirement: criterion.requirement, state, explanation: criterion.explanation, evidence };
    });
    return goalGapSchema.parse({ schemaVersion: 1, id: `${p.id}-gap-${index}`, projectId: p.id,
      goalRef: { kind: "PROJECT", id: p.id, projectId: p.id, revision: goalSource.revision }, goalQuote: g.goalQuote, workingObjective: p.workingObjective, intentHash: p.continuityHash,
      criteria, blockers: g.blockers, keyUnknowns: g.keyUnknowns, nextInformationNeed: g.nextInformationNeed });
  });
}

async function executeInvestigation(actor: ConversationActor, id: string, turnId: string, input: {
  message: string; mode?: "QUICK" | "STANDARD" | "DEEP"; focus?: string; constraints: string[]; frozenRefs: ConversationRef[];
  userProvidedUrls?: string[];
  priorWebSources?: ConversationSource[];
  evaluationVariant?: "PROMPT_ONLY" | "INVESTIGATION_ONLY";
  directory: WorkspaceDirectory; exactRef?: { kind: "MISSION" | "ACTION"; id: string; projectId: string };
  recentDialogue: Array<{ role: string; content: string }>;
}) {
  const state: R4State = { schemaVersion: 1, policyVersion: "r4-v1", phase: "ROUTING", budget: investigationBudget(input.mode),
    projectIds: [], observedProjectIds: input.directory.summaries.map(p => p.id), goalGaps: [], steps: [], decision: null, stopReason: null, pointers: [] };
  await saveR4State(actor, id, turnId, state);
  await validateContext(actor, input.directory);
  const grant = await readResearchScope(actor, id);
  const routed = await conversationModelSpec(actor, id, turnId, "route", routeV2, { message: input.message, focus: input.focus,
    ...(grant.available ? { research: { enabled: grant.scope.enabled, scope: grant.scope } } : {}),
    frozenRefs: input.frozenRefs, pinnedConstraints: input.constraints, coverage: input.directory.coverage,
    directory: input.directory.summaries.map(p => ({ id: p.id, title: p.title.slice(0, 80), goal: p.goal.slice(0, 200), workingObjective: p.workingObjective, deadline: p.deadline,
      waiting: p.waiting, blocking: p.blocked, preference: p.preference })) });
  const route = routed.data;
  if (route.projectIds.some(p => !input.directory.summaries.some(v => v.id === p))) throw new AppError("INVALID_ROUTE", "模型选择了未授权项目", 409);
  if (input.focus) route.projectIds = [input.focus, ...route.projectIds.filter(p => p !== input.focus)].slice(0, 3);
  const candidate = route.directiveCandidate;
  if (candidate && admitDirective({ commandId: "classify", expectedSeq: 0, operation: "SET", scope: { projectId: candidate.projectId }, quote: input.message, admission: "LITERAL", timezone: "Asia/Shanghai" }).status !== "DIRECT_APPLIED" && input.message.includes(candidate.quote) && route.projectIds.includes(candidate.projectId) &&
    !/[“”「」『』"<>]|他说|她说|据说|如果|假如/.test(input.message)) {
    await mutateTurn(actor, id, turnId, manifest => {
      if (!manifest.coordination) return manifest;
      const generation = currentGeneration()!;
      const coord = record(manifest.coordination), scopes = coord.scopes as Array<{ projectId: string }>, index = scopes.findIndex(s => s.projectId === candidate.projectId);
      const bindingScope = scopes[index] as { projectId: string; conversationId?: string; missionId?: string };
      return { ...manifest, directiveCandidate: { ...candidate, turnId, generation, bindingScope,
        scope: { projectId: candidate.projectId, ...(bindingScope?.missionId ? { missionId: bindingScope.missionId } : {}) }, binding: (coord.bindings as unknown[])[index],
        id: turnId + ":" + generation + ":" + jsonHash(candidate), status: "INTERPRETATION_CANDIDATE" } };
    });
  }
  state.projectIds = route.projectIds;
  const conversation = await ownedConversation(actor, id);
  const directory = await workspaceDirectory(actor, conversation.scope, conversation.homeProjectId, input.focus);
  await validateContext(actor, directory);
  const observations: R4Observation = route.intent === "CLARIFY" ? { refs: input.frozenRefs, sources: [], coverage: { complete: false } }
    : await observeProjects(actor, directory, route.projectIds, route.query || input.message, input.exactRef);
  const checkpoint = record(record((await db.conversationTurn.findUniqueOrThrow({ where: { id: turnId } })).readManifestJson).initialObservation);
  if (checkpoint.observations) Object.assign(observations, checkpoint.observations);
  else await mutateTurn(actor, id, turnId, manifest => ({ ...manifest, initialObservation: { observations, asOf: new Date().toISOString().slice(0, 10) } }));
  const researchAllowed = grant.available && (grant.scope.enabled || userUrls(input.message, input.userProvidedUrls).length > 0 || !!input.priorWebSources?.length) && !input.constraints.some(c => /不联网|禁止联网|不要联网/.test(c));
  if (researchAllowed && input.priorWebSources?.length) {
    const prior = await reuseWebSources(actor, id, turnId, input.priorWebSources);
    observations.sources = [...new Map([...observations.sources, ...prior].map(s => [s.id, s])).values()];
  }
  if (researchAllowed && route.projectIds.length && userUrls(input.message, input.userProvidedUrls).length) {
    const urls = await registerUserUrls(actor, id, turnId, route.projectIds[0], input.message, input.userProvidedUrls);
    observations.sources = [...new Map([...observations.sources, ...urls].map(s => [s.id, s])).values()];
    route.investigate = true;
  }
  state.pointers = await discoverMaterialPointers(actor, route.projectIds, observations.sources);
  const ciAllowed = isFeatureEnabled("REPO_CI_OBSERVER_ENABLED", false) && state.pointers.some(p => p.ciAccess && p.ciAccess !== "COMMITS");
  let provider = routed.provider;
  const scopeDirectory = { ...directory, summaries: directory.summaries.filter(p => route.projectIds.includes(p.id)) };
  const context = () => ({ message: input.message, intent: route.intent, pinnedConstraints: input.constraints,
    interpretationCandidate: candidate ? { ...candidate, authority: "UNCONFIRMED_MODEL_INTERPRETATION" } : undefined,
    projects: scopeDirectory.summaries.map(p => ({ id: p.id, title: p.title, goal: p.goal.slice(0, 1500), workingObjective: p.workingObjective, deadline: p.deadline, priority: p.priority })),
    sources: observations.sources.map((s, i) => ({ id: s.id, sourceId: s.sourceId, revision: s.revision, projectId: s.projectId, title: s.title,
      excerpt: s.excerpt.slice(0, Math.min(1200, Math.floor(4800 / Math.max(1, observations.sources.length)))),
      readScope: s.readScope, knowledgeClass: s.knowledgeClass, temporalState: s.temporalState, citationNumber: i + 1,
      ...(s.document?{document:s.document}:{}),
      ...(s.external ? { external: { readLevel: s.external.readLevel, requestedUrl: s.external.requestedUrl, publishedAt: s.external.publishedAt, fetchedAt: s.external.fetchedAt,
        modelExcerptTruncated: s.excerpt.length > Math.min(1200, Math.floor(4800 / Math.max(1, observations.sources.length))) || s.external.truncated } } : {}) })),
    goalGaps: state.goalGaps, materialPointers: state.pointers,
    ...(researchAllowed ? { research: { ...grant, questionHash: jsonHash(input.message), asOf: (checkpoint.asOf as string | undefined) ?? (new Date()).toISOString().slice(0, 10),
      coverage: state.researchCoverage, readingLevels: "摘要不等于正文，正文片段不等于完整文档；适用/生效状态未知保持未知" } } : {}),
    recentDialogue: input.recentDialogue.slice(-6).map(m => ({ role: m.role, text: m.content.slice(0, 500) })) });
  const seen = new Set<string>(); let noGain = 0;
  if (input.evaluationVariant !== "PROMPT_ONLY" && route.investigate && route.intent !== "CLARIFY") while (true) {
    await validateContext(actor, scopeDirectory, observations, state.pointers);
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
    const cachedDecision = record(record(turn.readManifestJson).modelResults)[generationCallId("investigate-" + state.steps.length)];
    if (!cachedDecision && (turn.callCount >= state.budget.maxModelCalls - 2 ||
      turnElapsedMs(turn) > state.budget.maxElapsedMs - 20000)) {
      state.decision = { decision: "STOP", reason: "BUDGET_EXHAUSTED", explanation: "本轮调查已到预算边界，先根据现有观察说明情况。" };
      state.stopReason = "BUDGET_EXHAUSTED"; break;
    }
    state.phase = "EVALUATING"; await saveR4State(actor, id, turnId, state, observations.sources);
    const callId = "investigate-" + state.steps.length;
    const frameInput = { ...context(),
      allowedTools: [...(researchAllowed ? [...workspaceReadTools, ...(grant.scope.enabled ? ["web_search"] : []), "web_fetch"] : workspaceReadTools), ...(ciAllowed ? ["read_repository_ci", "read_ci_jobs", "read_ci_log"] : []),...(isFeatureEnabled("DOCUMENT_DEEP_READ_ENABLED",false)?["inspect_document","read_document_page","read_document_section","read_document_table"]:[])],
      previousSteps: state.steps.map(s => ({ decision: s.decision, status: s.status, coverage: s.coverage, failureReason: s.failureReason })),
      remaining: { modelCalls: state.budget.maxModelCalls - turn.callCount, reads: state.budget.maxToolReads - state.steps.length } };
    const frame = input.evaluationVariant === "INVESTIGATION_ONLY"
      ? await conversationModelSpec(actor, id, turnId, callId, investigateReadV1, frameInput).then(result => ({ ...result, data: { goalAssessments: [], decision: result.data, researchCoverage: undefined } }))
      : await conversationModelSpec(actor, id, turnId, callId, researchAllowed ? investigateV1 : investigateInternalV1, frameInput);
    provider = frame.provider;
    await validateContext(actor, scopeDirectory, observations, state.pointers);
    state.goalGaps = normalizeGoals(frame.data, scopeDirectory, observations);
    if (frame.data.researchCoverage && researchAllowed) {
      const coverage = researchCoverageSchema.parse({ ...frame.data.researchCoverage, schemaVersion: 1, questionHash: jsonHash(input.message), scopeRevision: grant.revision,
        asOf: (checkpoint.asOf as string | undefined) ?? new Date().toISOString().slice(0, 10) });
      state.researchCoverage = bindResearchCoverage(coverage, observations.sources);
    }
    state.decision = investigationDecisionSchema.parse(frame.data.decision);
    if (state.decision.decision !== "READ_EXISTING") {
      if (state.decision.decision === "STOP") state.stopReason = state.decision.reason;
      if (state.decision.decision === "HANDOFF_MISSION") {
        const mission = state.decision.mission;
        if (!observations.refs.some(r => r.kind === "MISSION" && r.id === mission.id && r.projectId === mission.projectId && String(r.version) === mission.revision))
          throw new AppError("MISSION_NOT_FOUND", "未找到可接续的原委托", 404);
      }
      break;
    }
    const decision = state.decision, argsHash = jsonHash(decision.call);
    let goalBinding:InvestigationStep["goalBinding"];
    if(input.evaluationVariant!=="INVESTIGATION_ONLY"){
      try{goalBinding=bindInvestigationGoal(decision,state.goalGaps);}catch{throw new AppError("INVESTIGATION_GOAL_UNBOUND","调查步骤没有关联当前目标缺口",409);}
    }
    if (state.steps.length >= state.budget.maxToolReads) {
      state.stopReason = "BUDGET_EXHAUSTED"; state.decision = { decision: "STOP", reason: "BUDGET_EXHAUSTED", explanation: "本轮读取额度已用完，先依据当前资料回答。" }; break;
    }
    if (seen.has(argsHash)) { state.stopReason = "NO_GAIN"; state.decision = { decision: "STOP", reason: "NO_GAIN", explanation: "重复读取不会带来新信息，本轮先停止。" }; break; }
    seen.add(argsHash);
    const step: InvestigationStep = { schemaVersion: 1, id: `${turnId}-read-${state.steps.length + 1}`, turnId, seq: state.steps.length + 1,
      decision, goalBinding, inputHash: argsHash, readSetHash: jsonHash(observations.sources.map(s => ({ id: s.id, revision: s.revision, excerptHash: s.excerptHash }))),
      status: "STARTED", startedAt: new Date().toISOString(), finishedAt: null, observationHash: null, sources: [],
      coverage: { complete: false, description: decision.informationNeed }, reservationId: callId, provider, usage: frame.usage, failureReason: null };
    state.steps.push(step); state.phase = "READING_SOURCE"; await saveR4State(actor, id, turnId, state, observations.sources);
    try {
      const web = decision.call.tool === "web_search" || decision.call.tool === "web_fetch";
      const ci = ["read_repository_ci", "read_ci_jobs", "read_ci_log"].includes(decision.call.tool);
      const doc=["inspect_document","read_document_page","read_document_section","read_document_table"].includes(decision.call.tool);
      if (ci && !ciAllowed) throw new AppError("CI_NOT_AUTHORIZED", "本轮没有获准的 CI 连接", 409);
      if (web && !researchAllowed) throw new AppError("RESEARCH_NOT_ALLOWED", "本轮未授权联网调查", 409);
      const result = await turnOperation(actor, id, turnId, "read-" + step.seq, "READ", decision.call, () => doc?readConversationDocumentTool(actor,id,turnId,decision.call as DocumentCall,state.pointers):ci
        ? readConversationRepositoryTool(actor, id, turnId, decision.call as RepositoryCiCall, state.pointers, observations.sources)
        : web
        ? readConversationResearchTool(actor, id, turnId, "web-" + step.seq, decision.call as import("@/lib/types/conversationResearch").ResearchToolCall)
        : readWorkspaceTool(actor, decision.call, route.projectIds, state.pointers, observations.sources));
      for (const source of result.sources.filter(s => s.external)) await validateWebSource(actor, source);
      const added = result.sources.filter(s => !observations.sources.some(old => old.id === s.id && old.revision === s.revision && old.excerptHash === s.excerptHash));
      step.status = "SUCCEEDED"; step.finishedAt = new Date().toISOString(); step.observationHash = jsonHash(result);
      step.sources = result.sources.map(experienceSourceRef); step.coverage = { complete: result.coverage.complete === true, description: JSON.stringify(result.coverage).slice(0, 1800) };
      const combined = [...new Map([...observations.sources, ...result.sources].map(s => [s.id, s])).values()];
      if (combined.length > 24 || combined.reduce((n, s) => n + s.excerpt.length, 0) > 24000)
        throw new AppError("CONTEXT_LIMIT", "已读资料达到本轮容量，请缩小问题后继续", 409);
      observations.sources = combined;
      state.pointers = [...new Map([...state.pointers, ...result.discovered].map(p => [p.projectId + "/" + p.sourceId, p])).values()].slice(0, 64);
      await saveR4State(actor, id, turnId, state, observations.sources);
      noGain = added.length ? 0 : noGain + 1;
      if (noGain >= 2) { state.stopReason = "NO_GAIN"; state.decision = { decision: "STOP", reason: "NO_GAIN", explanation: "连续读取未补充新的依据，先保留当前判断。" }; break; }
    } catch (e) {
      step.status = "FAILED"; step.finishedAt = new Date().toISOString(); step.failureReason = e instanceof AppError ? e.message : "资料读取中断";
      // Persist failure without stale source content; access checks still apply.
      await saveR4State(actor, id, turnId, state).catch(() => undefined);
      if ((decision.call.tool === "web_search" || decision.call.tool === "web_fetch") && e instanceof AppError &&
        ["SOURCE_BLOCKED", "SOURCE_UNAVAILABLE", "EMPTY_SOURCE", "RESEARCH_RETRYABLE", "SEARCH_AUTH_ERROR", "SEARCH_BALANCE_EMPTY", "SEARCH_NOT_CONFIGURED", "EXTERNAL_BUDGET_EXHAUSTED", "CONTEXT_LIMIT", "QUERY_TOO_LONG", "QUERY_FILTER_CONFLICT"].includes(e.code)) {
        if (["SEARCH_AUTH_ERROR", "SEARCH_BALANCE_EMPTY", "SEARCH_NOT_CONFIGURED", "EXTERNAL_BUDGET_EXHAUSTED", "CONTEXT_LIMIT"].includes(e.code)) {
          state.stopReason = e.code; state.decision = { decision: "STOP", reason: "BUDGET_EXHAUSTED", explanation: e.message }; break;
        }
        await validateContext(actor, scopeDirectory, observations, state.pointers); continue;
      }
      throw e;
    }
  }
  const readWeb = observations.sources.filter(s => s.external && s.excerpt.trim());
  if (readWeb.length) {
    const grantNow = await readResearchScope(actor, id);
    if (grantNow.revision !== grant.revision) throw new AppError("SCOPE_CHANGED", "研究范围已变化", 409);
  }
  state.phase = state.decision?.decision === "ASK_USER" ? "WAITING_USER" : "WAITING_MODEL";
  await saveR4State(actor, id, turnId, state, observations.sources);
  await validateContext(actor, scopeDirectory, observations, state.pointers);
  let modelAnswer: z.infer<typeof answerSchema> | null = null;
  if (route.intent !== "CLARIFY" && state.decision?.decision !== "ASK_USER") {
    const answer = await conversationModelSpec(actor, id, turnId, "answer", answerV2, { ...context(), stopReason: state.stopReason, decision: state.decision });
    modelAnswer = answer.data; provider = answer.provider;
  }
  await validateContext(actor, scopeDirectory, observations, state.pointers);
  if (state.decision?.decision === "ASK_USER") route.intent = "CLARIFY";
  const advice = state.decision?.decision === "ASK_USER" ? state.decision.question : modelAnswer?.advice ?? "你想继续哪个项目？请明确项目或目标。";
  return { route, observations, directory, state, advice, modelAnswer, provider, fallbackReason: null as string | null };
}

export async function investigateConversation(...args: Parameters<typeof executeInvestigation>): Promise<Awaited<ReturnType<typeof executeInvestigation>>> {
  try { return await executeInvestigation(...args); }
  catch (e) {
    // Received invalid output is known: return real state without any automatic repair call.
    // Transport uncertainty, permission loss and source changes still terminate the turn.
    if (!(e instanceof AppError) || !["CONVERSATION_TOKEN_BUDGET_EXHAUSTED", "MODEL_PROTOCOL_INVALID", "MODEL_OUTPUT_TRUNCATED", "MODEL_EMPTY_RESPONSE", "MODEL_OUTPUT_FILTERED", "MODEL_OUTPUT_INVALID", "UNSUPPORTED_QUOTE", "GOAL_CHANGED"].includes(e.code)) throw e;
    const [actor, id, turnId, input] = args, c = await ownedConversation(actor, id);
    const directory = await workspaceDirectory(actor, c.scope, c.homeProjectId, input.focus);
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: turnId } }), state = r4State(turn.readManifestJson);
    if (!state) throw e;
    const projectIds = (state.projectIds.length ? state.projectIds : input.focus ? [input.focus] : directory.summaries.slice(0, 3).map(p => p.id));
    const observations = await observeProjects(actor, directory, projectIds, input.message.slice(0, 256), input.exactRef);
    const retainedWeb = (record(turn.readManifestJson).webSources ?? []) as ConversationSource[];
    for (const source of retainedWeb) await validateWebSource(actor, source);
    let characters = observations.sources.reduce((n, s) => n + s.excerpt.length, 0);
    for (const source of retainedWeb) if (characters + source.excerpt.length <= 24000 && observations.sources.length < 24) { observations.sources.push(source); characters += source.excerpt.length; }
    await validateContext(actor, directory, observations);
    state.goalGaps = []; state.projectIds = projectIds; state.stopReason = e.code; state.phase = "READY";
    await saveR4State(actor, id, turnId, state, observations.sources);
    const advice = "本次仅整理项目状态：\n" + directory.summaries.filter(p => projectIds.includes(p.id)).map(p => `${p.title}：${p.actionCount} 项未完成行动，${p.waiting} 项待回应委托。`).join("\n");
    return { route: { intent: "ANSWER", projectIds, query: input.message.slice(0, 256), investigate: false, informationNeeds: [] }, observations, directory, state,
      advice, modelAnswer: { advice, observations: [], priorities: [], action: null, recommendedProjectId: null }, provider: "project_state", fallbackReason: e.code };
  }
}
