import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { listExperiences, refreshExperiences } from "@/lib/experience/service";

export const runtime = "nodejs";

/** GET 是纯读：不隐式同步、不调用模型、不写样本。 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    return Response.json(await listExperiences(user.id, id), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}

/** 显式整理：只有用户主动请求才重算当前证据。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    return Response.json(await refreshExperiences(user.id, id, await request.json()));
  } catch (e) {
    return apiError(e);
  }
}
