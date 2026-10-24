import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { actOnConnection } from "@/lib/sensing/repoSource";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; connectionId: string }> }) {
  try {
    const { id, connectionId } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    return Response.json(await actOnConnection(user.id, id, connectionId, await request.json()));
  } catch (e) {
    return apiError(e);
  }
}
