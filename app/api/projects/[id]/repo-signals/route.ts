import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { createConnection, listSignals } from "@/lib/sensing/repoSource";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authorizeProjectAccess(request, (await params).id);
    return Response.json(await listSignals(user.id, (await params).id), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authorizeProjectAccess(request, (await params).id);
    return Response.json(await createConnection(user.id, (await params).id, await request.json()), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
