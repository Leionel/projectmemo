import { apiError } from "@/lib/api";
import { updateIntervention } from "@/lib/repositories/agent";
import { interventionUpdateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; interventionId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, interventionId } = await context.params;
    const input = interventionUpdateSchema.parse(await request.json());
    return Response.json(await updateIntervention(id, interventionId, input));
  } catch (error) {
    return apiError(error);
  }
}
