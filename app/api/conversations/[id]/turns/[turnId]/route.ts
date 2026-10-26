import { conversationHttp } from "@/lib/conversation/http";
import { readConversationTurn } from "@/lib/conversation/turnService";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{id: string;turnId: string}> }) { return conversationHttp(request, async actor => { const p = await context.params; return readConversationTurn(actor, p.id, p.turnId); }); }
