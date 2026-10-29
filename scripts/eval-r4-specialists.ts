import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { PromptSpec } from "../lib/agent/promptSpec";
if (!process.argv.includes("--real") || !process.argv.includes("--confirm-paid-calls")) {
  console.log(JSON.stringify({ status: "PREPARED_ONLY", modelCalls: 0, maximumCalls: 48, cases: "tests/fixtures/r4/pr5-cases.json" })); process.exit(0);
}
const { loadEnvConfig } = await import("@next/env"); loadEnvConfig(process.cwd());
const root = path.resolve("output/r4-pr5"), ledgerFile = path.join(root, "model-budget.json");
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const budget = read(ledgerFile); if (budget.limit > 48 || budget.used >= budget.limit) throw new Error("MODEL_EVALUATION_BUDGET_EXHAUSTED");
const resume = process.argv.find(a => a.startsWith("--resume="))?.slice(9);
if (resume && !path.resolve(resume).startsWith(root + path.sep)) throw new Error("Invalid campaign resume");
const output = resume ? path.resolve(resume) : path.join(root, "real-" + new Date().toISOString().replaceAll(/[:.]/g, "-")); fs.mkdirSync(output, { recursive: true });
const previous = resume ? read(path.join(output, "manifest.json")) : null;
const database = previous ? String(previous.databaseUrl).slice(5) : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-r4-specialists-eval-")), "eval.sqlite");
if (previous && (previous.provenance !== "REAL_MODEL_SYNTHETIC_DEVELOPMENT" || !fs.realpathSync(database).startsWith(path.join(fs.realpathSync(os.tmpdir()), "pm-r4-specialists-eval-")))) throw new Error("Not the isolated campaign database");
Object.assign(process.env, { DATABASE_URL: "file:" + database.replaceAll("\\", "/"), LLM_MODE: "openai-compatible", FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", GOAL_CHANGE_REVIEW_ENABLED: "true", MISSION_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false", COPILOT_CLAIM_JUDGE_ENABLED: "false" });
if (!previous) { const sql = new Database(database); try { for (const name of fs.readdirSync("prisma/migrations").sort()) { const file = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8")); } } finally { sql.close(); } }
const { db } = await import("../lib/db"), { createSession } = await import("../lib/auth/session");
const { chatWithLLMWithMeta, chatPromptWithMeta } = await import("../lib/agent/llmAgent"), specs = await import("../lib/agent/specialistPrompts");
const { buildCapturePrompt, buildArtifactPrompt, buildCopilotPrompt } = await import("../lib/agent/prompts");
const { responseSchema } = await import("../lib/services/copilotService"), { createMission } = await import("../lib/mission/missionService");
const { sourceHash } = await import("../lib/mission/repository"), { jsonHash } = await import("../lib/mission/contracts");
const { readReviewMaterial, evidenceKey } = await import("../lib/mission/projectMaterialReader"), { reviewGoalState } = await import("../lib/decision/goalState");
const { createConversation, bindRefs, readConversation } = await import("../lib/conversation/service"), { submitConversationReview } = await import("../lib/conversation/reviewService");
const { prepareActionResult, commitActionResult } = await import("../lib/services/actionService"), { getChatProviderDefaults } = await import("../lib/config/provider");
const casesFile = "tests/fixtures/r4/pr5-cases.json", samples = read(casesFile).cases as Array<{ id: string; scenario: string; goal: string; observation: string; report: string; uncertainCapture: string; expectedAfter: string }>;
const user = await db.user.findUnique({ where: { username: "pr5-isolated-evaluation" } }) ?? await db.user.create({ data: { username: "pr5-isolated-evaluation", displayName: "PR5 合成开发验收", passwordHash: "NO_INTERACTIVE_LOGIN" } });
const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ provenance: "REAL_MODEL_SYNTHETIC_DEVELOPMENT", databaseUrl: process.env.DATABASE_URL, userId: user.id, provider: getChatProviderDefaults(), fixtureHash: createHash("sha256").update(fs.readFileSync(casesFile)).digest("hex"), baselineCommit: "36bb1a0" }, null, 2) + "\n");
const resultsFile = path.join(output, "results.json"), results: Array<Record<string, unknown>> = fs.existsSync(resultsFile) ? read(resultsFile).results : [];
const responsesFile = path.join(output, "responses.json"), responses: Array<unknown> = fs.existsSync(responsesFile) ? read(responsesFile) : [];
let episode = ""; const original = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  if (!new URL(target).pathname.endsWith("/chat/completions")) throw new Error("UNEXPECTED_EVALUATION_NETWORK_TARGET");
  const fd = fs.openSync(ledgerFile + ".lock", "wx"); let ordinal: number;
  const body = JSON.parse(String(init?.body));
  try { const ledger = read(ledgerFile); if (ledger.limit > 48 || ledger.used >= ledger.limit) throw new Error("MODEL_EVALUATION_BUDGET_EXHAUSTED");
    ordinal = ++ledger.used; ledger.calls.push({ ordinal, episode, task: body.messages[0].content.match(/^任务 (\S+)/)?.[1] ?? "BASELINE", state: "RESERVED", startedAt: new Date().toISOString() }); fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + "\n");
  } finally { fs.closeSync(fd); fs.unlinkSync(ledgerFile + ".lock"); }
  const response = await original(url, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(20000)]) });
  const raw = await response.clone().text(), hash = createHash("sha256").update(raw).digest("hex");
  responses.push({ ordinal, episode, httpStatus: response.status, responseHash: hash, response: raw }); fs.writeFileSync(responsesFile, JSON.stringify(responses, null, 2) + "\n");
  const ledger = read(ledgerFile); Object.assign(ledger.calls.find((c: { ordinal: number }) => c.ordinal === ordinal), { state: "HTTP_RECEIVED", httpStatus: response.status, responseHash: hash }); fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + "\n");
  return response;
};
const checkpoint = () => fs.writeFileSync(resultsFile, JSON.stringify({ provenance: "DEVELOPMENT_PAIRED_NOT_INDEPENDENT_GRADING", results, ledger: read(ledgerFile) }, null, 2) + "\n");
function baselineReview(file: string, schema: unknown, data: unknown) {
  const text = fs.readFileSync("tests/fixtures/r4/pr5-baseline/" + file + ".txt", "utf8"), start = text.indexOf("  const prompt = `") + "  const prompt = `".length, end = text.indexOf("schema=${JSON.stringify(", start);
  if (start < 20 || end < start) throw new Error("Frozen baseline prompt changed");
  return text.slice(start, end) + "schema=" + JSON.stringify(schema) + "\ncontext=" + JSON.stringify(data);
}
try {
  for (const sample of samples) {
    const project = await db.project.findFirst({ where: { description: "PR5_SYNTHETIC_" + sample.id, memberships: { some: { userId: user.id } } } }) ?? await db.project.create({ data: { title: sample.id, description: "PR5_SYNTHETIC_" + sample.id, goal: sample.goal, scenario: sample.scenario as "RESEARCH", memberships: { create: { userId: user.id } } } });
    const mission = await db.agentMission.findFirst({ where: { projectId: project.id, ownerUserId: user.id } }) ?? await createMission(user.id, { requestId: "eval-" + sample.id, projectId: project.id, goal: sample.goal, llmContextApproved: true });
    const capture = await db.capture.findFirst({ where: { projectId: project.id } }) ?? await db.capture.create({ data: { projectId: project.id, rawText: sample.observation, sourceType: "REAL_MODEL_SYNTHETIC" } });
    const action = await db.actionItem.findFirst({ where: { projectId: project.id } }) ?? await db.actionItem.create({ data: { projectId: project.id, title: "核对原目标的实际结果", description: sample.goal } });
    const pointer = { id: "capture:" + capture.id, hash: (await sourceHash(project.id, "capture:" + capture.id))! }, material = (await readReviewMaterial(project.id, pointer.id))!, state = await reviewGoalState(mission);
    const evidence = [{ ref: evidenceKey(material.source), role: "CURRENT", source: { id: material.source.id, hash: material.source.hash, temporalState: material.source.temporalState ?? "UNKNOWN" }, title: material.title, text: material.source.text, readScope: material.readScope }];
    const common = { goal: sample.goal, successCriteria: mission.successCriteriaJson, constraints: mission.constraintsJson, goalState: state.snapshot, evidence, coverage: { complete: false } };
    const cards = [{ id: "card-" + sample.id, type: "experiment_log" as const, title: "原始记录摘要", summary: sample.uncertainCapture, keywords: ["待核对"], relatedTasks: [], nextActions: ["核对原始记录"], importance: 3 }];
    const captureInput = { project, rawText: sample.uncertainCapture, historyKeywords: [] };
    const artifactInput = { project, artifactType: "weekly_report" as const, cards, sources: [{ cardId: cards[0].id, sourceId: pointer.id, revision: pointer.hash, readScope: "EXCERPT", text: sample.observation, truncated: false }], coverage: { complete: false, loadedCards: 1, totalCards: 1 } };
    const copilotInput = { project, question: "这个项目现在是否达到目标，下一步该怎么办？", cards: cards.map(c => ({ ...c, temporalState: "UNKNOWN" })), interventions: [], actions: [{ id: action.id, title: action.title, status: "TODO" }], dialogue: [] };
    const dynamicInput = { ...common, change: { summary: "原记录显示仍有目标差距。", candidate: { goalQuote: sample.goal, unknown: ["核对同条件原记录"] } }, currentSourceIds: [pointer.id], readAttemptsRemaining: 2, rejectedCandidateIds: [], roundsRemaining: 1, feedback: "", previous: null };
    const tool = { type: "function", function: { name: "read_project_material", description: "读取本项目已给定资料", parameters: { type: "object", properties: { sourceId: { type: "string" }, sourceHash: { type: "string" } }, required: ["sourceId", "sourceHash"], additionalProperties: false } } };
    const missionInput = { goal: sample.goal, successCriteria: [], planRevision: 1, pendingQuestion: null, outputTokenLimit: 1000, observations: [{ status: "SUCCEEDED", tool: "inspect_project", observation: { data: { current: sample.observation }, sources: [material.source] } }], sourceIndex: [material.source], tools: [tool], responseSchema: specs.missionStrategyV2.outputSchema.toJSONSchema(), remainingBudget: { models: 2, tools: 1 } };
    const oldMission = fs.readFileSync("tests/fixtures/r4/pr5-baseline/modelAdapter.txt", "utf8").match(/role: "system", content: ("(?:\\.|[^"\\])*") }/)?.[1]; if (!oldMission) throw new Error("Missing baseline Mission system");
    const tasks: Array<{ name: string; spec: PromptSpec<unknown, unknown>; data: unknown; legacy: string | Array<{ role: "system" | "user"; content: string }> }> = [
      { name: "capture", spec: specs.captureFidelityV2, data: captureInput, legacy: buildCapturePrompt(captureInput) },
      { name: "artifact", spec: specs.artifactCoverageV2, data: artifactInput, legacy: buildArtifactPrompt(artifactInput) + "\n补充来源范围数据（两组相同输入）：" + JSON.stringify({ sources: artifactInput.sources, coverage: artifactInput.coverage }) },
      { name: "copilot", spec: specs.legacyCopilotStyleV2(responseSchema), data: copilotInput, legacy: buildCopilotPrompt(copilotInput) },
      { name: "d1", spec: specs.changeReviewV4, data: common, legacy: baselineReview("changeUnderstanding", specs.changeReviewV4.outputSchema.toJSONSchema(), common) },
      { name: "d2", spec: specs.dynamicPlanV3, data: dynamicInput, legacy: baselineReview("dynamicCandidates", specs.dynamicPlanV3.outputSchema.toJSONSchema(), dynamicInput) },
      { name: "mission", spec: { ...specs.missionStrategyV2, maxOutputTokens: 1000 }, data: missionInput, legacy: [{ role: "system", content: JSON.parse(oldMission) }, { role: "user", content: JSON.stringify({ context: missionInput, responseSchema: specs.missionStrategyV2.outputSchema.toJSONSchema(), response: "只返回一个符合 responseSchema 的 JSON，不执行工具，不重复已成功步骤。" }) }] },
    ];
    for (const task of tasks) for (const variant of ["BASELINE", "R4"] as const) {
      episode = sample.id + "/" + task.name + "/" + variant; if (results.some(r => r.episode === episode)) continue;
      const start = Date.now(), before = read(ledgerFile).used;
      try {
        const result = variant === "BASELINE" ? await chatWithLLMWithMeta(task.legacy, project.id, undefined, undefined, { outputTokens: task.spec.maxOutputTokens, jsonOutput: task.spec.outputFormat !== "TEXT" }) : await chatPromptWithMeta(task.spec, task.data, project.id);
        const parsed = task.spec.outputSchema.safeParse(task.spec.outputFormat === "TEXT" ? result.data : JSON.parse(result.data));
        results.push({ episode, inputHash: jsonHash(task.data), status: result.status, schemaValid: parsed.success, diagnostic: parsed.success ? null : parsed.error.issues, content: result.data, prompt: result.prompt ?? { baselineCommit: "36bb1a0" }, usage: result.usage, usageUnknown: result.usageUnknown, durationMs: Date.now() - start, modelCalls: read(ledgerFile).used - before });
      } catch (error) { results.push({ episode, inputHash: jsonHash(task.data), status: "FAILED", error: error instanceof Error ? error.message : "ERROR", durationMs: Date.now() - start, modelCalls: read(ledgerFile).used - before }); }
      checkpoint(); console.log(JSON.stringify({ episode, spent: read(ledgerFile).used, status: results.at(-1)!.status }));
    }
    episode = sample.id + "/ORIGINAL_RESULT_REASSESSMENT";
    if (results.some(r => r.episode === episode)) continue;
    const before = read(ledgerFile).used;
    try {
      const prepared = await prepareActionResult(project.id, action.id, sample.report, true), completion = await db.$transaction(tx => commitActionResult(tx, prepared)), replay = await db.$transaction(tx => commitActionResult(tx, prepared));
      const conversation = await createConversation(actor, { requestId: "eval-conversation-" + sample.id, scope: "WORKSPACE" }), ref = { kind: "MISSION" as const, id: mission.id, projectId: project.id };
      await db.$transaction(tx => bindRefs(tx, conversation.id, [{ ...ref, title: mission.goal, href: "/" }]));
      const source = { id: "action:" + action.id, hash: (await sourceHash(project.id, "action:" + action.id))! };
      const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
      const change = await submitConversationReview(actor, conversation.id, { requestId: "after-result", expectedConversationVersion: 1, ref, purpose: "CHANGE_REVIEW", expectedVersion: current.version, llmContextApproved: true, sources: [source] });
      let dynamic = null;
      if (change.review?.status === "READY" && (change.review.result as { decision: string })?.decision !== "KEEP_PLAN") dynamic = await submitConversationReview(actor, conversation.id, { requestId: "after-result-plan", expectedConversationVersion: change.conversation.version, ref, purpose: "DYNAMIC_PLAN", expectedVersion: current.version, llmContextApproved: true, reviewId: change.review.id });
      results.push({ episode, status: change.review?.status, modelCalls: read(ledgerFile).used - before, exactCompletionReplay: replay.alreadyDone === true, resultCardId: completion.updatedAction.resultCardId, actionId: action.id, actionCount: await db.actionItem.count({ where: { projectId: project.id } }), expectedDecision: sample.expectedAfter, change: change.review, dynamic: dynamic?.review ?? null, conversation: await readConversation(actor, conversation.id) });
    } catch (error) { results.push({ episode, status: "FAILED", error: error instanceof Error ? error.message : "ERROR", modelCalls: read(ledgerFile).used - before }); }
    checkpoint(); console.log(JSON.stringify({ episode, spent: read(ledgerFile).used, status: results.at(-1)!.status }));
  }
} finally { globalThis.fetch = original; await db.$disconnect(); }
