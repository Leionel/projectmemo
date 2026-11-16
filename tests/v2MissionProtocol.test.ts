import { afterAll, beforeAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-protocol"));
import fs from "node:fs";
import Database from "better-sqlite3";
import { db } from "@/lib/db";
import { createMission, missionDetail, commandMission, editContinuationPolicy } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { choiceSchema, choiceV2Schema, createMissionSchema, type RuntimeChoice } from "@/lib/mission/contracts";
import { waitTarget } from "@/lib/mission/waitNotice";
let userId: string;
beforeAll(async () => {
  Object.assign(process.env, { MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });
  userId = (await db.user.create({ data: { username: crypto.randomUUID(), displayName: "协议测试", passwordHash: "unused" } })).id;
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture(version: 1 | 2 = 1, bounded = false) {
  const p = await db.project.create({ data: { title: "项目协议", description: "隔离测试", goal: "整理已有进展",
    scenario: "RESEARCH", memberships: { create: { userId, role: "OWNER" } } } });
  let m = await createMission(userId, { projectId: p.id, requestId: p.id, goal: "整理已有项目进展", llmContextApproved: true,
    ...(version === 2 ? { runtimeProtocolVersion: 2 } : {}) });
  if (bounded) m = await editContinuationPolicy(userId, m.id, { requestId: "grant", expectedVersion: m.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    checkEveryMinutes: 1, maxModels: 24, maxTools: 32, maxMetadataRequests: 0,
    allowedTools: ["inspect_project", "save_mission_output"] } });
  return { p, m };
}
async function step(id: string, choice: RuntimeChoice) {
  await runMissionSlice({ id, provider: async () => ({ choice, provider: "INJECTED_PROTOCOL_TEST",
    model: "fixture", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } }) });
  return missionDetail(userId, id);
}
async function draft(id: string) {
  return step(id, { kind: "tool", tool: "save_mission_output", args: { blocks: [
    { blockId: "next", kind: "INFERENCE", text: "建议继续核对项目资料", sourceIds: [] } ] }, summary: "测试私有稿" });
}
test("v1 schema/request shape stays stable; await_event is v2 only", () => {
  const choice = { kind: "await_event", outputId: "o", reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] };
  expect(choiceSchema.safeParse(choice).success).toBe(false);
  expect(choiceV2Schema.safeParse(choice).success).toBe(true);
  expect(createMissionSchema.parse({ projectId: "p", requestId: "r", goal: "准备发布稿" })).not.toHaveProperty("runtimeProtocolVersion");
  expect(createMissionSchema.safeParse({ projectId: "p", requestId: "r", goal: "准备发布稿", runtimeProtocolVersion: 3 }).success).toBe(false);
});
test("additive migration upgrades old rows without changing lifecycle, receipts or budget", () => {
  const sql = new Database(":memory:");
  sql.exec('CREATE TABLE "AgentMission" (id TEXT PRIMARY KEY, status TEXT, budgetUsedJson TEXT); INSERT INTO "AgentMission" VALUES (\'old\',\'SUCCEEDED\',\'{"models":7}\');');
  sql.exec(fs.readFileSync("prisma/migrations/20261116093000_mission_runtime_protocol_v2/migration.sql", "utf8"));
  expect(sql.prepare('SELECT * FROM "AgentMission"').get()).toEqual({ id: "old", status: "SUCCEEDED", budgetUsedJson: '{"models":7}', runtimeProtocolVersion: 1 });
  sql.close();
});
test("v1 create replay and finish retain the original meaning; worker cannot revive success", async () => {
  const { p, m } = await fixture();
  expect((await createMission(userId, { projectId: p.id, requestId: p.id, goal: "整理已有项目进展", llmContextApproved: true })).id).toBe(m.id);
  const d = await draft(m.id);
  expect((await step(m.id, { kind: "finish", outputId: d.outputs[0].id })).status).toBe("SUCCEEDED");
  const provider = vi.fn();
  expect(await runMissionSlice({ id: m.id, provider })).toBe(false);
  expect(provider).not.toHaveBeenCalled();
});
test("v1 runtime rejects await_event, and v2 without a bounded grant cannot checkpoint", async () => {
  for (const version of [1, 2] as const) {
    const { m } = await fixture(version);
    const d = await draft(m.id);
    const result = await step(m.id, { kind: "await_event", outputId: d.outputs[0].id,
      reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] });
    expect(result.status).toBe(version===1 ? "READY" : "PAUSED");
    expect(result.error).toMatchObject({code:version===1 ? "MODEL_PROTOCOL_ERROR" : "CHECKPOINT_AUTHORITY_REQUIRED"});
    expect(result.checkpoint).toBeNull();
  }
});
test("v2 checkpoint releases the slot, preserves budget, and is not a question or completion", async () => {
  const { m } = await fixture(2, true);
  const d = await draft(m.id);
  const result = await step(m.id, { kind: "await_event", outputId: d.outputs[0].id,
    reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] });
  expect(result.status).toBe("WAITING_INPUT");
  expect(result.workState.phase).toBe("WAITING_OBSERVATION");
  expect(result.question).toBeNull();
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(row.finishedAt).toBeNull();
  expect(row.executionSlot).toBeNull();
  expect(row.budgetUsedJson).toMatchObject({ models: 2, tools: 1 });
  expect(await waitTarget({ ...row, waitStateJson: { waitingFor: "OBSERVATION", questionId: "historical-question" } })).toBeNull();
  await expect(commandMission(userId, m.id, "input", { requestId: "stale", expectedVersion: row.version,
    questionId: "historical-question", answer: "不能回答观察等待" })).rejects.toMatchObject({ code: "INPUT_CHANGED" });
  const provider = vi.fn();
  expect(await runMissionSlice({ id: m.id, provider })).toBe(false);
  expect(provider).not.toHaveBeenCalled();
});
test("v2 subscription cannot expand authority; persisted v1 is the default even when v2 is enabled", async () => {
  const { m } = await fixture(2, true), d = await draft(m.id);
  const denied = await step(m.id, { kind: "await_event", outputId: d.outputs[0].id,
    reason: "DELIVERABLE_READY", subscriptionIds: ["connection:ungranted"] });
  expect(denied.error).toMatchObject({ code: "CHECKPOINT_SUBSCRIPTION_DENIED" });
  expect((await fixture()).m.runtimeProtocolVersion).toBe(1);
});
