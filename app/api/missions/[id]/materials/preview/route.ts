import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { previewMissionMaterial } from "@/lib/mission/materialService";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    const value = await previewMissionMaterial(user.id, (await context.params).id, await request.json());
    return Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
