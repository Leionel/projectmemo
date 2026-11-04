import { conversationHttp } from "@/lib/conversation/http";
import { AppError } from "@/lib/api";
import { listConversationAttachments, uploadConversationAttachment } from "@/lib/services/conversationAttachmentService";
export const runtime = "nodejs";
const MAX_SIZE = 20 * 1024 * 1024;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => ({ attachments: await listConversationAttachments(actor, (await context.params).id) }));
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => {
    const form = await request.formData(), file = form.get("file"), projectId = form.get("projectId");
    if (!(file instanceof File)) throw new AppError("ATTACHMENT_REQUIRED", "请求中没有附件文件", 400);
    if (file.size > MAX_SIZE) throw new AppError("ATTACHMENT_TOO_LARGE", "附件不能超过 20MB", 400);
    return uploadConversationAttachment(actor, (await context.params).id,
      { fileName: file.name, mimeType: file.type || "application/octet-stream", buffer: Buffer.from(await file.arrayBuffer()),
        ...(typeof projectId === "string" && projectId ? { projectId } : {}) });
  });
}
