import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { listProjectDeliverables } from "@/lib/services/milestoneService";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeProjectAccess(request, id);
    return Response.json({ deliverables: await listProjectDeliverables(id) });
  } catch (error) {
    return apiError(error);
  }
}
