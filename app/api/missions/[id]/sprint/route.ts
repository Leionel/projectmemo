import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { readProjectSprint, commandProjectSprint } from "@/lib/mission/sprintService";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try { const { user } = await authenticateUser(request), { id } = await context.params;
    return Response.json(await readProjectSprint(user.id, id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try { const { user } = await authenticateUser(request), { id } = await context.params;
    return Response.json(await commandProjectSprint(user.id, id, await request.json()), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
