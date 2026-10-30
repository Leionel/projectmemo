import { conversationHttp } from "@/lib/conversation/http";
import { AppError } from "@/lib/api";
import { correctClaim, readClaimCorrections, resolveClaimText } from "@/lib/memory/claimService";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return conversationHttp(request, async actor => {
    const projectId = (await context.params).id, params = new URL(request.url).searchParams;
    return params.has("kind") && params.has("sourceId")
      ? resolveClaimText(actor, projectId, params.get("kind")!, params.get("sourceId")!)
      : readClaimCorrections(actor, projectId);
  });
}
export async function POST(request: Request, context: Context) {
  return conversationHttp(request, async actor => {
    const body = await request.json();
    if (body?.scope?.projectId !== (await context.params).id) throw new AppError("PROJECT_NOT_FOUND", "项目范围不匹配", 404);
    return correctClaim(actor, body);
  });
}
