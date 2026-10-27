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
import { answerV2, investigateV1, routeV2, type InvestigationFrame } from "./promptSpecs";
import { discoverMaterialPointers, experienceSourceRef, readWorkspaceTool, workspaceReadTools, type MaterialPointer } from "./toolAdapter";

export type R4State = {
  schemaVersion: 1; policyVersion: "r4-v1"; phase: "ROUTING" | "READING_SOURCE" | "EVALUATING" | "WAITING_MODEL" | "WAITING_USER" | "READY" | "UNKNOWN";
  budget: InvestigationBudget; projectIds: string[]; goalGaps: GoalGap[]; steps: InvestigationStep[];
  decision: InvestigationDecision | null; stopReason: string | null; pointers: MaterialPointer[];
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
    if (c.activeTurnId !== turnId || c.version !== turn.baseVersion + 1 || !["OBSERVING", "GENERATING"].includes(turn.status))
      throw new AppError("TURN_CHANGED", "原讨论已中断或上下文已变化", 409);
    await validateReadSources(actor, sources, tx);
    for (const p of state.projectIds) await assertProject(actor, p, tx);
    await tx.conversationTurn.update({ where: { id: turnId }, data: { readManifestJson: json({ ...record(turn.readManifestJson),
      schemaVersion: 1, experience: state, sourceRefs: sources.map(s => ({ projectId: s.projectId, id: s.sourceId, revision: s.revision })) }) } });
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
  for (const p of pointers) if (await sourceHash(p.projectId, p.sourceId) !== p.revision)
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
      goalRef: { kind: "PROJECT", id: p.id, projectId: p.id, revision: goalSource.revision }, goalQuote: g.goalQuote,
      criteria, blockers: g.blockers, keyUnknowns: g.keyUnknowns, nextInformationNeed: g.nextInformationNeed });
  });
}

async function executeInvestigation(actor: ConversationActor, id: string, turnId: string, input: {
  message: string; mode?: "QUICK" | "STANDARD" | "DEEP"; focus?: string; constraints: string[]; frozenRefs: ConversationRef[];
  directory: WorkspaceDirectory; exactRef?: { kind: "MISSION" | "ACTION"; id: string; projectId: string };
  recentDialogue: Array<{ role: string; content: string }>;
}) {
  const state: R4State = { schemaVersion: 1, policyVersion: "r4-v1", phase: "ROUTING", budget: investigationBudget(input.mode),
    projectIds: [], goalGaps: [], steps: [], decision: null, stopReason: null, pointers: [] };
  await saveR4State(actor, id, turnId, state);
  await validateContext(actor, input.directory);
  const routed = await conversationModelSpec(actor, id, turnId, "route", routeV2, { message: input.message, focus: input.focus,
    frozenRefs: input.frozenRefs, pinnedConstraints: input.constraints, coverage: input.directory.coverage,
    directory: input.directory.summaries.map(p => ({ id: p.id, title: p.title.slice(0, 80), goal: p.goal.slice(0, 200), deadline: p.deadline,
      waiting: p.waiting, blocking: p.blocked, preference: p.preference })) });
  const route = routed.data;
  if (route.projectIds.some(p => !input.directory.summaries.some(v => v.id === p))) throw new AppError("INVALID_ROUTE", "模型选择了未授权项目", 409);
  if (input.focus) route.projectIds = [input.focus, ...route.projectIds.filter(p => p !== input.focus)].slice(0, 3);
  state.projectIds = route.projectIds;
  const conversation = await ownedConversation(actor, id);
  const directory = await workspaceDirectory(actor, conversation.scope, conversation.homeProjectId, input.focus);
  await validateContext(actor, directory);
  const observations: R4Observation = route.intent === "CLARIFY" ? { refs: input.frozenRefs, sources: [], coverage: { complete: false } }
    : await observeProjects(actor, directory, route.projectIds, route.query || input.message, input.exactRef);
  state.pointers = await discoverMaterialPointers(actor, route.projectIds, observations.sources);
  let provider = routed.provider;
  const scopeDirectory = { ...directory, summaries: directory.summaries.filter(p => route.projectIds.includes(p.id)) };
  const context = () => ({ message: input.message, intent: route.intent, pinnedConstraints: input.constraints,
    projects: scopeDirectory.summaries.map(p => ({ id: p.id, title: p.title, goal: p.goal.slice(0, 1500), deadline: p.deadline, priority: p.priority })),
    sources: observations.sources.map((s, i) => ({ ...s, citationNumber: i + 1 })),
    goalGaps: state.goalGaps, materialPointers: state.pointers,
    recentDialogue: input.recentDialogue.slice(-6).map(m => ({ role: m.role, text: m.content.slice(0, 500) })) });
  const seen = new Set<string>();
  if (route.investigate && route.intent !== "CLARIFY") while (true) {
    await validateContext(actor, scopeDirectory, observations, state.pointers);
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
    if (turn.callCount >= state.budget.maxModelCalls - 2 ||
      Date.now() - turn.createdAt.getTime() > state.budget.maxElapsedMs - 20000) {
      state.decision = { decision: "STOP", reason: "BUDGET_EXHAUSTED", explanation: "本轮调查已到预算边界，先根据现有观察说明情况。" };
      state.stopReason = "BUDGET_EXHAUSTED"; break;
    }
    state.phase = "EVALUATING"; await saveR4State(actor, id, turnId, state, observations.sources);
    const callId = "investigate-" + state.steps.length;
    const frame = await conversationModelSpec(actor, id, turnId, callId, investigateV1, { ...context(),
      allowedTools: workspaceReadTools, toolSchemas: (await import("zod")).z.toJSONSchema((await import("@/lib/types/agentExperience")).investigationToolCallSchema),
      previousSteps: state.steps.map(s => ({ decision: s.decision, status: s.status, coverage: s.coverage })),
      remaining: { modelCalls: state.budget.maxModelCalls - turn.callCount, reads: state.budget.maxToolReads - state.steps.length } });
    provider = frame.provider;
    await validateContext(actor, scopeDirectory, observations, state.pointers);
    state.goalGaps = normalizeGoals(frame.data, scopeDirectory, observations);
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
    if (!state.goalGaps.some(g => g.projectId === decision.call.projectId && g.nextInformationNeed === decision.informationNeed))
      throw new AppError("INVESTIGATION_GOAL_UNBOUND", "调查步骤没有关联当前目标缺口", 409);
    if (state.steps.length >= state.budget.maxToolReads) {
      state.stopReason = "BUDGET_EXHAUSTED"; state.decision = { decision: "STOP", reason: "BUDGET_EXHAUSTED", explanation: "本轮读取额度已用完，先依据当前资料回答。" }; break;
    }
    if (seen.has(argsHash)) { state.stopReason = "NO_GAIN"; state.decision = { decision: "STOP", reason: "NO_GAIN", explanation: "重复读取不会带来新信息，本轮先停止。" }; break; }
    seen.add(argsHash);
    const step: InvestigationStep = { schemaVersion: 1, id: `${turnId}-read-${state.steps.length + 1}`, turnId, seq: state.steps.length + 1,
      decision, inputHash: argsHash, readSetHash: jsonHash(observations.sources.map(s => ({ id: s.id, revision: s.revision, excerptHash: s.excerptHash }))),
      status: "STARTED", startedAt: new Date().toISOString(), finishedAt: null, observationHash: null, sources: [],
      coverage: { complete: false, description: decision.informationNeed }, reservationId: callId, provider, usage: frame.usage, failureReason: null };
    state.steps.push(step); state.phase = "READING_SOURCE"; await saveR4State(actor, id, turnId, state, observations.sources);
    try {
      const result = await readWorkspaceTool(actor, decision.call, route.projectIds, state.pointers, observations.sources);
      const added = result.sources.filter(s => !observations.sources.some(old => old.id === s.id && old.revision === s.revision && old.excerptHash === s.excerptHash));
      step.status = "SUCCEEDED"; step.finishedAt = new Date().toISOString(); step.observationHash = jsonHash(result);
      step.sources = result.sources.map(experienceSourceRef); step.coverage = { complete: result.coverage.complete === true, description: JSON.stringify(result.coverage).slice(0, 1800) };
      observations.sources = [...new Map([...observations.sources, ...result.sources].map(s => [s.id, s])).values()];
      if (observations.sources.length > 24 || observations.sources.reduce((n, s) => n + s.excerpt.length, 0) > 24000)
        throw new AppError("CONTEXT_LIMIT", "已读资料达到本轮容量，请缩小问题后继续", 409);
      state.pointers = [...new Map([...state.pointers, ...result.discovered].map(p => [p.projectId + "/" + p.sourceId, p])).values()].slice(0, 64);
      await saveR4State(actor, id, turnId, state, observations.sources);
      if (!added.length) { state.stopReason = "NO_GAIN"; state.decision = { decision: "STOP", reason: "NO_GAIN", explanation: "本次读取未补充新的依据，先保留当前判断。" }; break; }
    } catch (e) {
      step.status = "FAILED"; step.finishedAt = new Date().toISOString(); step.failureReason = e instanceof AppError ? e.message : "资料读取中断";
      // Persist failure without stale source content; access checks still apply.
      await saveR4State(actor, id, turnId, state).catch(() => undefined);
      throw e;
    }
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
    if (!(e instanceof AppError) || !["MODEL_PROTOCOL_INVALID", "MODEL_OUTPUT_TRUNCATED", "MODEL_EMPTY_RESPONSE", "MODEL_OUTPUT_FILTERED", "MODEL_OUTPUT_INVALID", "UNSUPPORTED_QUOTE", "GOAL_CHANGED"].includes(e.code)) throw e;
    const [actor, id, turnId, input] = args, c = await ownedConversation(actor, id);
    const directory = await workspaceDirectory(actor, c.scope, c.homeProjectId, input.focus);
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: turnId } }), state = r4State(turn.readManifestJson);
    if (!state) throw e;
    const projectIds = (state.projectIds.length ? state.projectIds : input.focus ? [input.focus] : directory.summaries.slice(0, 3).map(p => p.id));
    const observations = await observeProjects(actor, directory, projectIds, input.message.slice(0, 256), input.exactRef);
    await validateContext(actor, directory, observations);
    state.goalGaps = []; state.projectIds = projectIds; state.stopReason = e.code; state.phase = "READY";
    await saveR4State(actor, id, turnId, state, observations.sources);
    const advice = "本次仅整理项目状态：\n" + directory.summaries.filter(p => projectIds.includes(p.id)).map(p => `${p.title}：${p.actionCount} 项未完成行动，${p.waiting} 项待回应委托。`).join("\n");
    return { route: { intent: "ANSWER", projectIds, query: input.message.slice(0, 256), investigate: false, informationNeeds: [] }, observations, directory, state,
      advice, modelAnswer: { advice, observations: [], priorities: [], action: null, recommendedProjectId: null }, provider: "project_state", fallbackReason: e.code };
  }
}
