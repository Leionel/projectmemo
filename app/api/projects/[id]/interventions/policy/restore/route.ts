import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { restoreDefaultPolicy } from "@/lib/services/interventionPolicyService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    // 恢复默认同时清空降频主题与建议状态，策略版本 +1，可再次调整
    const policy = await restoreDefaultPolicy();
    return Response.json({ version: policy.version, restored: true });
  } catch (error) {
    return apiError(error);
  }
}
