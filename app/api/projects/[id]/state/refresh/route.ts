import { apiError, AppError } from "@/lib/api";
import { getLatestProjectState, getProjectStateFreshness, refreshProjectState } from "@/lib/services/projectStateService";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await refreshProjectState(id);
    return Response.json({
      status: result.baselineCreated ? "BASELINE_CREATED" : "OK",
      snapshot: result.snapshot,
      changed: result.changed,
      reused: result.reused,
      freshness: result.freshness,
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "STATE_REFRESH_FAILED") {
      const { id } = await params;
      return Response.json({
        status: "STALE",
        snapshot: await getLatestProjectState(id),
        freshness: await getProjectStateFreshness(id),
        error: { code: error.code, message: error.message },
      });
    }
    return apiError(error);
  }
}
