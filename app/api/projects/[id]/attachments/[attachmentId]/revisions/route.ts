import { authorizeProjectAccess } from "@/lib/auth/guard";
import { AppError, apiError } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  try {
    const { id, attachmentId } = await params;
    await authorizeProjectAccess(request, id);
    const attachment = await db.attachment.findFirst({ where: { id: attachmentId, projectId: id } });
    if (!attachment) {
      throw new AppError("NOT_FOUND", "附件不存在或不属于当前项目", 404);
    }
    const revisions = await db.attachmentRevision.findMany({
      where: { attachmentId },
      orderBy: { revisionIndex: "asc" },
    });
    return Response.json({
      revisions: revisions.map((revision) => ({
        revisionIndex: revision.revisionIndex,
        source: revision.source,
        text: revision.text,
        createdAt: revision.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
