import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { syncIntakeMaterials } from "@/lib/services/projectIntakeService";

export const runtime = "nodejs";

/** 建项之后的第二阶段：逐份记录材料进入项目的真实状态，可重复调用。 */
export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId } = await params;
    return Response.json(await syncIntakeMaterials({ userId: user.id, sessionId: session.id }, draftId));
  } catch (error) {
    return apiError(error);
  }
}
