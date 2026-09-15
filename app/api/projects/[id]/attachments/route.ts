import { authorizeProjectAccess } from "@/lib/auth/guard";
import { NextRequest, NextResponse } from "next/server";
import { listProjectAttachments, processAttachmentUpload } from "@/lib/services/attachmentService";
import { requireProject } from "@/lib/repositories/projects";
import { apiError, AppError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await authorizeProjectAccess(request, projectId);
    await requireProject(projectId);
    const attachments = await listProjectAttachments(projectId);
    return NextResponse.json(attachments);
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    await authorizeProjectAccess(request, projectId);
    await requireProject(projectId);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return apiError(new AppError("ATTACHMENT_REQUIRED", "请求中没有附件文件", 400));
    }

    // 限制单文件最大 20MB
    const MAX_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return apiError(new AppError("ATTACHMENT_TOO_LARGE", "附件不能超过 20MB", 400));
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
    if (error instanceof Error && /empty|20MB|only PDF|valid PDF|supported image|does not match/i.test(error.message)) {
      return apiError(new AppError("ATTACHMENT_INVALID", error.message, 400));
    }
    return apiError(error);
  }
}
