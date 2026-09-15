import { apiError, AppError } from "@/lib/api";
import { processCapture, processCaptureWithRequest } from "@/lib/services/captureService";
import { captureCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const input = captureCreateSchema.parse(await request.json());
    const headerRequestId = request.headers.get("idempotency-key")?.trim() ?? "";
    if (headerRequestId && input.requestId && headerRequestId !== input.requestId) {
      throw new AppError("IDEMPOTENCY_KEY_MISMATCH", "请求头与请求体的 requestId 不一致", 422);
    }
    const requestId = headerRequestId || input.requestId || "";
    if (!requestId) {
      return Response.json({ card: await processCapture(id, input.rawText, input.sourceType) }, { status: 201 });
    }
    const result = await processCaptureWithRequest(id, input.rawText, input.sourceType, { requestId });
    return Response.json({
      card: result.card,
      requestId,
      replayed: result.replayed,
      postProcessingPending: result.postProcessingPending,
      stateRefreshPending: result.stateRefreshPending,
      message: result.postProcessingPending
        ? "已保存，部分索引更新待重试"
        : result.stateRefreshPending
          ? "已保存，项目状态待刷新"
          : undefined,
    }, { status: result.replayed ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
