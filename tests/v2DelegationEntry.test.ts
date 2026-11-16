import { afterAll, beforeAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-entry"));
import fs from "node:fs";
import { db } from "@/lib/db";

let userId = "", projectId = "";
beforeAll(async () => {
  Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true",
    MISSION_INVESTIGATION_DELEGATION_ENABLED: "true", MISSION_WORKBENCH_ENABLED: "true" });
  const user = await db.user.create({ data: { username: "entry-" + crypto.randomUUID(), displayName: "入口测试", passwordHash: "unused" } });
  userId = user.id;
  const project = await db.project.create({ data: { title: "入口项目", description: "隔离测试", goal: "整理交付说明", scenario: "RESEARCH",
    memberships: { create: { userId, role: "OWNER" } } } });
  projectId = project.id;
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

test("preview writes nothing and shows the bounded scope", async () => {
  const { previewV2Delegation } = await import("@/lib/mission/v2DelegationService");
  const before = { captures: await db.capture.count({ where: { projectId } }), missions: await db.agentMission.count({ where: { projectId } }) };
  const preview = await previewV2Delegation(userId, projectId, { goal: "整理下一版本发布说明", materialText: "登录流程已完成；移动端回归尚未记录。", expiresInDays: 7 });
  expect(preview.writeEffect).toBe("NONE");
  expect(preview.capabilities).toMatchObject({ externalRead: false, publicResearch: false, businessWrite: false, autoSend: false });
  expect(preview.policy.allowedTools).toEqual(["read_project_material", "save_mission_output", "inspect_project"]);
  expect({ captures: await db.capture.count({ where: { projectId } }), missions: await db.agentMission.count({ where: { projectId } }) }).toEqual(before);
});

test("one confirmation creates material, v2 mission and bounded policy atomically, and is idempotent", async () => {
  const { previewV2Delegation, confirmV2Delegation } = await import("@/lib/mission/v2DelegationService");
  const body = { goal: "整理下一版本发布说明", materialText: "登录流程已完成；移动端回归尚未记录。", expiresInDays: 7 };
  const preview = await previewV2Delegation(userId, projectId, body);
  const requestId = crypto.randomUUID();
  const result = await confirmV2Delegation(userId, projectId, { requestId, goal: body.goal, materialText: body.materialText, previewHash: preview.previewHash, expiresAt: preview.expiresAt });
  expect(result.alreadyCreated).toBe(false);
  expect(result.workbenchUrl).toContain("missionId=");
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: result.missionId } });
  expect(mission.runtimeProtocolVersion).toBe(2);
  expect(mission.continuationPolicyJson).toMatchObject({ mode: "BOUNDED_INVESTIGATION" });
  const capture = await db.capture.findFirstOrThrow({ where: { projectId, requestId: "v2-material:" + requestId } });
  expect(capture.rawText).toContain("移动端回归尚未记录");
  expect(result.materialSourceId).toBe("capture:" + capture.id);
  expect(await db.agentMissionEvent.count({ where: { missionId: mission.id, type: "V2_DELEGATION_CONFIRMED" } })).toBe(1);
  const { assertInvestigationDelegation } = await import("@/lib/mission/investigationDelegation");
  expect(() => assertInvestigationDelegation(mission, "web_search")).toThrow();
  expect(() => assertInvestigationDelegation(mission, "save_mission_output")).not.toThrow();
  const retried = await confirmV2Delegation(userId, projectId, { requestId, goal: body.goal, materialText: body.materialText, previewHash: preview.previewHash, expiresAt: preview.expiresAt });
  expect(retried).toMatchObject({ missionId: result.missionId, alreadyCreated: true });
  expect(await db.capture.count({ where: { projectId } })).toBe(1);
  expect(await db.agentMission.count({ where: { projectId } })).toBe(1);
});

test("changed preview is rejected; workbench shows versions and pause/cancel remain available", async () => {
  const { previewV2Delegation, confirmV2Delegation } = await import("@/lib/mission/v2DelegationService");
  const body = { goal: "整理客户验收交付说明", materialText: "客户 brief：交付页面结构与操作说明。", expiresInDays: 7 };
  const preview = await previewV2Delegation(userId, projectId, body);
  const requestId = crypto.randomUUID();
  await expect(confirmV2Delegation(userId, projectId, { requestId, goal: body.goal, materialText: body.materialText + "（已扩大范围）", previewHash: preview.previewHash, expiresAt: preview.expiresAt }))
    .rejects.toMatchObject({ code: "DELEGATION_PREVIEW_CHANGED" });
  const result = await confirmV2Delegation(userId, projectId, { requestId, goal: body.goal, materialText: body.materialText, previewHash: preview.previewHash, expiresAt: preview.expiresAt });
  const { readMissionWorkbench } = await import("@/lib/mission/workbenchService");
  const view = await readMissionWorkbench(userId, result.missionId);
  expect(view.version).toBeGreaterThan(0);
  expect(view.outputs).toHaveLength(0);
  expect(["QUEUED", "READY"]).toContain(view.phase);
  const { commandMission } = await import("@/lib/mission/missionService");
  const paused = await commandMission(userId, result.missionId, "pause", { requestId: "pause-entry", expectedVersion: view.version });
  expect(paused.status).toBe("PAUSED");
  const cancelled = await commandMission(userId, result.missionId, "cancel", { requestId: "cancel-entry", expectedVersion: paused.version });
  expect(cancelled.status).toBe("CANCELLED");
});

test("V2 entry is closed when the feature flags are off", async () => {
  process.env.MISSION_V2_ENABLED = "false";
  const { previewV2Delegation } = await import("@/lib/mission/v2DelegationService");
  await expect(previewV2Delegation(userId, projectId, { goal: "整理说明", materialText: "材料", expiresInDays: 7 }))
    .rejects.toMatchObject({ code: "MISSION_V2_DISABLED" });
  process.env.MISSION_V2_ENABLED = "true";
});
