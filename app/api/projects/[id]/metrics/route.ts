import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getProjectMetrics } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeProjectAccess(request, id);
    await requireProject(id);
    return Response.json({ metrics: await getProjectMetrics(id) });
  } catch (error) {
    return apiError(error);
  }
}
