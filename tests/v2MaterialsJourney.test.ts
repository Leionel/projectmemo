import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("m2-materials"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { PROJECT_PRESETS } from "@/lib/intake/projectPresets";
import { parseProjectMaterial } from "@/lib/intake/projectMaterial";
import { previewV2Delegation, confirmV2Delegation } from "@/lib/mission/v2DelegationService";
import { addMissionMaterial } from "@/lib/mission/materialService";
import { runMissionSlice } from "@/lib/mission/runner";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { commandMission } from "@/lib/mission/missionService";
import { projectTools } from "@/lib/mission/tools";
import { fixtureSkillProvider } from "../scripts/fixtures/v2-provider";
Object.assign(process.env, { MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function start(presetId: typeof PROJECT_PRESETS[number]["id"]) {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "M2合成", passwordHash: "unused" } });
  const p = await db.project.create({ data: { title: "合成" + presetId, goal: "交付", description: "合成资料", scenario: "RESEARCH", memberships: { create: { userId: u.id, role: "OWNER" } } } });
  const goal = PROJECT_PRESETS.find(item => item.id === presetId)!.goal;
  const body = { presetId, goal, materialName: "交付.csv", materialText: '项目,状态,说明\n需求,待核对,"客户意见,尚未确认"\n验收,未知,口径未给出', expiresInDays: 7 };
  const preview = await previewV2Delegation(u.id, p.id, body);
  const input = { ...body, requestId: "create", previewHash: preview.previewHash, expiresAt: preview.expiresAt };
  const result = await confirmV2Delegation(u.id, p.id, input);
  const provider = fixtureSkillProvider(async () => {
    const latest = await db.capture.findFirstOrThrow({ where: { projectId: p.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const source = (await readProjectMaterial(p.id, "capture:" + latest.id))!;
    return { sourceId: source.id, sourceHash: source.hash };
  });
  const cycle = async () => {
    for (let index = 0; index < 8; index++) {
      if ((await db.agentMission.findUniqueOrThrow({ where: { id: result.missionId } })).status !== "READY") break;
      await runMissionSlice({ id: result.missionId, provider });
    }
    return db.agentMission.findUniqueOrThrow({ where: { id: result.missionId } });
  };
  return { u, p, input, result, preview, cycle, provider };
}
test.each(PROJECT_PRESETS)("$label: original CSV → first draft → user feedback → same Mission revision", async preset => {
  const f = await start(preset.id);
  expect(f.preview.material).toMatchObject({ format: "CSV", rows: 2, columns: 3 });
  const first = await f.cycle(); expect(first.status).toBe("WAITING_INPUT");
  const old = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: first.id } });
  const input = { requestId: "feedback", kind: "FEEDBACK", text: "新增反馈：交付说明须补充边界；评分口径仍待确认。" };
  const results = await Promise.all([addMissionMaterial(f.u.id, first.id, input), addMissionMaterial(f.u.id, first.id, input)]);
  expect(results[0].sourceId).toBe(results[1].sourceId);
  expect(results.filter(result => result.replayed)).toHaveLength(1);
  expect(await db.agentMissionEvent.count({ where: { missionId: first.id, type: "USER_FEEDBACK_ADDED" } })).toBe(1);
  await processInvestigationDelegations(32); const second = await f.cycle();
  expect(second.status).toBe("WAITING_INPUT"); expect(second.id).toBe(first.id);
  expect(await db.agentMissionOutput.count({ where: { missionId: first.id } })).toBe(2);
  expect(await db.agentMissionOutput.findUniqueOrThrow({ where: { id: old.id } })).toEqual(old);
  const latest = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: first.id }, orderBy: { revision: "desc" } });
  expect(JSON.stringify(latest.contentJson)).toContain("不代表已确认变更");
  expect(await db.actionItem.count({ where: { projectId: f.p.id } })).toBe(0);
  await expect(addMissionMaterial(f.u.id, first.id, { ...input, text: "另一份材料" })).rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
  await expect(confirmV2Delegation(f.u.id, f.p.id, { ...f.input, materialName: "另一个.csv" })).rejects.toMatchObject({ code: "DELEGATION_IDEMPOTENCY_CONFLICT" });
  const member = await db.projectMembership.findUniqueOrThrow({ where: { userId_projectId: { userId: f.u.id, projectId: f.p.id } } });
  expect(member.personalMemoryMode).toBe(preset.id === "client" ? "PROJECT_ONLY" : "INHERIT");
});
test("new material cannot resume paused work or access another owner's project", async () => {
  const f = await start("client"), row = await f.cycle();
  await commandMission(f.u.id, row.id, "pause", { requestId: "pause", expectedVersion: row.version });
  const before = await db.agentMission.findUniqueOrThrow({ where: { id: row.id } });
  await addMissionMaterial(f.u.id, row.id, { requestId: "local", text: "补充资料" });
  await processInvestigationDelegations(32);
  const after = await db.agentMission.findUniqueOrThrow({ where: { id: row.id } });
  expect(after.status).toBe("PAUSED"); expect(after.budgetUsedJson).toEqual(before.budgetUsedJson);
  const other = await start("course");
  await expect(addMissionMaterial(other.u.id, row.id, { requestId: "wrong-owner", text: "无权写入" })).rejects.toMatchObject({ code: "MISSION_NOT_FOUND" });
  const source = (await readProjectMaterial(other.p.id, other.result.materialSourceId))!;
  await expect(projectTools.read_project_material.run({ userId: f.u.id, projectId: f.p.id, missionId: row.id }, { sourceId: source.id, sourceHash: source.hash })).rejects.toThrow();
});
test("generic materials preserve UTF8, Markdown and CSV strings without experiment interpretation", () => {
  expect(parseProjectMaterial('\uFEFF# 需求\r\n保留未知', "brief.md")).toMatchObject({ text: "# 需求\n保留未知", format: "MARKDOWN" });
  const csv = '编号,数量\n001,002\n002,"三,四"';
  expect(parseProjectMaterial(csv, "ordinary.csv")).toMatchObject({ text: csv, rows: 2, columns: 2 });
  for (const [raw, name] of [["a,b\nx", "bad.csv"], ["a\u0000", "bad.txt"], ["替代\uFFFD", "bad.md"], ["记录", "bad.html"], ["文".repeat(22000), "large.txt"], ["a\n" + "x\n".repeat(201), "large.csv"]])
    expect(() => parseProjectMaterial(raw, name)).toThrow();
});

test("feedback added after a read is not silently consumed by the old draft checkpoint", async () => {
  const f = await start("client");
  await runMissionSlice({ id: f.result.missionId, provider: f.provider });
  await addMissionMaterial(f.u.id, f.result.missionId, { requestId: "during-run", kind: "FEEDBACK", text: "执行期间补充：必须核对第二阶段的范围，不代表客户已确认。" });
  const first = await f.cycle(); expect(first.status).toBe("WAITING_INPUT");
  // No test-side timer rewrite: a pending change should be immediately eligible for the real scanner.
  expect((await processInvestigationDelegations(32)).woken).toBeGreaterThanOrEqual(1);
  const second = await f.cycle(); expect(second.status).toBe("WAITING_INPUT");
  expect(await db.agentMissionOutput.count({ where: { missionId: second.id } })).toBe(2);
  const latest = await db.agentMissionOutput.findFirstOrThrow({ where: { missionId: second.id }, orderBy: { revision: "desc" } });
  expect(JSON.stringify(latest.contentJson)).toContain("执行期间补充");
});
