import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { ResearchEvaluationBudget } from "./research-evaluation/budget";
const runId = "ct1-live-20261028", root = path.resolve("output/r4-continuity", runId);
const cases = [
  { id: "demo", scenario: "COMPETITION" as const, goal: "比较改进方法，完成目标设备演示", correction: "本周先稳演示，先别加功能", record: "已有安装自报；没有目标设备启动日志，也没有现场演示回执。", topic: "HarmonyOS 应用调试启动日志", terms: ["HarmonyOS", "应用调试", "启动日志"], hosts: ["developer.huawei.com"] },
  { id: "research", scenario: "RESEARCH" as const, goal: "改进检索方法并在同条件实验中验证收益", correction: "本周先核对实验的可比性，暂缓换模型", record: "A 用 split-1，B 用 split-2；记录中的两个准确率不能直接作同条件比较。", topic: "机器学习实验可复现同条件比较", terms: ["machine learning", "reproducibility", "evaluation"], hosts: ["pytorch.org", "arxiv.org"] },
];
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const runtimeHash = () => hash(fs.readdirSync("lib", { recursive: true }).map(String).filter(f => f.endsWith(".ts")).sort().map(f => [f, hash(fs.readFileSync(path.join("lib", f), "utf8"))]));
fs.mkdirSync(root, { recursive: true });
const plan = { status: "PREPARED_ONLY", runId, fixtureStatus: "COMPRESSED_MULTI_DAY_SYNTHETIC_MODEL_PILOT_NOT_INDEPENDENT_HUMAN_REVIEW", fixtureHash: hash(cases), runtimeHash: runtimeHash(), cases,
  modelLimit: 72, externalLimit: 24, usdLimit: 3, providerPricing: "https://api-docs.deepseek.com/quick_start/pricing/", businessData: "isolated synthetic database only", independentQuality: "PENDING" };
fs.writeFileSync(path.join(root, "plan.json"), JSON.stringify(plan, null, 2));
if (!process.argv.includes("--real")) { console.log(JSON.stringify(plan)); process.exit(0); }
await import("dotenv/config");
const budget = new ResearchEvaluationBudget(path.join(root, "authorized-budget.json"), runId);
process.once("exit", () => budget.close());
const sqlite = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-ct1-real-")), "test.sqlite");
const resultsPath = path.join(root, "results.json");
if (fs.existsSync(resultsPath)) throw new Error("CT1_PILOT_ALREADY_ATTEMPTED_NO_AUTOMATIC_RESEND");
Object.assign(process.env, { DATABASE_URL: "file:" + sqlite.replaceAll("\\", "/"), FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", FOCUS_ASYNC_ENABLED: "false",
  FOCUS_WEB_ENABLED: "true", MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", LLM_MODE: "openai-compatible", SEMANTIC_MEMORY_ENABLED: "false" });
const sql = new Database(sqlite);
for (const name of fs.readdirSync("prisma/migrations").sort()) { const file = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8")); } sql.close();
const { db } = await import("../lib/db"), { createSession } = await import("../lib/auth/session"),
  { createConversation, readConversation } = await import("../lib/conversation/service"), { submitConversationTurn } = await import("../lib/conversation/turnService"),
  { updateResearchScope } = await import("../lib/conversation/researchScope"), { createMission, commandMission } = await import("../lib/mission/missionService"),
  { openHandoffWork } = await import("../lib/continuity/handoff"), { readConversationWork, previewConversationWork } = await import("../lib/conversation/workService"),
  { confirmConversationProposal } = await import("../lib/conversation/missionCommands");
const original = globalThis.fetch; let episode = "";
globalThis.fetch = async (target, init) => {
  const url = typeof target === "string" ? target : target instanceof URL ? target.href : target.url, body = String(init?.body ?? "");
  if (url.includes("/tools/") && body.includes("SYNTHETIC_PRIVATE_CANARY")) throw new Error("PRIVATE_QUERY_LEAK_BLOCKED");
  const id = budget.reserve(episode, url, body);
  try {
    const response = await original(target, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(25000)]) });
    let raw = await response.clone().text(); for (const key of [process.env.LLM_API_KEY, process.env.MISSION_SEARCH_API_KEY].filter(Boolean)) raw = raw.split(key!).join("[REDACTED]");
    fs.writeFileSync(path.join(root, `response-${id}.json`), JSON.stringify({ episode, status: response.status, response: raw })); budget.settle(id, response.status, raw); return response;
  } catch (e) { budget.unknown(id); throw e; }
};
const saved = { ...plan, status: "RUNNING", database: sqlite, results: [] as Array<{ episode: string; status: string; view?: unknown; error?: string }> };
const save = () => fs.writeFileSync(resultsPath, JSON.stringify(saved, null, 2)); save();
try {
  for (const sample of cases) {
    if (budget.attempted(sample.id + "/DAY1")) throw new Error("PRIOR_PILOT_CALLS_NOT_RESENT");
    const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "CT1 合成模型验收", passwordHash: "unused" } });
    const actor = { userId: u.id, sessionId: (await createSession(u.id)).session.id };
    const p = await db.project.create({ data: { title: "CT1 " + sample.id, scenario: sample.scenario, goal: sample.goal, description: "SYNTHETIC_PRIVATE_CANARY", memberships: { create: { userId: u.id } } } });
    const capture = await db.capture.create({ data: { projectId: p.id, rawText: sample.record } });
    await db.knowledgeCard.create({ data: { projectId: p.id, captureId: capture.id, type: "experiment_log", title: "当前验证记录", summary: "原始记录包含适用条件和验证缺口，需读取原文。", importance: 3, keywords: [], relatedTasks: [], nextActions: [] } });
    const c = await createConversation(actor, { requestId: "create", scope: "PROJECT", projectId: p.id });
    await updateResearchScope(actor, c.id, { expectedRevision: 1, projectId: p.id, scope: { enabled: true, topic: sample.topic, publicTerms: sample.terms, allowedHosts: sample.hosts } });
    const mission = await createMission(u.id, { requestId: "mission", projectId: p.id, goal: "核对本项目验证证据", llmContextApproved: true });
    await commandMission(u.id, mission.id, "pause", { requestId: "pause", expectedVersion: mission.version });
    for (const day of ["DAY1", "DAY3", "DAY5"]) {
      episode = sample.id + "/" + day; save();
      let conversationId = c.id;
      if (day === "DAY5") conversationId = (await createConversation(actor, { requestId: "day5", scope: "PROJECT", projectId: p.id })).id;
      const view = await readConversation(actor, conversationId);
      try {
        const result = await submitConversationTurn(actor, conversationId, { requestId: episode, expectedVersion: view.version, expectedContinuitySeq: view.continuity!.seq, projectId: p.id,
          message: day === "DAY1" ? "请调查公开官方资料和本项目原始记录，判断下一步，区分公开结论与本项目验证。" : day === "DAY3" ? sample.correction : "接着当前重点继续：上次的任务和结果还缺什么，下一步应由谁完成？", llmContextApproved: true, investigationMode: "STANDARD" });
        saved.results.push({ episode, status: result.status, view: result.conversation });
        if (day === "DAY3") {
          await openHandoffWork(actor, c.id, { kind: "MISSION", id: mission.id, projectId: p.id });
          const ref = { kind: "MISSION" as const, id: mission.id, projectId: p.id }, work = await readConversationWork(actor, c.id, ref), current = await readConversation(actor, c.id);
          if (work.status === "PAUSED") {
            const preview = await previewConversationWork(actor, c.id, { requestId: "resume-preview", expectedConversationVersion: current.version, ref, versionToken: work.versionToken, operation: "resume" });
            const proposal = preview.conversation.messages.at(-1)!.proposal!;
            await confirmConversationProposal(actor, c.id, proposal.executionId, { requestId: "resume-confirm", proposalHash: proposal.proposalHash, confirmed: true });
          }
        }
      } catch (e) { saved.results.push({ episode, status: "FAILED_OR_UNKNOWN", error: e instanceof Error ? e.message : "unknown" }); }
      save(); console.log(JSON.stringify({ episode, ...budget.summary() }));
    }
  }
  saved.status = runtimeHash() === plan.runtimeHash ? "RECEIVED_FOR_INDEPENDENT_REVIEW" : "RUNTIME_CHANGED_NOT_VALID_FOR_COMPARISON"; save();
} finally { globalThis.fetch = original; budget.close(); await db.$disconnect(); }
