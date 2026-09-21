import { z } from "zod";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {
  arrangeActionReminder,
  getActionReminderState,
  resolveReminderActor,
} from "@/lib/services/actionReminderService";

export const runtime = "nodejs";

const arrangeSchema = z.object({
  requestId: z.string().trim().min(1).max(120),
  reminderAt: z.string().trim().min(1),
  durationMinutes: z.number().int().optional(),
  timezone: z.string().trim().max(64).optional(),
  expectedRevision: z.number().int().positive().optional(),
  /** 设备标识；移动端也可以改用 x-pm-device-key 请求头 */
  deviceKey: z.string().trim().max(160).optional(),
});

type RouteContext = { params: Promise<{ id: string; actionId: string }> };

/**
 * 单条待办的提醒状态。
 * 只读，不产生业务写入；返回值区分「项目内计划时间」「设备日历事件」「待办完成」三件事。
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id, actionId } = await context.params;
    const { user } = await authorizeProjectAccess(request, id);
    const deviceKey = new URL(request.url).searchParams.get("deviceKey");
    const actor = resolveReminderActor(request, user.id, deviceKey);
    return Response.json({ state: await getActionReminderState(id, actionId, actor) });
  } catch (error) {
    return apiError(error);
  }
}

/** 安排或修改提醒。同 requestId 同载荷幂等重放，异载荷返回 409。 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id, actionId } = await context.params;
    const { user } = await authorizeProjectAccess(request, id);
    const input = arrangeSchema.parse(await request.json());
    const actor = resolveReminderActor(request, user.id, input.deviceKey);
    const result = await arrangeActionReminder(id, actionId, {
      requestId: input.requestId,
      reminderAt: input.reminderAt,
      durationMinutes: input.durationMinutes,
      timezone: input.timezone,
      expectedRevision: input.expectedRevision,
    }, actor);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
