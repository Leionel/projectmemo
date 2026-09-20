import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { previewProjectEpisode } from "@/lib/services/projectEpisodeService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const body = (await request.json()) as {
      windowStart?: string;
      windowEnd?: string;
      kind?: string;
      baseSnapshotId?: string | null;
      endSnapshotId?: string | null;
    };
    if (!body.windowStart || !body.windowEnd) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "windowStart 和 windowEnd 不能为空" } }, { status: 422 });
    }
    const result = await previewProjectEpisode(id, {
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      kind: body.kind,
      baseSnapshotId: body.baseSnapshotId ?? null,
      endSnapshotId: body.endSnapshotId ?? null,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
