import { conversationHttp } from "@/lib/conversation/http";
import { readConversationWork, previewConversationWork } from "@/lib/conversation/workService";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => {
    const q = new URL(request.url).searchParams;
    return readConversationWork(actor, (await context.params).id, { kind: q.get("kind"), id: q.get("id"), projectId: q.get("projectId") });
  });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => previewConversationWork(actor, (await context.params).id, await request.json()));
}
