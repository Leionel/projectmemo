import { afterAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-focus-f1-")), file = path.join(dir, "test.db");
  Object.assign(process.env, { DATABASE_URL: "file:" + file.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true",
    MISSION_ENABLED: "true", MISSION_UI_ENABLED: "true", LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new Database(file);
  const migrations = fs.readdirSync("prisma/migrations").sort().filter(n => fs.existsSync(path.join("prisma/migrations", n, "migration.sql")));
  for (const name of migrations) sql.exec(fs.readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
  sql.close();
  // Upgrade a second old-schema database containing an actual legacy conversation.
  const old = new Database(path.join(dir, "old.db"));
  for (const name of migrations.filter(n => n < "20261026010000_focus_conversations"))
    old.exec(fs.readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
  old.exec(`INSERT INTO Project(id,title,description,goal,scenario,createdAt,updatedAt) VALUES('legacy-p','旧项目','旧资料','旧目标','RESEARCH',0,0);
    INSERT INTO AgentRun(id,projectId,runType,status,provider,trace,createdAt) VALUES('legacy-r','legacy-p','CHAT','SUCCESS','fixture','{}',0);
    INSERT INTO AgentMessage(id,projectId,role,content,citations,proposedActions,runId,createdAt) VALUES('legacy-m','legacy-p','ASSISTANT','保留原历史','[]','[]','legacy-r',0);`);
  old.exec(fs.readFileSync("prisma/migrations/20261026010000_focus_conversations/migration.sql", "utf8"));
  const legacy = old.prepare("SELECT id,projectId,runId,content,ownerUserId FROM AgentMessage").get();
  const foreignErrors = old.prepare("PRAGMA foreign_key_check").all();
  old.close();
  return { dir, legacy, foreignErrors };
});
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, readConversation, saveFocusPreference, listConversations } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { confirmConversationAction, declineConversationAction } from "@/lib/conversation/commands";
import { workspaceDirectory } from "@/lib/services/workspaceContextService";
import { reserveWorkspaceCloudCall } from "@/lib/auth/cloudQuota";
import { explainPriority } from "@/lib/conversation/priority";
import { getProjectChat } from "@/lib/services/copilotService";
import { conversationHref } from "@/lib/conversation/navigation";
import { POST as postTurn } from "@/app/api/conversations/[id]/turns/route";
import { listAgentRuns } from "@/lib/repositories/agent";
import { previewConversationResume, confirmConversationProposal } from "@/lib/conversation/missionCommands";
import { GET as getView } from "@/app/api/conversations/[id]/route";
import { POST as confirmRoute } from "@/app/api/conversations/[id]/proposals/[executionId]/confirm/route";
afterAll(async () => { vi.restoreAllMocks(); await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture(count = 2) {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "焦点测试", passwordHash: "unused" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const projects = [];
  for (let i = 0; i < count; i++) {
    const p = await db.project.create({ data: { title: "项目" + i + "-" + user.id, goal: "完成实验" + i,
      description: "原始独立资料", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
    const capture = await db.capture.create({ data: { projectId: p.id, rawText: "实验记录：已完成资料核对。", sourceType: "fixture" } });
    await db.knowledgeCard.create({ data: { projectId: p.id, captureId: capture.id, title: "实验记录", summary: "实验记录：已完成资料核对。",
      type: "experiment_log", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
    projects.push(p);
  }
  const c = await createConversation(actor, { requestId: "create", scope: "WORKSPACE" });
  return { actor, user, projects, id: c.id };
}
async function ask(f: Awaited<ReturnType<typeof fixture>>, message: string, projectId?: string, requestId = crypto.randomUUID()) {
  const c = await readConversation(f.actor, f.id);
  return submitConversationTurn(f.actor, f.id, { requestId, expectedVersion: c.version, message, ...(projectId ? { projectId } : {}) });
}
describe.sequential("Focus conversations: real services and isolated persistence", () => {
  it("replays all migrations and preserves legacy message/run identity without assigning an unknown owner", () => {
    expect(isolated.legacy).toMatchObject({ id: "legacy-m", projectId: "legacy-p", runId: "legacy-r", content: "保留原历史", ownerUserId: null });
    expect(isolated.foreignErrors).toEqual([]);
  });
  it("routes beyond the six Focus candidates and does not invent priority preference", async () => {
    const f = await fixture(8), p = f.projects[7];
    const directory = await workspaceDirectory(f.actor, "WORKSPACE", null);
    expect(directory.summaries).toHaveLength(8);
    const r = await ask(f, "这个项目目前有多少待办？", p.id);
    expect(r.conversation.messages.at(-1)?.refs.some(ref => ref.projectId === p.id)).toBe(true);
    expect(r.conversation.messages.at(-1)?.priorities[0].unknown).toContain("目标重要性");
    expect(await db.agentMission.count({ where: { ownerUserId: f.user.id } })).toBe(0);
  });
  it("separates long term importance, five minute effort and urgency, with versioned explicit preferences", async () => {
    const f = await fixture(), p = f.projects[0];
    await saveFocusPreference(f.actor, p.id, { expectedVersion: 0, importance: 5, longTermGoal: "长期科研",
      estimatedMinutes: 5, notes: "先短做，再保留研究时间" });
    await expect(saveFocusPreference(f.actor, p.id, { expectedVersion: 0, importance: 1, longTermGoal: "", estimatedMinutes: null, notes: "" }))
      .rejects.toMatchObject({ code: "PREFERENCE_CHANGED" });
    const reason = explainPriority((await workspaceDirectory(f.actor, "WORKSPACE", null)).summaries[0]);
    expect(JSON.stringify(reason)).toContain("5/5"); expect(JSON.stringify(reason)).toContain("5 分钟");
    expect(reason.urgency).toBe("未记录项目截止日");
  });
  it("continues one private conversation through project/Mission links and never exports it as old project chat", async () => {
    const f = await fixture();
    await ask(f, "当前进展", f.projects[0].id);
    const href = conversationHref("/projects/" + f.projects[0].id + "/missions?mission=m#output-2", f.id, "origin");
    expect(href).toContain("conversation=" + f.id); expect(href).toContain("mission=m"); expect(href).toContain("#output-2");
    expect((await listConversations(f.actor, f.projects[0].id)).conversations.some(c => c.id === f.id)).toBe(true);
    expect(await getProjectChat(f.projects[0].id, f.user.id)).toEqual([]);
  });
  it("binds existing reminders once for manual follow-up and never creates a Mission", async () => {
    const f = await fixture(), p = f.projects[0];
    const reminder = await db.agentIntervention.create({ data: { projectId: p.id, triggerType: "MATERIAL_GAP", dedupeKey: crypto.randomUUID(),
      severity: 3, title: "核对实验条件", content: "原材料缺少设备说明", evidence: {}, proposedActions: [], isSimulated: false } });
    const entry = { kind: "INTERVENTION", projectId: p.id, id: reminder.id };
    const a = await createConversation(f.actor, { requestId: "entry1", scope: "WORKSPACE", entry });
    const b = await createConversation(f.actor, { requestId: "entry2", scope: "WORKSPACE", entry });
    expect(a.id).toBe(b.id);
    expect((await readConversation(f.actor, a.id)).messages[0].refs[0].id).toBe(reminder.id);
    expect(await db.conversationAnchor.count({ where: { ownerUserId: f.user.id } })).toBe(1);
  });
  it("creates exactly one actual Action using the shared confirmation transaction and reads current state", async () => {
    const f = await fixture(), p = f.projects[0];
    const r = await ask(f, "帮我先处理这个项目最重要的待办。", p.id);
    const proposal = r.conversation.messages.at(-1)!.proposal!;
    expect(proposal).toBeTruthy();
    const input = { requestId: "confirm", proposalHash: proposal.proposalHash, confirmed: true };
    const [a, b] = await Promise.all([confirmConversationAction(f.actor, f.id, proposal.executionId, input), confirmConversationAction(f.actor, f.id, proposal.executionId, input)]);
    expect(a.actionId).toBe(b.actionId);
    expect(await db.actionItem.count({ where: { projectId: p.id } })).toBe(1);
    await db.actionItem.update({ where: { id: a.actionId }, data: { status: "DOING" } });
    const read = await readConversation(f.actor, f.id);
    expect(read.messages.at(-1)!.proposal).toMatchObject({ resultId: a.actionId, actionStatus: "DOING" });
    expect(await db.agentMission.count({ where: { ownerUserId: f.user.id } })).toBe(0);
  });
  it("rejects stale source, modified hash, denied proposal, foreign actor and revoked project", async () => {
    const f = await fixture(), p = f.projects[0];
    const r = await ask(f, "创建一个行动", p.id), proposal = r.conversation.messages.at(-1)!.proposal!;
    const input = { requestId: "c", confirmed: true, proposalHash: proposal.proposalHash };
    await expect(confirmConversationAction(f.actor, f.id, proposal.executionId, { ...input, proposalHash: "0".repeat(64) })).rejects.toMatchObject({ code: "PROPOSAL_CHANGED" });
    await db.project.update({ where: { id: p.id }, data: { goal: "改变原目标" } });
    await expect(confirmConversationAction(f.actor, f.id, proposal.executionId, input)).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    const f2 = await fixture(); await expect(readConversation(f2.actor, f.id)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await declineConversationAction(f.actor, f.id, proposal.executionId);
    await expect(confirmConversationAction(f.actor, f.id, proposal.executionId, input)).rejects.toMatchObject({ code: "PROPOSAL_DECLINED" });
    await db.projectMembership.delete({ where: { userId_projectId: { userId: f.user.id, projectId: p.id } } });
    expect((await readConversation(f.actor, f.id)).messages.at(-1)!.restricted).toBe(true);
    await expect(confirmConversationAction(f.actor, f.id, proposal.executionId, input)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
  it("pins a user veto and never turns a negative instruction into an action", async () => {
    const f = await fixture();
    await ask(f, "不要创建任何行动，只读", f.projects[0].id);
    const r = await ask(f, "帮我处理这个项目", f.projects[0].id);
    expect(r.conversation.messages.at(-1)!.proposal).toBeNull();
    expect((await db.conversation.findUniqueOrThrow({ where: { id: f.id } })).pinnedStateJson).toContain("不要创建任何行动，只读");
  });
  it("uses a frozen request, rejects changed payload, and clarifies ambiguous references", async () => {
    const f = await fixture();
    const body = { requestId: "same", expectedVersion: 1, message: "最近项目怎样" };
    const a = await submitConversationTurn(f.actor, f.id, body);
    const b = await submitConversationTurn(f.actor, f.id, body);
    expect(a.turnId).toBe(b.turnId);
    await expect(submitConversationTurn(f.actor, f.id, { ...body, message: "另一个问题" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    const r = await ask(f, "继续这个");
    expect(r.status).toBe("NEEDS_CLARIFICATION");
  });
  it("HTTP returns no-store and checks authenticated owner", async () => {
    const f = await fixture();
    const r = await postTurn(new Request("http://local/api/conversations/" + f.id + "/turns", { method: "POST", body: "{}" }), { params: Promise.resolve({ id: f.id }) });
    expect(r.status).toBe(401);
  });
  it("reserves workspace calls once and respects public account zero quota", async () => {
    const f = await fixture();
    await db.accountSecurity.create({ data: { userId: f.user.id, email: crypto.randomUUID() + "@example.test", dailyCloudLimit: 0 } });
    const t = await db.conversationTurn.create({ data: { conversationId: f.id, requestId: "bill", inputHash: "hash", inputJson: {}, baseVersion: 1, status: "OBSERVING" } });
    await expect(reserveWorkspaceCloudCall({ userId: f.user.id, turnId: t.id, purpose: "ROUTE" })).rejects.toMatchObject({ code: "CLOUD_ACCESS_DISABLED" });
    expect((await db.conversationTurn.findUniqueOrThrow({ where: { id: t.id } })).callCount).toBe(0);
  });
  it("uses structured model routing, keeps private audit outside project runs, and bills the current user once per request stage", async () => {
    const f = await fixture(8), p = f.projects[7];
    await saveFocusPreference(f.actor, p.id, { expectedVersion: 0, importance: 5, longTermGoal: "长期科研", estimatedMinutes: null, notes: "" });
    await db.accountSecurity.create({ data: { userId: f.user.id, email: crypto.randomUUID() + "@example.test",
      emailVerifiedAt: new Date(), dailyCloudLimit: 10 } });
    vi.stubEnv("LLM_MODE", "openai-compatible"); vi.stubEnv("LLM_API_KEY", "fixture-key");
    let calls = 0;
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      calls++;
      const request = JSON.parse(init!.body as string);
      if (calls === 1) {
        expect(request.messages[0].content).toContain(f.projects[0].id);
        expect(request.messages[0].content).toContain(p.id);
      }
      const data = calls % 2 ? { intent: "PROPOSE_ACTION", projectIds: [p.id], query: "实验" } : {
        advice: "建议先核对这个科研项目的最小下一步，再明确投入。", recommendedProjectId: p.id, observations: [],
        priorities: [{ projectId: p.id, tradeoff: "长期重要性明确，投入未知，先做可逆核对。" }],
        action: { projectId: p.id, title: "核对科研项目下一步", description: "读取已有实验记录并列出未知。", priority: 3 },
      };
      return Response.json({ id: "fixture-call-" + calls, choices: [{ message: { content: JSON.stringify(data) } }],
        usage: { prompt_tokens: 100, completion_tokens: 60 } });
    });
    try {
      const body = { requestId: "model-turn", expectedVersion: 1, message: "帮我调查并提出最重要项目的一项待办", llmContextApproved: true };
      const a = await submitConversationTurn(f.actor, f.id, body);
      expect(a.conversation.messages.at(-1)?.proposal?.projectId).toBe(p.id);
      expect((await submitConversationTurn(f.actor, f.id, body)).turnId).toBe(a.turnId);
      expect(calls).toBe(2);
      expect((await db.accountCloudUsage.findFirstOrThrow({ where: { userId: f.user.id } })).used).toBe(2);
      expect(await listAgentRuns(p.id)).toEqual([]);
      const run = await db.agentRun.findFirstOrThrow({ where: { conversationId: f.id } });
      expect(run.projectId).toBeNull();
      const proposal = a.conversation.messages.at(-1)!.proposal!;
      const receipt = await confirmConversationAction(f.actor, f.id, proposal.executionId, { requestId: "real-model-action-confirm", confirmed: true, proposalHash: proposal.proposalHash });
      expect(await db.actionItem.findUnique({ where: { id: receipt.actionId } })).toMatchObject({ projectId: p.id });
    } finally { fetcher.mockRestore(); vi.unstubAllEnvs(); process.env.LLM_MODE = "mock"; }
  });
  it("records interrupted model requests as UNKNOWN and never retries them on replay", async () => {
    const f = await fixture();
    vi.stubEnv("LLM_MODE", "openai-compatible"); vi.stubEnv("LLM_API_KEY", "fixture-key");
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection interrupted"));
    const input = { requestId: "interrupted", expectedVersion: 1, message: "当前哪个项目优先？", llmContextApproved: true };
    try {
      await expect(submitConversationTurn(f.actor, f.id, input)).rejects.toThrow("connection interrupted");
      const read = await submitConversationTurn(f.actor, f.id, input);
      expect(read.status).toBe("UNKNOWN");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((await db.agentRun.findFirstOrThrow({ where: { conversationId: f.id } })).status).toBe("FAILED");
      expect(await db.actionItem.count({ where: { projectId: { in: f.projects.map(p => p.id) } } })).toBe(0);
    } finally { fetcher.mockRestore(); vi.unstubAllEnvs(); process.env.LLM_MODE = "mock"; }
  });
  it("resumes the bound paused Mission through the original service, once, without creating another task", async () => {
    const f = await fixture(), p = f.projects[0];
    const m = await db.agentMission.create({ data: { projectId: p.id, ownerUserId: f.user.id, createRequestId: "original",
      createPayloadHash: "hash", goal: "原实验资料核对", status: "PAUSED", pauseReason: "USER",
      successCriteriaJson: ["DRAFT_EXISTS"], constraintsJson: {}, budgetJson: {} } });
    await submitConversationTurn(f.actor, f.id, { requestId: "read-original", expectedVersion: 1, message: "调查原委托",
      projectId: p.id, entityRef: { kind: "MISSION", id: m.id, projectId: p.id } });
    const preview = await previewConversationResume(f.actor, f.id, m.id), proposal = preview.conversation.messages.at(-1)!.proposal!;
    const input = { requestId: "resume", proposalHash: proposal.proposalHash, confirmed: true };
    await confirmConversationProposal(f.actor, f.id, proposal.executionId, input);
    const again = await confirmConversationProposal(f.actor, f.id, proposal.executionId, input);
    expect(again.alreadyExecuted).toBe(true);
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("READY");
    expect(await db.agentMission.count({ where: { projectId: p.id } })).toBe(1);
  });
  it("runs the real ArkTS ConversationService against authenticated Next handlers and reads the same Action back on Web", async () => {
    const f = await fixture(), token = (await createSession(f.user.id)).token;
    const request = (path: string, method: string, body?: unknown) => new Request("http://local" + path, {
      method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    class NativeClient {
      async get(path: string) { const r = await getView(request(path, "GET"), { params: Promise.resolve({ id: f.id }) }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
      async post(path: string, body: unknown) {
        const pieces = path.split("/");
        const r = path.endsWith("/turns") ? await postTurn(request(path, "POST", body), { params: Promise.resolve({ id: f.id }) })
          : await confirmRoute(request(path, "POST", body), { params: Promise.resolve({ id: f.id, executionId: pieces.at(-2)! }) });
        if (!r.ok) throw new Error(await r.text()); return r.json();
      }
    }
    function nativeModule(path: string, requireFn: (id: string) => unknown) {
      const code = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
      const exports: Record<string, unknown> = {};
      vm.runInNewContext("(function(require,exports){" + code + "})", {})(requireFn, exports);
      return exports;
    }
    const models = nativeModule("harmonyos/entry/src/main/ets/models/Conversation.ets", () => ({}));
    const native = nativeModule("harmonyos/entry/src/main/ets/services/ConversationService.ets", path =>
      path.endsWith("ApiClient") ? { ApiClient: NativeClient } : models);
    const Service = native.ConversationService as new () => {
      read(id: string): Promise<import("@/lib/types/conversation").ConversationView>;
      ask(id: string, body: unknown): Promise<{ conversation: import("@/lib/types/conversation").ConversationView }>;
      confirm(id: string, execution: string, body: unknown): Promise<{ actionId: string }>;
    };
    const service = new Service();
    const before = await service.read(f.id);
    const response = await service.ask(f.id, { requestId: "native-turn", expectedVersion: before.version,
      message: "创建一个行动", projectId: f.projects[0].id, llmContextApproved: false });
    const p = response.conversation.messages.at(-1)!.proposal!;
    const result = await service.confirm(f.id, p.executionId, { requestId: "native-confirm", proposalHash: p.proposalHash, confirmed: true });
    expect((await readConversation(f.actor, f.id)).messages.at(-1)?.proposal?.resultId).toBe(result.actionId);
  });
});
