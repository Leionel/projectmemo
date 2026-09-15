import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getDecisionTimeline } from "@/lib/services/temporalLedgerService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const rawAsOf = new URL(request.url).searchParams.get("asOf");
    return Response.json(await getDecisionTimeline(id, rawAsOf ? new Date(rawAsOf) : new Date()));
  } catch (error) {
    return apiError(error);
  }
}
