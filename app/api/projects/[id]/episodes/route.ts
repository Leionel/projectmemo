import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { listProjectEpisodes } from "@/lib/services/projectEpisodeService";

export const runtime = "nodejs";

/** 列表读取不生成新 revision；过期状态只随读取重评并回写展示状态 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const episodes = await listProjectEpisodes(id);
    return Response.json({ episodes });
  } catch (error) {
    return apiError(error);
  }
}
