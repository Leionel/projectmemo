import { authorizeProjectAccess } from "@/lib/auth/guard";
import { NextResponse } from "next/server";
import { retryAttachmentExtraction } from "@/lib/services/attachmentService";
import { apiError } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const { id: projectId, attachmentId } = await params;
    await authorizeProjectAccess(request, projectId);
    const result = await retryAttachmentExtraction(projectId, attachmentId);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
