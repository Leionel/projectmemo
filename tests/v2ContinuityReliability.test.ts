import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-reliability"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, editContinuationPolicy } from "@/lib/mission/missionService";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";
import { runMissionSlice } from "@/lib/mission/runner";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { fixtureSkillProvider } from "../scripts/fixtures/v2-provider";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });

async function fixture(label: string) {
  const user = await db.user.create({ data: { username: "rel-" + crypto.randomUUID(), displayName: label, passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: label, description: "隔离可靠性资料", goal: "整理持续报告", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "TEXT", rawText: label + "：第一版资料，结果仍待核对。" } });
  const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "整理持续报告", llmContextApproved: true });
  const mission = await editContinuationPolicy(user.id, created.id, { requestId: "grant", expectedVersion: created.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    checkEveryMinutes: 60, maxModels: 100, maxTools: 100, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output"], connectionIds: [], timezone: "Asia/Shanghai" } });
  let selected = capture.id;
  const provider = fixtureSkillProvider(async () => {
    const source = await readProjectMaterial(project.id, "capture:" + selected);
    return { sourceId: source!.id, sourceHash: source!.hash };
  });
  return { user, project, mission, capture, provider, select: (id: string) => { selected = id; } };
}
async function settle(f: Awaited<ReturnType<typeof fixture>>) {
  for (let index = 0; index < 8; index++) {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
    if (row.status !== "READY") break;
    await runMissionSlice({ id: row.id, provider: f.provider });
  }
  return db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
}
async function checkpointed(f: Awaited<ReturnType<typeof fixture>>) {
  await settle(f);
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(row.status).toBe("WAITING_INPUT");
  expect((row.waitStateJson as { waitingFor?: string }).waitingFor).toBe("OBSERVATION");
  return row;
}

test("identical content re-upload does not wake the mission or consume model budget", async () => {
  const f = await fixture("相同内容重传");
  await checkpointed(f);
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  const beforeOutputs = await db.agentMissionOutput.count({ where: { missionId: f.mission.id } });
  for (let index = 0; index < 40; index++) {
    await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: "相同内容重传：第一版资料，结果仍待核对。" } });
  }
  await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
  const scans = await Promise.all(Array.from({ length: 10 }, () => processInvestigationDelegations(32)));
  const woken = scans.reduce((total, item) => total + item.woken, 0);
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(woken).toBe(0);
  expect(after.status).toBe("WAITING_INPUT");
  expect(after.budgetUsedJson).toEqual(before.budgetUsedJson);
  expect(await db.agentMissionOutput.count({ where: { missionId: f.mission.id } })).toBe(beforeOutputs);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id, type: "INVESTIGATION_DUPLICATE_IGNORED" } })).toBeLessThanOrEqual(1);
});

test("100 repeated scans with no new information produce no dispatch, draft or budget change", async () => {
  const f = await fixture("无新信息");
  await checkpointed(f);
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  for (let index = 0; index < 100; index++) {
    await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
    const result = await processInvestigationDelegations(32);
    expect(result.woken).toBe(0);
  }
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.budgetUsedJson).toEqual(before.budgetUsedJson);
  expect(after.status).toBe("WAITING_INPUT");
  expect(await db.agentMissionOutput.count({ where: { missionId: f.mission.id } })).toBe(1);
});

test("one real content change wakes once, produces one revision, and never loops on its own delivered output", async () => {
  const f = await fixture("真实变化");
  const first = await checkpointed(f);
  const newer = await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: "真实变化：第二版新增条件，仍需核对。" } });
  f.select(newer.id);
  await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
  const scans = await Promise.all(Array.from({ length: 10 }, () => processInvestigationDelegations(32)));
  expect(scans.reduce((total, item) => total + item.woken, 0)).toBe(1);
  await settle(f);
  const second = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(second.status).toBe("WAITING_INPUT");
  expect(await db.agentMissionOutput.count({ where: { missionId: f.mission.id } })).toBe(2);
  const budgetAfterSecond = second.budgetUsedJson;
  for (let index = 0; index < 100; index++) {
    await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
    await processInvestigationDelegations(32);
  }
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(after.status).toBe("WAITING_INPUT");
  expect(after.budgetUsedJson).toEqual(budgetAfterSecond);
  expect(await db.agentMissionOutput.count({ where: { missionId: f.mission.id } })).toBe(2);
  expect(first.contextVersion).toBeLessThan(second.contextVersion);
});

test("out-of-order material arrival between scans is folded into one bounded observation", async () => {
  const f = await fixture("乱序到达");
  await checkpointed(f);
  const added = [];
  for (const text of ["乱序到达：C 记录先写入", "乱序到达：B 记录后写入", "乱序到达：A 记录最后写入"]) {
    added.push(await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: text } }));
  }
  f.select(added[2].id);
  await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
  const firstScan = await processInvestigationDelegations(32);
  expect(firstScan.woken).toBeGreaterThanOrEqual(1);
  await settle(f);
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(row.status).toBe("WAITING_INPUT");
  expect(await db.agentMissionOutput.count({ where: { missionId: f.mission.id } })).toBe(2);
  const output = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: f.mission.id }, orderBy: { revision: "desc" } });
  expect(JSON.stringify(output.contentJson)).toContain("A 记录最后写入");
  await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
  expect((await processInvestigationDelegations(32)).woken).toBe(0);
});

test("two workers claiming the same mission serialize: one executes, the other observes no work", async () => {
  const f = await fixture("并发Worker");
  await checkpointed(f);
  const newer = await db.capture.create({ data: { projectId: f.project.id, sourceType: "TEXT", rawText: "并发Worker：新材料需要续稿。" } });
  f.select(newer.id);
  await db.agentMission.update({ where: { id: f.mission.id }, data: { nextAttemptAt: new Date(0) } });
  expect((await processInvestigationDelegations(32)).woken).toBeGreaterThanOrEqual(1);
  const results = await Promise.all([runMissionSlice({ id: f.mission.id, provider: f.provider }), runMissionSlice({ id: f.mission.id, provider: f.provider })]);
  expect(results.filter(Boolean).length).toBe(1);
  const row = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(["READY", "RUNNING", "WAITING_INPUT"]).toContain(row.status);
  expect(await db.agentMissionEvent.count({ where: { missionId: f.mission.id, type: "CLAIMED" } })).toBeGreaterThan(0);
  expect(await db.agentMissionStep.count({ where: { missionId: f.mission.id, toolName: "read_project_material" } })).toBeLessThanOrEqual(3);
});

