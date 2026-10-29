import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { assertProject, assertSession, record, type Tx } from "@/lib/conversation/repository";
import { directiveCommandSchema, type DirectiveScope, type ContinuityView, type EffectiveDirective } from "@/lib/types/continuity";
import type { ConversationActor } from "@/lib/types/conversation";
import { admitDirective, candidateHash } from "./admission";
const intentPolicy = "effective-directives-v1";
export function actorDirectiveScope(actor: ConversationActor, projectId: string): DirectiveScope {
  return { projectId, ...(actor.conversationId ? { conversationId: actor.conversationId } : {}),
    ...(actor.missionId && actor.missionProjectId === projectId ? { missionId: actor.missionId } : {}) };
}
export function assertDirectiveEffect(view: ContinuityView, effect: "BUSINESS_WRITE" | "EXTERNAL_READ" | "MODEL") {
  const rules = view.constraints.join("\n");
  const denied = effect === "BUSINESS_WRITE" ? /只读|不创建行动|(?:不要|禁止|不得|不允许)(?:创建行动|新增行动|外部写入|写入业务)/.test(rules)
    : effect === "EXTERNAL_READ" ? /不联网|(?:不要|禁止|不得|不允许)(?:联网|调用外部工具|付费调用)/.test(rules)
      : /(?:不要|禁止|不得|不允许)(?:调用模型|付费调用)/.test(rules);
  if (denied) throw new AppError("DIRECTIVE_EFFECT_DENIED", "当前工作限制不允许此操作，可先撤回或调整原指引", 409);
}
export function boundDirectiveScope(binding: unknown, projectId: string, conversationId?: string): DirectiveScope {
  const saved = record(record(binding).scope);
  return { projectId, ...(conversationId ? { conversationId } : {}),
    ...(saved.projectId === projectId && saved.conversationId === conversationId && typeof saved.missionId === "string" ? { missionId: saved.missionId } : {}) };
}

export async function effectiveContinuity(userId: string, scope: DirectiveScope, tx: Tx = db, now = new Date()): Promise<ContinuityView> {
  const [user, rows] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: userId }, select: { continuitySeq: true } }),
    tx.agentDirectiveEvent.findMany({ where: { ownerUserId: userId, projectId: scope.projectId,
      AND: [{ OR: [{ conversationId: null }, ...(scope.conversationId ? [{ conversationId: scope.conversationId }] : [])] },
        { OR: [{ missionId: null }, ...(scope.missionId ? [{ missionId: scope.missionId }] : [])] }] }, orderBy: { seq: "asc" } }),
  ]);
  const latest = new Map<string, typeof rows[number]>();
  for (const e of rows) if (+e.validFrom <= +now) latest.set(e.directiveId, e);
  const active = [...latest.values()].filter(e => !["WITHDRAW", "TRANSFER_OUT"].includes(e.operation) && (!e.validUntil || +now < +e.validUntil));
  const directives: EffectiveDirective[] = active.map(e => ({ id: e.id, directiveId: e.directiveId, seq: e.seq,
    scope: { projectId: e.projectId, ...(e.conversationId ? { conversationId: e.conversationId } : {}), ...(e.missionId ? { missionId: e.missionId } : {}) },
    kind: e.kind, quote: e.quote, sourceIds: e.sourceIdsJson as string[], validFrom: e.validFrom.toISOString(), validUntil: e.validUntil?.toISOString() ?? null }));
  const epoch = (subset: typeof rows) => subset.map(e => ({ id: e.id, seq: e.seq, operation: e.operation,
    segment: +now < +e.validFrom ? "BEFORE" : e.validUntil && +now >= +e.validUntil ? "AFTER" : "ACTIVE" }));
  const future = rows.flatMap(e => [e.validFrom, e.validUntil]).filter((v): v is Date => !!v && +v > +now).sort((a, b) => +a - +b);
  return { schemaVersion: 1, seq: user.continuitySeq, intentHash: jsonHash({ policy: intentPolicy, scope, epoch: epoch(rows) }),
    reusePolicyHash: jsonHash({ scope, epoch: epoch(rows.filter(e => e.kind === "USE_SUPPRESSION")) }), nextBoundary: future[0]?.toISOString() ?? null,
    directives, workingObjective: [...directives].reverse().find(d => d.kind === "WORKING_OBJECTIVE")?.quote ?? null,
    constraints: [...new Set(active.flatMap(e => e.kind === "CONSTRAINT" ? [e.quote] : (record(e.admissionJson).constraints ?? []) as string[]))], stopped: directives.some(d => d.kind === "STOP") };
}
export async function assertContinuityBinding(userId: string, scope: DirectiveScope, binding: unknown, tx: Tx = db) {
  const current = await effectiveContinuity(userId, scope, tx), old = record(binding);
  if (current.stopped) throw new AppError("DIRECTIVE_STOPPED", "你已暂停这项工作，可撤回暂停后继续", 409);
  // Legacy publications remain usable only where there has never been relevant guidance.
  const empty = jsonHash({ policy: intentPolicy, scope, epoch: [] });
  if ((old.intentHash ? old.intentHash !== current.intentHash : current.intentHash !== empty) ||
    (old.reusePolicyHash && old.reusePolicyHash !== current.reusePolicyHash))
    throw new AppError("CONTINUITY_CHANGED", "工作方向或资料使用要求已变化，请按当前要求重新预览", 409);
  return current;
}
export async function admitDirectiveInTx(actor: ConversationActor, raw: unknown, tx: Tx, origin: { conversationId: string; requestId: string }) {
  const input = directiveCommandSchema.parse(raw), inputHash = jsonHash(input);
  // The user row is the first write lock for both a directive and business confirmations.
  await tx.user.updateMany({ where: { id: actor.userId }, data: { continuitySeq: { increment: 0 } } });
  await assertProject(actor, input.scope.projectId, tx);
  if (input.scope.conversationId && input.scope.conversationId !== origin.conversationId) throw new AppError("DIRECTIVE_SCOPE_CHANGED", "这条指令不属于当前讨论", 409);
  if (input.scope.missionId && !await tx.agentMission.findFirst({ where: { id: input.scope.missionId, projectId: input.scope.projectId, ownerUserId: actor.userId } }))
    throw new AppError("MISSION_NOT_FOUND", "原委托不可访问", 404);
  const replay = await tx.agentDirectiveEvent.findMany({ where: { ownerUserId: actor.userId, commandId: input.commandId }, orderBy: { eventIndex: "asc" } });
  if (replay.length) {
    if (replay[0].inputHash !== inputHash) throw new AppError("REQUEST_ID_REUSED", "指令编号已用于其他内容", 409);
    return { admission: replay[0].admissionJson, events: replay.map(e => e.id), view: await effectiveContinuity(actor.userId, input.scope, tx) };
  }
  const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.continuitySeq !== input.expectedSeq) throw new AppError("DIRECTIVE_CHANGED", "另一端已调整工作指引，请核对后重试", 409);
  try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(); } catch { throw new AppError("INVALID_TIMEZONE", "时区无法识别", 422); }
  const now = new Date(), admission = admitDirective(input, now);
  let candidateSource: Record<string, unknown> | null = null;
  if (input.candidateId) {
    if (admission.status !== "CONFIRMED_APPLIED") throw new AppError("DIRECTIVE_CONFIRMATION_REQUIRED", "模型理解须先核对具体范围与期限", 409);
    const turnId = input.candidateId.split(":")[0], turn = await tx.conversationTurn.findFirst({ where: { id: turnId, conversation: { ownerUserId: actor.userId } } });
    const candidate = record(record(turn?.readManifestJson).directiveCandidate);
    if (!turn || candidate.id !== input.candidateId || candidate.status !== "INTERPRETATION_CANDIDATE" || candidate.projectId !== input.scope.projectId || !["ANSWERED", "NEEDS_CLARIFICATION"].includes(turn.status))
      throw new AppError("DIRECTIVE_CANDIDATE_CHANGED", "原理解候选已变化，请读取当前讨论", 409);
    if (jsonHash(candidate.scope) !== jsonHash(input.scope)) throw new AppError("DIRECTIVE_SCOPE_CHANGED", "原理解的项目或委托范围已变化", 409);
    await assertContinuityBinding(actor.userId, { projectId: input.scope.projectId, conversationId: turn.conversationId, ...(input.scope.missionId ? { missionId: input.scope.missionId } : {}) }, candidate.binding, tx);
    candidateSource = { turnId, quote: candidate.quote, interpretation: candidate.interpretation, candidateId: candidate.id };
  }
  if (!["DIRECT_APPLIED", "CONFIRMED_APPLIED"].includes(admission.status)) {
    await tx.agentRun.create({ data: { conversationId: origin.conversationId, runType: "CHAT", status: "SUCCESS", provider: "literal-admission-v1",
      trace: json({ purpose: "DIRECTIVE_ADMISSION", requestId: origin.requestId, inputHash, scope: input.scope, quote: input.quote, admission }) } });
    return { admission, events: [], view: await effectiveContinuity(actor.userId, input.scope, tx) };
  }
  const previous = input.directiveId ? await tx.agentDirectiveEvent.findFirst({ where: { ownerUserId: actor.userId, directiveId: input.directiveId }, orderBy: { seq: "desc" } }) : null;
  if (input.directiveId && (!previous || previous.projectId !== input.scope.projectId || previous.conversationId !== (input.scope.conversationId ?? null) || previous.missionId !== (input.scope.missionId ?? null)))
    throw new AppError("DIRECTIVE_SCOPE_CHANGED", "原指引的范围已变化", 409);
  if (["WITHDRAW", "TRANSFER"].includes(input.operation) && !previous) throw new AppError("DIRECTIVE_NOT_FOUND", "请选择原工作指引", 404);
  const from = input.validFrom ? new Date(input.validFrom) : now, until = admission.until ? new Date(admission.until) : input.operation === "TRANSFER" ? previous?.validUntil ?? null : null;
  if (+from < +now - 60000 || (until && (+until <= +from || +until > +now + 366 * 86400000))) throw new AppError("INVALID_DIRECTIVE_PERIOD", "请使用明确且尚未到期的有效区间", 422);
  const events: string[] = [], projectIds = [input.scope.projectId];
  const create = async (scope: DirectiveScope, operation: string, index: number, kind: string, quote: string, sourceIds: string[], directiveId: string) => {
    const e = await tx.agentDirectiveEvent.create({ data: { id: randomUUID(), ownerUserId: actor.userId, seq: user.continuitySeq + index + 1,
      commandId: input.commandId, eventIndex: index, inputHash, directiveId, previousEventId: previous?.id,
      ...scope, kind, operation, quote, sourceJson: json({ ...origin, actorUserId: actor.userId, quoteHash: jsonHash(quote),
        origin: input.admission === "CONFIRMED" ? "EXACT_USER_CONTROL" : "AUTHENTICATED_USER_INPUT", ...(candidateSource ? { modelCandidate: candidateSource } : {}) }),
      admissionJson: json(admission), sourceIdsJson: json(sourceIds), validFrom: from, validUntil: until, timezone: input.timezone } }); events.push(e.id);
  };
  const kind = admission.kind ?? previous?.kind ?? input.kind ?? "WORKING_OBJECTIVE", quote = input.quote ?? previous?.quote ?? "停止复用所选资料";
  let sourceIds = input.operation === "SUPPRESS_USE" ? input.sourceIds ?? [] : [];
  if (input.operation === "SUPPRESS_USE") {
    const { sourceLineage } = await import("./sourcePolicy");
    const roots = await Promise.all(sourceIds.map(id => sourceLineage(input.scope.projectId, id, tx)));
    for (const [i, id] of sourceIds.entries()) {
      const exists = id.startsWith("artifact:") ? !!await tx.generatedArtifact.findFirst({ where: { id: id.slice(9), projectId: input.scope.projectId }, select: { id: true } })
        : id.startsWith("repo:") ? !!await tx.sourceConnection.findFirst({ where: { id: id.slice(5), projectId: input.scope.projectId, ownerUserId: actor.userId }, select: { id: true } })
        : !id.startsWith("url:") && roots[i].known;
      if (!exists) throw new AppError("SOURCE_NOT_FOUND", "请选择当前项目中可访问的原来源", 404);
    }
    sourceIds = [...new Set([...sourceIds, ...roots.flatMap(r => r.roots.filter(id => id.startsWith("url:")))])];
  }
  if (input.operation === "TRANSFER") {
    if (!input.targetProjectId || input.targetProjectId === input.scope.projectId || kind === "USE_SUPPRESSION") throw new AppError("INVALID_TRANSFER", "请指定不同的目标项目；资料使用限制需在目标项目重新指定", 422);
    await assertProject(actor, input.targetProjectId, tx);
    await create(input.scope, "TRANSFER_OUT", 0, kind, previous!.quote, [], previous!.directiveId);
    await create({ projectId: input.targetProjectId }, "SET", 1, kind, previous!.quote, [], randomUUID()); projectIds.push(input.targetProjectId);
  } else await create(input.scope, input.operation, 0, kind, quote, sourceIds, previous?.directiveId ?? randomUUID());
  await tx.user.update({ where: { id: actor.userId }, data: { continuitySeq: { increment: events.length } } });
  if (candidateSource) {
    const t = await tx.conversationTurn.findUniqueOrThrow({ where: { id: String(candidateSource.turnId) } });
    await tx.conversationTurn.update({ where: { id: t.id }, data: { readManifestJson: json({ ...record(t.readManifestJson), directiveCandidate: { ...record(record(t.readManifestJson).directiveCandidate), status: "USER_CONFIRMED" } }) } });
  }
  // No Conversation.version change: the original in-flight turn retains its base-version slot.
  const active = await tx.conversationTurn.findMany({ where: { status: { in: ["OBSERVING", "GENERATING"] }, conversation: { ownerUserId: actor.userId } } });
  for (const t of active) {
    const m = record(t.readManifestJson), coord = record(m.coordination), scopes = coord.scopes as DirectiveScope[] | undefined;
    if (scopes?.some(s => projectIds.includes(s.projectId) && (!input.scope.conversationId || input.scope.conversationId === t.conversationId) && (!input.scope.missionId || s.missionId === input.scope.missionId)))
      await tx.conversationTurn.update({ where: { id: t.id }, data: { readManifestJson: json({ ...m, coordination: { ...coord,
        state: kind === "STOP" && input.operation !== "WITHDRAW" ? "STOPPING" : "INVALIDATED", invalidatedAt: now.toISOString(),
        drainDeadline: new Date(+now + 25000).toISOString(), pendingEvents: [...(coord.pendingEvents as string[] ?? []), ...events].slice(-64) } }) } });
  }
  const missions = await tx.agentMission.findMany({ where: { ownerUserId: actor.userId, projectId: { in: projectIds },
    ...(input.scope.missionId ? { id: input.scope.missionId } : {}), status: { notIn: ["SUCCEEDED", "FAILED", "CANCELLED"] } } });
  if (!input.scope.conversationId) for (const m of missions) {
    const pause = ["RUNNING", "READY", "WAITING_APPROVAL"].includes(m.status);
    await tx.agentMissionApproval.updateMany({ where: { missionId: m.id, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "OBSOLETE" } });
    await tx.agentMissionStep.updateMany({ where: { missionId: m.id, status: { in: ["READY", "PLANNED", "RUNNING", "WAITING_APPROVAL"] } }, data: { status: "OBSOLETE" } });
    await tx.agentMission.update({ where: { id: m.id }, data: { version: { increment: 1 }, contextVersion: { increment: 1 }, planRevision: { increment: 1 },
      ...(pause ? { status: "PAUSED", pauseReason: "REVIEW_REQUIRED", executionSlot: null, leaseOwner: null, leaseUntil: null, leaseEpoch: { increment: 1 } } : {}),
      planJson: json({ ...record(m.planJson), continuityInvalidated: events, ...(pause ? { resumeStatus: "READY" } : {}) }) } });
  }
  return { admission, events, view: await effectiveContinuity(actor.userId, input.scope, tx) };
}
export async function submitDirective(actor: ConversationActor, conversationId: string, raw: unknown) {
  // Retry this database-only control transaction, never a model/tool request.
  for (let attempt = 0; ; attempt++) try { return await db.$transaction(async tx => {
    await tx.user.updateMany({ where: { id: actor.userId }, data: { continuitySeq: { increment: 0 } } });
    await assertSession(actor, tx);
    const c = await tx.conversation.findFirst({ where: { id: conversationId, ownerUserId: actor.userId } });
    if (!c) throw new AppError("CONVERSATION_NOT_FOUND", "讨论不可访问", 404);
    const input = directiveCommandSchema.parse(raw);
    if (c.scope === "PROJECT" && c.homeProjectId !== input.scope.projectId) throw new AppError("DIRECTIVE_SCOPE_CHANGED", "请切换到相应项目讨论", 409);
    return admitDirectiveInTx(actor, input, tx, { conversationId, requestId: input.commandId });
  }); } catch (error) {
    if (attempt >= 2 || !["P1008", "P2034"].includes(String((error as { code?: string }).code))) throw error;
    await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
  }
}
export async function previewDirective(actor: ConversationActor, conversationId: string, raw: unknown) {
  const input = directiveCommandSchema.parse(raw);
  await assertProject(actor, input.scope.projectId);
  const c = await db.conversation.findFirst({ where: { id: conversationId, ownerUserId: actor.userId } });
  if (!c || c.scope === "PROJECT" && c.homeProjectId !== input.scope.projectId) throw new AppError("DIRECTIVE_SCOPE_CHANGED", "请先选择对应项目", 409);
  const command = { ...input, admission: "CONFIRMED" as const, confirmed: true as const };
  return { command: { ...command, candidateHash: candidateHash(command) }, scopeLabel: "当前项目的个人工作指引", changesProjectGoal: false, grantsToolPermission: false };
}
