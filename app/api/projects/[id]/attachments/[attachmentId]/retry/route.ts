import { NextResponse } from "next/server";
import { retryAttachmentExtraction } from "@/lib/services/attachmentService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const { id: projectId, attachmentId } = await params;
    const result = await retryAttachmentExtraction(projectId, attachmentId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment retry failed";
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 500 });
  }
}
