import { NextRequest, NextResponse } from "next/server";
import { listProjectAttachments, processAttachmentUpload } from "@/lib/services/attachmentService";
import { requireProject } from "@/lib/repositories/projects";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await requireProject(projectId);
    const attachments = await listProjectAttachments(projectId);
    return NextResponse.json(attachments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load attachments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await requireProject(projectId);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided in form-data" }, { status: 400 });
    }

    // 限制单文件最大 20MB
    const MAX_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File size exceeds 20MB limit" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await processAttachmentUpload({
      projectId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      buffer,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Attachment upload failed";
    const isClientError = /empty|20MB|only PDF|valid PDF|supported image|does not match/i.test(message);
    return NextResponse.json({ error: message }, { status: isClientError ? 400 : 500 });
  }
}
