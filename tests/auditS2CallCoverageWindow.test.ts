import { afterAll, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("audit-call-window"));
import { db } from "@/lib/db";
import { readMissionBack } from "@/lib/mission/readback";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * 从独立审查复制的负例：修复后窗口按委托筛选，其他记录不能挤掉本委托。
 *
 * 场景：同一项目里还有别的委托/决策复核产生 CHAT AgentRun（trace 里没有 missionId），
 * 它们比当前委托的回执更新。readback 先按 projectId 取最近 20 条、再按 trace.missionId 过滤，
 * 于是当前委托的回执全部落在窗口外，读回显示“模型 0 次”。
 *
 * 期望：未覆盖时必须与“确实没有调用”区分，不能同时输出“用量记录与调用次数一致”。
 */

afterAll(async () => {
  await db.$disconnect();
  const fs = await import("node:fs");
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

it("同项目其它 CHAT 记录把本委托回执挤出窗口时，不能把未覆盖写成 0 次且一致", async () => {
  const owner = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "窗口挤压", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "窗口挤压项目", description: "合成", goal: "核对调用窗口", scenario: "RESEARCH" } });
  await db.projectMembership.create({ data: { projectId: project.id, userId: owner.id, role: "OWNER" } });
  const base = Date.now() - 600_000;
  const mission = await db.agentMission.create({ data: { projectId: project.id, ownerUserId: owner.id, createRequestId: "c",
    createPayloadHash: "synthetic", goal: "核对调用窗口", successCriteriaJson: [], constraintsJson: {}, budgetJson: {},
    budgetUsedJson: { models: 2, tools: 0, inputTokens: 30, outputTokens: 9, unknownCalls: 0 } } });

  // 本委托自己的 2 次模型调用（较早）。
  for (const offset of [0, 1]) {
    await db.agentRun.create({ data: { projectId: project.id, runType: "CHAT", status: "SUCCESS", provider: "TEST_FIXTURE",
      createdAt: new Date(base + offset),
      trace: { missionId: mission.id, usage: { inputTokens: 20, outputTokens: 6 } } as Prisma.InputJsonValue } });
  }
  // 同项目其它记录：23 条没有 missionId 的 CHAT 回执（如决策复核、动态计划采纳），更新时间更晚。
  for (let index = 0; index < 23; index++) {
    await db.agentRun.create({ data: { projectId: project.id, runType: "CHAT", status: "SUCCESS", provider: "TEST_FIXTURE",
      createdAt: new Date(base + 10_000 + index),
      trace: { purpose: "DYNAMIC_PLAN_REVIEW", reviewProposalId: `p-${index}` } as Prisma.InputJsonValue } });
  }

  const readback = await readMissionBack(owner.id, mission.id);
  const usageModels = readback.resourceUsage.models;
  const coverage = readback.callCoverage;

  // 实际读回的文本，作为审查证据打印。
  console.log("[audit] resourceUsage.summary =", readback.resourceUsage.summary);
  console.log("[audit] callCoverage.summary  =", coverage.summary);
  console.log("[audit] callCoverage.notes    =", JSON.stringify(coverage.notes));
  console.log("[audit] inspected             =", JSON.stringify(coverage.inspected));

  // 原累计计数仍然记得有 2 次模型调用。
  expect(usageModels).toBe(2);
  // 期望：覆盖至少要说明“没有检查到”，而不是给 0 次并宣称用量一致。
  expect(coverage.models.total).toBe(2);
  expect(coverage.notes.join(" ")).not.toContain("用量记录与调用次数一致");
  // 修复后本委托只有两条，其他项目记录不再构成窗口截断。
  expect(coverage.inspected.truncated).toBe(false);
});
