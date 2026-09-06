import { apiError } from "@/lib/api";
import { revokeRelation } from "@/lib/services/temporalLedgerService";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string; relationId: string }> }) {
  try {
    const { id, relationId } = await params;
    return Response.json({ relation: await revokeRelation(id, relationId) });
  } catch (error) {
    return apiError(error);
  }
}
