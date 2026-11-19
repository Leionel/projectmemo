import { afterAll, beforeAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-idempotency"));
import fs from "node:fs";
import { db } from "@/lib/db";

let userId = "";
beforeAll(async () => {
  Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });
  userId = (await db.user.create({ data: { username: "idem-" + crypto.randomUUID(), displayName: "幂等测试", passwordHash: "unused" } })).id;
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

const body = { goal: "整理下一版本发布说明", materialText: "登录流程已完成；移动端回归尚未记录。", expiresInDays: 7 };
async function project(label: string) {
  return db.project.create({ data: { title: label, description: "隔离测试", goal: "整理交付说明", scenario: "RESEARCH",
    memberships: { create: { userId, role: "OWNER" } } } });
}
async function prepared(projectId: string) {
  const { previewV2Delegation, confirmV2Delegation } = await import("@/lib/mission/v2DelegationService");
  const preview = await previewV2Delegation(userId, projectId, body);
  const requestId = crypto.randomUUID();
  const confirm = (extra: Record<string, unknown> = {}, target = projectId) =>
    confirmV2Delegation(userId, target, { requestId, goal: body.goal, materialText: body.materialText, previewHash: preview.previewHash, expiresAt: preview.expiresAt, ...extra });
  return { preview, requestId, confirm };
}

test("identical retry returns the same receipt bound to the original confirmation", async () => {
  const target = await project("幂等回执");
  const { confirm } = await prepared(target.id);
  const first = await confirm();
  const retried = await confirm();
  expect(retried).toMatchObject({ missionId: first.missionId, projectId: target.id, alreadyCreated: true,
    materialSourceId: first.materialSourceId, policyHash: first.policyHash, expiresAt: first.expiresAt });
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: first.missionId } });
  expect(first.projectId).toBe(mission.projectId);
  expect(await db.agentMission.count({ where: { projectId: target.id } })).toBe(1);
  expect(await db.capture.count({ where: { projectId: target.id } })).toBe(1);
});

test("the same requestId cannot be replayed against another project", async () => {
  const [a, b] = [await project("项目 A"), await project("项目 B")];
  const { confirm, requestId } = await prepared(a.id);
  const first = await confirm();
  const { previewV2Delegation, confirmV2Delegation } = await import("@/lib/mission/v2DelegationService");
  const previewB = await previewV2Delegation(userId, b.id, body);
  await expect(confirmV2Delegation(userId, b.id, { requestId, goal: body.goal, materialText: body.materialText,
    previewHash: previewB.previewHash, expiresAt: previewB.expiresAt })).rejects.toMatchObject({ code: "DELEGATION_IDEMPOTENCY_CONFLICT" });
  expect(await db.agentMission.count({ where: { projectId: b.id } })).toBe(0);
  expect(await db.agentMission.count({ where: { id: first.missionId, projectId: a.id } })).toBe(1);
});

test("the same requestId cannot change goal, material, preview or period", async () => {
  const target = await project("改内容重放");
  const { requestId, preview } = await prepared(target.id);
  const { confirmV2Delegation } = await import("@/lib/mission/v2DelegationService");
  await confirmV2Delegation(userId, target.id, { requestId, goal: body.goal, materialText: body.materialText, previewHash: preview.previewHash, expiresAt: preview.expiresAt });
  const conflict = (extra: Record<string, unknown>) => expect(confirmV2Delegation(userId, target.id, { requestId,
    goal: body.goal, materialText: body.materialText, previewHash: preview.previewHash, expiresAt: preview.expiresAt, ...extra }))
    .rejects.toMatchObject({ code: "DELEGATION_IDEMPOTENCY_CONFLICT" });
  await conflict({ goal: "另一个目标" });
  await conflict({ materialText: "完全不同的材料" });
  await conflict({ previewHash: "0".repeat(64) });
  await conflict({ expiresAt: new Date(Date.parse(preview.expiresAt) + 1000).toISOString() });
  expect(await db.agentMission.count({ where: { projectId: target.id } })).toBe(1);
  expect(await db.capture.count({ where: { projectId: target.id } })).toBe(1);
});

test("a later policy edit does not rewrite the original receipt", async () => {
  const target = await project("许可后续修改");
  const { confirm } = await prepared(target.id);
  const first = await confirm();
  const { editContinuationPolicy } = await import("@/lib/mission/missionService");
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: first.missionId } });
  await editContinuationPolicy(userId, mission.id, { requestId: "tighten", expectedVersion: mission.version, policy: {
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1, expiresAt: new Date(Date.now() + 3 * 86400000).toISOString(),
    checkEveryMinutes: 30, maxModels: 4, maxTools: 4, maxMetadataRequests: 0,
    allowedTools: ["read_project_material"], connectionIds: [], timezone: "Asia/Shanghai" } });
  const retried = await confirm();
  expect(retried.policyHash).toBe(first.policyHash);
  expect(retried.expiresAt).toBe(first.expiresAt);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).continuationPolicyJson).toMatchObject({ maxModels: 4 });
});

test("concurrent confirmations of one request create exactly one Mission and agree on the receipt", async () => {
  const target = await project("并发确认");
  const { confirm } = await prepared(target.id);
  const settled = await Promise.allSettled([confirm(), confirm()]);
  const fulfilled = settled.filter(result => result.status === "fulfilled") as Array<PromiseFulfilledResult<{ missionId: string }>>;
  expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  const missions = await db.agentMission.findMany({ where: { projectId: target.id } });
  expect(missions).toHaveLength(1);
  for (const result of fulfilled) expect(result.value.missionId).toBe(missions[0].id);
  expect(await db.capture.count({ where: { projectId: target.id } })).toBe(1);
});

test("an expired period is rejected for a new request, while an identical retry after expiry keeps the original receipt", async () => {
  const target = await project("过期重试");
  const { preview, confirm } = await prepared(target.id);
  const first = await confirm();
  const { confirmV2Delegation } = await import("@/lib/mission/v2DelegationService");
  await expect(confirmV2Delegation(userId, target.id, { requestId: crypto.randomUUID(), goal: body.goal, materialText: body.materialText,
    previewHash: preview.previewHash, expiresAt: new Date(Date.now() - 1000).toISOString() })).rejects.toMatchObject({ code: "DELEGATION_PERIOD_CHANGED" });
  await db.agentMission.update({ where: { id: first.missionId }, data: { continuationPolicyJson: { mode: "MANUAL" },
    planRevision: { increment: 1 }, contextVersion: { increment: 1 } } });
  const retried = await confirm();
  expect(retried).toMatchObject({ missionId: first.missionId, policyHash: first.policyHash, expiresAt: first.expiresAt });
  expect(await db.agentMission.count({ where: { projectId: target.id } })).toBe(1);
});
