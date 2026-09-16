import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { evaluateProjectContext } from "@/lib/services/agentContextService";
import { evaluateContextSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user } = await authorizeProjectAccess(request, id);
    const input = evaluateContextSchema.parse(await request.json());
    return Response.json(await evaluateProjectContext(id, input, user.id));
  } catch (error) {
    return apiError(error);
  }
}
