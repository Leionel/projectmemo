import { z } from "zod";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { recordActionReminderSync, resolveReminderActor } from "@/lib/services/actionReminderService";

export const runtime = "nodejs";

const receiptSchema = z.object({
  status: z.enum(["PENDING", "SYNCED", "FAILED", "PERMISSION_DENIED", "MISSING", "UNSUPPORTED"]),
  calendarId: z.string().trim().max(200).nullable().optional(),
  eventId: z.string().trim().max(200).nullable().optional(),
  error: z.string().trim().max(500).nullable().optional(),
  deviceKey: z.string().trim().max(160).optional(),
});

/**
 * 登记设备侧写入结果。
 * 没有真实 eventId 不允许标记为已写入：设备日历写入成功必须以事件编号为证。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; reminderId: string }> },
) {
  try {
    const { id, reminderId } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const input = receiptSchema.parse(await request.json());
    const actor = resolveReminderActor(request, user.id, input.deviceKey);
    const reminder = await recordActionReminderSync(id, reminderId, {
      status: input.status,
      calendarId: input.calendarId ?? null,
      eventId: input.eventId ?? null,
      error: input.error ?? null,
    }, actor);
    return Response.json({ reminder });
  } catch (error) {
    return apiError(error);
  }
}
