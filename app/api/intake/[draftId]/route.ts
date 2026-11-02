import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { readIntake, withdrawIntake } from "@/lib/services/projectIntakeService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId } = await params;
    return Response.json(await readIntake({ userId: user.id, sessionId: session.id }, draftId),
      { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId } = await params;
    return Response.json(await withdrawIntake({ userId: user.id, sessionId: session.id }, draftId));
  } catch (error) {
    return apiError(error);
  }
}
