import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { acknowledgeReentryBrief, readReentryBrief } from "@/lib/mission/reentryBrief";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    return Response.json(await readReentryBrief(user.id, (await context.params).id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    return Response.json(await acknowledgeReentryBrief(user.id, (await context.params).id, await request.json()),
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
