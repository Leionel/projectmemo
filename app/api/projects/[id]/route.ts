import { apiError } from "@/lib/api";
import { authenticateUser, authorizeProjectAccess } from "@/lib/auth/guard";
import { getProjectDetail, updateProject } from "@/lib/repositories/projects";
import { requestProjectDeletion } from "@/lib/services/projectDeletionService";
import { projectUpdateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeProjectAccess(request, id);
    return Response.json({ project: await getProjectDetail(id) });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await authorizeProjectAccess(request, id);
    const input = projectUpdateSchema.parse(await request.json());
    return Response.json({ project: await updateProject(id, input) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { user, session } = await authenticateUser(request);
    const deletion = await requestProjectDeletion(user.id, id, request.headers.get("x-project-delete-confirmation") ?? "", request.headers.get("if-match") ?? "", session.id);
    return Response.json({ deletion }, { status: deletion.status === "COMPLETED" ? 200 : 202 });
  } catch (error) { return apiError(error); }
}
