import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { conversationTurnSchema } from "@/lib/types/conversation";
import type { ConversationActor, ConversationBlocks } from "@/lib/types/conversation";
import { workspaceDirectory, observeProjects } from "@/lib/services/workspaceContextService";
import { assertProject, emptyBlocks, lockConversation, ownedConversation, record } from "./repository";
import { appendConversationMessage, bindRefs, readConversation, validateReadSources } from "./service";
import { answerSchema, conversationModel, focusSystemPrompt, routeSchema } from "./model";
import { freezeCopilotProposals, readCopilotContext } from "@/lib/copilot/confirmation";
import { previewConversationWork, readConversationWork } from "./workService";
import { workRefSchema, type ConversationWorkRef } from "@/lib/types/conversationWork";
import { resolveFileGuides } from "./fileGuides";
import { bindAnswerEvidence } from "./answerEvidence";
import { isFeatureEnabled } from "@/lib/config/features";
import { investigateConversation, turnTimeoutMs } from "./investigationService";
import { experienceProgress } from "./progress";
import { composeExperience, fallbackExperiencePlan, prepareExperienceDraft, refreshExperiencePresentation } from "./presentationRuntime";
import type { PresentationPlan } from "@/lib/types/agentExperience";
import type { ConversationTurn } from "@/lib/generated/prisma/client";
import { assertTurnLease, mutateTurn, turnElapsedMs, newTurnLease, withTurnLease, withTurnGeneration, heartbeatTurn, currentGeneration } from "./turnRuntime";

import { admitDirectiveInTx, effectiveContinuity } from "@/lib/continuity/directiveService";
import { coordination, initialCoordination, assertTurnCurrent, activateNextGeneration } from "@/lib/continuity/turnCoordination";
import { admitDirective } from "@/lib/continuity/admission";

// The optional ablation control is trusted CLI-only; it is not part of the HTTP request schema.
export async function submitConversationTurn(actor: ConversationActor, id: string, raw: unknown, evaluation?: { variant: "PROMPT_ONLY" | "INVESTIGATION_ONLY" }, options?: { defer: boolean }) {
  const input = conversationTurnSchema.parse(raw), hash = jsonHash(input);
  const reserved = await db.$transaction(async tx => {
    await lockConversation(tx, id);
    const c = await ownedConversation(actor, id, tx);
    const prior = await tx.conversationTurn.findUnique({ where: { conversationId_requestId: { conversationId: id, requestId: input.requestId } } });
    if (prior) {
      if (prior.inputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于另一条输入", 409);
      if (["ACCEPTED", "OBSERVING", "GENERATING"].includes(prior.status) && turnElapsedMs(prior) >= turnTimeoutMs(prior)) {
        const stopped = await tx.conversationTurn.update({ where: { id: prior.id }, data: {
          status: prior.callCount ? "UNKNOWN" : "FAILED", finishedAt: new Date(),
          errorJson: { code: "INTERRUPTED", message: "原请求中断，不会自动重发模型" },
        } });
        await tx.conversation.updateMany({ where: { id, activeTurnId: prior.id }, data: { activeTurnId: null } });
        return { turn: stopped, replay: true };
      }
      return { turn: prior, replay: true };
    }
    let directiveAdmission: { status: string; question?: string } | undefined;
    const ctAdmissionEnabled = isFeatureEnabled("FOCUS_CONTINUITY_ENABLED", false);
    const ctEnabled = ctAdmissionEnabled || (await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { continuitySeq: true } })).continuitySeq > 0;
    const ctProject = input.entityRef?.projectId ?? input.projectId ?? c.homeProjectId;
    if (ctAdmissionEnabled && ctProject) {
        const command = { commandId: "turn:" + id + ":" + input.requestId, expectedSeq: input.expectedContinuitySeq ?? 0, scope: { projectId: ctProject, ...(input.entityRef?.kind === "MISSION" ? { missionId: input.entityRef.id } : {}) },
        operation: "SET" as const, quote: input.message, timezone: "Asia/Shanghai", admission: "LITERAL" as const };
      const admission = admitDirective(command);
      if (["DIRECT_APPLIED", "NEEDS_CLARIFICATION"].includes(admission.status)) {
        if (c.scope === "PROJECT" && c.homeProjectId !== ctProject) throw new AppError("DIRECTIVE_SCOPE_CHANGED", "Instruction scope changed", 409);
        directiveAdmission = admission;
        const admitted = await admitDirectiveInTx(actor, command, tx, { conversationId: id, requestId: input.requestId });
        if (c.activeTurnId && admitted.events.length) {
          const active = await tx.conversationTurn.findUniqueOrThrow({ where: { id: c.activeTurnId } });
          return { turn: active, replay: true };
        }
      }
    }
    if (c.activeTurnId) {
      const active = await tx.conversationTurn.findUnique({ where: { id: c.activeTurnId } });
      if (active && turnElapsedMs(active) < turnTimeoutMs(active))
        throw new AppError("CONVERSATION_BUSY", "另一条输入正在处理，请读取原请求状态", 409);
      if (active) await tx.conversationTurn.update({ where: { id: active.id }, data: {
        status: active.callCount ? "UNKNOWN" : "FAILED", finishedAt: new Date(),
        errorJson: { code: "INTERRUPTED", message: "原请求中断，不会自动重发模型" },
      } });
    }
    if (c.version !== input.expectedVersion) throw new AppError("CONVERSATION_CHANGED", "讨论上下文已变化，请刷新后重试原输入", 409);
    const target = input.entityRef?.projectId ?? input.projectId;
    if (target) {
      await assertProject(actor, target, tx);
      if (input.entityRef && input.projectId && input.entityRef.projectId !== input.projectId)
        throw new AppError("CONTEXT_SCOPE_CHANGED", "原对象与所选项目不一致", 409);
      if (c.scope === "PROJECT" && c.homeProjectId !== target) throw new AppError("CONTEXT_SCOPE_CHANGED", "请另开跨项目讨论", 409);
    }
    if (input.replyToMessageId && !await tx.agentMessage.findFirst({ where: { id: input.replyToMessageId, conversationId: id, ownerUserId: actor.userId } }))
      throw new AppError("MESSAGE_NOT_FOUND", "原消息已不可访问", 404);
    if (input.bindingId && !await tx.conversationBinding.findFirst({ where: { id: input.bindingId, conversationId: id } }))
      throw new AppError("BINDING_NOT_FOUND", "讨论对象已不可访问", 404);
    const ctScopes = ctEnabled ? (c.scope === "PROJECT" && c.homeProjectId ? [c.homeProjectId] : [...new Set([...(await tx.projectMembership.findMany({ where: { userId: actor.userId, project: { archivedAt: null } }, orderBy: { projectId: "asc" }, take: 60 })).map(m => m.projectId), ...(ctProject ? [ctProject] : [])])])
      .map(projectId => ({ projectId, conversationId: id, ...(input.entityRef?.kind === "MISSION" && input.entityRef.projectId === projectId ? { missionId: input.entityRef.id } : {}) })) : [];
    const coord = ctEnabled ? await initialCoordination(actor.userId, ctScopes, tx) : null;
    const leaseToken = coord && !options?.defer ? newTurnLease() : null;
    const turn = await tx.conversationTurn.create({ data: { conversationId: id, requestId: input.requestId,
      inputHash: hash, inputJson: json(input), baseVersion: c.version, status: "OBSERVING", sessionId: actor.sessionId,
      leaseToken, leaseUntil: leaseToken ? new Date(Date.now() + 30000) : null,
      readManifestJson: json({ ...(directiveAdmission ? { directiveAdmission } : {}), ...(options?.defer ? { deferred: true } : {}), ...(coord ? { coordination: coord } : {}) }) } });
    if (target) await tx.conversationProject.upsert({ where: { conversationId_projectId: { conversationId: id, projectId: target } },
      create: { conversationId: id, projectId: target }, update: {} });
    await appendConversationMessage(tx, id, actor.userId, "USER", input.message,
      { ...emptyBlocks(), observedProjectIds: target ? [target] : [] }, turn.id);
    await tx.conversation.update({ where: { id }, data: { activeTurnId: turn.id, version: { increment: 1 } } });
    return { turn, replay: false };
  });
  if (reserved.replay) return { turnId: reserved.turn.id, status: reserved.turn.status, conversation: await readConversation(actor, id) };
  if (options?.defer) return { turnId: reserved.turn.id, status: reserved.turn.status, conversation: await readConversation(actor, id) };
  return reserved.turn.leaseToken ? withTurnLease(reserved.turn.id, reserved.turn.leaseToken, () => executeAcceptedConversationTurn(actor, id, reserved.turn, evaluation)) : executeAcceptedConversationTurn(actor, id, reserved.turn, evaluation);
}

export async function executeAcceptedConversationTurn(actor: ConversationActor, id: string, turn: ConversationTurn, evaluation?: { variant: "PROMPT_ONLY" | "INVESTIGATION_ONLY" }) {
  if (!coordination(turn)) return executeTurnGeneration(actor, id, turn, evaluation);
  assertTurnLease(turn);
  const heartbeat = setInterval(() => { void heartbeatTurn(turn.id).catch(() => undefined); }, 5000);
  try {
    while (true) {
      const current = await db.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } });
      const coord = coordination(current)!;
      try {
        await withTurnGeneration(coord.generation, () => assertTurnCurrent(current, actor.userId, coord.generation));
        return await withTurnGeneration(coord.generation, () => executeTurnGeneration(actor, id, current, evaluation));
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== "TURN_RECOORDINATE") throw error;
        let activated = await activateNextGeneration(actor, turn.id, current.leaseToken!);
        while (!activated) {
          await new Promise(resolve => setTimeout(resolve, 100));
          activated = await activateNextGeneration(actor, turn.id, current.leaseToken!);
        }
      }
    }
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== "TURN_STOP_REQUESTED") throw error;
    await db.$transaction(async tx => {
      const current = await tx.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } }); assertTurnLease(current);
      await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", "\u4f60\u5df2\u6682\u505c\u8fd9\u9879\u5de5\u4f5c\uff0c\u64a4\u56de\u6682\u505c\u540e\u53ef\u4ee5\u63a5\u7eed\u3002", emptyBlocks(), turn.id);
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { status: "CANCELLED", finishedAt: new Date(),
        readManifestJson: json({ ...record(current.readManifestJson), stopRequested: true, coordination: { ...coordination(current), state: "TERMINAL" } }) } });
      await tx.conversation.updateMany({ where: { id, activeTurnId: turn.id }, data: { activeTurnId: null } });
    });
    return { turnId: turn.id, status: "CANCELLED", conversation: await readConversation(actor, id) };
  } finally {
    clearInterval(heartbeat);
    await db.conversationTurn.updateMany({ where: { id: turn.id, leaseToken: turn.leaseToken }, data: { leaseToken: null, leaseUntil: null } });
  }
}

async function executeTurnGeneration(actor: ConversationActor, id: string, turn: ConversationTurn, evaluation?: { variant: "PROMPT_ONLY" | "INVESTIGATION_ONLY" }) {
  actor = { ...actor, conversationId: id };
  const input = conversationTurnSchema.parse(turn.inputJson);
  assertTurnLease(turn);
  try {
    const c = await ownedConversation(actor, id);
    const admission = record(record(turn.readManifestJson).directiveAdmission);
    if (admission.status === "NEEDS_CLARIFICATION" && typeof admission.question === "string") {
      await db.$transaction(async tx => {
        await lockConversation(tx, id);
        const current = await tx.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } }); assertTurnLease(current);
        await assertTurnCurrent(current, actor.userId, currentGeneration(), tx);
        await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", String(admission.question), emptyBlocks(), turn.id);
        await tx.conversationTurn.update({ where: { id: turn.id }, data: { status: "NEEDS_CLARIFICATION", finishedAt: new Date(),
          readManifestJson: json({ ...record(current.readManifestJson), ...(coordination(current) ? { coordination: { ...coordination(current), state: "TERMINAL" } } : {}) }) } });
        await tx.conversation.update({ where: { id }, data: { activeTurnId: null, version: { increment: 1 } } });
      });
      return { turnId: turn.id, status: "NEEDS_CLARIFICATION", conversation: await readConversation(actor, id) };
    }
    const history = await readConversation(actor, id);
    const explicitBinding = input.bindingId ? await db.conversationBinding.findFirst({ where: { id: input.bindingId, conversationId: id } }) : null;
    let frozenMessage = input.replyToMessageId ? history.messages.find(m => m.id === input.replyToMessageId && !m.restricted)
      : [...history.messages].reverse().find(m => m.role === "ASSISTANT" && !m.restricted);
    if (input.replyToMessageId && !frozenMessage) {
      const old = await db.agentMessage.findFirst({ where: { id: input.replyToMessageId, conversationId: id, ownerUserId: actor.userId } });
      if (!old) throw new AppError("MESSAGE_NOT_FOUND", "原消息不可访问", 404);
      const blocks = { ...emptyBlocks(), ...record(old.blocksJson) } as ConversationBlocks;
      for (const p of blocks.observedProjectIds) await assertProject(actor, p);
      frozenMessage = { ...blocks, id: old.id, seq: old.seq!, role: old.role, content: old.content, restricted: false };
    }
    const frozenRefs = frozenMessage?.refs ?? [];
    let focused = input.entityRef?.projectId ?? (input.projectId === null ? undefined : input.projectId ?? explicitBinding?.projectId ?? history.focusProjectId ?? undefined);
    let directory = await workspaceDirectory(actor, c.scope, c.homeProjectId, focused);
    const named = directory.summaries.filter(p => input.message.includes(p.title));
    const conflictingName = !!(input.projectId || input.entityRef || input.bindingId) && !!focused && named.some(p => p.id !== focused);
    if (!input.projectId && !explicitBinding && named.length === 1) focused = named[0].id;
    // Resolve exact frozen choices before the project ordinal router; a choice never executes directly.
    const choiceMatch = input.message.match(/(?:选|采用)(?:择)?第?([一二三123])(?:个|项|种)?/);
    const optionMessage = input.replyToMessageId ? frozenMessage : [...history.messages].reverse().find(m =>
      !m.restricted && m.options?.length && (!input.projectId || m.options.every(o => o.projectId === input.projectId)));
    const option = choiceMatch ? optionMessage?.options?.[({ 一: 0, 二: 1, 三: 2, "1": 0, "2": 1, "3": 2 } as Record<string, number>)[choiceMatch[1]]] : undefined;
    const savedRef = workRefSchema.safeParse(record(c.focusJson).entityRef);
    const replyCandidates = [...new Map(frozenRefs.filter(r => ["MISSION", "ACTION"].includes(r.kind)).map(r => [r.kind + ":" + r.id, r])).values()];
    const replyProposal = frozenMessage?.proposal;
    const replyTarget: ConversationWorkRef | undefined = input.replyToMessageId && replyProposal?.resultId && (!replyProposal.tool || ["create_action", "complete_action"].includes(replyProposal.tool))
      ? { kind: "ACTION", id: replyProposal.resultId, projectId: replyProposal.projectId }
      : input.replyToMessageId && replyCandidates.length === 1 ? { kind: replyCandidates[0].kind as "MISSION" | "ACTION", id: replyCandidates[0].id, projectId: replyCandidates[0].projectId } : undefined;
    const exactRef: ConversationWorkRef | undefined = input.entityRef ?? (explicitBinding && ["MISSION", "ACTION"].includes(explicitBinding.kind)
      ? { kind: explicitBinding.kind as "MISSION" | "ACTION", id: explicitBinding.entityId, projectId: explicitBinding.projectId }
      : input.replyToMessageId ? replyTarget : savedRef.success && input.projectId !== null && (!input.projectId || input.projectId === savedRef.data.projectId) && named.every(p => p.id === savedRef.data.projectId) ? savedRef.data : undefined);
    if (exactRef && input.projectId && exactRef.projectId !== input.projectId) throw new AppError("CONTEXT_SCOPE_CHANGED", "原消息对象与所选项目不同，请核对讨论范围", 409);
    const resultText = input.message.match(/(?:验证|完成|执行)?结果(?:是|为|[：:])\s*([\s\S]+)/)?.[1]?.trim();
    if (option && (input.projectId && input.projectId !== option.projectId || input.entityRef && input.entityRef.id !== option.missionId))
      throw new AppError("CONTEXT_SCOPE_CHANGED", "原选项与本次指定对象不同，请明确要采用哪份方案", 409);
    const operation = !conflictingName && !/不要|不选|不采用|禁止|只读/.test(input.message)
      ? option ? option.purpose === "DYNAMIC_PLAN" ? "adopt_dynamic" : "adopt_scenario" : exactRef?.kind === "ACTION" && resultText ? "complete_action"
        : exactRef?.kind === "MISSION" && /^(?:请|帮我)?(?:继续|恢复|接续)(?:原|这|该)?.*(?:委托|任务)/.test(input.message) ? "resume" : null : null;
    const boundWork = exactRef ? await db.conversationBinding.findFirst({ where: { conversationId: id, kind: exactRef.kind, entityId: exactRef.id, projectId: exactRef.projectId } }) : null;
    if (operation && (option || boundWork)) {
      const ref: ConversationWorkRef = option ? { kind: "MISSION", id: option.missionId, projectId: option.projectId } : exactRef!;
      const work = await readConversationWork(actor, id, ref);
      if (option && option.purpose !== "DYNAMIC_PLAN" && (work.scenario?.id !== option.proposalId || work.scenario.proposalHash !== option.proposalHash || work.version !== option.expectedVersion))
        throw new AppError("PROPOSAL_CHANGED", "原选项或原任务已变化，请重新对比", 409);
      if (operation !== "resume" || work.status === "PAUSED") {
        const preview = await previewConversationWork(actor, id, { requestId: "turn:" + turn.id, expectedConversationVersion: c.version,
          ref, operation, versionToken: work.versionToken, ...(resultText ? { answer: resultText } : {}),
          ...(option ? option.purpose === "DYNAMIC_PLAN" ? { dynamicProposalId: option.proposalId, candidateId: option.candidateId } : { scenarioProposalId: option.proposalId, scenarioKey: option.key } : {}) }, turn.id);
        return { turnId: turn.id, status: "ANSWERED", ...preview };
      }
    }
    const ordinal = input.message.match(/第([一二三123])(?:个|项|种)/);
    const selectable = frozenRefs.filter(r => r.kind === "PROJECT");
    if (ordinal && !choiceMatch) {
      const index = ({ 一: 0, 二: 1, 三: 2, "1": 0, "2": 1, "3": 2 } as Record<string, number>)[ordinal[1]];
      if (selectable[index]) focused = selectable[index].projectId;
    }
    const ambiguous = conflictingName || !input.projectId && !explicitBinding && !focused &&
      (named.length > 1 || (/这个|那个|原来|继续/.test(input.message) && selectable.length > 1));
    const constraints = Array.isArray(c.pinnedStateJson) ? c.pinnedStateJson as string[] : [];
    const newConstraint = !coordination(turn) && /不要|禁止|不得|不允许|只读|不联网|不创建|不接受|不选/.test(input.message) ? input.message : null;
    if (newConstraint && constraints.length >= 24) throw new AppError("CONSTRAINT_LIMIT", "已保留24项限制，请另开主题或整理限制后继续", 409);
    if (exactRef?.kind === "MISSION") { actor = { ...actor, missionId: exactRef.id, missionProjectId: exactRef.projectId }; directory = await workspaceDirectory(actor, c.scope, c.homeProjectId, focused); }
    if (coordination(turn) && exactRef?.kind === "MISSION") await mutateTurn(actor, id, turn.id, async (manifest, tx) => {
      const coord = record(manifest.coordination), scopes = coord.scopes as Array<{ projectId: string; conversationId?: string; missionId?: string }>;
      if (scopes.some(s => s.projectId === exactRef.projectId && s.missionId !== exactRef.id)) {
        const replacement = await initialCoordination(actor.userId, scopes.map(s => s.projectId === exactRef.projectId ? { ...s, missionId: exactRef.id } : s), tx);
        return { ...manifest, coordination: { ...coord, ...replacement, generation: coord.generation } };
      }
      return manifest;
    });
    const continuity = coordination(turn) ? await Promise.all(directory.summaries.map(p => effectiveContinuity(actor.userId, { projectId: p.id, conversationId: id,
      ...(exactRef?.kind === "MISSION" && exactRef.projectId === p.id ? { missionId: exactRef.id } : {}) }))) : [];
    const pinned = [...(newConstraint ? [...constraints, newConstraint] : constraints), ...continuity.flatMap(v => [...v.constraints,
      ...(v.workingObjective ? ["Current working objective (formal project goal unchanged): " + v.workingObjective] : [])])];
    const modelEnabled = input.llmContextApproved && process.env.LLM_MODE === "openai-compatible" && !pinned.some(rule => /(?:\u4e0d\u8981|\u7981\u6b62|\u4e0d\u5f97|\u4e0d\u5141\u8bb8)(?:\u8c03\u7528\u6a21\u578b|\u4ed8\u8d39\u8c03\u7528)/.test(rule));
    const r4 = modelEnabled && !ambiguous && (isFeatureEnabled("FOCUS_AGENT_R4_ENABLED", false) || !!coordination(turn))
      ? await investigateConversation(actor, id, turn.id, { message: input.message, mode: input.investigationMode, focus: focused, evaluationVariant: evaluation?.variant,
        constraints: pinned, frozenRefs, directory, exactRef, userProvidedUrls: input.userProvidedUrls,
        priorWebSources: frozenMessage?.sources.filter(s => !!s.external && (!frozenMessage?.citations?.length || frozenMessage.citations.some(c => c.sourceId === s.id))).slice(0, 4),
        recentDialogue: continuity.some(v => v.directives.some(d => d.kind === "USE_SUPPRESSION")) ? [] : history.messages.filter(m => !m.restricted).map(m => ({ role: m.role, content: m.content })) }) : null;
    if (r4) directory = r4.directory;
    let route = { intent: "ANSWER" as "ANSWER" | "CLARIFY" | "PROPOSE_ACTION" | "OPEN_MISSION",
      projectIds: focused ? [focused] : directory.summaries.slice(0, 3).map(p => p.id), query: input.message.slice(0, 256) };
    let provider = "rules", advice = "", modelAnswer: ReturnType<typeof answerSchema.parse> | null = null;
    let fallbackReason: string | null = r4?.fallbackReason ?? null;
    if (r4) { route = r4.route; provider = r4.provider; }
    else if (ambiguous) route.intent = "CLARIFY";
    else if (modelEnabled) {
      const permitted = await db.projectMembership.count({ where: { userId: actor.userId, projectId: { in: directory.summaries.map(p => p.id) } } });
      if (permitted !== directory.summaries.length) throw new AppError("PROJECT_NOT_FOUND", "项目权限已变化，请重新选择范围", 404);
      const compact = directory.summaries.map(p => ({ id: p.id, title: p.title.slice(0, 60), goal: p.goal.slice(0, 80),
        deadline: p.deadline, waiting: p.waiting, blocked: p.blocked,
        preference: p.preference ? { importance: p.preference.importance, estimatedMinutes: p.preference.estimatedMinutes,
          longTermGoal: p.preference.longTermGoal.slice(0, 80), notes: p.preference.notes.slice(0, 80) } : null }));
      const r = await conversationModel(actor, turn.id, "ROUTE", focusSystemPrompt +
        "\n按问题选择至多3个项目，intent=ANSWER/CLARIFY/PROPOSE_ACTION/OPEN_MISSION；query≤256字。返回 {intent,projectIds,query}。\n" +
        JSON.stringify({ message: input.message, focus: focused, frozenRefs, pinnedConstraints: pinned, directory: compact,
          coverage: directory.coverage }), routeSchema);
      route = r.data; provider = r.provider;
      const allowed = new Set(directory.summaries.map(p => p.id));
      if (route.projectIds.some(p => !allowed.has(p))) throw new AppError("INVALID_ROUTE", "模型引用了观察范围外的项目，请重新限定问题", 409);
      if (focused) route.projectIds = [focused, ...route.projectIds.filter(p => p !== focused)].slice(0, 3);
    } else if (/创建.*行动|变成.*行动|帮我.*处理|整理.*待办/.test(input.message) && !/不创建|不要.*行动/.test(input.message)) route.intent = "PROPOSE_ACTION";
    const observations = r4?.observations ?? (route.intent === "CLARIFY" ? { refs: frozenRefs, sources: [], coverage: { complete: false } }
      : await observeProjects(actor, directory, route.projectIds, route.query || input.message, exactRef));
    const fileGuides = await resolveFileGuides(observations.sources);
    await mutateTurn(actor, id, turn.id, async (manifest, tx) => {
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { status: "GENERATING" } });
      return { ...manifest,
      schemaVersion: 1, observedAt: new Date().toISOString(), directory: directory.coverage,
      observedProjectIds: directory.summaries.map(p => p.id), route, observation: observations.coverage,
      sourceRefs: observations.sources.map(s => ({ projectId: s.projectId, id: s.sourceId, revision: s.revision, ...(s.external ? { webSource: s } : {}) })),
      ...(r4 ? { experience: r4.state } : {}),
      };
    });
    if (route.intent === "CLARIFY") advice = r4?.advice ?? "你想继续哪一个项目？请选择下方原对象，再提出问题。";
    else if (modelEnabled) {
      const responseHistory = await readConversation(actor, id);
      await validateReadSources(actor, observations.sources);
      const r = r4 ? { data: r4.modelAnswer!, provider: r4.provider } : await conversationModel(actor, turn.id, "ANSWER", focusSystemPrompt +
        "\n返回 {advice,recommendedProjectId,observations:[{sourceId,quote}],priorities:[{projectId,tradeoff}],action:null或{projectId,title,description,priority}}。" +
        "仅 intent=PROPOSE_ACTION 可以提出 action。未知字段不补造。\n" +
        JSON.stringify({ message: input.message, intent: route.intent, focus: focused, pinnedConstraints: pinned,
          recentDialogue: responseHistory.messages.filter(m => !m.restricted).slice(-6).map(m => ({ role: m.role, text: m.content.slice(0, 400), refs: m.refs.slice(0, 4) })),
          projects: directory.summaries.filter(p => route.projectIds.includes(p.id)).map(p => ({
            id: p.id, title: p.title, goal: p.goal.slice(0, 300), priority: p.priority,
            missions: p.missions, actions: p.actions, actionCount: p.actionCount, coverage: p.coverage })),
          sources: observations.sources.map((source, index) => {
            const file = fileGuides.find(file => file.sourceId === source.id);
            return { ...source, citationNumber: index + 1, file: file ? { title: file.title, kind: file.kind, readScope: file.readScope } : null };
          }),
          coverage: directory.coverage }), answerSchema);
      modelAnswer = r.data; provider = r.provider; advice = r.data.advice;
      if (r.data.recommendedProjectId && route.projectIds.includes(r.data.recommendedProjectId)) focused = r.data.recommendedProjectId;
      const citations = bindAnswerEvidence(r.data.observations, observations.sources);
      if (!citations) fallbackReason = "UNSUPPORTED_QUOTE";
      else modelAnswer.observations = citations;
      for (const match of advice.matchAll(/【(\d+)】/g)) {
        const source = observations.sources[Number(match[1]) - 1];
        if (!source || !citations?.some(o => o.sourceId === source.id))
          fallbackReason ??= "UNSUPPORTED_CITATION";
      }
      if (fallbackReason) {
        // Discard the entire ungrounded draft and its action; do not auto-retry a paid call.
        modelAnswer = null;
        advice = (/^UNSUPPORTED_/.test(fallbackReason) ? "这次云端回答的引用未通过核对，先为你列出项目状态：\n" : "这次云端分析未完成，先为你列出项目状态：\n") + directory.summaries.filter(p => route.projectIds.includes(p.id))
          .map(p => p.title + "：" + p.actionCount + " 项未完成行动，" + p.waiting + " 项待回应委托。").join("\n") + "\n可打开下方原任务继续核对。";
      }
    } else {
      advice = directory.summaries.filter(p => route.projectIds.includes(p.id))
        .map(p => p.title + "：当前有 " + p.actionCount + " 项未完成行动、" + p.waiting + " 项待回应委托。").join("\n");
      advice += "\n当前是规则观察，尚未进行模型优先级判断。可选择项目继续，或明确补充重要性与投入。";
    }
    const selected = focused ?? (route.projectIds.length === 1 ? route.projectIds[0] : undefined);
    const priorities = directory.summaries.filter(p => route.projectIds.includes(p.id)).map(p => {
      const generated = modelAnswer?.priorities.find(r => r.projectId === p.id);
      return generated ? { ...p.priority, tradeoff: generated.tradeoff, basis: "MODEL_ADVICE" as const } : p.priority;
    });
    let action = route.intent === "PROPOSE_ACTION" ? modelAnswer?.action ?? null : null;
    if (!modelEnabled && route.intent === "PROPOSE_ACTION" && selected) {
      const p = directory.summaries.find(v => v.id === selected)!;
      action = { projectId: p.id, title: "核对“" + p.title.slice(0, 80) + "”的下一步", description: input.message.slice(0, 500), priority: 3 };
    }
    if (action && (!selected || action.projectId !== selected || !route.projectIds.includes(action.projectId))) action = null;
    if (pinned.some(v => /只读|(?:不要|不得|禁止|不允许|不).{0,8}(?:创建|新增).{0,12}(?:行动|待办)/.test(v))) action = null;
    const prepared = r4 && !evaluation && !fallbackReason ? await prepareExperienceDraft(actor, id, turn.id, action, provider) : null;
    let uiPlan: PresentationPlan | undefined, uiFallback: string | null = null;
    if (prepared && r4) {
      const uiBlocks: ConversationBlocks = { ...emptyBlocks(), refs: observations.refs, sources: observations.sources,
        observedProjectIds: directory.summaries.map(p => p.id), citations: modelAnswer?.observations ?? [], fileGuides, provider,
        proposal: prepared.proposal };
      try { uiPlan = (await composeExperience(actor, id, turn.id, input.message, advice, uiBlocks, r4.state)).plan; }
      catch (e) {
        if (e instanceof AppError && ["UNAUTHORIZED", "PROJECT_NOT_FOUND", "SOURCE_CHANGED", "TURN_CHANGED", "MISSION_CHANGED", "TURN_STOP_REQUESTED"].includes(e.code)) throw e;
        uiFallback = e instanceof AppError ? e.code : "UI_PLAN_INVALID_OR_UNKNOWN";
        uiPlan = await fallbackExperiencePlan(actor, id, turn.id, advice, uiBlocks, r4.state);
      }
    }
    const result = await db.$transaction(async tx => {
      await lockConversation(tx, id);
      const current = await ownedConversation(actor, id, tx);
      const currentTurn = await tx.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } });
      assertTurnLease(currentTurn);
      await assertTurnCurrent(currentTurn, actor.userId, currentGeneration(), tx);
      if (record((await tx.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } })).readManifestJson).stopRequested)
        throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
      if (current.activeTurnId !== turn.id) throw new AppError("TURN_CHANGED", "原请求已中断或被接续", 409);
      for (const p of directory.summaries) await assertProject(actor, p.id, tx);
      await validateReadSources(actor, observations.sources, tx);
      for (const ref of observations.refs.filter(r => r.kind === "MISSION")) {
        if (!await tx.agentMission.findFirst({ where: { id: ref.id, projectId: ref.projectId, ownerUserId: actor.userId, version: ref.version,
          project: { memberships: { some: { userId: actor.userId, role: "OWNER" } } } } }))
          throw new AppError("MISSION_CHANGED", "原委托状态已变化，请刷新后继续", 409);
      }
      let refs = observations.refs;
      if (route.intent === "CLARIFY" && !refs.length) refs = directory.summaries.slice(0, 6).map(p => ({
        kind: "PROJECT", id: p.id, projectId: p.id, title: p.title, href: "/projects/" + p.id + "/knowledge",
      }));
      refs = await bindRefs(tx, id, refs);
      const blocks: ConversationBlocks = { ...emptyBlocks(), refs, sources: observations.sources, priorities, provider: fallbackReason ? "project_state" : provider,
        ...(r4?.state.researchCoverage ? { researchCoverage: r4.state.researchCoverage } : {}),
        citations: modelAnswer?.observations ?? [],
        fileGuides,
        observedProjectIds: directory.summaries.map(p => p.id),
        limitations: [...(fallbackReason ? ["云端分析未完成，已改为项目状态读回，未生成操作提案"] : []), ...directory.coverage.limitations, ...("limitations" in observations.coverage ? observations.coverage.limitations as string[] : [])] };
      const trace = {
        focusSources: blocks.sources,
        purpose: "FOCUS_TURN", actorUserId: actor.userId, sourceIds: blocks.sources.map(s => s.id),
        supportState: action ? "SUPPORTED" : "INSUFFICIENT", supportBasis: "ACTION_PROPOSAL_NOT_FACT_CLAIM",
        ...(r4 ? { experience: r4.state, evaluationVariant: evaluation?.variant ?? "FULL", uiPlanOrigin: evaluation ? "EVALUATION_DISABLED" : uiFallback ? "FALLBACK" : "MODEL", uiFallback } : {}),
      };
      const run = prepared ? await tx.agentRun.update({ where: { id: prepared.runId }, data: { status: "SUCCESS",
        trace: json({ ...record((await tx.agentRun.findUniqueOrThrow({ where: { id: prepared.runId } })).trace), ...trace }) } }) : await tx.agentRun.create({ data: { projectId: null, conversationId: id, turnId: turn.id,
        runType: "CHAT", status: modelEnabled && !fallbackReason ? "SUCCESS" : "FALLBACK", provider,
        fallbackReason: fallbackReason ?? (modelEnabled ? null : "MODEL_NOT_REQUESTED_OR_RULE_MODE"),
        trace: json(trace),
        resultJson: json({}) } });
      if (prepared) blocks.proposal = prepared.proposal;
      if (action && !prepared) {
        const sources = await readCopilotContext(tx, action.projectId, actor);
        const proposed = { kind: "create_action" as const, label: "创建行动", ...action };
        await tx.agentRun.update({ where: { id: run.id }, data: { trace: json({
          ...record(run.trace), copilotSources: sources.sourceManifest, copilotTargetProjectId: action.projectId,
        }), resultJson: json({ proposedActions: [proposed] }) } });
        await freezeCopilotProposals(tx, run.id, [proposed], sources.sourceManifest);
        const execution = await tx.copilotToolExecution.findFirstOrThrow({ where: { sourceRunId: run.id } });
        blocks.proposal = { executionId: execution.id, projectId: action.projectId, title: action.title,
          description: action.description, proposalHash: execution.proposalHash, status: execution.status, resultId: null };
      }
      if (r4 && uiPlan) {
        blocks.presentationPlan = uiPlan;
        blocks.presentation = await refreshExperiencePresentation(actor, id, blocks, r4.state, turn.id, tx, true);
      }
      await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", advice, blocks, turn.id, run.id);
      await tx.conversation.update({ where: { id }, data: { activeTurnId: null,
        focusJson: json({ projectId: selected ?? null, ...(exactRef && exactRef.projectId === selected ? { entityRef: exactRef } : {}) }), pinnedStateJson: json(coordination(turn) ? constraints : pinned), version: { increment: 1 } } });
      const finalTurn = await tx.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } });
      const finalManifest = record(finalTurn.readManifestJson), coord = coordination(finalTurn);
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { status: route.intent === "CLARIFY" ? "NEEDS_CLARIFICATION" : "ANSWERED", finishedAt: new Date(),
        readManifestJson: json({ ...finalManifest, ...(r4 ? { experience: { ...r4.state, phase: route.intent === "CLARIFY" ? "WAITING_USER" : "READY" } } : {}),
          ...(coord ? { coordination: { ...coord, state: "TERMINAL", publishedGeneration: coord.generation } } : {}) }) } });
      return { turnId: turn.id, status: route.intent === "CLARIFY" ? "NEEDS_CLARIFICATION" : "ANSWERED" };
    }, { timeout: 20000 });
    return { ...result, conversation: await readConversation(actor, id) };
  } catch (error) {
    if (error instanceof AppError && error.code === "TURN_RECOORDINATE") throw error;
    const old = await db.conversationTurn.findUnique({ where: { id: turn.id } });
    if (old && coordination(old)) await assertTurnCurrent(old, actor.userId, currentGeneration()).catch(e => { if (e instanceof AppError && e.code === "TURN_RECOORDINATE") throw e; });
    const usages = Array.isArray(old?.usageJson) ? old.usageJson.map(record) : [];
    const reservations = Array.isArray(old?.reservationJson) ? old.reservationJson.map(record) : [];
    const completedCalls = usages.length;
    const observedProvider = [...usages, ...reservations].findLast(e => typeof e.provider === "string")?.provider;
    const stopped = record(old?.readManifestJson).stopRequested === true || (old && coordination(old)?.state === "STOPPING") || error instanceof AppError && error.code === "TURN_STOP_REQUESTED";
    const uncertain = error instanceof AppError && ["EXTERNAL_RESULT_UNKNOWN", "TURN_LEASE_LOST", "CALL_ALREADY_RESERVED"].includes(error.code);
    const status = stopped ? "CANCELLED" : uncertain || (old?.callCount ?? 0) > completedCalls ? "UNKNOWN" : "FAILED";
    await db.$transaction(async tx => {
      await lockConversation(tx, id);
      assertTurnLease(await tx.conversationTurn.findUniqueOrThrow({ where: { id: turn.id } }));
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { status, finishedAt: new Date(),
        errorJson: { code: error instanceof AppError ? error.code : "MODEL_OR_PROTOCOL_ERROR", message: "请求未完成，未创建业务操作；不会自动重发模型" } } });
      await tx.conversation.updateMany({ where: { id, activeTurnId: turn.id }, data: { activeTurnId: null } });
      await tx.copilotToolExecution.updateMany({ where: { status: "PENDING", sourceRun: { turnId: turn.id, conversationId: id, status: "PARTIAL" } }, data: { status: "DECLINED" } });
      await tx.agentRun.updateMany({ where: { turnId: turn.id, conversationId: id, status: "PARTIAL" }, data: { status: "FAILED", fallbackReason: "UNPUBLISHED_DRAFT" } });
      await tx.agentRun.create({ data: { projectId: null, conversationId: id, turnId: turn.id, runType: "CHAT",
        status: stopped ? "FALLBACK" : "FAILED", provider: typeof observedProvider === "string" ? observedProvider : old?.callCount ? "configured-model" : "project_state",
        fallbackReason: stopped ? "USER_STOPPED" : error instanceof AppError ? error.code : "MODEL_OR_PROTOCOL_ERROR",
        trace: json({ purpose: "FOCUS_FAILED_TURN", actorUserId: actor.userId, usage: old?.usageJson,
          reservation: old?.reservationJson, usageUnknown: status === "UNKNOWN" || usages.some(e => e.usageUnknown !== false) }) } });
      if (stopped) await appendConversationMessage(tx, id, actor.userId, "ASSISTANT", "已停止本轮调查，未提交业务操作。已完成的读取仍保留在这段讨论的调查记录中。", emptyBlocks());
    });
    if (stopped) return { turnId: turn.id, status: "CANCELLED", conversation: await readConversation(actor, id) };
    throw error;
  }
}

export async function stopConversationTurn(actor: ConversationActor, id: string, turnId: string) {
  await db.$transaction(async tx => {
    await lockConversation(tx, id); const c = await ownedConversation(actor, id, tx);
    const turn = await tx.conversationTurn.findFirst({ where: { id: turnId, conversationId: id } });
    if (!turn || c.activeTurnId !== turn.id) return;
    if (record(turn.readManifestJson).deferred && (!turn.leaseToken || !turn.leaseUntil || turn.leaseUntil.getTime() <= Date.now())) {
      await tx.conversationTurn.update({ where: { id: turn.id }, data: { status: "CANCELLED", finishedAt: new Date(), readManifestJson: json({ ...record(turn.readManifestJson), stopRequested: true }) } });
      await tx.conversation.update({ where: { id }, data: { activeTurnId: null } });
      return;
    }
    if (!record(turn.readManifestJson).experience) throw new AppError("TURN_NOT_STOPPABLE", "这条请求不支持调查停止，请读取原状态", 409);
    await tx.conversationTurn.update({ where: { id: turn.id }, data: { readManifestJson: json({ ...record(turn.readManifestJson), stopRequested: true }) } });
  });
  return { conversation: await readConversation(actor, id) };
}

export async function readConversationTurn(actor: ConversationActor, id: string, turnId: string) {
  await ownedConversation(actor, id);
  const turn = await db.conversationTurn.findFirst({ where: { id: turnId, conversationId: id } });
  if (!turn) throw new AppError("TURN_NOT_FOUND", "请求不存在", 404);
  const view = await readConversation(actor, id);
  return { id: turn.id, requestId: turn.requestId, status: turn.status, error: view.messages.some(m => m.restricted) ? null : turn.errorJson,
    progress: view.messages.some(m => m.restricted) ? undefined : experienceProgress(turn.readManifestJson) };
}
