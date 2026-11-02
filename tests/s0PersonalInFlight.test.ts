import { afterAll, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { continuityDatabase } from "./helpers/continuityDatabase";
const isolated = continuityDatabase("s0-personal-inflight");
const { db } = await import("@/lib/db");
const { commandPersonalMemory } = await import("@/lib/memory/personalMemoryService");
const { createMission } = await import("@/lib/mission/missionService");
const { runMissionSlice } = await import("@/lib/mission/runner");
afterAll(async () => { await db.$disconnect(); void isolated; });
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成用户", passwordHash: "fixture" } });
  const project = await db.project.create({ data: { title: "合成在途项目", goal: "核对个人依赖", description: "fixture", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const claim = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT", quote: "以后回答先给结论，再列依据", kind: "PREFERENCE" });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "回答先给结论，再列依据", llmContextApproved: true });
  const unrelated = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "仅整理项目材料", llmContextApproved: true });
  return { user, project, claim, mission, unrelated };
}
it.each(["PAUSE", "UPDATE", "DELETE"] as const)("PM-R01：模型在途且无 Step，24条其他 Run 后 %s 仍阻断迟到决策", async operation => {
  const f = await fixture();
  let entered!: (context: string) => void, resume!: () => void;
  const ready = new Promise<string>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  const { projectTools } = await import("@/lib/mission/tools");
  const tool = vi.fn(projectTools.read_project_material.run);
  const pending = runMissionSlice({ id: f.mission.id, tools: { ...projectTools, read_project_material: { ...projectTools.read_project_material, run: tool } }, provider: async context => {
    entered(context); await barrier;
    return { choice: { kind: "tool", tool: "read_project_material", args: { sourceId: "capture:synthetic", sourceHash: "synthetic" }, summary: "旧判断" },
      provider: "S0_SYNTHETIC", model: "barrier", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } };
  } });
  const context = JSON.parse(await ready);
  expect(context.personalMemoryReadSet.items.map((i: { claimId: string }) => i.claimId)).toContain(f.claim.claimId);
  expect(await db.agentMissionStep.count({ where: { missionId: f.mission.id } })).toBe(0);
  await db.agentRun.createMany({ data: Array.from({ length: 24 }, () => ({ projectId: f.project.id, runType: "CHAT" as const, status: "SUCCESS" as const,
    provider: "S0_OTHER_FIXTURE", trace: { missionId: f.unrelated.id, contextManifest: { personalClaimIds: [] } } })) });
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  await commandPersonalMemory(f.user.id, { requestId: crypto.randomUUID(), operation, claimId: f.claim.claimId!, ...(operation === "UPDATE" ? { quote: "以后回答先列依据，再给结论" } : {}) });
  const stopped = await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } });
  expect(stopped.status).toBe("PAUSED");
  expect(stopped.leaseEpoch).toBeGreaterThan(before.leaseEpoch);
  expect(stopped.budgetUsedJson).toEqual(before.budgetUsedJson);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.unrelated.id } })).status).not.toBe("PAUSED");
  resume(); await pending;
  expect(await db.agentMissionStep.count({ where: { missionId: f.mission.id } })).toBe(0);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } })).budgetUsedJson).toEqual(before.budgetUsedJson);
  expect(tool).not.toHaveBeenCalled();
});
it("旧 Run 无 Step 的依赖按原 Mission 回查，不会被日志窗口挤掉", async () => {
  const f = await fixture();
  await db.agentRun.create({ data: { projectId: f.project.id, runType: "CHAT", status: "SUCCESS", provider: "S0_LEGACY_FIXTURE", createdAt: new Date(Date.now() - 60000),
    trace: { missionId: f.mission.id, contextManifest: { personalClaimIds: [f.claim.claimId] } } } });
  await db.agentRun.createMany({ data: Array.from({ length: 24 }, () => ({ projectId: f.project.id, runType: "CHAT" as const, status: "SUCCESS" as const,
    provider: "S0_OTHER_FIXTURE", trace: { missionId: f.unrelated.id, contextManifest: { personalClaimIds: [] } } })) });
  await commandPersonalMemory(f.user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: f.claim.claimId! });
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.mission.id } })).status).toBe("PAUSED");
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: f.unrelated.id } })).status).not.toBe("PAUSED");
});
