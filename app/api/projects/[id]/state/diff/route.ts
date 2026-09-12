import { apiError } from "@/lib/api";
import { getProjectStateDiff } from "@/lib/services/projectStateService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const searchParams = new URL(request.url).searchParams;
    const from = searchParams.get("from") ?? "";
    const to = searchParams.get("to") ?? "";
    if (!from || !to) {
      return Response.json({ error: "MISSING_SNAPSHOT_IDS", message: "缺少 from/to 快照 ID" }, { status: 422 });
    }
    const diff = await getProjectStateDiff(id, from, to);
    return Response.json({
      status: diff.materialChange ? "OK" : "NO_MATERIAL_CHANGE",
      diff,
    });
  } catch (error) {
    return apiError(error);
  }
}
