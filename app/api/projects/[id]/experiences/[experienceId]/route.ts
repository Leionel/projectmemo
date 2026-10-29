import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { actOnExperience } from "@/lib/experience/service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; experienceId: string }> }) {
  try {
    const { id, experienceId } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    return Response.json(await actOnExperience(user.id, id, experienceId, await request.json()));
  } catch (e) {
    return apiError(e);
  }
}
