import { conversationHttp } from "@/lib/conversation/http";
import { readConversation } from "@/lib/conversation/service";
export const runtime = "nodejs";
/** Rebuild the projection from original receipts; never repeat a business command or model call. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => ({ conversation: await readConversation(actor, (await context.params).id) }));
}
