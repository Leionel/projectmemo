import { db } from "@/lib/db";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { correctAttachmentText,correctMetricAttachmentText } from "@/lib/services/attachmentService";
import { z } from "zod";

const correctSchema = z.object({
  correctedText: z.string().trim().min(2, "校对文本不能为空且至少2个字符"),
  expectedCurrentText: z.string().optional().nullable(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const { id: projectId, attachmentId } = await params;
    await authorizeProjectAccess(request, projectId);
    const body = await request.json();
    const { correctedText, expectedCurrentText } = correctSchema.parse(body);
    const file=await db.attachment.findFirst({where:{id:attachmentId,projectId},select:{type:true}});
    const correct=file&&["CSV","JSON"].includes(file.type)?correctMetricAttachmentText:correctAttachmentText;
    const result = await correct(projectId, attachmentId, correctedText, expectedCurrentText);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment correction failed";
    const isNotFound = /not found|未找到/i.test(message);
    return NextResponse.json({ error: message }, { status: isNotFound ? 404 : 400 });
  }
}
