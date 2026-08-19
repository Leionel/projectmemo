import { apiError } from "@/lib/api";
import { listInterventions } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await requireProject(id);
    return Response.json({ interventions: await listInterventions(id) });
  } catch (error) {
    return apiError(error);
  }
}
