import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getLatestProjectState, getProjectStateCursor, getProjectStateFreshness } from "@/lib/services/projectStateService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    // 已读游标按 consumerKey 归属：客户端据此算「自上次查看以来」的变化，不在本地另存一份基线
    const consumerKey = new URL(request.url).searchParams.get("consumerKey")?.trim() ?? "";
    const cursor = consumerKey ? await getProjectStateCursor(id, consumerKey) : null;
    const lastSeenSnapshotId = cursor?.lastSeenSnapshotId ?? null;
    const snapshot = await getLatestProjectState(id);
    const freshness = await getProjectStateFreshness(id);
    // 不隐式生成：没有快照就明确返回 EMPTY，由客户端显式刷新
    if (!snapshot) {
      return Response.json({ status: "EMPTY", snapshot: null, freshness, lastSeenSnapshotId });
    }
    return Response.json({ status: freshness.status === "FRESH" ? "OK" : "STALE", snapshot, freshness, lastSeenSnapshotId });
  } catch (error) {
    return apiError(error);
  }
}
