import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import type { ConversationActor } from "@/lib/types/conversation";
export async function conversationHttp(request: Request, work: (actor: ConversationActor) => Promise<unknown>) {
  try {
    const { user, session } = await authenticateUser(request);
    return Response.json(await work({ userId: user.id, sessionId: session.id }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) { return apiError(error); }
}
