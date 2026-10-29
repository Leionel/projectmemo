import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { createScenarios, latestScenario } from "@/lib/decision/scenarios";
import { createDynamicReview } from "@/lib/decision/dynamicCandidates";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, session } = await authenticateUser(request);
    return Response.json(
      {
        proposal: await latestScenario(
          { userId: user.id, sessionId: session.id },
          (await params).id,
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, session } = await authenticateUser(request);
    const { id } = await params;
    const raw = await request.json();
    if (raw && raw.purpose === "DYNAMIC_PLAN") {
      const { purpose: _purpose, ...input } = raw;
      void _purpose;
      return Response.json({ proposal: await createDynamicReview({ userId: user.id, sessionId: session.id }, id, input) }, { headers: { "cache-control": "private, no-store" } });
    }
    return Response.json(
      {
        proposal: await createScenarios(
          { userId: user.id, sessionId: session.id },
          id,
          raw,
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
