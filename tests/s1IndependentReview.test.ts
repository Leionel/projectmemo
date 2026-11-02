import { afterAll, beforeAll, expect, it, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("s1-independent-review"));
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import * as intake from "@/lib/services/projectIntakeService";
import { saveFileToStorage } from "@/lib/storage/attachmentStorage";
import type { ConversationActor } from "@/lib/types/conversation";
import { acceptedFieldsSchema, intakeDirectiveEpoch } from "@/lib/intake/contracts";

beforeAll(() => { process.env.ATTACHMENT_DIR = path.join(isolated.dir, "attachments"); });
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await db.$disconnect(); });
async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "独立合成审查", passwordHash: "unused" } });
  const { session } = await createSession(user.id);
  const actor: ConversationActor = { userId: user.id, sessionId: session.id };
  const { draftId } = await intake.createIntakeDraft(actor, { requestId: crypto.randomUUID() });
  const material = await intake.addTextMaterial(actor, draftId, { requestId: "m", text: "先读论文，不运行付费实验。" });
  await intake.recordProcessingConsent(actor, draftId);
  return { actor, user, session, draftId, material };
}
function model(materialId: string) {
  return { data: JSON.stringify({ summary: "原文只要求阅读。", quotes: [{ materialId, quote: "先读论文，不运行付费实验。", meaning: "只读任务" }],
    suggested: { title: "论文阅读", description: "核查论文的方法和实验条件，不直接执行付费实验。", goal: "先阅读论文", scenario: "RESEARCH" },
    constraints: [], unknowns: [], successCriteria: [], nextQuestion: { text: "哪些条件仍需核查？", why: "先核对原文" } }),
    provider: "SYNTHETIC", status: "SUCCESS" as const, durationMs: 1, usageUnknown: false, usage: { inputTokens: 30, outputTokens: 80 }, requestIdentity: null };
}
const accepted = { title: "论文阅读", description: "阅读论文并核查方法条件，形成真实的阅读笔记。", goal: "完成阅读笔记", scenario: "RESEARCH" as const };

it("实际 provider 适配链只预占一次并确实派发一次", async () => {
  const f = await fixture();
  vi.stubEnv("LLM_MODE", "openai-compatible"); vi.stubEnv("LLM_API_KEY", "synthetic-no-real-key");
  vi.stubEnv("LLM_PROVIDER", "deepseek"); vi.stubEnv("LLM_MODEL_NAME", "deepseek-flash");
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: model(f.material.materialId).data } }], usage: { prompt_tokens: 30, completion_tokens: 80 } }), { status: 200 }));
  try {
    const result = await intake.understandIntake(f.actor, f.draftId, { requestId: "u", processingConsent: true });
    expect(result.preview.understandingState).toBe("READY"); expect(fetch).toHaveBeenCalledTimes(1);
  } finally { fetch.mockRestore(); vi.unstubAllEnvs(); }
});

it("模型在途期间新增材料，旧模型结果不能绑定到新材料版本", async () => {
  const f = await fixture(); let enter!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  const pending = intake.understandIntake(f.actor, f.draftId, { requestId: "u", processingConsent: true }, { runModel: async () => { enter(); await gate; return model(f.material.materialId); } });
  const outcome = pending.catch(e => e);
  await ready;
  await intake.addTextMaterial(f.actor, f.draftId, { requestId: "m2", text: "纠正：先核查这篇论文的适用条件，暂不采用原计划。" });
  release(); await outcome;
  const current = await db.projectIntakeDraft.findUniqueOrThrow({ where: { id: f.draftId } });
  expect(current.understandingState).not.toBe("READY"); expect(current.understandingJson).toBeNull();
});

it("撤回清理后迟到模型结果不能重新写回私人理解", async () => {
  const f = await fixture(); let enter!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  const pending = intake.understandIntake(f.actor, f.draftId, { requestId: "u", processingConsent: true }, { runModel: async () => { enter(); await gate; return model(f.material.materialId); } });
  const outcome = pending.catch(e => e);
  await ready; await intake.withdrawIntake(f.actor, f.draftId); release(); await outcome;
  const current = await db.projectIntakeDraft.findUniqueOrThrow({ where: { id: f.draftId } });
  expect(current.status).toBe("WITHDRAWN"); expect(current.understandingJson).toBeNull();
});

it("到期 unlink 失败保留文件身份，下一轮仍可清理 EXPIRED 草稿", async () => {
  const f = await fixture();
  const file = await saveFileToStorage(`intake-${f.draftId}`, "synthetic.txt", Buffer.from("private synthetic original"));
  const material = await db.projectIntakeMaterial.create({ data: { draftId: f.draftId, ownerUserId: f.actor.userId, kind: "FILE", ordinal: 2,
    contentHash: "synthetic", storageKey: file.storageKey, rawText: "private synthetic original" } });
  await db.projectIntakeDraft.update({ where: { id: f.draftId }, data: { expiresAt: new Date(Date.now()-1000) } });
  const rm = fs.promises.rm.bind(fs.promises);
  const spy = vi.spyOn(fs.promises, "rm").mockImplementation(async (target, options) => { if (String(target) === file.absolutePath) throw new Error("synthetic unlink failure"); return rm(target, options); });
  try { await intake.expireIntakeDrafts(); } finally { spy.mockRestore(); }
  const after = await db.projectIntakeMaterial.findUniqueOrThrow({ where: { id: material.id } });
  expect(fs.existsSync(file.absolutePath)).toBe(true);
  expect(after.cleanupState).toBe("FAILED"); expect(after.storageKey).toBe(file.storageKey);
  await intake.expireIntakeDrafts(new Date(Date.now()+86_400_000));
  expect(fs.existsSync(file.absolutePath)).toBe(false);
});

it("项目清除后 Intake 不能继续暴露已清除项目材料副本", async () => {
  const f = await fixture(), preview = (await intake.readIntake(f.actor, f.draftId)).preview;
  const confirmed = await intake.confirmIntake(f.actor, f.draftId, { requestId: "c", expectedRevision: preview.revision, previewHash: preview.previewHash, accepted });
  const { requestProjectDeletion, processProjectDeletions } = await import("@/lib/services/projectDeletionService");
  const project = await db.project.findUniqueOrThrow({ where: { id: confirmed.projectId } });
  await requestProjectDeletion(f.actor.userId, project.id, project.id, project.updatedAt.toISOString(), f.session.id);
  await processProjectDeletions();
  await expect(intake.readIntake(f.actor, f.draftId)).rejects.toBeDefined();
  await intake.expireIntakeDrafts(new Date(Date.now()+86_400_000*4));
  expect((await db.projectIntakeMaterial.findMany({ where: { draftId: f.draftId } })).every(m => m.rawText === null)).toBe(true);
});

it("相同文件并发请求共享登记身份，撤回时能清理仍在解析的原件", async () => {
  const f = await fixture(); let enter!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  const file = { fileName: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 synthetic original") };
  const pending = intake.addFileMaterial(f.actor, f.draftId, file, { requestId: "file" }, { extractPdf: async () => { enter(); await gate; return "迟到的私人提取正文，不得在撤回后发布。"; } });
  const outcome = pending.catch(e => e); await ready;
  const replay = await intake.addFileMaterial(f.actor, f.draftId, file, { requestId: "file" });
  expect(replay.replayed).toBe(true);
  expect(await db.projectIntakeMaterial.count({ where: { draftId: f.draftId, kind: "FILE" } })).toBe(1);
  await intake.withdrawIntake(f.actor, f.draftId); release();
  expect(await outcome).toMatchObject({ code: "INTAKE_WITHDRAWN" });
  const row = await db.projectIntakeMaterial.findUniqueOrThrow({ where: { id: replay.materialId } });
  expect(row.rawText).toBeNull(); expect(row.storageKey).toBeNull(); expect(row.cleanupState).toBe("DELETED");
});

it("确认重放也重新校验会话，不能消费已撤销的认证结果", async () => {
  const f = await fixture(), preview = (await intake.readIntake(f.actor, f.draftId)).preview;
  const body = { requestId: "c", expectedRevision: preview.revision, previewHash: preview.previewHash, accepted };
  await intake.confirmIntake(f.actor, f.draftId, body);
  await db.authSession.update({ where: { id: f.session.id }, data: { revokedAt: new Date() } });
  await expect(intake.confirmIntake(f.actor, f.draftId, body)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
});

it("预算回执超过八次仍保留原请求身份，结算重放不能降级已知用量", async () => {
  const f = await fixture(); const { reserveIntakeCloudCall, settleIntakeCloudCall } = await import("@/lib/auth/cloudQuota");
  for (let i=0;i<10;i++) await reserveIntakeCloudCall({ ...f.actor, draftId: f.draftId, revision: f.material.revision, requestHash: `r${i}` });
  await expect(reserveIntakeCloudCall({ ...f.actor, draftId: f.draftId, revision: f.material.revision, requestHash: "r0" })).rejects.toMatchObject({ code: "CALL_ALREADY_RESERVED" });
  await Promise.all([0,1].map(i => settleIntakeCloudCall({ draftId: f.draftId, requestHash: `r${i}`, state: "SETTLED", usage: { inputTokens: 1, outputTokens: 2 } })));
  await settleIntakeCloudCall({ draftId: f.draftId, requestHash: "r0", state: "UNKNOWN" });
  const raw = (await db.projectIntakeDraft.findUniqueOrThrow({ where: { id: f.draftId } })).processingJson as { dispatches: Array<{ requestHash: string; settlement: string }> };
  expect(raw.dispatches).toHaveLength(10); expect(raw.dispatches.filter(d => d.settlement === "SETTLED")).toHaveLength(2);
});

it("用户的限定目标和否定约束进入原 Continuity，候选与材料不变成授权", async () => {
  const f = await fixture();
  const veto = await intake.reviseIntake(f.actor, f.draftId, { requestId: "veto", expectedRevision: f.material.revision, text: "不联网" });
  const objective = await intake.reviseIntake(f.actor, f.draftId, { requestId: "objective", expectedRevision: veto.revision, text: "今天先核对论文方法" });
  const reply = await intake.confirmIntake(f.actor, f.draftId, { requestId: "c", expectedRevision: objective.revision, previewHash: objective.preview.previewHash, accepted });
  const { effectiveContinuity } = await import("@/lib/continuity/directiveService");
  const now = await effectiveContinuity(f.actor.userId, { projectId: reply.projectId });
  expect(now.workingObjective).toBe("今天先核对论文方法"); expect(now.constraints).toContain("不联网");
  const future = await effectiveContinuity(f.actor.userId, { projectId: reply.projectId }, db, new Date(Date.parse(objective.until!)+1));
  expect(future.workingObjective).toBeNull(); expect(future.constraints).toContain("不联网");
  expect(future.intentHash).not.toBe(now.intentHash);
});

it("没有新事件但时间越过纠正期限，预览 hash 和有效范围立即改变", async () => {
  const f = await fixture();
  const revised = await intake.reviseIntake(f.actor, f.draftId, { requestId: "r", expectedRevision: f.material.revision, text: "今天先核对论文方法" });
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(revised.until!)+1);
  try {
    const current = (await intake.readIntake(f.actor, f.draftId)).preview;
    expect(current.previewHash).not.toBe(revised.preview.previewHash); expect(current.correction.appliedObjective).toBeNull();
    await expect(intake.confirmIntake(f.actor, f.draftId, { requestId: "c", expectedRevision: revised.revision, previewHash: revised.preview.previewHash, accepted })).rejects.toMatchObject({ code: "INTAKE_PREVIEW_STALE" });
  } finally { clock.mockRestore(); }
});

it("撤回处理同意使在途结果失效，不再允许新的预览派发", async () => {
  const f = await fixture(); let enter!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  const pending = intake.understandIntake(f.actor, f.draftId, { requestId: "u", processingConsent: true }, { runModel: async () => { enter(); await gate; return model(f.material.materialId); } });
  const outcome = pending.catch(e => e); await ready;
  await intake.recordProcessingConsent(f.actor, f.draftId, false); release();
  expect(await outcome).toMatchObject({ code: "INTAKE_CHANGED" });
  await expect(intake.understandIntake(f.actor, f.draftId, { requestId: "next", processingConsent: true }, { runModel: async () => model(f.material.materialId) })).rejects.toMatchObject({ code: "INTAKE_CONSENT_REQUIRED" });
});

it("确认后的材料导入只做本地整理，不借预览同意增加模型/embedding 外发", async () => {
  const f = await fixture(), preview = (await intake.readIntake(f.actor, f.draftId)).preview;
  const project = await intake.confirmIntake(f.actor, f.draftId, { requestId: "c", expectedRevision: preview.revision, previewHash: preview.previewHash, accepted });
  vi.stubEnv("LLM_MODE", "openai-compatible"); vi.stubEnv("LLM_API_KEY", "synthetic-no-real-key"); vi.stubEnv("SEMANTIC_MEMORY_ENABLED", "true");
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
  try {
    const results = await Promise.all([intake.syncIntakeMaterials(f.actor, f.draftId), intake.syncIntakeMaterials(f.actor, f.draftId)]);
    expect(results.some(r => r.pending === 0)).toBe(true);
    expect(await db.capture.count({ where: { projectId: project.projectId } })).toBe(1);
    const completed = results.flatMap(r => r.materials).find(m => m.state === "SYNCED");
    expect(completed?.captureId).toBeTruthy();
    expect(await db.capture.findUnique({ where: { id: completed!.captureId! } })).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); vi.unstubAllEnvs(); }
});

it("重新理解实际消费用户反馈，同一请求重放不再收费或重新生成", async () => {
  const f = await fixture();
  let calls = 0;
  const first = await intake.understandIntake(f.actor, f.draftId, { requestId: "u1", processingConsent: true }, { runModel: async () => { calls++; return model(f.material.materialId); } });
  const feedback = "这不是训练模型权重，请重新核查方法部分";
  await intake.reviseIntake(f.actor, f.draftId, { requestId: "r", expectedRevision: first.preview.revision, text: feedback });
  const second = await intake.understandIntake(f.actor, f.draftId, { requestId: "u2", processingConsent: true }, { runModel: async messages => {
    calls++; expect(JSON.stringify(messages)).toContain(feedback);
    const value = model(f.material.materialId); const parsed = JSON.parse(value.data); parsed.summary = "已按用户反馈重新核对方法";
    return { ...value, data: JSON.stringify(parsed) };
  } });
  expect(second.preview.summary).toBe("已按用户反馈重新核对方法");
  await intake.understandIntake(f.actor, f.draftId, { requestId: "u2", processingConsent: true }, { runModel: async () => { calls++; return model(f.material.materialId); } });
  expect(calls).toBe(2); expect(await db.project.count({ where: { memberships: { some: { userId: f.actor.userId } } } })).toBe(0);
});

it("Web 账号绑定不匹配时不能把旧页面材料建到新账号", async () => {
  const f = await fixture(), session = await createSession(f.actor.userId);
  const { POST } = await import("@/app/api/intake/route");
  const before = await db.projectIntakeDraft.count({ where: { ownerUserId: f.actor.userId } });
  const response = await POST(new Request("http://localhost/api/intake", { method: "POST",
    headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", "X-Expected-Owner-Id": "another-owner" }, body: JSON.stringify({ requestId: "cross-account" }) }));
  expect(response.status).toBe(409);
  expect(await db.projectIntakeDraft.count({ where: { ownerUserId: f.actor.userId } })).toBe(before);
});

it("损坏的撤回同意请求不能被当成空请求而反向授予同意", async () => {
  const f = await fixture(), session = await createSession(f.actor.userId);
  await intake.recordProcessingConsent(f.actor, f.draftId, false);
  const { POST } = await import("@/app/api/intake/[draftId]/consent/route");
  const response = await POST(new Request("http://localhost/api/intake/x/consent", { method: "POST",
    headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" }, body: '{"consent": fal' }), { params: Promise.resolve({ draftId: f.draftId }) });
  expect(response.status).toBe(400);
  const draft = await db.projectIntakeDraft.findUniqueOrThrow({ where: { id: f.draftId } });
  expect((draft.processingJson as { consent: boolean }).consent).toBe(false);
});

it("新增材料不会撤销用户的模型禁令，预览同意也不能绕过禁令派发", async () => {
  const f = await fixture();
  await intake.reviseIntake(f.actor, f.draftId, { requestId: "veto", expectedRevision: f.material.revision, text: "不要调用模型" });
  await intake.addTextMaterial(f.actor, f.draftId, { requestId: "new", text: "新增一份材料不代表撤回先前明确的限制。" });
  const modelCall = vi.fn(async () => model(f.material.materialId));
  await expect(intake.understandIntake(f.actor, f.draftId, { requestId: "u", processingConsent: true }, { runModel: modelCall })).rejects.toMatchObject({ code: "DIRECTIVE_EFFECT_DENIED" });
  expect(modelCall).not.toHaveBeenCalled();
});

it("原文核对保留英文词边界，日期校验拒绝不存在的日历日期", () => {
  expect(intake.intakeTesting.quoteIsVerbatim("notable", { rawText: "The agent is not able to complete this task." })).toBe(false);
  expect(intake.intakeTesting.quoteIsVerbatim("not able", { rawText: "The agent is not\nable to complete this task." })).toBe(true);
  expect(acceptedFieldsSchema.safeParse({ ...accepted, deadline: "2026-02-31" }).success).toBe(false);
  expect(acceptedFieldsSchema.safeParse({ ...accepted, deadline: "2026-02-28" }).success).toBe(true);
});

it("读取后派发前越过期限，不消耗新额度也不登记旧范围请求", async () => {
  const f = await fixture();
  const revised = await intake.reviseIntake(f.actor, f.draftId, { requestId: "r", expectedRevision: f.material.revision, text: "今天先核对论文方法" });
  const draft = await db.projectIntakeDraft.findUniqueOrThrow({ where: { id: f.draftId } });
  const epoch = intakeDirectiveEpoch(draft.userRevisionJson);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(revised.until!)+1);
  try {
    const { reserveIntakeCloudCall } = await import("@/lib/auth/cloudQuota");
    await expect(reserveIntakeCloudCall({ ...f.actor, draftId: f.draftId, revision: draft.revision, requestHash: "late", guidanceEpoch: epoch }))
      .rejects.toMatchObject({ code: "INTAKE_SCOPE_CHANGED" });
    const current = await db.projectIntakeDraft.findUniqueOrThrow({ where: { id: f.draftId } });
    expect((current.processingJson as { dispatches?: unknown[] }).dispatches ?? []).toHaveLength(0);
  } finally { clock.mockRestore(); }
});

it.each([false, true])("模型在途跨过工作指引期限，旧成功/失败不发布但保留结算（失败=%s）", async failed => {
  const f = await fixture();
  const revised = await intake.reviseIntake(f.actor, f.draftId, { requestId: "r", expectedRevision: f.material.revision, text: "今天先核对论文方法" });
  let enter!: () => void, release!: () => void;
  const ready = new Promise<void>(r => { enter = r; }), gate = new Promise<void>(r => { release = r; });
  const pending = intake.understandIntake(f.actor, f.draftId, { requestId: "u", processingConsent: true }, { runModel: async () => {
    enter(); await gate;
    if (failed) throw new Error("synthetic lost response");
    return model(f.material.materialId);
  } });
  const outcome = pending.catch(e => e); await ready;
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(revised.until!)+1);
  try {
    release();
    const result = await outcome;
    if (!failed) expect(result).toMatchObject({ code: "INTAKE_SCOPE_CHANGED" });
    const current = await db.projectIntakeDraft.findUniqueOrThrow({ where: { id: f.draftId } });
    expect(current.understandingState).toBe("NONE"); expect(current.understandingJson).toBeNull();
    const dispatches = (current.processingJson as { dispatches: Array<{ settlement: string; usage?: { inputTokens: number | null } }> }).dispatches;
    expect(dispatches).toHaveLength(1); expect(dispatches[0].settlement).toBe(failed ? "UNKNOWN" : "SETTLED");
    if (!failed) expect(dispatches[0].usage?.inputTokens).toBe(30);
    const retry = vi.fn(async () => model(f.material.materialId));
    await expect(intake.understandIntake(f.actor, f.draftId, { requestId: "u", processingConsent: true }, { runModel: retry }))
      .rejects.toMatchObject({ code: "CALL_ALREADY_RESERVED" });
    expect(retry).not.toHaveBeenCalled();
  } finally { release(); clock.mockRestore(); }
});

it("已形成的理解在指引到期后立即退出有效视图，旧 hash 不能确认", async () => {
  const f = await fixture();
  const revised = await intake.reviseIntake(f.actor, f.draftId, { requestId: "r", expectedRevision: f.material.revision, text: "今天先核对论文方法" });
  const before = await intake.understandIntake(f.actor, f.draftId, { requestId: "u", processingConsent: true }, { runModel: async () => model(f.material.materialId) });
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(revised.until!)+1);
  try {
    const current = (await intake.readIntake(f.actor, f.draftId)).preview;
    expect(current.understandingState).toBe("NONE"); expect(current.model.reason).toBe("INTAKE_SCOPE_CHANGED");
    expect(current.suggested).toBeNull(); expect(current.previewHash).not.toBe(before.preview.previewHash);
    await expect(intake.confirmIntake(f.actor, f.draftId, { requestId: "c", expectedRevision: before.preview.revision, previewHash: before.preview.previewHash, accepted }))
      .rejects.toMatchObject({ code: "INTAKE_PREVIEW_STALE" });
  } finally { clock.mockRestore(); }
});
