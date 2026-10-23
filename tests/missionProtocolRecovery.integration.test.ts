import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-protocol-recovery-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "isolated.db").replaceAll("\\", "/")}`;
  const sql = new Database(path.join(directory, "isolated.db"));
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const file = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8")); }
  sql.close(); return { directory };
});
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { createMission, commandMission, missionDetail } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { usageOf } from "@/lib/mission/contracts";
import { EvaluationBudget } from "../scripts/mission-evaluation/budget";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.directory, { recursive: true, force: true }); });

describe("actual Adapter/Runner recovery with isolated SQLite and mocked HTTP only", () => {
  it("two invalid decisions pause; explicit resume keeps Mission, successful reads and cumulative budget", async () => {
    const user = await db.user.create({ data: { username: "protocol-fixture", displayName: "隔离测试", passwordHash: "unused" } });
    const project = await db.project.create({ data: { title: "协议恢复测试", description: "合成测试", goal: "保存待审阅草稿", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
    for (const [key, value] of Object.entries({ MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true", MISSION_SEMANTIC_CHECK_ENABLED: "true", MISSION_CLAIM_JUDGE_ENABLED: "false",
      LLM_MODE: "openai-compatible", LLM_PROVIDER: "deepseek", LLM_BASE_URL: "https://api.deepseek.com", LLM_MODEL_NAME: "deepseek-flash", LLM_API_KEY: "FIXTURE_KEY", MISSION_MODEL_PROTOCOL: "json" })) vi.stubEnv(key, value);
    const mission = await createMission(user.id, { projectId: project.id, requestId: project.id, goal: project.goal, llmContextApproved: true });
    const budgetFile = path.join(isolated.directory, "budget.json");
    const budget = await EvaluationBudget.acquire(budgetFile, { provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-flash", apiKey: "FIXTURE_KEY", timeoutMs: 1000 }, { live: false, maxRequests: 60, maxCostCny: 10 });
    const requests: Array<Record<string, unknown>> = [];
    let choice: unknown = { kind: "tool", tool: "inspect_project", args: {} }, malformed = false;
    vi.stubGlobal("fetch", budget.wrapFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)); requests.push(body);
      const content = malformed ? '{"kind":"tool","args":' : JSON.stringify(choice);
      const message = body.tool_choice ? { content: null, tool_calls: [{ id: `wire-${requests.length}`, function: { name: "select_mission_step", arguments: content } }] } : { content };
      return new Response(JSON.stringify({ choices: [{ finish_reason: body.tool_choice ? "tool_calls" : "stop", message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    }));
    try {
      await runMissionSlice({ id: mission.id });
      const readStep = (await missionDetail(user.id, mission.id)).steps[0].id;
      malformed = true;
      await runMissionSlice({ id: mission.id }); await runMissionSlice({ id: mission.id });
      const failed = await missionDetail(user.id, mission.id);
      expect(failed.status).toBe("PAUSED"); expect(failed.steps.map(step => step.id)).toEqual([readStep]);
      expect(failed.error).toMatchObject({ code: "MODEL_PROTOCOL_ERROR", recovery: { automatic: false, attempt: 2 }, diagnostic: { json: { responseHash: expect.any(String) } } });
      expect(usageOf(failed.used).models).toBe(3); expect(budget.summary().requestsStarted).toBe(3);
      expect(await runMissionSlice({ id: mission.id })).toBe(false);
      await commandMission(user.id, mission.id, "resume", { requestId: "authorized-fixture-retry", expectedVersion: failed.version });
      malformed = false; choice = { kind: "tool", tool: "save_mission_output", args: { blocks: [{ blockId: "suggestion", text: "建议核对实验原始记录，当前没有实测结论。", kind: "INFERENCE", sourceIds: [] }] } };
      await runMissionSlice({ id: mission.id });
      const saved = await missionDetail(user.id, mission.id);
      choice = { kind: "finish", outputId: saved.outputs[0].id }; await runMissionSlice({ id: mission.id });
      const completed = await missionDetail(user.id, mission.id);
      expect(completed.id).toBe(mission.id); expect(completed.status).toBe("SUCCEEDED");
      expect(completed.steps[0].id).toBe(readStep); expect(completed.outputs).toHaveLength(1);
      expect(usageOf(completed.used).models).toBe(5); expect(budget.summary().requestsStarted).toBe(5);
      expect(requests[2]).toHaveProperty("tool_choice"); expect(requests[3]).toHaveProperty("tool_choice");
      expect(await db.agentMissionEvent.count({ where: { missionId: mission.id, type: "MODEL_PROTOCOL_ERROR" } })).toBe(2);
      expect(await db.actionItem.count({ where: { projectId: project.id } })).toBe(0);
      expect(completed.completion).toMatchObject({ criteriaPassed: true, draftVerification: "NEEDS_REVIEW", realityOutcome: "NOT_INFERRED" });
    } finally { await budget.close(); }
  });
});
