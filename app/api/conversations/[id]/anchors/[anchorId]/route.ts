import { conversationHttp } from "@/lib/conversation/http";
import { commandConversationAnchor } from "@/lib/conversation/anchorService";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; anchorId: string }> }) {
  return conversationHttp(request, async actor => { const p = await context.params; return commandConversationAnchor(actor, p.id, p.anchorId, await request.json()); });
}
