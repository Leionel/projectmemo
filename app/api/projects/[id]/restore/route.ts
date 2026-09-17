import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { restoreProject } from "@/lib/repositories/projects";

export const runtime = "nodejs";

/**
 * 恢复已归档项目。幂等：未归档的项目调用后仍为未归档。
 * 归档期间被隐藏的数据从未被改动，因此恢复不需要补偿写入。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeProjectAccess(request, id);
    const project = await restoreProject(id);
    return Response.json({
      project: { id: project.id, archivedAt: project.archivedAt?.toISOString() ?? null },
    });
  } catch (error) {
    return apiError(error);
  }
}