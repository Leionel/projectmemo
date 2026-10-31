import { conversationHttp } from "@/lib/conversation/http";
import { createConversationCalendarProposal } from "@/lib/conversation/calendarProposalService";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => {
    const p = await context.params;
    return createConversationCalendarProposal(actor, p.id, await request.json());
  });
}
