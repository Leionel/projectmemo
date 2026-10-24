import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import {
  readScenario,
  adoptScenario,
  rejectScenario,
} from "@/lib/decision/scenarios";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, session } = await authenticateUser(request);
    return Response.json(
      {
        proposal: await readScenario(
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
    return Response.json({
      receipt: await adoptScenario(
        { userId: user.id, sessionId: session.id },
        (await params).id,
        await request.json(),
      ),
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, session } = await authenticateUser(request);
    return Response.json(
      await rejectScenario(
        { userId: user.id, sessionId: session.id },
        (await params).id,
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
