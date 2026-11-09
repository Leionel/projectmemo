import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { updateProjectAction } from "@/lib/services/actionService";
import {
  applyReminderDispositionOnCompletion,
  type ReminderCompletionOutcome,
} from "@/lib/services/actionReminderService";
import { actionUpdateSchema } from "@/lib/validation/schemas";
import { db } from "@/lib/db";

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
    const previous = input.dueAt !== undefined ? await db.actionItem.findFirst({ where: { id: actionId, projectId: id }, select: { dueAt: true } }) : null;
    const action = await updateProjectAction(id, actionId, input);

    const rawDisposition = body?.reminderDisposition;
    // 取消意味着这件事不再做，提醒没有保留的理由，无需再询问。
    const disposition = input.status === "CANCELLED" ? "REMOVE"
      : rawDisposition === "KEEP" || rawDisposition === "REMOVE" ? rawDisposition : null;
    let reminderOutcome: ReminderCompletionOutcome | null = null;
    const headerDevice = request.headers.get("x-pm-device-key")?.trim() ?? "";
    const bodyDevice = typeof body?.deviceKey === "string" ? body.deviceKey.trim() : "";

    if (input.status === "CANCELLED" && (headerDevice || bodyDevice)) {
      reminderOutcome = await applyReminderDispositionOnCompletion(id, actionId, "REMOVE", {
        userId: user.id,
        deviceKey: headerDevice || bodyDevice,
      });
    } else if (disposition && input.status === "DONE") {
      if (headerDevice || bodyDevice) {
        reminderOutcome = await applyReminderDispositionOnCompletion(id, actionId, disposition, {
          userId: user.id,
          deviceKey: headerDevice || bodyDevice,
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

    // 改截止日不会自动挪动已写入设备的提醒，用户需要知道原提醒仍按旧时间响。
    const dueChanged = previous !== null && (previous.dueAt?.getTime() ?? null) !== (action.dueAt ? new Date(action.dueAt).getTime() : null);
    const reminderNotice = dueChanged && input.status !== "CANCELLED" && input.status !== "DONE"
      && await db.actionReminder.count({ where: { projectId: id, actionId, userId: user.id, syncStatus: { not: "REVOKED" }, reminderAt: { gt: new Date() } } }) > 0
      ? "截止时间已更新，已有提醒仍按原时间，可在提醒设置里调整。" : null;

    const device = headerDevice || bodyDevice;
    const elsewhere = (input.status === "DONE" || input.status === "CANCELLED") && await db.actionReminder.count({
      where: { projectId: id, actionId, userId: user.id, syncStatus: { not: "REVOKED" }, calendarEventId: { not: null }, reminderAt: { gt: new Date() },
        ...(device ? { deviceKey: { not: device } } : {}) },
    }) > 0;

    return Response.json({ action, reminderOutcome, reminderNotice: elsewhere ? "另一台设备上还有这条行动的日程，需要在那台设备上撤销。" : reminderNotice });
  } catch (error) {
    return apiError(error);
  }
}
