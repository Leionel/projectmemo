import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getProjectReentry } from "@/lib/services/projectReentryService";

export const runtime = "nodejs";

/** App、桌面卡片与小艺共用的只读聚合；读取不产生业务写入 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const reentry = await getProjectReentry(id, user.id);
    return Response.json(reentry);
  } catch (error) {
    return apiError(error);
  }
}
