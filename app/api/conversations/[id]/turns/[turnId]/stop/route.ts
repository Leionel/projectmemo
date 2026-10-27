import { conversationHttp } from "@/lib/conversation/http";
import { stopConversationTurn } from "@/lib/conversation/turnService";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; turnId: string }> }) {
  return conversationHttp(request, async actor => { const p = await context.params; return stopConversationTurn(actor, p.id, p.turnId); });
}
