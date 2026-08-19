import { apiError } from "@/lib/api";
import { deleteProject, getProjectDetail, updateProject } from "@/lib/repositories/projects";
import { projectUpdateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ project: await getProjectDetail(id) });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = projectUpdateSchema.parse(await request.json());
    return Response.json({ project: await updateProject(id, input) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteProject(id);
    return new Response(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
