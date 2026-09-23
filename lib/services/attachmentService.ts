import { db } from "@/lib/db";
import {
  computeFileSha256,
  deleteAttachmentFile,
  readAttachmentFile,
  saveFileToStorage,
} from "@/lib/storage/attachmentStorage";
import { processCapture } from "@/lib/services/captureService";
import { requireProject } from "@/lib/repositories/projects";
import { AppError } from "@/lib/api";
import { structureCaptureWithMeta } from "@/lib/agent";
import { saveCaptureResult } from "@/lib/repositories/cards";
import { KeywordVectorStore } from "@/lib/memory/vectorStore";
import { recordLifecycleEventInTx } from "@/lib/services/memoryLifecycleService";
import { isFeatureEnabled } from "@/lib/config/features";
import { getVisionProviderConfig } from "@/lib/config/provider";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";
import { spawn } from "node:child_process";

export interface UploadAttachmentInput {
  projectId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}
/**
 * 提取 PDF 文本（支持标准 ASCII 文本块与简单中文流提取）
 */
async function extractPdfText(buffer: Buffer): Promise<string | null> {
  const executable = process.env.PDFTOTEXT_PATH || "pdftotext";
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-layout", "-", "-"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => child.kill(), 15_000);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`PDF extractor unavailable: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`PDF extraction failed: ${Buffer.concat(stderr).toString("utf8").trim().slice(0, 240) || `exit ${code}`}`));
        return;
      }
      const text = Buffer.concat(stdout).toString("utf8").replace(/\u0000/g, "").trim();
      resolve(text.length >= 20 ? text.slice(0, 100_000) : null);
    });
    child.stdin.end(buffer);
  });
}

/** 视觉提取的体积上限：base64 后约为原始的 1.33 倍，需留在请求体限制之内。 */
const VISION_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 提取图片文本 / 描述。
 * 未配置视觉 provider 时返回 null（调用方记为 NEEDS_OCR）；
 * 已配置但调用失败时抛出，调用方记为 FAILED 并保留真实原因。
 */
async function extractImageText(mimeType: string, buffer: Buffer): Promise<string | null> {
  const config = getVisionProviderConfig();
  if (!config) {
    return null;
  }

  if (buffer.length >= VISION_MAX_BYTES) {
    throw new Error(`图片超过视觉提取上限 ${Math.round(VISION_MAX_BYTES / 1024 / 1024)}MB`);
  }

  const { baseUrl, apiKey, model } = config;

  try {
    const base64 = buffer.toString("base64");
    const dataUri = `data:${mimeType};base64,${base64}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "请简明提取或总结这张图片中的关键文字与项目核心信息（100字以内）：" },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("视觉模型返回了空结果");
    }
    return `【图片提取】：${text}`;
  } catch (error) {
    // 已经配置了 provider 却失败，说明是模型名/额度/网络问题，不是"这个文件不支持"。
    // 旧实现把它 console.warn 掉再返回 null，附件就被记成 NEEDS_OCR，真实原因丢失。
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`视觉提取失败（模型 ${model}）：${detail}`);
  }
}

function inferAndValidateFileType(fileName: string, mimeType: string, buffer: Buffer): "IMAGE" | "PDF" {
  if (buffer.length === 0) {
    throw new Error("Attachment is empty");
  }
  if (buffer.length > 20 * 1024 * 1024) {
    throw new Error("Attachment exceeds the 20MB limit");
  }

  const lowerName = fileName.toLowerCase();
  const isPdf = mimeType === "application/pdf" || lowerName.endsWith(".pdf");
  if (isPdf) {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new Error("File content is not a valid PDF header");
    }
    return "PDF";
  }

  const isImage = mimeType.startsWith("image/") || /\.(png|jpe?g|webp|bmp|gif)$/i.test(fileName);
  if (!isImage) {
    throw new Error("Only PDF and image attachments are supported");
  }

  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isGif = buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  const isBmp = buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM";
  const isWebp = buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (!isPng && !isJpeg && !isGif && !isBmp && !isWebp) {
    throw new Error("File content does not match a supported image format");
  }
  return "IMAGE";
}

export async function processAttachmentUpload(input: UploadAttachmentInput) {
  const { projectId, fileName, mimeType, buffer } = input;
  if (!isFeatureEnabled("PROJECT_INBOX_ENABLED", true)) {
    throw new AppError("PROJECT_INBOX_DISABLED", "项目附件入口当前已关闭", 503);
  }
  await requireProject(projectId);

  // 1. 校验文件内容，而不是只信任客户端提供的扩展名/MIME。
  const fileType = inferAndValidateFileType(fileName, mimeType, buffer);

  // 2. 写盘前去重，避免重复上传遗留孤儿文件。
  const sha256 = computeFileSha256(buffer);
  const existingAttachment = await db.attachment.findFirst({
    where: { projectId, sha256 },
  });

  if (existingAttachment) {
    return {
      attachment: existingAttachment,
      isDuplicate: true,
      card: null,
    };
  }

  // 3. 仅在确认不是重复文件后写入持久化目录。
  const stored = await saveFileToStorage(projectId, fileName, buffer);

  // 4. 提取文本内容
  let extractedText = "";
  let extractionStatus = "SUCCESS";
  let extractionError: string | null = null;

  try {
    if (fileType === "PDF") {
      extractedText = await extractPdfText(buffer) ?? "";
    } else {
      extractedText = await extractImageText(mimeType, buffer) ?? "";
    }
    if (!extractedText) {
      extractionStatus = "NEEDS_OCR";
      extractionError = fileType === "PDF"
        ? "PDF has no reliably extractable plain text; configure a PDF extractor or OCR provider"
        : "Image OCR requires a configured vision provider";
    }
  } catch (err) {
    extractionStatus = "FAILED";
    extractionError = err instanceof Error ? err.message : "Extraction failed";
    extractedText = "";
  }

  // 5. 保存 Attachment 实体
  let attachment;
  try {
    attachment = await db.attachment.create({
      data: {
        projectId,
        type: fileType,
        storageKey: stored.storageKey,
        fileName,
        mimeType,
        size: stored.size,
        sha256: stored.sha256,
        extractedText: extractedText || null,
        extractionStatus,
        extractionError,
      },
    });
    // 修订链起点：原始机器提取文本作为 revision 0 保留
    if (extractedText) {
      await db.attachmentRevision.create({
        data: {
          attachmentId: attachment.id,
          revisionIndex: 0,
          text: extractedText,
          source: "EXTRACTION",
        },
      });
    }
  } catch (error) {
    await deleteAttachmentFile(stored.storageKey);
    throw error;
  }

  // 6. 自动将提取的文本转入 Capture Pipeline 生成 KnowledgeCard，并关联 attachmentId
  let card = null;
  if (extractedText && extractionStatus === "SUCCESS") {
    try {
      const sourceType = fileType === "IMAGE" ? "图片附件" : fileType === "PDF" ? "PDF文档" : "文件附件";
      card = await processCapture(projectId, `【附件导入：${fileName}】\n${extractedText}`, sourceType);

      // 更新卡片关联 attachmentId
      await db.knowledgeCard.update({
        where: { id: card.id },
        data: { attachmentId: attachment.id },
      });
    } catch (e) {
      console.warn("Failed to create knowledge card for attachment:", e);
      attachment = await db.attachment.update({
        where: { id: attachment.id },
        data: {
          extractionStatus: "FAILED",
          extractionError: e instanceof Error ? `Memory ingestion failed: ${e.message}` : "Memory ingestion failed",
        },
      });
    }
  }

  return {
    attachment,
    isDuplicate: false,
    card,
  };
}

export async function listProjectAttachments(projectId: string) {
  return db.attachment.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
}

export async function retryAttachmentExtraction(projectId: string, attachmentId: string) {
  await requireProject(projectId);
  const attachment = await db.attachment.findFirst({
    where: { id: attachmentId, projectId },
    include: { cards: true },
  });
  if (!attachment) throw new Error("Attachment not found in this project");

  const buffer = await readAttachmentFile(attachment.storageKey);
  const fileType = inferAndValidateFileType(attachment.fileName, attachment.mimeType, buffer);
  let extractedText: string | null = null;
  try {
    extractedText = fileType === "PDF"
      ? await extractPdfText(buffer)
      : await extractImageText(attachment.mimeType, buffer);
  } catch (error) {
    const failed = await db.attachment.update({
      where: { id: attachment.id },
      data: {
        extractedText: null,
        extractionStatus: "FAILED",
        extractionError: error instanceof Error ? error.message : "Extraction failed",
      },
    });
    return { attachment: failed, card: null };
  }

  if (!extractedText) {
    const pending = await db.attachment.update({
      where: { id: attachment.id },
      data: {
        extractedText: null,
        extractionStatus: "NEEDS_OCR",
        extractionError: fileType === "PDF"
          ? "PDF has no reliably extractable plain text; OCR is required"
          : "Image OCR requires a configured vision provider",
      },
    });
    return { attachment: pending, card: null };
  }

  let card = attachment.cards[0] ?? null;
  if (!card) {
    card = await processCapture(
      projectId,
      `【附件导入：${attachment.fileName}】\n${extractedText}`,
      fileType === "IMAGE" ? "图片附件" : "PDF文档",
    );
    await db.knowledgeCard.update({ where: { id: card.id }, data: { attachmentId: attachment.id } });
  }
  const updated = await db.attachment.update({
    where: { id: attachment.id },
    data: { extractedText, extractionStatus: "SUCCESS", extractionError: null },
  });
  // 重试提取的文本同样进入修订链，保证历史可追溯
  const revisionCount = await db.attachmentRevision.count({ where: { attachmentId: attachment.id } });
  await db.attachmentRevision.create({
    data: {
      attachmentId: attachment.id,
      revisionIndex: revisionCount,
      text: extractedText,
      source: "EXTRACTION_RETRY",
    },
  });
  return { attachment: updated, card };
}

export async function correctAttachmentText(
  projectId: string,
  attachmentId: string,
  correctedText: string,
  expectedCurrentText?: string
) {
  await requireProject(projectId);
  const trimmed = correctedText.trim();

  // 幂等：同一附件当前文本已经等于本次纠错文本时，返回既有结果，不重复建卡/建链
  const existing = await db.attachment.findFirst({
    where: { id: attachmentId, projectId },
    include: { cards: true },
  });
  if (!existing) {
    throw new AppError("NOT_FOUND", "附件记录未找到", 404);
  }
  if (existing.extractedText === trimmed && trimmed !== "") {
    const reusedCard = await db.knowledgeCard.findFirst({
      where: { attachmentId: existing.id },
      orderBy: { createdAt: "desc" },
    });
    return { attachment: existing, card: reusedCard ?? existing.cards[0] ?? null, idempotentReplay: true };
  }
  // 原版本校验：调用方基于旧文本编辑时，若服务端文本已变化则要求重载，避免并发纠错覆盖
  if (expectedCurrentText !== undefined && expectedCurrentText !== null &&
      existing.extractedText !== null && existing.extractedText !== expectedCurrentText) {
    throw new AppError("ATTACHMENT_TEXT_CHANGED", "附件文本已被其他校对修改，请重新载入后再提交", 409);
  }

  // 结构化生成在事务外（与普通捕获同一结构化管线，离线时回退确定性模板）
  const project = await requireProject(projectId);
  const recentCards = await db.knowledgeCard.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { keywords: true },
  });
  const historyKeywords = [...new Set(recentCards.flatMap((card) => (Array.isArray(card.keywords) ? (card.keywords as string[]) : [])))].slice(0, 30);
  const structured = await structureCaptureWithMeta({ project, rawText: `【附件校对：${existing.fileName}】\n${trimmed}`, historyKeywords });
  const draft = structured.data;

  const vectorStore = new KeywordVectorStore();

  // 单事务写入：Capture/Card（复用统一保存逻辑）、取代关系、修订链、附件更新、审计事件
  const result = await db.$transaction(async (tx) => {
    const card = await saveCaptureResult(
      {
        projectId,
        rawText: `【附件校对：${existing.fileName}】\n${trimmed}`,
        sourceType: existing.type === "IMAGE" ? "人工校对图片" : "人工校对PDF",
        draft,
        links: [],
        attachmentId: existing.id,
      },
      tx as unknown as Parameters<typeof saveCaptureResult>[1],
    );

    // 对该附件仍处于前沿的卡片建立 SUPERSEDES（跳过已被取代的旧版）：
    // 350→355→360 形成线性链 300←355←360，避免多前置 superseder 触发伪 CONFLICT
    for (const oldCard of existing.cards) {
      if (oldCard.id !== card.id) {
        const activeSuperseders = await tx.cardRelation.count({
          where: {
            relationType: "SUPERSEDES",
            confirmed: true,
            revokedAt: null,
            relatedCardId: oldCard.id,
          },
        });
        if (activeSuperseders > 0) {
          continue;
        }
        const relation = await tx.cardRelation.create({
          data: {
            currentCardId: card.id,
            relatedCardId: oldCard.id,
            relationType: "SUPERSEDES",
            reason: `人工校对修正附件【${existing.fileName}】内容，新记录取代旧记录`,
            score: 100,
            confidence: 1.0,
            confirmed: true,
            confirmedAt: new Date(),
            validFrom: new Date(),
          },
        });
        await recordLifecycleEventInTx(tx, {
          projectId,
          cardId: card.id,
          eventType: "RELATION_CONFIRM",
          reason: relation.reason,
          relationId: relation.id,
        });
        await recordLifecycleEventInTx(tx, {
          projectId,
          cardId: oldCard.id,
          eventType: "RELATION_CONFIRM",
          reason: relation.reason,
          relationId: relation.id,
        });
      }
    }

    // 修订链：旧抽取/校对文本原样保留，当前文本只作为最新版本
    const revisionCount = await tx.attachmentRevision.count({ where: { attachmentId: existing.id } });
    if (revisionCount === 0 && existing.extractedText !== null) {
      await tx.attachmentRevision.create({
        data: { attachmentId: existing.id, revisionIndex: 0, text: existing.extractedText, source: "EXTRACTION" },
      });
    }
    const nextIndex = revisionCount === 0 && existing.extractedText !== null ? 1 : revisionCount;
    await tx.attachmentRevision.create({
      data: { attachmentId: existing.id, revisionIndex: nextIndex, text: trimmed, source: "MANUAL_CORRECTION" },
    });

    const updated = await tx.attachment.update({
      where: { id: existing.id },
      data: { extractedText: trimmed, extractionStatus: "SUCCESS", extractionError: null },
    });
    await tx.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
    return { attachment: updated, card };
  });

  // 索引在提交后进行：失败可由回填脚本补偿，不影响已提交事实
  try {
    await vectorStore.index({ id: result.card.id, title: result.card.title, keywords: (result.card.keywords as string[]) ?? [] });
  } catch (error) {
    console.warn("Correction card indexing failed; backfill can retry", error);
  }

  const stateRefreshPending = await refreshProjectStateAfterMutation(projectId);
  return { attachment: result.attachment, card: result.card, idempotentReplay: false, stateRefreshPending };
}
