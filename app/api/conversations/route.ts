import { conversationHttp } from "@/lib/conversation/http";
import { createConversation, listConversations } from "@/lib/conversation/service";
export const runtime = "nodejs";
export async function GET(request: Request) { const q = new URL(request.url).searchParams; return conversationHttp(request, actor => listConversations(actor, q.get("projectId") ?? undefined, q.get("cursor") ?? undefined)); }
export async function POST(request: Request) { return conversationHttp(request, async actor => createConversation(actor, await request.json())); }
