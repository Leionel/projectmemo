import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { updateProjectAction } from "@/lib/services/actionService";
import {
  applyReminderDispositionOnCompletion,
  type ReminderCompletionOutcome,
} from "@/lib/services/actionReminderService";
import { actionUpdateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; actionId: string }> };

/**
 * 更新行动。完成待办时可以同时说明如何处理已存在的未来日历提醒。
 *
 * 顺序有意如此：完成回执先提交（它已经是发生的事实），提醒处置随后独立写入。
 * 提醒处置失败不会回滚已完成的待办，而是通过 reminderOutcome.compensation
 * 明确告知用户「需要重新撤销提醒」，不制造假成功。
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, actionId } = await context.params;
    const { user } = await authorizeProjectAccess(request, id);
    const body = (await request.json()) as Record<string, unknown> | null;
    const input = actionUpdateSchema.parse(body);
    const action = await updateProjectAction(id, actionId, input);

    const rawDisposition = body?.reminderDisposition;
    const disposition = rawDisposition === "KEEP" || rawDisposition === "REMOVE" ? rawDisposition : null;
    let reminderOutcome: ReminderCompletionOutcome | null = null;

    if (disposition && input.status === "DONE") {
      const headerKey = request.headers.get("x-pm-device-key")?.trim() ?? "";
      const bodyKey = typeof body?.deviceKey === "string" ? body.deviceKey.trim() : "";
      if (headerKey || bodyKey) {
        reminderOutcome = await applyReminderDispositionOnCompletion(id, actionId, disposition, {
          userId: user.id,
          deviceKey: headerKey || bodyKey,
        });
      } else {
        reminderOutcome = {
          recorded: false,
          disposition,
          reminderId: null,
          devicePlan: [],
          compensation: {
            needed: true,
            message: "待办已完成，但没有收到设备标识，无法处理提醒。可以在待办详情里重新撤销提醒。",
            revokeUrl: null,
          },
        };
      }
    }

    return Response.json({ action, reminderOutcome });
  } catch (error) {
    return apiError(error);
  }
}
