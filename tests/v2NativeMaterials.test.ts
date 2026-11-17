import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("v2-native-material"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { previewMissionMaterial } from "@/lib/mission/materialService";
import { extractPlainText, plainMaterialFormat } from "@/lib/intake/plainText";

Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true" });
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture() {
  const user = await db.user.create({ data: { username: "native-" + crypto.randomUUID(), displayName: "原生长辈", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "原生材料项目", description: "隔离测试", goal: "核对材料", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const mission = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id, requestId: crypto.randomUUID(), goal: "核对材料", llmContextApproved: true });
  return { user, project, mission };
}

test("TXT/Markdown/CSV are decoded and bounded without treating CSV as experiment metrics", () => {
  expect(plainMaterialFormat("笔记.md")).toBe("MARKDOWN");
  expect(plainMaterialFormat("data.CSV")).toBe("CSV");
  expect(plainMaterialFormat("readme")).toBeNull();
  const md = extractPlainText(new TextEncoder().encode("\uFEFF# 标题\r\n正文\r\n"), "笔记.md");
  expect(md.format).toBe("MARKDOWN");
  expect(md.text).toBe("# 标题\n正文");
  expect(md.limitations).toContain("不渲染");
  const csv = extractPlainText(new TextEncoder().encode("name,value\nA,001\n"), "普通.csv");
  expect(csv.format).toBe("CSV");
  expect(csv.text).toContain("A,001");
  expect(csv.limitations).toContain("不当作实验指标");
  expect(() => plainMaterialFormat("paper.pdf")).not.toThrow();
  expect(plainMaterialFormat("paper.pdf")).toBeNull();
  expect(() => extractPlainText(new Uint8Array([0xef, 0xbb, 0xbf, 0x00, 0x01]), "x.txt")).toThrow(/可读文本|UTF-8/);
  expect(() => extractPlainText(new Uint8Array(65 * 1024).fill(65), "big.txt")).toThrow(/64KB/);
});

test("server preview validates the same Mission and writes nothing or wakes no model", async () => {
  const f = await fixture();
  const capturesBefore = await db.capture.count(), eventsBefore = await db.agentMissionEvent.count();
  const preview = await previewMissionMaterial(f.user.id, f.mission.id, { name: "客户反馈.txt", text: "客户希望周五前看到第二版。" });
  expect(preview.name).toBe("客户反馈.txt");
  expect(preview.format).toBe("TEXT");
  expect(preview.text).toContain("周五前");
  expect(preview.target.missionId).toBe(f.mission.id);
  expect(preview.target.projectId).toBe(f.project.id);
  expect(await db.capture.count()).toBe(capturesBefore);
  expect(await db.agentMissionEvent.count()).toBe(eventsBefore);
  await expect(previewMissionMaterial(f.user.id, f.mission.id, { text: "" })).rejects.toThrow(/Too small/);
  const outsider = await db.user.create({ data: { username: "outsider-" + crypto.randomUUID(), displayName: "外部", passwordHash: "unused" } });
  await expect(previewMissionMaterial(outsider.id, f.mission.id, { text: "越权材料" })).rejects.toMatchObject({ status: 404 });
});

test("preview is disabled with V2 off and does not accept a v1 Mission", async () => {
  const f = await fixture();
  const v1 = await createMission(f.user.id, { projectId: f.project.id, requestId: crypto.randomUUID(), goal: "旧任务", llmContextApproved: true });
  await expect(previewMissionMaterial(f.user.id, v1.id, { text: "旧任务材料" })).rejects.toMatchObject({ code: "MISSION_PROTOCOL_REQUIRED" });
  process.env.MISSION_V2_ENABLED = "false";
  try { await expect(previewMissionMaterial(f.user.id, f.mission.id, { text: "关闭后材料" })).rejects.toMatchObject({ code: "MISSION_V2_DISABLED" }); }
  finally { process.env.MISSION_V2_ENABLED = "true"; }
});
