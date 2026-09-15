import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { updateProjectAction } from "@/lib/services/actionService";
import { actionUpdateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; actionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, actionId } = await context.params;
    await authorizeProjectAccess(request, id);
    const input = actionUpdateSchema.parse(await request.json());
    return Response.json({ action: await updateProjectAction(id, actionId, input) });
  } catch (error) {
    return apiError(error);
  }
}
