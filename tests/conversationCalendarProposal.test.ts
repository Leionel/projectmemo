import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
const isolation = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path"), DB = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-conv-cal-")), key = Buffer.alloc(32, 9).toString("base64");
  Object.assign(process.env, { DATABASE_URL: "file:" + path.join(dir, "test.sqlite").replaceAll("\\", "/"), LLM_MODE: "mock",
    MISSION_ENABLED: "true", MISSION_UI_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", CALENDAR_CONNECTIONS_ENABLED: "true",
    CALENDAR_EVENT_WRITE_ENABLED: "true", FEISHU_CALENDAR_APP_ID: "cli_test", FEISHU_CALENDAR_APP_SECRET: "test_secret",
    FEISHU_CALENDAR_REDIRECT_URI: "https://example.com/api/integrations/feishu-calendar/callback",
    FEISHU_CALENDAR_DEFAULT_TIMEZONE: "Asia/Shanghai", CALENDAR_TOKEN_KEY: key, SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new DB(path.join(dir, "test.sqlite"));
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); }
  sql.close(); return { dir };
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, readConversation } from "@/lib/conversation/service";
import { createConversationCalendarProposal } from "@/lib/conversation/calendarProposalService";
import { confirmConversationProposal } from "@/lib/conversation/missionCommands";
import { startCalendarConnection, completeCalendarConnection } from "@/lib/services/calendarConnectionService";
import { answerProjectQuestion, executeCopilotTool } from "@/lib/services/copilotService";
import type { CalendarFetch } from "@/lib/calendar/feishuOAuth";

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolation.dir, { recursive: true, force: true }); });

const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const startAt = iso(60 * 60 * 1000), endAt = iso(90 * 60 * 1000);
const tokenBody = { code: 0, msg: "success", access_token: "c-test-access", expires_in: 7200, refresh_token: "c-test-refresh",
  scope: "calendar:calendar offline_access", token_type: "Bearer" };
const identityBody = { code: 0, msg: "success", data: { open_id: "ou_conv", name: "对话写入", email: "conv@example.com" } };
const calendarBody = { code: 0, msg: "success", data: { has_more: false, calendar_list: [{ calendar_id: "conv_cal", summary: "主日历", type: "primary",
  role: "owner", permissions: "private", is_deleted: false, is_third_party: false }] } };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function provider() {
  let created: Record<string, unknown> | null = null, posts = 0;
  const fake = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.includes("/authen/v2/oauth/token")) return ok(tokenBody);
    if (url.includes("/authen/v1/user_info")) return ok(identityBody);
    if (url.includes("/calendar/v4/calendars") && !url.includes("/events")) return ok(calendarBody);
    if (url.includes("/events") && init.method === "POST") {
      posts++;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      created = { event_id: "evt-conv-1", summary: body.summary, description: body.description, start_time: body.start_time,
        end_time: body.end_time, ...(body.recurrence ? { recurrence: body.recurrence } : {}) };
      return ok({ code: 0, msg: "success", data: { event: created } });
    }
    if (url.includes("/events/") && created) return ok({ code: 0, msg: "success", data: { event: created } });
    throw new Error("unexpected URL " + url);
  });
  return Object.assign(fake, { posts: () => posts });
}
async function fixture(mode: "READ" | "WRITE" = "WRITE") {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "对话日历", passwordHash: "unused" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const project = await db.project.create({ data: { title: "对话日历项目", goal: "在讨论中创建日程", description: "fixture", scenario: "RESEARCH",
    memberships: { create: { userId: user.id } } } });
  const connectFetch = vi.fn(async (url: string) => {
    if (url.includes("/authen/v2/oauth/token")) return ok({ ...tokenBody, scope: mode === "WRITE" ? tokenBody.scope : "calendar:calendar:readonly offline_access" });
    if (url.includes("/authen/v1/user_info")) return ok(identityBody);
    if (url.includes("/calendar/v4/calendars")) return ok(calendarBody);
    throw new Error("unexpected URL " + url);
  });
  const started = await startCalendarConnection(user.id, project.id, { requestId: "connect-" + mode, mode });
  const state = new URL(started.authorizationUrl).searchParams.get("state")!;
  const connection = (await completeCalendarConnection(user.id, state, "code", connectFetch as unknown as CalendarFetch)).connection;
  const conversation = await createConversation(actor, { requestId: "conversation-" + crypto.randomUUID(), scope: "PROJECT", projectId: project.id });
  return { user, actor, project, connection, conversation };
}
function proposalInput(f: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
  return { projectId: f.project.id, requestId: "proposal-" + crypto.randomUUID(), expectedVersion: 1, connectionId: f.connection.id,
    title: "小组讨论", description: "对话侧冻结提案", startAt, endAt, timeZone: "Asia/Shanghai", allDay: false, recurrence: null, ...overrides };
}

describe.sequential("Conversation 侧飞书日历外部写提案", () => {
  it("只冻结提案并显示账号与时间，不直接写入；同一 requestId 不重复生成消息", async () => {
    const f = await fixture(), fetchImpl = provider();
    vi.stubGlobal("fetch", fetchImpl);
    const input = proposalInput(f);
    const created = await createConversationCalendarProposal(f.actor, f.conversation.id, input);
    const proposal = created.conversation.messages.at(-1)!.proposal!;
    expect(proposal).toMatchObject({ tool: "create_calendar_event", status: "PENDING" });
    expect(proposal.description).toContain("对话写入");
    expect(proposal.description).toContain("主日历");
    expect(fetchImpl.posts()).toBe(0);
    const before = (await readConversation(f.actor, f.conversation.id)).messages.length;
    const replay = await createConversationCalendarProposal(f.actor, f.conversation.id, input);
    expect((await readConversation(f.actor, f.conversation.id)).messages.length).toBe(before);
    expect(replay.messageId).toBeUndefined();
    await expect(createConversationCalendarProposal(f.actor, f.conversation.id, { ...input, title: "另一个日程" }))
      .rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  });
  it("版本或焦点变化时不冻结提案", async () => {
    const f = await fixture(), fetchImpl = provider();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(createConversationCalendarProposal(f.actor, f.conversation.id, proposalInput(f, { expectedVersion: 9 })))
      .rejects.toMatchObject({ code: "CONVERSATION_CHANGED" });
    const other = await db.project.create({ data: { title: "另一个项目", goal: "无关", description: "fixture", scenario: "RESEARCH",
      memberships: { create: { userId: f.user.id } } } });
    await db.conversation.update({ where: { id: f.conversation.id }, data: { focusJson: { projectId: other.id } } });
    await expect(createConversationCalendarProposal(f.actor, f.conversation.id, proposalInput(f)))
      .rejects.toMatchObject({ code: "CONTEXT_SCOPE_CHANGED" });
  });
  it("只读连接不能提出外部写", async () => {
    const f = await fixture("READ"), fetchImpl = provider();
    vi.stubGlobal("fetch", fetchImpl);
    await expect(createConversationCalendarProposal(f.actor, f.conversation.id, proposalInput(f)))
      .rejects.toMatchObject({ code: "CALENDAR_WRITE_SCOPE_MISSING" });
    expect(fetchImpl.posts()).toBe(0);
  });
  it("批准后只创建一次并回读；重复确认返回原结果，否决后不能再确认", async () => {
    const f = await fixture(), fetchImpl = provider();
    vi.stubGlobal("fetch", fetchImpl);
    const created = await createConversationCalendarProposal(f.actor, f.conversation.id, proposalInput(f));
    const proposal = created.conversation.messages.at(-1)!.proposal!;
    const input = { requestId: "confirm-" + crypto.randomUUID(), proposalHash: proposal.proposalHash, confirmed: true };
    const receipt = await confirmConversationProposal(f.actor, f.conversation.id, proposal.executionId, input);
    expect((receipt as { result?: Record<string, unknown> }).result).toMatchObject({ externalId: "evt-conv-1", calendarId: "conv_cal", status: "CREATED" });
    expect(fetchImpl.posts()).toBe(1);
    const post = fetchImpl.mock.calls.find(([url, init]) => String(url).includes("/events") && (init as RequestInit).method === "POST");
    expect(String(post?.[0])).toContain("idempotency_key=pm-cal-");
    const again = await confirmConversationProposal(f.actor, f.conversation.id, proposal.executionId, input);
    expect(again.alreadyExecuted).toBe(true);
    expect(fetchImpl.posts()).toBe(1);
    expect((await readConversation(f.actor, f.conversation.id)).messages.at(-1)!.proposal!.resultId).toBe("evt-conv-1");
  });
  it("否决提案后确认被拒绝且不写入", async () => {
    const f = await fixture(), fetchImpl = provider();
    vi.stubGlobal("fetch", fetchImpl);
    const created = await createConversationCalendarProposal(f.actor, f.conversation.id, proposalInput(f));
    const proposal = created.conversation.messages.at(-1)!.proposal!;
    const base = { requestId: "decline-" + crypto.randomUUID(), proposalHash: proposal.proposalHash, confirmed: true };
    await db.copilotToolExecution.update({ where: { id: proposal.executionId }, data: { status: "DECLINED" } });
    await expect(confirmConversationProposal(f.actor, f.conversation.id, proposal.executionId, base))
      .rejects.toMatchObject({ code: "PROPOSAL_DECLINED" });
    expect(fetchImpl.posts()).toBe(0);
  });
  it("全天与重复日程按冻结字段创建并回读", async () => {
    const f = await fixture(), fetchImpl = provider();
    vi.stubGlobal("fetch", fetchImpl);
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const created = await createConversationCalendarProposal(f.actor, f.conversation.id,
      proposalInput(f, { allDay: true, startAt: day, endAt: day, recurrence: "FREQ=WEEKLY;BYDAY=MO" }));
    const proposal = created.conversation.messages.at(-1)!.proposal!;
    const receipt = await confirmConversationProposal(f.actor, f.conversation.id, proposal.executionId,
      { requestId: "all-day-" + crypto.randomUUID(), proposalHash: proposal.proposalHash, confirmed: true });
    expect((receipt as { result?: Record<string, unknown> }).result).toMatchObject({ status: "CREATED", externalId: "evt-conv-1" });
    const post = fetchImpl.mock.calls.find(([url, init]) => String(url).includes("/events") && (init as RequestInit).method === "POST");
    const body = JSON.parse(String((post?.[1] as RequestInit).body));
    expect(body.start_time).toMatchObject({ date: day });
    expect(body.recurrence).toBe("FREQ=WEEKLY;BYDAY=MO");
  });
  it("项目 Copilot 只引用已授权连接提出日程，确认后写入一次", async () => {
    const f = await fixture(), fetchImpl = provider();
    vi.stubGlobal("fetch", fetchImpl);
    const capture = await db.capture.create({ data: { projectId: f.project.id, rawText: "实验记录已整理，下一步需要安排讨论。", sourceType: "fixture" } });
    await db.knowledgeCard.create({ data: { projectId: f.project.id, captureId: capture.id, title: "实验记录", summary: "实验记录已整理，下一步需要安排讨论。",
      type: "experiment_log", keywords: ["实验记录", "下一步"], relatedTasks: [], nextActions: [], importance: 3 } });
    const answer = await answerProjectQuestion(f.project.id, "实验记录 下一步 做什么，安排一个飞书日历日程", f.actor, "copilot-" + crypto.randomUUID());
    const action = answer.proposedActions.find(item => item.kind === "create_calendar_event");
    expect(action).toMatchObject({ connectionId: f.connection.id });
    expect(fetchImpl.posts()).toBe(0);
    const receipt = await executeCopilotTool(f.project.id, { tool: "create_calendar_event", confirmed: true, sourceRunId: answer.runId,
      payload: { title: action!.title, description: action!.description, startAt: action!.startAt, endAt: action!.endAt, timeZone: action!.timeZone,
        allDay: action!.allDay, recurrence: action!.recurrence } }, f.actor);
    expect(receipt.result).toMatchObject({ externalId: "evt-conv-1", status: "CREATED" });
    expect(fetchImpl.posts()).toBe(1);
  });
});

for(const phase of ["UNKNOWN","DISPATCHING"]){
 it(`创建成功后回读中断，${phase}跨时段只读核对，不重发POST`,async()=>{
  const f=await fixture(),api=provider();let fail=true;
  const network=vi.fn(async(url:string,init:RequestInit={})=>{if(url.includes("/events/")&&(!init.method||init.method==="GET")&&fail)throw new TypeError("lost readback");return api(url,init);});
  vi.stubGlobal("fetch",network);
  const created=await createConversationCalendarProposal(f.actor,f.conversation.id,proposalInput(f,{description:"证".repeat(400)}));
  const proposal=created.conversation.messages.at(-1)!.proposal!;
  const body={requestId:"recover-"+crypto.randomUUID(),proposalHash:proposal.proposalHash,confirmed:true};
  await expect(confirmConversationProposal(f.actor,f.conversation.id,proposal.executionId,body)).rejects.toMatchObject({code:"CALENDAR_WRITE_UNKNOWN"});
  expect(await db.copilotToolExecution.findUniqueOrThrow({where:{id:proposal.executionId}})).toMatchObject({status:"UNKNOWN",resultId:"evt-conv-1"});
  if(phase==="DISPATCHING")await db.copilotToolExecution.update({where:{id:proposal.executionId},data:{status:"DISPATCHING",leaseToken:"dead-process",leaseUntil:new Date(Date.now()-1000)}});
  fail=false;const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+70*60000);
  try{const receipt=await confirmConversationProposal(f.actor,f.conversation.id,proposal.executionId,body);expect(receipt).toMatchObject({alreadyExecuted:true,result:{status:"CREATED",reconciled:true}});}finally{clock.mockRestore();}
  expect(api.posts()).toBe(1);
  expect(await db.copilotToolExecution.findUniqueOrThrow({where:{id:proposal.executionId}})).toMatchObject({status:"COMMITTED",leaseToken:null});
 });
}
it("两次同时确认只能派发一笔创建",async()=>{
 const f=await fixture(),api=provider();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 vi.stubGlobal("fetch",async(url:string,init:RequestInit={})=>{if(url.includes("/events")&&init.method==="POST"){entered();await gate;}return api(url,init);});
 const created=await createConversationCalendarProposal(f.actor,f.conversation.id,proposalInput(f)),proposal=created.conversation.messages.at(-1)!.proposal!;
 const body={requestId:"concurrent-"+crypto.randomUUID(),proposalHash:proposal.proposalHash,confirmed:true};
 const first=confirmConversationProposal(f.actor,f.conversation.id,proposal.executionId,body);await started;
 await expect(confirmConversationProposal(f.actor,f.conversation.id,proposal.executionId,body)).rejects.toMatchObject({code:"COPILOT_CONFIRMATION_IN_PROGRESS"});
 release();await first;expect(api.posts()).toBe(1);
});

it("只读核对遇到过期token不认领刷新、不消耗原旋转凭据",async()=>{
 const f=await fixture(),api=provider();let fail=true;
 vi.stubGlobal("fetch",async(url:string,init:RequestInit={})=>{if(url.includes("/events/")&&fail)throw new TypeError("lost readback");return api(url,init);});
 const created=await createConversationCalendarProposal(f.actor,f.conversation.id,proposalInput(f)),proposal=created.conversation.messages.at(-1)!.proposal!;
 const body={requestId:"expired-recovery",proposalHash:proposal.proposalHash,confirmed:true};
 await expect(confirmConversationProposal(f.actor,f.conversation.id,proposal.executionId,body)).rejects.toMatchObject({code:"CALENDAR_WRITE_UNKNOWN"});
 const before=await db.calendarConnection.findUniqueOrThrow({where:{id:f.connection.id}});fail=false;
 const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+3*3600000);
 try{await expect(confirmConversationProposal(f.actor,f.conversation.id,proposal.executionId,body)).rejects.toMatchObject({code:"COPILOT_RESULT_UNKNOWN"});}finally{clock.mockRestore();}
 const after=await db.calendarConnection.findUniqueOrThrow({where:{id:f.connection.id}});expect(after.tokenVersion).toBe(before.tokenVersion);expect(after.tokenCipher).toBe(before.tokenCipher);expect(api.posts()).toBe(1);
});
