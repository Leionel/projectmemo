import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { listProjectDeletions } from "@/lib/services/projectDeletionService";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const { user } = await authenticateUser(request); return Response.json({ deletions: await listProjectDeletions(user.id) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return apiError(error); }
}
