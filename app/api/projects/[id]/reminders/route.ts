import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { listActionReminders, resolveReminderActor } from "@/lib/services/actionReminderService";

export const runtime = "nodejs";

/**
 * 当前设备可见的提醒与设备日历日程。
 * 单条待办提醒回执与已确认排程写入的时段一起返回，避免两处各说一套状态。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const deviceKey = new URL(request.url).searchParams.get("deviceKey");
    const actor = resolveReminderActor(request, user.id, deviceKey);
    return Response.json(await listActionReminders(id, actor));
  } catch (error) {
    return apiError(error);
  }
}
