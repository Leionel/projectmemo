import { conversationHttp } from "@/lib/conversation/http";
import { openConversationEntry } from "@/lib/conversation/anchorService";
export const runtime = "nodejs";
export async function POST(request: Request) { return conversationHttp(request, async actor => openConversationEntry(actor, await request.json())); }
