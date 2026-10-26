import { afterAll, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-f3-contract-")), file = path.join(dir, "test.sqlite");
  Object.assign(process.env, {
    DATABASE_URL: "file:" + file.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_FOLLOW_ENABLED: "true",
    GOAL_QUESTION_ENABLED: "true", MISSION_ENABLED: "true", MISSION_EVENT_CONTINUATION_ENABLED: "true",
    LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false",
  });
  const sql = new Database(file);
  try {
    for (const name of fs.readdirSync("prisma/migrations").sort()) {
      const migration = path.join("prisma/migrations", name, "migration.sql");
      if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
    }
  } finally { sql.close(); }
  return { dir, file };
});

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import Database from "better-sqlite3";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { currentGoalQuestion, interactGoalQuestion } from "@/lib/decision/questions";
import { emptyBlocks } from "@/lib/conversation/repository";
import { readConversationEntry } from "@/lib/conversation/entry";
import { POST as entryRoute } from "@/app/api/conversations/entry/route";
import { POST as workspaceSyncRoute } from "@/app/api/conversations/sync/route";
import { GET as anchorsRoute } from "@/app/api/conversations/[id]/anchors/route";
import { POST as anchorRoute } from "@/app/api/conversations/[id]/anchors/[anchorId]/route";
import { POST as syncRoute } from "@/app/api/conversations/[id]/anchors/sync/route";
import { POST as reconcileRoute } from "@/app/api/conversations/[id]/reconcile/route";
import type { AnchorView } from "@/lib/types/conversationAnchor";
import type { ConversationView } from "@/lib/types/conversation";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "F3合同验证", passwordHash: "unused" } });
  const session = await createSession(user.id), actor = { userId: user.id, sessionId: session.session.id };
  const project = await db.project.create({ data: { title: "原主题合同", description: "独立数据库", goal: "核对原设备条件", scenario: "RESEARCH",
    memberships: { create: { userId: user.id } } } });
  const reminder = await db.agentIntervention.create({ data: { projectId: project.id, triggerType: "MATERIAL_GAP", dedupeKey: crypto.randomUUID(), severity: 3,
    title: "设备信息待核对", content: "已有记录仍需检查", evidence: { source: "原记录" }, proposedActions: [], isSimulated: false } });
  const mission = await createMission(user.id, { projectId: project.id, requestId: "mission", goal: "核对原设备条件", llmContextApproved: true });
  await runMissionSlice({ id: mission.id, provider: async () => ({ choice: { kind: "ask", question: "请补充设备型号", missing: "PRIVATE" },
    provider: "TEST_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }) });
  const question = (await currentGoalQuestion(actor, project.id)).question!;
  expect(question).toBeTruthy();
  return { actor, token: session.token, project, reminder, mission, question,
    reminderEntry: { kind: "INTERVENTION" as const, id: reminder.id, projectId: project.id },
    questionEntry: { kind: "GOAL_QUESTION" as const, id: question.questionId, projectId: project.id } };
}

it("upgrades populated F1 GoalQuestion/Intervention anchors while preserving original messages and manual policy", async () => {
  const f = await fixture(), legacyIds: Array<{ conversation: string; anchor: string; message: string; kind: string }> = [];
  for (const entry of [f.questionEntry, f.reminderEntry]) {
    const source = await readConversationEntry(f.actor, entry);
    const conversation = await db.conversation.create({ data: { ownerUserId: f.actor.userId, createRequestId: entry.kind, createInputHash: "legacy-fixture",
      scope: "WORKSPACE", title: source.ref.title, nextSeq: 1 } });
    await db.conversationProject.create({ data: { conversationId: conversation.id, projectId: f.project.id } });
    const message = await db.agentMessage.create({ data: { conversationId: conversation.id, ownerUserId: f.actor.userId, seq: 1, role: "ASSISTANT",
      content: source.ref.title + "\n" + source.text, blocksJson: { ...emptyBlocks(), refs: [source.ref], observedProjectIds: [f.project.id] }, citations: [], proposedActions: [] } });
    const anchor = await db.conversationAnchor.create({ data: { ownerUserId: f.actor.userId, conversationId: conversation.id, projectId: f.project.id,
      originKind: entry.kind, originId: entry.id, originRevision: source.revision } });
    legacyIds.push({ conversation: conversation.id, anchor: anchor.id, message: message.id, kind: entry.kind });
  }
  const old = new Database(path.join(isolated.dir, "old.sqlite")), modern = new Database(isolated.file, { readonly: true });
  try {
    const migrations = fs.readdirSync("prisma/migrations").filter(n => fs.existsSync(path.join("prisma/migrations", n, "migration.sql"))).sort();
    const cut = "20261026020000_focus_anchor_projection";
    expect(migrations).toContain(cut);
    for (const name of migrations.filter(n => n < cut)) old.exec(fs.readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
    expect((old.pragma("table_info(ConversationAnchor)") as Array<{ name: string }>).map(c => c.name)).not.toContain("mode");
    // Copy real fixture rows using only columns present in F1, so no F3 default or projection enters the old database.
    const tables: Array<[string, string, unknown[]]> = [
      ["User", "id=?", [f.actor.userId]], ["Project", "id=?", [f.project.id]], ["ProjectMembership", "projectId=?", [f.project.id]],
      ["AgentMission", "id=?", [f.mission.id]], ["AgentMissionEvent", "missionId=?", [f.mission.id]], ["AgentIntervention", "id=?", [f.reminder.id]],
      ...["Conversation", "ConversationProject", "AgentMessage", "ConversationAnchor"].map(table => [table,
        (table === "Conversation" ? "id" : "conversationId") + " IN (?,?)", legacyIds.map(row => row.conversation)] as [string, string, unknown[]]),
    ];
    old.pragma("foreign_keys=ON");
    for (const [table, where, values] of tables) {
      const columns = (old.pragma(`table_info("${table}")`) as Array<{ name: string }>).map(c => c.name);
      const insert = old.prepare(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
      for (const row of modern.prepare(`SELECT * FROM "${table}" WHERE ${where}`).all(...values) as Array<Record<string, unknown>>) {
        insert.run(...columns.map(c => row[c]));
      }
    }
    expect(old.pragma("foreign_key_check")).toEqual([]);
    const before = old.prepare("SELECT id,conversationId,content,blocksJson FROM AgentMessage ORDER BY id").all();
    for (const name of migrations.filter(n => n >= cut)) old.exec(fs.readFileSync(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
    expect(old.prepare("SELECT id,conversationId,content,blocksJson FROM AgentMessage ORDER BY id").all()).toEqual(before);
    for (const original of legacyIds) {
      const migrated = old.prepare("SELECT * FROM ConversationAnchor WHERE id=?").get(original.anchor) as Record<string, unknown>;
      expect(migrated).toMatchObject({ conversationId: original.conversation, mode: "MANUAL", version: 1, projectedSeq: 0, seenSeq: 0,
        missionId: original.kind === "GOAL_QUESTION" ? f.mission.id : null });
      expect(JSON.parse(String(migrated.originEntryJson))).toMatchObject({ entry: { kind: original.kind, projectId: f.project.id,
        id: original.kind === "GOAL_QUESTION" ? f.question.questionId : f.reminder.id }, title: expect.any(String) });
      expect(old.prepare("SELECT id FROM AgentMessage WHERE id=?").get(original.message)).toEqual({ id: original.message });
    }
    expect(old.prepare("SELECT COUNT(*) AS count FROM ConversationAnchorProjection").get()).toEqual({ count: 0 });
    expect(old.pragma("foreign_key_check")).toEqual([]);
  } finally { modern.close(); old.close(); }
}, 30_000);

async function dispatch(token: string | undefined, method: string, url: string, body?: unknown) {
  const request = new Request("https://fixture.invalid" + url, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const parts = new URL(request.url).pathname.split("/"), id = parts[3], context = { params: Promise.resolve({ id }) };
  if (url === "/api/conversations/entry" && method === "POST") return entryRoute(request);
  if (url === "/api/conversations/sync" && method === "POST") return workspaceSyncRoute(request);
  if (parts[4] === "reconcile" && method === "POST") return reconcileRoute(request, context);
  if (parts[4] === "anchors") {
    if (parts[5] === "sync" && method === "POST") return syncRoute(request, context);
    if (parts.length === 5 && method === "GET") return anchorsRoute(request, context);
    if (parts.length === 6 && method === "POST") return anchorRoute(request, { params: Promise.resolve({ id, anchorId: parts[5] }) });
  }
  throw new Error("Unexpected native request: " + method + " " + url);
}
type AnchorReply = { anchors: AnchorView[]; conversation: ConversationView; projected?: number };
type NativeService = {
  entry(body: unknown): Promise<{ id: string }>;
  anchors(id: string): Promise<{ anchors: AnchorView[] }>;
  updateAnchor(id: string, anchorId: string, body: unknown): Promise<AnchorReply>;
  syncAnchors(id: string): Promise<AnchorReply>;
  syncWorkspace(): Promise<{ projected: number }>;
  reconcile(id: string): Promise<AnchorReply>;
};
function nativeService(token: string, requests: string[]): NativeService {
  class ApiClient {
    async send(url: string, method: string, body?: unknown) {
      requests.push(method + " " + url);
      const response = await dispatch(token, method, url, body), value = await response.json();
      if (!response.ok) throw { status: response.status, ...value };
      return value;
    }
    get(url: string) { return this.send(url, "GET"); }
    post(url: string, body?: unknown) { return this.send(url, "POST", body); }
  }
  const code = ts.transpileModule(fs.readFileSync("harmonyos/entry/src/main/ets/services/ConversationService.ets", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
  });
  expect(code.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const exports: Record<string, unknown> = {};
  vm.runInNewContext("(function(require,exports){" + code.outputText + "})", {})((name: string) => {
    if (name === "./ApiClient") return { ApiClient };
    throw new Error("Unexpected runtime native import: " + name);
  }, exports);
  return new (exports.ConversationService as new () => NativeService)();
}

it("executes the real ArkTS entry/follow/sync/ACK/reconcile contract and respects STOP from the original UI", async () => {
  const f = await fixture(), requests: string[] = [], native = nativeService(f.token, requests), runsBefore = await db.agentRun.count();
  const open = { requestId: "native-open", scope: "WORKSPACE", entry: f.reminderEntry }, first = await native.entry(open);
  expect((await native.entry({ ...open, requestId: "native-reopen" })).id).toBe(first.id);
  let a = (await native.anchors(first.id)).anchors[0];
  expect(a).toMatchObject({ mode: "MANUAL", unread: 0 });
  await expect(native.updateAnchor(first.id, a.id, { requestId: "bad-version", expectedVersion: "1", action: "FOLLOW" }))
    .rejects.toMatchObject({ status: 422, error: { code: "VALIDATION_ERROR" } });
  await native.updateAnchor(first.id, a.id, { requestId: "follow", expectedVersion: a.version, action: "FOLLOW" });
  await db.agentIntervention.update({ where: { id: f.reminder.id }, data: { evidence: { source: "新增设备记录" } } });
  const synced = await native.syncAnchors(first.id);
  expect(synced.projected).toBe(1); expect(synced.conversation.messages).toHaveLength(2);
  a = synced.anchors[0]; expect(a.unread).toBe(1);
  expect((await native.anchors(first.id)).anchors[0].unread).toBe(1);
  expect((await native.syncWorkspace()).projected).toBe(0);
  expect((await native.updateAnchor(first.id, a.id, { requestId: "ack", expectedVersion: a.version, action: "ACK", seenSeq: a.projectedSeq })).anchors[0].unread).toBe(0);
  const missing = synced.conversation.messages.at(-1)!;
  await db.agentMessage.delete({ where: { id: missing.id } });
  const repaired = await native.reconcile(first.id);
  expect(repaired.projected).toBe(1); expect(repaired.conversation.messages).toHaveLength(2);
  expect(repaired.conversation.messages.at(-1)?.content).toBe(missing.content);
  expect((await native.reconcile(first.id)).projected).toBe(0);
  expect((await db.agentIntervention.findUniqueOrThrow({ where: { id: f.reminder.id } })).evidence).toEqual({ source: "新增设备记录" });

  const missionConversation = await native.entry({ requestId: "native-question", scope: "WORKSPACE", entry: f.questionEntry });
  a = (await native.anchors(missionConversation.id)).anchors[0];
  expect(a.missionId).toBe(f.mission.id);
  await native.updateAnchor(missionConversation.id, a.id, { requestId: "follow-mission", expectedVersion: a.version, action: "FOLLOW" });
  await interactGoalQuestion(f.actor, f.project.id, { requestId: "original-stop", action: "STOP", questionId: f.question.questionId, contextHash: f.question.contextHash });
  await db.agentMission.update({ where: { id: f.mission.id }, data: { status: "PAUSED", version: { increment: 1 } } });
  expect((await native.syncAnchors(missionConversation.id)).projected).toBe(0);
  a = (await native.anchors(missionConversation.id)).anchors[0];
  await expect(native.updateAnchor(missionConversation.id, a.id, { requestId: "must-not-resume", expectedVersion: a.version, action: "FOLLOW" }))
    .rejects.toMatchObject({ status: 409, error: { code: "ORIGINAL_TOPIC_STOPPED" } });
  expect(await db.goalQuestionPreference.count({ where: { userId: f.actor.userId, missionId: f.mission.id, questionId: "*", mode: "STOP" } })).toBe(1);
  expect(await db.agentRun.count()).toBe(runsBefore);
  expect(requests).toEqual(expect.arrayContaining(["POST /api/conversations/entry", `GET /api/conversations/${first.id}/anchors`,
    `POST /api/conversations/${first.id}/anchors/${synced.anchors[0].id}`, `POST /api/conversations/${first.id}/anchors/sync`,
    "POST /api/conversations/sync", `POST /api/conversations/${first.id}/reconcile`]));
});

it("authenticates entry and every anchor route, and hides another user's conversation with 404", async () => {
  const owner = await fixture(), other = await fixture();
  const created = await (await dispatch(owner.token, "POST", "/api/conversations/entry", { requestId: "auth-open", scope: "WORKSPACE", entry: owner.reminderEntry })).json() as { id: string };
  const list = await (await dispatch(owner.token, "GET", `/api/conversations/${created.id}/anchors`)).json() as { anchors: AnchorView[] };
  const anchor = list.anchors[0], command = { requestId: "foreign", expectedVersion: anchor.version, action: "FOLLOW" };
  const endpoints: Array<[string, string, unknown?]> = [["GET", `/api/conversations/${created.id}/anchors`],
    ["POST", `/api/conversations/${created.id}/anchors/${anchor.id}`, command], ["POST", `/api/conversations/${created.id}/anchors/sync`],
    ["POST", `/api/conversations/${created.id}/reconcile`]];
  for (const [method, url, body] of endpoints) {
    expect((await dispatch(undefined, method, url, body)).status).toBe(401);
    expect((await dispatch(other.token, method, url, body)).status).toBe(404);
  }
  expect((await dispatch(undefined, "POST", "/api/conversations/entry", { requestId: "anonymous", scope: "WORKSPACE", entry: owner.reminderEntry })).status).toBe(401);
  expect((await dispatch(undefined, "POST", "/api/conversations/sync")).status).toBe(401);
  expect((await dispatch(other.token, "POST", "/api/conversations/entry", { requestId: "foreign-entry", scope: "WORKSPACE", entry: owner.reminderEntry })).status).toBe(404);
  expect(await db.conversationAnchor.findUniqueOrThrow({ where: { id: anchor.id } })).toMatchObject({ mode: "MANUAL", version: 1 });
});
