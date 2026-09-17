import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { archiveProject } from "@/lib/repositories/projects";

export const runtime = "nodejs";

/**
 * 归档项目。幂等：重复归档不刷新 archivedAt，也不改变任何业务事实。
 * 归档项目仍可按 id 读取——它只是离开主列表，不是被隐藏或删除。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeProjectAccess(request, id);
    const project = await archiveProject(id);
    return Response.json({
      project: { id: project.id, archivedAt: project.archivedAt?.toISOString() ?? null },
    });
  } catch (error) {
    return apiError(error);
  }
}