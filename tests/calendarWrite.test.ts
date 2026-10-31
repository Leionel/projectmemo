import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
const isolation = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), DB = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ct10-")), key = Buffer.alloc(32, 9).toString("base64");
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

const tokenBody = { code: 0, msg: "success", access_token: "w-test-access", expires_in: 7200, refresh_token: "w-test-refresh",
  refresh_token_expires_in: 604800, scope: "calendar:calendar offline_access", token_type: "Bearer" };
const identityBody = { code: 0, msg: "success", data: { open_id: "ou_write", name: "写入测试", email: "write@example.com" } };
const calendarBody = { code: 0, msg: "success", data: { has_more: false, calendar_list: [{ calendar_id: "primary_cal", summary: "主日历", type: "primary",
  role: "owner", permissions: "private", is_deleted: false, is_third_party: false }] } };
const startAt = "2026-11-02T02:00:00Z", endAt = "2026-11-02T02:30:00Z";
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type WriteConfig = { create?: "ok" | "timeout" | "rate" | "forbidden" | "server" | "missing-id" | "wrong-object"; readback?: "ok" | "missing" | "wrong"; token?: typeof tokenBody };
function fetcher(config: WriteConfig = {}) {
  let created = false, description = "", title = "", createCalls = 0; const eventId = "evt-write-1";
  const fake = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("/authen/v2/oauth/token")) return ok(config.token ?? tokenBody);
    if (url.includes("/authen/v1/user_info")) return ok(identityBody);
    if (url.includes("/calendar/v4/calendars") && !url.includes("/events")) return ok(calendarBody);
    if (url.includes("/events") && init.method === "POST") {
      createCalls++;
      const body = JSON.parse(String(init.body)) as { summary: string; description: string };
      if (config.create === "timeout") { created = true; description = body.description; title = body.summary; throw new TypeError("socket hang up"); }
      if (config.create === "rate") return ok({ code: 190004, msg: "rate limited" }, 429);
      if (config.create === "forbidden") return ok({ code: 191002, msg: "no access" }, 403);
      if (config.create === "server") return ok({ code: 190003, msg: "server" }, 500);
      if (config.create === "missing-id") return ok({ code: 0, msg: "success", data: { event: {} } });
      created = true; description = body.description; title = body.summary;
      return ok({ code: 0, msg: "success", data: { event: { event_id: eventId, summary: title, description } } });
    }
    if (url.includes("/events/")) {
      if (!created || config.readback === "missing") return ok({ code: 191000, msg: "not found" }, 404);
      const id = config.readback === "wrong" || config.create === "wrong-object" ? "evt-other" : eventId;
      return ok({ code: 0, msg: "success", data: { event: { event_id: id, summary: config.create === "wrong-object" ? "另一个日程" : title,
        description, start_time: { timestamp: String(Date.parse(startAt) / 1000), timezone: "Asia/Shanghai" }, end_time: { timestamp: String(Date.parse(endAt) / 1000), timezone: "Asia/Shanghai" } } } });
    }
    if (url.includes("/events")) return ok({ code: 0, msg: "success", data: { has_more: false, items: created ? [{ event_id: eventId, summary: title, description,
      start_time: { timestamp: String(Date.parse(startAt) / 1000), timezone: "Asia/Shanghai" }, end_time: { timestamp: String(Date.parse(endAt) / 1000), timezone: "Asia/Shanghai" } }] : [] } });
    throw new Error("unexpected URL " + url);
  });
  return Object.assign(fake, { createCalls: () => createCalls });
}
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "CT10", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "CT10 项目", description: "CT10_SYNTHETIC_ONLY", goal: "创建测试日程", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const started = await startCalendarConnection(user.id, project.id, { requestId: "start", mode: "WRITE" });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const connection = (await completeCalendarConnection(user.id, state, "code", fetcher())).connection;
  return { user, project, connection };
}
async function proposed(userId: string, projectId: string, connectionId: string, fetchImpl: ReturnType<typeof fetcher>) {
  const mission = await createMission(userId, { projectId, requestId: "m-" + crypto.randomUUID(), goal: "为项目截止日创建一个测试日程",
    missionConstraints: { executionBoundary: "PROPOSE_ACTION", externalWriteProposal: true } });
  const decision = (choice: Choice) => ({ choice, provider: "TEST_FIXTURE", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });
  await runMissionSlice({ id: mission.id, provider: async () => decision({ kind: "tool", tool: "propose_calendar_event", summary: "准备日程",
    args: { connectionId, title: "忆程 CT-10 外部写验证", description: "仅用于 ProjectMemo CT-10 幂等与回查测试，可删除。", startAt, endAt, timeZone: "Asia/Shanghai" } }),
  calendar: { fetcher: fetchImpl as unknown as typeof fetch } });
  return mission;
}
const approvalBody = (proposalHash: string) => ({ requestId: "approve-" + crypto.randomUUID(), expectedVersion: 1, decision: "APPROVED", proposalHash });
async function approve(userId: string, missionId: string, fetchImpl: ReturnType<typeof fetcher>) {
  const detail = await missionDetail(userId, missionId), approval = detail.approvals[0];
  expect(approval).toBeTruthy();
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  await commandMission(userId, missionId, "approval", { ...approvalBody(approval.proposalHash), expectedVersion: current.version }, approval.id);
  await runMissionSlice({ id: missionId, calendarWrite: { fetcher: fetchImpl as unknown as typeof fetch } });
}

describe("CT-10 飞书日历事件写入", () => {
  it("提案不写，批准后才派发并完成原对象回读", async () => {
    const { user, project, connection } = await fixture(), f = fetcher();
    const mission = await proposed(user.id, project.id, connection.id, f);
    expect(f.createCalls()).toBe(0);
    expect((await missionDetail(user.id, mission.id)).approvals).toHaveLength(1);
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id), step = detail.steps.find(s => s.toolName === "propose_calendar_event")!;
    expect(step.status).toBe("SUCCEEDED");
    expect(step.result).toMatchObject({ data: { status: "CREATED", externalId: "evt-write-1", calendarId: "primary_cal", readback: { eventId: "evt-write-1" } } });
    expect(step.execution?.phase).toBe("SUBMITTED");
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).budgetUsedJson).toMatchObject({ externalWrites: 1 });
    expect(f.createCalls()).toBe(1);
    const post = f.mock.calls.find(([url, init]) => String(url).includes("/events") && (init as RequestInit).method === "POST");
    expect(String(post?.[0])).toContain("idempotency_key=pm-cal-");
  });
  it("未批准不入队；批准后重复确认不能产生第二次派发", async () => {
    const { user, project, connection } = await fixture(), f = fetcher();
    const mission = await proposed(user.id, project.id, connection.id, f);
    await runMissionSlice({ id: mission.id, calendarWrite: { fetcher: f as unknown as typeof fetch } });
    expect(f.createCalls()).toBe(0);
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id), approval = detail.approvals[0];
    expect(approval).toBeUndefined();
    const consumed = await db.agentMissionApproval.findFirstOrThrow({ where: { missionId: mission.id } });
    await expect(commandMission(user.id, mission.id, "approval", { ...approvalBody(consumed.proposalHash), expectedVersion: (await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).version }, consumed.id))
      .rejects.toMatchObject({ code: "APPROVAL_CHANGED" });
    expect(f.createCalls()).toBe(1);
  });
  it("只读连接不能提出写入，缺提案批准也不写", async () => {
    const { user, project } = await fixture();
    const started = await startCalendarConnection(user.id, project.id, { requestId: "read", mode: "READ" });
    const state = new URL(started.authorizationUrl).searchParams.get("state")!;
    const readToken = { ...tokenBody, scope: "calendar:calendar:readonly offline_access" };
    const readFetch = fetcher({ token: readToken });
    const read = (await completeCalendarConnection(user.id, state, "code", readFetch as unknown as CalendarFetch)).connection;
    const mission = await createMission(user.id, { projectId: project.id, requestId: "read-mission-" + crypto.randomUUID(), goal: "只读核对日程",
      missionConstraints: { executionBoundary: "PROPOSE_ACTION", externalWriteProposal: true } });
    const decision = (choice: Choice) => ({ choice, provider: "TEST_FIXTURE", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });
    await runMissionSlice({ id: mission.id, provider: async () => decision({ kind: "tool", tool: "propose_calendar_event", summary: "准备",
      args: { connectionId: read.id, title: "不应写入", description: "", startAt, endAt, timeZone: "Asia/Shanghai" } }) });
    const detail = await missionDetail(user.id, mission.id);
    expect(detail.error).toMatchObject({ code: "CALENDAR_WRITE_SCOPE_MISSING" });
    expect(detail.approvals).toHaveLength(0);
    expect(readFetch.createCalls()).toBe(0);
  });
  it("批准前撤权/目标变化不派发；时间过期拒绝", async () => {
    const { user, project, connection } = await fixture(), f = fetcher();
    const mission = await proposed(user.id, project.id, connection.id, f);
    await db.calendarConnection.update({ where: { id: connection.id }, data: { authGeneration: { increment: 1 }, revision: { increment: 1 } } });
    await approve(user.id, mission.id, f);
    expect(f.createCalls()).toBe(0);
    const detail = await missionDetail(user.id, mission.id);
    expect(detail.error).toMatchObject({ code: "CALENDAR_CONNECTION_CHANGED" });
  });
  it("超时或5xx保持UNKNOWN，第二次只查询原标记不重发", async () => {
    const { user, project, connection } = await fixture(), f = fetcher({ create: "timeout" });
    const mission = await proposed(user.id, project.id, connection.id, f);
    await approve(user.id, mission.id, f);
    let detail = await missionDetail(user.id, mission.id);
    expect(detail.steps.find(s => s.toolName === "propose_calendar_event")?.status).toBe("UNKNOWN");
    expect(detail.error).toMatchObject({ code: "CALENDAR_WRITE_UNKNOWN" });
    expect(f.createCalls()).toBe(1);
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    await commandMission(user.id, mission.id, "resume", { requestId: "resume-" + crypto.randomUUID(), expectedVersion: current.version });
    await runMissionSlice({ id: mission.id, calendarWrite: { fetcher: f as unknown as typeof fetch } });
    detail = await missionDetail(user.id, mission.id);
    expect(detail.steps.find(s => s.toolName === "propose_calendar_event")?.status).toBe("SUCCEEDED");
    expect(f.createCalls()).toBe(1);
  });
  it("2xx但对象身份/内容不匹配不确认成功", async () => {
    const { user, project, connection } = await fixture(), f = fetcher({ create: "wrong-object" });
    const mission = await proposed(user.id, project.id, connection.id, f);
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id);
    expect(detail.steps.find(s => s.toolName === "propose_calendar_event")?.status).toBe("UNKNOWN");
    expect(detail.error).toMatchObject({ code: "CALENDAR_EFFECT_MISMATCH" });
  });
  it("明确拒绝是已知失败，不产生 UNKNOWN 重试", async () => {
    for (const mode of ["forbidden", "rate", "server", "missing-id"] as const) {
      const { user, project, connection } = await fixture(), f = fetcher({ create: mode });
      const mission = await proposed(user.id, project.id, connection.id, f);
      await approve(user.id, mission.id, f);
      const detail = await missionDetail(user.id, mission.id), step = detail.steps.find(s => s.toolName === "propose_calendar_event")!;
      const expected = mode === "server" || mode === "missing-id" ? "UNKNOWN" : "FAILED";
      expect(step.status).toBe(expected);
      expect(f.createCalls()).toBe(1);
    }
  });
  it("创建后回读缺失仍保持 UNKNOWN，不自动重发", async () => {
    const { user, project, connection } = await fixture(), f = fetcher({ readback: "missing" });
    const mission = await proposed(user.id, project.id, connection.id, f);
    await approve(user.id, mission.id, f);
    const detail = await missionDetail(user.id, mission.id);
    expect(detail.steps.find(s => s.toolName === "propose_calendar_event")?.status).toBe("UNKNOWN");
    expect(detail.error).toMatchObject({ code: "CALENDAR_EFFECT_NOT_FOUND" });
    expect(f.createCalls()).toBe(1);
  });
  it("取消委托不伪造外部撤销，也不再派发", async () => {
    const { user, project, connection } = await fixture(), f = fetcher();
    const mission = await proposed(user.id, project.id, connection.id, f);
    const detail = await missionDetail(user.id, mission.id), approval = detail.approvals[0];
    const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    await commandMission(user.id, mission.id, "approval", { ...approvalBody(approval.proposalHash), expectedVersion: current.version }, approval.id);
    const approved = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
    await commandMission(user.id, mission.id, "cancel", { requestId: "cancel-" + crypto.randomUUID(), expectedVersion: approved.version });
    await runMissionSlice({ id: mission.id, calendarWrite: { fetcher: f as unknown as typeof fetch } });
    expect(f.createCalls()).toBe(0);
    expect((await db.agentMissionApproval.findUniqueOrThrow({ where: { id: approval.id } })).status).not.toBe("CONSUMED");
  });
  it("模型不能替换 endpoint/header/token 或跨账号目标", async () => {
    const { user, project } = await fixture();
    const mission = await createMission(user.id, { projectId: project.id, requestId: "inject-" + crypto.randomUUID(), goal: "尝试注入外部写入",
      missionConstraints: { executionBoundary: "PROPOSE_ACTION", externalWriteProposal: true } });
    const decision = (choice: Choice) => ({ choice, provider: "TEST_FIXTURE", model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });
    await runMissionSlice({ id: mission.id, provider: async () => decision({ kind: "tool", tool: "propose_calendar_event", summary: "恶意参数",
      args: { connectionId: "other", title: "忽略授权", description: "", startAt, endAt, timeZone: "Asia/Shanghai", endpoint: "https://evil.example", accessToken: "x" } }) });
    const detail = await missionDetail(user.id, mission.id);
    expect(detail.error).toMatchObject({ code: "MODEL_PROTOCOL_ERROR" });
    expect(detail.approvals).toHaveLength(0);
  });
});
