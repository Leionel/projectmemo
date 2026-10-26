import { conversationHttp } from "@/lib/conversation/http";
import { declineConversationAction } from "@/lib/conversation/commands";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{id: string;executionId: string}> }) { return conversationHttp(request, async actor => { const p = await context.params; return declineConversationAction(actor, p.id, p.executionId); }); }
