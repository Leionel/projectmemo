import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { confirmCopilotMission } from "@/lib/copilot/continuation";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, session } = await authorizeProjectAccess(request, id);
    return Response.json(
      {
        receipt: await confirmCopilotMission(id, await request.json(), {
          userId: user.id,
          sessionId: session.id,
        }),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
