import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { confirmEpisodeRevision } from "@/lib/services/projectEpisodeService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; episodeId: string }> }) {
  try {
    const { id, episodeId } = await params;
    await authorizeProjectAccess(request, id);
    const body = (await request.json()) as { revision?: number; requestId?: string; expectedSourceHash?: string };
    if (typeof body.revision !== "number" || !body.requestId) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "revision 和 requestId 不能为空" } }, { status: 422 });
    }
    const episode = await confirmEpisodeRevision(id, episodeId, {
      revision: body.revision,
      requestId: body.requestId,
      expectedSourceHash: body.expectedSourceHash,
    });
    return Response.json({ episode });
  } catch (error) {
    return apiError(error);
  }
}
