import { apiError } from "@/lib/api";
import { getLatestProjectState } from "@/lib/services/projectStateService";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const snapshot = await getLatestProjectState(id);
    // 不隐式生成：没有快照就明确返回 EMPTY，由客户端显式刷新
    if (!snapshot) {
      return Response.json({ status: "EMPTY" });
    }
    return Response.json({ status: "OK", snapshot });
  } catch (error) {
    return apiError(error);
  }
}
