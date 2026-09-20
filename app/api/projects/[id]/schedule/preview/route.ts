import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { previewSchedule } from "@/lib/services/scheduleService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const body = (await request.json()) as {
      requestId?: string;
      rangeStart?: string;
      rangeEnd?: string;
      timezone?: string;
      slots?: Array<{ start: string; end: string }>;
      actionIds?: string[];
      episodeRevisionId?: string;
      lockedBlocks?: Array<{ actionId?: string; title?: string; start: string; end: string }>;
    };
    if (!body.requestId || !body.rangeStart || !body.rangeEnd || !body.slots) {
      return Response.json({ error: { code: "VALIDATION_ERROR", message: "requestId、rangeStart、rangeEnd 和 slots 不能为空" } }, { status: 422 });
    }
    const plan = await previewSchedule(id, {
      requestId: body.requestId,
      rangeStart: body.rangeStart,
      rangeEnd: body.rangeEnd,
      timezone: body.timezone,
      slots: body.slots,
      actionIds: body.actionIds,
      episodeRevisionId: body.episodeRevisionId,
      lockedBlocks: body.lockedBlocks,
    }, { userId: user.id });
    return Response.json({ plan }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
