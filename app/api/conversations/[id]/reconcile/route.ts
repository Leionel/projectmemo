import { conversationHttp } from "@/lib/conversation/http";
import { syncConversationAnchors } from "@/lib/conversation/anchorService";
export const runtime = "nodejs";
/** Rebuild the projection from original receipts; never repeat a business command or model call. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => syncConversationAnchors(actor, (await context.params).id));
}
