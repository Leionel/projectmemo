import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("s2-intake-coverage"));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import type { ConversationActor } from "@/lib/types/conversation";
import type { AgentExecutionResult } from "@/lib/types";
import {
  addFileMaterial, addTextMaterial, confirmIntake, createIntakeDraft, readIntake, readIntakeMaterialText,
  recordProcessingConsent, understandIntake, withdrawIntake,
} from "@/lib/services/projectIntakeService";
import { INTAKE_MODEL_MATERIAL_LIMIT, INTAKE_TOTAL_LIMIT } from "@/lib/intake/coverage";

/**
 * S2 批次一：Intake 实际送入范围的覆盖提示。
 *
 * 关键口径：上传字符数 ≠ 模型已读字符数。这里用“注入模型收到的真实消息”
 * 反算送入字符，与预览覆盖逐份对齐，而不是只信 DTO 自报。
 */

const originalAttachmentDir = process.env.ATTACHMENT_DIR;
let attachmentDir = "";

beforeAll(() => {
  attachmentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-s2-intake-coverage-"));
  process.env.ATTACHMENT_DIR = attachmentDir;
});
afterAll(async () => {
  if (originalAttachmentDir === undefined) delete process.env.ATTACHMENT_DIR;
  else process.env.ATTACHMENT_DIR = originalAttachmentDir;
  fs.rmSync(attachmentDir, { recursive: true, force: true });
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

async function newActor(label: string) {
  const user = await db.user.create({ data: { username: `${label}-${crypto.randomUUID()}`, displayName: label, passwordHash: "unused" } });
  const session = await createSession(user.id);
  return { user, actor: { userId: user.id, sessionId: session.session.id } as ConversationActor };
}

/** 记录注入模型真正收到的 materials 文本，用于反算“实际送入”。 */
function capturingModel(materialId: string, quote = "材料开头", overrides: Record<string, unknown> = {}) {
  const sent: Array<{ materialId: string; chars: number }> = [];
  let calls = 0;
  const runModel = async (messages: ReturnType<typeof import("@/lib/agent/promptSpec").buildPromptMessages>) => {
    calls++;
    const payload = JSON.parse(messages[1].content) as { data?: { materials?: Array<{ materialId: string; text: string }> } };
    sent.splice(0, sent.length, ...(payload.data?.materials ?? []).map(m => ({ materialId: m.materialId, chars: m.text.length })));
    const result: AgentExecutionResult<string> = { data: JSON.stringify({
      summary: "材料覆盖验收。",
      quotes: [{ materialId, quote, meaning: "用于覆盖验收的原文摘录。" }],
      suggested: { title: "覆盖验收项目", description: "验证送入范围的合成项目材料。", goal: "核对实际送入范围", scenario: "RESEARCH" },
      constraints: [], unknowns: [], successCriteria: [],
      nextQuestion: { text: "还需要继续读哪一段？", why: "决定是否补读。" }, ...overrides }), provider: "TEST_FIXTURE",
      status: "SUCCESS", durationMs: 1, requestIdentity: null, usage: { inputTokens: 10, outputTokens: 20 }, usageUnknown: false };
    return result;
  };
  return { runModel, sent: () => sent, calls: () => calls };
}

async function newDraft(actor: ConversationActor, texts: string[]) {
  const draft = await createIntakeDraft(actor, { requestId: `d-${crypto.randomUUID()}` });
  const materials = [];
  for (const text of texts) materials.push(await addTextMaterial(actor, draft.draftId, { requestId: `m-${crypto.randomUUID()}`, text }));
  await recordProcessingConsent(actor, draft.draftId);
  return { draftId: draft.draftId, materials };
}

function sumChars(sent: Array<{ chars: number }>) { return sent.reduce((sum, item) => sum + item.chars, 0); }

describe("S2 批次一 · Intake 实际材料覆盖", () => {
  test("长 PDF：只送入单份上限，覆盖与模型真实收到的字符一致", async () => {
    const { actor } = await newActor("coverage-long");
    // 文本材料入口本身限制在 20,000 字；超长只会来自文件抽取，因此这里用 PDF 原件。
    const long = "甲".repeat(INTAKE_MODEL_MATERIAL_LIMIT + 8000);
    const draft = await createIntakeDraft(actor, { requestId: `d-${crypto.randomUUID()}` });
    const file = await addFileMaterial(actor, draft.draftId,
      { fileName: "long-report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nsynthetic long report") },
      { requestId: `f-${crypto.randomUUID()}` }, { extractPdf: async () => long });
    await recordProcessingConsent(actor, draft.draftId);
    const materials = [{ materialId: file.materialId }];
    const draftId = draft.draftId;
    const model = capturingModel(materials[0].materialId, "甲".repeat(20));
    const { preview } = await understandIntake(actor, draftId, { requestId: "u-long", processingConsent: true }, { runModel: model.runModel });

    expect(model.calls()).toBe(1);
    expect(sumChars(model.sent())).toBe(INTAKE_MODEL_MATERIAL_LIMIT);
    const item = preview.coverage.current.items[0];
    expect(item.availableChars).toBe(long.length);
    expect(item.plannedChars).toBe(INTAKE_MODEL_MATERIAL_LIMIT);
    expect(item.lastSentChars).toBe(INTAKE_MODEL_MATERIAL_LIMIT);
    expect(item.lastSentTruncated).toBe(true);
    expect(item.reason).toBe("INCLUDED_TRUNCATED");
    expect(preview.coverage.lastSent?.totalSentChars).toBe(INTAKE_MODEL_MATERIAL_LIMIT);
    expect(preview.coverage.lastSent?.totalAvailableChars).toBe(long.length);
    expect(preview.coverage.note).toContain("未送入的原文仍完整保留");
  });

  test("总量上限：后续材料未送入时逐份标注，不把上传量算成已读量", async () => {
    const { actor } = await newActor("coverage-total");
    const first = "乙".repeat(INTAKE_MODEL_MATERIAL_LIMIT), second = "丙".repeat(INTAKE_MODEL_MATERIAL_LIMIT), third = "丁".repeat(500);
    const draft = await createIntakeDraft(actor, { requestId: `d-${crypto.randomUUID()}` });
    const draftId = draft.draftId, materials = [];
    for (const [index, text] of [first, second, third].entries()) materials.push(await addFileMaterial(actor, draftId,
      { fileName: `part-${index}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\nsynthetic ${index}`) },
      { requestId: `f-${crypto.randomUUID()}` }, { extractPdf: async () => text }));
    await recordProcessingConsent(actor, draftId);
    const model = capturingModel(materials[0].materialId, "乙".repeat(10));
    const { preview } = await understandIntake(actor, draftId, { requestId: "u-total", processingConsent: true }, { runModel: model.runModel });

    // 模型实际收到：第一份写满单份上限，第二份只剩总量余额，第三份没有。
    expect(model.sent()).toHaveLength(2);
    expect(model.sent()[0]).toMatchObject({ materialId: materials[0].materialId, chars: INTAKE_MODEL_MATERIAL_LIMIT });
    expect(model.sent()[1]).toMatchObject({ materialId: materials[1].materialId, chars: INTAKE_TOTAL_LIMIT - INTAKE_MODEL_MATERIAL_LIMIT });
    expect(sumChars(model.sent())).toBe(INTAKE_TOTAL_LIMIT);

    const [one, two, three] = preview.coverage.current.items;
    expect(one.lastSentChars).toBe(INTAKE_MODEL_MATERIAL_LIMIT);
    expect(two.lastSentChars).toBe(INTAKE_TOTAL_LIMIT - INTAKE_MODEL_MATERIAL_LIMIT);
    expect(two.lastSentTruncated).toBe(true);
    expect(two.reason).toBe("INCLUDED_TRUNCATED");
    expect(three.lastSentChars).toBe(0);
    expect(three.reason).toBe("OVER_BUDGET");
    expect(preview.coverage.current.totalAvailableChars).toBe(first.length + second.length + third.length);
    expect(preview.coverage.current.totalSentChars).toBe(INTAKE_TOTAL_LIMIT);
  });

  test("没有可读文本的文件不送入，也不计入总量", async () => {
    const { actor } = await newActor("coverage-ocr");
    const draft = await createIntakeDraft(actor, { requestId: `d-${crypto.randomUUID()}` });
    const file = await addFileMaterial(actor, draft.draftId,
      { fileName: "scan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nsynthetic no text") },
      { requestId: `f-${crypto.randomUUID()}` }, { extractPdf: async () => null });
    expect(file.extractionStatus).toBe("NEEDS_OCR");
    await addTextMaterial(actor, draft.draftId, { requestId: `t-${crypto.randomUUID()}`, text: "可读的合成正文。" });
    await recordProcessingConsent(actor, draft.draftId);
    const materials = await db.projectIntakeMaterial.findMany({ where: { draftId: draft.draftId }, orderBy: { ordinal: "asc" } });
    const model = capturingModel(materials[1].id, "可读的合成正文");
    const { preview } = await understandIntake(actor, draft.draftId, { requestId: "u-ocr", processingConsent: true }, { runModel: model.runModel });

    expect(model.sent()).toHaveLength(1);
    expect(model.sent()[0].materialId).toBe(materials[1].id);
    const fileItem = preview.coverage.current.items.find(item => item.materialId === file.materialId)!;
    expect(fileItem.availableChars).toBe(0);
    expect(fileItem.lastSentChars).toBe(0);
    expect(fileItem.reason).toBe("NO_READABLE_TEXT");
    expect(preview.coverage.current.totalAvailableChars).toBe("可读的合成正文。".length);
  });

  test("未同意云处理时不派发，覆盖显示未送入而不是零成本已读", async () => {
    const { actor } = await newActor("coverage-consent");
    const draft = await createIntakeDraft(actor, { requestId: `d-${crypto.randomUUID()}` });
    const material = await addTextMaterial(actor, draft.draftId, { requestId: `m-${crypto.randomUUID()}`, text: "等待同意的材料。" });
    const model = capturingModel(material.materialId);
    await expect(understandIntake(actor, draft.draftId, { requestId: "u-no-consent", processingConsent: true },
      { runModel: model.runModel })).rejects.toMatchObject({ code: "INTAKE_CONSENT_REQUIRED" });
    expect(model.calls()).toBe(0);
    const { preview } = await readIntake(actor, draft.draftId);
    expect(preview.coverage.consentGranted).toBe(false);
    expect(preview.coverage.lastSent).toBeNull();
    expect(preview.coverage.current.items[0].lastSentChars).toBeNull();
    expect(preview.coverage.current.items[0].plannedChars).toBe("等待同意的材料。".length);
    expect(preview.coverage.note).toContain("尚未同意云处理");
  });

  test("理解之后再加材料：旧覆盖保留为上一轮，新材料标为之后新增", async () => {
    const { actor } = await newActor("coverage-stale");
    const { draftId, materials } = await newDraft(actor, ["第一份材料内容。"]);
    const firstRun = capturingModel(materials[0].materialId, "第一份材料内容。");
    const first = await understandIntake(actor, draftId, { requestId: "u-1", processingConsent: true }, { runModel: firstRun.runModel });
    expect(first.preview.coverage.current.stale).toBe(false);
    const firstTotals = first.preview.coverage.lastSent!.totalSentChars;

    const added = await addTextMaterial(actor, draftId, { requestId: `m2-${crypto.randomUUID()}`, text: "第二份新到的材料。" });
    const afterAdd = await readIntake(actor, draftId);
    expect(afterAdd.preview.coverage.current.stale).toBe(true);
    const old = afterAdd.preview.coverage.current.items.find(item => item.materialId === materials[0].materialId)!;
    const fresh = afterAdd.preview.coverage.current.items.find(item => item.materialId === added.materialId)!;
    expect(old.lastSentChars).toBe("第一份材料内容。".length);
    expect(fresh.lastSentChars).toBe(0);
    expect(fresh.reason).toBe("ADDED_AFTER_UNDERSTANDING");
    // 上一轮事实不被新材料改写。
    expect(afterAdd.preview.coverage.lastSent?.totalSentChars).toBe(firstTotals);

    const secondRun = capturingModel(materials[0].materialId, "第一份材料内容。");
    const second = await understandIntake(actor, draftId, { requestId: "u-2", processingConsent: true }, { runModel: secondRun.runModel });
    expect(second.preview.coverage.current.stale).toBe(false);
    expect(second.preview.coverage.lastSent?.totalSentChars).toBe("第一份材料内容。".length + "第二份新到的材料。".length);
    expect(second.preview.coverage.current.items.every(item => item.lastSentChars! > 0)).toBe(true);
  });

  test("送过但没有形成理解时保留“送过”的事实，不冒充已理解", async () => {
    const { actor } = await newActor("coverage-failed");
    const { draftId, materials } = await newDraft(actor, ["失败轮次的材料。"]);
    const failing = async (): Promise<AgentExecutionResult<string>> => {
      throw new Error("provider unavailable");
    };
    await expect(understandIntake(actor, draftId, { requestId: "u-fail", processingConsent: true },
      { runModel: failing })).rejects.toThrow();
    const { preview } = await readIntake(actor, draftId);
    expect(preview.understandingState).toBe("FAILED");
    expect(preview.summary).toBeNull();
    expect(preview.coverage.lastSent?.totalSentChars).toBe("失败轮次的材料。".length);
    expect(preview.coverage.lastSent?.understandingPublished).toBe(false);
    expect(preview.coverage.current.items[0].lastSentChars).toBe("失败轮次的材料。".length);
    void materials;
  });

  test("理解后撤回同意：保留上一轮送入事实，但明说不会再次送入", async () => {
    const { actor } = await newActor("coverage-revoke");
    const { draftId, materials } = await newDraft(actor, ["撤回同意前的材料。"]);
    const model = capturingModel(materials[0].materialId, "撤回同意前的材料。");
    await understandIntake(actor, draftId, { requestId: "u", processingConsent: true }, { runModel: model.runModel });
    await recordProcessingConsent(actor, draftId, false);
    const { preview } = await readIntake(actor, draftId);
    expect(preview.coverage.consentGranted).toBe(false);
    expect(preview.coverage.lastSent?.totalSentChars).toBe("撤回同意前的材料。".length);
    expect(preview.coverage.note).toContain("撤回云处理同意");
    expect(preview.coverage.note).toContain("不会再次送入");
  });
  test("原文核对按页读取：owner 可读、他人 404、无文本 422、撤回后 410", async () => {
    const { actor } = await newActor("coverage-read");
    const other = await newActor("coverage-other");
    const draft = await createIntakeDraft(actor, { requestId: `d-${crypto.randomUUID()}` });
    const text = "戊".repeat(1000);
    const material = await addTextMaterial(actor, draft.draftId, { requestId: `m-${crypto.randomUUID()}`, text });
    const page = await readIntakeMaterialText(actor, draft.draftId, material.materialId, { offset: 0, limit: 200 });
    expect(page.totalChars).toBe(1000);
    expect(page.text).toHaveLength(200);
    expect(page.hasMore).toBe(true);
    expect(page.text).toBe(text.slice(0, 200));
    const next = await readIntakeMaterialText(actor, draft.draftId, material.materialId, { offset: 200, limit: 200 });
    expect(next.text).toBe(text.slice(200, 400));
    // 上限收敛，避免一次拉全量私料。
    const capped = await readIntakeMaterialText(actor, draft.draftId, material.materialId, { offset: 0, limit: 999999 });
    expect(capped.text).toHaveLength(text.length);
    const floored = await readIntakeMaterialText(actor, draft.draftId, material.materialId, { offset: 0, limit: 1 });
    expect(floored.text).toHaveLength(200);
    await expect(readIntakeMaterialText(other.actor, draft.draftId, material.materialId)).rejects.toMatchObject({ code: "INTAKE_NOT_FOUND" });

    const emptyFile = await addFileMaterial(actor, draft.draftId,
      { fileName: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nno text here") },
      { requestId: `f-${crypto.randomUUID()}` }, { extractPdf: async () => null });
    await expect(readIntakeMaterialText(actor, draft.draftId, emptyFile.materialId)).rejects.toMatchObject({ code: "INTAKE_MATERIAL_NO_TEXT" });

    await withdrawIntake(actor, draft.draftId);
    await expect(readIntakeMaterialText(actor, draft.draftId, material.materialId)).rejects.toMatchObject({ code: "INTAKE_WITHDRAWN" });
  });

  test("确认建项后不再从草稿接口返回原文副本", async () => {
    const { user, actor } = await newActor("coverage-confirmed");
    const { draftId, materials } = await newDraft(actor, ["建项前的原文副本。"]);
    const model = capturingModel(materials[0].materialId, "建项前的原文副本。");
    const understood = await understandIntake(actor, draftId, { requestId: "u", processingConsent: true }, { runModel: model.runModel });
    const confirmed = await confirmIntake(actor, draftId, { requestId: `c-${crypto.randomUUID()}`,
      expectedRevision: understood.preview.revision, previewHash: understood.preview.previewHash,
      accepted: { title: "覆盖确认项目", description: "确认后草稿原文不再从预览接口返回。",
        goal: "核对确认后的原文访问边界", scenario: "RESEARCH" } });
    expect(confirmed.projectId).toBeTruthy();
    expect(await db.projectMembership.count({ where: { projectId: confirmed.projectId, userId: user.id, role: "OWNER" } })).toBe(1);
    await expect(readIntakeMaterialText(actor, draftId, materials[0].materialId)).rejects.toMatchObject({ code: "INTAKE_CONFIRMED" });
  });
});


