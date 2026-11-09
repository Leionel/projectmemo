import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";

/**
 * B 域验收：附件重试（retryAttachmentExtraction 重写）与校对（correctAttachmentText）行为。
 *
 * 写入探针在导入 lib/db.ts 前设置独立 DATABASE_URL（复用 continuityDatabase 助手：
 * 临时目录 + 逐条重放 prisma/migrations），不触碰共享的 prisma/test-vitest.db。
 * 模型/视觉一律 mock HTTP（vi.stubGlobal("fetch")）；本文件不发起任何真实外部调用。
 */
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const database = (await import("./helpers/continuityDatabase")).continuityDatabase("attachment-retry");
  const storageDir = path.join(database.dir, "storage");
  fs.mkdirSync(storageDir, { recursive: true });
  Object.assign(process.env, {
    ATTACHMENT_DIR: storageDir,
    LLM_MODE: "openai-compatible",
    LLM_API_KEY: "unit-fixture-not-a-key",
    LLM_BASE_URL: "http://mock.local/v1",
    LLM_MODEL_NAME: "mock-chat",
    LLM_VISION_MODEL_NAME: "mock-vision",
    SEMANTIC_MEMORY_ENABLED: "false",
    PROJECT_STATE_ENABLED: "false",
    PROJECT_INBOX_ENABLED: "true",
    EXPERIMENT_OBSERVER_ENABLED: "true",
  });
  return { ...database, storageDir };
});

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { AgentRunType } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import { CAPTURE_MODEL_TEXT_LIMIT } from "@/lib/agent/specialistPrompts";
import { KeywordVectorStore } from "@/lib/memory/vectorStore";
import {
  correctAttachmentText,
  processAttachmentUpload,
  retryAttachmentExtraction,
} from "@/lib/services/attachmentService";
import { db } from "@/lib/db";

const CARD_DRAFT = {
  type: "experiment_log" as const,
  title: "附件整理：实验结果",
  summary: "用户记录称实验准确率提升 4.2%，原始条件尚待核对。",
  keywords: ["实验记录", "准确率"],
  relatedTasks: [] as string[],
  nextActions: ["核对实验原始记录"],
  importance: 3,
};

interface ChatRequestBody {
  model?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
}

interface CaptureEnvelope {
  kind: string;
  data: {
    rawText: string;
    coverage?: { totalChars: number; sentChars: number; truncated: boolean };
  };
}

const projectIds: string[] = [];
const writtenFiles: string[] = [];

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function chatResponse(content: string, finishReason = "stop") {
  return jsonResponse({
    id: "mock-call-" + crypto.randomUUID(),
    choices: [{ finish_reason: finishReason, message: { content } }],
    usage: { prompt_tokens: 120, completion_tokens: 60 },
  });
}

function cardResponse() {
  return chatResponse(JSON.stringify(CARD_DRAFT));
}

function parseBody(init?: RequestInit): ChatRequestBody {
  try {
    const parsed: unknown = JSON.parse(String(init?.body ?? ""));
    return parsed && typeof parsed === "object" ? (parsed as ChatRequestBody) : {};
  } catch {
    return {};
  }
}

function isVisionCall(body: ChatRequestBody) {
  return Array.isArray(body.messages?.[0]?.content);
}

function isCaptureCall(body: ChatRequestBody) {
  const content = body.messages?.[0]?.content;
  return typeof content === "string" && content.includes("capture.fidelity.v2");
}

function envelopeOf(body: ChatRequestBody): CaptureEnvelope {
  const content = body.messages?.[1]?.content;
  if (typeof content !== "string") throw new Error("capture 请求缺少用户数据消息");
  return JSON.parse(content) as CaptureEnvelope;
}

/** 唯一允许的模型调用通道：内存 mock；任何未预期请求都直接失败而不是外呼。 */
function installFetch(handler: (body: ChatRequestBody) => Response | Promise<Response>) {
  const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => handler(parseBody(init)));
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function createProject(label: string) {
  const user = await db.user.create({
    data: { username: "attachment-" + crypto.randomUUID(), passwordHash: "unused", displayName: "附件验收" },
  });
  const project = await db.project.create({
    data: {
      title: label,
      description: "ATTACHMENT_SYNTHETIC_ONLY",
      goal: label + "：验证附件重试行为",
      scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  projectIds.push(project.id);
  return project;
}

interface AttachmentOverrides {
  type?: string;
  extractedText?: string | null;
  extractionStatus?: string;
  extractionError?: string | null;
  storageKey?: string;
  fileName?: string;
  mimeType?: string;
}

async function createAttachment(projectId: string, overrides: AttachmentOverrides = {}) {
  const storageKey = overrides.storageKey ?? `missing/attachment-${crypto.randomUUID()}.png`;
  return db.attachment.create({
    data: {
      projectId,
      type: overrides.type ?? "IMAGE",
      storageKey,
      fileName: overrides.fileName ?? "chart.png",
      mimeType: overrides.mimeType ?? "image/png",
      size: 64,
      sha256: crypto.randomUUID(),
      extractedText: overrides.extractedText ?? null,
      extractionStatus: overrides.extractionStatus ?? "PENDING",
      extractionError: overrides.extractionError ?? null,
    },
  });
}

function writeStoredFile(storageKey: string, content: Buffer | string) {
  const target = path.join(isolated.storageDir, path.basename(storageKey));
  fs.writeFileSync(target, content);
  writtenFiles.push(target);
  return storageKey;
}

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

function buildPdf(objects: string[]) {
  let raw = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(raw));
    raw += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(raw);
  raw += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(raw);
}

function textPdfFixture() {
  const stream = "BT /F1 12 Tf 40 740 Td (Requirements 2026 deadline 2026-11-15 accuracy 0.90) Tj ET";
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ]);
}

function emptyPdfFixture() {
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
  ]);
}

const popplerAvailable = (() => {
  try {
    const probe = spawnSync(process.env.PDFTOTEXT_PATH || "pdftotext", ["-v"], { windowsHide: true });
    return !probe.error;
  } catch {
    return false;
  }
})();

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const projectId of projectIds.splice(0)) {
    await db.project.delete({ where: { id: projectId } }).catch(() => {});
  }
  for (const file of writtenFiles.splice(0)) {
    fs.rmSync(file, { force: true });
  }
});

afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

describe("B: attachment retry reuse / extraction states / concurrency", () => {
  it("B1 已完成附件（SUCCESS+原文+卡片）重试直接复用，不读存储、不新增修订/卡片/AgentRun", async () => {
    const project = await createProject("已完成附件复用");
    const capture = await db.capture.create({
      data: { projectId: project.id, rawText: "既有整理原文", sourceType: "UNIT_FIXTURE" },
    });
    const card = await db.knowledgeCard.create({
      data: {
        projectId: project.id,
        captureId: capture.id,
        type: "experiment_log",
        title: "既有卡片",
        summary: "既有卡片摘要内容，保留历史事实。",
        keywords: ["既有"],
        relatedTasks: [],
        nextActions: ["保持现状"],
        importance: 2,
      },
    });
    const extracted = "已经抽取好的完整原文：实验流程、指标与结论。";
    const attachment = await createAttachment(project.id, {
      storageKey: "missing/completed-image.png",
      extractedText: extracted,
      extractionStatus: "SUCCESS",
    });
    await db.attachmentRevision.create({
      data: { attachmentId: attachment.id, revisionIndex: 0, text: extracted, source: "EXTRACTION" },
    });
    await db.knowledgeCard.update({ where: { id: card.id }, data: { attachmentId: attachment.id } });

    // storage 文件从一开始就不存在：一旦走重新提取就会 ENOENT。fetch 也不允许被调用。
    const fetchMock = installFetch(() => {
      throw new Error("已完成附件重试不应调用模型");
    });
    const result = await retryAttachmentExtraction(project.id, attachment.id);

    expect(result.attachment.id).toBe(attachment.id);
    expect(result.card?.id).toBe(card.id);
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(stored.extractedText).toBe(extracted);
    expect(stored.extractionStatus).toBe("SUCCESS");
    expect(stored.extractionError).toBeNull();
    expect(await db.attachmentRevision.count({ where: { attachmentId: attachment.id } })).toBe(1);
    expect(await db.knowledgeCard.count({ where: { projectId: project.id } })).toBe(1);
    expect(await db.capture.count({ where: { projectId: project.id } })).toBe(1);
    expect(await db.agentRun.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("B2 仅记忆生成失败（FAILED+保留原文）重试复用原文、补齐卡片并置 SUCCESS，不重新提取", async () => {
    const project = await createProject("记忆生成失败重试");
    const extracted = "原始提取文本：消融实验在 FixMatch 基线上准确率提升 4.2%，显存占用 5.8GB。";
    const attachment = await createAttachment(project.id, {
      // 存储文件已被删除/不存在：证明重试没有重新读取文件提取。
      storageKey: `deleted/${crypto.randomUUID()}.png`,
      extractedText: extracted,
      extractionStatus: "FAILED",
      extractionError: "Memory ingestion failed: mock provider unavailable",
    });
    // 真实上传流程在记忆生成失败前已写入 revision 0（原始机器提取文本）。
    await db.attachmentRevision.create({
      data: { attachmentId: attachment.id, revisionIndex: 0, text: extracted, source: "EXTRACTION" },
    });
    const fetchMock = installFetch((body) => {
      expect(isCaptureCall(body)).toBe(true);
      return cardResponse();
    });

    const result = await retryAttachmentExtraction(project.id, attachment.id);

    expect(result.attachment.extractionStatus).toBe("SUCCESS");
    expect(result.attachment.extractedText).toBe(extracted);
    expect(result.attachment.extractionError).toBeNull();
    expect(result.card).toBeTruthy();
    // 只有一次 capture 结构化请求：没有视觉/文本重新提取，也没有重试别的阶段。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const cards = await db.knowledgeCard.findMany({ where: { attachmentId: attachment.id } });
    expect(cards).toHaveLength(1);
    const revisions = await db.attachmentRevision.findMany({
      where: { attachmentId: attachment.id },
      orderBy: { revisionIndex: "asc" },
    });
    // 旧原文修订保留；重试作为一条可追溯事件追加，但绝不改写原文。
    expect(revisions.map((revision) => revision.source)).toEqual(["EXTRACTION", "EXTRACTION_RETRY"]);
    expect(revisions[0]).toMatchObject({ revisionIndex: 0, text: extracted });
    expect(revisions[1]).toMatchObject({ revisionIndex: 1, text: extracted });
    const capture = await db.capture.findFirstOrThrow({ where: { projectId: project.id } });
    expect(capture.rawText).toContain(extracted);
    const run = await db.agentRun.findFirstOrThrow({
      where: { projectId: project.id, runType: AgentRunType.CAPTURE },
    });
    const trace = run.trace as Record<string, unknown>;
    expect(trace.pipeline).toEqual(expect.arrayContaining(["attachment_retry", "atomic_save"]));
  });

  it("B3a 图片附件：mock 视觉 provider 提取成功 → SUCCESS+卡片+修订0", async () => {
    const project = await createProject("图片视觉提取成功");
    const storageKey = writeStoredFile(`vision-${crypto.randomUUID()}.png`, PNG_HEADER);
    const attachment = await createAttachment(project.id, {
      type: "IMAGE",
      storageKey,
      extractionStatus: "NEEDS_OCR",
      extractionError: "Image OCR requires a configured vision provider",
    });
    const calls: string[] = [];
    installFetch((body) => {
      if (isVisionCall(body)) {
        calls.push("vision");
        return chatResponse("图表显示：消融实验准确率 92%，显存 5.8GB");
      }
      if (isCaptureCall(body)) {
        calls.push("capture");
        return cardResponse();
      }
      throw new Error("未预期的模型请求");
    });

    const result = await retryAttachmentExtraction(project.id, attachment.id);

    expect(calls).toEqual(["vision", "capture"]);
    expect(result.attachment.extractionStatus).toBe("SUCCESS");
    expect(result.attachment.extractedText).toContain("【图片提取】");
    expect(result.attachment.extractedText).toContain("消融实验准确率 92%");
    expect(result.attachment.extractionError).toBeNull();
    expect(result.card).toBeTruthy();
    const revision = await db.attachmentRevision.findFirstOrThrow({ where: { attachmentId: attachment.id } });
    // 该附件原本没有修订链：重试把本次提取文本作为 revision 0（来源标注为重试提取）。
    expect(revision).toMatchObject({ revisionIndex: 0, source: "EXTRACTION_RETRY" });
    expect(revision.text).toBe(result.attachment.extractedText);
  });

  it.skipIf(!popplerAvailable)("B3a2 PDF 附件：本地 pdftotext 提取成功 → SUCCESS+卡片", async () => {
    const project = await createProject("PDF 提取成功");
    const storageKey = writeStoredFile(`text-${crypto.randomUUID()}.pdf`, textPdfFixture());
    const attachment = await createAttachment(project.id, {
      type: "PDF",
      storageKey,
      fileName: "requirements.pdf",
      mimeType: "application/pdf",
      extractionStatus: "PENDING",
    });
    installFetch((body) => {
      expect(isCaptureCall(body)).toBe(true);
      return cardResponse();
    });

    const result = await retryAttachmentExtraction(project.id, attachment.id);

    expect(result.attachment.extractionStatus).toBe("SUCCESS");
    expect(result.attachment.extractedText).toContain("Requirements 2026");
    expect(result.attachment.extractedText).toContain("2026-11-15");
    expect(result.card).toBeTruthy();
    const revision = await db.attachmentRevision.findFirstOrThrow({ where: { attachmentId: attachment.id } });
    expect(revision.text).toContain("Requirements 2026");
  });

  it("B3b-1 图片提取为空（未配置视觉 provider）→ NEEDS_OCR 且给出原因", async () => {
    const project = await createProject("图片空提取");
    const storageKey = writeStoredFile(`no-vision-${crypto.randomUUID()}.png`, PNG_HEADER);
    const attachment = await createAttachment(project.id, { type: "IMAGE", storageKey });
    vi.stubEnv("LLM_MODE", "mock"); // getVisionProviderConfig 返回 null → 视觉提取返回空
    const fetchMock = installFetch(() => {
      throw new Error("未配置视觉 provider 时不应发起模型请求");
    });

    const result = await retryAttachmentExtraction(project.id, attachment.id);

    expect(result.attachment.extractionStatus).toBe("NEEDS_OCR");
    expect(result.attachment.extractedText).toBeNull();
    expect(result.attachment.extractionError).toContain("图片文字需要配置视觉识别服务");
    expect(result.card).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.attachmentRevision.count({ where: { attachmentId: attachment.id } })).toBe(0);
  });

  it.skipIf(!popplerAvailable)("B3b-2 PDF 无可用文字 → NEEDS_OCR 且给出原因", async () => {
    const project = await createProject("PDF 空提取");
    const storageKey = writeStoredFile(`empty-${crypto.randomUUID()}.pdf`, emptyPdfFixture());
    const attachment = await createAttachment(project.id, {
      type: "PDF",
      storageKey,
      fileName: "scan.pdf",
      mimeType: "application/pdf",
    });
    const fetchMock = installFetch(() => {
      throw new Error("PDF 无文字时不应发起模型请求");
    });

    const result = await retryAttachmentExtraction(project.id, attachment.id);

    expect(result.attachment.extractionStatus).toBe("NEEDS_OCR");
    expect(result.attachment.extractionError).toContain("PDF 暂无可可靠提取的文字");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("B3c 视觉提取异常：HTTP 500 与网络抛错均记录 FAILED 并保留真实原因", async () => {
    const project = await createProject("视觉提取异常");
    const firstKey = writeStoredFile(`fail-http-${crypto.randomUUID()}.png`, PNG_HEADER);
    const first = await createAttachment(project.id, { type: "IMAGE", storageKey: firstKey });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "upstream unavailable" }, 500)));

    const firstResult = await retryAttachmentExtraction(project.id, first.id);

    expect(firstResult.attachment.extractionStatus).toBe("FAILED");
    expect(firstResult.attachment.extractedText).toBeNull();
    expect(firstResult.attachment.extractionError).toContain("视觉提取失败");
    expect(firstResult.attachment.extractionError).toContain("HTTP 500");
    expect(firstResult.card).toBeNull();

    const secondKey = writeStoredFile(`fail-net-${crypto.randomUUID()}.png`, PNG_HEADER);
    const second = await createAttachment(project.id, { type: "IMAGE", storageKey: secondKey });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("mock network down");
    }));

    const secondResult = await retryAttachmentExtraction(project.id, second.id);

    expect(secondResult.attachment.extractionStatus).toBe("FAILED");
    expect(secondResult.attachment.extractionError).toContain("mock network down");
    expect(await db.knowledgeCard.count({ where: { attachmentId: second.id } })).toBe(0);
  });

  it("B4 旧重试在暂停期间被人工校对后拒绝覆盖新版本（409 ATTACHMENT_TEXT_CHANGED）", async () => {
    const project = await createProject("旧重试拒绝覆盖");
    const oldText = "旧提取文本：准确率 80%，消融条件未注明。";
    const correctedText = "人工校对文本：准确率 92%，消融条件已核对。";
    const attachment = await createAttachment(project.id, {
      extractedText: oldText,
      extractionStatus: "FAILED",
      extractionError: "Memory ingestion failed: mock",
    });

    let enterRetry!: () => void;
    const retryEntered = new Promise<void>((resolve) => {
      enterRetry = resolve;
    });
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    let captureCalls = 0;
    installFetch((body) => {
      if (!isCaptureCall(body)) throw new Error("未预期的模型请求");
      captureCalls += 1;
      if (captureCalls === 1) {
        // 暂停第一次 retry 的结构化调用：此刻还没有进入提交事务。
        enterRetry();
        return retryGate.then(() => cardResponse());
      }
      return cardResponse();
    });

    const pendingRetry = rejectionOf(retryAttachmentExtraction(project.id, attachment.id));
    await retryEntered;

    const corrected = await correctAttachmentText(project.id, attachment.id, correctedText);
    expect(corrected.attachment.extractedText).toBe(correctedText);

    releaseRetry();
    const failure = await pendingRetry;

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: "ATTACHMENT_TEXT_CHANGED", status: 409 });

    const stored = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(stored.extractedText).toBe(correctedText);
    expect(stored.extractionStatus).toBe("SUCCESS");
    const revisions = await db.attachmentRevision.findMany({
      where: { attachmentId: attachment.id },
      orderBy: { revisionIndex: "asc" },
    });
    expect(revisions.map((revision) => revision.source)).toEqual(["EXTRACTION", "MANUAL_CORRECTION"]);
    expect(revisions.some((revision) => revision.source === "EXTRACTION_RETRY")).toBe(false);
    expect(revisions.some((revision) => revision.text === oldText)).toBe(true);
    expect(revisions.at(-1)?.text).toBe(correctedText);
    expect(await db.knowledgeCard.count({ where: { attachmentId: attachment.id } })).toBe(1);
    expect(await db.capture.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("B5 并发重试：最终 1 张卡/1 条修订/1 个 CAPTURE AgentRun；后提交者 409", async () => {
    const project = await createProject("并发重试");
    const extracted = "并发场景原始提取文本：准确率 88%，样本 120 条。";
    const attachment = await createAttachment(project.id, {
      extractedText: extracted,
      extractionStatus: "FAILED",
      extractionError: "Memory ingestion failed: mock",
    });

    let arrivals = 0;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const fetchMock = installFetch(async (body) => {
      if (!isCaptureCall(body)) throw new Error("未预期的模型请求");
      arrivals += 1;
      if (arrivals === 2) releaseBarrier();
      // 两次 retry 都完成结构化准备后才同时进入提交阶段，真实制造并发交错。
      await barrier;
      return cardResponse();
    });

    const outcomes = await Promise.all([
      rejectionOf(retryAttachmentExtraction(project.id, attachment.id)),
      rejectionOf(retryAttachmentExtraction(project.id, attachment.id)),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fulfilled = outcomes.filter((outcome) => outcome === null);
    const rejected = outcomes.filter((outcome) => outcome instanceof AppError);
    expect(fulfilled.length + rejected.length).toBe(2);
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    // 本实现的第二条路径必须明确拒绝（409），而不是静默重复写修订。
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ code: "ATTACHMENT_TEXT_CHANGED", status: 409 });

    expect(await db.knowledgeCard.count({ where: { attachmentId: attachment.id } })).toBe(1);
    const revisions = await db.attachmentRevision.findMany({ where: { attachmentId: attachment.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].text).toBe(extracted);
    expect(await db.capture.count({ where: { projectId: project.id } })).toBe(1);
    expect(await db.agentRun.count({ where: { projectId: project.id, runType: AgentRunType.CAPTURE } })).toBe(1);
    const stored = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(stored.extractionStatus).toBe("SUCCESS");
    expect(stored.extractedText).toBe(extracted);
  });

  it("B6 指标附件：EXPERIMENT_OBSERVER_ENABLED=false 时 503 且不提取；开启时已完成指标重试复用且不建卡", async () => {
    const project = await createProject("指标附件开关");
    const fetchMock = installFetch(() => {
      throw new Error("指标附件重试不应调用模型");
    });
    const csvAttachment = await createAttachment(project.id, {
      type: "CSV",
      fileName: "metrics.csv",
      mimeType: "text/csv",
      storageKey: "missing/metrics.csv",
      extractedText: "metric,value\naccuracy,0.9",
      extractionStatus: "SUCCESS",
    });
    vi.stubEnv("EXPERIMENT_OBSERVER_ENABLED", "false");

    const failure = await rejectionOf(retryAttachmentExtraction(project.id, csvAttachment.id));

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ code: "EXPERIMENT_OBSERVER_DISABLED", status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
    const untouched = await db.attachment.findUniqueOrThrow({ where: { id: csvAttachment.id } });
    expect(untouched.extractionStatus).toBe("SUCCESS");
    expect(await db.attachmentRevision.count({ where: { attachmentId: csvAttachment.id } })).toBe(0);
    expect(await db.knowledgeCard.count({ where: { attachmentId: csvAttachment.id } })).toBe(0);

    vi.stubEnv("EXPERIMENT_OBSERVER_ENABLED", "true");
    const jsonAttachment = await createAttachment(project.id, {
      type: "JSON",
      fileName: "metrics.json",
      mimeType: "application/json",
      storageKey: "missing/metrics.json",
      extractedText: "{\"accuracy\":0.9}",
      extractionStatus: "SUCCESS",
    });

    const reused = await retryAttachmentExtraction(project.id, jsonAttachment.id);

    expect(reused.attachment.id).toBe(jsonAttachment.id);
    expect(reused.card).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.knowledgeCard.count({ where: { attachmentId: jsonAttachment.id } })).toBe(0);
    expect(await db.attachmentRevision.count({ where: { attachmentId: jsonAttachment.id } })).toBe(0);
  });

  it("B7 索引失败（KeywordVectorStore.index reject）不改变 retry/校对的成功业务结果", async () => {
    const project = await createProject("索引失败");
    const extracted = "索引失败场景原始文本：准确率 90%。";
    const retryAttachment = await createAttachment(project.id, {
      extractedText: extracted,
      extractionStatus: "FAILED",
      extractionError: "Memory ingestion failed: mock",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const index = vi.spyOn(KeywordVectorStore.prototype, "index").mockRejectedValue(new Error("vector index unavailable"));
    installFetch((body) => {
      expect(isCaptureCall(body)).toBe(true);
      return cardResponse();
    });

    const retried = await retryAttachmentExtraction(project.id, retryAttachment.id);

    expect(index).toHaveBeenCalled();
    expect(retried.attachment.extractionStatus).toBe("SUCCESS");
    expect(retried.card).toBeTruthy();
    expect(await db.knowledgeCard.count({ where: { attachmentId: retryAttachment.id } })).toBe(1);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("memory indexing is pending"))).toBe(true);

    index.mockClear();
    const correctionAttachment = await createAttachment(project.id, {
      type: "IMAGE",
      storageKey: "missing/correction.png",
      extractionStatus: "NEEDS_OCR",
    });
    const corrected = await correctAttachmentText(project.id, correctionAttachment.id, "校对后的实验文本：准确率 95%。");

    expect(index).toHaveBeenCalled();
    expect(corrected.attachment.extractionStatus).toBe("SUCCESS");
    expect(corrected.card).toBeTruthy();
    expect(await db.knowledgeCard.count({ where: { attachmentId: correctionAttachment.id } })).toBe(1);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("Correction card indexing failed"))).toBe(true);
  });

  it("B8 长材料 150k：附件与修订0保留全文，模型请求按 CAPTURE_MODEL_TEXT_LIMIT 截断并声明覆盖", async () => {
    const project = await createProject("长材料上传");
    const longText = "长材料段落，".repeat(25_000);
    expect(longText).toHaveLength(150_000);
    const envelopes: CaptureEnvelope[] = [];
    const fetchMock = installFetch((body) => {
      if (!isCaptureCall(body)) throw new Error("未预期的模型请求");
      envelopes.push(envelopeOf(body));
      return cardResponse();
    });

    const uploaded = await processAttachmentUpload(
      {
        projectId: project.id,
        fileName: "large-material.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\nsynthetic long material"),
      },
      { extractedText: longText },
    );

    expect(uploaded.attachment.extractedText).toHaveLength(150_000);
    expect(uploaded.attachment.extractionStatus).toBe("SUCCESS");
    expect(uploaded.card).toBeTruthy();
    const revision = await db.attachmentRevision.findFirstOrThrow({ where: { attachmentId: uploaded.attachment.id } });
    expect(revision).toMatchObject({ revisionIndex: 0, source: "EXTRACTION" });
    expect(revision.text).toBe(longText);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const envelope = envelopes[0];
    expect(envelope.kind).toBe("UNTRUSTED_DATA");
    expect(envelope.data.rawText.length).toBeLessThanOrEqual(CAPTURE_MODEL_TEXT_LIMIT);
    expect(envelope.data.coverage?.truncated).toBe(true);
    expect(envelope.data.coverage?.sentChars).toBe(envelope.data.rawText.length);
    expect(envelope.data.coverage?.totalChars ?? 0).toBeGreaterThan(CAPTURE_MODEL_TEXT_LIMIT);
    expect(envelope.data.rawText).toContain("文件过长");

    const stored = await db.attachment.findUniqueOrThrow({ where: { id: uploaded.attachment.id } });
    expect(stored.extractedText).toBe(longText);
    const card = await db.knowledgeCard.findFirstOrThrow({ where: { attachmentId: uploaded.attachment.id } });
    expect(card.id).toBe(uploaded.card?.id);
  });
});
