import { z } from "zod";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { resolveReminderActor, revokeActionReminder } from "@/lib/services/actionReminderService";

export const runtime = "nodejs";

const revokeSchema = z.object({
  deviceKey: z.string().trim().max(160).optional(),
  /** 一次用户意图一个 requestId；超时重试沿用同一个，服务端据此稳定重放 */
  requestId: z.string().trim().min(1).max(120).optional(),
}).optional();

/**
 * 撤销提醒。可安全重试：只针对回执里记录过的 eventId 生成删除指令，
 * 不会按标题模糊删除，也不会碰到用户自己在系统日历里创建的日程。
 * 幂等由不可变请求回执保证（同 ID 同载荷重放、异载荷 409）。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; reminderId: string }> },
) {
  try {
    const { id, reminderId } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const raw = await request.text();
    const input = raw.trim().length > 0 ? revokeSchema.parse(JSON.parse(raw)) : undefined;
    const actor = resolveReminderActor(request, user.id, input?.deviceKey);
    return Response.json(await revokeActionReminder(id, reminderId, actor, { requestId: input?.requestId }));
  } catch (error) {
    return apiError(error);
  }
}
