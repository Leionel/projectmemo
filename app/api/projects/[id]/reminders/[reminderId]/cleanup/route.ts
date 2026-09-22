import { z } from "zod";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {
  confirmActionReminderCleanup,
  resolveReminderActor,
} from "@/lib/services/actionReminderService";

export const runtime = "nodejs";

const cleanupSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  deviceKey: z.string().trim().max(160).optional(),
});

/**
 * 设备已删除事件或查询确认事件不存在后，登记清理结果。
 * 服务端只有收到这个回执才清除 calendarEventId 并允许重新安排。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; reminderId: string }> },
) {
  try {
    const { id, reminderId } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const input = cleanupSchema.parse(await request.json());
    const actor = resolveReminderActor(request, user.id, input.deviceKey);
    const reminder = await confirmActionReminderCleanup(id, reminderId, { eventId: input.eventId }, actor);
    return Response.json({ reminder });
  } catch (error) {
    return apiError(error);
  }
}
