import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { createOrReuseAction, listActions } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";
import { actionCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeProjectAccess(request, id);
    await requireProject(id);
    return Response.json({ actions: await listActions(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeProjectAccess(request, id);
    const input = actionCreateSchema.parse(await request.json());
    const result = await createOrReuseAction(id, input);
    return Response.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
