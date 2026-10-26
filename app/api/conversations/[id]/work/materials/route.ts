import { conversationHttp } from "@/lib/conversation/http";
import { assessConversationMaterials } from "@/lib/conversation/workService";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => assessConversationMaterials(actor, (await context.params).id, await request.json()));
}
