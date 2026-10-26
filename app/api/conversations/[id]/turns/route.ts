import { conversationHttp } from "@/lib/conversation/http";
import { submitConversationTurn } from "@/lib/conversation/turnService";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{id: string}> }) { return conversationHttp(request, async actor => submitConversationTurn(actor, (await context.params).id, await request.json())); }
