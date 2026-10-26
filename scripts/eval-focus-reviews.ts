import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
const episodes = JSON.parse(fs.readFileSync("scripts/focus-review-episodes.json", "utf8")) as { callCeiling: number; episodes: Array<{ id: string; group: string; goal: string; material: string; expected: string; feedback: string }> };
if (!process.argv.includes("--real") || !process.argv.includes("--confirm-paid-calls")) {
  process.stdout.write(JSON.stringify({ mode: "PREPARED_ONLY", episodes: episodes.episodes.length, callCeiling: episodes.callCeiling, dataset: "scripts/focus-review-episodes.json", calls: 0 }, null, 2));
  process.exit(0);
}
if (process.env.LLM_MODE !== "openai-compatible") throw new Error("真实模型验收需要已配置的 openai-compatible 模型");
// Switch before importing db; never migrate, seed or reset the user's database.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-f3-real-"));
process.env.DATABASE_URL = "file:" + path.join(dir, "eval.db").replaceAll("\\", "/");
Object.assign(process.env, { MISSION_ENABLED: "true", GOAL_CHANGE_REVIEW_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", SEMANTIC_MEMORY_ENABLED: "false" });
const sql = new Database(path.join(dir, "eval.db"));
for (const migration of fs.readdirSync("prisma/migrations").sort()) { const file = path.join("prisma/migrations", migration, "migration.sql"); if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8")); }
sql.close();
const { db } = await import("../lib/db");
const { createSession } = await import("../lib/auth/session");
const { createMission } = await import("../lib/mission/missionService");
const { sourceHash } = await import("../lib/mission/repository");
const { createChangeReview } = await import("../lib/decision/changeUnderstanding");
const { createDynamicReview } = await import("../lib/decision/dynamicCandidates");
let calls = 0;
const budgetPath = path.resolve(process.env.FOCUS_REVIEW_BUDGET_FILE ?? "output/focus-review-call-budget.json");
fs.mkdirSync(path.dirname(budgetPath), { recursive: true });
const budget = fs.existsSync(budgetPath) ? JSON.parse(fs.readFileSync(budgetPath, "utf8")) as { limit: number; used: number } : { limit: 48, used: 0 };
const fetchProvider = globalThis.fetch;
globalThis.fetch = async (...args) => {
  if (calls >= episodes.callCeiling || budget.used >= Math.min(48, budget.limit)) throw new Error("达到48次调用上限，停止验收");
  calls++; budget.used++; fs.writeFileSync(budgetPath, JSON.stringify(budget));
  const response = await fetchProvider(...args);
  const payload = await response.clone().json().catch(() => null) as { choices?: unknown; usage?: unknown } | null;
  fs.writeFileSync(path.join(output, `response-${calls}.json`), JSON.stringify({ choices: payload?.choices, usage: payload?.usage }, null, 2));
  return response;
};
const output = path.resolve("output", "focus-f3-real-" + new Date().toISOString().replaceAll(/[:.]/g, "-"));
fs.mkdirSync(output, { recursive: true });
const results: unknown[] = [];
try {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "F3独立验收", passwordHash: "unusable" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  if (process.argv.includes("--conversation")) {
    const { createConversation } = await import("../lib/conversation/service");
    const { submitConversationTurn } = await import("../lib/conversation/turnService");
    const project = await db.project.create({ data: { title: "模型A部署复核", goal: "在设备D的6GB预算内部署模型A", description: "真实模型调用，独立测试资料", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "F3_EVALUATION", rawText: "设备D模型A部署日志：推理batch=1，实测峰值6.8GB，目标预算6GB；缓存口径待核对。" } });
    await db.knowledgeCard.create({ data: { projectId: project.id, captureId: capture.id, title: "设备D模型A部署日志", summary: capture.rawText, type: "experiment_log", keywords: ["模型A", "部署", "显存"], relatedTasks: [], nextActions: [], importance: 3 } });
    const conversation = await createConversation(actor, { requestId: "cloud-conversation", scope: "PROJECT", projectId: project.id });
    const turn = await submitConversationTurn(actor, conversation.id, { requestId: "cloud-answer", expectedVersion: 1, projectId: project.id, message: "根据设备D模型A部署日志，目前符合6GB预算吗？请指出文件依据与缺口。", llmContextApproved: true });
    const answer = turn.conversation.messages.at(-1);
    fs.writeFileSync(path.join(output, "conversation.json"), JSON.stringify({ kind: "REAL_MODEL_CONVERSATION", calls, status: turn.status, title: turn.conversation.title, answer }, null, 2));
    console.log(JSON.stringify({ output, calls, status: turn.status, provider: answer?.provider, files: answer?.fileGuides?.length ?? 0 }));
  }
  const selectedId = process.argv.find(arg => arg.startsWith("--episode="))?.split("=", 2)[1];
  const selectedEpisodes = process.argv.includes("--conversation") ? [] : selectedId ? episodes.episodes.filter(episode => episode.id === selectedId) : episodes.episodes;
  if (!selectedEpisodes.length && !process.argv.includes("--conversation")) throw new Error("没有对应的冻结案例");
  for (const episode of selectedEpisodes) {
    const project = await db.project.create({ data: { title: episode.id + " " + episode.group, goal: episode.goal, description: "独立验收输入", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
    const mission = await createMission(user.id, { requestId: episode.id, projectId: project.id, goal: episode.goal, llmContextApproved: true });
    const capture = await db.capture.create({ data: { projectId: project.id, rawText: episode.material, sourceType: "F3_EVALUATION" } });
    const id = "capture:" + capture.id, startCalls = calls;
    let result: unknown;
    try {
      const change = await createChangeReview(actor, mission.id, { requestId: episode.id + "-d1", expectedVersion: mission.version, sources: [{ id, hash: await sourceHash(project.id, id) }], llmContextApproved: true });
      const dynamic = change.status === "READY" && change.result && "decision" in change.result && change.result.decision !== "KEEP_PLAN" ? await createDynamicReview(actor, mission.id, { requestId: episode.id + "-d2", reviewId: change.id, llmContextApproved: true }) : null;
      const feedback = dynamic?.status === "READY" ? await createDynamicReview(actor, mission.id, { requestId: episode.id + "-feedback", reviewId: change.id, llmContextApproved: true, retry: true, feedback: episode.feedback }) : null;
      result = { change, dynamic, feedback };
    } catch (error) { result = { error: error instanceof Error ? error.message : "验收未完成" }; }
    results.push({ ...episode, calls: calls - startCalls, result, reviewerPass: null, reviewerNote: "", executionAcceptance: "NOT_RUN" });
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ kind: "REAL_MODEL_SEMANTIC_REVIEW", calls, maxCalls: 48, results }, null, 2));
    console.log(JSON.stringify({ episode: episode.id, completed: results.length, calls }));
  }
  console.log(JSON.stringify({ output, calls, episodes: results.length, independentReview: "PENDING", originalRunnerAcceptance: "use isolated integration and browser evidence separately", targetUserStudy: "PENDING" }));
} finally { globalThis.fetch = fetchProvider; await db.$disconnect(); }
