import { apiError, AppError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { addFileMaterial } from "@/lib/services/projectIntakeService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId } = await params;
    const form = await request.formData();
    const file = form.get("file");
    const requestId = String(form.get("requestId") ?? "").trim();
    if (!(file instanceof File)) throw new AppError("ATTACHMENT_REQUIRED", "请求中没有附件文件", 400);
    if (!requestId) throw new AppError("INVALID_REQUEST_ID", "缺少材料请求身份", 422);
    const buffer = Buffer.from(await file.arrayBuffer());
    return Response.json(await addFileMaterial({ userId: user.id, sessionId: session.id }, draftId,
      { fileName: file.name, mimeType: file.type || "application/octet-stream", buffer }, { requestId }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
