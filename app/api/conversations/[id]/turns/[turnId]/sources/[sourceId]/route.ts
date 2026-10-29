import { conversationHttp } from "@/lib/conversation/http";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { ownedConversation, record } from "@/lib/conversation/repository";
import { validateWebSource } from "@/lib/conversation/researchScope";
import type { ConversationSource } from "@/lib/types/conversation";
import { readConversationDocumentSource } from "@/lib/conversation/documentSource";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string; turnId: string; sourceId: string }> }) {
  return conversationHttp(request, async actor => {
    const p = await context.params; await ownedConversation(actor, p.id);
    if(p.sourceId.startsWith("doc:"))return {source:await readConversationDocumentSource(actor,p.id,p.turnId,p.sourceId)};
    const turn = await db.conversationTurn.findFirst({ where: { id: p.turnId, conversationId: p.id } });
    const source = ((record(turn?.readManifestJson).webSources ?? []) as ConversationSource[]).find(s => s.sourceId === p.sourceId);
    if (!source) throw new AppError("SOURCE_NOT_FOUND", "该来源不属于当前讨论", 404);
    await validateWebSource(actor, source); return { source };
  });
}
