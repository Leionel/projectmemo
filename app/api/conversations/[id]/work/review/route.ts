import { conversationHttp } from "@/lib/conversation/http";
import { readConversationReviews, submitConversationReview } from "@/lib/conversation/reviewService";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => {
    const query = new URL(request.url).searchParams;
    return readConversationReviews(actor, (await context.params).id, { kind: "MISSION", id: query.get("id") ?? query.get("missionId"), projectId: query.get("projectId") });
  });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => submitConversationReview(actor, (await context.params).id, await request.json()));
}
