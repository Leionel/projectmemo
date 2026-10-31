import { assertCognitiveReadSet } from "@/lib/memory/hypothesisService";
import { assertExperienceReadSet } from "@/lib/experience/injection";
import { effectiveContinuity, assertContinuityBinding, boundDirectiveScope, assertDirectiveEffect } from "@/lib/continuity/directiveService";
import { sourceUse, assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { json, jsonHash } from "@/lib/mission/contracts";
import { sourceHash } from "@/lib/mission/repository";
import { createActionInTx } from "@/lib/repositories/agent";
import { prepareArtifactGeneration, savePreparedArtifactInTx } from "@/lib/services/artifactService";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";
import { actionCreateSchema, artifactCreateSchema } from "@/lib/validation/schemas";
import type { AgentToolConfirmInput } from "@/lib/validation/schemas";
import type { ProposedAction } from "@/lib/types";
import { CALENDAR_PROVIDER, calendarEventProposalSchema } from "@/lib/calendar/contracts";
import { isFeatureEnabled } from "@/lib/config/features";
import { calendarAccessTokenFor } from "@/lib/services/calendarConnectionService";
import { createFeishuCalendarEvent, getFeishuCalendarEvent, addFeishuCalendarAttendees, listFeishuCalendarAttendees, deleteFeishuCalendarEvent } from "@/lib/calendar/feishuWrite";

type Tx = Prisma.TransactionClient;
export type CopilotActor = { userId: string; sessionId: string };
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  cardHashes: z.array(z.object({ id: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  observedAt: z.string().datetime(),
}).strict();
export type SourceManifest = z.infer<typeof manifestSchema>;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function assertActor(tx: Tx, projectId: string, actor?: CopilotActor) {
  if (!actor) return; // Trusted in-process callers; HTTP routes always supply authenticated context.
  const session = await tx.authSession.findFirst({ where: {
    id: actor.sessionId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() },
  } });
  if (!session) throw new AppError("UNAUTHORIZED", "登录状态已失效，请重新登录", 401);
  const membership = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId: actor.userId, projectId } } });
  if (!membership) throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);
}

/** Same fields supplied by Copilot, plus full source fingerprints for its future artifact context. */
export async function readCopilotContext(tx: Tx, projectId: string, actor?: CopilotActor, ownRunId?: string) {
  await assertActor(tx, projectId, actor);
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);
  const now = new Date();
  const [cards, interventions, allActions] = await Promise.all([
    tx.knowledgeCard.findMany({ where: { projectId }, orderBy: { createdAt: "desc" },
      select: { id: true, title: true, summary: true, type: true, keywords: true } }),
    tx.agentIntervention.findMany({ where: { projectId, NOT:{dedupeKey:{startsWith:"goal:"}}, OR: [
      { status: "OPEN" }, { status: "SNOOZED", snoozedUntil: { lte: now } },
    ] }, orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "desc" }] }),
    tx.actionItem.findMany({ where: { projectId, status: { notIn: ["DONE", "CANCELLED"] } },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] }),
  ]);
  // Independent frozen proposals from the same answer may be consumed separately. Only
  // successful actions with this unforgeable server dedupe prefix are excluded from its base.
  const actions = ownRunId ? allActions.filter(action => !action.dedupeKey?.startsWith(`copilot:${ownRunId}:`)) : allActions;
  if (actor) {
    for (let i = cards.length - 1; i >= 0; i--) if ((await sourceUse(actor.userId, projectId, "card:" + cards[i].id, tx)).state !== "ALLOWED") cards.splice(i, 1);
    for (let i = interventions.length - 1; i >= 0; i--) if (interventions[i].evidenceCardId && (await sourceUse(actor.userId, projectId, "card:" + interventions[i].evidenceCardId, tx)).state !== "ALLOWED") interventions.splice(i, 1);
    for (let i = actions.length - 1; i >= 0; i--) if ((await sourceUse(actor.userId, projectId, "action:" + actions[i].id, tx)).state !== "ALLOWED") actions.splice(i, 1);
  }
  const cardHashes = [];
  for (const card of [...cards].sort((a, b) => a.id.localeCompare(b.id))) {
    const hash = await sourceHash(projectId, `card:${card.id}`, tx);
    if (!hash) throw new AppError("SOURCE_CHANGED", "项目记忆刚发生变化，请重新提问", 409);
    cardHashes.push({ id: card.id, hash });
  }
  const sourceManifest: SourceManifest = {
    schemaVersion: 1,
    contextHash: jsonHash({
      project: { id: project.id, title: project.title, description: project.description, goal: project.goal,
        deadline: project.deadline, scenario: project.scenario, archivedAt: project.archivedAt },
      cards: [...cards].sort((a, b) => a.id.localeCompare(b.id)),
      interventions: interventions.map(item => ({ id: item.id, title: item.title, content: item.content,
        status: item.status, evidenceCardId: item.evidenceCardId, isSimulated: item.isSimulated,
        severity: item.severity, snoozedUntil: item.snoozedUntil })).sort((a, b) => a.id.localeCompare(b.id)),
      actions: actions.map(item => ({ id: item.id, title: item.title, status: item.status, priority: item.priority,
        dueAt: item.dueAt, description: item.description, sourceCardId: item.sourceCardId,
        sourceInterventionId: item.sourceInterventionId, dependencyVersion: item.dependencyVersion,
        isSimulated: item.isSimulated })).sort((a, b) => a.id.localeCompare(b.id)),
    }),
    cardHashes,
    observedAt: now.toISOString(),
  };
  return { project, cards, interventions, actions, sourceManifest };
}

export async function assertCopilotSources(tx: Tx, projectId: string, manifest: SourceManifest, actor?: CopilotActor, ownRunId?: string) {
  const current = (await readCopilotContext(tx, projectId, actor, ownRunId)).sourceManifest;
  if (current.contextHash !== manifest.contextHash || jsonHash(current.cardHashes) !== jsonHash(manifest.cardHashes)) {
    throw new AppError("SOURCE_CHANGED", "项目目标或依据已变化，请重新提问并确认新建议", 409);
  }
}

function proposalPayload(proposal: Record<string, unknown>, tool: string) {
  if (tool === "create_action") return actionCreateSchema.parse({ title: proposal.title,
    description: proposal.description ?? "", priority: proposal.priority ?? 3, dueAt: proposal.dueAt ?? undefined });
  return { artifactType: artifactCreateSchema.parse({ artifactType: proposal.artifactType }).artifactType };
}
const keyOf = (tool: string, proposal: Record<string, unknown>) => tool === "create_action" ? `action:${proposal.title}` : tool === "generate_artifact" ? `artifact:${proposal.artifactType}` : `calendar:${proposal.connectionId}:${proposal.startAt}:${proposal.title}:${jsonHash({ attendees: proposal.attendees ?? [], attachments: proposal.attachments ?? [] }).slice(0, 12)}`;

async function freezeCalendarProposal(tx: Tx, projectId: string, proposal: Record<string, unknown>) {
  if (!isFeatureEnabled("CALENDAR_EVENT_WRITE_ENABLED", false)) throw new AppError("CALENDAR_WRITE_DISABLED", "外部日历写入未开启", 503);
  const input = calendarEventProposalSchema.parse({ connectionId: proposal.connectionId, title: proposal.title,
    description: proposal.description ?? "", startAt: proposal.startAt, endAt: proposal.endAt, timeZone: proposal.timeZone,
    allDay: proposal.allDay ?? false, recurrence: proposal.recurrence ?? null,
    attendees: proposal.attendees ?? [], attachments: proposal.attachments ?? [] });
  const connection = await tx.calendarConnection.findFirst({ where: { id: input.connectionId, projectId, status: "ACTIVE", revokedAt: null } });
  if (!connection) throw new AppError("CALENDAR_CONNECTION_NOT_FOUND", "日历连接不存在、已撤销或不属于当前项目", 404);
  if (!connection.scope.split(/\s+/).includes("calendar:calendar") || !connection.scope.split(/\s+/).includes("offline_access"))
    throw new AppError("CALENDAR_WRITE_SCOPE_MISSING", "该连接没有写入权限，请先重新授权", 409);
  const baseHash = jsonHash({ projectId, connectionId: connection.id, title: input.title, description: input.description, startAt: input.startAt, endAt: input.endAt,
    timeZone: input.timeZone, allDay: input.allDay, recurrence: input.recurrence, attendees: input.attendees, attachments: input.attachments });
  const operationId = "pm-cal-" + baseHash.slice(0, 32), marker = `PM-CAL-${baseHash.slice(0, 14)}`;
  const finalDescription = `${input.description}${input.description ? "\n\n" : ""}ProjectMemo 操作标记：${marker}`.slice(0, 500);
  const payload = { title: input.title, description: finalDescription, startAt: input.startAt, endAt: input.endAt, timeZone: input.timeZone, allDay: input.allDay,
    recurrence: input.recurrence, attendees: input.attendees, attachments: input.attachments };
  const start = Date.parse(input.allDay ? `${input.startAt}T00:00:00Z` : input.startAt), end = Date.parse(input.allDay ? `${input.endAt}T23:59:59Z` : input.endAt);
  return { tool: "create_calendar_event", operationId, connectionId: connection.id, payload, payloadHash: jsonHash(payload), marker,
    target: { provider: CALENDAR_PROVIDER, accountId: connection.accountId, accountEmail: connection.accountEmail, accountName: connection.accountName,
      calendarId: connection.calendarId, calendarSummary: connection.calendarSummary, calendarTimeZone: connection.calendarTimeZone,
      connectionRevision: connection.revision, authGeneration: connection.authGeneration, scope: connection.scope },
    effectQuery: { kind: "CALENDAR_EVENT_BY_ID_OR_MARKER", marker, timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() } };
}

/** Must run in the same transaction that creates its source AgentRun. */
export async function freezeCopilotProposals(tx: Tx, sourceRunId: string, proposals: ProposedAction[], manifest: SourceManifest) {
  const run = await tx.agentRun.findUniqueOrThrow({ where: { id: sourceRunId }, include: { conversation: true } });
  const trace = object(run.trace), userId = typeof trace.actorUserId === "string" ? trace.actorUserId : run.conversation?.ownerUserId;
  const projectId = typeof trace.copilotTargetProjectId === "string" ? trace.copilotTargetProjectId : run.projectId;
  if (userId && projectId) {
    const turn = run.turnId ? await tx.conversationTurn.findUnique({ where: { id: run.turnId } }) : null;
    const scoped = (object(object(turn?.readManifestJson).coordination).scopes ?? []) as Array<{ projectId: string; missionId?: string }>;
    const scope = { projectId, ...(run.conversationId ? { conversationId: run.conversationId } : {}), ...(scoped.find(s => s.projectId === projectId)?.missionId ? { missionId: scoped.find(s => s.projectId === projectId)!.missionId } : {}) };
    const view = await effectiveContinuity(userId, scope, tx);
    await tx.agentRun.update({ where: { id: sourceRunId }, data: { trace: json({ ...trace, continuity: { scope, intentHash: view.intentHash, reusePolicyHash: view.reusePolicyHash } }) } });
  }

  const seen = new Map<string, string>();
  for (const proposed of proposals) {
    const proposal = proposed as unknown as Record<string, unknown>;
    const calendar = proposed.kind === "create_calendar_event";
    if (calendar && !projectId) throw new AppError("PROJECT_NOT_FOUND", "外部写提案需要项目范围", 409);
    const key = keyOf(proposed.kind, proposal), payload = calendar ? await freezeCalendarProposal(tx, projectId!, proposal) : proposalPayload(proposal, proposed.kind);
    const proposalHash = jsonHash({ tool: proposed.kind, payload });
    if (seen.has(key)) {
      if (seen.get(key) !== proposalHash) throw new AppError("COPILOT_PROPOSAL_AMBIGUOUS", "同一建议包含冲突内容，请重新提问", 409);
      continue;
    }
    seen.set(key, proposalHash);
    await tx.copilotToolExecution.create({ data: { sourceRunId, proposalKey: key, tool: proposed.kind,
      proposalJson: json(payload), proposalHash, sourceManifestHash: jsonHash(manifest) } });
  }
}

export async function writeTransaction<T>(sourceRunId: string, callback: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        // Acquire SQLite's write slot before reading the proposal/receipt. An in-memory
        // mutex cannot provide this ordering between application processes.
        await tx.$executeRaw`UPDATE "AgentRun" SET "id" = "id" WHERE "id" = ${sourceRunId}`;
        return callback(tx);
      }, { maxWait: 5000, timeout: 15000 });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= 3 || !(code === "P1008" || code === "P2034" || /SQLITE_BUSY|database is locked/i.test(String(error)))) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

async function inspectConfirmation(tx: Tx, projectId: string, input: AgentToolConfirmInput, actor?: CopilotActor) {
  await assertActor(tx, projectId, actor);
  const run = await tx.agentRun.findFirst({ where: { id: input.sourceRunId, runType: "CHAT", OR: [
    { projectId }, ...(actor ? [{ projectId: null, conversation: { ownerUserId: actor.userId } }] : []),
  ] } });
  if (!run) throw new AppError("TRUST_RECEIPT_NOT_FOUND", "没有找到这次回答的证据回执", 404);
  const trace = object(run.trace), result = object(run.resultJson);
  if (run.projectId === null && trace.copilotTargetProjectId !== projectId)
    throw new AppError("TRUST_RECEIPT_NOT_FOUND", "没有本项目的提案回执", 404);
  if (trace.actorUserId && actor && trace.actorUserId !== actor.userId) throw new AppError("TRUST_RECEIPT_NOT_FOUND", "没有可确认的建议", 404);
  if (trace.supportState !== "SUPPORTED") throw new AppError("EVIDENCE_NOT_SUPPORTED", "证据存在冲突或不足，已阻止写操作", 409);
  const allowed = Array.isArray(result.proposedActions) ? result.proposedActions.map(object) : [];
  const proposed = allowed.find(proposal => proposal.kind === input.tool && (input.tool === "create_action"
    ? proposal.title === input.payload.title : input.tool === "create_calendar_event" ? proposal.title === input.payload.title && proposal.startAt === input.payload.startAt
    : proposal.artifactType === input.payload.artifactType));
  if (!proposed) throw new AppError("UNAPPROVED_TOOL_PROPOSAL", "这个操作不属于该证据回执中的建议", 409);
  const key = keyOf(input.tool, proposed), confirmationHash = jsonHash({ tool: input.tool, payload: input.payload });
  const execution = await tx.copilotToolExecution.findUnique({ where: { sourceRunId_proposalKey: { sourceRunId: run.id, proposalKey: key } } });
  if (execution?.status === "UNKNOWN") throw new AppError("COPILOT_RESULT_UNKNOWN", "原外部写入结果未知；请核对原结果，不会自动重发", 409);
  if (execution?.status === "FAILED") throw new AppError("COPILOT_RESULT_FAILED", "原外部写入已确定失败；不会自动重试", 409);
  if (trace.r4Draft === true) {
    if (!await tx.agentMessage.findFirst({ where: { runId: run.id, conversationId: run.conversationId, ownerUserId: actor?.userId } }))
      throw new AppError("PROPOSAL_NOT_PUBLISHED", "这项提案尚未完成发布", 409);
    if (execution?.status !== "COMMITTED") {
      if (typeof trace.proposalExpiresAt !== "string" || !Number.isFinite(Date.parse(trace.proposalExpiresAt)) || Date.parse(trace.proposalExpiresAt) <= Date.now())
        throw new AppError("PROPOSAL_EXPIRED", "这项提案已过期，请重新讨论", 409);
      if (run.conversationId && (await tx.conversation.findUnique({ where: { id: run.conversationId } }))?.activeTurnId)
        throw new AppError("CONVERSATION_BUSY", "请等本轮讨论完成后确认", 409);
    }
  }
  if (execution?.status === "DECLINED") throw new AppError("PROPOSAL_DECLINED", "这项提案已被拒绝，请重新讨论", 409);
  if (execution?.confirmationHash && execution.confirmationHash !== confirmationHash) {
    throw new AppError("CONFIRMATION_PAYLOAD_CHANGED", "该建议已使用不同内容确认，请勿更改重试载荷", 409);
  }
  const legacyReceipt = object(object(result.executedProposals)[key]);
  const resultId = execution?.status === "COMMITTED" ? execution.resultId : !execution ? legacyReceipt.resultId : null;
  if (typeof resultId === "string") {
    if (input.tool === "create_calendar_event") return { replay: { tool: input.tool, result: { id: resultId, externalId: resultId, status: "CREATED" }, alreadyExecuted: true as const },
      run, result, key, confirmationHash, execution, manifest: null };
    const old = input.tool === "create_action" ? await tx.actionItem.findFirst({ where: { id: resultId, projectId } })
      : await tx.generatedArtifact.findFirst({ where: { id: resultId, projectId } });
    if (!old) throw new AppError("COPILOT_RESULT_MISSING", "原确认结果已不可用，不能重复创建，请查看项目历史", 409);
    return { replay: { tool: input.tool, result: old, alreadyExecuted: true as const }, run, result, key, confirmationHash, execution, manifest: null };
  }
  if (actor) {
    await assertCognitiveReadSet(actor.userId, trace.cognitiveReadSet, tx);
    await assertExperienceReadSet(actor.userId, trace.experienceReadSet, tx);
    const binding = object(trace.continuity), scope = boundDirectiveScope(binding, projectId, run.conversationId ?? undefined);
    assertDirectiveEffect(await assertContinuityBinding(actor.userId, scope, binding, tx), "BUSINESS_WRITE");
    for (const c of (object(trace.copilotSources).cardHashes ?? []) as Array<{ id: string }>) await assertSourceUse(actor.userId, projectId, "card:" + c.id, tx, scope);
  }
  const parsed = manifestSchema.safeParse(trace.copilotSources);
  if (!execution || !parsed.success) throw new AppError("COPILOT_PROPOSAL_REGENERATE_REQUIRED", "这条旧建议缺少可校验的来源版本，请重新提问后确认", 409);
  if (execution.tool !== input.tool || execution.sourceManifestHash !== jsonHash(parsed.data) ||
    (input.tool !== "create_calendar_event" && execution.proposalHash !== jsonHash({ tool: input.tool, payload: proposalPayload(proposed, input.tool) }))) {
    throw new AppError("COPILOT_PROPOSAL_CHANGED", "建议或来源回执不一致，请重新提问", 409);
  }
  if (execution.proposalHash !== jsonHash({ tool: execution.tool, payload: execution.proposalJson })) throw new AppError("COPILOT_PROPOSAL_CHANGED", "建议回执哈希不一致", 409);
  if (input.tool === "create_calendar_event") {
    const frozen = object(execution.proposalJson), payload = object(frozen.payload);
    if (input.payload.title !== payload.title || input.payload.startAt !== payload.startAt || input.payload.endAt !== payload.endAt)
      throw new AppError("CONFIRMATION_PAYLOAD_CHANGED", "确认内容与冻结提案不一致", 409);
  }
  await assertCopilotSources(tx, projectId, parsed.data, actor, run.id);
  return { replay: null, run, result, key, confirmationHash, execution, manifest: parsed.data };
}

async function recordConsumption(tx: Tx, state: Awaited<ReturnType<typeof inspectConfirmation>>, tool: string, resultId: string) {
  if (!state.execution) throw new Error("Missing durable Copilot intent");
  await tx.copilotToolExecution.update({ where: { id: state.execution.id }, data: {
    status: "COMMITTED", confirmationHash: state.confirmationHash, resultId, committedAt: new Date(), leaseToken: null, leaseUntil: null,
  } });
  // Maintain the legacy read contract, now inside the same transaction as the effect.
  await tx.agentRun.update({ where: { id: state.run.id }, data: { resultJson: json({ ...state.result,
    executedProposals: { ...object(state.result.executedProposals), [state.key]: { tool, resultId, executedAt: new Date().toISOString() } },
  }) } });
}

async function confirmCopilotCalendarEvent(projectId: string, input: AgentToolConfirmInput, actor?: CopilotActor) {
  const leaseToken = randomUUID();
  const reserved = await writeTransaction(input.sourceRunId!, async tx => {
    const state = await inspectConfirmation(tx, projectId, input, actor);
    if (state.replay) return { replay: state.replay, frozen: null, connection: null };
    if (state.execution!.status === "DISPATCHING") throw new AppError("COPILOT_CONFIRMATION_IN_PROGRESS", "这条日历提案正在执行，请稍后查看原结果", 409);
    if (state.execution!.status !== "PENDING") throw new AppError("COPILOT_PROPOSAL_CHANGED", "这项日历提案已处理", 409);
    const frozen = object(state.execution!.proposalJson), connectionId = String(frozen.connectionId ?? "");
    const connection = await tx.calendarConnection.findFirst({ where: { id: connectionId, projectId, status: "ACTIVE", revokedAt: null,
      ...(actor ? { ownerUserId: actor.userId } : {}) } });
    if (!connection) throw new AppError("CALENDAR_CONNECTION_REVOKED", "日历连接已撤销或不可访问", 409);
    if (!connection.scope.split(/\s+/).includes("calendar:calendar")) throw new AppError("CALENDAR_WRITE_SCOPE_MISSING", "连接没有写入权限", 409);
    const target = object(frozen.target);
    if (connection.authGeneration !== target.authGeneration || connection.revision !== target.connectionRevision || connection.calendarId !== target.calendarId)
      throw new AppError("CALENDAR_CONNECTION_CHANGED", "日历连接或资源已变化，请重新预览", 409);
    await tx.copilotToolExecution.update({ where: { id: state.execution!.id }, data: { status: "DISPATCHING", confirmationHash: state.confirmationHash,
      leaseToken, leaseUntil: new Date(Date.now() + 120000) } });
    return { replay: null, frozen, connection };
  });
  if (reserved.replay) return reserved.replay;
  const frozen = object(reserved.frozen), payload = object(frozen.payload) as { title: string; description: string; startAt: string; endAt: string; timeZone: string;
    allDay: boolean; recurrence: string | null; attendees: Array<{ type: "open_id"; openId: string } | { type: "email"; email: string }>; attachments: string[] };
  const target = object(frozen.target) as { calendarId: string; calendarTimeZone: string };
  const marker = String(frozen.marker ?? "");
  let externalId: string | null = null, access = "";
  let outcome: { ok: boolean; known: boolean; code?: string; message?: string; readback?: unknown; compensation?: { eventId: string; deleted: boolean } };
  const compensate = async (accessToken: string, eventId: string) => {
    try { await deleteFeishuCalendarEvent({ accessToken, calendarId: target.calendarId, eventId, needNotification: false }, fetch); return true; }
    catch { return false; }
  };
  try {
    const create = async (accessToken: string) => createFeishuCalendarEvent({ accessToken, calendarId: target.calendarId, title: payload.title,
      description: payload.description, startAt: payload.startAt, endAt: payload.endAt, timeZone: payload.timeZone, allDay: payload.allDay,
      recurrence: payload.recurrence, attachments: payload.attachments, idempotencyKey: String(frozen.operationId) }, fetch);
    let created;
    access = await calendarAccessTokenFor(reserved.connection, fetch);
    try { created = await create(access); }
    catch (error) {
      if (!(error instanceof AppError) || error.code !== "CALENDAR_TOKEN_EXPIRED") throw error;
      access = await calendarAccessTokenFor(reserved.connection, fetch, true);
      created = await create(access);
    }
    externalId = created.eventId;
    if (payload.attendees.length) {
      try { await addFeishuCalendarAttendees({ accessToken: access, calendarId: target.calendarId, eventId: created.eventId, attendees: payload.attendees, needNotification: false }, fetch); }
      catch { /* verification below decides */ }
    }
    const readback = await getFeishuCalendarEvent({ accessToken: access, calendarId: target.calendarId, eventId: created.eventId, timeZone: payload.timeZone }, fetch);
    const timeOk = payload.allDay ? readback.allDay && readback.startDate === payload.startAt && readback.endDate === payload.endAt
      : !!readback.startAt && !!readback.endAt && Math.abs(Date.parse(readback.startAt) - Date.parse(payload.startAt)) <= 1000 && Math.abs(Date.parse(readback.endAt) - Date.parse(payload.endAt)) <= 1000;
    const recurrenceOk = !payload.recurrence || readback.recurrence === payload.recurrence;
    const actualAttachments = readback.attachments ?? [], expectedAttachments = payload.attachments;
    const attachmentsOk = actualAttachments.length === expectedAttachments.length && expectedAttachments.every(token => actualAttachments.includes(token));
    if (readback.eventId !== created.eventId || readback.title !== payload.title || !readback.description.includes(marker) || !timeOk || !recurrenceOk || !attachmentsOk)
      outcome = { ok: false, known: false, code: "CALENDAR_EFFECT_MISMATCH", message: "provider 返回对象与冻结 payload 不匹配" };
    else if (payload.attendees.length) {
      const actual = await listFeishuCalendarAttendees({ accessToken: access, calendarId: target.calendarId, eventId: created.eventId }, fetch);
      const attendeesOk = payload.attendees.every(item => item.type === "open_id"
        ? actual.some(row => row.type === "user" && row.userId === item.openId) : actual.some(row => row.email === item.email));
      if (!attendeesOk) {
        const deleted = await compensate(access, created.eventId);
        outcome = { ok: false, known: deleted, code: "CALENDAR_ATTENDEE_MISMATCH", message: deleted ? "参与人与冻结提案不一致，已删除本次创建的日程" : "参与人不一致，补偿删除未获确认",
          compensation: { eventId: created.eventId, deleted } };
      } else outcome = { ok: true, known: true, readback };
    } else outcome = { ok: true, known: true, readback };
  } catch (error) {
    if (externalId && access && error instanceof AppError && ["CALENDAR_WRITE_REJECTED", "CALENDAR_ATTENDEE_UNKNOWN"].includes(error.code)) {
      const deleted = await compensate(access, externalId);
      outcome = { ok: false, known: deleted, code: error.code, message: deleted ? `${error.message}；已删除本次创建的日程` : `${error.message}；补偿删除未获确认`,
        compensation: { eventId: externalId, deleted } };
    } else if (error instanceof AppError && ["CALENDAR_WRITE_REJECTED", "CALENDAR_WRITE_SCOPE_MISSING", "CALENDAR_CONNECTION_REVOKED", "CALENDAR_CONNECTION_CHANGED"].includes(error.code))
      outcome = { ok: false, known: true, code: error.code, message: error.message };
    else outcome = { ok: false, known: false, code: error instanceof AppError ? error.code : "CALENDAR_WRITE_UNKNOWN",
      message: error instanceof AppError ? error.message : "外部日历写入结果未知，不会自动重发" };
  }
  const finalized = await writeTransaction(input.sourceRunId!, async tx => {
    const state = await inspectConfirmation(tx, projectId, input, actor);
    if (state.replay && outcome.ok) return { failed: false as const, value: state.replay };
    if (state.execution!.leaseToken !== leaseToken || state.execution!.status !== "DISPATCHING")
      throw new AppError("COPILOT_CONFIRMATION_CHANGED", "日历写入许可已过期或被接续", 409);
    if (outcome.ok) {
      const result = { id: externalId!, externalId, calendarId: target.calendarId, status: "CREATED", readback: outcome.readback };
      await recordConsumption(tx, state, input.tool, externalId!);
      await tx.agentRun.update({ where: { id: state.run.id }, data: { resultJson: json({ ...state.result,
        executedProposals: { ...object(state.result.executedProposals), [state.key]: { tool: input.tool, resultId: externalId, result } } }) } });
      return { failed: false as const, value: { tool: input.tool, result, alreadyExecuted: false } };
    }
    await tx.copilotToolExecution.update({ where: { id: state.execution!.id }, data: { status: outcome.known ? "FAILED" : "UNKNOWN",
      resultId: externalId, leaseToken: null, leaseUntil: null } });
    if (outcome.compensation) await tx.agentRun.update({ where: { id: state.run.id }, data: { resultJson: json({ ...state.result,
      compensation: outcome.compensation }) } });
    return { failed: true as const, code: outcome.code ?? "CALENDAR_WRITE_UNKNOWN", message: outcome.message ?? "外部日历写入未成功", known: outcome.known };
  });
  if (finalized.failed) throw new AppError(finalized.code, finalized.message, finalized.known ? 409 : 503);
  return finalized.value;
}

export async function confirmCopilotTool(projectId: string, input: AgentToolConfirmInput, actor?: CopilotActor) {
  if (!input.confirmed) throw new AppError("CONFIRMATION_REQUIRED", "写操作需要你确认后才能执行", 400);
  if (!input.sourceRunId) throw new AppError("TRUST_RECEIPT_REQUIRED", "缺少证据回执，请重新提问后确认", 409);
  const sourceRunId = input.sourceRunId;
  if (input.tool === "create_calendar_event") return confirmCopilotCalendarEvent(projectId, input, actor);
  if (input.tool === "create_action") {
    const outcome = await writeTransaction(sourceRunId, tx => confirmCopilotActionInTx(tx, projectId, input, actor));
    const stateRefreshPending = await refreshProjectStateAfterMutation(projectId);
    return { ...outcome, result: { ...outcome.result, stateRefreshPending } };
  }
  const leaseToken = randomUUID();
  const reserved = await writeTransaction(sourceRunId, async tx => {
    const state = await inspectConfirmation(tx, projectId, input, actor);
    if (state.replay) return { replay: state.replay, artifactType: null };
    if (state.execution!.status === "PREPARING" && state.execution!.leaseUntil && state.execution!.leaseUntil > new Date()) {
      throw new AppError("COPILOT_CONFIRMATION_IN_PROGRESS", "这条建议正在生成，请稍后重试查看同一结果", 409);
    }
    const artifactType = artifactCreateSchema.parse(state.execution!.proposalJson).artifactType;
    await tx.copilotToolExecution.update({ where: { id: state.execution!.id }, data: {
      status: "PREPARING", confirmationHash: state.confirmationHash, leaseToken, leaseUntil: new Date(Date.now() + 120000),
    } });
    return { replay: null, artifactType };
  });
  if (reserved.replay) return reserved.replay;
  try {
    const prepared = await prepareArtifactGeneration(projectId, reserved.artifactType!, { userId: actor?.userId });
    return await writeTransaction(sourceRunId, async tx => {
      const state = await inspectConfirmation(tx, projectId, input, actor);
      if (state.replay) return state.replay;
      if (state.execution!.leaseToken !== leaseToken || state.execution!.status !== "PREPARING" || !state.execution!.leaseUntil || state.execution!.leaseUntil <= new Date()) {
        throw new AppError("COPILOT_CONFIRMATION_CHANGED", "生成许可已过期或被接续，请刷新后重试", 409);
      }
      const artifact = await savePreparedArtifactInTx(tx, prepared);
      await recordConsumption(tx, state, input.tool, artifact.id);
      return { tool: input.tool, result: artifact, alreadyExecuted: false };
    });
  } catch (error) {
    await db.copilotToolExecution.updateMany({ where: { sourceRunId, status: "PREPARING", leaseToken },
      data: { status: "PENDING", leaseToken: null, leaseUntil: null } }).catch(() => {});
    throw error;
  }
}

/** Shared atomic action path for project Copilot and the private conversation. */
export async function confirmCopilotActionInTx(tx: Tx, projectId: string, input: AgentToolConfirmInput, actor?: CopilotActor) {
  if (input.tool !== "create_action" || !input.confirmed || !input.sourceRunId)
    throw new AppError("CONFIRMATION_REQUIRED", "创建行动需要明确确认", 400);
  const state = await inspectConfirmation(tx, projectId, input, actor);
  if (state.replay) return { tool: "create_action" as const, result: state.replay.result as Awaited<ReturnType<typeof createActionInTx>>, alreadyExecuted: true as const };
  const payload = actionCreateSchema.parse(state.execution!.proposalJson);
  const action = await createActionInTx(tx, projectId, payload, `copilot:${input.sourceRunId}:${state.execution!.id}`);
  await recordConsumption(tx, state, input.tool, action.id);
  return { tool: "create_action" as const, result: action, alreadyExecuted: false as const };
}
