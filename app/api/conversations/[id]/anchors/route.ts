import { conversationHttp } from "@/lib/conversation/http";
import { listConversationAnchors } from "@/lib/conversation/anchorService";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => listConversationAnchors(actor, (await context.params).id));
}
