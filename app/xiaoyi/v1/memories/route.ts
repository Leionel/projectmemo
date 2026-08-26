import { apiError } from "@/lib/api";
import { authenticateXiaoyiRequest } from "@/lib/xiaoyi/auth";
import { recordMemoryInputSchema } from "@/lib/xiaoyi/contracts";
import { recordMemoryFromXiaoyi } from "@/lib/xiaoyi/recordMemoryService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = recordMemoryInputSchema.parse(await request.json());
    const context = authenticateXiaoyiRequest(request, payload.request_id);
    const result = await recordMemoryFromXiaoyi({
      projectId: context.projectId,
      requestId: context.requestId,
      payload,
    });
    return Response.json(result.response, {
      status: result.status,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
