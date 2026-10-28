import { conversationHttp } from "@/lib/conversation/http";
import { adoptResearchSummary } from "@/lib/conversation/researchSummary";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; messageId: string }> }) {
  return conversationHttp(request, async actor => { const p = await context.params; return adoptResearchSummary(actor, p.id, p.messageId, await request.json()); });
}
