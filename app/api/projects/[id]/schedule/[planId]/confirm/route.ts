import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { cancelSchedulePlan, confirmSchedulePlan } from "@/lib/services/scheduleService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; planId: string }> }) {
  try {
    const { id, planId } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const body = (await request.json()) as { requestId?: string; expectedVersion?: number; action?: string };
    if (body.action === "cancel") {
      const plan = await cancelSchedulePlan(id, planId);
      return Response.json({ plan });
    }
    if (!body.requestId) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "requestId 不能为空" } }, { status: 422 });
    }
    const plan = await confirmSchedulePlan(id, planId, {
      requestId: body.requestId,
      expectedVersion: body.expectedVersion,
    }, { userId: user.id });
    return Response.json({ plan });
  } catch (error) {
    return apiError(error);
  }
}
