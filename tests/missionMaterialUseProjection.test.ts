import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), path = await import("node:path"), os = await import("node:os"), Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mission-p1-materials-"));
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replaceAll("\\", "/")}`;
  Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_UI_ENABLED: "true", MISSION_EVENT_CONTINUATION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true", LLM_MODE: "mock" });
  const sql = new Database(path.join(dir, "test.db"));
  for (const folder of fs.readdirSync("prisma/migrations").sort()) {
    const file = path.join("prisma/migrations", folder, "migration.sql");
    if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8"));
  }
  sql.close(); return { dir };
});
import fs from "node:fs";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createMission, missionDetail, commandMission } from "@/lib/mission/missionService";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { runMissionSlice } from "@/lib/mission/runner";
import { previewContinuation, confirmContinuation, listContinuationCandidates } from "@/lib/mission/continuationService";
import { readMissionBack } from "@/lib/mission/readback";
import { previewArtifactAdoption, confirmArtifactAdoption } from "@/lib/mission/artifactAdoptionService";
import { event } from "@/lib/mission/repository";
import { GET as candidateGet } from "@/app/api/missions/[id]/continuations/route";
import type { Choice } from "@/lib/mission/contracts";

let userId: string, token: string;
beforeAll(async () => {
  userId = (await db.user.create({ data: { username: "p1-material-owner", displayName: "隔离测试", passwordHash: "unused" } })).id;
  token = (await createSession(userId)).token;
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function slice(id: string, choice: Choice) {
  await runMissionSlice({ id, provider: async () => ({ choice, provider: "TEST_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } }) });
}
async function fixture() {
  const p = await db.project.create({ data: { title: "资料接回原问题", description: "SYNTHETIC", scenario: "RESEARCH", goal: "形成阶段说明" } });
  await db.projectMembership.create({ data: { projectId: p.id, userId } });
  const m = await createMission(userId, { projectId: p.id, requestId: p.id, goal: "形成带来源的阶段说明", llmContextApproved: true });
  await slice(m.id, { kind: "ask", question: "请补充10月推理显存", missing: "PRIVATE", requirements: { terms: ["显存"], unit: "GB", period: "10月", sourceType: "EITHER" } });
  const d = await missionDetail(userId, m.id);
  const capture = await db.capture.create({ data: { projectId: p.id, rawText: "10月推理显存6.2GB，用户提供的记录", sourceType: "实验记录", createdAt: new Date(Date.now() - 86400000) } });
  const source = (await readProjectMaterial(p.id, `capture:${capture.id}`))!;
  return { p, m, d, capture, source, pointer: { id: source.id, hash: source.hash } };
}
async function bind(f: Awaited<ReturnType<typeof fixture>>) {
  const selection = { questionId: f.d.question!.id, sourcePointers: [f.pointer] };
  const preview = await previewContinuation(userId, f.m.id, selection);
  const body = { ...selection, requestId: crypto.randomUUID(), expectedVersion: preview.version, expectedContextVersion: preview.contextVersion, assessmentHash: preview.assessmentHash, answer: "请按该记录重评，保留未核验范围", confirmedGap: true as const };
  await confirmContinuation(userId, f.m.id, body); return body;
}
describe("P1-A 原问题定向读取与材料使用投影", () => {
  it("无知识卡/扫描事件的旧Capture可定向选择；GET和读回无副作用", async () => {
    const f = await fixture(), before = await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } });
    const eventCount = await db.agentMissionEvent.count({ where: { missionId: f.m.id } }), runs = await db.agentRun.count();
    const url = `https://fixture.invalid/api/missions/${f.m.id}/continuations?questionId=${f.d.question!.id}&sourceId=${encodeURIComponent(f.source.id)}`;
    const response = await candidateGet(new Request(url, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id: f.m.id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ candidates: [{ sourcePointer: f.pointer, readable: true, coverage: { truncated: false } }] });
    expect((await listContinuationCandidates(userId, f.m.id, { questionId: f.d.question!.id, includeExisting: "1" })).candidates.some(c => c.sourcePointer.id === f.source.id)).toBe(true);
    expect((await readMissionBack(userId, f.m.id, { questionId: f.d.question!.id, sourceId: f.source.id })).materialUses.items[0].facts.map(f => f.kind)).toEqual(["SAVED"]);
    expect(await db.agentMission.findUniqueOrThrow({ where: { id: f.m.id } })).toEqual(before);
    expect(await db.agentMissionEvent.count({ where: { missionId: f.m.id } })).toBe(eventCount);
    expect(await db.agentRun.count()).toBe(runs);
    expect(await db.knowledgeCard.count({ where: { projectId: f.p.id } })).toBe(0);
  });
  it("关联HELD不等于绑定或使用，原恢复门槛仍由旧服务判断", async () => {
    const f = await fixture();
    await db.capture.update({ where: { id: f.capture.id }, data: { rawText: "缺少任何指标的记录" } });
    const source = (await readProjectMaterial(f.p.id, f.source.id))!;
    await bind({ ...f, source, pointer: { id: source.id, hash: source.hash } });
    const value = await readMissionBack(userId, f.m.id);
    expect(value.materialUses.items[0].facts.map(f => f.kind)).toEqual(["SAVED", "ASSOCIATED"]);
    expect(value.missionStatus).toBe("WAITING_INPUT");
  });
  it("绑定、真实fixture上下文指针、草稿摘录和指定归入回执分开读回；重放不重复推进", async () => {
    const f = await fixture(), body = await bind(f);
    const bound = await readMissionBack(userId, f.m.id);
    expect(bound.materialUses.items[0].facts.map(f => f.kind)).toContain("BOUND");
    expect(bound.materialUses.items[0].facts.map(f => f.kind)).not.toContain("CONTEXT_POINTER");
    await db.agentRun.create({ data: { projectId: f.p.id, runType: "CHAT", status: "SUCCESS", provider: "TEST_FIXTURE", trace: { missionId: f.m.id, contextManifest: { sourcePointers: [f.pointer], includedStepIds: [] } } } });
    expect((await readMissionBack(userId, f.m.id)).materialUses.items[0].facts.map(f => f.kind)).not.toContain("CONTEXT_POINTER");
    await slice(f.m.id, { kind: "tool", tool: "save_mission_output", args: { blocks: [{ blockId: "measurement", kind: "PROJECT_OBSERVATION", text: f.source.text, sourceIds: [f.source.id], citations: [{ sourceId: f.source.id, start: 0, end: f.source.text.length, excerptHash: createHash("sha256").update(f.source.text).digest("hex") }] }] }, summary: "保存有来源的说明" });
    const d = await missionDetail(userId, f.m.id), output = d.outputs[0];
    const preview = await previewArtifactAdoption(userId, f.m.id, output.id, { artifactType: "weekly_report", expectedOutputRevision: output.revision });
    const adopted = await confirmArtifactAdoption(userId, f.m.id, output.id, { requestId: "p1-adopt", artifactType: "weekly_report", expectedOutputRevision: output.revision, expectedContextVersion: preview.contextVersion, previewHash: preview.previewHash });
    const runs = await db.agentRun.count(), events = await db.agentMissionEvent.count();
  const value = await readMissionBack(userId, f.m.id, { questionId: f.d.question!.id, outputId: output.id, revision: output.revision, receiptId: adopted.id });
  expect(value.materialUses.items[0].facts.map(f => f.kind)).toEqual(expect.arrayContaining(["ASSOCIATED", "BOUND", "CONTEXT_POINTER", "OUTPUT_REFERENCE", "EXACT_QUOTE", "ARTIFACT_ADOPTION"]));
  expect(value.materialUses.items[0].bodyCoverage).toBe("NOT_RECORDED");
  expect(value.materialUses.items[0].facts.find(f => f.kind === "ARTIFACT_ADOPTION")).toMatchObject({ artifactId: adopted.artifactId, revision: output.revision });
    expect(await confirmContinuation(userId, f.m.id, body)).toMatchObject({ continued: true });
    expect(await db.agentMissionStep.count({ where: { missionId: f.m.id, toolName: "bind_project_sources" } })).toBe(1);
    expect(await db.agentMissionEvent.count()).toBe(events); expect(await db.agentRun.count()).toBe(runs);
  });
  it("源修订保留旧指针/摘录，旧问题不改指新问题，终态不恢复", async () => {
    const f = await fixture(); await bind(f);
    await db.capture.update({ where: { id: f.capture.id }, data: { rawText: "已更正为另一份记录" } });
    const view = await readMissionBack(userId, f.m.id, { questionId: f.d.question!.id });
    expect(view.materialUses.items[0]).toMatchObject({ sourcePointer: f.pointer, availability: "CHANGED", excerpt: f.source.text });
    await slice(f.m.id, { kind: "ask", question: "新的必要问题", missing: "PRIVATE" });
    await expect(listContinuationCandidates(userId, f.m.id, { questionId: f.d.question!.id, sourceId: f.source.id })).rejects.toMatchObject({ code: "INPUT_CHANGED" });
    expect((await readMissionBack(userId, f.m.id, { questionId: f.d.question!.id })).selected.question?.historical).toBe(true);
    const current = await missionDetail(userId, f.m.id);
    await commandMission(userId, f.m.id, "cancel", { requestId: "p1-cancel", expectedVersion: current.version });
    await expect(listContinuationCandidates(userId, f.m.id, { questionId: current.question!.id, sourceId: f.source.id })).rejects.toMatchObject({ code: "INPUT_CHANGED" });
  });
  it("跨项目、异Owner与无认证读取拒绝，不把解析失败文件当可读", async () => {
    const a = await fixture(), b = await fixture();
    await expect(listContinuationCandidates(userId, a.m.id, { questionId: a.d.question!.id, sourceId: b.source.id })).rejects.toMatchObject({ status: 404 });
    await expect(readMissionBack(userId, a.m.id, { sourceId: b.source.id })).rejects.toMatchObject({ status: 404 });
    await expect(listContinuationCandidates("another-owner", a.m.id)).rejects.toMatchObject({ status: 404 });
    const response = await candidateGet(new Request(`https://fixture.invalid/api/missions/${a.m.id}/continuations`), { params: Promise.resolve({ id: a.m.id }) });
    expect(response.status).toBe(401);
    const file = await db.attachment.create({ data: { projectId: a.p.id, type: "PDF", storageKey: "fixture", fileName: "不可读.pdf", size: 1, mimeType: "application/pdf", sha256: "fixture", extractionStatus: "FAILED", extractedText: "不能用的旧正文" } });
    expect((await listContinuationCandidates(userId, a.m.id, { questionId: a.d.question!.id, sourceId: `attachment:${file.id}` })).candidates[0]).toMatchObject({ readable: false, excerpt: "", coverage: { extractionStatus: "FAILED" } });
  });
  it("历史读取截断明确，不宣称未找到就从未使用", async () => {
    const f = await fixture();
    await db.$transaction(async tx => { for (let i = 0; i < 81; i++) await event(tx, f.m.id, "SOURCE_ASSOCIATED", { questionId: "another-question", pointers: [f.pointer] }); });
    const value = await readMissionBack(userId, f.m.id);
    expect(value.materialUses.items).toHaveLength(0);
    expect(value.materialUses.coverage).toMatchObject({ eventsTruncated: true, mapping: "DIRECT_SOURCE_POINTERS_ONLY" });
  });
});
