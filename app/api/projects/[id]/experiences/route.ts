import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { listExperiences } from "@/lib/experience/service";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authorizeProjectAccess(request, (await params).id);
    return Response.json(await listExperiences(user.id, (await params).id), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
