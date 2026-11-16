import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { readMissionWorkbench } from "@/lib/mission/workbenchService";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    return Response.json(await readMissionWorkbench(user.id, (await context.params).id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
