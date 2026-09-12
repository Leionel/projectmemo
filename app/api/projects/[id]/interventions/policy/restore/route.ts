import { apiError } from "@/lib/api";
import { restoreDefaultPolicy } from "@/lib/services/interventionPolicyService";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await params;
    // 恢复默认同时清空降频主题与建议状态，策略版本 +1，可再次调整
    const policy = await restoreDefaultPolicy();
    return Response.json({ version: policy.version, restored: true });
  } catch (error) {
    return apiError(error);
  }
}
