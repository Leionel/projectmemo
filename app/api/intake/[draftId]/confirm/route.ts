import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { confirmIntake } from "@/lib/services/projectIntakeService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId } = await params;
    const body = await request.json();
    const header = request.headers.get("Idempotency-Key")?.trim();
    if (header && body?.requestId && header !== body.requestId)
      return Response.json({ error: { code: "IDEMPOTENCY_KEY_MISMATCH", message: "请求头与请求体的 requestId 不一致" } }, { status: 422 });
    const result = await confirmIntake({ userId: user.id, sessionId: session.id }, draftId,
      header ? { ...body, requestId: header } : body);
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
