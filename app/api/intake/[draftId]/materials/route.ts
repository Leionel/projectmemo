import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { addTextMaterial } from "@/lib/services/projectIntakeService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    const { draftId } = await params;
    return Response.json(await addTextMaterial({ userId: user.id, sessionId: session.id }, draftId, await request.json()), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
