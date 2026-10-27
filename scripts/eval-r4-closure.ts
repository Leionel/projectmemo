import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
if (!process.argv.includes("--real") || !process.argv.includes("--confirm-paid-calls")) {
  console.log(JSON.stringify({ status: "PREPARED_ONLY", modelCalls: 0, maximumCalls: 48, cases: "tests/fixtures/r4/closure-cases.json" })); process.exit(0);
}
const root = path.resolve("output/r4-pr3-pr4"), ledgerPath = path.join(root, "model-budget.json");
const read = (p: string) => JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
const ledger = read(ledgerPath); if (ledger.limit > 48 || ledger.used >= ledger.limit) throw new Error("MODEL_EVALUATION_BUDGET_EXHAUSTED");
const output = path.join(root, "real-" + new Date().toISOString().replaceAll(/[:.]/g, "-")); fs.mkdirSync(output, { recursive: true });
const resume = process.argv.find(a => a.startsWith("--resume="))?.slice(9);
if (resume && !path.resolve(resume).startsWith(root + path.sep)) throw new Error("Invalid resume manifest path");
const previousManifest = resume ? read(path.join(path.resolve(resume), "manifest.json")) : null;
const database = previousManifest ? String(previousManifest.databaseUrl).slice(5) : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-r4-closure-")), "eval.sqlite");
if (previousManifest && (!path.resolve(database).startsWith(path.join(os.tmpdir(), "pm-r4-closure-")) || previousManifest.provenance !== "REAL_MODEL_SYNTHETIC_DEVELOPMENT")) throw new Error("Invalid isolated resume database");
process.env.DATABASE_URL = "file:" + database.replaceAll("\\", "/");
Object.assign(process.env, { FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", MISSION_ENABLED: "true", LLM_MODE: "openai-compatible", SEMANTIC_MEMORY_ENABLED: "false" });
const sql = new Database(database);
try { if (!previousManifest) for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); } } finally { sql.close(); }
const { db } = await import("../lib/db"), { hashPassword } = await import("../lib/auth/password"), { createSession } = await import("../lib/auth/session");
const { createConversation, readConversation } = await import("../lib/conversation/service"), { submitConversationTurn } = await import("../lib/conversation/turnService");
const { performConversationUIAction } = await import("../lib/conversation/uiActions"), { confirmConversationWork, readConversationWork, previewConversationWork } = await import("../lib/conversation/workService");
const { getChatProviderDefaults } = await import("../lib/config/provider");
const casesPath = "tests/fixtures/r4/closure-cases.json", cases = read(casesPath).cases;
const results: unknown[] = [], responses: unknown[] = []; let episode = "";
const original = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  if (!new URL(target).pathname.endsWith("/chat/completions")) throw new Error("UNEXPECTED_EVALUATION_NETWORK_TARGET");
  const fd = fs.openSync(ledgerPath + ".lock", "wx"); let ordinal: number;
  const body = JSON.parse(init!.body as string), task = body.messages[0].content.match(/^任务 (\S+)/)?.[1] ?? "C0_LEGACY";
  try { const budget = read(ledgerPath); if (budget.limit > 48 || budget.used >= budget.limit) throw new Error("MODEL_EVALUATION_BUDGET_EXHAUSTED");
    ordinal = ++budget.used; budget.calls.push({ ordinal, episode, task, state: "DISPATCH_RESERVED", startedAt: new Date().toISOString() }); fs.writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + "\n");
  } finally { fs.closeSync(fd); fs.unlinkSync(ledgerPath + ".lock"); }
  const response = await original(url, init), raw = await response.clone().text(), responseHash = createHash("sha256").update(raw).digest("hex");
  responses.push({ ordinal, episode, task, httpStatus: response.status, response: raw, responseHash }); fs.writeFileSync(path.join(output, "responses.json"), JSON.stringify(responses, null, 2) + "\n");
  const budget = read(ledgerPath); Object.assign(budget.calls.find((c: { ordinal: number }) => c.ordinal === ordinal), { state: "HTTP_RECEIVED", httpStatus: response.status, responseHash });
  fs.writeFileSync(ledgerPath, JSON.stringify(budget, null, 2) + "\n"); return response;
};
const user = await db.user.findUnique({ where: { username: "r4-local-review" } }) ?? await db.user.create({ data: { username: "r4-local-review", displayName: "R4 本机验收", passwordHash: await hashPassword("r4-local-review-only") } });
const session = await createSession(user.id), actor = { userId: user.id, sessionId: session.session.id };
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ provenance: "REAL_MODEL_SYNTHETIC_DEVELOPMENT", databaseUrl: process.env.DATABASE_URL, userId: user.id,
  caseHash: createHash("sha256").update(fs.readFileSync(casesPath)).digest("hex"), provider: getChatProviderDefaults() }, null, 2) + "\n");
try {
  for (const sample of cases) {
    const skip = process.argv.find(a => a.startsWith("--skip="))?.slice(7); if (skip === sample.id) continue;
    const only = process.argv.find(a => a.startsWith("--only="))?.slice(7); if (only && sample.id !== only) continue;
    const continuing = process.argv.find(a => a.startsWith("--continue-conversation="))?.slice(24);
    const priorConversation = continuing ? await db.conversation.findFirstOrThrow({ where: { id: continuing, ownerUserId: user.id } }) : null;
    const project = priorConversation ? await db.project.findFirstOrThrow({ where: { id: priorConversation.homeProjectId!, description: "R4_SYNTHETIC_CLOSURE_ACCEPTANCE" } }) : await db.project.create({ data: { title: sample.title, goal: sample.goal, description: "R4_SYNTHETIC_CLOSURE_ACCEPTANCE", scenario: sample.domain,
      memberships: { create: { userId: user.id } } } });
    if (!continuing) {
    const capture = await db.capture.create({ data: { projectId: project.id, rawText: sample.observation, sourceType: "本机合成验收记录" } });
    await db.knowledgeCard.create({ data: { projectId: project.id, captureId: capture.id, title: sample.title + "原始记录索引", summary: sample.goal + "。摘要不包含测量与验收结果，请查原记录。", type: "experiment_log", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
    }
    const groups = sample.id === "latency" && !process.argv.includes("--full-only") ? ["C0", "C1", "C2", "C3"] : ["C3"];
    for (const group of groups) {
      if (read(ledgerPath).used >= ledger.limit) break;
      episode = sample.id + "/" + group; process.env.FOCUS_AGENT_R4_ENABLED = String(group !== "C0");
      const conversation = priorConversation ?? await createConversation(actor, { requestId: sample.id + "/" + group, scope: "PROJECT", projectId: project.id, title: "R4 " + sample.title + " " + group });
      const before = read(ledgerPath).used, start = Date.now();
      try {
        let currentVersion = 1, question = sample.question;
        if (continuing) {
          const view = await readConversation(actor, conversation.id), message = view.messages.at(-1)!;
          const action = message.presentation?.allowedActions.find(a => a.actionKind === "ASK" && a.enabled);
          if (action) await performConversationUIAction(actor, conversation.id, { messageId: message.id, bindingId: action.bindingId, requestId: "clarify-event", expectedConversationVersion: view.version });
          currentVersion = view.version;
          question = fs.readFileSync("tests/fixtures/r4/closure-clarification.txt", "utf8");
        }
        const result = await submitConversationTurn(actor, conversation.id, { requestId: continuing ? "followup:" + crypto.randomUUID() : "initial", expectedVersion: currentVersion, message: question, projectId: project.id, llmContextApproved: true },
          group === "C1" ? { variant: "PROMPT_ONLY" } : group === "C2" ? { variant: "INVESTIGATION_ONLY" } : undefined);
        const message = result.conversation.messages.at(-1)!, turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: result.turnId } });
        let closure: unknown = null;
        if (group === "C3") {
          const approve = message.presentation?.allowedActions.find(a => a.actionKind === "CONFIRM" && a.enabled);
          if (approve) {
            const command = { messageId: message.id, bindingId: approve.bindingId, requestId: "confirm-original", expectedConversationVersion: result.conversation.version };
            const confirmed = await performConversationUIAction(actor, conversation.id, command), replay = await performConversationUIAction(actor, conversation.id, command);
            if (!("actionId" in confirmed) || typeof confirmed.actionId !== "string") throw new Error("NO_ORIGINAL_ACTION_RECEIPT");
            const ref = { kind: "ACTION" as const, id: confirmed.actionId, projectId: project.id };
            const work = await readConversationWork(actor, conversation.id, ref);
            const preview = await previewConversationWork(actor, conversation.id, { requestId: "result-preview", ref, operation: "complete_action", versionToken: work.versionToken,
              expectedConversationVersion: confirmed.conversation.version, answer: sample.result });
            const proposal = preview.conversation.messages.at(-1)!.proposal!;
            const completion = await confirmConversationWork(actor, conversation.id, proposal.executionId, { requestId: "result-confirm", confirmed: true, proposalHash: proposal.proposalHash });
            episode = sample.id + "/C3_FEEDBACK";
            const feedback = await submitConversationTurn(actor, conversation.id, { requestId: "feedback", expectedVersion: completion.conversation.version, projectId: project.id, entityRef: ref,
              message: "读回刚完成的原行动结果，再判断对原目标的影响。只需重评，不要创建新行动；区分用户报告与独立核验。", llmContextApproved: true });
            closure = { action: await db.actionItem.findUnique({ where: { id: ref.id } }), exactReplay: "alreadyExecuted" in replay && replay.alreadyExecuted,
              effectCount: await db.actionItem.count({ where: { projectId: project.id } }), resultMessage: feedback.conversation.messages.at(-1), feedbackTurn: await db.conversationTurn.findUnique({ where: { id: feedback.turnId } }) };
          }
        }
        results.push({ caseId: sample.id, group, conversationId: conversation.id, projectId: project.id, status: result.status, durationMs: Date.now() - start,
          modelCalls: read(ledgerPath).used - before, message, turn, closure, audit: await db.agentRun.findMany({ where: { conversationId: conversation.id } }) });
      } catch (error) { results.push({ caseId: sample.id, group, conversationId: conversation.id, status: "FAILED", modelCalls: read(ledgerPath).used - before, error: error instanceof Error ? error.message : "ERROR" }); }
      fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ provenance: "REAL_MODEL_SYNTHETIC_DEVELOPMENT_NOT_INDEPENDENT_ACCEPTANCE", results, ledger: read(ledgerPath) }, null, 2) + "\n");
      console.log(JSON.stringify({ episode, spent: read(ledgerPath).used, status: (results.at(-1) as { status: string }).status, output }));
    }
  }
} finally { globalThis.fetch = original; await db.$disconnect(); }
