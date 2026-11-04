import { conversationHttp } from "@/lib/conversation/http";
import { deleteConversationAttachment } from "@/lib/services/conversationAttachmentService";
export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; attachmentId: string }> }) {
  return conversationHttp(request, async actor => { const { id, attachmentId } = await context.params; return deleteConversationAttachment(actor, id, attachmentId); });
}
