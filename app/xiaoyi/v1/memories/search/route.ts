import { apiError } from "@/lib/api";
import { authenticateXiaoyiRequest } from "@/lib/xiaoyi/auth";
import { queryMemoryInputSchema } from "@/lib/xiaoyi/contracts";
import { queryMemoryFromXiaoyi } from "@/lib/xiaoyi/queryMemoryService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = queryMemoryInputSchema.parse(await request.json());
    const context = authenticateXiaoyiRequest(request, payload.request_id);
    const result = await queryMemoryFromXiaoyi({ projectId: context.projectId, requestId: context.requestId, payload });
    return Response.json(result.response, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
