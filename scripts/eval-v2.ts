/**
 * V2 continuous-revision evaluation (Slice A).
 *
 * Four synthetic journeys (developer release / client delivery / research report / course project)
 * run through the real modelAdapter, Mission Runner, Worker scan, tool guards and result verifier:
 *   first draft → new material → background continuation → network restriction → bounded redirect
 *   → second delivery → pause/cancel.
 *
 * Providers:
 *   --provider=fixture  injected deterministic test transport (default, offline)
 *   --provider=http     a local OpenAI-compatible mock server; the real chooseNext HTTP adapter is used
 *   --provider=live     real model; requires --confirm-paid plus LLM_MODE/LLM_API_KEY/LLM_BASE_URL
 *
 *   npm.cmd exec tsx -- scripts/eval-v2.ts --provider=fixture
 *   npm.cmd exec tsx -- scripts/eval-v2.ts --provider=http
 *   (pending explicit authorization) npm.cmd exec tsx -- scripts/eval-v2.ts --provider=live --confirm-paid --max-models=12 --max-tokens=60000
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const prefix = "--" + name + "=";
  const inline = args.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf("--" + name);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes("--" + name);
const providerMode = (arg("provider") ?? "fixture") as "fixture" | "http" | "live";
if (!["fixture", "http", "live"].includes(providerMode)) { console.error("未知 provider：" + providerMode); process.exit(2); }
const maxModels = Math.max(1, Math.min(240, Number(arg("max-models") ?? (providerMode === "live" ? 12 : 40))));
const maxTokens = Math.max(1000, Number(arg("max-tokens") ?? 60000));
const outDir = path.resolve(arg("out") ?? path.join("evidence/v2-first-loop/eval-v2", providerMode));
const selectedJourneys = (arg("journeys") ?? "all").split(",").map(value => value.trim()).filter(Boolean);

if (providerMode === "live") {
  const approved = has("confirm-paid");
  const configured = process.env.LLM_MODE === "openai-compatible" && !!process.env.LLM_API_KEY && !!process.env.LLM_BASE_URL;
  if (!approved || !configured) {
    console.error("LIVE_MODEL_NOT_AUTHORIZED: 真实付费调用需要 --confirm-paid，并在环境中提供 LLM_MODE=openai-compatible、LLM_API_KEY、LLM_BASE_URL、LLM_MODEL_NAME。");
    console.error("未执行任何真实模型调用；可先运行 --provider=fixture 或 --provider=http 验证评测执行器。");
    process.exit(2);
  }
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-v2-eval-"));
const databaseFile = path.join(tempDir, "eval.db");
Object.assign(process.env, {
  DATABASE_URL: "file:" + databaseFile.replaceAll("\\", "/"), LLM_MODE: "mock",
  MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
  MISSION_WORKBENCH_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true",
  MISSION_WAIT_EMAIL_ENABLED: "false",
});
const bootstrap = new Database(databaseFile);
bootstrap.pragma("journal_mode = WAL");
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const migrationFile = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migrationFile)) bootstrap.exec(fs.readFileSync(migrationFile, "utf8"));
}
bootstrap.close();

const { db } = await import("@/lib/db");
const { JOURNEYS, runJourney } = await import("@/lib/evaluation/journey");
const { protocolChecks, contentChecks } = await import("@/lib/evaluation/journeyChecks");
const { readProjectMaterial } = await import("@/lib/mission/sourceSignals");
const { textHash } = await import("@/lib/research/sourceRepository");

type Choice = Record<string, unknown>;
async function latestPointers(projectId: string): Promise<Array<{ sourceId: string; sourceHash: string }>> {
  // Insertion order is deterministic even when several captures share one timestamp.
  const captures = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Capture" WHERE "projectId" = ${projectId} ORDER BY rowid DESC`;
  const pointers: Array<{ sourceId: string; sourceHash: string }> = [];
  for (const capture of captures) {
    const source = await readProjectMaterial(projectId, "capture:" + capture.id);
    if (source) pointers.push({ sourceId: source.id, sourceHash: source.hash });
  }
  return pointers;
}

/** Local OpenAI-compatible mock. The production chooseNext adapter performs the real HTTP/JSON path. */
function startMockChatServer() {
  const readThisCycle = new Set<string>(), counts = new Map<string, number>();
  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) { response.writeHead(404).end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    type MockContext = {
      contextVersion?: number; goal?: string; sourceInput?: { projectId?: string };
      continuity?: { workingObjective?: string | null };
      skillExecution?: { stage: string; outputId?: string; evidencePack?: { sources: Array<{ id: string; text: string }>; unknowns?: Array<{ column?: string }> } };
    };
    let context: MockContext | null = null;
    try {
      const parsed = JSON.parse(body) as { messages?: Array<{ content?: string }> };
      const envelope = JSON.parse(parsed.messages?.[1]?.content ?? "null") as { kind?: string; context?: MockContext } | MockContext | null;
      context = (envelope as { context?: MockContext } | null)?.context ?? (envelope as MockContext | null);
    } catch { context = null; }
    const skill = context?.skillExecution;
    let choice: Choice;
    if (!skill) {
      choice = { kind: "ask", question: "请补充本轮工作目标", missing: "PRIVATE" };
    } else {
      const scopeKey = String(context?.sourceInput?.projectId ?? "") + ":" + String(context?.contextVersion ?? 0);
      const key = scopeKey + ":" + skill.stage;
      if (skill.outputId && (skill.stage === "deliverable-creation" || readThisCycle.has(key))) {
        choice = { kind: "await_event", outputId: skill.outputId, reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] };
      } else if (skill.stage !== "deliverable-creation") {
        readThisCycle.add(key);
        const projectId = context?.sourceInput?.projectId ?? "";
        const pointers = await latestPointers(projectId);
        const cycleKey = scopeKey, count = counts.get(cycleKey) ?? 0;
        counts.set(cycleKey, count + 1);
        choice = pointers.length
          ? { kind: "tool", tool: "read_project_material", args: pointers[count % pointers.length], summary: "读取当前获准资料" }
          : { kind: "tool", tool: "inspect_project", args: {}, summary: "读取项目概况" };
      } else {
        const pack: Array<{ id: string; text: string }> = (skill.evidencePack?.sources ?? []).slice(-4);
        if (!pack.length) {
          choice = { kind: "ask", question: "当前证据包为空，请补充资料", missing: "PRIVATE" };
        } else {
          const blocks: Choice[] = pack.map((source, index) => {
            const text = source.text.slice(0, 900);
            return { blockId: "source-" + (index + 1), kind: "PROJECT_OBSERVATION", text: "项目资料记载：" + text, sourceIds: [source.id],
              citations: [{ sourceId: source.id, start: 0, end: text.length, excerptHash: textHash(text) }] };
          });
          blocks.push({ blockId: "working-note", kind: "INFERENCE", text: "本轮工作重点：" + (context?.continuity?.workingObjective ?? context?.goal ?? "") + "。尚缺条件按原资料保留为未知。私有工作稿不代表现实工作已经完成。", sourceIds: [] });
          choice = { kind: "tool", tool: "save_mission_output", summary: "依据证据包更新私有工作稿", args: { blocks } };
        }
      }
    }
    const payload = { id: "mock-" + randomUUID(), object: "chat.completion", created: Math.floor(Date.now() / 1000),
      model: "mock-local-model", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(choice) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40 } };
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
  });
  return new Promise<{ baseUrl: string; close: () => void }>(resolve => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ baseUrl: "http://127.0.0.1:" + port, close: () => server.close() });
    });
  });
}

let mock: Awaited<ReturnType<typeof startMockChatServer>> | null = null;
if (providerMode === "http") {
  mock = await startMockChatServer();
  Object.assign(process.env, { LLM_MODE: "openai-compatible", LLM_PROVIDER: "openai-compatible",
    LLM_BASE_URL: mock.baseUrl, LLM_API_KEY: "mock-local-only", LLM_MODEL_NAME: "mock-local-model", LLM_TIMEOUT_MS: "10000" });
}
if (providerMode === "live") {
  // The live path uses the real chooseNext adapter through the configured environment; no injected provider.
  if (process.env.LLM_MODE !== "openai-compatible") { console.error("LIVE_MODEL_NOT_CONFIGURED"); process.exit(2); }
}

const journeys = JOURNEYS.filter(journey => selectedJourneys.includes("all") || selectedJourneys.includes(journey.id));
if (!journeys.length) { console.error("没有匹配的合成项目：" + selectedJourneys.join(",")); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const started = Date.now();
const records = [];
for (const definition of journeys) {
  process.stdout.write("运行合成项目：" + definition.label + "（provider=" + providerMode + "）\n");
  const record = await runJourney(definition, providerMode, { tokenCeiling: maxTokens, modelCeiling: maxModels });
  const protocol = protocolChecks(record);
  const content = contentChecks(record);
  records.push({ definition, record, protocol, content });
  const summarize = (checks: Array<{ name: string; passed: boolean; detail: string }>) =>
    checks.map(check => (check.passed ? "PASS " : "FAIL ") + check.name + (check.passed ? "" : "：" + check.detail)).join("\n  ");
  process.stdout.write("  协议：" + protocol.filter(check => check.passed).length + "/" + protocol.length + "\n  " + summarize(protocol) + "\n");
  process.stdout.write("  内容（注入/模拟管道级）：" + content.filter(check => check.passed).length + "/" + content.length + "\n  " + summarize(content) + "\n");
}
const allProtocol = records.flatMap(item => item.protocol), allContent = records.flatMap(item => item.content);
const report = {
  provider: providerMode,
  providerLabel: providerMode === "fixture" ? "INJECTED_V2_JOURNEY（离线注入，确定性）" : providerMode === "http" ? "MOCK_HTTP_LOCAL（真实 chooseNext HTTP 适配器）" : "LIVE_MODEL",
  generatedAt: new Date().toISOString(), durationMs: Date.now() - started,
  journeys: records.map(item => ({
    id: item.definition.id, label: item.definition.label,
    protocol: { passed: item.protocol.filter(check => check.passed).length, total: item.protocol.length, checks: item.protocol },
    content: { passed: item.content.filter(check => check.passed).length, total: item.content.length, checks: item.content },
    missionId: item.record.missionId, versions: item.record.versions.map(version => ({ revision: version.revision, outputId: version.outputId, checkpointSeq: version.checkpointSeq, sourceRefs: version.sourceRefs })),
    phases: item.record.phases, tools: item.record.tools,
    modelRuns: item.record.modelRuns, wake: item.record.wake, control: item.record.control, failures: item.record.failures,
    budget: item.record.budget,
  })),
  totals: { protocolPassed: allProtocol.filter(check => check.passed).length, protocolTotal: allProtocol.length,
    contentPassed: allContent.filter(check => check.passed).length, contentTotal: allContent.length },
  tokensUsed: records.flatMap(item => item.record.modelRuns).reduce((total, run) => {
    const usage = run.usage as { inputTokens?: number | null; outputTokens?: number | null } | null;
    return total + Number(usage?.inputTokens ?? 0) + Number(usage?.outputTokens ?? 0);
  }, 0),
  limits: { maxModels, maxTokens },
  pendingRealModelCommand: providerMode === "live" ? null
    : "npm.cmd exec tsx -- scripts/eval-v2.ts --provider=live --confirm-paid --max-models=12 --max-tokens=60000（需用户明确授权调用范围与上限）",
  note: "内容维度在 fixture/http 模式下证明材料、证据与用户控制确实进入持久草稿；不代表真实模型写作质量，真实模型质量需 --provider=live 单独验收。",
};
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "journeys.jsonl"), records.map(item => JSON.stringify({ id: item.definition.id, record: item.record, protocol: item.protocol, content: item.content })).join("\n") + "\n");
console.log(JSON.stringify({ provider: providerMode, totals: report.totals, tokensUsed: report.tokensUsed, durationMs: report.durationMs, report: path.join(outDir, "report.json") }, null, 2));
await db.$disconnect();
mock?.close();
if (process.env.PM_KEEP_DB) console.log("TEMP_DB=" + databaseFile);
else try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* keep locked temp dir */ }
const protocolFailed = report.totals.protocolPassed !== report.totals.protocolTotal;
const contentFailed = report.totals.contentPassed !== report.totals.contentTotal;
process.exitCode = protocolFailed || contentFailed ? 1 : 0;
