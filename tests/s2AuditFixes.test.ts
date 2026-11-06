import { afterAll, expect, it, vi } from "vitest";
await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("s2-audit-fixes"));
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { addTextMaterial, createIntakeDraft, readIntakeMaterialText } from "@/lib/services/projectIntakeService";
import { INTAKE_MODEL_MATERIAL_LIMIT, INTAKE_TOTAL_LIMIT, sliceMaterialsForModel } from "@/lib/intake/coverage";
import { originalTextPage } from "@/lib/intake/textRange";
import { missionCallCoverageOf, type CallCoverageRun } from "@/lib/mission/callCoverage";
import { readMissionBack } from "@/lib/mission/readback";

afterAll(async () => { await db.$disconnect(); });

it("调用状态保留部分、降级和未知，重复身份不重复计数", () => {
  const runs: CallCoverageRun[] = ["SUCCESS", "PARTIAL", "FALLBACK", "FAILED", "UNKNOWN"].map((status, index) => ({
    id: `r${index}`, status, provider: "SYNTHETIC", fallbackReason: null, runType: "CHAT", createdAt: "2026-11-02T00:00:00Z",
    trace: { missionId: "m", usage: { inputTokens: 1, outputTokens: 1 } },
  }));
  const result = missionCallCoverageOf({ missionId: "m", agentRuns: [...runs, runs[0]], steps: [], limit: 20 });
  expect(result.models).toMatchObject({ total: 5, succeeded: 1, failed: 1, partial: 1, fallback: 1, unknown: 1 });
  expect(result.summary).toContain("降级 1"); expect(result.summary).toContain("部分 1");
  const empty = missionCallCoverageOf({ missionId: "other", agentRuns: runs, steps: [], limit: 20 });
  expect(empty.summary).toContain("尚未找到回执"); expect(empty.notes.join(" ")).not.toContain("用量记录与调用次数一致");
});

it("文末与越界偏移返回空页，代理对不在分页边界被拆开", () => {
  const text = "甲".repeat(199) + "🙂" + "乙".repeat(10);
  const first = originalTextPage(text, 0, 200), next = originalTextPage(text, first.offset + first.text.length, 200);
  expect(first.text).toBe("甲".repeat(199)); expect(next.text.startsWith("🙂")).toBe(true);
  expect(first.text + next.text).toBe(text);
  expect(originalTextPage(text, 200, 200).text.startsWith("🙂")).toBe(true);
  for (const offset of [text.length, text.length + 1000]) {
    expect(originalTextPage(text, offset)).toMatchObject({ offset: text.length, text: "", hasMore: false });
  }
});

it("模型正文切片不拆开代理对，也不发送空材料占位", () => {
  const material = (id: string, rawText: string, ordinal: number) => ({ id, rawText, ordinal, kind: "TEXT", type: "TEXT", fileName: null, extractionStatus: "SUCCESS" });
  const edge = sliceMaterialsForModel([material("edge", "甲".repeat(INTAKE_MODEL_MATERIAL_LIMIT - 1) + "🙂乙", 1)]);
  expect(edge.slices[0].text).toBe("甲".repeat(INTAKE_MODEL_MATERIAL_LIMIT - 1)); expect(edge.items[0].sentChars).toBe(INTAKE_MODEL_MATERIAL_LIMIT - 1);
  const budget = sliceMaterialsForModel([material("a", "甲".repeat(INTAKE_MODEL_MATERIAL_LIMIT), 1), material("b", "乙".repeat(INTAKE_TOTAL_LIMIT - INTAKE_MODEL_MATERIAL_LIMIT - 1), 2), material("c", "🙂", 3), material("d", "丁", 4)]);
  expect(budget.slices.map(item => item.materialId)).toEqual(["a", "b", "d"]);
  expect(budget.items.find(item => item.materialId === "c")).toMatchObject({ sentChars: 0, reason: "OVER_BUDGET" });
  expect(budget.totalSentChars).toBe(INTAKE_TOTAL_LIMIT);
});

it("真实材料 API 文末不重读最后一字，调用窗口恰好二十条不伪报截断", async () => {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成边界", passwordHash: "unused" } });
  const { session } = await createSession(user.id), actor = { userId: user.id, sessionId: session.id };
  const { draftId } = await createIntakeDraft(actor, { requestId: "draft" });
  const text = "甲".repeat(199) + "🙂乙";
  const material = await addTextMaterial(actor, draftId, { requestId: "text", text });
  expect(await readIntakeMaterialText(actor, draftId, material.materialId, { offset: text.length + 10 })).toMatchObject({ text: "", offset: text.length, hasMore: false });
  const page = await readIntakeMaterialText(actor, draftId, material.materialId, { offset: 0, limit: 200 });
  expect(page.text).toBe("甲".repeat(199));
  const project = await db.project.create({ data: { title: "窗口边界", description: "合成隔离", scenario: "RESEARCH", goal: "核对调用" } });
  await db.projectMembership.create({ data: { userId: user.id, projectId: project.id, role: "OWNER" } });
  const m = await db.agentMission.create({ data: { projectId: project.id, ownerUserId: user.id, createRequestId: "mission", createPayloadHash: "synthetic", goal: "核对调用", successCriteriaJson: [], constraintsJson: {}, budgetJson: {} } });
  for (let index=0; index<20; index++) await db.agentRun.create({ data: { projectId: project.id, provider: "TEST_FIXTURE", runType: "CHAT", status: "SUCCESS", trace: { missionId: m.id } } });
  const exact = (await readMissionBack(user.id, m.id)).callCoverage;
  expect(exact.models.total).toBe(20); expect(exact.inspected.truncated).toBe(false);
  await db.agentRun.create({ data: { projectId: project.id, provider: "TEST_FIXTURE", runType: "CHAT", status: "PARTIAL", trace: { missionId: m.id } } });
  const extra = (await readMissionBack(user.id, m.id)).callCoverage;
  expect(extra.models.total).toBe(20); expect(extra.inspected.truncated).toBe(true); expect(extra.models.partial).toBe(1); expect(extra.models.failed).toBe(0);
});
