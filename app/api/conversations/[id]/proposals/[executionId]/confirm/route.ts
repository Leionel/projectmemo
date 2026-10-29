import { conversationHttp } from "@/lib/conversation/http";
import { confirmConversationProposal } from "@/lib/conversation/missionCommands";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{id: string;executionId: string}> }) { return conversationHttp(request, async actor => { const p = await context.params; return confirmConversationProposal(actor, p.id, p.executionId, await request.json()); }); }
