import { apiError } from "@/lib/api";
import { createMeetingImpactPreview } from "@/lib/services/meetingStateDiffService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { text?: string; meetingDate?: string; baseSnapshotId?: string };
    return Response.json(await createMeetingImpactPreview(id, {
      text: body.text ?? "",
      meetingDate: body.meetingDate ?? null,
      baseSnapshotId: body.baseSnapshotId ?? null,
    }));
  } catch (error) {
    return apiError(error);
  }
}
