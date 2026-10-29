import { conversationHttp } from "@/lib/conversation/http";
import { performConversationUIAction } from "@/lib/conversation/uiActions";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => performConversationUIAction(actor, (await context.params).id, await request.json()));
}
