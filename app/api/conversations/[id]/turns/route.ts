import { conversationHttp } from "@/lib/conversation/http";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { isFeatureEnabled } from "@/lib/config/features";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{id: string}> }) { return conversationHttp(request, async actor => submitConversationTurn(actor, (await context.params).id, await request.json(), undefined,
  { defer: isFeatureEnabled("FOCUS_ASYNC_ENABLED", isFeatureEnabled("FOCUS_WEB_ENABLED", false)) })); }
