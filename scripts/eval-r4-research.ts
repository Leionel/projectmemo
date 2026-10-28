import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { ResearchEvaluationBudget } from "./research-evaluation/budget";
import development from "../tests/fixtures/r4/pr6-research-cases.json";
import frozen from "../tests/fixtures/r4/pr6-research-frozen.json";
const samples = process.argv.includes('--frozen') ? frozen : development;

const runAt = process.argv.indexOf('--run-id'), runId = runAt >= 0 ? process.argv[runAt + 1] : 'evaluation-v2';
if (!/^[a-z0-9-]{1,60}$/.test(runId)) throw new Error('INVALID_RUN_ID');
const campaignRoot = path.resolve('output/r4-pr6'), root = path.join(campaignRoot, runId), fixtureHash = createHash("sha256").update(JSON.stringify(samples)).digest("hex");
fs.mkdirSync(root, { recursive: true });
const runtimeFiles = ['lib'].flatMap(dir => fs.readdirSync(dir,{recursive:true}).map(name=>path.join(dir,String(name))).filter(p=>p.endsWith('.ts'))).sort();
const runtimeHash = createHash('sha256').update(runtimeFiles.map(p=>p+':'+createHash('sha256').update(fs.readFileSync(p)).digest('hex')).join('\n')).digest('hex');
const budgetAt = process.argv.indexOf("--budget-file"), ledgerPath = path.resolve(budgetAt >= 0 ? process.argv[budgetAt + 1] : path.join(root, "authorized-budget.json"));
if (!ledgerPath.startsWith(root + path.sep)) throw new Error("BUDGET_MUST_BELONG_TO_THIS_RUN");
const plan = { status: "PREPARED_ONLY", runId, sampleStatus: process.argv.includes('--frozen') ? 'FROZEN_NEW_24_NOT_USED_FOR_TUNING' : "DEVELOPMENT_AFTER_PILOT_V1_CONTRACT_REPAIRS", fixtureHash, runtimeHash, caseCount: samples.cases.length, arms: ["INTERNAL_QUICK", "WEB_STANDARD"],
  modelCallLimit: samples.cases.length * 14, externalRequestLimit: samples.cases.length * 4, priceEstimateExternalUSD: samples.cases.length * 4 * 0.00075,
  provenance: samples.provenance, priorCampaign: "output/r4-pr5/model-budget.json (44/48 preserved)",
  requiredLedger: ledgerPath, qualityScoring: "independent human scoring remains required" };
fs.writeFileSync(path.join(root, "evaluation-plan.json"), JSON.stringify(plan, null, 2) + "\n");
if (!process.argv.includes("--real")) { console.log(JSON.stringify(plan)); process.exit(0); }
if (!fs.existsSync(ledgerPath)) throw new Error("RESEARCH_EVALUATION_REQUIRES_EXPLICIT_ADDITIONAL_AUTHORIZATION");
const budget = new ResearchEvaluationBudget(ledgerPath, runId);
process.once("exit", () => budget.close());
await import("dotenv/config");
const resultsPath = path.join(root, "evaluation-results.json");
const previous = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath,'utf8')) : null;
if (previous && (previous.fixtureHash !== fixtureHash || previous.runtimeHash !== runtimeHash)) throw new Error('FROZEN_INPUT_OR_RUNTIME_CHANGED');
const sqlite: string = previous?.database ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-pr6-real-")), "research.sqlite");
if (!path.resolve(sqlite).startsWith(path.resolve(os.tmpdir()) + path.sep + 'pm-pr6-real-') || path.basename(sqlite) !== 'research.sqlite') throw new Error('UNSAFE_EVALUATION_DATABASE');
Object.assign(process.env, { DATABASE_URL: "file:" + sqlite.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", FOCUS_WEB_ENABLED: "true", LLM_MODE: "openai-compatible", SEMANTIC_MEMORY_ENABLED: "false" });
if (!previous) { const sql = new Database(sqlite);
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const p = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, "utf8")); }
  sql.close();
} else if (!fs.existsSync(sqlite)) throw new Error('ORIGINAL_EVALUATION_DATABASE_MISSING');
const { db } = await import("../lib/db"), { createSession } = await import("../lib/auth/session"),
  { createConversation, readConversation } = await import("../lib/conversation/service"), { submitConversationTurn } = await import("../lib/conversation/turnService"),
  { updateResearchScope } = await import("../lib/conversation/researchScope");
const original = globalThis.fetch; let episode = "";
globalThis.fetch = async (target, init) => {
  const url = new URL(typeof target === "string" ? target : target instanceof URL ? target.href : target.url);
  const kind = url.pathname.includes("/chat/completions") ? "MODEL" : "EXTERNAL";
  const callId = budget.reserve(episode, url.href, String(init?.body ?? ""));
  try {
    const result = await original(target, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(25000)]) });
    let raw = await result.clone().text(); for (const key of [process.env.LLM_API_KEY, process.env.MISSION_SEARCH_API_KEY].filter(Boolean)) raw = raw.split(key!).join("[REDACTED]");
    fs.writeFileSync(path.join(root, `response-${callId!}.json`), JSON.stringify({ episode, kind, httpStatus: result.status, response: raw }));
    budget.settle(callId, result.status, raw); return result;
  } catch (error) { budget.unknown(callId); throw error; }
};
const saved: { fixtureHash: string; runtimeHash: string; database: string; results: Array<{ episode: string; status: string; result?: unknown; error?: string }> } = previous ?? { fixtureHash, runtimeHash, database: sqlite, results: [] };
if (saved.fixtureHash !== fixtureHash) throw new Error("FROZEN_INPUT_CHANGED");
try {
  const selectedAt = process.argv.indexOf('--cases'), selected = selectedAt >= 0 ? process.argv[selectedAt + 1].split(',') : null;
  for (const sample of samples.cases.filter(c => !selected || selected.includes(c.id))) for (const arm of ["INTERNAL_QUICK", "WEB_STANDARD"]) {
    episode = sample.id + "/" + arm; if (saved.results.some(r => r.episode === episode)) continue;
    if (budget.attempted(episode)) { saved.results.push({ episode, status: 'NOT_RESENT', error: 'Original attempt interrupted; no new turn or network dispatch' }); fs.writeFileSync(resultsPath, JSON.stringify(saved,null,2)); continue; }
    process.env.FOCUS_WEB_ENABLED = "true";
    const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "PR6 合成验收", passwordHash: "unused" } });
    const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
    const project = await db.project.create({ data: { title: "研究验证项目", description: "SYNTHETIC_PRIVATE_CANARY_PR6", goal: sample.goal, scenario: sample.scenario as "RESEARCH", memberships: { create: { userId: user.id } } } });
    const conversation = await createConversation(actor, { requestId: "create", scope: "PROJECT", projectId: project.id });
    if (arm === "WEB_STANDARD") await updateResearchScope(actor, conversation.id, { expectedRevision: 1, projectId: project.id, scope: sample.publicScope });
    else process.env.FOCUS_WEB_ENABLED = "false";
    try { const result = await submitConversationTurn(actor, conversation.id, { requestId: "evaluate", expectedVersion: 1, projectId: project.id, message: sample.question,
      llmContextApproved: true, investigationMode: arm === "WEB_STANDARD" ? "STANDARD" : "QUICK" });
      saved.results.push({ episode, status: "RECEIVED", result: { ...result, conversation: await readConversation(actor, conversation.id) } });
    } catch (error) { saved.results.push({ episode, status: "FAILED_OR_UNKNOWN", error: error instanceof Error ? error.message : "unknown" }); }
    fs.writeFileSync(resultsPath, JSON.stringify(saved, null, 2));
    console.log(JSON.stringify({ episode, ...budget.summary() }));
  }
} finally { globalThis.fetch = original; budget.close(); await db.$disconnect(); }
