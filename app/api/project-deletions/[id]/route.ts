import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { projectDeletionStatus } from "@/lib/services/projectDeletionService";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    return Response.json({ deletion: await projectDeletionStatus(user.id, (await context.params).id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
