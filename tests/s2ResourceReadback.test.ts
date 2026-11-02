import { afterAll, expect, it, vi } from "vitest";
await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("s2-resource-readback"));
import { db } from "@/lib/db";
import { missionResourceUsageOf } from "@/lib/mission/resourceUsage";
import { readMissionBack } from "@/lib/mission/readback";

afterAll(async () => { await db.$disconnect(); });

it("缺失或非法用量不补零，已记录零和未知费用分别保存", () => {
  expect(missionResourceUsageOf({ inputTokens: -1, outputTokens: "10" })).toMatchObject({ models: null, inputTokens: null, outputTokens: null, monetaryCost: null });
  const knownZero = missionResourceUsageOf({ models: 0, tools: 0, inputTokens: 0, outputTokens: 0, unknownCalls: 0 });
  expect(knownZero.inputTokens).toBe(0); expect(knownZero.monetaryCost).toBeNull(); expect(knownZero.pricingState).toBe("UNPRICED");
});

it("有迟到/未知请求时已记录 token 不能冒充完整用量或零费用", () => {
  const result = missionResourceUsageOf({ models: 3, tools: 2, inputTokens: 100, outputTokens: 20, unknownCalls: 1 });
  expect(result.coverageNote).toContain("不代表完整用量"); expect(result.monetaryCost).toBeNull();
  expect(result.costNote).toContain("未绑定费率与账单");
});

it("原鉴权读回直接使用累计计数；重复读不加算、清零或推进 Mission", async () => {
  const owner = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成用量验收", passwordHash: "unused" } });
  const other = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "其他验收账号", passwordHash: "unused" } });
  const p = await db.project.create({ data: { title: "只读用量", description: "合成隔离项目", goal: "核对原用量", scenario: "RESEARCH" } });
  await db.projectMembership.create({ data: { projectId: p.id, userId: owner.id, role: "OWNER" } });
  const used = { models: 3, tools: 2, inputTokens: 100, outputTokens: 20, unknownCalls: 1 };
  const m = await db.agentMission.create({ data: { projectId: p.id, ownerUserId: owner.id, createRequestId: "m", createPayloadHash: "synthetic", goal: "核对用量", successCriteriaJson: [], constraintsJson: {}, budgetJson: {}, budgetUsedJson: used } });
  const first = await readMissionBack(owner.id, m.id), second = await readMissionBack(owner.id, m.id);
  expect(first.resourceUsage).toEqual(second.resourceUsage);
  expect(first.resourceUsage).toMatchObject({ models: 3, tools: 2, inputTokens: 100, outputTokens: 20, unknownCalls: 1, monetaryCost: null });
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: m.id } });
  expect(current.budgetUsedJson).toEqual(used); expect(current.version).toBe(m.version); expect(current.updatedAt).toEqual(m.updatedAt);
  expect(await db.agentMissionEvent.count({ where: { missionId: m.id } })).toBe(0);
  await expect(readMissionBack(other.id, m.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
});
