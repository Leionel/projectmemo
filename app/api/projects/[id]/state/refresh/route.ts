import { apiError } from "@/lib/api";
import { refreshProjectState } from "@/lib/services/projectStateService";

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
    });
  } catch (error) {
    return apiError(error);
  }
}
