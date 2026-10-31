import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { record } from "@/lib/conversation/repository";
import { assertCognitiveReadSet } from "@/lib/memory/hypothesisService";
import { assertExperienceReadSet } from "@/lib/experience/injection";
import { assertDirectiveEffect, effectiveContinuity } from "@/lib/continuity/directiveService";
import { assertAutomaticTool } from "./automaticPolicy";
import { event, validateSources } from "./repository";
import { json, jsonHash, usageOf, defaultBudget, type Source as MissionSource } from "./contracts";
import { fenced, release, type Lease } from "./runtimeStore";
import { calendarAccessTokenFor } from "@/lib/services/calendarConnectionService";
import { addFeishuCalendarAttendees, createFeishuCalendarEvent, deleteFeishuCalendarEvent, getFeishuCalendarEvent, listFeishuCalendarAttendees } from "@/lib/calendar/feishuWrite";
import { readFeishuEvents } from "@/lib/calendar/feishuCalendar";
import type { CalendarFetch } from "@/lib/calendar/feishuOAuth";
import type { CalendarAttendee } from "@/lib/calendar/contracts";

type Target = { provider: string; accountId: string; accountEmail: string; accountName: string; calendarId: string; calendarSummary: string;
  calendarTimeZone: string; connectionRevision: number; authGeneration: number; scope: string };
type Payload = { title: string; description: string; startAt: string; endAt: string; timeZone: string; allDay: boolean; recurrence: string | null;
  attendees: CalendarAttendee[]; attachments: string[] };
type Proposal = { tool: "create_calendar_event"; toolVersion: "1"; operationId: string; args: Payload & { connectionId: string }; payload: Payload; payloadHash: string;
  target: Target; marker: string; effectQuery: { kind: string; marker: string; timeMin: string; timeMax: string }; readSet: MissionSource[]; expiresAt: string;
  ownerUserId: string; projectId: string; planRevision: number };
type ExternalEffect = { phase: string; operationId: string; marker: string; payloadHash: string; externalId: string | null; externalUrl: string | null; target: Target; payload: Payload };
type Outcome = { ok: true; eventId: string; readback: unknown } | { ok: false; known: boolean; code: string; message: string; compensation?: { eventId: string; deleted: boolean } };
type BatchItem = { index: number; operationId: string; itemHash: string; marker: string; payload: Payload; payloadHash: string;
  effectQuery: { kind: string; marker: string; timeMin: string; timeMax: string } };
type BatchProposal = { tool: "create_calendar_events"; toolVersion: "1"; operationId: string; batchHash: string; args: { connectionId: string; events: Payload[] };
  target: Target; events: BatchItem[]; readSet: MissionSource[]; expiresAt: string; ownerUserId: string; projectId: string; planRevision: number };
type BatchEffectItem = { index: number; operationId: string; marker: string; payloadHash: string; externalId: string | null; payload: Payload };
type BatchEffect = { phase: string; operationId: string; target: Target; items: BatchEffectItem[] };
type BatchOutcome = { ok: true; events: Array<{ index: number; eventId: string }>; readback: unknown }
  | { ok: false; known: boolean; code: string; message: string; compensation?: { deleted: string[]; remaining: string[] } };

function proposalOf(value: unknown): Proposal {
  const proposal = value as Partial<Proposal>;
  if (proposal.tool !== "create_calendar_event" || !proposal.payload || !proposal.target || !proposal.marker || !proposal.effectQuery)
    throw new AppError("APPROVAL_CHANGED", "日历提案格式无效", 409);
  return proposal as Proposal;
}
function matches(eventId: string, payload: Payload, marker: string, readback: { eventId: string; title: string; startAt: string | null; endAt: string | null; description: string;
  allDay: boolean; startDate: string | null; endDate: string | null; recurrence: string | null; attachments?: string[] }) {
  if (readback.eventId !== eventId) return "IDENTITY_MISMATCH";
  if (readback.title !== payload.title) return "CONTENT_MISMATCH";
  if (!readback.description.includes(marker)) return "MARKER_MISSING";
  if (payload.allDay) {
    if (!readback.allDay || readback.startDate !== payload.startAt || readback.endDate !== payload.endAt) return "TIME_MISMATCH";
  } else {
    const expectedStart = Date.parse(payload.startAt), expectedEnd = Date.parse(payload.endAt);
    if (!readback.startAt || !readback.endAt || Math.abs(Date.parse(readback.startAt) - expectedStart) > 1000 || Math.abs(Date.parse(readback.endAt) - expectedEnd) > 1000) return "TIME_MISMATCH";
  }
  if (payload.recurrence && readback.recurrence !== payload.recurrence) return "RECURRENCE_MISMATCH";
  const actual = [...(readback.attachments ?? [])].sort(), expected = [...payload.attachments].sort();
  if (actual.length !== expected.length || actual.some((token, index) => token !== expected[index])) return "ATTACHMENT_MISMATCH";
  return null;
}
function attendeeMatches(attendees: CalendarAttendee[], actual: Array<{ type: string; userId: string | null; email: string | null }>) {
  return attendees.every(item => item.type === "open_id"
    ? actual.some(row => row.type === "user" && row.userId === item.openId)
    : actual.some(row => row.email === item.email));
}
async function compensate(accessToken: string, calendarId: string, eventId: string, cause: { code: string; message: string }, fetcher: CalendarFetch): Promise<Outcome> {
  try {
    const deleted = await deleteFeishuCalendarEvent({ accessToken, calendarId, eventId, needNotification: false }, fetcher);
    return { ok: false, known: true, code: cause.code, message: `${cause.message}；已删除本次创建的日程`, compensation: { eventId, deleted: deleted.deleted } };
  } catch {
    return { ok: false, known: false, code: "CALENDAR_COMPENSATION_FAILED", message: `${cause.message}；补偿删除未获确认，可能仍存在日程 ${eventId}`,
      compensation: { eventId, deleted: false } };
  }
}
async function readbackTarget(connection: { id: string; projectId: string; ownerUserId: string } & Parameters<typeof calendarAccessTokenFor>[0],
  target: { calendarId: string; calendarTimeZone: string }, payload: Pick<Payload, "timeZone" | "title">, marker: string,
  window: { timeMin: string; timeMax: string }, externalId: string | null, fetcher: CalendarFetch) {
  const access = await calendarAccessTokenFor(connection, fetcher);
  if (externalId) {
    const result = await getFeishuCalendarEvent({ accessToken: access, calendarId: target.calendarId, eventId: externalId, timeZone: payload.timeZone }, fetcher);
    return { eventId: result.eventId, title: result.title, startAt: result.startAt, endAt: result.endAt, description: result.description,
      allDay: result.allDay, startDate: result.startDate, endDate: result.endDate, recurrence: result.recurrence, attachments: result.attachments ?? [] };
  }
  const page = await readFeishuEvents({ accessToken: access, calendarId: target.calendarId, timeMin: window.timeMin, timeMax: window.timeMax,
    maxResults: 50, calendarTimeZone: target.calendarTimeZone }, fetcher);
  const found = page.events.find(item => item.description.includes(marker) && item.title === payload.title);
  if (!found) throw new AppError("CALENDAR_EFFECT_NOT_FOUND", "本次标记的日程尚未找到；最终一致性延迟不能证明未写入", 404);
  return { eventId: found.eventId, title: found.title, startAt: found.startAt, endAt: found.endAt, description: found.description,
    allDay: found.allDay, startDate: found.startDate, endDate: found.endDate, recurrence: found.recurrence, attachments: found.attachments ?? [] };
}
async function readback(connection: { id: string; projectId: string; ownerUserId: string } & Parameters<typeof calendarAccessTokenFor>[0], proposal: Proposal, externalId: string | null, fetcher: CalendarFetch) {
  return readbackTarget(connection, proposal.target, proposal.payload, proposal.marker, proposal.effectQuery, externalId, fetcher);
}
async function finalize(lease: Lease, stepId: string, outcome: Outcome) {
  return db.$transaction(async tx => {
    const m = await fenced(tx, lease); const step = await tx.agentMissionStep.findFirstOrThrow({ where: { id: stepId, missionId: m.id } });
    const approval = await tx.agentMissionApproval.findUniqueOrThrow({ where: { stepId } });
    if (step.status === "SUCCEEDED" && approval.status === "CONSUMED") return step.resultJson;
    if (outcome.ok) {
      const result = { data: { externalId: outcome.eventId, calendarId: proposalOf(approval.proposalJson).target.calendarId, marker: proposalOf(approval.proposalJson).marker,
        status: "CREATED", readback: outcome.readback }, sources: [] };
      await tx.agentMissionApproval.update({ where: { id: approval.id }, data: { status: "CONSUMED", consumedAt: new Date() } });
      await tx.agentMissionStep.update({ where: { id: stepId }, data: { status: "SUCCEEDED", resultJson: json(result), finishedAt: new Date(),
        verificationJson: json({ created: true, externalId: outcome.eventId, readback: true, provider: "FEISHU_CALENDAR" }) } });
      await event(tx, m.id, "CALENDAR_EVENT_CREATED", { externalId: outcome.eventId, calendarId: proposalOf(approval.proposalJson).target.calendarId, readback: true });
      await tx.agentMission.update({ where: { id: m.id }, data: { lastErrorJson: json(null) } });
      await release(tx, m, "READY");
      return result;
    }
    const failure = { code: outcome.code, message: outcome.message, ...(outcome.compensation ? { compensation: outcome.compensation } : {}) };
    await tx.agentMissionStep.update({ where: { id: stepId }, data: { status: outcome.known ? "FAILED" : "UNKNOWN", failureJson: json(failure),
      resultJson: json({ data: { status: outcome.known ? "FAILED" : "UNKNOWN", code: outcome.code, message: outcome.message, marker: proposalOf(approval.proposalJson).marker,
        ...(outcome.compensation ? { compensation: outcome.compensation } : {}) } }),
      finishedAt: outcome.known ? new Date() : null,
      protocolJson: json({ ...record(step.protocolJson), externalEffect: { ...record(record(step.protocolJson).externalEffect), phase: outcome.known ? "FAILED" : "UNKNOWN" } }) } });
    if (outcome.known) await tx.agentMissionApproval.update({ where: { id: approval.id }, data: { status: "EXPIRED" } });
    await event(tx, m.id, outcome.known ? "CALENDAR_EVENT_FAILED" : "CALENDAR_EVENT_UNKNOWN", failure);
    await tx.agentMission.update({ where: { id: m.id }, data: { lastErrorJson: json({ code: outcome.code, message: outcome.message, phase: "APPROVAL" }) } });
    await release(tx, m, "PAUSED", outcome.code);
    return { data: { status: outcome.known ? "FAILED" : "UNKNOWN", code: outcome.code, message: outcome.message, ...(outcome.compensation ? { compensation: outcome.compensation } : {}) } };
  });
}

export async function commitApprovedCalendarEvent(lease: Lease, stepId: string, fetcher: CalendarFetch = fetch) {
  if (!isFeatureEnabled("CALENDAR_EVENT_WRITE_ENABLED", false)) throw new AppError("CALENDAR_WRITE_DISABLED", "外部日历写入未开启，提案已保留", 503);
  const prep = await db.$transaction(async tx => {
    const m = await fenced(tx, lease);
    const step = await tx.agentMissionStep.findFirst({ where: { id: stepId, missionId: m.id } });
    const approval = await tx.agentMissionApproval.findUnique({ where: { stepId } });
    if (!step || !approval || step.toolName !== "propose_calendar_event") throw new AppError("APPROVAL_CHANGED", "日历批准不存在", 409);
    if (step.status === "SUCCEEDED" && approval.status === "CONSUMED") return { done: true as const, result: step.resultJson };
    const proposal = proposalOf(approval.proposalJson);
    if (approval.status === "DISPATCHING" || step.status === "UNKNOWN" || step.status === "RUNNING" && record(record(step.protocolJson).externalEffect).phase === "SUBMITTING")
      return { reconcile: true as const, proposal, externalEffect: record(record(step.protocolJson).externalEffect) as Partial<ExternalEffect> };
    if (approval.status !== "APPROVED" || step.status !== "READY") throw new AppError("APPROVAL_CHANGED", "批准已失效或已消费", 409);
    if (approval.proposalHash !== jsonHash(approval.proposalJson)) throw new AppError("APPROVAL_CHANGED", "提案内容与批准哈希不一致", 409);
    if (approval.expectedPlanRevision !== m.planRevision || approval.expiresAt <= new Date()) throw new AppError("APPROVAL_CHANGED", "批准已过期或计划已变化", 409);
    assertAutomaticTool(m, "create_calendar_event", true);
    assertDirectiveEffect(await effectiveContinuity(m.ownerUserId, { projectId: m.projectId, missionId: m.id }, tx), "BUSINESS_WRITE");
    await assertCognitiveReadSet(m.ownerUserId, record(step.protocolJson).cognitiveReadSet, tx);
    await assertExperienceReadSet(m.ownerUserId, record(step.protocolJson).experienceReadSet, tx);
    await validateSources(m.projectId, approval.readSetJson as unknown as MissionSource[], tx, m.id);
    const connection = await tx.calendarConnection.findFirst({ where: { id: proposal.args.connectionId, projectId: m.projectId, ownerUserId: m.ownerUserId, status: "ACTIVE", revokedAt: null } });
    if (!connection) throw new AppError("CALENDAR_CONNECTION_REVOKED", "日历连接已撤销，禁止新派发", 409);
    if (connection.authGeneration !== proposal.target.authGeneration || connection.revision !== proposal.target.connectionRevision || connection.calendarId !== proposal.target.calendarId)
      throw new AppError("CALENDAR_CONNECTION_CHANGED", "日历连接或资源已变化，请重新预览", 409);
    if (!connection.scope.split(/\s+/).includes("calendar:calendar")) throw new AppError("CALENDAR_WRITE_SCOPE_MISSING", "连接没有写入权限", 409);
    if (proposal.payloadHash !== jsonHash(proposal.payload)) throw new AppError("APPROVAL_CHANGED", "payload hash 不一致", 409);
    const used = usageOf(m.budgetUsedJson), limits = { ...defaultBudget, ...(m.budgetJson as object) };
    if (used.externalWrites + 1 > limits.externalWrites) throw new AppError("EXTERNAL_WRITE_BUDGET_EXHAUSTED", "外部写入预算已用完", 409);
    used.externalWrites += 1;
    await tx.agentMission.update({ where: { id: m.id }, data: { budgetUsedJson: json(used) } });
    const effect: ExternalEffect = { phase: "SUBMITTING", operationId: step.effectKey ?? `mission:${m.id}:step:${step.id}`, marker: proposal.marker,
      payloadHash: proposal.payloadHash, externalId: null, externalUrl: null, target: proposal.target, payload: proposal.payload };
    const claimed = await tx.agentMissionApproval.updateMany({ where: { id: approval.id, status: "APPROVED" }, data: { status: "DISPATCHING" } });
    if (!claimed.count) throw new AppError("APPROVAL_CHANGED", "批准已被其他执行占用", 409);
    await tx.agentMissionStep.update({ where: { id: stepId }, data: { status: "RUNNING", startedAt: new Date(),
      protocolJson: json({ ...record(step.protocolJson), externalEffect: effect }) } });
    return { dispatch: true as const, proposal, connection, effect };
  });
  if (prep.done) return prep.result;
  if (prep.reconcile) {
    if (!prep.proposal.target.scope.split(/\s+/).includes("calendar:calendar")) return finalize(lease, stepId, { ok: false, known: false, code: "CALENDAR_WRITE_SCOPE_MISSING", message: "连接已无写入权限，无法继续核对" });
    const connection = await db.calendarConnection.findFirst({ where: { id: prep.proposal.args.connectionId, projectId: prep.proposal.projectId, ownerUserId: prep.proposal.ownerUserId } });
    if (!connection) return finalize(lease, stepId, { ok: false, known: false, code: "CALENDAR_CONNECTION_REVOKED", message: "日历连接已撤销，结果保持待核对" });
    try {
      const verified = await readback(connection as never, prep.proposal, prep.externalEffect?.externalId ?? null, fetcher);
      const mismatch = matches(verified.eventId, prep.proposal.payload, prep.proposal.marker, verified);
      if (mismatch) return finalize(lease, stepId, { ok: false, known: false, code: "CALENDAR_EFFECT_MISMATCH", message: "原日程存在但内容/身份不匹配" });
      if (prep.proposal.payload.attendees.length) {
        let actual;
        try {
          const access = await calendarAccessTokenFor(connection as never, fetcher);
          actual = await listFeishuCalendarAttendees({ accessToken: access, calendarId: prep.proposal.target.calendarId, eventId: verified.eventId }, fetcher);
        } catch {
          return finalize(lease, stepId, { ok: false, known: false, code: "CALENDAR_ATTENDEE_UNKNOWN", message: "原日程存在，但参与人状态无法核对" });
        }
        if (!attendeeMatches(prep.proposal.payload.attendees, actual))
          return finalize(lease, stepId, { ok: false, known: false, code: "CALENDAR_ATTENDEE_MISMATCH", message: "原日程存在，但参与人与冻结提案不一致" });
      }
      return finalize(lease, stepId, { ok: true, eventId: verified.eventId, readback: verified });
    } catch (error) {
      return finalize(lease, stepId, { ok: false, known: false, code: error instanceof AppError ? error.code : "CALENDAR_EFFECT_UNKNOWN", message: "无法证明本次写入是否生效，保持待核对" });
    }
  }
  const { proposal, connection } = prep as { dispatch: true; proposal: Proposal; connection: Parameters<typeof calendarAccessTokenFor>[0]; effect: ExternalEffect };
  let unknown: Outcome | null = null, access = "", externalId: string | null = null;
  try {
    access = await calendarAccessTokenFor(connection, fetcher);
    const create = (token: string) => createFeishuCalendarEvent({ accessToken: token, calendarId: proposal.target.calendarId, title: proposal.payload.title,
      description: proposal.payload.description, startAt: proposal.payload.startAt, endAt: proposal.payload.endAt, timeZone: proposal.payload.timeZone,
      allDay: proposal.payload.allDay, recurrence: proposal.payload.recurrence, attachments: proposal.payload.attachments, idempotencyKey: proposal.operationId }, fetcher);
    let created;
    try { created = await create(access); }
    catch (error) {
      if (!(error instanceof AppError) || error.code !== "CALENDAR_TOKEN_EXPIRED") throw error;
      access = await calendarAccessTokenFor(connection, fetcher, true);
      created = await create(access);
    }
    externalId = created.eventId;
    await db.$transaction(async tx => {
      const current = await tx.agentMissionStep.findUniqueOrThrow({ where: { id: stepId } });
      await tx.agentMissionStep.update({ where: { id: stepId }, data: { protocolJson: json({ ...record(current.protocolJson),
        externalEffect: { ...record(record(current.protocolJson).externalEffect), externalId: created.eventId, phase: "SUBMITTED" } }) } });
    });
    if (proposal.payload.attendees.length) {
      // A lost response may still have applied; verification below decides.
      try { await addFeishuCalendarAttendees({ accessToken: access, calendarId: proposal.target.calendarId, eventId: created.eventId,
        attendees: proposal.payload.attendees, needNotification: false }, fetcher); } catch { /* verified below */ }
    }
    const verified = await readback(connection, proposal, created.eventId, fetcher);
    const mismatch = matches(verified.eventId, proposal.payload, proposal.marker, verified);
    if (mismatch) unknown = { ok: false, known: false, code: "CALENDAR_EFFECT_MISMATCH", message: "provider 返回对象与冻结 payload 不匹配，保持待核对" };
    else if (proposal.payload.attendees.length) {
      const actual = await listFeishuCalendarAttendees({ accessToken: access, calendarId: proposal.target.calendarId, eventId: created.eventId }, fetcher);
      if (!attendeeMatches(proposal.payload.attendees, actual))
        return finalize(lease, stepId, await compensate(access, proposal.target.calendarId, created.eventId,
          { code: "CALENDAR_ATTENDEE_MISMATCH", message: "参与人与冻结提案不一致" }, fetcher));
    }
    if (!unknown) return finalize(lease, stepId, { ok: true, eventId: verified.eventId, readback: verified });
  } catch (error) {
    if (externalId && access && error instanceof AppError && ["CALENDAR_WRITE_REJECTED", "CALENDAR_WRITE_SCOPE_MISSING", "CALENDAR_ATTENDEE_UNKNOWN"].includes(error.code))
      return finalize(lease, stepId, await compensate(access, proposal.target.calendarId, externalId, { code: error.code, message: error.message }, fetcher));
    if (error instanceof AppError && ["CALENDAR_WRITE_REJECTED", "CALENDAR_WRITE_SCOPE_MISSING", "CALENDAR_CONNECTION_REVOKED", "CALENDAR_CONNECTION_CHANGED"].includes(error.code))
      return finalize(lease, stepId, { ok: false, known: true, code: error.code, message: error.message });
    unknown = { ok: false, known: false, code: error instanceof AppError ? error.code : "CALENDAR_WRITE_UNKNOWN", message: error instanceof AppError ? error.message : "写入请求结果未知" };
  }
  if (unknown) return finalize(lease, stepId, unknown);
  throw new AppError("CALENDAR_WRITE_UNKNOWN", "写入结果未知", 503);
}

function batchProposalOf(value: unknown): BatchProposal {
  const proposal = value as Partial<BatchProposal>;
  if (proposal.tool !== "create_calendar_events" || !proposal.target || !proposal.operationId || !Array.isArray(proposal.events) || proposal.events.length < 2)
    throw new AppError("APPROVAL_CHANGED", "批量日历提案格式无效", 409);
  return proposal as BatchProposal;
}
async function compensateBatch(accessToken: string, calendarId: string, eventIds: string[], cause: { code: string; message: string }, fetcher: CalendarFetch): Promise<Extract<BatchOutcome, { ok: false }>> {
  const deleted: string[] = [], remaining: string[] = [];
  for (const eventId of [...new Set(eventIds)]) {
    try { await deleteFeishuCalendarEvent({ accessToken, calendarId, eventId, needNotification: false }, fetcher); deleted.push(eventId); }
    catch { remaining.push(eventId); }
  }
  const known = remaining.length === 0;
  return { ok: false, known, code: known ? cause.code : "CALENDAR_COMPENSATION_FAILED",
    message: known ? `${cause.message}；本批次已创建的日程已删除` : `${cause.message}；仍有 ${remaining.length} 个日程未确认删除`,
    compensation: { deleted, remaining } };
}
async function finalizeBatch(lease: Lease, stepId: string, outcome: BatchOutcome) {
  return db.$transaction(async tx => {
    const m = await fenced(tx, lease); const step = await tx.agentMissionStep.findFirstOrThrow({ where: { id: stepId, missionId: m.id } });
    const approval = await tx.agentMissionApproval.findUniqueOrThrow({ where: { stepId } });
    if (step.status === "SUCCEEDED" && approval.status === "CONSUMED") return step.resultJson;
    const proposal = batchProposalOf(approval.proposalJson);
    if (outcome.ok) {
      const result = { data: { status: "CREATED", calendarId: proposal.target.calendarId, operationId: proposal.operationId,
        events: outcome.events.map(item => ({ index: item.index, externalId: item.eventId, marker: proposal.events[item.index]?.marker ?? null })),
        readback: outcome.readback }, sources: [] };
      await tx.agentMissionApproval.update({ where: { id: approval.id }, data: { status: "CONSUMED", consumedAt: new Date() } });
      await tx.agentMissionStep.update({ where: { id: stepId }, data: { status: "SUCCEEDED", resultJson: json(result), finishedAt: new Date(),
        verificationJson: json({ created: outcome.events.length, readback: true, provider: "FEISHU_CALENDAR", batch: true }) } });
      await event(tx, m.id, "CALENDAR_EVENTS_CREATED", { count: outcome.events.length, calendarId: proposal.target.calendarId, operationId: proposal.operationId });
      await tx.agentMission.update({ where: { id: m.id }, data: { lastErrorJson: json(null) } });
      await release(tx, m, "READY");
      return result;
    }
    const failure = { code: outcome.code, message: outcome.message, ...(outcome.compensation ? { compensation: outcome.compensation } : {}) };
    await tx.agentMissionStep.update({ where: { id: stepId }, data: { status: outcome.known ? "FAILED" : "UNKNOWN", failureJson: json(failure),
      resultJson: json({ data: { status: outcome.known ? "FAILED" : "UNKNOWN", code: outcome.code, message: outcome.message, marker: proposal.operationId,
        ...(outcome.compensation ? { compensation: outcome.compensation } : {}) } }),
      finishedAt: outcome.known ? new Date() : null,
      protocolJson: json({ ...record(step.protocolJson), externalEffect: { ...record(record(step.protocolJson).externalEffect), phase: outcome.known ? "FAILED" : "UNKNOWN" } }) } });
    if (outcome.known) await tx.agentMissionApproval.update({ where: { id: approval.id }, data: { status: "EXPIRED" } });
    await event(tx, m.id, outcome.known ? "CALENDAR_EVENTS_FAILED" : "CALENDAR_EVENTS_UNKNOWN", failure);
    await tx.agentMission.update({ where: { id: m.id }, data: { lastErrorJson: json({ code: outcome.code, message: outcome.message, phase: "APPROVAL" }) } });
    await release(tx, m, "PAUSED", outcome.code);
    return { data: { status: outcome.known ? "FAILED" : "UNKNOWN", code: outcome.code, message: outcome.message, ...(outcome.compensation ? { compensation: outcome.compensation } : {}) } };
  });
}

export async function commitApprovedCalendarEvents(lease: Lease, stepId: string, fetcher: CalendarFetch = fetch) {
  if (!isFeatureEnabled("CALENDAR_EVENT_WRITE_ENABLED", false)) throw new AppError("CALENDAR_WRITE_DISABLED", "外部日历写入未开启，提案已保留", 503);
  const prep = await db.$transaction(async tx => {
    const m = await fenced(tx, lease);
    const step = await tx.agentMissionStep.findFirst({ where: { id: stepId, missionId: m.id } });
    const approval = await tx.agentMissionApproval.findUnique({ where: { stepId } });
    if (!step || !approval || step.toolName !== "propose_calendar_events") throw new AppError("APPROVAL_CHANGED", "批量日历批准不存在", 409);
    if (step.status === "SUCCEEDED" && approval.status === "CONSUMED") return { done: true as const, result: step.resultJson };
    const proposal = batchProposalOf(approval.proposalJson);
    if (approval.status === "DISPATCHING" || step.status === "UNKNOWN" || step.status === "RUNNING" && record(record(step.protocolJson).externalEffect).phase === "SUBMITTING")
      return { reconcile: true as const, proposal, externalEffect: record(record(step.protocolJson).externalEffect) as Partial<BatchEffect> };
    if (approval.status !== "APPROVED" || step.status !== "READY") throw new AppError("APPROVAL_CHANGED", "批准已失效或已消费", 409);
    if (approval.proposalHash !== jsonHash(approval.proposalJson)) throw new AppError("APPROVAL_CHANGED", "提案内容与批准哈希不一致", 409);
    if (approval.expectedPlanRevision !== m.planRevision || approval.expiresAt <= new Date()) throw new AppError("APPROVAL_CHANGED", "批准已过期或计划已变化", 409);
    assertAutomaticTool(m, "create_calendar_events", true);
    assertDirectiveEffect(await effectiveContinuity(m.ownerUserId, { projectId: m.projectId, missionId: m.id }, tx), "BUSINESS_WRITE");
    await assertCognitiveReadSet(m.ownerUserId, record(step.protocolJson).cognitiveReadSet, tx);
    await assertExperienceReadSet(m.ownerUserId, record(step.protocolJson).experienceReadSet, tx);
    await validateSources(m.projectId, approval.readSetJson as unknown as MissionSource[], tx, m.id);
    const connection = await tx.calendarConnection.findFirst({ where: { id: proposal.args.connectionId, projectId: m.projectId, ownerUserId: m.ownerUserId, status: "ACTIVE", revokedAt: null } });
    if (!connection) throw new AppError("CALENDAR_CONNECTION_REVOKED", "日历连接已撤销，禁止新派发", 409);
    if (connection.authGeneration !== proposal.target.authGeneration || connection.revision !== proposal.target.connectionRevision || connection.calendarId !== proposal.target.calendarId)
      throw new AppError("CALENDAR_CONNECTION_CHANGED", "日历连接或资源已变化，请重新预览", 409);
    if (!connection.scope.split(/\s+/).includes("calendar:calendar")) throw new AppError("CALENDAR_WRITE_SCOPE_MISSING", "连接没有写入权限", 409);
    for (const item of proposal.events) if (item.payloadHash !== jsonHash(item.payload)) throw new AppError("APPROVAL_CHANGED", "批量日程 payload hash 不一致", 409);
    const used = usageOf(m.budgetUsedJson), limits = { ...defaultBudget, ...(m.budgetJson as object) };
    if (used.externalWrites + proposal.events.length > limits.externalWrites) throw new AppError("EXTERNAL_WRITE_BUDGET_EXHAUSTED", "外部写入预算不足以覆盖本批次", 409);
    used.externalWrites += proposal.events.length;
    await tx.agentMission.update({ where: { id: m.id }, data: { budgetUsedJson: json(used) } });
    const effect: BatchEffect = { phase: "SUBMITTING", operationId: proposal.operationId, target: proposal.target,
      items: proposal.events.map(item => ({ index: item.index, operationId: item.operationId, marker: item.marker, payloadHash: item.payloadHash, externalId: null, payload: item.payload })) };
    const claimed = await tx.agentMissionApproval.updateMany({ where: { id: approval.id, status: "APPROVED" }, data: { status: "DISPATCHING" } });
    if (!claimed.count) throw new AppError("APPROVAL_CHANGED", "批准已被其他执行占用", 409);
    await tx.agentMissionStep.update({ where: { id: stepId }, data: { status: "RUNNING", startedAt: new Date(),
      protocolJson: json({ ...record(step.protocolJson), externalEffect: effect }) } });
    return { dispatch: true as const, proposal, connection, effect };
  });
  if (prep.done) return prep.result;
  if (prep.reconcile) {
    const proposal = prep.proposal, effect = prep.externalEffect;
    if (!proposal.target.scope.split(/\s+/).includes("calendar:calendar")) return finalizeBatch(lease, stepId, { ok: false, known: false, code: "CALENDAR_WRITE_SCOPE_MISSING", message: "连接已无写入权限，无法继续核对" });
    const connection = await db.calendarConnection.findFirst({ where: { id: proposal.args.connectionId, projectId: proposal.projectId, ownerUserId: proposal.ownerUserId } });
    if (!connection) return finalizeBatch(lease, stepId, { ok: false, known: false, code: "CALENDAR_CONNECTION_REVOKED", message: "日历连接已撤销，结果保持待核对" });
    try {
      const verified: Array<{ index: number; eventId: string }> = [], snapshots: unknown[] = [];
      for (const item of proposal.events) {
        const externalId = effect.items?.find(entry => entry.index === item.index)?.externalId ?? null;
        const result = await readbackTarget(connection as never, proposal.target, item.payload, item.marker, item.effectQuery, externalId, fetcher);
        if (matches(result.eventId, item.payload, item.marker, result)) return finalizeBatch(lease, stepId, { ok: false, known: false, code: "CALENDAR_EFFECT_MISMATCH", message: "原批次日程存在但内容/身份不匹配" });
        if (item.payload.attendees.length) {
          const access = await calendarAccessTokenFor(connection as never, fetcher);
          const actual = await listFeishuCalendarAttendees({ accessToken: access, calendarId: proposal.target.calendarId, eventId: result.eventId }, fetcher);
          if (!attendeeMatches(item.payload.attendees, actual))
            return finalizeBatch(lease, stepId, { ok: false, known: false, code: "CALENDAR_ATTENDEE_MISMATCH", message: "原批次日程存在，但参与人与冻结提案不一致" });
        }
        verified.push({ index: item.index, eventId: result.eventId }); snapshots.push({ index: item.index, readback: result });
      }
      if (verified.length !== proposal.events.length) return finalizeBatch(lease, stepId, { ok: false, known: false, code: "CALENDAR_EFFECT_NOT_FOUND", message: "无法核对全部批次日程" });
      return finalizeBatch(lease, stepId, { ok: true, events: verified, readback: snapshots });
    } catch (error) {
      return finalizeBatch(lease, stepId, { ok: false, known: false, code: error instanceof AppError ? error.code : "CALENDAR_EFFECT_UNKNOWN", message: "无法证明本批次写入是否全部生效，保持待核对" });
    }
  }
  const { proposal, connection } = prep as { dispatch: true; proposal: BatchProposal; connection: Parameters<typeof calendarAccessTokenFor>[0]; effect: BatchEffect };
  let access = "";
  try { access = await calendarAccessTokenFor(connection, fetcher); }
  catch (error) {
    return finalizeBatch(lease, stepId, { ok: false, known: false, code: error instanceof AppError ? error.code : "CALENDAR_WRITE_UNKNOWN", message: "无法取得日历授权，批次未派发" });
  }
  const created: Array<{ index: number; eventId: string }> = [], snapshots: unknown[] = [];
  for (const item of proposal.events) {
    let eventId: string | null = null;
    try {
      const create = (accessToken: string) => createFeishuCalendarEvent({ accessToken, calendarId: proposal.target.calendarId, title: item.payload.title,
        description: item.payload.description, startAt: item.payload.startAt, endAt: item.payload.endAt, timeZone: item.payload.timeZone,
        allDay: item.payload.allDay, recurrence: item.payload.recurrence, attachments: item.payload.attachments, idempotencyKey: item.operationId }, fetcher);
      let createdEvent;
      try { createdEvent = await create(access); }
      catch (error) {
        if (!(error instanceof AppError) || error.code !== "CALENDAR_TOKEN_EXPIRED") throw error;
        access = await calendarAccessTokenFor(connection, fetcher, true);
        createdEvent = await create(access);
      }
      eventId = createdEvent.eventId;
      await db.$transaction(async tx => {
        const current = await tx.agentMissionStep.findUniqueOrThrow({ where: { id: stepId } });
        const protocol = record(current.protocolJson), externalEffect = record(protocol.externalEffect), items = (externalEffect.items as BatchEffectItem[] | undefined) ?? [];
        await tx.agentMissionStep.update({ where: { id: stepId }, data: { protocolJson: json({ ...protocol,
          externalEffect: { ...externalEffect, items: items.map(entry => entry.index === item.index ? { ...entry, externalId: eventId } : entry) } }) } });
      });
      if (item.payload.attendees.length) {
        try { await addFeishuCalendarAttendees({ accessToken: access, calendarId: proposal.target.calendarId, eventId, attendees: item.payload.attendees, needNotification: false }, fetcher); }
        catch { /* verified below */ }
      }
      const verified = await readbackTarget(connection, proposal.target, item.payload, item.marker, item.effectQuery, eventId, fetcher);
      const mismatch = matches(verified.eventId, item.payload, item.marker, verified);
      if (mismatch) throw new AppError("CALENDAR_EFFECT_MISMATCH", `批次第 ${item.index + 1} 个日程与冻结内容不匹配`);
      if (item.payload.attendees.length) {
        const actual = await listFeishuCalendarAttendees({ accessToken: access, calendarId: proposal.target.calendarId, eventId }, fetcher);
        if (!attendeeMatches(item.payload.attendees, actual)) throw new AppError("CALENDAR_ATTENDEE_MISMATCH", `批次第 ${item.index + 1} 个日程参与人不一致`);
      }
      created.push({ index: item.index, eventId }); snapshots.push({ index: item.index, readback: verified });
    } catch (error) {
      const ids = [...created.map(entry => entry.eventId), ...(eventId ? [eventId] : [])];
      const compensable = error instanceof AppError && ["CALENDAR_EFFECT_MISMATCH", "CALENDAR_ATTENDEE_MISMATCH", "CALENDAR_WRITE_REJECTED", "CALENDAR_ATTENDEE_UNKNOWN"].includes(error.code);
      if (ids.length && compensable)
        return finalizeBatch(lease, stepId, await compensateBatch(access, proposal.target.calendarId, ids,
          { code: error.code, message: error.message }, fetcher));
      if (ids.length && created.length) {
        const compensated = await compensateBatch(access, proposal.target.calendarId, created.map(entry => entry.eventId),
          { code: error instanceof AppError ? error.code : "CALENDAR_WRITE_UNKNOWN", message: error instanceof AppError ? error.message : "本批次后续写入结果未知" }, fetcher);
        return finalizeBatch(lease, stepId, { ...compensated, known: false, code: error instanceof AppError ? error.code : "CALENDAR_WRITE_UNKNOWN",
          message: `${compensated.message}；当前步骤结果仍未知，保持待核对` });
      }
      if (error instanceof AppError && ["CALENDAR_WRITE_REJECTED", "CALENDAR_WRITE_SCOPE_MISSING", "CALENDAR_CONNECTION_REVOKED", "CALENDAR_CONNECTION_CHANGED"].includes(error.code))
        return finalizeBatch(lease, stepId, { ok: false, known: true, code: error.code, message: error.message });
      return finalizeBatch(lease, stepId, { ok: false, known: false, code: error instanceof AppError ? error.code : "CALENDAR_WRITE_UNKNOWN",
        message: error instanceof AppError ? error.message : "批次写入结果未知，不会自动重发" });
    }
  }
  return finalizeBatch(lease, stepId, { ok: true, events: created, readback: snapshots });
}
