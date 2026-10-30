import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  process.env.MISSION_SEMANTIC_CHECK_ENABLED = "false";
  return (await import("./helpers/continuityDatabase")).continuityDatabase("ux2-digest");
});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { sourceHash } from "@/lib/mission/repository";
import { readEffectiveDigests, composeEffectiveMemory } from "@/lib/memory/digestService";
import { buildContext } from "@/lib/mission/contextBuilder";
import type { Choice } from "@/lib/mission/contracts";
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
const provider = (choice: Choice) => async () => ({ choice, provider: "UX2_SYNTHETIC", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });
test("原 Mission 调查输出内生成综合，后续上下文使用；只读不额外调用或写库，来源变化立即失效", async () => {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "综合测试", passwordHash: "fixture" } });
  const project = await db.project.create({ data: { title: "设备核对", goal: "完成演示", description: "fixture", scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "当前只有安装报告，未测目标设备启动。" } });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "核对目标设备", llmContextApproved: true });
  const id = "capture:" + capture.id, hash = await sourceHash(project.id, id);
  await runMissionSlice({ id: mission.id, provider: provider({ kind: "tool", tool: "read_project_material", args: { sourceId: id, sourceHash: hash }, summary: "读原记录" }) });
  const synthesis = { summary: "启动是否成功仍未知，接着核对目标设备记录。", conditions: ["当前只有安装报告"], retainedReasons: ["安装与启动是不同结果"],
    openQuestions: ["缺目标设备启动日志"], commitments: [{ missionId: mission.id, note: "继续原核对任务" }] };
  const choice: Choice = { kind: "tool", tool: "save_mission_output", summary: "保留当前理解", args: { schemaVersion: 1, kind: "NOTE",
    blocks: [{ blockId: "condition", kind: "INFERENCE", text: synthesis.summary, sourceIds: [id], citations: [] }], missingInformation: synthesis.openQuestions, memorySynthesis: synthesis } };
  await runMissionSlice({ id: mission.id, provider: provider(choice) });
  const stored = await db.agentContextDigest.findMany({ where: { ownerUserId: user.id } }); expect(stored).toHaveLength(1);
  expect(stored[0].budgetRootJson).toMatchObject({ missionId: mission.id, additionalModelCalls: 0 });
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  const view = await readEffectiveDigests(user.id, project.id); expect(view.items[0].effectiveState).toBe("CURRENT");
  expect((await composeEffectiveMemory(user.id, project.id, "目标设备")).items[0].synthesis?.summary).toBe(synthesis.summary);
  const context = JSON.parse(await buildContext(before)); expect(context.effectiveMemory.items[0].id).toBe(stored[0].id);
  expect((await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).budgetUsedJson).toEqual(before.budgetUsedJson);
  expect(await db.agentContextDigest.count({ where: { ownerUserId: user.id } })).toBe(1);
  await db.capture.update({ where: { id: capture.id }, data: { rawText: "新增设备条件，需要重新核对。" } });
  expect((await readEffectiveDigests(user.id, project.id)).items[0].effectiveState).toBe("STALE");
  expect((await composeEffectiveMemory(user.id, project.id, "目标设备")).items).toHaveLength(0);
  expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).goal).toBe("完成演示");
}, 30000);
