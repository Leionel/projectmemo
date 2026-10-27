import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { evaluationBudget } from "./r4-eval-budget";
if (!process.argv.includes("--real") || !process.argv.includes("--confirm-paid-calls")) { console.log(JSON.stringify({ status: "PREPARED_ONLY", modelCalls: 0 })); process.exit(0); }
const { loadEnvConfig } = await import("@next/env"); loadEnvConfig(process.cwd());
process.env.DATABASE_URL = "file:" + path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-r4-provider-only-")), "provider.sqlite").replaceAll("\\", "/");
// These are provider-only probes: no development or production database is read/written.
const { chatPromptWithMeta } = await import("../lib/agent/llmAgent"), { captureFidelityV2 } = await import("../lib/agent/specialistPrompts");
const samples = JSON.parse(fs.readFileSync("tests/fixtures/r4/pr5-cases.json", "utf8")).cases;
const output = path.resolve("output/r4-pr5/fidelity-recheck-" + captureFidelityV2.version); fs.mkdirSync(output, { recursive: true });
if (fs.existsSync(path.join(output, "results.json"))) throw new Error("Recheck already recorded; do not repeat paid calls");
let episode = ""; const guard = evaluationBudget("output/r4-pr5/model-budget.json", path.join(output, "responses.json"), () => episode), results = [];
try {
  for (const sample of samples.filter((s: { id: string }) => ["research", "course"].includes(s.id))) {
    episode = sample.id + "/CAPTURE_ATTRIBUTION_RECHECK/" + captureFidelityV2.version;
    try { const r = await chatPromptWithMeta(captureFidelityV2, { project: { title: sample.id, description: "原输入背景，不是本条用户陈述", goal: sample.goal }, rawText: sample.uncertainCapture, historyKeywords: [] });
      const parsed = captureFidelityV2.outputSchema.safeParse(JSON.parse(r.data)); results.push({ episode, status: r.status, prompt: r.prompt, schemaValid: parsed.success, content: r.data, usage: r.usage });
    } catch (error) { results.push({ episode, status: "FAILED", error: error instanceof Error ? error.message : "ERROR" }); }
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ provenance: "REAL_MODEL_SYNTHETIC_DEVELOPMENT_RECHECK", results, ledger: guard.read() }, null, 2) + "\n");
    console.log(JSON.stringify({ episode, used: guard.read().used }));
  }
} finally { guard.restore(); }
