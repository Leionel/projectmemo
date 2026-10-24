import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { createScenarios, latestScenario } from "@/lib/decision/scenarios";
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
    return Response.json(
      {
        proposal: await createScenarios(
          { userId: user.id, sessionId: session.id },
          id,
          await request.json(),
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
