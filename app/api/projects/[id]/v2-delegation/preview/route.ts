import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { previewV2Delegation } from "@/lib/mission/v2DelegationService";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    return Response.json(await previewV2Delegation(user.id, (await context.params).id, await request.json()), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
