import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";

const enabled = process.argv.includes("--real") && process.argv.includes("--confirm-paid-calls");
if (!enabled) {
  console.log(JSON.stringify({ status: "PREPARED_ONLY", modelCalls: 0, groups: ["C0_ORIGINAL", "C3_FULL"], domains: ["RESEARCH", "COMPETITION", "COURSE"], maximumCalls: 24 }));
  process.exit(0);
}
const ledgerPath = path.resolve("output/r4-pr1-pr2/model-budget.json");
if (!fs.existsSync(ledgerPath)) throw new Error("A durable model budget ledger is required");
const parse = (file: string) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const starting = parse(ledgerPath);
if (starting.limit > 24 || starting.limit <= 0 || !Number.isInteger(starting.used) || starting.used < 0) throw new Error("Invalid call budget");
const output = path.resolve("output/r4-pr1-pr2/real-" + new Date().toISOString().replaceAll(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pm-r4-real-")), database = path.join(temporary, "eval.sqlite");
process.env.DATABASE_URL = "file:" + database.replaceAll("\\", "/");
Object.assign(process.env, { FOCUS_AGENT_ENABLED: "true", MISSION_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false", LLM_MODE: "openai-compatible" });
const sql = new Database(database);
try { for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); } } finally { sql.close(); }
const { db } = await import("../lib/db"), { createSession } = await import("../lib/auth/session"), { createConversation } = await import("../lib/conversation/service");
const { submitConversationTurn } = await import("../lib/conversation/turnService"), { performConversationUIAction } = await import("../lib/conversation/uiActions");
const { getChatProviderDefaults } = await import("../lib/config/provider");
const fixture = parse("tests/fixtures/r4/experience-v1.json");
const responses: unknown[] = [], results: unknown[] = [], originalFetch = globalThis.fetch;
let episode = "";
globalThis.fetch = async (url, init) => {
  const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  if (!new URL(target).pathname.endsWith("/chat/completions")) throw new Error("Unexpected network target in R4 evaluation");
  const lock = ledgerPath + ".lock", fd = fs.openSync(lock, "wx");
  let ordinal: number;
  const body = JSON.parse(init!.body as string), task = body.messages[0].content.match(/^任务 (\S+)/)?.[1] ?? "C0_LEGACY";
  try {
    const budget = parse(ledgerPath);
    if (budget.limit > 24 || budget.used >= budget.limit) throw new Error("EVALUATION_CALL_BUDGET_EXHAUSTED");
    ordinal = ++budget.used;
    budget.calls.push({ ordinal, episode, task, startedAt: new Date().toISOString(), state: "RESERVED" });
    fs.writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + "\n");
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  try {
    const response = await originalFetch(url, init), raw = await response.clone().text();
    const responseHash = createHash("sha256").update(raw).digest("hex");
    responses.push({ ordinal, episode, task, httpStatus: response.status, response: raw, responseHash });
    fs.writeFileSync(path.join(output, "responses.json"), JSON.stringify(responses, null, 2) + "\n");
    const receiptLock = fs.openSync(lock, "wx");
    try {
      const budget = parse(ledgerPath), entry = budget.calls.find((c: { ordinal: number }) => c.ordinal === ordinal);
      Object.assign(entry, { state: "HTTP_RECEIVED", httpStatus: response.status, responseHash });
      fs.writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + "\n");
    } finally { fs.closeSync(receiptLock); fs.unlinkSync(lock); }
    return response;
  } catch (error) {
    responses.push({ ordinal, episode, task, state: "UNKNOWN", error: error instanceof Error ? error.name : "ERROR" });
    fs.writeFileSync(path.join(output, "responses.json"), JSON.stringify(responses, null, 2) + "\n");
    throw error;
  }
};
try {
  for (const sample of fixture.cases) {
    const goal = sample.observedAuthority.catalog.find((b: { semanticType: string }) => b.semanticType === "goal_gap").goalGap.goalQuote;
    const raw = sample.observedAuthority.evidence.find((e: { source: { id: string } }) => e.source.id.endsWith("-new")).quote;
    const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "R4 合成样例验收", passwordHash: "unused" } });
    const session = await createSession(user.id), actor = { userId: user.id, sessionId: session.session.id };
    const project = await db.project.create({ data: { title: sample.domain + " 条件核对", goal, description: "SYNTHETIC_MODEL_EVALUATION",
      scenario: sample.domain === "COURSE" ? "COURSE_DESIGN" : sample.domain, memberships: { create: { userId: user.id } } } });
    const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "fixture", rawText: raw } });
    await db.knowledgeCard.create({ data: { projectId: project.id, captureId: capture.id, title: "资料索引：" + goal,
      summary: goal + "。资料摘要尚未列出实际条件，请查原始记录。", type: "experiment_log", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
    for (const group of ["C0_ORIGINAL", "C3_FULL"]) {
      if (parse(ledgerPath).used >= starting.limit) break;
      episode = sample.id + "/" + group; process.env.FOCUS_AGENT_R4_ENABLED = String(group === "C3_FULL");
      const c = await createConversation(actor, { requestId: group, scope: "PROJECT", projectId: project.id });
      const start = Date.now(), before = parse(ledgerPath).used;
      try {
        const result = await submitConversationTurn(actor, c.id, { requestId: "question", expectedVersion: 1,
          message: sample.question + " 请先查已有记录，根据目标差距帮我处理下一步。", projectId: project.id, llmContextApproved: true });
        const m = result.conversation.messages.at(-1)!, runs = await db.agentRun.findMany({ where: { turnId: result.turnId } });
        const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: result.turnId } });
        let business: unknown = null;
        const action = m.presentation?.allowedActions.find(a => a.actionKind === "CONFIRM" && a.enabled);
        if (group === "C3_FULL" && action) {
          const request = { messageId: m.id, bindingId: action.bindingId, requestId: "real-confirm", expectedConversationVersion: result.conversation.version };
          const first = await performConversationUIAction(actor, c.id, request), replay = await performConversationUIAction(actor, c.id, request);
          business = { effects: await db.actionItem.count({ where: { projectId: project.id } }), replay: "alreadyExecuted" in replay && replay.alreadyExecuted,
            receiptTypes: first.conversation.messages.at(-1)?.presentation?.blocks.map(b => b.semanticType) };
        }
        results.push({ episode, status: result.status, provider: m.provider, durationMs: Date.now() - start, modelCalls: parse(ledgerPath).used - before,
          sources: m.sources, answer: m.content, presentation: m.presentation, proposal: m.proposal, manifest: turn.readManifestJson,
          reservation: turn.reservationJson, usage: turn.usageJson, audit: runs.map(r => ({ provider: r.provider, status: r.status, trace: r.trace, fallbackReason: r.fallbackReason })), business });
      } catch (error) { results.push({ episode, status: "FAILED", durationMs: Date.now() - start, modelCalls: parse(ledgerPath).used - before,
        error: error instanceof Error ? error.message : "ERROR", turns: await db.conversationTurn.findMany({ where: { conversationId: c.id } }) }); }
      fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ provenance: "REAL_MODEL_SYNTHETIC_DEVELOPMENT_COMPARISON_NOT_HELD_OUT", provider: getChatProviderDefaults(), results, ledger: parse(ledgerPath) }, null, 2) + "\n");
      console.log(JSON.stringify({ episode, status: (results.at(-1) as { status: string }).status, spent: parse(ledgerPath).used }));
    }
  }
} finally { globalThis.fetch = originalFetch; await db.$disconnect(); }
console.log(JSON.stringify({ output, spent: parse(ledgerPath).used, limit: starting.limit }));
