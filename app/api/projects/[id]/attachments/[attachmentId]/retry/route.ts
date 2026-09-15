import { authorizeProjectAccess } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { retryAttachmentExtraction } from "@/lib/services/attachmentService";

export async function POST(request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const { id: projectId, attachmentId } = await params;
    await authorizeProjectAccess(request, projectId);
    const result = await retryAttachmentExtraction(projectId, attachmentId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment retry failed";
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 500 });
  }
}
