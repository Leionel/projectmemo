import { authorizeProjectAccess } from "@/lib/auth/guard";
import { AppError, apiError } from "@/lib/api";
import { assessActionFeasibility, updateActionFeasibilityInput } from "@/lib/services/actionFeasibilityService";
import { actionFeasibilitySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const actionId = new URL(request.url).searchParams.get("actionId") ?? "";
    if (!actionId) {
      throw new AppError("MISSING_ACTION_ID", "缺少 actionId", 422);
    }
    return Response.json(await assessActionFeasibility(id, actionId));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const input = actionFeasibilitySchema.parse(await request.json());
    return Response.json(await updateActionFeasibilityInput(id, input));
  } catch (error) {
    return apiError(error);
  }
}
