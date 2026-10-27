import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { sourceHash } from "@/lib/mission/repository";
import { assertCopilotSources, freezeCopilotProposals, readCopilotContext } from "@/lib/copilot/confirmation";
import { agentPresentationSchema, presentationPlanSchema, type ExperienceEntityRef, type HydratedBlock, type PresentationPlan } from "@/lib/types/agentExperience";
import type { ConversationActor, ConversationBlocks } from "@/lib/types/conversation";
import { assertProject, lockConversation, ownedConversation, record, type Tx } from "./repository";
import { hydratePresentation, type ExperienceAuthority } from "./experienceContract";
import { conversationModelSpec } from "./model";
import { uiPlanV1 } from "./promptSpecs";
import type { R4State } from "./investigationService";

const expiryMs = 15 * 60 * 1000;
const identity = (r: ExperienceEntityRef) => [r.kind, r.projectId, r.id].join(":");
const sameRefs = (a: ExperienceEntityRef[], b: ExperienceEntityRef[]) => jsonHash(a.map(r => ({ ...r })).sort((x, y) => identity(x).localeCompare(identity(y)))) === jsonHash(b.map(r => ({ ...r })).sort((x, y) => identity(x).localeCompare(identity(y))));
type ActionDraft = { projectId: string; title: string; description: string; priority: number };

export async function prepareExperienceDraft(actor: ConversationActor, id: string, turnId: string, action: ActionDraft | null, provider: string) {
  return db.$transaction(async tx => {
    await lockConversation(tx, id);
    const c = await ownedConversation(actor, id, tx), turn = await tx.conversationTurn.findUniqueOrThrow({ where: { id: turnId } });
    if (record(turn.readManifestJson).stopRequested) throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
    if (c.activeTurnId !== turnId || c.version !== turn.baseVersion + 1) throw new AppError("TURN_CHANGED", "原讨论已变化", 409);
    const run = await tx.agentRun.create({ data: { projectId: null, conversationId: id, turnId, runType: "CHAT", status: "PARTIAL", provider,
      trace: { purpose: "FOCUS_TURN", actorUserId: actor.userId, r4Draft: true, proposalExpiresAt: new Date(Date.now() + expiryMs).toISOString(),
        supportState: action ? "SUPPORTED" : "INSUFFICIENT", supportBasis: "ACTION_PROPOSAL_NOT_FACT_CLAIM" }, resultJson: {} } });
    if (!action) return { runId: run.id, proposal: null };
    const sources = await readCopilotContext(tx, action.projectId, actor), proposed = { kind: "create_action" as const, label: "创建行动", ...action };
    await tx.agentRun.update({ where: { id: run.id }, data: { trace: json({ ...record(run.trace), copilotTargetProjectId: action.projectId, copilotSources: sources.sourceManifest }), resultJson: json({ proposedActions: [proposed] }) } });
    await freezeCopilotProposals(tx, run.id, [proposed], sources.sourceManifest);
    const e = await tx.copilotToolExecution.findFirstOrThrow({ where: { sourceRunId: run.id } });
    return { runId: run.id, proposal: { executionId: e.id, projectId: action.projectId, title: action.title, description: action.description,
      proposalHash: e.proposalHash, status: e.status, resultId: null } };
  });
}

/** Rebuild every business field and allowed action from current services, including historical reads. */
export async function experienceAuthority(actor: ConversationActor, id: string, blocks: ConversationBlocks, state: R4State, turnId: string,
  tx: Tx = db, publishing = false) {
  const c = await ownedConversation(actor, id, tx), currentVersion = c.version + (publishing ? 1 : 0);
  const a: ExperienceAuthority = { conversationId: id, conversationVersion: currentVersion, userId: actor.userId, conversationOwnerUserId: actor.userId,
    sessionValid: true, scope: c.scope === "PROJECT" ? "PROJECT" : "WORKSPACE", homeProjectId: c.homeProjectId,
    projectIds: [], now: new Date().toISOString(), entities: [], readSet: [], evidence: [], catalog: [], allowedActions: [] };
  const register = (ref: ExperienceEntityRef, privateOwnerUserId: string | null = null) => {
    if (!a.entities.some(e => sameRefs([e.ref], [ref]))) a.entities.push({ ref, privateOwnerUserId });
    return ref;
  };
  const base = (semanticType: HydratedBlock["semanticType"], refs: ExperienceEntityRef[], fallbackText: string) => ({
    blockKey: semanticType + ":" + (refs[0]?.id ?? turnId), semanticType, emphasis: "supporting" as const, refs, fallbackText, actionBindingIds: [] as string[],
  });
  for (const projectId of blocks.observedProjectIds) { await assertProject(actor, projectId, tx); a.projectIds.push(projectId); }
  for (const s of blocks.sources) {
    const member = await assertProject(actor, s.projectId, tx);
    let revision: string | null;
    if (s.sourceId.startsWith("mission:")) {
      const m = member.role === "OWNER" ? await tx.agentMission.findFirst({ where: { id: s.sourceId.slice(8), projectId: s.projectId, ownerUserId: actor.userId } }) : null;
      revision = m ? String(m.version) : null;
    } else revision = await sourceHash(s.projectId, s.sourceId, tx);
    if (revision === s.revision) register({ kind: "SOURCE", id: s.id, projectId: s.projectId, revision: s.revision }, s.sourceId.startsWith("mission:") ? actor.userId : null);
  }
  for (const gap of state.goalGaps) {
    const project = await tx.project.findUnique({ where: { id: gap.projectId }, select: { goal: true } });
    if (project?.goal.slice(0, 1500) !== gap.goalQuote) continue;
    const ref = register({ ...gap.goalRef, revision: (await sourceHash(gap.projectId, "project:" + gap.projectId, tx))! });
    const criteria = gap.criteria.map(criterion => {
      const evidence = criterion.evidence.filter(e => a.entities.some(known => sameRefs([known.ref], [e.source])) && blocks.sources.some(s => s.id === e.source.id && s.revision === e.source.revision && s.excerpt.includes(e.quote)));
      a.evidence.push(...evidence);
      return evidence.length === criterion.evidence.length ? criterion : { ...criterion, evidence, state: "UNKNOWN" as const, explanation: "引用后有修订，当前条件需要重新核对。" };
    });
    const updated = { ...gap, goalRef: ref, criteria };
    a.catalog.push({ ...base("goal_gap", [ref], gap.goalQuote), semanticType: "goal_gap", goalGap: updated });
  }
  const citations = blocks.citations ?? [];
  for (const cite of citations) {
    const s = blocks.sources.find(s => s.id === cite.sourceId), ref = a.entities.find(e => e.ref.kind === "SOURCE" && e.ref.id === cite.sourceId)?.ref;
    if (!s || !ref || !s.excerpt.includes(cite.quote)) continue;
    const links = a.evidence.filter(e => e.source.id === ref.id);
    const evidence = links.length ? links : [{ source: ref, excerptHash: s.excerptHash, quote: cite.quote, observedAt: s.observedAt,
      readScope: s.readScope ?? (s.sourceId.startsWith("card:") ? "SUMMARY" as const : "EXCERPT" as const), claim: "原文记载", relation: "UNDETERMINED" as const,
      applicability: "UNKNOWN" as const, verification: "REPORTED" as const, reason: "引用原文；不代表独立验收" }];
    a.evidence.push(...evidence);
    a.catalog.push({ ...base("evidence", [ref], blocks.fileGuides?.find(f => f.sourceId === s.id)?.title ?? s.title), semanticType: "evidence", state: s.temporalState === "CONTESTED" ? "CONTESTED" : "UNKNOWN", evidence: evidence.slice(0, 12) });
  }
  if (state.steps.length && state.steps.every(s => s.sources.every(ref => a.entities.some(e => sameRefs([e.ref], [ref])))))
    a.catalog.push({ ...base("investigation", [], `本轮完成 ${state.steps.filter(s => s.status === "SUCCEEDED").length} 次资料读取`), semanticType: "investigation", investigationId: turnId,
      state: state.decision?.decision === "ASK_USER" ? "WAITING_USER" : "CONCLUDED", steps: state.steps });
  if (state.decision?.decision === "ASK_USER" && state.projectIds[0]) {
    const ref = register({ kind: "QUESTION", id: turnId, projectId: state.projectIds[0], revision: jsonHash(state.decision.question) }, actor.userId);
    const bindingId = `ask:${turnId}`;
    const original = await tx.agentMessage.findFirst({ where: { conversationId: id, turnId, role: "ASSISTANT" }, select: { seq: true } });
    const later = original?.seq ? await tx.agentMessage.findFirst({ where: { conversationId: id, role: "USER", seq: { gt: original.seq } }, select: { id: true } }) : null;
    const enabled = !later && (!c.activeTurnId || publishing);
    a.allowedActions.push({ bindingId, conversationId: id, expectedConversationVersion: currentVersion, actionKind: "ASK", label: "继续讨论", target: ref, enabled,
      disabledReason: enabled ? null : later ? "已进入后续讨论，可继续追问" : "请等本轮讨论结束", frozen: null });
    a.catalog.push({ ...base("question", [ref], state.decision.question), semanticType: "question", actionBindingIds: [bindingId], draftKey: `${id}:${turnId}`,
      question: state.decision.question, inputKind: "TEXT", required: true, choices: [] });
  }
  if (blocks.proposal) {
    const p = blocks.proposal, e = await tx.copilotToolExecution.findFirst({ where: { id: p.executionId, sourceRun: { conversationId: id } }, include: { sourceRun: true } });
    if (e && e.proposalHash === p.proposalHash && record(e.sourceRun.trace).actorUserId === actor.userId) {
      const trace = record(e.sourceRun.trace), expiresAt = typeof trace.proposalExpiresAt === "string" ? trace.proposalExpiresAt : new Date(e.createdAt.getTime() + expiryMs).toISOString();
      const proposalRef = register({ kind: "PROPOSAL", id: e.id, projectId: p.projectId, revision: e.proposalHash }, actor.userId);
      let disabledReason: string | null = e.status === "PENDING" ? null : "这项提案已处理";
      if (Date.parse(expiresAt) <= Date.now()) disabledReason = "这项提案已过期";
      if (c.activeTurnId && !publishing) disabledReason = "请等本轮讨论结束";
      if (!disabledReason) try { await assertCopilotSources(tx, p.projectId, trace.copilotSources as Parameters<typeof assertCopilotSources>[2], actor, e.sourceRunId); }
      catch (error) { if (error instanceof AppError && error.code === "SOURCE_CHANGED") disabledReason = "提案依据已有变化"; else throw error; }
      const status = e.status === "COMMITTED" ? "COMMITTED" : e.status === "DECLINED" ? "DECLINED" : Date.parse(expiresAt) <= Date.now() ? "EXPIRED" : disabledReason && !c.activeTurnId ? "STALE" : "PENDING";
      const bindingIds: string[] = [];
      for (const actionKind of ["CONFIRM", "DECLINE"] as const) {
        const bindingId = `${actionKind.toLowerCase()}:${e.id}`; bindingIds.push(bindingId);
        a.allowedActions.push({ bindingId, conversationId: id, expectedConversationVersion: currentVersion, actionKind, label: actionKind === "CONFIRM" ? "确认创建行动" : "暂不采用",
          target: proposalRef, enabled: disabledReason === null, disabledReason,
          frozen: { executionId: e.id, candidateId: null, proposalHash: e.proposalHash, expiresAt } });
      }
      a.catalog.push({ ...base("approval", [proposalRef], p.title + "\n" + p.description), semanticType: "approval", actionBindingIds: bindingIds,
        executionId: e.id, proposalHash: e.proposalHash, expiresAt, state: status });
      if (e.status === "COMMITTED" && e.resultId && e.tool === "create_action") {
        const action = await tx.actionItem.findFirst({ where: { id: e.resultId, projectId: p.projectId, isSimulated: false } });
        if (action) {
          const receipt = register({ kind: "RECEIPT", id: e.id, projectId: p.projectId, revision: jsonHash({ resultId: action.id, status: action.status, resultCardId: action.resultCardId }) }, actor.userId);
          const target = register({ kind: "ACTION", id: action.id, projectId: p.projectId, revision: jsonHash(action) });
          const bindingId = `open:${action.id}`;
          a.allowedActions.push({ bindingId, conversationId: id, expectedConversationVersion: currentVersion, actionKind: "OPEN", label: "查看原行动", target, enabled: true, disabledReason: null, frozen: null });
          a.catalog.push({ ...base("receipt", [receipt, target], action.title), semanticType: "receipt", actionBindingIds: [bindingId], evidence: [], verification: "NOT_CHECKED",
            state: action.status === "DONE" ? "SUCCEEDED" : action.status === "DOING" ? "RUNNING" : action.status === "CANCELLED" ? "CANCELLED" : "CREATED" });
        }
      }
    }
  }
  await ownedConversation(actor, id, tx);
  return a;
}

function safePlan(plan: PresentationPlan, a: ExperienceAuthority): PresentationPlan {
  return { ...plan, composition: plan.composition.map(block => {
    if (block.semanticType === "approval") {
      const receipt = a.catalog.find(b => b.semanticType === "receipt" && b.refs.some(r => r.kind === "RECEIPT" && block.dataRefs.some(old => old.id === r.id)));
      if (receipt) return { blockKey: block.blockKey, emphasis: block.emphasis, semanticType: "receipt" as const, dataRefs: receipt.refs };
    }
    if (block.semanticType === "goal_gap") {
      const goal = a.catalog.find(b => b.semanticType === "goal_gap" && b.refs.some(r => block.dataRefs.some(old => identity(old) === identity(r))));
      if (goal) return { ...block, dataRefs: goal.refs };
    }
    const knownRefs = block.dataRefs.every(ref => a.entities.some(e => sameRefs([ref], [e.ref])));
    if (knownRefs && (block.semanticType === "prose" || a.catalog.some(b => b.semanticType === block.semanticType && sameRefs(b.refs, block.dataRefs)))) return block;
    return { blockKey: block.blockKey, emphasis: block.emphasis, semanticType: "prose" as const, dataRefs: [], text: "这部分依据或对象已有变化，可查看原引用或重新调查。" };
  }) };
}
export async function composeExperience(actor: ConversationActor, id: string, turnId: string, question: string, advice: string,
  blocks: ConversationBlocks, state: R4State) {
  const a = await experienceAuthority(actor, id, blocks, state, turnId, db, true);
  const r = await conversationModelSpec(actor, id, turnId, "ui-plan", uiPlanV1, { question, advice,
    catalog: a.catalog.map(b => ({ semanticType: b.semanticType, dataRefs: b.refs, summary: b.fallbackText })),
    goalGaps: state.goalGaps, stopReason: state.stopReason });
  if (record((await db.conversationTurn.findUniqueOrThrow({ where: { id: turnId } })).readManifestJson).stopRequested)
    throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
  // Fresh authority is built again by the final transaction; no object from this snapshot grants approval.
  const plan = r.data;
  // Preserve a real pending confirmation/question even if the model omitted its interaction.
  const required = a.catalog.find(b => b.semanticType === "approval" || b.semanticType === "question");
  if (required && !plan.composition.some(b => b.semanticType === required.semanticType && sameRefs(b.dataRefs, required.refs))) {
    if (plan.composition.length >= 16) throw new AppError("UI_PLAN_REQUIRED_INTERACTION_MISSING", "回答没有保留待回应操作", 409);
    plan.composition.push({ blockKey: "required:" + required.blockKey, semanticType: required.semanticType, emphasis: "supporting", dataRefs: required.refs });
  }
  const presentation = hydratePresentation(plan, a);
  return { plan, presentation };
}
export async function refreshExperiencePresentation(actor: ConversationActor, id: string, blocks: ConversationBlocks, state: R4State,
  turnId: string, tx: Tx = db, publishing = false) {
  const parsed = presentationPlanSchema.safeParse(blocks.presentationPlan);
  if (!parsed.success) return undefined;
  const authority = await experienceAuthority(actor, id, blocks, state, turnId, tx, publishing);
  const plan = safePlan(parsed.data, authority);
  return agentPresentationSchema.parse(hydratePresentation(plan, authority));
}

export async function fallbackExperiencePlan(actor: ConversationActor, id: string, turnId: string, advice: string, blocks: ConversationBlocks, state: R4State): Promise<PresentationPlan> {
  const a = await experienceAuthority(actor, id, blocks, state, turnId, db, true);
  const primary = a.catalog.find(b => b.semanticType === "approval" || b.semanticType === "question");
  const details = a.catalog.filter(b => b.semanticType === "goal_gap" || b.semanticType === "investigation").slice(0, 3);
  const composition: PresentationPlan["composition"] = [{ blockKey: "answer", semanticType: "prose", emphasis: "primary", dataRefs: [], text: advice.slice(0, 2000) }];
  for (const b of [...(primary ? [primary] : []), ...details]) composition.push({ blockKey: b.blockKey, semanticType: b.semanticType, emphasis: "supporting", dataRefs: b.refs });
  return { schemaVersion: 2, intent: primary?.semanticType === "question" ? "CLARIFY" : "EXPLAIN", primaryIntent: "NONE", composition };
}
