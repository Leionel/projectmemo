import { AppError, apiError } from "@/lib/api";
import { getProjectStateDiff } from "@/lib/services/projectStateService";
import { buildChangeBrief, buildFirstTimeBrief } from "@/lib/services/projectChangeBriefService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const searchParams = new URL(request.url).searchParams;
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    if (!to) {
      throw new AppError("MISSING_SNAPSHOT_ID", "缺少 to 快照 ID", 422);
    }
    // 首次查看：尚无已读基线（from 为空或与 to 相同）→ 明确说明这是第一份记录
    if (!from || from === to) {
      return Response.json({ status: "BASELINE", brief: buildFirstTimeBrief(to) });
    }
    const diff = await getProjectStateDiff(id, from, to);
    const brief = buildChangeBrief(diff);
    return Response.json({
      status: diff.materialChange ? "OK" : "NO_MATERIAL_CHANGE",
      brief,
    });
  } catch (error) {
    return apiError(error);
  }
}
