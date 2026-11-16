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
import Database from "better-sqlite3";

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
  DATABASE_URL: "file:" + databaseFile.replaceAll("\\", "/"), ...(providerMode === "live" ? {} : { LLM_MODE: "mock" }),
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
const { startMockModelServer } = await import("@/lib/evaluation/mockModelServer");
const { AppError } = await import("@/lib/api");
const { JOURNEYS, runJourney } = await import("@/lib/evaluation/journey");
const { protocolChecks, contentChecks } = await import("@/lib/evaluation/journeyChecks");

let mock: Awaited<ReturnType<typeof startMockModelServer>> | null = null;
if (providerMode === "http") {
  mock = await startMockModelServer();
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
const totalTokenCap = maxTokens * journeys.length;
let spentTokens = 0, decisionCalls = 0;
if (providerMode === "live") process.stdout.write("真实模型：" + (process.env.LLM_PROVIDER ?? "provider") + " / " + (process.env.LLM_MODEL_NAME ?? "model") + "；每条旅程 ≤" + maxModels + " 次调用、≤" + maxTokens + " tokens；总上限 ≤" + totalTokenCap + " tokens\n");
for (const definition of journeys) {
  process.stdout.write("运行合成项目：" + definition.label + "（provider=" + providerMode + "）\n");
  let journeyTokens = 0;
  const hooks = {
    // Refuse the next dispatch when its worst-case context+output could exceed the authorized window.
    beforeDecision: (context: string) => {
      const estimate = Math.ceil(context.length / 2) + 1500;
      if (estimate > maxTokens - journeyTokens || estimate > totalTokenCap - spentTokens)
        throw new AppError("EVAL_TOKEN_BUDGET", "评测 token 预算已达授权上限，停止下一次派发", 409,
          { journey: definition.id, journeyTokens, spentTokens, maxTokens, totalTokenCap });
    },
    onDecisionUsage: (usage: { inputTokens: number | null; outputTokens: number | null }) => {
      const used = Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0);
      journeyTokens += used; spentTokens += used; decisionCalls += 1;
    },
  };
  const record = await runJourney(definition, providerMode, { tokenCeiling: maxTokens, modelCeiling: maxModels, ...hooks });
  const protocol = protocolChecks(record);
  const content = contentChecks(record);
  records.push({ definition, record, protocol, content, journeyTokens });
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
    tokens: (item as { journeyTokens?: number }).journeyTokens ?? null,
  })),
  totals: { protocolPassed: allProtocol.filter(check => check.passed).length, protocolTotal: allProtocol.length,
    contentPassed: allContent.filter(check => check.passed).length, contentTotal: allContent.length },
  tokensUsed: spentTokens,
  decisionCalls,
  tracedTokens: records.flatMap(item => item.record.modelRuns).reduce((total, run) => {
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
