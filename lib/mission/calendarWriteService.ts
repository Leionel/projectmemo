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
import { createFeishuCalendarEvent, getFeishuCalendarEvent } from "@/lib/calendar/feishuWrite";
import { readFeishuEvents } from "@/lib/calendar/feishuCalendar";
import type { CalendarFetch } from "@/lib/calendar/feishuOAuth";

type Target = { provider: string; accountId: string; accountEmail: string; accountName: string; calendarId: string; calendarSummary: string;
  calendarTimeZone: string; connectionRevision: number; authGeneration: number; scope: string };
type Payload = { title: string; description: string; startAt: string; endAt: string; timeZone: string };
type Proposal = { tool: "create_calendar_event"; toolVersion: "1"; operationId: string; args: Payload & { connectionId: string }; payload: Payload; payloadHash: string;
  target: Target; marker: string; effectQuery: { kind: string; marker: string; timeMin: string; timeMax: string }; readSet: MissionSource[]; expiresAt: string;
  ownerUserId: string; projectId: string; planRevision: number };
type ExternalEffect = { phase: string; operationId: string; marker: string; payloadHash: string; externalId: string | null; externalUrl: string | null; target: Target; payload: Payload };
type Outcome = { ok: true; eventId: string; readback: unknown } | { ok: false; known: boolean; code: string; message: string };

function proposalOf(value: unknown): Proposal {
  const proposal = value as Partial<Proposal>;
  if (proposal.tool !== "create_calendar_event" || !proposal.payload || !proposal.target || !proposal.marker || !proposal.effectQuery)
    throw new AppError("APPROVAL_CHANGED", "日历提案格式无效", 409);
  return proposal as Proposal;
}
function matches(eventId: string, payload: Payload, marker: string, readback: { eventId: string; title: string; startAt: string | null; endAt: string | null; description: string }) {
  if (readback.eventId !== eventId) return "IDENTITY_MISMATCH";
  if (readback.title !== payload.title) return "CONTENT_MISMATCH";
  if (!readback.description.includes(marker)) return "MARKER_MISSING";
  const expectedStart = Date.parse(payload.startAt), expectedEnd = Date.parse(payload.endAt);
  if (!readback.startAt || !readback.endAt || Math.abs(Date.parse(readback.startAt) - expectedStart) > 1000 || Math.abs(Date.parse(readback.endAt) - expectedEnd) > 1000) return "TIME_MISMATCH";
  return null;
}
async function readback(connection: { id: string; projectId: string; ownerUserId: string } & Parameters<typeof calendarAccessTokenFor>[0], proposal: Proposal, externalId: string | null, fetcher: CalendarFetch) {
  const access = await calendarAccessTokenFor(connection, fetcher);
  if (externalId) {
    const result = await getFeishuCalendarEvent({ accessToken: access, calendarId: proposal.target.calendarId, eventId: externalId, timeZone: proposal.payload.timeZone }, fetcher);
    return { eventId: result.eventId, title: result.title, startAt: result.startAt, endAt: result.endAt, description: result.description };
  }
  const page = await readFeishuEvents({ accessToken: access, calendarId: proposal.target.calendarId, timeMin: proposal.effectQuery.timeMin, timeMax: proposal.effectQuery.timeMax,
    maxResults: 50, calendarTimeZone: proposal.target.calendarTimeZone }, fetcher);
  const found = page.events.find(item => item.description.includes(proposal.marker) && item.title === proposal.payload.title);
  if (!found) throw new AppError("CALENDAR_EFFECT_NOT_FOUND", "本次标记的日程尚未找到；最终一致性延迟不能证明未写入", 404);
  return { eventId: found.eventId, title: found.title, startAt: found.startAt, endAt: found.endAt, description: found.description };
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
    const failure = { code: outcome.code, message: outcome.message };
    await tx.agentMissionStep.update({ where: { id: stepId }, data: { status: outcome.known ? "FAILED" : "UNKNOWN", failureJson: json(failure),
      resultJson: json({ data: { status: outcome.known ? "FAILED" : "UNKNOWN", code: outcome.code, message: outcome.message, marker: proposalOf(approval.proposalJson).marker } }),
      finishedAt: outcome.known ? new Date() : null,
      protocolJson: json({ ...record(step.protocolJson), externalEffect: { ...record(record(step.protocolJson).externalEffect), phase: outcome.known ? "FAILED" : "UNKNOWN" } }) } });
    if (outcome.known) await tx.agentMissionApproval.update({ where: { id: approval.id }, data: { status: "EXPIRED" } });
    await event(tx, m.id, outcome.known ? "CALENDAR_EVENT_FAILED" : "CALENDAR_EVENT_UNKNOWN", failure);
    await tx.agentMission.update({ where: { id: m.id }, data: { lastErrorJson: json({ code: outcome.code, message: outcome.message, phase: "APPROVAL" }) } });
    await release(tx, m, "PAUSED", outcome.code);
    return { data: { status: outcome.known ? "FAILED" : "UNKNOWN", code: outcome.code, message: outcome.message } };
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
      return finalize(lease, stepId, { ok: true, eventId: verified.eventId, readback: verified });
    } catch (error) {
      return finalize(lease, stepId, { ok: false, known: false, code: error instanceof AppError ? error.code : "CALENDAR_EFFECT_UNKNOWN", message: "无法证明本次写入是否生效，保持待核对" });
    }
  }
  const { proposal, connection } = prep as { dispatch: true; proposal: Proposal; connection: Parameters<typeof calendarAccessTokenFor>[0]; effect: ExternalEffect };
  let unknown: Outcome | null = null;
  try {
    let access = await calendarAccessTokenFor(connection, fetcher);
    let created;
    try { created = await createFeishuCalendarEvent({ accessToken: access, calendarId: proposal.target.calendarId, title: proposal.payload.title,
      description: proposal.payload.description, startAt: proposal.payload.startAt, endAt: proposal.payload.endAt, timeZone: proposal.payload.timeZone,
      idempotencyKey: proposal.operationId }, fetcher); }
    catch (error) {
      if (error instanceof AppError && error.code === "CALENDAR_TOKEN_EXPIRED") {
        access = await calendarAccessTokenFor(connection, fetcher, true);
        created = await createFeishuCalendarEvent({ accessToken: access, calendarId: proposal.target.calendarId, title: proposal.payload.title,
          description: proposal.payload.description, startAt: proposal.payload.startAt, endAt: proposal.payload.endAt, timeZone: proposal.payload.timeZone,
          idempotencyKey: proposal.operationId }, fetcher);
      } else throw error;
    }
    await db.$transaction(async tx => {
      const current = await tx.agentMissionStep.findUniqueOrThrow({ where: { id: stepId } });
      await tx.agentMissionStep.update({ where: { id: stepId }, data: { protocolJson: json({ ...record(current.protocolJson),
        externalEffect: { ...record(record(current.protocolJson).externalEffect), externalId: created.eventId, phase: "SUBMITTED" } }) } });
    });
    const verified = await readback(connection, proposal, created.eventId, fetcher);
    const mismatch = matches(verified.eventId, proposal.payload, proposal.marker, verified);
    if (mismatch) unknown = { ok: false, known: false, code: "CALENDAR_EFFECT_MISMATCH", message: "provider 返回对象与冻结 payload 不匹配，保持待核对" };
    else return finalize(lease, stepId, { ok: true, eventId: verified.eventId, readback: verified });
  } catch (error) {
    if (error instanceof AppError && ["CALENDAR_WRITE_REJECTED", "CALENDAR_WRITE_SCOPE_MISSING", "CALENDAR_CONNECTION_REVOKED", "CALENDAR_CONNECTION_CHANGED"].includes(error.code))
      return finalize(lease, stepId, { ok: false, known: true, code: error.code, message: error.message });
    unknown = { ok: false, known: false, code: error instanceof AppError ? error.code : "CALENDAR_WRITE_UNKNOWN", message: error instanceof AppError ? error.message : "写入请求结果未知" };
  }
  if (unknown) return finalize(lease, stepId, unknown);
  throw new AppError("CALENDAR_WRITE_UNKNOWN", "写入结果未知", 503);
}
