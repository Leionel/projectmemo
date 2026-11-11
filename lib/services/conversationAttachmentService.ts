import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { reserveCloudCall } from "@/lib/auth/cloudQuota";
import { assertProject, lockConversation, ownedConversation } from "@/lib/conversation/repository";
import { extractImageText, extractPdfText, inferAndValidateFileType, processAttachmentUpload } from "@/lib/services/attachmentService";
import { computeFileSha256, deleteAttachmentFile, readAttachmentFile, saveFileToStorage } from "@/lib/storage/attachmentStorage";
import type { ConversationActor } from "@/lib/types/conversation";

/** 每次讨论最多保留的附件数；只读给模型的文字也按条截断，避免一份文件挤掉讨论上下文。 */
export const CONVERSATION_ATTACHMENT_LIMIT = 10;
const TURN_TEXT_LIMIT = 6000;
/** 模型提示上限 18000 字，附件之外还有目录、对话和来源；多份长附件按份数均分。 */
const TURN_TOTAL_TEXT_LIMIT = 9000;

const publicShape = { id: true, conversationId: true, type: true, fileName: true, mimeType: true, size: true,
  extractionStatus: true, extractionError: true, createdAt: true } as const;

/**
 * 仅用于本次讨论的附件：独立于项目附件表，不生成记忆卡，也不进入项目资料、检索、委托或成果。
 * 文字提取复用项目附件同一套 PDF/图片读取；图片识别按讨论所属项目计入云调用额度，没有所属项目时不调用云识别。
 */
export async function uploadConversationAttachment(actor: ConversationActor, conversationId: string,
  input: { fileName: string; mimeType: string; buffer: Buffer; projectId?: string }) {
  const conversation = await ownedConversation(actor, conversationId);
  // 图片识别要计入某个项目的云调用额度：项目讨论用所属项目，跨项目讨论用当前选中的项目；都没有时不识别。
  const quotaProjectId = conversation.homeProjectId ?? input.projectId ?? null;
  if (!conversation.homeProjectId && input.projectId) await assertProject(actor, input.projectId);
  const type = inferAndValidateFileType(input.fileName, input.mimeType, input.buffer);
  if (type !== "PDF" && type !== "IMAGE") throw new AppError("ATTACHMENT_TYPE_UNSUPPORTED", "讨论附件只支持 PDF 和图片", 422);
  const sha256 = computeFileSha256(input.buffer);
  const duplicate = await db.conversationAttachment.findFirst({ where: { conversationId, sha256 }, select: publicShape });
  if (duplicate) return { attachment: duplicate, isDuplicate: true };
  const count = await db.conversationAttachment.count({ where: { conversationId } });
  if (count >= CONVERSATION_ATTACHMENT_LIMIT) throw new AppError("CONVERSATION_ATTACHMENT_LIMIT", `每次讨论最多保留 ${CONVERSATION_ATTACHMENT_LIMIT} 个附件`, 409);
  const stored = await saveFileToStorage("conversation-" + conversationId, input.fileName, input.buffer);
  let extractedText = "", extractionStatus = "SUCCESS", extractionError: string | null = null;
  try {
    if (type === "PDF") extractedText = await extractPdfText(input.buffer) ?? "";
    else if (quotaProjectId) {
      const projectId = quotaProjectId;
      extractedText = await extractImageText(input.mimeType, input.buffer, () => reserveCloudCall(projectId)) ?? "";
    }
    if (!extractedText) { extractionStatus = "NEEDS_OCR"; extractionError = type === "PDF" ? "PDF 没有可可靠提取的文字" : (quotaProjectId ? "图片文字需要配置视觉识别服务" : "跨项目讨论未选择项目，图片文字没有识别"); }
  } catch (error) {
    extractionStatus = "FAILED"; extractionError = error instanceof Error ? error.message : "提取失败";
  }
  try {
    const result = await db.$transaction(async tx => {
      await lockConversation(tx, conversationId);
      await ownedConversation(actor, conversationId, tx);
      if (quotaProjectId) await assertProject(actor, quotaProjectId, tx);
      const existing = await tx.conversationAttachment.findFirst({ where: { conversationId, sha256 }, select: publicShape });
      if (existing) return { attachment: existing, isDuplicate: true };
      const currentCount = await tx.conversationAttachment.count({ where: { conversationId } });
      if (currentCount >= CONVERSATION_ATTACHMENT_LIMIT) throw new AppError("CONVERSATION_ATTACHMENT_LIMIT", `每次讨论最多保留 ${CONVERSATION_ATTACHMENT_LIMIT} 个附件`, 409);
      const attachment = await tx.conversationAttachment.create({ data: { conversationId, ownerUserId: actor.userId, type,
        storageKey: stored.storageKey, fileName: input.fileName, mimeType: input.mimeType, size: stored.size, sha256,
        extractedText: extractedText || null, extractionStatus, extractionError }, select: publicShape });
      return { attachment, isDuplicate: false };
    });
    if (result.isDuplicate) await deleteAttachmentFile(stored.storageKey).catch(() => undefined);
    return result;
  } catch (error) { await deleteAttachmentFile(stored.storageKey).catch(() => undefined); throw error; }
}

export async function listConversationAttachments(actor: ConversationActor, conversationId: string) {
  await ownedConversation(actor, conversationId);
  return db.conversationAttachment.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: publicShape });
}

async function ownedAttachment(actor: ConversationActor, conversationId: string, attachmentId: string) {
  await ownedConversation(actor, conversationId);
  const row = await db.conversationAttachment.findFirst({ where: { id: attachmentId, conversationId, ownerUserId: actor.userId } });
  if (!row) throw new AppError("ATTACHMENT_NOT_FOUND", "附件不存在或已移除", 404);
  return row;
}

export async function deleteConversationAttachment(actor: ConversationActor, conversationId: string, attachmentId: string) {
  const row = await ownedAttachment(actor, conversationId, attachmentId);
  await db.conversationAttachment.deleteMany({ where: { id: row.id, conversationId, ownerUserId: actor.userId } });
  await deleteAttachmentFile(row.storageKey).catch(() => undefined);
  return { deleted: true };
}

/** 转为项目资料：按项目附件原流程重新保存（会生成待核对的记忆卡），成功后才移除讨论里的副本。 */
export async function promoteConversationAttachment(actor: ConversationActor, conversationId: string, attachmentId: string, projectId: string) {
  const row = await ownedAttachment(actor, conversationId, attachmentId);
  await assertProject(actor, projectId);
  const buffer = await readAttachmentFile(row.storageKey);
  const result = await processAttachmentUpload({ projectId, fileName: row.fileName, mimeType: row.mimeType, buffer },
    { ...(row.extractedText !== null ? { extractedText: row.extractedText } : {}),
      beforeWrite: async tx => { await ownedConversation(actor, conversationId, tx); await assertProject(actor, projectId, tx); } });
  await db.conversationAttachment.deleteMany({ where: { id: row.id, conversationId, ownerUserId: actor.userId } });
  await deleteAttachmentFile(row.storageKey).catch(() => undefined);
  return { attachment: result.attachment, isDuplicate: result.isDuplicate, cardId: result.card?.id ?? null };
}

/** 本轮讨论引用的附件文字：只取本讨论的附件，按条截断；没有可读文字的附件只给文件名与状态。 */
export async function conversationAttachmentContext(conversationId: string, ownerUserId: string, ids: string[], totalLimit = TURN_TOTAL_TEXT_LIMIT) {
  if (!ids.length) return { text: "", names: [] as string[] };
  const rows = await db.conversationAttachment.findMany({ where: { id: { in: ids }, conversationId, ownerUserId }, orderBy: { createdAt: "asc" } });
  const perFile = Math.min(TURN_TEXT_LIMIT, Math.floor(totalLimit / Math.max(rows.length, 1)));
  const text = rows.map(row => row.extractedText
    ? `【本次讨论附件《${row.fileName}》提取文字${row.extractedText.length > perFile ? "（已截断）" : ""}】\n${row.extractedText.slice(0, perFile)}`
    : `【本次讨论附件《${row.fileName}》】文字暂未提取（${row.extractionError ?? "未知原因"}），不能据此下结论。`).join("\n\n");
  return { text, names: rows.map(row => row.fileName) };
}
