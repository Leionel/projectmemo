import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { readMissionWorkbench } from "@/lib/mission/workbenchService";
import { readRevision } from "@/lib/types/workbench";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    const query = new URL(request.url).searchParams;
    return Response.json(await readMissionWorkbench(user.id, (await context.params).id, {
      revision: readRevision(query.get("revision")), baseline: readRevision(query.get("from")),
    }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
