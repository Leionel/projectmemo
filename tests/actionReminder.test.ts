process.env.PROJECT_CALENDAR_REMINDER_ENABLED = "1";
process.env.PROJECT_SCHEDULING_ENABLED = "1";
process.env.PROJECT_CALENDAR_SYNC_ENABLED = "1";

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  applyReminderDispositionOnCompletion,
  arrangeActionReminder,
  confirmActionReminderCleanup,
  getActionReminderState,
  listActionReminders,
  recordActionReminderSync,
  revokeActionReminder,
  type ReminderActor,
} from "@/lib/services/actionReminderService";
import {
  confirmSchedulePlan,
  previewSchedule,
  recordCalendarSync,
} from "@/lib/services/scheduleService";

const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) await db.project.delete({ where: { id } }).catch(() => {});
  for (const id of createdUserIds) await db.user.delete({ where: { id } }).catch(() => {});
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function newProject(title: string) {
  const project = await db.project.create({
    data: { title, description: "待办日历提醒测试", goal: "R2 提醒生命周期", scenario: "COMPETITION" },
  });
  createdProjectIds.push(project.id);
  return project;
}

async function newMember(projectId: string, label = "提醒测试用户") {
  const user = await db.user.create({
    data: {
      username: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      displayName: label,
      passwordHash: "x",
    },
  });
  createdUserIds.push(user.id);
  await db.projectMembership.create({ data: { userId: user.id, projectId, role: "OWNER" } });
  return user;
}

async function newAction(projectId: string, title = "写实验报告", extra: Record<string, unknown> = {}) {
  return db.actionItem.create({
    data: { projectId, title, priority: 2, status: "TODO", estimatedMinutes: 60, ...extra },
  });
}

function actorFor(userId: string, deviceKey = "device-a"): ReminderActor {
  return { userId, deviceKey };
}

interface CapturedError {
  code: string;
  status: number;
  details?: { compensate?: { eventId?: string }; feasibility?: string };
}

/** 断言调用失败并取回错误对象；调用意外成功时直接报错，避免假绿 */
async function captureError(operation: Promise<unknown>): Promise<CapturedError> {
  try {
    await operation;
  } catch (error) {
    return error as CapturedError;
  }
  throw new Error("预期的失败没有发生，调用意外成功了");
}

/** 安排一条提醒并直接登记「已写入设备日历」，返回提醒 ID 与事件编号 */
async function arrangeAndSync(
  projectId: string,
  actionId: string,
  actor: ReminderActor,
  offsetHours: number,
  suffix: string,
  now = new Date(),
) {
  const arranged = await arrangeActionReminder(projectId, actionId, {
    requestId: `arr-${suffix}`,
    reminderAt: new Date(now.getTime() + offsetHours * HOUR).toISOString(),
  }, actor, now);
  const reminder = await recordActionReminderSync(projectId, arranged.reminder.id, {
    status: "SYNCED",
    calendarId: "cal-local",
    eventId: `evt-${suffix}`,
  }, actor);
  return { reminderId: arranged.reminder.id, eventId: `evt-${suffix}`, reminder };
}

describe("action reminder lifecycle (待办日历提醒生命周期)", () => {
  it("saves the in-app plan time first and only reports synced after a real event id exists", async () => {
    const project = await newProject("提醒生命周期项目");
    const user = await newMember(project.id);
    const action = await newAction(project.id, "整理实验结果");
    const actor = actorFor(user.id);
    const now = new Date();

    const arranged = await arrangeActionReminder(project.id, action.id, {
      requestId: "arr-lifecycle",
      reminderAt: new Date(now.getTime() + 2 * HOUR).toISOString(),
    }, actor, now);

    // 计划时间已保存，但设备日历里还没有任何东西
    expect(arranged.reminder.syncStatus).toBe("PLANNED");
    expect(arranged.reminder.calendarEventId).toBeNull();
    expect(arranged.devicePlan).toHaveLength(1);
    expect(arranged.devicePlan[0].kind).toBe("CREATE");
    expect(arranged.devicePlan[0].title.startsWith("忆程·")).toBe(true);
    expect(arranged.devicePlan[0].reminderMinutesBeforeStart).toEqual([0]);
    expect(arranged.devicePlan[0].durationMinutes).toBe(30);

    let state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.status).toBe("PLANNED");
    expect(state.statusLabel).not.toContain("已写入");
    expect(state.outstandingDeviceEvent).toBeNull();
    // 计划时间只来自回执，不靠 ActionItem.dueAt 冒充写入回执
    expect(action.dueAt).toBeNull();

    await recordActionReminderSync(project.id, arranged.reminder.id, { status: "PENDING" }, actor);
    state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.status).toBe("PENDING");

    const synced = await recordActionReminderSync(project.id, arranged.reminder.id, {
      status: "SYNCED",
      calendarId: "cal-local",
      eventId: "evt-lifecycle",
    }, actor);
    expect(synced.syncStatus).toBe("SYNCED");
    expect(synced.calendarEventId).toBe("evt-lifecycle");

    state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.status).toBe("SYNCED");
    expect(state.statusLabel).toContain("已写入");
    expect(state.outstandingDeviceEvent?.eventId).toBe("evt-lifecycle");
    // 写入设备日历不改变待办本身的完成状态
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("TODO");
  });

  it("refuses to report synced without a real event id, and reports the orphan event for compensation", async () => {
    const project = await newProject("缺事件编号项目");
    const user = await newMember(project.id);
    const action = await newAction(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const arranged = await arrangeActionReminder(project.id, action.id, {
      requestId: "arr-no-event",
      reminderAt: new Date(now.getTime() + HOUR).toISOString(),
    }, actor, now);

    await expect(recordActionReminderSync(project.id, arranged.reminder.id, {
      status: "SYNCED",
      calendarId: "cal-local",
      eventId: null,
    }, actor)).rejects.toMatchObject({ code: "INVALID_CALENDAR_RECEIPT", status: 422 });

    // 失败回执不能携带事件编号
    await expect(recordActionReminderSync(project.id, arranged.reminder.id, {
      status: "FAILED",
      eventId: "evt-should-not-exist",
    }, actor)).rejects.toMatchObject({ code: "INVALID_CALENDAR_RECEIPT", status: 422 });

    const stillPlanned = await getActionReminderState(project.id, action.id, actor, now);
    expect(stillPlanned.status).toBe("PLANNED");
    expect(stillPlanned.reminder?.calendarEventId).toBeNull();

    // 设备已创建、服务端拒绝登记时：必须给出补偿删除指令，不能留下孤儿日程
    await revokeActionReminder(project.id, arranged.reminder.id, actor);
    const failure = await captureError(recordActionReminderSync(project.id, arranged.reminder.id, {
      status: "SYNCED",
      calendarId: "cal-local",
      eventId: "evt-orphan",
    }, actor));
    expect(failure).toMatchObject({ code: "REMINDER_REVOKED", status: 409 });
    expect(failure.details?.compensate?.eventId).toBe("evt-orphan");
  });

  it("replays the same requestId payload and rejects a reused requestId with a different payload", async () => {
    const project = await newProject("提醒幂等项目");
    const user = await newMember(project.id);
    const action = await newAction(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const first = new Date(now.getTime() + 3 * HOUR).toISOString();

    const a = await arrangeActionReminder(project.id, action.id, { requestId: "arr-idem", reminderAt: first }, actor, now);
    const b = await arrangeActionReminder(project.id, action.id, { requestId: "arr-idem", reminderAt: first }, actor, now);
    expect(b.reminder.id).toBe(a.reminder.id);
    expect(b.devicePlan).toHaveLength(0);
    expect(await db.actionReminder.count({ where: { projectId: project.id } })).toBe(1);

    await expect(arrangeActionReminder(project.id, action.id, {
      requestId: "arr-idem",
      reminderAt: new Date(now.getTime() + 5 * HOUR).toISOString(),
    }, actor, now)).rejects.toMatchObject({ code: "REQUEST_ID_REUSED", status: 409 });

    // 换一个 requestId 才是「修改提醒」；修改必须带上读到的 expectedRevision
    const changed = await arrangeActionReminder(project.id, action.id, {
      requestId: "arr-idem-2",
      reminderAt: new Date(now.getTime() + 5 * HOUR).toISOString(),
      expectedRevision: a.reminder.revision,
    }, actor, now);
    expect(changed.reminder.id).toBe(a.reminder.id);
    expect(changed.reminder.revision).toBeGreaterThan(a.reminder.revision);
    expect(await db.actionReminder.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("never leaves two own events when changing the reminder time", async () => {
    const project = await newProject("修改提醒不留重复事件");
    const user = await newMember(project.id);
    const action = await newAction(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const { reminderId, eventId } = await arrangeAndSync(project.id, action.id, actor, 4, "change", now);

    // 设备上已有自有事件时，直接改时间必须被拒绝
    await expect(arrangeActionReminder(project.id, action.id, {
      requestId: "arr-change-2",
      reminderAt: new Date(now.getTime() + 8 * HOUR).toISOString(),
    }, actor, now)).rejects.toMatchObject({ code: "REMINDER_DEVICE_EVENT_EXISTS", status: 409 });

    const revoked = await revokeActionReminder(project.id, reminderId, actor);
    expect(revoked.reminder.syncStatus).toBe("REVOKED");
    expect(revoked.devicePlan).toHaveLength(1);
    expect(revoked.devicePlan[0]).toMatchObject({ kind: "DELETE", eventId });

    // 服务端撤销不等于设备已删除：编号仍在时必须继续阻止修改，并暴露清理入口。
    let state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.status).toBe("REVOKED");
    expect(state.requiresRevokeBeforeChange).toBe(true);
    expect(state.outstandingDeviceEvent?.eventId).toBe(eventId);
    await expect(arrangeActionReminder(project.id, action.id, {
      requestId: "arr-change-before-cleanup",
      reminderAt: new Date(now.getTime() + 8 * HOUR).toISOString(),
      expectedRevision: revoked.reminder.revision,
    }, actor, now)).rejects.toMatchObject({ code: "REMINDER_DEVICE_EVENT_EXISTS", status: 409 });

    const cleaned = await confirmActionReminderCleanup(project.id, reminderId, { eventId }, actor);
    expect(cleaned.syncStatus).toBe("REVOKED");
    expect(cleaned.calendarEventId).toBeNull();
    state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.requiresRevokeBeforeChange).toBe(false);
    expect(state.outstandingDeviceEvent).toBeNull();

    const replaced = await arrangeActionReminder(project.id, action.id, {
      requestId: "arr-change-3",
      reminderAt: new Date(now.getTime() + 8 * HOUR).toISOString(),
      expectedRevision: cleaned.revision,
    }, actor, now);
    // 只有设备清理回执落库后才允许创建新事件；此时计划里不再携带已经执行过的 DELETE。
    expect(replaced.devicePlan.map((operation) => operation.kind)).toEqual(["CREATE"]);
    expect(await db.actionReminder.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("keeps cleanup acknowledgement scoped and prevents a delayed old acknowledgement from clearing a new event", async () => {
    const project = await newProject("设备清理确认隔离");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id);
    const first = await arrangeAndSync(project.id, action.id, actor, 4, "cleanup-old", now);

    const revoked = await revokeActionReminder(project.id, first.reminderId, actor);
    await expect(confirmActionReminderCleanup(project.id, first.reminderId, { eventId: "another-event" }, actor))
      .rejects.toMatchObject({ code: "REMINDER_EVENT_CHANGED", status: 409 });
    const cleaned = await confirmActionReminderCleanup(project.id, first.reminderId, { eventId: first.eventId }, actor);

    const replacement = await arrangeActionReminder(project.id, action.id, {
      requestId: "cleanup-replacement",
      reminderAt: new Date(now.getTime() + 8 * HOUR).toISOString(),
      expectedRevision: cleaned.revision,
    }, actor, now);
    await recordActionReminderSync(project.id, replacement.reminder.id, {
      status: "SYNCED",
      calendarId: "cal-local",
      eventId: "evt-cleanup-new",
    }, actor);

    // 旧删除确认延迟到达时，不能清掉后来登记的新事件。
    await expect(confirmActionReminderCleanup(project.id, first.reminderId, { eventId: first.eventId }, actor))
      .rejects.toMatchObject({ code: "REMINDER_NOT_REVOKED", status: 409 });
    const latest = await db.actionReminder.findUniqueOrThrow({ where: { id: first.reminderId } });
    expect(latest.calendarEventId).toBe("evt-cleanup-new");
    expect(latest.syncStatus).toBe("SYNCED");
    expect(revoked.reminder.calendarEventId).toBe(first.eventId);
  });

  it("keeps revocation retry-safe and scoped to its own recorded event", async () => {
    const project = await newProject("撤销可重试");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const firstAction = await newAction(project.id, "第一条待办");
    const secondAction = await newAction(project.id, "第二条待办");
    const first = await arrangeAndSync(project.id, firstAction.id, actor, 5, "retry-a", now);
    const second = await arrangeAndSync(project.id, secondAction.id, actor, 6, "retry-b", now);

    const revoked = await revokeActionReminder(project.id, first.reminderId, actor);
    expect(revoked.reminder.syncStatus).toBe("REVOKED");
    expect(revoked.devicePlan[0].eventId).toBe(first.eventId);

    const retried = await revokeActionReminder(project.id, first.reminderId, actor);
    expect(retried.reminder.syncStatus).toBe("REVOKED");
    expect(retried.reminder.revision).toBe(revoked.reminder.revision);
    // 重试只可能指向自己记录过的那一条，绝不会牵连用户的其他日程
    expect(retried.devicePlan).toHaveLength(1);
    expect(retried.devicePlan[0].eventId).toBe(first.eventId);
    expect(retried.devicePlan[0].eventId).not.toBe(second.eventId);
    expect(revoked.devicePlan[0].prefix).toBe("忆程·");
  });

  it("keeps receipts isolated per user, per device and per project", async () => {
    const project = await newProject("提醒隔离项目");
    const otherProject = await newProject("提醒隔离另一个项目");
    const owner = await newMember(project.id);
    const stranger = await newMember(project.id, "同项目其他成员");
    const now = new Date();
    const action = await newAction(project.id);
    const { reminderId } = await arrangeAndSync(project.id, action.id, actorFor(owner.id), 7, "iso", now);

    // 同项目其他成员看不到这条回执
    const strangerState = await getActionReminderState(project.id, action.id, actorFor(stranger.id), now);
    expect(strangerState.reminder).toBeNull();
    expect(strangerState.status).toBe("NOT_SCHEDULED");
    expect(strangerState.outstandingDeviceEvent).toBeNull();

    await expect(recordActionReminderSync(project.id, reminderId, {
      status: "FAILED", error: "越权尝试",
    }, actorFor(stranger.id))).rejects.toMatchObject({ code: "REMINDER_NOT_FOUND", status: 404 });
    await expect(revokeActionReminder(project.id, reminderId, actorFor(stranger.id)))
      .rejects.toMatchObject({ code: "REMINDER_NOT_FOUND", status: 404 });

    // 同一成员的另一台设备也拿不到回执
    await expect(revokeActionReminder(project.id, reminderId, actorFor(owner.id, "device-b")))
      .rejects.toMatchObject({ code: "REMINDER_NOT_FOUND", status: 404 });

    // 跨项目访问同样 404
    await expect(recordActionReminderSync(otherProject.id, reminderId, {
      status: "FAILED", error: "跨项目",
    }, actorFor(owner.id))).rejects.toMatchObject({ code: "REMINDER_NOT_FOUND", status: 404 });
    await expect(revokeActionReminder(otherProject.id, reminderId, actorFor(owner.id)))
      .rejects.toMatchObject({ code: "REMINDER_NOT_FOUND", status: 404 });

    // 归属者本人不受影响
    const mine = await getActionReminderState(project.id, action.id, actorFor(owner.id), now);
    expect(mine.status).toBe("SYNCED");
  });

  it("falls back honestly when permission is denied or the device has no calendar", async () => {
    const project = await newProject("权限与不支持回退");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const deniedAction = await newAction(project.id, "被拒权限的待办");
    const unsupportedAction = await newAction(project.id, "不支持日历的待办");

    const denied = await arrangeActionReminder(project.id, deniedAction.id, {
      requestId: "arr-denied",
      reminderAt: new Date(now.getTime() + 9 * HOUR).toISOString(),
    }, actor, now);
    const deniedSaved = await recordActionReminderSync(project.id, denied.reminder.id, {
      status: "PERMISSION_DENIED",
      error: "用户拒绝了日历权限",
    }, actor);
    expect(deniedSaved.syncStatus).toBe("PERMISSION_DENIED");
    expect(deniedSaved.calendarEventId).toBeNull();

    let state = await getActionReminderState(project.id, deniedAction.id, actor, now);
    // 拒绝后仍保留用户填写的日期时间，不显示假成功
    expect(state.status).toBe("PERMISSION_DENIED");
    expect(state.statusLabel).toContain("权限");
    expect(state.statusLabel).not.toContain("已写入");
    expect(state.reminder?.reminderAt).toBe(denied.reminder.reminderAt);
    expect(state.canArrange).toBe(true);
    expect(state.permissionPurpose.length).toBeGreaterThan(0);

    const unsupported = await arrangeActionReminder(project.id, unsupportedAction.id, {
      requestId: "arr-unsupported",
      reminderAt: new Date(now.getTime() + 10 * HOUR).toISOString(),
    }, actor, now);
    await recordActionReminderSync(project.id, unsupported.reminder.id, {
      status: "UNSUPPORTED",
      error: "设备不支持 Calendar Kit",
    }, actor);
    state = await getActionReminderState(project.id, unsupportedAction.id, actor, now);
    expect(state.status).toBe("UNSUPPORTED");
    expect(state.statusLabel).toContain("不支持");
    expect(state.statusDetail).toContain("项目内");
    expect(state.outstandingDeviceEvent).toBeNull();
  });

  it("asks about the future event when completing a todo and honours both choices", async () => {
    const project = await newProject("完成待办时处理提醒");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const keepAction = await newAction(project.id, "保留提醒的待办");
    const removeAction = await newAction(project.id, "移除提醒的待办");
    const keep = await arrangeAndSync(project.id, keepAction.id, actor, 11, "keep", now);
    const remove = await arrangeAndSync(project.id, removeAction.id, actor, 12, "remove", now);

    const prompt = await getActionReminderState(project.id, keepAction.id, actor, now);
    expect(prompt.completionPrompt?.required).toBe(true);
    expect(prompt.completionPrompt?.options.map((option) => option.value)).toEqual(["REMOVE", "KEEP"]);

    const kept = await applyReminderDispositionOnCompletion(project.id, keepAction.id, "KEEP", actor, now);
    expect(kept.disposition).toBe("KEEP");
    expect(kept.devicePlan).toHaveLength(0);
    expect((await db.actionReminder.findUniqueOrThrow({ where: { id: keep.reminderId } })).syncStatus).toBe("SYNCED");

    const removed = await applyReminderDispositionOnCompletion(project.id, removeAction.id, "REMOVE", actor, now);
    expect(removed.disposition).toBe("REMOVE");
    expect(removed.devicePlan).toHaveLength(1);
    expect(removed.devicePlan[0].eventId).toBe(remove.eventId);
    expect(removed.compensation.revokeUrl).toContain("revoke");
    const removedRow = await db.actionReminder.findUniqueOrThrow({ where: { id: remove.reminderId } });
    expect(removedRow.syncStatus).toBe("REVOKED");
    expect(removedRow.completionChoice).toBe("REMOVE");

    // 提醒时间已过时不询问、也不生成删除指令
    const past = await applyReminderDispositionOnCompletion(
      project.id,
      removeAction.id,
      "REMOVE",
      actor,
      new Date(now.getTime() + 100 * HOUR),
    );
    expect(past.devicePlan).toHaveLength(0);
  });

  it("blocks arranging a reminder for a blocked or unconfirmable todo", async () => {
    const project = await newProject("受阻待办不能安排提醒");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const blocked = await newAction(project.id, "受阻的待办");
    await db.actionRequirement.create({
      data: { actionId: blocked.id, projectId: project.id, targetKind: "deliverable", targetId: "missing-deliverable", hard: true },
    });

    const error = await captureError(arrangeActionReminder(project.id, blocked.id, {
      requestId: "arr-blocked",
      reminderAt: new Date(now.getTime() + 13 * HOUR).toISOString(),
    }, actor, now));
    expect(error).toMatchObject({ code: "REMINDER_ACTION_BLOCKED", status: 409 });
    expect(error.details?.feasibility).toBe("BLOCKED");
    expect(await db.actionReminder.count({ where: { projectId: project.id } })).toBe(0);

    const state = await getActionReminderState(project.id, blocked.id, actor, now);
    expect(state.canArrange).toBe(false);
    expect(state.blockedReason).toContain("先处理阻塞");
  });

  it("reads reminder state without creating business writes", async () => {
    const project = await newProject("读取不写入");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id);
    await arrangeAndSync(project.id, action.id, actor, 14, "readonly", now);

    const before = {
      reminders: await db.actionReminder.count({ where: { projectId: project.id } }),
      actions: await db.actionItem.count({ where: { projectId: project.id } }),
      cards: await db.knowledgeCard.count({ where: { projectId: project.id } }),
      runs: await db.agentRun.count({ where: { projectId: project.id } }),
    };
    await getActionReminderState(project.id, action.id, actor, now);
    const listed = await listActionReminders(project.id, actor);
    const after = {
      reminders: await db.actionReminder.count({ where: { projectId: project.id } }),
      actions: await db.actionItem.count({ where: { projectId: project.id } }),
      cards: await db.knowledgeCard.count({ where: { projectId: project.id } }),
      runs: await db.agentRun.count({ where: { projectId: project.id } }),
    };
    expect(after).toEqual(before);
    expect(listed.reminders).toHaveLength(1);
  });

  it("shows the event written by a confirmed schedule under the same status vocabulary", async () => {
    const project = await newProject("统一排程与提醒语义");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id, "已排程的待办");
    const base = now.getTime() + 24 * HOUR;
    const slots = [{ start: new Date(base).toISOString(), end: new Date(base + 4 * HOUR).toISOString() }];
    const plan = await previewSchedule(project.id, {
      requestId: `uni-${project.id}`,
      rangeStart: slots[0].start,
      rangeEnd: slots[0].end,
      slots,
      actionIds: [action.id],
    }, { userId: user.id });
    await confirmSchedulePlan(project.id, plan.id, { requestId: `uni-${project.id}` }, { userId: user.id });
    await recordCalendarSync(project.id, plan.id, [{
      blockId: plan.blocks[0].id!,
      calendarId: "cal-local",
      eventId: "evt-from-plan",
      status: "SYNCED",
    }], user.id);

    const state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.status).toBe("SYNCED");
    expect(state.source).toBe("PLAN_BLOCK");
    expect(state.outstandingDeviceEvent?.eventId).toBe("evt-from-plan");

    const listed = await listActionReminders(project.id, actor);
    expect(listed.reminders).toHaveLength(0);
    expect(listed.planBlockEvents).toHaveLength(1);
    expect(listed.planBlockEvents[0].statusLabel).toContain("已写入");
  });

  it("stays unavailable while the feature flag is off and keeps the saved plan time", async () => {
    const project = await newProject("提醒开关关闭");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id);
    const arranged = await arrangeActionReminder(project.id, action.id, {
      requestId: "arr-flag-off",
      reminderAt: new Date(now.getTime() + 15 * HOUR).toISOString(),
    }, actor, now);

    const previous = process.env.PROJECT_CALENDAR_REMINDER_ENABLED;
    process.env.PROJECT_CALENDAR_REMINDER_ENABLED = "0";
    try {
      await expect(getActionReminderState(project.id, action.id, actor, now))
        .rejects.toMatchObject({ code: "PROJECT_CALENDAR_REMINDER_DISABLED", status: 503 });
      await expect(arrangeActionReminder(project.id, action.id, {
        requestId: "arr-flag-off-2",
        reminderAt: new Date(now.getTime() + 16 * HOUR).toISOString(),
      }, actor, now)).rejects.toMatchObject({ code: "PROJECT_CALENDAR_REMINDER_DISABLED", status: 503 });
    } finally {
      process.env.PROJECT_CALENDAR_REMINDER_ENABLED = previous;
    }

    const kept = await db.actionReminder.findUniqueOrThrow({ where: { id: arranged.reminder.id } });
    expect(kept.reminderAt.toISOString()).toBe(arranged.reminder.reminderAt);
  });
  it("routes completion to the confirmed plan when the device event came from scheduling", async () => {
    const project = await newProject("完成时指向排程计划");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id, "已排程的待办");
    const base = now.getTime() + 30 * HOUR;
    const slots = [{ start: new Date(base).toISOString(), end: new Date(base + 4 * HOUR).toISOString() }];
    const plan = await previewSchedule(project.id, {
      requestId: `route-${project.id}`,
      rangeStart: slots[0].start,
      rangeEnd: slots[0].end,
      slots,
      actionIds: [action.id],
    }, { userId: user.id });
    await confirmSchedulePlan(project.id, plan.id, { requestId: `route-${project.id}` }, { userId: user.id });
    await recordCalendarSync(project.id, plan.id, [{
      blockId: plan.blocks[0].id!,
      calendarId: "cal-local",
      eventId: "evt-planned",
      status: "SYNCED",
    }], user.id);

    const state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.source).toBe("PLAN_BLOCK");
    expect(state.completionPrompt?.required).toBe(true);

    // 单待办提醒路径没有这条事件的回执：如实指路，不代删、也不假装已移除
    const outcome = await applyReminderDispositionOnCompletion(project.id, action.id, "REMOVE", actor, now);
    expect(outcome.recorded).toBe(false);
    expect(outcome.devicePlan).toHaveLength(0);
    expect(outcome.compensation.message).toContain("安排未来 7 天");
    expect(await db.actionReminder.count({ where: { projectId: project.id } })).toBe(0);
    const block = await db.scheduleBlock.findFirstOrThrow({ where: { actionId: action.id } });
    expect(block.calendarSyncStatus).toBe("SYNCED");
  });
});

describe("reminder request receipts (持久幂等与并发控制)", () => {
  it("does not let a delayed replay of an older request overwrite a newer reminder", async () => {
    const project = await newProject("延迟重放不覆盖新安排");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id, "会被改时间的待办");
    const timeA = new Date(now.getTime() + 3 * HOUR).toISOString();
    const timeB = new Date(now.getTime() + 6 * HOUR).toISOString();

    // 请求 A：首次安排
    const a = await arrangeActionReminder(project.id, action.id, { requestId: "req-A", reminderAt: timeA }, actor, now);
    expect(a.replayed).toBeFalsy();
    expect(a.reminder.reminderAt).toBe(timeA);

    // 请求 B：改成更晚的时间，成功
    const b = await arrangeActionReminder(project.id, action.id, {
      requestId: "req-B",
      reminderAt: timeB,
      expectedRevision: a.reminder.revision,
    }, actor, now);
    expect(b.reminder.reminderAt).toBe(timeB);
    expect(b.reminder.revision).toBeGreaterThan(a.reminder.revision);

    // 延迟重放 A：必须只读回历史结果，绝不能把 B 改回 timeA
    const replay = await arrangeActionReminder(project.id, action.id, { requestId: "req-A", reminderAt: timeA }, actor, now);
    expect(replay.replayed).toBe(true);
    expect(replay.historical).toBe(true);
    expect(replay.devicePlan).toHaveLength(0);
    expect(replay.message).toContain("没有覆盖");

    const state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.reminder?.reminderAt).toBe(timeB);
    expect(state.reminder?.revision).toBe(b.reminder.revision);
    // 两条请求各自留痕：旧请求的幂等保护不因提醒被修改而失效
    expect(await db.actionReminderRequest.count({ where: { projectId: project.id } })).toBe(2);
    expect(await db.actionReminder.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("rejects the same requestId reused with another payload, another action or another project", async () => {
    const project = await newProject("requestId 冲突范围");
    const otherProject = await newProject("requestId 冲突的另一个项目");
    const user = await newMember(project.id);
    await db.projectMembership.create({ data: { userId: user.id, projectId: otherProject.id, role: "OWNER" } });
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id, "第一条待办");
    const otherAction = await newAction(project.id, "第二条待办");
    const otherProjectAction = await newAction(otherProject.id, "别的项目的待办");
    const first = new Date(now.getTime() + 3 * HOUR).toISOString();

    await arrangeActionReminder(project.id, action.id, { requestId: "req-shared", reminderAt: first }, actor, now);

    // 同 ID 不同载荷
    await expect(arrangeActionReminder(project.id, action.id, {
      requestId: "req-shared",
      reminderAt: new Date(now.getTime() + 4 * HOUR).toISOString(),
    }, actor, now)).rejects.toMatchObject({ code: "REQUEST_ID_REUSED", status: 409 });

    // 同 ID 不同待办
    await expect(arrangeActionReminder(project.id, otherAction.id, {
      requestId: "req-shared",
      reminderAt: first,
    }, actor, now)).rejects.toMatchObject({ code: "REQUEST_ID_REUSED", status: 409 });

    // 同 ID 不同项目
    await expect(arrangeActionReminder(otherProject.id, otherProjectAction.id, {
      requestId: "req-shared",
      reminderAt: first,
    }, actor, now)).rejects.toMatchObject({ code: "REQUEST_ID_REUSED", status: 409 });

    // 冲突请求没有在别处偷偷建出提醒
    expect(await db.actionReminder.count({ where: { projectId: project.id } })).toBe(1);
    expect(await db.actionReminder.count({ where: { projectId: otherProject.id } })).toBe(0);
  });

  it("requires expectedRevision for modifications and rejects a stale version", async () => {
    const project = await newProject("修改必须带版本号");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id);
    const created = await arrangeActionReminder(project.id, action.id, {
      requestId: "req-rev-1",
      reminderAt: new Date(now.getTime() + 3 * HOUR).toISOString(),
    }, actor, now);

    // 不带版本号：明确要求，而不是猜
    await expect(arrangeActionReminder(project.id, action.id, {
      requestId: "req-rev-2",
      reminderAt: new Date(now.getTime() + 4 * HOUR).toISOString(),
    }, actor, now)).rejects.toMatchObject({ code: "REMINDER_EXPECTED_REVISION_REQUIRED", status: 422 });

    // 带过期版本号：CAS 拒绝
    await expect(arrangeActionReminder(project.id, action.id, {
      requestId: "req-rev-3",
      reminderAt: new Date(now.getTime() + 4 * HOUR).toISOString(),
      expectedRevision: created.reminder.revision + 5,
    }, actor, now)).rejects.toMatchObject({ code: "REMINDER_REVISION_CHANGED", status: 409 });

    // 带正确版本号：成功并把版本号推进
    const updated = await arrangeActionReminder(project.id, action.id, {
      requestId: "req-rev-4",
      reminderAt: new Date(now.getTime() + 4 * HOUR).toISOString(),
      expectedRevision: created.reminder.revision,
    }, actor, now);
    expect(updated.reminder.revision).toBe(created.reminder.revision + 1);
  });

  it("lets only one of two concurrent modifications with the same expectedRevision win", async () => {
    const project = await newProject("并发修改只有一个成功");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id);
    const created = await arrangeActionReminder(project.id, action.id, {
      requestId: "req-cas-0",
      reminderAt: new Date(now.getTime() + 3 * HOUR).toISOString(),
    }, actor, now);
    const version = created.reminder.revision;

    const results = await Promise.allSettled([
      arrangeActionReminder(project.id, action.id, {
        requestId: "req-cas-A",
        reminderAt: new Date(now.getTime() + 5 * HOUR).toISOString(),
        expectedRevision: version,
      }, actor, now),
      arrangeActionReminder(project.id, action.id, {
        requestId: "req-cas-B",
        reminderAt: new Date(now.getTime() + 7 * HOUR).toISOString(),
        expectedRevision: version,
      }, actor, now),
    ]);

    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: "REMINDER_REVISION_CHANGED",
      status: 409,
    });
    // 只推进一次版本，且只留一条提醒
    const state = await getActionReminderState(project.id, action.id, actor, now);
    expect(state.reminder?.revision).toBe(version + 1);
    expect(await db.actionReminder.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("returns a deterministic result when two first-arranges race on the same todo", async () => {
    const project = await newProject("并发首建确定结果");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id);

    const results = await Promise.allSettled([
      arrangeActionReminder(project.id, action.id, {
        requestId: "req-first-A",
        reminderAt: new Date(now.getTime() + 3 * HOUR).toISOString(),
      }, actor, now),
      arrangeActionReminder(project.id, action.id, {
        requestId: "req-first-B",
        reminderAt: new Date(now.getTime() + 3 * HOUR).toISOString(),
      }, actor, now),
    ]);

    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // 后到者必须得到确定结果，三种都属于明确拒绝，绝不会静默建出第二条提醒：
    // - 读到时已被抢先创建、自己却没带版本号 → REMINDER_EXPECTED_REVISION_REQUIRED
    // - 带了版本号但版本已过期 → REMINDER_REVISION_CHANGED
    // - 同一个 requestId 并发 → REQUEST_ID_REUSED
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string; status?: number };
    expect(["REMINDER_EXPECTED_REVISION_REQUIRED", "REMINDER_REVISION_CHANGED", "REQUEST_ID_REUSED"])
      .toContain(reason.code);
    expect(await db.actionReminder.count({ where: { projectId: project.id, actionId: action.id } })).toBe(1);
  });

  it("keeps revoke idempotent through the request receipt and rejects cross-target reuse", async () => {
    const project = await newProject("撤销请求回执");
    const user = await newMember(project.id);
    const actor = actorFor(user.id);
    const now = new Date();
    const action = await newAction(project.id, "待撤销的待办");
    const otherAction = await newAction(project.id, "另一条待办");
    const first = await arrangeAndSync(project.id, action.id, actor, 4, "revoke-receipt", now);
    const second = await arrangeAndSync(project.id, otherAction.id, actor, 5, "revoke-other", now);

    const revoked = await revokeActionReminder(project.id, first.reminderId, actor, { requestId: "req-revoke-1" });
    expect(revoked.reminder.syncStatus).toBe("REVOKED");
    expect(revoked.replayed).toBeFalsy();
    expect(revoked.devicePlan[0].eventId).toBe(first.eventId);

    // 同 ID 重放：稳定返回，不再次改变状态
    const replay = await revokeActionReminder(project.id, first.reminderId, actor, { requestId: "req-revoke-1" });
    expect(replay.replayed).toBe(true);
    expect(replay.reminder.revision).toBe(revoked.reminder.revision);
    expect(replay.devicePlan[0].eventId).toBe(first.eventId);

    // 同 ID 用在另一条提醒上：409，而不是把它也撤销掉
    await expect(revokeActionReminder(project.id, second.reminderId, actor, { requestId: "req-revoke-1" }))
      .rejects.toMatchObject({ code: "REQUEST_ID_REUSED", status: 409 });
    const untouched = await db.actionReminder.findUniqueOrThrow({ where: { id: second.reminderId } });
    expect(untouched.syncStatus).toBe("SYNCED");
  });
});
