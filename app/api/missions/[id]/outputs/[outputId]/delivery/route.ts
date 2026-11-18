import { authenticateUser } from "@/lib/auth/guard";
import { AppError, apiError } from "@/lib/api";
import { readWorkbenchDelivery } from "@/lib/mission/workbenchDelivery";
import { readRevision } from "@/lib/types/workbench";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string; outputId: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    const { id, outputId } = await context.params;
    const query = new URL(request.url).searchParams;
    const revision = readRevision(query.get("revision"));
    if (!revision) throw new AppError("INVALID_VERSION", "请先选择有效的成果版本", 422);
    const delivery = await readWorkbenchDelivery(user.id, id, outputId, revision, readRevision(query.get("from")));
    return Response.json(delivery, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
