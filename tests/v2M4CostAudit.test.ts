import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("m4-cost-audit"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, editContinuationPolicy } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { fixtureSkillProvider } from "../scripts/fixtures/v2-provider";
import { projectTools } from "@/lib/mission/tools";

Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture(maxModels: number, maxTools: number) {
  const user = await db.user.create({ data: { username: "cost-" + crypto.randomUUID(), displayName: "成本", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "成本项目", description: "隔离", goal: "报告", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: "成本审计资料：结果待核对。" } });
  const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "整理持续报告", llmContextApproved: true });
  const mission = await editContinuationPolicy(user.id, created.id, { requestId: "grant", expectedVersion: created.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(),
    checkEveryMinutes: 60, maxModels, maxTools, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output"], connectionIds: [], timezone: "Asia/Shanghai" } });
  const provider = fixtureSkillProvider(async () => { const source = await readProjectMaterial(project.id, "capture:" + capture.id); return { sourceId: source!.id, sourceHash: source!.hash }; });
  return { user, project, mission, provider };
}
const usage = async (id: string) => { const raw = (await db.agentMission.findUniqueOrThrow({ where: { id } })).budgetUsedJson as Record<string, number>;
  return { ...raw, models: raw.models ?? 0, tools: raw.tools ?? 0, unknownCalls: raw.unknownCalls ?? 0, reservedOutputTokens: raw.reservedOutputTokens ?? 0 }; };

test("model hard gate blocks dispatch before the provider is called and never resets usage", async () => {
  const f = await fixture(1, 10);
  let providerCalls = 0;
  const provider = async (raw: string) => { providerCalls++; return f.provider(raw, projectTools); };
  await runMissionSlice({ id: f.mission.id, provider });
  const afterFirst = await usage(f.mission.id);
  expect(afterFirst.models).toBe(1); expect(providerCalls).toBe(1);
  await runMissionSlice({ id: f.mission.id, provider });
  const afterSecond = await usage(f.mission.id);
  expect(providerCalls).toBe(1);
  expect(afterSecond.models).toBe(1);
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect((row.lastErrorJson as { code?: string } | null)?.code).toBe("BUDGET_EXHAUSTED");
  expect(afterSecond.models).toBeGreaterThanOrEqual(afterFirst.models);
});

test("tool hard gate blocks a second tool after the tool budget is spent", async () => {
  const f = await fixture(10, 1);
  await runMissionSlice({ id: f.mission.id, provider: f.provider });
  let providerCalls = 0;
  const provider = async (raw: string) => { providerCalls++; return f.provider(raw, projectTools); };
  await runMissionSlice({ id: f.mission.id, provider });
  expect(providerCalls).toBe(1);
  expect(await db.agentMissionStep.count({ where: { missionId: f.mission.id, status: "SUCCEEDED" } })).toBe(1);
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect((row.lastErrorJson as { code?: string } | null)?.code).toBe("BUDGET_EXHAUSTED");
  expect((await usage(f.mission.id)).tools).toBe(1);
});

test("unknown usage stays UNKNOWN, reservations do not silently reset, and another Mission keeps its own budget", async () => {
  const f = await fixture(10, 10), other = await fixture(10, 10);
  const failing = async () => { throw Object.assign(new Error("model timeout"), { code: "MODEL_TIMEOUT", status: 504 }); };
  await runMissionSlice({ id: f.mission.id, provider: failing });
  const failed = await usage(f.mission.id);
  expect(failed.unknownCalls).toBeGreaterThanOrEqual(1);
  expect(failed.models).toBeGreaterThanOrEqual(1);
  expect(failed.reservedOutputTokens).toBeGreaterThanOrEqual(2000);
  expect((await usage(other.mission.id)).models).toBe(0);
  // A later successful cycle on the other Mission must not consume or reset the failed reservation.
  await runMissionSlice({ id: other.mission.id, provider: other.provider });
  const otherUsage = await usage(other.mission.id);
  expect(otherUsage.models).toBe(1);
  expect(otherUsage.reservedOutputTokens).toBe(0);
  expect((await usage(f.mission.id)).reservedOutputTokens).toBe(failed.reservedOutputTokens);
});
