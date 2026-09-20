import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { refreshProjectEpisode } from "@/lib/services/projectEpisodeService";

export const runtime = "nodejs";

/** 刷新生成新的 DRAFT revision，不覆盖旧版 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; episodeId: string }> }) {
  try {
    const { id, episodeId } = await params;
    await authorizeProjectAccess(request, id);
    const episode = await refreshProjectEpisode(id, episodeId);
    return Response.json({ episode });
  } catch (error) {
    return apiError(error);
  }
}
