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
import { isFeatureEnabled } from "@/lib/config/features";
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

/**
 * 提取图片文本 / 描述
 */
async function extractImageText(mimeType: string, buffer: Buffer): Promise<string | null> {
  const isLlmVisionConfigured = process.env.LLM_MODE === "openai-compatible" && Boolean(process.env.LLM_API_KEY) && Boolean(process.env.LLM_BASE_URL);
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_VISION_MODEL_NAME || process.env.LLM_MODEL_NAME || "gpt-4o-mini";

  if (isLlmVisionConfigured && buffer.length < 5 * 1024 * 1024) {
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

      if (response.ok) {
        const json = await response.json();
        const text = json?.choices?.[0]?.message?.content?.trim();
        if (text) {
          return `【图片提取】：${text}`;
        }
      }
    } catch (e) {
      console.warn("Vision OCR failed; falling back to metadata:", e);
    }
  }

  return null;
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
  return { attachment: updated, card };
}
