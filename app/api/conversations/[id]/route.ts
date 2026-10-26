import { z } from "zod";
import { conversationHttp } from "@/lib/conversation/http";
import { readConversation } from "@/lib/conversation/service";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{id: string}> }) { return conversationHttp(request, async actor => { const q = new URL(request.url).searchParams.get("beforeSeq"); return readConversation(actor, (await context.params).id, q ? z.coerce.number().int().positive().parse(q) : undefined); }); }
