import { NextResponse } from "next/server";
import { correctAttachmentText } from "@/lib/services/attachmentService";
import { z } from "zod";

const correctSchema = z.object({
  correctedText: z.string().trim().min(2, "校对文本不能为空且至少2个字符"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const { id: projectId, attachmentId } = await params;
    const body = await request.json();
    const { correctedText } = correctSchema.parse(body);
    const result = await correctAttachmentText(projectId, attachmentId, correctedText);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment correction failed";
    const isNotFound = /not found|未找到/i.test(message);
    return NextResponse.json({ error: message }, { status: isNotFound ? 404 : 400 });
  }
}
