import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError, AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { readAttachmentFile } from "@/lib/storage/attachmentStorage";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const { id, attachmentId } = await params;
    await authorizeProjectAccess(request, id);
    const attachment = await db.attachment.findFirst({ where: { id: attachmentId, projectId: id } });
    if (!attachment) throw new AppError("NOT_FOUND", "附件不存在", 404);
    const data = await readAttachmentFile(attachment.storageKey).catch(() => null);
    if (!data) throw new AppError("NOT_FOUND", "附件原件暂时不可用", 404);
    return new Response(new Uint8Array(data), { headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    } });
  } catch (error) { return apiError(error); }
}
