import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { proposeTemporalRelation } from "@/lib/services/temporalLedgerService";
import { temporalRelationProposalSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  try {
    const { id, cardId } = await params;
    await authorizeProjectAccess(request, id);
    const input = temporalRelationProposalSchema.parse(await request.json());
    return Response.json({ relation: await proposeTemporalRelation(id, cardId, input) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
