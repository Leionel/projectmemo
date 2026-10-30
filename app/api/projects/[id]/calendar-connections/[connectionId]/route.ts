import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { revokeCalendarConnection } from "@/lib/services/calendarConnectionService";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string; connectionId: string }> }) {
  try {
    const p = await params, { user } = await authorizeProjectAccess(request, p.id);
    return Response.json(await revokeCalendarConnection(user.id, p.id, p.connectionId, await request.json()), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
