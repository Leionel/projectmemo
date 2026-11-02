import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { createIntakeDraft } from "@/lib/services/projectIntakeService";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** 打开中的材料草稿：用于换页面/换端后恢复同一份预览，不产生新的业务对象。 */
export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const drafts = await db.projectIntakeDraft.findMany({
      where: { ownerUserId: user.id, status: { in: ["DRAFT", "PREVIEW_READY", "FAILED", "UNDERSTANDING"] }, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: "desc" }, take: 5,
      select: { id: true, status: true, revision: true, understandingState: true, expiresAt: true, updatedAt: true },
    });
    return Response.json({ drafts }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, session } = await authenticateUser(request);
    const result = await createIntakeDraft({ userId: user.id, sessionId: session.id }, await request.json());
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
