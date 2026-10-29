import { conversationHttp } from "@/lib/conversation/http";
import { readResearchScope, updateResearchScope } from "@/lib/conversation/researchScope";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => readResearchScope(actor, (await context.params).id));
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return conversationHttp(request, async actor => updateResearchScope(actor, (await context.params).id, await request.json()));
}
