import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux3-responsibility"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { readMissionResponsibility } from "@/lib/mission/responsibility";
afterAll(async () => { vi.useRealTimers(); await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
test("责任快照区分截止和许可到期，累计预算与未知不清零；纯读不冒充后台健康", async () => {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "责任测试", passwordHash: "fixture" } });
  const p = await db.project.create({ data: { title: "持续核对", goal: "完成真实验收", description: "隔离数据", scenario: "RESEARCH", memberships: { create: { userId: u.id } } } });
  const now = Date.now(), deadline = new Date(now + 1000).toISOString(), expiresAt = new Date(now + 3000).toISOString();
  const m = await createMission(u.id, { projectId: p.id, requestId: "create", goal: "持续核对目标设备", missionConstraints: { deadline } });
  await db.agentMission.update({ where: { id: m.id }, data: { status: "WAITING_INPUT", waitStateJson: { waitingFor: "OBSERVATION" },
    nextAttemptAt: new Date(now + 2000), continuationPolicyJson: { mode: "BOUNDED_INVESTIGATION", expiresAt },
    budgetUsedJson: { models: 4, unknownCalls: 1, metadataRequests: 7 } } });
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED = "true";
  const before = await readMissionResponsibility(u.id, m.id);
  expect(before).toMatchObject({ deadline, permissionExpiresAt: expiresAt, workerPresence: "UNOBSERVED", budget: { cumulativeUsed: { models: 4, unknownCalls: 1 }, monetaryCost: null } });
  const count = await db.agentMissionEvent.count();
  expect((await readMissionResponsibility(u.id, m.id)).controlVersion).toBe(before.controlVersion);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(now + 1500); expect((await readMissionResponsibility(u.id, m.id)).permissionState).toBe("WITHIN_TIME_BOUNDARY");
    vi.setSystemTime(now + 4000); const after = await readMissionResponsibility(u.id, m.id);
    expect(after.permissionState).toBe("EXPIRED"); expect(after.nextCheckAt).toBeNull(); expect(after.controlVersion).not.toBe(before.controlVersion);
    expect(after.budget.cumulativeUsed.unknownCalls).toBe(1);
  } finally { vi.useRealTimers(); }
  expect(await db.agentMissionEvent.count()).toBe(count);
  await expect(readMissionResponsibility("outsider", m.id)).rejects.toMatchObject({ status: 404 });
});
