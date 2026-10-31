import {randomUUID} from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { json } from "@/lib/mission/contracts";
import type { Prisma } from "@/lib/generated/prisma/client";
import { calendarConfigured, openSecret, pkceChallenge, randomUrlToken, sealSecret, sha256 } from "@/lib/calendar/crypto";
import { CALENDAR_PROVIDER, CALENDAR_SCOPE, CALENDAR_WRITE_SCOPE, calendarConnectionActionSchema, calendarConnectionStartSchema, calendarReadInputSchema,
  calendarSourceMetaSchema, type CalendarConnectionView, type CalendarOAuthStart, type CalendarReadResult, type CalendarSourceMeta } from "@/lib/calendar/contracts";
import { assertFeishuCalendarScope, exchangeFeishuCode, feishuCalendarConfig, feishuAuthorizationUrl, readFeishuIdentity, refreshFeishuToken, type CalendarFetch } from "@/lib/calendar/feishuOAuth";
import { choosePrimaryFeishuCalendar, listFeishuCalendars, readFeishuEvents } from "@/lib/calendar/feishuCalendar";

const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_CONNECTIONS = 3;
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000;

function requireEnabled() {
  if (!isFeatureEnabled("CALENDAR_CONNECTIONS_ENABLED", false)) throw new AppError("CALENDAR_DISABLED", "外部日历连接当前未开启", 403);
}
async function ownedOwner(userId: string, projectId: string, tx: Prisma.TransactionClient = db) {
  const member = await tx.projectMembership.findFirst({ where: { userId, projectId, role: "OWNER" } });
  if (!member) throw new AppError("PROJECT_NOT_FOUND", "项目不存在或无法访问", 404);
}
function view(connection: { id: string; provider: string; accountEmail: string; accountName: string; calendarId: string; calendarSummary: string; calendarTimeZone: string;
  accessRole: string; scope: string; status: string; revokedAt: Date | null; revokedReason: string | null; lastFetchedAt: Date | null; lastStatus: string | null;
  lastError: string | null; revision: number }): CalendarConnectionView {
  return { id: connection.id, provider: connection.provider, accountEmail: connection.accountEmail, accountName: connection.accountName,
    calendarId: connection.calendarId, calendarSummary: connection.calendarSummary, calendarTimeZone: connection.calendarTimeZone,
    accessRole: connection.accessRole, scope: connection.scope, status: connection.status, revokedAt: connection.revokedAt?.toISOString() ?? null,
    revokedReason: connection.revokedReason, lastFetchedAt: connection.lastFetchedAt?.toISOString() ?? null, lastStatus: connection.lastStatus,
    lastError: connection.lastError, revision: connection.revision, connected: connection.status === "ACTIVE",
    writeCapable: connection.status === "ACTIVE" && connection.scope.split(/\s+/).includes("calendar:calendar") };
}
const defaultTimeZone = () => process.env.FEISHU_CALENDAR_DEFAULT_TIMEZONE?.trim() || "Asia/Shanghai";

export async function startCalendarConnection(userId: string, projectId: string, raw: unknown): Promise<CalendarOAuthStart> {
  requireEnabled();
  if (!calendarConfigured()) throw new AppError("CALENDAR_NOT_CONFIGURED", "服务端尚未配置日历凭据加密密钥", 503);
  const input = calendarConnectionStartSchema.parse(raw), config = feishuCalendarConfig(), requestedScope = input.mode === "WRITE" ? CALENDAR_WRITE_SCOPE : CALENDAR_SCOPE;
  await ownedOwner(userId, projectId);
  const state = randomUrlToken(), verifier = randomUrlToken(), now = new Date();
  await db.$transaction(async tx => {
    await ownedOwner(userId, projectId, tx);
    await tx.calendarOAuthState.deleteMany({ where: { ownerUserId: userId, expiresAt: { lt: now } } });
    await tx.calendarOAuthState.create({ data: { stateHash: sha256(state), ownerUserId: userId, projectId, provider: CALENDAR_PROVIDER,
      redirectUri: config.redirectUri, scope: requestedScope, mode: input.mode, codeVerifierCipher: sealSecret(verifier), expiresAt: new Date(now.getTime() + STATE_TTL_MS) } });
  });
  return { authorizationUrl: feishuAuthorizationUrl({ state, codeChallenge: pkceChallenge(verifier), redirectUri: config.redirectUri, scope: requestedScope }),
    expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString(), scope: requestedScope, redirectUri: config.redirectUri };
}

export async function completeCalendarConnection(userId: string, rawState: string, code: string, fetcher: CalendarFetch = fetch) {
  requireEnabled();
  if (!calendarConfigured()) throw new AppError("CALENDAR_NOT_CONFIGURED", "服务端尚未配置日历凭据加密密钥", 503);
  const stateHash = sha256(rawState), now = new Date();
  const state = await db.calendarOAuthState.findUnique({ where: { stateHash } });
  if (!state) throw new AppError("CALENDAR_STATE_INVALID", "日历授权状态无效，请重新连接", 409);
  if (state.ownerUserId !== userId) throw new AppError("CALENDAR_ACCOUNT_MISMATCH", "授权状态属于其他登录账号", 409);
  if (state.provider !== CALENDAR_PROVIDER || state.expiresAt <= now) throw new AppError("CALENDAR_STATE_INVALID", "日历授权已过期，请重新连接", 409);
  const consumed = await db.calendarOAuthState.updateMany({ where: { id: state.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
  if (!consumed.count) throw new AppError("CALENDAR_STATE_REPLAY", "该授权回调已被使用，请重新连接", 409);
  const token = await exchangeFeishuCode({ code, codeVerifier: openSecret(state.codeVerifierCipher), redirectUri: state.redirectUri }, fetcher);
  assertFeishuCalendarScope(token.scope, state.mode === "WRITE" ? "WRITE" : "READ");
  const identity = await readFeishuIdentity(token.access_token!, fetcher);
  const calendars = await listFeishuCalendars(token.access_token!, fetcher);
  const calendar = choosePrimaryFeishuCalendar(calendars);
  if (!calendar) throw new AppError("CALENDAR_NOT_FOUND", "当前飞书账号没有可读取的日历", 409);
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  const tokenCipher = sealSecret(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token ?? null, expiresAt: expiresAt?.toISOString() ?? null }));
  const connection = await db.$transaction(async tx => {
    await ownedOwner(userId, state.projectId, tx);
    const existing = await tx.calendarConnection.findUnique({ where: { projectId_provider_accountId_calendarId: {
      projectId: state.projectId, provider: CALENDAR_PROVIDER, accountId: identity.accountId, calendarId: calendar.calendarId } } });
    if (existing) {
      const reconsented = existing.status !== "ACTIVE";
      if (!reconsented) {
        const count = await tx.calendarConnection.count({ where: { projectId: state.projectId, status: "ACTIVE" } });
        if (count > MAX_ACTIVE_CONNECTIONS) throw new AppError("CALENDAR_CONNECTION_LIMIT", `每个项目最多 ${MAX_ACTIVE_CONNECTIONS} 个活跃日历连接`, 409);
      }
      return tx.calendarConnection.update({ where: { id: existing.id }, data: {
        accountEmail: identity.email, accountName: identity.name, calendarSummary: calendar.summary, calendarTimeZone: defaultTimeZone(), accessRole: calendar.role,
        scope: token.scope!, tokenCipher, tokenVersion: { increment: 1 }, tokenExpiresAt: expiresAt, status: "ACTIVE", revokedAt: null, revokedReason: null,
        lastStatus: "CONNECTED", lastError: null, ...(reconsented ? { authGeneration: { increment: 1 } } : {}), revision: { increment: 1 } } });
    }
    const count = await tx.calendarConnection.count({ where: { projectId: state.projectId, status: "ACTIVE" } });
    if (count >= MAX_ACTIVE_CONNECTIONS) throw new AppError("CALENDAR_CONNECTION_LIMIT", `每个项目最多 ${MAX_ACTIVE_CONNECTIONS} 个活跃日历连接`, 409);
    return tx.calendarConnection.create({ data: { projectId: state.projectId, ownerUserId: userId, provider: CALENDAR_PROVIDER, accountId: identity.accountId,
      accountEmail: identity.email, accountName: identity.name, calendarId: calendar.calendarId, calendarSummary: calendar.summary,
      calendarTimeZone: defaultTimeZone(), accessRole: calendar.role, scope: token.scope!, tokenCipher, tokenExpiresAt: expiresAt, lastStatus: "CONNECTED" } });
  });
  return { connection: view(connection), projectId: state.projectId };
}

export async function listCalendarConnections(userId: string, projectId: string) {
  requireEnabled();
  await ownedOwner(userId, projectId);
  const rows = await db.calendarConnection.findMany({ where: { projectId, ownerUserId: userId }, orderBy: { createdAt: "asc" } });
  return rows.map(view);
}

export async function revokeCalendarConnection(userId: string, projectId: string, connectionId: string, raw: unknown) {
  requireEnabled();
  const input = calendarConnectionActionSchema.parse(raw);
  return db.$transaction(async tx => {
    await ownedOwner(userId, projectId, tx);
    const connection = await tx.calendarConnection.findFirst({ where: { id: connectionId, projectId, ownerUserId: userId } });
    if (!connection) throw new AppError("CALENDAR_CONNECTION_NOT_FOUND", "日历连接不存在或不可访问", 404);
    if (connection.status === "REVOKED") return view(connection);
    const revoked = await tx.calendarConnection.update({ where: { id: connection.id }, data: { status: "REVOKED", revokedAt: new Date(),
      revokedReason: input.reason ?? "USER_REVOKED", tokenCipher: null, tokenExpiresAt: null, tokenVersion: { increment: 1 }, authGeneration: { increment: 1 }, revision: { increment: 1 } } });
    return view(revoked);
  });
}

type SealedToken = { accessToken: string; refreshToken: string | null; expiresAt: string | null };
function readToken(connection: { tokenCipher: string | null; tokenVersion: number }) {
  if (!connection.tokenCipher) throw new AppError("CALENDAR_REAUTH_REQUIRED", "日历授权已失效，请重新连接", 409);
  try {
    const parsed = JSON.parse(openSecret(connection.tokenCipher)) as Partial<SealedToken> & {refreshState?:string};
    if(parsed.refreshState)throw new AppError("CALENDAR_TOKEN_REFRESH_UNKNOWN","原凭据刷新尚未核清，不会再次使用刷新凭据，请重新连接",409);
    if (!parsed.accessToken) throw new Error("missing");
    return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken ?? null, expiresAt: parsed.expiresAt ?? null, tokenVersion: connection.tokenVersion };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("CALENDAR_TOKEN_INVALID", "日历凭据无法读取，请重新连接", 409);
  }
}
async function rotateToken(connection: { id: string; ownerUserId: string; projectId: string; status: string; authGeneration: number; tokenVersion: number; tokenCipher: string | null; scope: string }, current: ReturnType<typeof readToken>, fetcher: CalendarFetch) {
  if (!current.refreshToken) throw new AppError("CALENDAR_REAUTH_REQUIRED", "日历授权缺少刷新凭据，请重新连接", 409);
  const intent=sealSecret(JSON.stringify({...current,refreshState:"IN_FLIGHT"}));
  const claimed=await db.calendarConnection.updateMany({where:{id:connection.id,status:"ACTIVE",authGeneration:connection.authGeneration,tokenVersion:connection.tokenVersion},data:{tokenCipher:intent,tokenVersion:{increment:1}}});
  if(!claimed.count)throw new AppError("CALENDAR_REFRESH_IN_PROGRESS","其他请求已领取凭据刷新，请核对原连接",409);
  const reservedVersion=connection.tokenVersion+1;
  let token;
  try { token = await refreshFeishuToken(current.refreshToken, fetcher); }
  catch (error) {
    const code = error instanceof AppError ? error.code : "CALENDAR_TOKEN_REFRESH_UNKNOWN";
    await db.calendarConnection.updateMany({ where: { id: connection.id, status: "ACTIVE", tokenVersion: reservedVersion }, data: { tokenCipher:sealSecret(JSON.stringify({...current,refreshState:"UNKNOWN"})), lastStatus: code === "CALENDAR_TOKEN_REFRESH_UNKNOWN" ? "UNKNOWN" : "REAUTH_REQUIRED", lastError: error instanceof AppError ? error.message : "刷新凭据结果未知" } }).catch(() => undefined);
    if (code === "CALENDAR_TOKEN_REFRESH_UNKNOWN") throw new AppError("CALENDAR_TOKEN_REFRESH_UNKNOWN", "刷新日历授权时网络中断，结果未知；不会自动重试，请重新连接", 409);
    throw new AppError("CALENDAR_REAUTH_REQUIRED", "飞书日历授权已过期，请重新连接", 409);
  }
  assertFeishuCalendarScope(token.scope, connection.scope.split(/\s+/).includes("calendar:calendar") ? "WRITE" : "READ");
  const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
  const sealed = sealSecret(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token ?? current.refreshToken, expiresAt: expiresAt?.toISOString() ?? null }));
  const updated = await db.calendarConnection.updateMany({ where: { id: connection.id, status: "ACTIVE", tokenVersion: reservedVersion, authGeneration: connection.authGeneration },
    data: { tokenCipher: sealed, tokenVersion: { increment: 1 }, tokenExpiresAt: expiresAt, lastError: null } });
  if (!updated.count) throw new AppError("CALENDAR_CONNECTION_CHANGED", "日历连接已变化，刷新结果未采用", 409);
  return token.access_token!;
}
async function accessTokenFor(connection: { id: string; ownerUserId: string; projectId: string; status: string; authGeneration: number; tokenVersion: number; tokenCipher: string | null; tokenExpiresAt: Date | null; scope: string }, fetcher: CalendarFetch, forceRefresh = false) {
  const latest=await db.calendarConnection.findFirst({where:{id:connection.id,ownerUserId:connection.ownerUserId,projectId:connection.projectId,status:"ACTIVE",revokedAt:null}});
  if(!latest)throw new AppError("CALENDAR_CONNECTION_REVOKED","日历连接已撤销，不再发起新请求",409);
  if(latest.authGeneration!==connection.authGeneration)throw new AppError("CALENDAR_CONNECTION_CHANGED","日历授权身份已变化，停止使用旧凭据",409);
  connection=latest;
  const current = readToken(connection);
  const expires = current.expiresAt ? Date.parse(current.expiresAt) : connection.tokenExpiresAt?.getTime() ?? 0;
  if (!forceRefresh && expires > Date.now() + TOKEN_EXPIRY_MARGIN_MS) return current.accessToken;
  return rotateToken(connection, current, fetcher);
}

export type CalendarWindowSource = { observationId: string; revision: string; meta: CalendarSourceMeta; excerpt: string; title: string };
export type CalendarWindowRead = { connection: ReturnType<typeof view>; result: CalendarReadResult; sources: CalendarWindowSource[]; httpRequests: number };
export async function readCalendarWindow(userId: string, raw: unknown, options: { fetcher?: CalendarFetch; missionId?: string; conversationTurnId?: string; beforeRequest?:()=>Promise<void> } = {}): Promise<CalendarWindowRead> {
  requireEnabled();
  const input = calendarReadInputSchema.parse(raw), underlying = options.fetcher ?? fetch;
  await ownedOwner(userId, input.projectId);
  const connection = await db.calendarConnection.findFirst({ where: { id: input.connectionId, projectId: input.projectId, ownerUserId: userId } });
  if (!connection) throw new AppError("CALENDAR_CONNECTION_NOT_FOUND", "日历连接不存在或不可访问", 404);
  if (connection.status !== "ACTIVE" || connection.revokedAt) throw new AppError("CALENDAR_CONNECTION_REVOKED", "日历连接已撤销，不再发起新请求", 409);
  const snapshot = { authGeneration: connection.authGeneration, revision: connection.revision };
  const scopeKey = (options.missionId ? `mission:${options.missionId}` : options.conversationTurnId ? `turn:${options.conversationTurnId}` : "PROJECT") + ":" + randomUUID();
  let httpRequests=0;
  const fetcher:CalendarFetch=async(url,init)=>{
    const active=await db.calendarConnection.findFirst({where:{id:connection.id,status:"ACTIVE",revokedAt:null,revision:snapshot.revision,authGeneration:snapshot.authGeneration}});
    if(!active)throw new AppError("CALENDAR_CONNECTION_REVOKED","日历授权已变化，停止后续请求",409);
    await options.beforeRequest?.();httpRequests++;return underlying(url,init);
  };
  let token=await accessTokenFor(connection,fetcher);
  let page;
  try { page = await readFeishuEvents({ accessToken: token, calendarId: connection.calendarId, timeMin: input.timeMin, timeMax: input.timeMax,
    maxResults: input.maxResults, calendarTimeZone: connection.calendarTimeZone }, fetcher); }
  catch (error) {
    if (error instanceof AppError && error.code === "CALENDAR_TOKEN_EXPIRED") {
      token = await accessTokenFor(connection, fetcher, true);
      page = await readFeishuEvents({ accessToken: token, calendarId: connection.calendarId, timeMin: input.timeMin, timeMax: input.timeMax,
        maxResults: input.maxResults, calendarTimeZone: connection.calendarTimeZone }, fetcher);
    } else {
      const code = error instanceof AppError ? error.code : "CALENDAR_PROVIDER_ERROR";
      await db.calendarConnection.updateMany({ where: { id: connection.id, status: "ACTIVE", authGeneration: snapshot.authGeneration }, data: {
        lastFetchedAt: new Date(), lastStatus: code, lastError: error instanceof AppError ? error.message : "读取日历失败" } }).catch(() => undefined);
      throw error;
    }
  }
  const observedAt = new Date(), windowStart = new Date(input.timeMin), windowEnd = new Date(input.timeMax);
  const hasRecurrence = page.events.some(event => event.recurrence !== null);
  const complete = !page.hasMore && page.malformedCount === 0 && !hasRecurrence;
  const coverage: CalendarReadResult["coverage"] = { windowStart: input.timeMin, windowEnd: input.timeMax, pages: 1, complete, truncated: page.hasMore,
    eventCount: page.events.length, malformedCount: page.malformedCount, nextPageTokenPresent: !!page.pageToken };
  const saved = await db.$transaction(async tx => {
    await ownedOwner(userId, input.projectId, tx);
    const current = await tx.calendarConnection.findFirst({ where: { id: connection.id, projectId: input.projectId, ownerUserId: userId } });
    if (!current || current.status !== "ACTIVE") throw new AppError("CALENDAR_CONNECTION_REVOKED", "日历连接已撤销，迟到结果未写入", 409);
    if (current.authGeneration !== snapshot.authGeneration || current.revision !== snapshot.revision)
      throw new AppError("CALENDAR_CONNECTION_CHANGED", "日历连接已变化，迟到结果未写入", 409);
    const sources: CalendarWindowSource[] = [];
    for (const event of page.events) {
      const meta = calendarSourceMetaSchema.parse({ provider: CALENDAR_PROVIDER, accountEmail: current.accountEmail, accountName: current.accountName,
        calendarId: current.calendarId, calendarSummary: current.calendarSummary, calendarTimeZone: current.calendarTimeZone, accessRole: current.accessRole,
        eventId: event.eventId, recurringEventId: event.recurringEventId, eventStatus: event.status, title: event.title, recurrence: event.recurrence,
        isException: event.isException, startAt: event.startAt, endAt: event.endAt, allDay: event.allDay, startDate: event.startDate, endDate: event.endDate,
        timeZone: event.timeZone, transparency: event.transparency, eventUpdatedAt: event.updatedAt, eventRevision: event.revision,
        connectionRevision: current.revision, authGeneration: current.authGeneration, observedAt: observedAt.toISOString(),
        window: { start: new Date(coverage.windowStart).toISOString(), end: new Date(coverage.windowEnd).toISOString(), complete: coverage.complete, pages: coverage.pages,
          truncated: coverage.truncated, eventCount: coverage.eventCount, malformedCount: coverage.malformedCount } });
      const when = event.allDay ? `${event.startDate} 全天` : `${event.startLocalDate ?? ""} ${formatLocalTime(event.startAt, event.timeZone)}–${formatLocalTime(event.endAt, event.timeZone)}`;
      const excerpt = `${when} · ${event.title} · ${event.status}${event.transparency ? ` · ${event.transparency}` : ""}${event.recurrence ? ` · 重复规则 ${event.recurrence}` : ""}${event.isException ? " · 重复例外" : ""}`;
      const payload = { event, meta, excerpt, provider: CALENDAR_PROVIDER, accountEmail: current.accountEmail, accountName: current.accountName, calendarSummary: current.calendarSummary,
        calendarTimeZone: current.calendarTimeZone, accessRole: current.accessRole, window: coverage, observedAt: observedAt.toISOString(), authGeneration: current.authGeneration,
        connectionRevision: current.revision };
      const row = await tx.calendarObservation.upsert({ where: { connectionId_eventKey_revision_scopeKey: { connectionId: current.id, eventKey: event.eventKey, revision: event.revision, scopeKey } },
        create: { connectionId: current.id, projectId: input.projectId, ownerUserId: userId, calendarId: current.calendarId, eventKey: event.eventKey, eventId: event.eventId,
          recurringEventId: event.recurringEventId, eventStatus: event.status, title: event.title, startAt: event.startAt ? new Date(event.startAt) : null,
          endAt: event.endAt ? new Date(event.endAt) : null, allDay: event.allDay, startDate: event.startDate, endDate: event.endDate, eventTimeZone: event.timeZone,
          transparency: event.transparency, eventUpdatedAt: event.updatedAt ? new Date(event.updatedAt) : null, eventEtag: event.etag, revision: event.revision,
          scopeKey, windowStart, windowEnd, windowComplete: complete, missionId: options.missionId ?? null, conversationTurnId: options.conversationTurnId ?? null,
          payloadJson: json(payload), observedAt },
        update: { observedAt, payloadJson: json(payload), windowStart, windowEnd, windowComplete: complete } });
      sources.push({ observationId: row.id, revision: event.revision, meta, excerpt, title: event.title });
    }
    await tx.calendarConnection.update({ where: { id: current.id }, data: { lastFetchedAt: observedAt, lastStatus: complete ? (page.events.length ? "OK" : "EMPTY_WINDOW") : "PARTIAL",
      lastError: page.hasMore ? "飞书在本次时间窗口内仍有更多日程，未读取部分不能当作不存在" : hasRecurrence ? "窗口内有未展开的重复规则，不能仅凭返回实例判定无冲突" : page.malformedCount ? "部分日程缺少可解析时间，未计入覆盖" : null,
      windowStart, windowEnd, ...(page.syncToken && complete ? { syncToken: page.syncToken } : {}) } });
    return sources;
  });
  return { connection: view({ ...connection, lastFetchedAt: observedAt, lastStatus: complete ? (page.events.length ? "OK" : "EMPTY_WINDOW") : "PARTIAL" }),
    result: { connectionId: connection.id, provider: CALENDAR_PROVIDER, accountEmail: connection.accountEmail, calendarId: connection.calendarId,
      calendarSummary: connection.calendarSummary, calendarTimeZone: connection.calendarTimeZone, events: page.events, coverage, observedAt: observedAt.toISOString(),
      providerStatus: page.status, syncTokenPresent: !!page.syncToken }, sources: saved, httpRequests };
}
function formatLocalTime(iso: string | null, timeZone: string | null) {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || defaultTimeZone(), hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)); }
  catch { return iso.slice(11, 16); }
}
export { accessTokenFor as calendarAccessTokenFor };
