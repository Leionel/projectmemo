import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

export async function prepareEvaluationEnvironment(live: boolean) {
  const root = process.cwd(), directory = path.join(root, "tmp", live ? "p0-a-live" : "p0-a-fixture");
  await mkdir(directory, { recursive: true });
  const relative = path.relative(await realpath(root), await realpath(directory));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("EVALUATION_PATH_ESCAPES_WORKSPACE");
  const database = path.join(directory, "evaluation.db"), markerPath = path.join(directory, "ISOLATED_EVALUATION.json");
  if (existsSync(database)) {
    if ((await lstat(database)).isSymbolicLink()) throw new Error("EVALUATION_DATABASE_SYMLINK");
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (marker.database !== database || marker.kind !== "P0_A_SYNTHETIC_EVALUATION") throw new Error("NOT_AN_EVALUATION_DATABASE");
  } else {
    await writeFile(markerPath, JSON.stringify({ kind: "P0_A_SYNTHETIC_EVALUATION", database, liveModel: live }), { mode: 0o600 });
    new Database(database).close();
  }
  process.env.DATABASE_URL = "file:./" + path.relative(root, database).replaceAll("\\", "/");
  Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true",
    MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_AUTO_CONTINUATION_ENABLED: "false", MISSION_SEMANTIC_CHECK_ENABLED: "true",
    MISSION_CLAIM_JUDGE_ENABLED: "false", MISSION_WEB_ENABLED: "false", LLM_MODE: "openai-compatible" });
  if (!live) Object.assign(process.env, { LLM_PROVIDER: "deepseek", LLM_BASE_URL: "https://api.deepseek.com", LLM_MODEL_NAME: "deepseek-flash", LLM_API_KEY: "isolated-fixture-not-a-real-key" });
  const migrated = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env: process.env, encoding: "utf8", windowsHide: true });
  if (migrated.status !== 0) throw new Error("ISOLATED_MIGRATION_FAILED");
  return { directory, database };
}

/** Deterministic HTTP fixture for the real Adapter/Runner; never admitted in live mode. */
export function fixtureFetch(): typeof fetch {
  return async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const context = JSON.parse(request.messages.find((m: { role: string }) => m.role === "user").content).context;
    const observations = [...(context.observations ?? [])];
    for (const message of request.messages.filter((m: { role: string }) => m.role === "tool"))
      observations.push({ observation: JSON.parse(message.content) });
    let choice: Record<string, unknown>;
    if (!observations.length) choice = { kind: "tool", tool: "inspect_project", args: {}, summary: "读取隔离项目" };
    else if ((context.goal ?? "").includes("协议往返探针")) choice = { kind: "tool", tool: "search_memory", args: { query: "项目", limit: 4 } };
    else if (!observations.some(item => item.observation?.sources?.some((s: { id: string }) => s.id.startsWith("card:"))))
      choice = { kind: "tool", tool: "search_memory", args: { query: "准确率 阶段汇报", limit: 4 } };
    else if (!(context.recentInputs ?? []).some((event: { type: string }) => event.type === "INPUT"))
      choice = { kind: "ask", question: "请补充复赛验证准确率的项目实验记录", missing: "PRIVATE", requirements: { terms: ["准确率"], unit: "%", period: "复赛", sourceType: "CAPTURE" } };
    else if (!(context.outputs ?? []).length) {
      const source = observations.flatMap(item => item.observation?.sources ?? []).find((s: { id: string }) => s.id.startsWith("capture:"));
      const excerpt = source.excerpts[0];
      choice = { kind: "tool", tool: "save_mission_output", args: { kind: "NOTE", blocks: [{ blockId: "result", kind: "PROJECT_OBSERVATION", text: excerpt.text,
        sourceIds: [source.id], citations: [{ sourceId: source.id, start: excerpt.start, end: excerpt.end, excerptHash: excerpt.excerptHash }] }], missingInformation: [] } };
    } else choice = { kind: "finish", outputId: context.outputs[0].id };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(choice) } }], usage: { prompt_tokens: 800, completion_tokens: 250 } }), { headers: { "Content-Type": "application/json" } });
  };
}
