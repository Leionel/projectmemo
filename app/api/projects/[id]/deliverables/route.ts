import { apiError } from "@/lib/api";
import { listProjectDeliverables } from "@/lib/services/milestoneService";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ deliverables: await listProjectDeliverables(id) });
  } catch (error) {
    return apiError(error);
  }
}
