import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * B 域验收：附件重试/校对的事务原子性（中途失败注入）。
 *
 * 写入探针在导入 lib/db.ts 前设置独立 DATABASE_URL（continuityDatabase：临时目录 +
 * 逐条重放 prisma/migrations）。失败注入使用隔离 SQLite 文件上的触发器
 * `fail_attachment_revision`（BEFORE INSERT ON "AttachmentRevision" → RAISE(ABORT)），
 * 触发点位于业务事务中途：附件更新、Capture/KnowledgeCard/CardRelation/LifecycleEvent、
 * AgentRun 都已经写入同一事务后，才在修订链插入时失败，因此能证明整体回滚。
 * 模型一律 mock HTTP，不发起真实外部调用。
 */
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const database = (await import("./helpers/continuityDatabase")).continuityDatabase("attachment-atomicity");
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
  });
  return { ...database, storageDir };
});

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { correctAttachmentText, retryAttachmentExtraction } from "@/lib/services/attachmentService";

const CARD_DRAFT = {
  type: "experiment_log" as const,
  title: "附件整理：原子性验收",
  summary: "用户记录称实验准确率提升 4.2%，原始条件尚待核对。",
  keywords: ["原子性", "实验记录"],
  relatedTasks: [] as string[],
  nextActions: ["核对原子性测试记录"],
  importance: 3,
};

interface ChatRequestBody {
  messages?: Array<{ role?: string; content?: unknown }>;
}

const projectIds: string[] = [];
const writtenFiles: string[] = [];

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function cardResponse() {
  return jsonResponse({
    id: "mock-call-" + crypto.randomUUID(),
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(CARD_DRAFT) } }],
    usage: { prompt_tokens: 120, completion_tokens: 60 },
  });
}

function parseBody(init?: RequestInit): ChatRequestBody {
  try {
    const parsed: unknown = JSON.parse(String(init?.body ?? ""));
    return parsed && typeof parsed === "object" ? (parsed as ChatRequestBody) : {};
  } catch {
    return {};
  }
}

function isCaptureCall(body: ChatRequestBody) {
  const content = body.messages?.[0]?.content;
  return typeof content === "string" && content.includes("capture.fidelity.v2");
}

function installCaptureFetch() {
  const mock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (!isCaptureCall(parseBody(init))) throw new Error("未预期的模型请求");
    return cardResponse();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function createProject(label: string) {
  const user = await db.user.create({
    data: { username: "attachment-atomic-" + crypto.randomUUID(), passwordHash: "unused", displayName: "附件原子性验收" },
  });
  const project = await db.project.create({
    data: {
      title: label,
      description: "ATTACHMENT_ATOMICITY_SYNTHETIC_ONLY",
      goal: label + "：验证事务原子性",
      scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  projectIds.push(project.id);
  return project;
}

async function createAttachment(
  projectId: string,
  overrides: {
    type?: string;
    extractedText?: string | null;
    extractionStatus?: string;
    extractionError?: string | null;
    storageKey?: string;
    fileName?: string;
    mimeType?: string;
  } = {},
) {
  return db.attachment.create({
    data: {
      projectId,
      type: overrides.type ?? "IMAGE",
      storageKey: overrides.storageKey ?? `missing/atomic-${crypto.randomUUID()}.png`,
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

function writeStoredFile(storageKey: string, content: Buffer) {
  const target = path.join(isolated.storageDir, path.basename(storageKey));
  fs.writeFileSync(target, content);
  writtenFiles.push(target);
  return storageKey;
}

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

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error);
}

/** 在隔离库上注入"提交中途失败"：任何 AttachmentRevision 插入都 ABORT 整个事务。 */
async function installFailRevisionTrigger() {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_attachment_revision`);
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_attachment_revision BEFORE INSERT ON "AttachmentRevision" BEGIN SELECT RAISE(ABORT, 'injected'); END`,
  );
}

async function removeFailRevisionTrigger() {
  await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_attachment_revision`);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await removeFailRevisionTrigger().catch(() => {});
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

describe("B: attachment transaction atomicity (mid-transaction failure injection)", () => {
  it("B6-A retry 提交中途失败 → 附件状态/Capture/卡片/关系/修订/AgentRun/ImpactJob 全部回滚", async () => {
    const project = await createProject("重试事务原子性");
    const storageKey = writeStoredFile(`atomic-${crypto.randomUUID()}.pdf`, textPdfFixture());
    const attachment = await createAttachment(project.id, {
      type: "PDF",
      storageKey,
      fileName: "atomic.pdf",
      mimeType: "application/pdf",
    });
    installCaptureFetch();

    await installFailRevisionTrigger();
    let failure: unknown;
    try {
      failure = await rejectionOf(retryAttachmentExtraction(project.id, attachment.id));
    } finally {
      await removeFailRevisionTrigger();
    }

    expect(failure).toBeInstanceOf(Error);
    // Prisma 把 SQLite 触发器的 RAISE(ABORT) 归一成约束错误：错误位置必须正好是
    // 注入点所在的 AttachmentRevision 插入，而不是测试 fixture 自身的问题。
    const retryFailureMessage = String((failure as Error).message);
    expect(retryFailureMessage).toContain("attachmentRevision.create");
    expect(retryFailureMessage.toLowerCase()).toContain("constraint");

    // 业务事务整体回滚：附件没有变成 SUCCESS，也没有任何派生行。
    const stored = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(stored.extractedText).toBeNull();
    expect(stored.extractionStatus).toBe("PENDING");
    expect(stored.extractionError).toBeNull();
    expect(await db.capture.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.knowledgeCard.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.cardRelation.count({ where: { currentCard: { projectId: project.id } } })).toBe(0);
    expect(await db.attachmentRevision.count({ where: { attachmentId: attachment.id } })).toBe(0);
    expect(await db.agentRun.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.projectImpactJob.count({ where: { projectId: project.id } })).toBe(0);
    const projectAfterFailure = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(projectAfterFailure.contextRevision).toBe(0);

    // 触发器移除后同一附件重试成功：证明失败来自注入点，而不是重试逻辑本身坏了。
    const retried = await retryAttachmentExtraction(project.id, attachment.id);
    expect(retried.attachment.extractionStatus).toBe("SUCCESS");
    expect(retried.attachment.extractedText).toContain("Requirements 2026");
    expect(retried.card).toBeTruthy();
    expect(await db.attachmentRevision.count({ where: { attachmentId: attachment.id } })).toBe(1);
    expect(await db.knowledgeCard.count({ where: { projectId: project.id } })).toBe(1);
    expect(await db.agentRun.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("B6-B correctAttachmentText 提交中途失败 → 附件文本/卡片/取代关系/修订/审计事件全部回滚", async () => {
    const project = await createProject("校对事务原子性");
    const oldText = "旧校对文本：准确率 80%。";
    const correctedText = "新校对文本：准确率 92%。";
    const attachment = await createAttachment(project.id, {
      extractedText: oldText,
      extractionStatus: "SUCCESS",
    });
    const capture = await db.capture.create({
      data: { projectId: project.id, rawText: "旧卡片来源", sourceType: "UNIT_FIXTURE" },
    });
    await db.knowledgeCard.create({
      data: {
        projectId: project.id,
        captureId: capture.id,
        attachmentId: attachment.id,
        type: "experiment_log",
        title: "旧卡片",
        summary: "旧卡片摘要内容，保留历史事实。",
        keywords: ["旧"],
        relatedTasks: [],
        nextActions: ["保持现状"],
        importance: 2,
      },
    });
    installCaptureFetch();

    await installFailRevisionTrigger();
    let failure: unknown;
    try {
      failure = await rejectionOf(correctAttachmentText(project.id, attachment.id, correctedText));
    } finally {
      await removeFailRevisionTrigger();
    }

    expect(failure).toBeInstanceOf(Error);
    // Prisma 把 SQLite 触发器的 RAISE(ABORT) 归一成约束错误：错误位置必须正好是
    // 注入点所在的 AttachmentRevision 插入，而不是测试 fixture 自身的问题。
    const correctionFailureMessage = String((failure as Error).message);
    expect(correctionFailureMessage).toContain("attachmentRevision.create");
    expect(correctionFailureMessage.toLowerCase()).toContain("constraint");

    const stored = await db.attachment.findUniqueOrThrow({ where: { id: attachment.id } });
    expect(stored.extractedText).toBe(oldText);
    expect(stored.extractionStatus).toBe("SUCCESS");
    expect(await db.capture.count({ where: { projectId: project.id } })).toBe(1);
    expect(await db.knowledgeCard.count({ where: { projectId: project.id } })).toBe(1);
    expect(await db.cardRelation.count({ where: { currentCard: { projectId: project.id } } })).toBe(0);
    expect(await db.attachmentRevision.count({ where: { attachmentId: attachment.id } })).toBe(0);
    expect(await db.memoryLifecycleEvent.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.projectImpactJob.count({ where: { projectId: project.id } })).toBe(0);
    const projectAfterFailure = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(projectAfterFailure.contextRevision).toBe(0);

    // 移除注入点后重新校对成功：修订链保留旧文本并追加新文本。
    const corrected = await correctAttachmentText(project.id, attachment.id, correctedText);
    expect(corrected.attachment.extractedText).toBe(correctedText);
    const revisions = await db.attachmentRevision.findMany({
      where: { attachmentId: attachment.id },
      orderBy: { revisionIndex: "asc" },
    });
    expect(revisions.map((revision) => revision.source)).toEqual(["EXTRACTION", "MANUAL_CORRECTION"]);
    expect(revisions[0].text).toBe(oldText);
    expect(revisions[1].text).toBe(correctedText);
    expect(await db.knowledgeCard.count({ where: { projectId: project.id } })).toBe(2);
    const supersedes = await db.cardRelation.count({
      where: { currentCard: { projectId: project.id }, relationType: "SUPERSEDES", confirmed: true },
    });
    expect(supersedes).toBe(1);
    expect(await db.memoryLifecycleEvent.count({ where: { projectId: project.id } })).toBe(2);
  });
});
