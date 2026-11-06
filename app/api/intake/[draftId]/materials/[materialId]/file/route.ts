import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { readIntakeMaterialFile } from "@/lib/services/projectIntakeService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ draftId: string; materialId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId, materialId } = await params;
    const file = await readIntakeMaterialFile({ userId: user.id, sessionId: session.id }, draftId, materialId);
    return new Response(new Uint8Array(file.data), { headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    return apiError(error);
  }
}
