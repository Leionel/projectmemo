import { apiError } from "@/lib/api";
import { authenticateXiaoyiRequest } from "@/lib/xiaoyi/auth";
import { inspectProjectInputSchema } from "@/lib/xiaoyi/contracts";
import { inspectProjectFromXiaoyi } from "@/lib/xiaoyi/inspectProjectService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = inspectProjectInputSchema.parse(await request.json());
    const context = authenticateXiaoyiRequest(request, payload.request_id);
    const result = await inspectProjectFromXiaoyi({ projectId: context.projectId, requestId: context.requestId, payload });
    return Response.json(result.response, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
