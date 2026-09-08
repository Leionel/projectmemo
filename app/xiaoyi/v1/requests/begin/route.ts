import { apiError } from "@/lib/api";
import { authenticateXiaoyiBearerRequest } from "@/lib/xiaoyi/auth";
import { beginRequestInputSchema } from "@/lib/xiaoyi/contracts";
import { issueXiaoyiRequest } from "@/lib/xiaoyi/beginRequestService";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    beginRequestInputSchema.parse(rawBody.trim() ? JSON.parse(rawBody) : {});
    authenticateXiaoyiBearerRequest(request);
    return Response.json(issueXiaoyiRequest(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
