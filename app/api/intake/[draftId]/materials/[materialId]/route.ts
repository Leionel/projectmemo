import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { readIntakeMaterialText } from "@/lib/services/projectIntakeService";

export const runtime = "nodejs";

/**
 * 项目前原文核对：按页读取草稿里的原始正文。
 *
 * owner + 开放草稿才可读；确认后由项目内深读承接；撤回/到期/项目删除后不再返回副本。
 */
export async function GET(request: Request, { params }: { params: Promise<{ draftId: string; materialId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId, materialId } = await params;
    const url = new URL(request.url);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "4000");
    return Response.json(await readIntakeMaterialText({ userId: user.id, sessionId: session.id }, draftId, materialId,
      { offset: Number.isFinite(offset) ? offset : 0, limit: Number.isFinite(limit) ? limit : 4000 }),
      { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
