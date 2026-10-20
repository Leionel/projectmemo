import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError, AppError } from "@/lib/api";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; revisionId: string }> }) {
  try {
    const { id, revisionId } = await params;
    await authorizeProjectAccess(request, id);
    const revision = await db.attachmentRevision.findFirst({ where: { id: revisionId, attachment: { projectId: id } } });
    if (!revision) throw new AppError("NOT_FOUND", "附件修订不存在", 404);
    return Response.redirect(new URL(`/projects/${id}#attachment-${revision.attachmentId}`, request.url));
  } catch (error) { return apiError(error); }
}
