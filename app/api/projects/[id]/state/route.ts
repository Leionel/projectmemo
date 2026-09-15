import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getLatestProjectState, getProjectStateFreshness } from "@/lib/services/projectStateService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const snapshot = await getLatestProjectState(id);
    const freshness = await getProjectStateFreshness(id);
    // 不隐式生成：没有快照就明确返回 EMPTY，由客户端显式刷新
    if (!snapshot) {
      return Response.json({ status: "EMPTY", snapshot: null, freshness });
    }
    return Response.json({ status: freshness.status === "FRESH" ? "OK" : "STALE", snapshot, freshness });
  } catch (error) {
    return apiError(error);
  }
}
