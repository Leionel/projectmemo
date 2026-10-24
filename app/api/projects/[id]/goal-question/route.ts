import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import {
  currentGoalQuestion,
  interactGoalQuestion,
} from "@/lib/decision/questions";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user, session } = await authorizeProjectAccess(request, id);
    return Response.json(
      await currentGoalQuestion({ userId: user.id, sessionId: session.id }, id),
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
    const { id } = await params;
    const { user, session } = await authorizeProjectAccess(request, id);
    return Response.json(
      await interactGoalQuestion(
        { userId: user.id, sessionId: session.id },
        id,
        await request.json(),
      ),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
