import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getCurrentSchedulePlan } from "@/lib/services/scheduleService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const plan = await getCurrentSchedulePlan(id);
    if (!plan) {
      return Response.json({ status: "EMPTY", plan: null });
    }
    return Response.json({ status: "OK", plan });
  } catch (error) {
    return apiError(error);
  }
}
