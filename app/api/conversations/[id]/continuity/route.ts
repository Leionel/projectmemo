import { conversationHttp } from "@/lib/conversation/http";
import { readContinuity, openHandoffWork } from "@/lib/continuity/handoff";
import { submitDirective, previewDirective } from "@/lib/continuity/directiveService";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return conversationHttp(request, async actor => readContinuity(actor, (await context.params).id, new URL(request.url).searchParams.get("projectId") ?? undefined));
}
export async function POST(request: Request, context: Context) {
  return conversationHttp(request, async actor => {
    const { preview, openWork, ...body } = await request.json();
    if (openWork) return openHandoffWork(actor, (await context.params).id, openWork);
    return preview === true ? previewDirective(actor, (await context.params).id, body) : submitDirective(actor, (await context.params).id, body);
  });
}
