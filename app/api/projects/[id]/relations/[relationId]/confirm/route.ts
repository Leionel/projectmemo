import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { confirmRelation } from "@/lib/services/temporalLedgerService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; relationId: string }> }) {
  try {
    const { id, relationId } = await params;
    await authorizeProjectAccess(request, id);
    return Response.json({ relation: await confirmRelation(id, relationId) });
  } catch (error) {
    return apiError(error);
  }
}
