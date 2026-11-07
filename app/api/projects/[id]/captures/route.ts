import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError, AppError } from "@/lib/api";
import { processCapture, processCaptureWithRequest } from "@/lib/services/captureService";
import { captureCreateSchema } from "@/lib/validation/schemas";
import { suggestFromExpression } from "@/lib/memory/personalExpression";

export const runtime = "nodejs";

/** 只看随手记录：论文笔记、实验记录、报错这类多是摘录，不代表用户本人的习惯。 */
async function suggestFromCapture(userId: string, projectId: string, text: string, sourceType?: string | null) {
  if (sourceType && sourceType !== "随手记录") return;
  await suggestFromExpression(userId, text, { via: "CAPTURE", projectId });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const access = await authorizeProjectAccess(request, id);
    const input = captureCreateSchema.parse(await request.json());
    const headerRequestId = request.headers.get("idempotency-key")?.trim() ?? "";
    if (headerRequestId && input.requestId && headerRequestId !== input.requestId) {
      throw new AppError("IDEMPOTENCY_KEY_MISMATCH", "请求头与请求体的 requestId 不一致", 422);
    }
    const requestId = headerRequestId || input.requestId || "";
    if (!requestId) {
      const card = await processCapture(id, input.rawText, input.sourceType);
      await suggestFromCapture(access.user.id, id, input.rawText, input.sourceType);
      return Response.json({ card }, { status: 201 });
    }
    const result = await processCaptureWithRequest(id, input.rawText, input.sourceType, { requestId });
    if (!result.replayed) await suggestFromCapture(access.user.id, id, input.rawText, input.sourceType);
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
