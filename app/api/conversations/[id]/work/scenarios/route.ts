import { conversationHttp } from "@/lib/conversation/http";
import { compareConversationScenarios } from "@/lib/conversation/workService";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => compareConversationScenarios(actor, (await context.params).id, await request.json()));
}
