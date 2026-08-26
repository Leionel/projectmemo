import { apiError } from "@/lib/api";
import { authenticateXiaoyiRequest } from "@/lib/xiaoyi/auth";
import { createActionInputSchema } from "@/lib/xiaoyi/contracts";
import { createActionFromXiaoyi } from "@/lib/xiaoyi/createActionService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = createActionInputSchema.parse(await request.json());
    const context = authenticateXiaoyiRequest(request, payload.request_id);
    const result = await createActionFromXiaoyi({ projectId: context.projectId, requestId: context.requestId, payload });
    return Response.json(result.response, { status: result.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
