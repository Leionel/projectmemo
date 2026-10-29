import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
const [mode, rawDir] = process.argv.slice(2), dir = path.resolve(rawDir ?? "");
if (!dir.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(dir).startsWith("pm-pr6-recovery-")) throw new Error("RECOVERY_PROBE_REQUIRES_ISOLATED_TEMP_DIRECTORY");
const file = path.join(dir, "test.sqlite"), manifestFile = path.join(dir, "manifest.json"), countersFile = path.join(dir, "counters.json");
Object.assign(process.env, { DATABASE_URL: "file:" + file.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", FOCUS_WEB_ENABLED: "true", FOCUS_ASYNC_ENABLED: "true",
  LLM_MODE: "openai-compatible", LLM_PROVIDER: "deepseek", LLM_API_KEY: "synthetic-recovery-no-network", SEMANTIC_MEMORY_ENABLED: "false" });
if (!fs.existsSync(file)) {
  const sql = new Database(file); for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); } sql.close();
}
const { db } = await import("../lib/db"), { createSession } = await import("../lib/auth/session"), { createConversation, readConversation } = await import("../lib/conversation/service"),
  { submitConversationTurn } = await import("../lib/conversation/turnService"), { runConversationTurn } = await import("../lib/conversation/turnWorker");
type Manifest = { userId: string; sessionId: string; conversationId: string; turnId: string; projectId: string; goal: string };
let m: Manifest;
if (!fs.existsSync(manifestFile)) {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "崩溃隔离", passwordHash: "unused" } });
  const session = await createSession(user.id), actor = { userId: user.id, sessionId: session.session.id };
  const p = await db.project.create({ data: { title: "恢复合成项目", description: "RECOVERY_HTTP_STUB_ONLY", goal: "核对公开结果的适用条件", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const c = await createConversation(actor, { requestId: "create", scope: "PROJECT", projectId: p.id });
  const turn = await submitConversationTurn(actor, c.id, { requestId: "original", expectedVersion: 1, message: "读取公开论文 https://arxiv.org/abs/2601.00001", projectId: p.id, llmContextApproved: true }, undefined, { defer: true });
  m = { userId: user.id, sessionId: actor.sessionId, projectId: p.id, goal: p.goal, conversationId: c.id, turnId: turn.turnId };
  fs.writeFileSync(manifestFile, JSON.stringify(m));
} else m = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const counts = fs.existsSync(countersFile) ? JSON.parse(fs.readFileSync(countersFile, "utf8")) : { models: 0, external: 0 };
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/v1/tools/fetch")) {
    counts.external++; fs.writeFileSync(countersFile, JSON.stringify(counts));
    return new Response(JSON.stringify({ title: "公开片段", content: "该公开方法尚需本项目同条件验证。" }), { headers: { "Content-Type": "application/json" } });
  }
  if (!String(url).endsWith("/chat/completions")) throw new Error("NO_REAL_NETWORK_ALLOWED");
  counts.models++; fs.writeFileSync(countersFile, JSON.stringify(counts));
  const body = JSON.parse(String(init?.body)), stage = body.messages[0].content.match(/^任务 (\S+)/)?.[1], data = JSON.parse(body.messages[1].content).data;
  const fetched = data.sources?.find((s: { external?: { readLevel: string } }) => s.external?.readLevel === "FETCH_EXCERPT");
  let output: unknown;
  if (stage === "focus.route.v2") output = { intent: "ANSWER", projectIds: [m.projectId], query: "公开论文", investigate: true, informationNeeds: ["核对原文"] };
  else if (stage === "focus.investigate.v1") {
    const source = data.sources.find((s: { external?: { readLevel: string } }) => s.external?.readLevel === "UNAVAILABLE");
    output = { goalAssessments: [{ projectId: m.projectId, goalQuote: m.goal, criteria: [{ requirement: m.goal, state: "UNKNOWN", explanation: "公开数据不能证明项目结果", observations: [] }], blockers: [], keyUnknowns: ["项目实测"], nextInformationNeed: "核对原文" }],
      decision: fetched ? { decision: "ANSWER_NOW", reason: "已有可读原文" } : { decision: "READ_EXISTING", informationNeed: "核对原文", expectedObservation: "取得公开片段", call: { tool: "web_fetch", projectId: m.projectId, scopeRevision: 1, sourceId: source.sourceId } } };
  } else if (stage === "focus.answer.v2") output = { advice: "仍需项目验证。", recommendedProjectId: m.projectId, observations: [{ sourceId: fetched.id, quote: fetched.excerpt }], priorities: [], action: null };
  else if (stage === "focus.ui_plan.v1") output = { schemaVersion: 2, intent: "EXPLAIN", primaryIntent: "EXPLAIN", composition: [{ blockKey: "answer", emphasis: "primary", semanticType: "prose", text: "仍需项目验证。", dataRefs: [] }] };
  else throw new Error("Unexpected stub stage " + stage);
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
};
if (mode === "snapshot" || mode === "unknown") {
  const transaction = db.$transaction.bind(db);
  Object.defineProperty(db, "$transaction", { value: async (...args: unknown[]) => {
    const result = await Reflect.apply(transaction, db, args);
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: m.turnId } });
    const ops = (turn.readManifestJson as { operations?: Record<string, { status: string }> }).operations;
    if (mode === "snapshot" && ops?.["read-1"]?.status === "SUCCEEDED") process.exit(74);
    if (mode === "unknown" && ["DISPATCHING", "DISPATCH_COMMITTED"].includes(ops?.["web-1"]?.status ?? "")) process.exit(75);
    return result;
  } });
} else if (mode === "resume") await db.conversationTurn.update({ where: { id: m.turnId }, data: { leaseUntil: new Date(0) } });
else throw new Error("INVALID_PROBE_MODE");
await runConversationTurn();
const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: m.turnId } }), view = await readConversation({ userId: m.userId, sessionId: m.sessionId }, m.conversationId);
console.log(JSON.stringify({ status: turn.status, externalCalls: counts.external, modelCalls: counts.models, userMessages: view.messages.filter(x => x.role === "USER").length,
  assistantMessages: view.messages.filter(x => x.role === "ASSISTANT").length, errorCode: (turn.errorJson as { code?: string } | null)?.code }));
await db.$disconnect();
