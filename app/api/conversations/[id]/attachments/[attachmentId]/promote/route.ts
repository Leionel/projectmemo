import { z } from "zod";
import { conversationHttp } from "@/lib/conversation/http";
import { promoteConversationAttachment } from "@/lib/services/conversationAttachmentService";
export const runtime = "nodejs";
const bodySchema = z.object({ projectId: z.string().min(1).max(64) }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  return conversationHttp(request, async actor => {
    const { id, attachmentId } = await context.params;
    return promoteConversationAttachment(actor, id, attachmentId, bodySchema.parse(await request.json()).projectId);
  });
}
