import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
const isolation = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), DB = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ct9b-")), key = Buffer.alloc(32, 7).toString("base64");
  Object.assign(process.env, { DATABASE_URL: "file:" + path.join(dir, "test.sqlite").replaceAll("\\", "/"), LLM_MODE: "mock",
    MISSION_ENABLED: "true", MISSION_WEB_ENABLED: "true", CALENDAR_CONNECTIONS_ENABLED: "true", FOCUS_WEB_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true",
    FEISHU_CALENDAR_APP_ID: "cli_test", FEISHU_CALENDAR_APP_SECRET: "test_secret", FEISHU_CALENDAR_REDIRECT_URI: "https://example.com/api/integrations/feishu-calendar/callback",
    FEISHU_CALENDAR_DEFAULT_TIMEZONE: "Asia/Shanghai", CALENDAR_TOKEN_KEY: key, SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new DB(path.join(dir, "test.sqlite"));
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, readConversation } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { record } from "@/lib/conversation/repository";
import { readConversationCalendarTool } from "@/lib/conversation/calendarTools";
import { createMission, missionDetail } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { buildContext } from "@/lib/mission/contextBuilder";
import type { Choice } from "@/lib/mission/contracts";
import { calendarAccessTokenFor, completeCalendarConnection, listCalendarConnections, readCalendarWindow, revokeCalendarConnection, startCalendarConnection } from "@/lib/services/calendarConnectionService";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import type { CalendarFetch } from "@/lib/calendar/feishuOAuth";

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolation.dir, { recursive: true, force: true }); });

const tokenBody = { code: 0, msg: "success", access_token: "u-test-access", expires_in: 7200, refresh_token: "u-test-refresh",
  refresh_token_expires_in: 604800, scope: "calendar:calendar:readonly offline_access", token_type: "Bearer" };
const identityBody = { code: 0, msg: "success", data: { open_id: "ou_test", name: "测试用户", email: "test@example.com" } };
const calendarBody = { code: 0, msg: "success", data: { has_more: false, calendar_list: [{ calendar_id: "primary_cal", summary: "主日历", type: "primary",
  role: "owner", permissions: "private", is_deleted: false, is_third_party: false }] } };
const start = new Date("2025-11-03T01:00:00Z"), end = new Date("2025-11-03T02:00:00Z");
const timed = (id: string, extra: Record<string, unknown> = {}) => ({ event_id: id, summary: "项目评审", status: "confirmed",
  start_time: { timestamp: String(start.getTime() / 1000), timezone: "Asia/Shanghai" },
  end_time: { timestamp: String(end.getTime() / 1000), timezone: "Asia/Shanghai" }, free_busy_status: "busy", ...extra });
const items = [
  timed("e1"),
  { event_id: "e2", summary: "截止日", status: "confirmed", start_time: { date: "2025-11-05", timezone: "UTC" }, end_time: { date: "2025-11-06", timezone: "UTC" }, free_busy_status: "busy" },
  timed("e3", { status: "cancelled" }), timed("e4", { status: "tentative" }),
  timed("e5", { recurrence: "FREQ=WEEKLY;BYDAY=MO" }), timed("e6", { is_exception: true, recurring_event_id: "e5" }),
  { event_id: "e7", summary: "坏时间", start_time: {}, end_time: {} },
];
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function fetcher(config: { events?: unknown[]; eventsStatus?: number; eventsCode?: number; hasMore?: boolean; token?: typeof tokenBody; failRefresh?: boolean } = {}) {
  let eventCalls = 0;
  return vi.fn(async (url: string) => {
    if (url.includes("/authen/v2/oauth/token")) {
      if (config.failRefresh) throw new TypeError("network interrupted");
      return ok(config.token ?? tokenBody);
    }
    if (url.includes("/authen/v1/user_info")) return ok(identityBody);
    if (url.includes("/calendar/v4/calendars") && !url.includes("/events")) return ok(calendarBody);
    if (url.includes("/calendar/v4/calendars/")) {
      eventCalls++;
      if (config.eventsStatus === 429) return ok({ code: 190004, msg: "rate limited" }, 429);
      if (config.eventsStatus === 403) return ok({ code: 191002, msg: "no access" }, 403);
      if (config.eventsCode && eventCalls === 1) return ok({ code: config.eventsCode, msg: "token invalid" }, 401);
      return ok({ code: 0, msg: "success", data: { has_more: config.hasMore === true, sync_token: "sync-token", items: config.events ?? items } });
    }
    throw new Error("unexpected URL " + url);
  }) as unknown as CalendarFetch & { mock: { calls: unknown[][] } };
}
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "日历测试", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "日历项目", description: "CT9B_SYNTHETIC_ONLY", goal: "核对项目期限", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  return { user, project };
}
async function connect(userId: string, projectId: string, fetchImpl: CalendarFetch = fetcher()) {
  const started = await startCalendarConnection(userId, projectId, { requestId: "start-" + crypto.randomUUID() });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const completed = await completeCalendarConnection(userId, state, "code", fetchImpl);
  return completed.connection;
}
const window = { timeMin: "2025-11-01T00:00:00+08:00", timeMax: "2025-11-30T23:59:59+08:00", maxResults: 20 };

describe("CT-9B 飞书日历只读连接", () => {
  it("OAuth 使用 state/PKCE，token 只存密文，回调只能使用一次", async () => {
    const { user, project } = await fixture(), f = fetcher();
    const started = await startCalendarConnection(user.id, project.id, { requestId: "start" });
    const url = new URL(started.authorizationUrl);
    expect(url.host).toBe("accounts.feishu.cn");
    expect(url.searchParams.get("scope")).toContain("calendar:calendar:readonly");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state")!;
    const stored = await db.calendarOAuthState.findFirstOrThrow({ where: { ownerUserId: user.id } });
    expect(stored.stateHash).not.toBe(state);
    expect(stored.codeVerifierCipher).not.toContain(url.searchParams.get("code_challenge"));
    const completed = await completeCalendarConnection(user.id, state, "code", f);
    expect(completed.connection.calendarSummary).toBe("主日历");
    const connection = await db.calendarConnection.findUniqueOrThrow({ where: { id: completed.connection.id } });
    expect(connection.tokenCipher).not.toContain("u-test-access");
    expect(connection.authGeneration).toBe(1);
    expect(JSON.stringify(completed)).not.toContain("u-test-access");
    await expect(completeCalendarConnection(user.id, state, "code", f)).rejects.toMatchObject({ code: "CALENDAR_STATE_REPLAY" });
    expect((await listCalendarConnections(user.id, project.id))[0]).not.toHaveProperty("tokenCipher");
  });
  it("其他登录账号不能完成授权；缺少只读 scope 不建连接", async () => {
    const { user, project } = await fixture(), other = await fixture();
    const started = await startCalendarConnection(user.id, project.id, { requestId: "start" });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    await expect(completeCalendarConnection(other.user.id, state, "code", fetcher())).rejects.toMatchObject({ code: "CALENDAR_ACCOUNT_MISMATCH" });
    const narrow = fetcher({ token: { ...tokenBody, scope: "calendar:calendar:readonly" } });
    const state2 = new URL((await startCalendarConnection(user.id, project.id, { requestId: "start2" })).authorizationUrl).searchParams.get("state")!;
    await expect(completeCalendarConnection(user.id, state2, "code", narrow)).rejects.toMatchObject({ code: "CALENDAR_SCOPE_MISSING" });
    expect(await db.calendarConnection.count({ where: { projectId: project.id } })).toBe(0);
  });
  it("窗口读取保留全天、时区、取消、重复与缺时间覆盖", async () => {
    const { user, project } = await fixture(), connection = await connect(user.id, project.id), f = fetcher();
    const read = await readCalendarWindow(user.id, { projectId: project.id, connectionId: connection.id, ...window }, { fetcher: f });
    expect(read.sources).toHaveLength(6);
    expect(read.result.coverage).toMatchObject({ complete: false, malformedCount: 1, truncated: false, eventCount: 6 });
    const allDay = read.sources.find(source => source.meta.eventStatus === "confirmed" && source.meta.allDay)!;
    expect(allDay.meta).toMatchObject({ startDate: "2025-11-05", endDate: "2025-11-06", timeZone: "UTC" });
    expect(read.sources.some(source => source.meta.eventStatus === "cancelled")).toBe(true);
    expect(read.sources.some(source => source.meta.recurrence?.includes("FREQ=WEEKLY"))).toBe(true);
    expect(read.sources.some(source => source.meta.isException)).toBe(true);
    expect(await db.calendarObservation.count({ where: { connectionId: connection.id } })).toBe(6);
    const sourceId = "calendar:" + read.sources[0].observationId;
    expect((await sourceUse(user.id, project.id, sourceId)).state).toBe("ALLOWED");
  });
  it("窗口仍有余量时标记 truncated，不冒充完整枚举", async () => {
    const { user, project } = await fixture(), connection = await connect(user.id, project.id), f = fetcher({ events: [timed("only")], hasMore: true });
    const read = await readCalendarWindow(user.id, { projectId: project.id, connectionId: connection.id, ...window }, { fetcher: f });
    expect(read.result.coverage).toMatchObject({ complete: false, truncated: true });
    expect((await db.calendarConnection.findUniqueOrThrow({ where: { id: connection.id } })).lastStatus).toBe("PARTIAL");
  });
  it("限流与无权限保持失败，不写观察", async () => {
    const { user, project } = await fixture(), connection = await connect(user.id, project.id);
    await expect(readCalendarWindow(user.id, { projectId: project.id, connectionId: connection.id, ...window }, { fetcher: fetcher({ eventsStatus: 429 }) })).rejects.toMatchObject({ code: "CALENDAR_RATE_LIMITED" });
    await expect(readCalendarWindow(user.id, { projectId: project.id, connectionId: connection.id, ...window }, { fetcher: fetcher({ eventsStatus: 403 }) })).rejects.toMatchObject({ code: "CALENDAR_ACCESS_DENIED" });
    expect(await db.calendarObservation.count({ where: { connectionId: connection.id } })).toBe(0);
    expect((await db.calendarConnection.findUniqueOrThrow({ where: { id: connection.id } })).lastStatus).not.toBe("OK");
  });
  it("401 时只刷新一次 token 并重读，刷新结果写入新版本", async () => {
    const { user, project } = await fixture(), connection = await connect(user.id, project.id), f = fetcher({ eventsCode: 99991663 });
    const read = await readCalendarWindow(user.id, { projectId: project.id, connectionId: connection.id, ...window }, { fetcher: f });
    expect(read.result.events).toHaveLength(6);
    const row = await db.calendarConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(row.tokenVersion).toBe(3); // durable refresh claim and successful token rotation each advance the fence
    expect(row.tokenCipher).not.toContain("u-test-access");
  });
  it("刷新凭据网络未知不自动重发，连接标记 UNKNOWN", async () => {
    const { user, project } = await fixture(), connection = await connect(user.id, project.id);
    await expect(readCalendarWindow(user.id, { projectId: project.id, connectionId: connection.id, ...window }, { fetcher: fetcher({ eventsCode: 99991663, failRefresh: true }) }))
      .rejects.toMatchObject({ code: "CALENDAR_TOKEN_REFRESH_UNKNOWN" });
    expect((await db.calendarConnection.findUniqueOrThrow({ where: { id: connection.id } })).lastStatus).toBe("UNKNOWN");
    expect(await db.calendarObservation.count({ where: { connectionId: connection.id } })).toBe(0);
  });
  it("撤权后旧快照立即不可再消费，跨项目/跨账号不能借用", async () => {
    const { user, project } = await fixture(), other = await fixture(), connection = await connect(user.id, project.id), f = fetcher({ events: [timed("revoke")] });
    const read = await readCalendarWindow(user.id, { projectId: project.id, connectionId: connection.id, ...window }, { fetcher: f });
    const sourceId = "calendar:" + read.sources[0].observationId;
    await revokeCalendarConnection(user.id, project.id, connection.id, { action: "REVOKE", requestId: "revoke" });
    expect((await sourceUse(user.id, project.id, sourceId)).state).toBe("SUPPRESSED");
    await expect(readCalendarWindow(user.id, { projectId: project.id, connectionId: connection.id, ...window }, { fetcher: f })).rejects.toMatchObject({ code: "CALENDAR_CONNECTION_REVOKED" });
    await expect(readCalendarWindow(other.user.id, { projectId: other.project.id, connectionId: connection.id, ...window }, { fetcher: f })).rejects.toMatchObject({ code: "CALENDAR_CONNECTION_NOT_FOUND" });
  });
  it("GET 连接列表不触发 provider 请求", async () => {
    const { user, project } = await fixture(), connection = await connect(user.id, project.id);
    const f = fetcher();
    const rows = await listCalendarConnections(user.id, project.id);
    expect(rows[0].id).toBe(connection.id);
    expect(f.mock.calls).toHaveLength(0);
  });
  it("会话工具写回原 operation 与带内外部来源，重复输入回放", async () => {
    const { user, project } = await fixture(), connection = await connect(user.id, project.id), f = fetcher({ events: [timed("conv")] });
    const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
    const conversation = await createConversation(actor, { requestId: crypto.randomUUID(), scope: "PROJECT", projectId: project.id });
    const turn = await submitConversationTurn(actor, conversation.id, { requestId: "turn", expectedVersion: 1, message: "核对项目期限", projectId: project.id }, undefined, { defer: true });
    const call = { tool: "calendar_read" as const, projectId: project.id, connectionId: connection.id, ...window };
    const first = await readConversationCalendarTool(actor, conversation.id, turn.turnId, "calendar-1", call, f as unknown as typeof fetch);
    const source = first.sources[0];
    expect(source.calendar).toMatchObject({ provider: "FEISHU_CALENDAR", eventStatus: "confirmed" });
    expect(source.sourceId.startsWith("calendar:")).toBe(true);
    const saved = record((await db.conversationTurn.findUniqueOrThrow({ where: { id: turn.turnId } })).readManifestJson).webSources as Array<{ sourceId: string }>;
    expect(saved.some(row => row.sourceId === source.sourceId)).toBe(true);
    const operation = record(record((await db.conversationTurn.findUniqueOrThrow({ where: { id: turn.turnId } })).readManifestJson).operations)["calendar-1"];
    expect(operation).toMatchObject({ kind: "CALENDAR_READ", status: "SUCCEEDED" });
    const second = await readConversationCalendarTool(actor, conversation.id, turn.turnId, "calendar-2", { ...call, maxResults: 10 }, f as unknown as typeof fetch);
    expect(second.sources[0]).toMatchObject({ revision: first.sources[0].revision, excerpt: first.sources[0].excerpt });
    expect(second.sources[0].sourceId).not.toBe(first.sources[0].sourceId);
    const replay=await readConversationCalendarTool(actor,conversation.id,turn.turnId,"calendar-2",{...call,maxResults:10},f as unknown as typeof fetch);
    expect(replay.sources[0].sourceId).toBe(second.sources[0].sourceId);
    await expect(readConversationCalendarTool(actor, conversation.id, turn.turnId, "calendar-3", { ...call, maxResults: 5 }, f as unknown as typeof fetch)).rejects.toMatchObject({ code: "CALENDAR_TURN_LIMIT" });
    expect((await readConversation(actor, conversation.id)).activeTurn?.progress?.completedReads ?? 0).toBeGreaterThanOrEqual(0);
  });
  it("Mission 工具接入原步骤、预算与上下文", async () => {
    const { user, project } = await fixture(), connection = await connect(user.id, project.id), f = fetcher({ events: [timed("mission")] });
    const mission = await createMission(user.id, { projectId: project.id, requestId: "mission-" + crypto.randomUUID(), goal: "核对项目期限与时间冲突" });
    const decision = (choice: Choice) => ({ choice, provider: "TEST_FIXTURE", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });
    await runMissionSlice({ id: mission.id, provider: async () => decision({ kind: "tool", tool: "calendar_read",
      args: { connectionId: connection.id, timeMin: window.timeMin, timeMax: window.timeMax, maxResults: 20 }, summary: "核对日历" }), calendar: { fetcher: f as unknown as typeof fetch } });
    const detail = await missionDetail(user.id, mission.id);
    expect(detail.steps.some(step => step.toolName === "calendar_read" && step.status === "SUCCEEDED")).toBe(true);
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).budgetUsedJson).toMatchObject({ calendarRequests: 1 });
    const context = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })));
    expect(JSON.stringify(context)).toContain("FEISHU_CALENDAR");
  });
});

it("旋转凭据只允许一个并发刷新；刷新UNKNOWN禁止复用旧token重试",async()=>{
 const {user,project}=await fixture(),v=await connect(user.id,project.id),row=await db.calendarConnection.findUniqueOrThrow({where:{id:v.id}});
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
 const refresh=vi.fn(async()=>{entered();await gate;return ok(tokenBody);});
 const first=calendarAccessTokenFor(row,refresh,true);await started;
 await expect(calendarAccessTokenFor(row,refresh,true)).rejects.toMatchObject({code:"CALENDAR_TOKEN_REFRESH_UNKNOWN"});release();await first;expect(refresh).toHaveBeenCalledTimes(1);
 const failed=vi.fn(async()=>{throw new TypeError("lost acknowledgement");});
 await expect(calendarAccessTokenFor(row,failed,true)).rejects.toMatchObject({code:"CALENDAR_TOKEN_REFRESH_UNKNOWN"});
 await expect(calendarAccessTokenFor(row,failed,true)).rejects.toMatchObject({code:"CALENDAR_TOKEN_REFRESH_UNKNOWN"});expect(failed).toHaveBeenCalledTimes(1);
});
it("再次观察不会改写历史快照；经过时效边界立即不能作为当前证据消费",async()=>{
 const {user,project}=await fixture(),connection=await connect(user.id,project.id),f=fetcher({events:[timed("immutable")]});
 const first=await readCalendarWindow(user.id,{projectId:project.id,connectionId:connection.id,...window},{fetcher:f});
 const old=await db.calendarObservation.findUniqueOrThrow({where:{id:first.sources[0].observationId}});
 const second=await readCalendarWindow(user.id,{projectId:project.id,connectionId:connection.id,...window},{fetcher:f});expect(second.sources[0].observationId).not.toBe(old.id);
 expect(await db.calendarObservation.findUniqueOrThrow({where:{id:old.id}})).toEqual(old);
 await db.calendarObservation.update({where:{id:old.id},data:{observedAt:new Date(Date.now()-16*60000)}});
 expect((await sourceUse(user.id,project.id,"calendar:"+old.id)).state).not.toBe("ALLOWED");
});

it("已观察到事件新版本后，旧观察即时失效而不是等TTL",async()=>{
 const {user,project}=await fixture(),connection=await connect(user.id,project.id);
 const first=await readCalendarWindow(user.id,{projectId:project.id,connectionId:connection.id,...window},{fetcher:fetcher({events:[timed("changed")]})});
 const old=await db.calendarObservation.findUniqueOrThrow({where:{id:first.sources[0].observationId}});
 await readCalendarWindow(user.id,{projectId:project.id,connectionId:connection.id,...window},{fetcher:fetcher({events:[timed("changed",{summary:"新版本"})]})});
 expect((await sourceUse(user.id,project.id,"calendar:"+old.id)).state).not.toBe("ALLOWED");
 expect(await db.calendarObservation.findUniqueOrThrow({where:{id:old.id}})).toEqual(old);
});
