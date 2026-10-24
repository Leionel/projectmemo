import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { actOnSignal } from "@/lib/sensing/repoSource";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; signalId: string }> }) {
  try {
    const { id, signalId } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    return Response.json(await actOnSignal(user.id, id, signalId, await request.json()));
  } catch (e) {
    return apiError(e);
  }
}
