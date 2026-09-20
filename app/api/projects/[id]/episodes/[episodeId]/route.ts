import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getProjectEpisode } from "@/lib/services/projectEpisodeService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; episodeId: string }> }) {
  try {
    const { id, episodeId } = await params;
    await authorizeProjectAccess(request, id);
    const episode = await getProjectEpisode(id, episodeId);
    return Response.json({ episode });
  } catch (error) {
    return apiError(error);
  }
}
