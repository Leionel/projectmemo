import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
const isolation = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), DB = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cal-ext-")), key = Buffer.alloc(32, 9).toString("base64");
  Object.assign(process.env, { DATABASE_URL: "file:" + path.join(dir, "test.sqlite").replaceAll("\\", "/"), LLM_MODE: "mock", MISSION_ENABLED: "true",
    MISSION_WEB_ENABLED: "true", CALENDAR_CONNECTIONS_ENABLED: "true", CALENDAR_EVENT_WRITE_ENABLED: "true",
    FEISHU_CALENDAR_APP_ID: "cli_test", FEISHU_CALENDAR_APP_SECRET: "test_secret", FEISHU_CALENDAR_REDIRECT_URI: "https://example.com/api/integrations/feishu-calendar/callback",
    FEISHU_CALENDAR_DEFAULT_TIMEZONE: "Asia/Shanghai", CALENDAR_TOKEN_KEY: key, SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new DB(path.join(dir, "test.sqlite"));
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, missionDetail, commandMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import type { Choice } from "@/lib/mission/contracts";
import { completeCalendarConnection, startCalendarConnection } from "@/lib/services/calendarConnectionService";
import type { CalendarFetch } from "@/lib/calendar/feishuOAuth";

afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolation.dir, { recursive: true, force: true }); });

const startAt = "2026-11-02T02:00:00Z", endAt = "2026-11-02T02:30:00Z";
const tokenBody = { code: 0, msg: "success", access_token: "e-test-access", expires_in: 7200, refresh_token: "e-test-refresh",
  refresh_token_expires_in: 604800, scope: "calendar:calendar offline_access", token_type: "Bearer" };
const identityBody = { code: 0, msg: "success", data: { open_id: "ou_ext", name: "扩展测试", email: "ext@example.com" } };
const calendarBody = { code: 0, msg: "success", data: { has_more: false, calendar_list: [{ calendar_id: "ext_cal", summary: "主日历", type: "primary",
  role: "owner", permissions: "private", is_deleted: false, is_third_party: false }] } };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type Mode = { second?: "ok" | "reject" | "timeout"; attendees?: "ok" | "drop" };
function provider(config: Mode = {}) {
  const events = new Map<string, Record<string, unknown>>();
  const attendees = new Map<string, Array<Record<string, unknown>>>();
  let creates = 0, deletes = 0, next = 1;
  const fake = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname, method = init.method ?? "GET";
    if (url.includes("/authen/v2/oauth/token")) return ok(tokenBody);
    if (url.includes("/authen/v1/user_info")) return ok(identityBody);
    if (path.includes("/calendar/v4/calendars") && !path.includes("/events")) return ok(calendarBody);
    if (path.endsWith("/events") && method === "POST") {
      creates++;
      if (config.second && creates === 2) {
        if (config.second === "reject") return ok({ code: 191002, msg: "no access" }, 403);
        if (config.second === "timeout") throw new TypeError("socket hang up");
      }
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const id = "evt-ext-" + next++;
      const row = { event_id: id, summary: body.summary, description: body.description, start_time: body.start_time, end_time: body.end_time,
        ...(body.recurrence ? { recurrence: body.recurrence } : {}), ...(body.attachments ? { attachments: body.attachments } : {}) };
      events.set(id, row);
      return ok({ code: 0, msg: "success", data: { event: row } });
    }
    const attendeeMatch = path.match(/\/events\/([^/]+)\/attendees$/);
    if (attendeeMatch) {
      const id = attendeeMatch[1];
      if (method === "POST") {
        const body = JSON.parse(String(init.body)) as { attendees: Array<Record<string, unknown>> };
        const rows = body.attendees.map(item => item.type === "user"
          ? { type: "user", user_id: item.user_id, rsvp_status: "needs_action" }
          : { type: "third_party", third_party_email: item.third_party_email, rsvp_status: "needs_action" });
        attendees.set(id, rows);
        return ok({ code: 0, msg: "success", data: { attendees: rows } });
      }
      const rows = attendees.get(id) ?? [];
      return ok({ code: 0, msg: "success", data: { items: config.attendees === "drop" ? rows.slice(0, 1) : rows } });
    }
    const eventMatch = path.match(/\/events\/([^/]+)$/);
    if (eventMatch) {
      const id = eventMatch[1];
      if (method === "DELETE") { deletes++; events.delete(id); attendees.delete(id); return ok({ code: 0, msg: "success" }); }
      const row = events.get(id);
      return row ? ok({ code: 0, msg: "success", data: { event: row } }) : ok({ code: 191000, msg: "not found" }, 404);
    }
    if (path.endsWith("/events") && method === "GET") return ok({ code: 0, msg: "success", data: { has_more: false, items: [...events.values()] } });
    throw new Error("unexpected URL " + url);
  });
  return Object.assign(fake, { creates: () => creates, deletes: () => deletes, events: () => events });
}
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "扩展日历", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "扩展日历项目", goal: "创建测试日程", scenario: "RESEARCH", description: "fixture", memberships: { create: { userId: user.id } } } });
  const started = await startCalendarConnection(user.id, project.id, { requestId: "start", mode: "WRITE" });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const connection = (await completeCalendarConnection(user.id, state, "code", provider() as unknown as CalendarFetch)).connection;
  return { user, project, connection };
}
const decision = (choice: Choice) => ({ choice, provider: "TEST_FIXTURE", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });
async function proposed(userId: string, projectId: string, connectionId: string, fetchImpl: ReturnType<typeof provider>, args: Record<string, unknown>, tool = "propose_calendar_event") {
  const mission = await createMission(userId, { projectId, requestId: "m-" + crypto.randomUUID(), goal: "准备外部日历日程",
    missionConstraints: { executionBoundary: "PROPOSE_ACTION", externalWriteProposal: true } });
  await runMissionSlice({ id: mission.id, provider: async () => decision({ kind: "tool", tool, summary: "准备日程", args }),
    calendarWrite: { fetcher: fetchImpl as unknown as typeof fetch } });
  return mission;
}
async function approve(userId: string, missionId: string, fetchImpl: ReturnType<typeof provider>) {
  const detail = await missionDetail(userId, missionId), approval = detail.approvals[0];
  expect(approval).toBeTruthy();
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  await commandMission(userId, missionId, "approval", { requestId: "approve-" + crypto.randomUUID(), expectedVersion: current.version,
    decision: "APPROVED", proposalHash: approval.proposalHash }, approval.id);
  await runMissionSlice({ id: missionId, calendarWrite: { fetcher: fetchImpl as unknown as typeof fetch } });
}

describe.sequential("单日程参与人与附件", () => {
  it("参与人通过独立接口添加并回读核对，附件随创建写入并回读", async () => {
    const { user, project, connection } = await fixture(), f = provider();
    const mission = await proposed(user.id, project.id, connection.id, f, {
      connectionId: connection.id, title: "小组讨论", description: "带参与人和附件", startAt, endAt, timeZone: "Asia/Shanghai",
      attendees: [{ type: "email", email: "teammate@example.com" }], attachments: ["fileTokenABC"], allDay: false, recurrence: null,
    });
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id), step = detail.steps.find(s => s.toolName === "propose_calendar_event")!;
    expect(step.status).toBe("SUCCEEDED");
    expect(step.result).toMatchObject({ data: { status: "CREATED", readback: { attachments: ["fileTokenABC"] } } });
    const post = f.mock.calls.find(([url, init]) => new URL(String(url)).pathname.endsWith("/events") && (init as RequestInit).method === "POST");
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({ attachments: [{ file_token: "fileTokenABC" }] });
    const attendeesPost = f.mock.calls.find(([url, init]) => String(url).includes("/attendees") && (init as RequestInit).method === "POST");
    expect(JSON.parse(String((attendeesPost?.[1] as RequestInit).body))).toMatchObject({ attendees: [{ type: "third_party", third_party_email: "teammate@example.com" }] });
    expect(f.deletes()).toBe(0);
  });
  it("参与人与冻结提案不一致时删除已创建日程作为补偿", async () => {
    const { user, project, connection } = await fixture(), f = provider({ attendees: "drop" });
    const mission = await proposed(user.id, project.id, connection.id, f, {
      connectionId: connection.id, title: "两人讨论", description: "参与人核对", startAt, endAt, timeZone: "Asia/Shanghai",
      attendees: [{ type: "email", email: "a@example.com" }, { type: "email", email: "b@example.com" }], attachments: [],
    });
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id), step = detail.steps.find(s => s.toolName === "propose_calendar_event")!;
    expect(step.status).toBe("FAILED");
    expect(detail.error).toMatchObject({ code: "CALENDAR_ATTENDEE_MISMATCH" });
    expect(step.result).toMatchObject({ data: { status: "FAILED", compensation: { eventId: "evt-ext-1", deleted: true } } });
    expect(f.deletes()).toBe(1);
    expect(f.events().size).toBe(0);
  });
});

describe.sequential("批量日程与补偿", () => {
  it("批量创建 2 个日程，逐项回读并计入外部写入预算", async () => {
    const { user, project, connection } = await fixture(), f = provider();
    const secondStart = "2026-11-03T02:00:00Z", secondEnd = "2026-11-03T02:30:00Z";
    const mission = await proposed(user.id, project.id, connection.id, f, { connectionId: connection.id, events: [
      { title: "第一次讨论", description: "", startAt, endAt, timeZone: "Asia/Shanghai", allDay: false, recurrence: null, attendees: [], attachments: [] },
      { title: "第二次讨论", description: "", startAt: secondStart, endAt: secondEnd, timeZone: "Asia/Shanghai", allDay: false, recurrence: null, attendees: [], attachments: [] },
    ] }, "propose_calendar_events");
    expect((await missionDetail(user.id, mission.id)).approvals).toHaveLength(1);
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id), step = detail.steps.find(s => s.toolName === "propose_calendar_events")!;
    expect(step.status).toBe("SUCCEEDED");
    expect(step.result).toMatchObject({ data: { status: "CREATED", events: [{ index: 0, externalId: "evt-ext-1" }, { index: 1, externalId: "evt-ext-2" }] } });
    expect(f.creates()).toBe(2);
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).budgetUsedJson).toMatchObject({ externalWrites: 2 });
    const posts = f.mock.calls.filter(([url, init]) => new URL(String(url)).pathname.endsWith("/events") && (init as RequestInit).method === "POST");
    expect(posts.map(([url]) => String(url))).toEqual([expect.stringContaining("pm-cal-b-"), expect.stringContaining("pm-cal-b-")]);
  });
  it("第二个日程被拒绝时删除已创建日程，并记录补偿", async () => {
    const { user, project, connection } = await fixture(), f = provider({ second: "reject" });
    const mission = await proposed(user.id, project.id, connection.id, f, { connectionId: connection.id, events: [
      { title: "第一个", description: "", startAt, endAt, timeZone: "Asia/Shanghai", allDay: false, recurrence: null, attendees: [], attachments: [] },
      { title: "第二个", description: "", startAt: "2026-11-03T02:00:00Z", endAt: "2026-11-03T02:30:00Z", timeZone: "Asia/Shanghai", allDay: false, recurrence: null, attendees: [], attachments: [] },
    ] }, "propose_calendar_events");
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id), step = detail.steps.find(s => s.toolName === "propose_calendar_events")!;
    expect(step.status).toBe("FAILED");
    expect(step.result).toMatchObject({ data: { compensation: { deleted: ["evt-ext-1"], remaining: [] } } });
    expect(f.deletes()).toBe(1);
    expect(f.events().size).toBe(0);
  });
  it("第二个结果未知时保持 UNKNOWN，但删除已确认创建的第一个日程", async () => {
    const { user, project, connection } = await fixture(), f = provider({ second: "timeout" });
    const mission = await proposed(user.id, project.id, connection.id, f, { connectionId: connection.id, events: [
      { title: "第一个", description: "", startAt, endAt, timeZone: "Asia/Shanghai", allDay: false, recurrence: null, attendees: [], attachments: [] },
      { title: "第二个", description: "", startAt: "2026-11-03T02:00:00Z", endAt: "2026-11-03T02:30:00Z", timeZone: "Asia/Shanghai", allDay: false, recurrence: null, attendees: [], attachments: [] },
    ] }, "propose_calendar_events");
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id), step = detail.steps.find(s => s.toolName === "propose_calendar_events")!;
    expect(step.status).toBe("UNKNOWN");
    expect(step.result).toMatchObject({ data: { compensation: { deleted: ["evt-ext-1"] } } });
    expect(f.deletes()).toBe(1);
  });
});


it("首个日程已创建后撤权，不再派发第二次创建或补偿删除",async()=>{
 const {user,project,connection}=await fixture(),base=provider();let writes=0;
 const f=vi.fn(async(url:string,init:RequestInit={})=>{
  const response=await base(url,init);
  if(new URL(url).pathname.endsWith("/events")&&init.method==="POST"&&++writes===1)await db.calendarConnection.update({where:{id:connection.id},data:{status:"REVOKED",revokedAt:new Date(),authGeneration:{increment:1},revision:{increment:1}}});
  return response;
 }) as unknown as ReturnType<typeof provider>;
 const mission=await proposed(user.id,project.id,connection.id,f,{connectionId:connection.id,events:[{title:"撤权前日程",description:"",startAt,endAt,timeZone:"Asia/Shanghai"},{title:"不应派发",description:"",startAt:"2026-11-03T02:00:00Z",endAt:"2026-11-03T02:30:00Z",timeZone:"Asia/Shanghai"}]},"propose_calendar_events");
 await approve(user.id,mission.id,f);
 expect(writes).toBe(1);expect(base.deletes()).toBe(0);
 const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:mission.id,toolName:"propose_calendar_events"}});expect(step.status).toBe("UNKNOWN");
});
