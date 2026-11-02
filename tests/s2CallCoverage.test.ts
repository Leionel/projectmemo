import { afterAll, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("s2-call-coverage"));
import { db } from "@/lib/db";
import { missionCallCoverageOf, usageRecordedOf } from "@/lib/mission/callCoverage";
import { readMissionBack } from "@/lib/mission/readback";
import type { Prisma } from "@/lib/generated/prisma/client";

afterAll(async () => {
  await db.$disconnect();
  const fs = await import("node:fs");
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

const trace = (missionId: string, usage?: Record<string, number>, extra: Record<string, unknown> = {}): Prisma.InputJsonValue =>
  ({ missionId, ...(usage ? { usage } : {}), ...extra }) as Prisma.InputJsonValue;

it("用量记录要求两个 token 字段都合法；缺失或非法都不算已记录", () => {
  expect(usageRecordedOf({ inputTokens: 10, outputTokens: 5 })).toBe(true);
  expect(usageRecordedOf({ inputTokens: 0, outputTokens: 0 })).toBe(true);
  expect(usageRecordedOf({ inputTokens: 10 })).toBe(false);
  expect(usageRecordedOf({ inputTokens: -1, outputTokens: 5 })).toBe(false);
  expect(usageRecordedOf({ inputTokens: "10", outputTokens: 5 })).toBe(false);
  expect(usageRecordedOf(null)).toBe(false);
});

it("模型与工具分别按原身份计数，不把 step 数量加进模型次数", () => {
  const coverage = missionCallCoverageOf({ missionId: "m1", limit: 20, steps: [
    { id: "s1", status: "SUCCEEDED", toolName: "inspect_project", toolVersion: "1", agentRunId: "r1" },
    { id: "s2", status: "FAILED", toolName: "web_fetch", toolVersion: "2", agentRunId: "r2" },
    { id: "s3", status: "UNKNOWN", toolName: "create_action", toolVersion: "1", agentRunId: null },
    { id: "s4", status: "WAITING_APPROVAL", toolName: "propose_action", toolVersion: "1", agentRunId: null },
  ], agentRuns: [
    { id: "r1", status: "SUCCESS", provider: "p", fallbackReason: null, runType: "CHAT", trace: trace("m1", { inputTokens: 10, outputTokens: 5 }), createdAt: "2026-11-02T00:00:00.000Z" },
    { id: "r2", status: "FAILED", provider: "p", fallbackReason: "MODEL_PROTOCOL_INVALID", runType: "CHAT", trace: trace("m1"), createdAt: "2026-11-02T00:00:01.000Z" },
    { id: "r3", status: "SUCCESS", provider: "p", fallbackReason: null, runType: "CHAT", trace: trace("other"), createdAt: "2026-11-02T00:00:02.000Z" },
  ] });
  expect(coverage.models).toEqual({ total: 2, succeeded: 1, failed: 1, partial: 0, fallback: 0, unknown: 0, usageRecorded: 1, usageUnknown: 1 });
  expect(coverage.tools).toEqual({ total: 4, succeeded: 1, failed: 1, unknown: 1, pending: 1 });
  expect(coverage.failedCodes).toEqual(["MODEL_PROTOCOL_INVALID"]);
  expect(coverage.pricing.state).toBe("UNPRICED");
  expect(coverage.pricing.estimate).toBeNull();
  expect(coverage.notes.join(" ")).toContain("1 次模型调用没有完整用量记录");
});

it("读取达到上限时明确标成下界，不冒充完整账单", () => {
  const runs = Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, status: "SUCCESS",
    provider: "p", fallbackReason: null, runType: "CHAT", trace: trace("m1", { inputTokens: 1, outputTokens: 1 }),
    createdAt: "2026-11-02T00:00:00.000Z" }));
  const coverage = missionCallCoverageOf({ missionId: "m1", agentRuns: runs, steps: [], limit: 20 });
  expect(coverage.inspected.truncated).toBe(true);
  expect(coverage.models.total).toBe(20);
});

it("原读回附带调用覆盖；重复读取不加算、不写回预算", async () => {
  const owner = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "调用覆盖验收", passwordHash: "unused" } });
  const other = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "其他账号", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "调用覆盖", description: "合成隔离项目", goal: "核对调用回执", scenario: "RESEARCH" } });
  await db.projectMembership.create({ data: { projectId: project.id, userId: owner.id, role: "OWNER" } });
  const used = { models: 2, tools: 1, inputTokens: 30, outputTokens: 9, unknownCalls: 1 };
  const mission = await db.agentMission.create({ data: { projectId: project.id, ownerUserId: owner.id, createRequestId: "c",
    createPayloadHash: "synthetic", goal: "核对调用覆盖", successCriteriaJson: [], constraintsJson: {}, budgetJson: {}, budgetUsedJson: used } });
  await db.agentRun.create({ data: { projectId: project.id, runType: "CHAT", status: "SUCCESS", provider: "TEST_FIXTURE",
    trace: trace(mission.id, { inputTokens: 20, outputTokens: 6 }) } });
  await db.agentRun.create({ data: { projectId: project.id, runType: "CHAT", status: "FAILED", provider: "TEST_FIXTURE",
    fallbackReason: "MODEL_OUTPUT_TRUNCATED", trace: trace(mission.id) } });
  await db.agentMissionStep.create({ data: { missionId: mission.id, ordinal: 1, planRevision: mission.planRevision,
    toolName: "inspect_project", toolVersion: "1", canonicalInputJson: {}, inputHash: "h", readSetJson: [], status: "SUCCEEDED" } });

  const first = await readMissionBack(owner.id, mission.id);
  const second = await readMissionBack(owner.id, mission.id);
  expect(first.callCoverage).toEqual(second.callCoverage);
  expect(first.callCoverage.models).toMatchObject({ total: 2, succeeded: 1, failed: 1, usageRecorded: 1, usageUnknown: 1 });
  expect(first.callCoverage.tools.total).toBe(1);
  expect(first.callCoverage.failedCodes).toEqual(["MODEL_OUTPUT_TRUNCATED"]);
  expect(first.callCoverage.pricing.estimate).toBeNull();
  // 读回不改变原累计预算、版本或时间。
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  expect(current.budgetUsedJson).toEqual(used);
  expect(current.version).toBe(mission.version);
  expect(current.updatedAt).toEqual(mission.updatedAt);
  await expect(readMissionBack(other.id, mission.id)).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
});


