/**
 * 单条待办的日历提醒生命周期。
 *
 * 三种状态必须分开，界面和回执都不能混为一谈：
 * 1. 项目内计划时间（本表的 reminderAt）：只是忆程里的计划，不代表设备上有日程；
 * 2. 设备系统日历事件（calendarEventId + SYNCED）：只有拿到了真实事件编号才算写入；
 * 3. 待办完成（ActionItem.status = DONE + resultCardId）：与上面两者互不等价。
 *
 * 撤销与修改只作用于回执里记录过的 eventId，绝不按标题模糊删除，
 * 因此不会误删用户自己在系统日历里创建的日程。
 */
import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import {
  CALENDAR_EVENT_PREFIX,
  CALENDAR_PERMISSION_PURPOSE,
  DEFAULT_REMINDER_DURATION_MINUTES,
  REMINDER_MINUTES_BEFORE_START,
  assertDeviceCalendarReceipt,
  buildCalendarEventTitle,
  describeReminderStatus,
  isOutstandingDeviceStatus,
  mapBlockCalendarStatusToReminderStatus,
  type DeviceCalendarOperation,
  type ReminderLifecycleStatus,
  type ReminderSyncStatus,
} from "@/lib/services/calendarReceiptRules";

const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 240;
const DEFAULT_TIMEZONE = "Asia/Shanghai";
/** 提醒时间必须晚于当前时刻，留出最小提前量避免「刚保存就过期」 */
const MIN_LEAD_TIME_MS = 60_000;
const MAX_DEVICE_KEY_LENGTH = 160;

/** 能安排提醒的行动状态；DONE/CANCELLED 不安排，也不改回 TODO */
const REMINDABLE_ACTION_STATUSES = ["TODO", "DOING"] as const;

/** 客户端可以回报的设备侧结果；PENDING 用于「正在写入」 */
const REPORTABLE_STATUSES: ReminderSyncStatus[] = [
  "PENDING",
  "SYNCED",
  "FAILED",
  "PERMISSION_DENIED",
  "MISSING",
  "UNSUPPORTED",
];

export interface ReminderActor {
  /** 来自鉴权结果；决定回执归属，不接受客户端传入 */
  userId: string;
  /** 客户端/设备身份；同一用户的另一台设备看不到这条回执 */
  deviceKey: string;
}

export type ReminderSource = "ACTION_REMINDER" | "PLAN_BLOCK" | "NONE";

export interface ActionReminderData {
  id: string;
  projectId: string;
  actionId: string;
  actionTitle: string;
  deviceKey: string;
  requestId: string;
  reminderAt: string;
  durationMinutes: number;
  timezone: string;
  calendarId: string | null;
  calendarEventId: string | null;
  syncStatus: ReminderSyncStatus;
  error: string | null;
  completionChoice: "KEEP" | "REMOVE" | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface ReminderPlanBlockData {
  planId: string;
  blockId: string;
  start: string;
  end: string;
  calendarId: string | null;
  calendarEventId: string | null;
  calendarStatus: string | null;
  error: string | null;
}

export interface ActionReminderState {
  actionId: string;
  actionTitle: string;
  actionStatus: string;
  feasibility: "READY" | "BLOCKED" | "UNKNOWN";
  feasibilitySummary: string;
  /** 用户可见状态（含「还没安排提醒」） */
  status: ReminderLifecycleStatus;
  statusLabel: string;
  statusDetail: string;
  source: ReminderSource;
  reminder: ActionReminderData | null;
  planBlock: ReminderPlanBlockData | null;
  /** 是否可以安排或修改提醒；受阻时为 false，界面应显示「先处理阻塞」 */
  canArrange: boolean;
  /** canArrange 为 false 时的原因；BLOCKED/UNKNOWN 会附上解阻入口提示 */
  blockedReason: string | null;
  /** 已有设备事件时必须先撤销再改时间，避免留下两个应用自有事件 */
  requiresRevokeBeforeChange: boolean;
  /** 当前仍登记在设备上的自有事件；删除只允许针对它。来自批量排程时没有单条回执 ID */
  outstandingDeviceEvent: { reminderId: string | null; calendarId: string | null; eventId: string; source: ReminderSource } | null;
  /** 待办完成前是否需要询问如何处理未来提醒 */
  completionPrompt: ReminderCompletionPrompt | null;
  durationMinutes: number;
  permissionPurpose: string;
}

export interface ReminderCompletionPrompt {
  required: boolean;
  question: string;
  options: Array<{ value: "KEEP" | "REMOVE"; label: string }>;
}

export interface ArrangeReminderInput {
  requestId: string;
  reminderAt: string;
  durationMinutes?: number;
  timezone?: string;
  expectedRevision?: number;
}

export interface RecordReminderSyncInput {
  status: ReminderSyncStatus;
  calendarId?: string | null;
  eventId?: string | null;
  error?: string | null;
}

export interface ReminderMutationResult {
  reminder: ActionReminderData;
  /** 客户端按顺序执行的设备日历操作；先删后建，避免重复事件 */
  devicePlan: DeviceCalendarOperation[];
  message: string;
}

export interface ReminderCompletionOutcome {
  /** 是否记录过完成时的提醒处置 */
  recorded: boolean;
  disposition: "KEEP" | "REMOVE" | null;
  reminderId: string | null;
  /** 需要客户端在设备上删除的自有事件 */
  devicePlan: DeviceCalendarOperation[];
  /** 处置写入失败时的补偿提示；此时完成回执本身已经提交，不能回滚 */
  compensation: { needed: boolean; message: string; revokeUrl: string | null };
}

function ensureReminderEnabled() {
  if (!isFeatureEnabled("PROJECT_CALENDAR_REMINDER_ENABLED", false)) {
    throw new AppError("PROJECT_CALENDAR_REMINDER_DISABLED", "待办日历提醒功能当前已关闭", 503);
  }
}

export function isActionReminderEnabled(): boolean {
  return isFeatureEnabled("PROJECT_CALENDAR_REMINDER_ENABLED", false);
}

function iso(value: Date): string {
  return value.toISOString();
}

function toDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError("VALIDATION_ERROR", `${field} 不是有效的 ISO 8601 时间`, 422);
  }
  return parsed;
}

export function assertDeviceKey(deviceKey: string | undefined | null): string {
  const trimmed = (deviceKey ?? "").trim();
  if (trimmed.length === 0) {
    throw new AppError("VALIDATION_ERROR", "缺少设备标识，无法区分这台设备的提醒回执", 422);
  }
  if (trimmed.length > MAX_DEVICE_KEY_LENGTH) {
    throw new AppError("VALIDATION_ERROR", "设备标识过长", 422);
  }
  return trimmed;
}

/**
 * 组装提醒回执的归属：用户身份只来自鉴权结果，设备标识优先取请求头。
 * 客户端传什么都无法改变 userId，因此跨用户越权在服务层就不成立。
 */
export function resolveReminderActor(
  request: Request,
  userId: string,
  bodyDeviceKey?: string | null,
): ReminderActor {
  const headerKey = request.headers.get("x-pm-device-key")?.trim();
  return { userId, deviceKey: assertDeviceKey(headerKey ? headerKey : bodyDeviceKey ?? null) };
}

function normalizeDuration(value: number | undefined | null): number {
  const minutes = value ?? DEFAULT_REMINDER_DURATION_MINUTES;
  if (!Number.isInteger(minutes) || minutes < MIN_DURATION_MINUTES || minutes > MAX_DURATION_MINUTES) {
    throw new AppError(
      "VALIDATION_ERROR",
      `提醒时长需要是 ${MIN_DURATION_MINUTES} 到 ${MAX_DURATION_MINUTES} 分钟之间的整数`,
      422,
    );
  }
  return minutes;
}

type ReminderRow = {
  id: string;
  projectId: string;
  actionId: string;
  userId: string;
  deviceKey: string;
  requestId: string;
  reminderAt: Date;
  durationMinutes: number;
  timezone: string;
  calendarId: string | null;
  calendarEventId: string | null;
  syncStatus: string;
  error: string | null;
  inputHash: string | null;
  completionChoice: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
};

function serializeReminder(row: ReminderRow, actionTitle: string): ActionReminderData {
  return {
    id: row.id,
    projectId: row.projectId,
    actionId: row.actionId,
    actionTitle,
    deviceKey: row.deviceKey,
    requestId: row.requestId,
    reminderAt: iso(row.reminderAt),
    durationMinutes: row.durationMinutes,
    timezone: row.timezone,
    calendarId: row.calendarId,
    calendarEventId: row.calendarEventId,
    syncStatus: row.syncStatus as ReminderSyncStatus,
    error: row.error,
    completionChoice: row.completionChoice === "KEEP" || row.completionChoice === "REMOVE"
      ? row.completionChoice
      : null,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
  };
}

async function loadAction(projectId: string, actionId: string) {
  const action = await db.actionItem.findFirst({ where: { id: actionId, projectId } });
  if (!action) {
    throw new AppError("ACTION_NOT_FOUND", "待办不存在或不属于当前项目", 404);
  }
  return action;
}

/**
 * 回执按 (projectId, actionId, userId, deviceKey) 定位。
 * 其他成员或其他设备的回执在这里查不到，因此不可能被读取或撤销，
 * 与项目成员权限一样统一返回 404（不泄露同项目其他设备的回执是否存在）。
 */
async function findReminderRow(projectId: string, actionId: string, actor: ReminderActor) {
  return db.actionReminder.findUnique({
    where: {
      projectId_actionId_userId_deviceKey: {
        projectId,
        actionId,
        userId: actor.userId,
        deviceKey: actor.deviceKey,
      },
    },
  });
}

async function findReminderById(projectId: string, reminderId: string, actor: ReminderActor) {
  const row = await db.actionReminder.findFirst({
    where: { id: reminderId, projectId, userId: actor.userId, deviceKey: actor.deviceKey },
  });
  if (!row) {
    throw new AppError("REMINDER_NOT_FOUND", "提醒回执不存在或不属于当前设备", 404);
  }
  return row;
}

/** 批量排程已经把这条行动写进设备日历时，单待办视图必须看到同一个事实 */
async function loadConfirmedPlanBlock(projectId: string, actionId: string, userId: string) {
  return db.scheduleBlock.findFirst({
    where: { actionId, plan: { projectId, userId, status: "CONFIRMED" } },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      planId: true,
      startAt: true,
      endAt: true,
      calendarId: true,
      calendarEventId: true,
      calendarSyncStatus: true,
      calendarError: true,
    },
  });
}

function deleteOperation(
  reminder: {
    id: string;
    calendarId: string | null;
    calendarEventId: string | null;
    reminderAt: Date;
    durationMinutes: number;
  },
  title: string,
): DeviceCalendarOperation {
  // 起止时间必须一起返回：设备端删除前要用「事件编号 + 应用标记 + 标题 + 时间窗」
  // 四重核对，不能只凭编号就删，避免误删用户自己创建的日程。
  const endAt = new Date(reminder.reminderAt.getTime() + reminder.durationMinutes * 60_000);
  return {
    kind: "DELETE",
    reminderId: reminder.id,
    calendarId: reminder.calendarId,
    eventId: reminder.calendarEventId,
    title: buildCalendarEventTitle(title),
    start: iso(reminder.reminderAt),
    end: iso(endAt),
    durationMinutes: reminder.durationMinutes,
    prefix: CALENDAR_EVENT_PREFIX,
    reminderMinutesBeforeStart: [...REMINDER_MINUTES_BEFORE_START],
    note: "只删除忆程记录过的这一条自有日程；用户自己创建的日程不受影响。",
  };
}

function createOperation(
  reminderId: string,
  title: string,
  reminderAt: Date,
  durationMinutes: number,
): DeviceCalendarOperation {
  return {
    kind: "CREATE",
    reminderId,
    calendarId: null,
    eventId: null,
    title: buildCalendarEventTitle(title),
    start: iso(reminderAt),
    end: iso(new Date(reminderAt.getTime() + durationMinutes * 60_000)),
    durationMinutes,
    prefix: CALENDAR_EVENT_PREFIX,
    reminderMinutesBeforeStart: [...REMINDER_MINUTES_BEFORE_START],
    note: `在事件开始时提醒；默认持续 ${durationMinutes} 分钟。`,
  };
}

function buildCompletionPrompt(
  reminderStatus: ReminderLifecycleStatus,
  reminderAt: Date | null,
  now: Date,
): ReminderCompletionPrompt | null {
  if (!reminderAt) return null;
  if (reminderAt.getTime() <= now.getTime()) return null;
  if (!isOutstandingDeviceStatus(reminderStatus)) return null;
  return {
    required: true,
    question: "这条待办在设备日历里还有一条未来的日程，完成后要一起移除吗？",
    options: [
      { value: "REMOVE", label: "同时移除设备日历里的日程" },
      { value: "KEEP", label: "保留这条日程" },
    ],
  };
}

function resolveLifecycleStatus(
  reminderStatus: ReminderSyncStatus | null,
  blockStatus: string | null | undefined,
): { status: ReminderLifecycleStatus; source: ReminderSource } {
  if (reminderStatus && reminderStatus !== "REVOKED") {
    return { status: reminderStatus, source: "ACTION_REMINDER" };
  }
  const mapped = mapBlockCalendarStatusToReminderStatus(blockStatus);
  if (mapped !== "NOT_SCHEDULED") {
    return { status: mapped, source: "PLAN_BLOCK" };
  }
  if (reminderStatus === "REVOKED") {
    return { status: "REVOKED", source: "ACTION_REMINDER" };
  }
  return { status: "NOT_SCHEDULED", source: "NONE" };
}

/** 读取单条待办的提醒状态。只读，不产生任何业务写入 */
export async function getActionReminderState(
  projectId: string,
  actionId: string,
  actor: ReminderActor,
  now: Date = new Date(),
): Promise<ActionReminderState> {
  ensureReminderEnabled();
  const action = await loadAction(projectId, actionId);
  const [row, block] = await Promise.all([
    findReminderRow(projectId, actionId, actor),
    loadConfirmedPlanBlock(projectId, actionId, actor.userId),
  ]);

  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");
  const assessment = await assessActionFeasibility(projectId, actionId);

  const reminderStatus = (row?.syncStatus ?? null) as ReminderSyncStatus | null;
  const { status, source } = resolveLifecycleStatus(reminderStatus, block?.calendarSyncStatus);
  const copy = describeReminderStatus(status);

  const statusSchedulable = (REMINDABLE_ACTION_STATUSES as readonly string[]).includes(action.status);
  let blockedReason: string | null = null;
  if (!statusSchedulable) {
    blockedReason = action.status === "DONE"
      ? "这条待办已经完成。想继续安排时间，请先新建一条待办。"
      : "这条待办已取消，不能再安排提醒。";
  } else if (assessment.feasibility === "BLOCKED") {
    blockedReason = `${assessment.summary} 先处理阻塞，或补充前置依赖后再安排提醒。`;
  } else if (assessment.feasibility === "UNKNOWN") {
    blockedReason = `${assessment.summary} 请先补充缺失的信息，再安排提醒。`;
  }

  const outstandingFromReminder = row && isOutstandingDeviceStatus(row.syncStatus) && row.calendarEventId !== null;
  const outstandingDeviceEvent = outstandingFromReminder
    ? { reminderId: row!.id, calendarId: row!.calendarId, eventId: row!.calendarEventId!, source: "ACTION_REMINDER" as const }
    : block && isOutstandingDeviceStatus(block.calendarSyncStatus) && block.calendarEventId !== null
      ? { reminderId: row?.id ?? "", calendarId: block.calendarId, eventId: block.calendarEventId, source: "PLAN_BLOCK" as const }
      : null;

  const completionPrompt = action.status === "DONE"
    ? null
    : buildCompletionPrompt(status, row?.reminderAt ?? (block ? block.endAt : null), now);

  return {
    actionId,
    actionTitle: action.title,
    actionStatus: action.status,
    feasibility: assessment.feasibility,
    feasibilitySummary: assessment.summary,
    status,
    statusLabel: copy.label,
    statusDetail: copy.detail,
    source,
    reminder: row ? serializeReminder(row, action.title) : null,
    planBlock: block
      ? {
        planId: block.planId,
        blockId: block.id,
        start: iso(block.startAt),
        end: iso(block.endAt),
        calendarId: block.calendarId,
        calendarEventId: block.calendarEventId,
        calendarStatus: block.calendarSyncStatus,
        error: block.calendarError,
      }
      : null,
    canArrange: blockedReason === null,
    blockedReason,
    requiresRevokeBeforeChange: outstandingDeviceEvent !== null,
    outstandingDeviceEvent,
    completionPrompt,
    durationMinutes: row?.durationMinutes ?? DEFAULT_REMINDER_DURATION_MINUTES,
    permissionPurpose: CALENDAR_PERMISSION_PURPOSE,
  };
}

function reminderInputHash(input: {
  actionId: string;
  reminderAt: Date;
  durationMinutes: number;
  timezone: string;
  deviceKey: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    actionId: input.actionId,
    reminderAt: iso(input.reminderAt),
    durationMinutes: input.durationMinutes,
    timezone: input.timezone,
    deviceKey: input.deviceKey,
  })).digest("hex");
}

/**
 * 安排或修改提醒。幂等语义：
 * - 同 requestId 同载荷 → 重放当前状态，不重复建事件；
 * - 同 requestId 异载荷 → 409；
 * - 设备上已有自有事件 → 409 并要求先撤销，避免一次意图留下两个事件。
 */
export async function arrangeActionReminder(
  projectId: string,
  actionId: string,
  input: ArrangeReminderInput,
  actor: ReminderActor,
  now: Date = new Date(),
): Promise<ReminderMutationResult> {
  ensureReminderEnabled();
  if (!input.requestId || input.requestId.trim().length === 0) {
    throw new AppError("VALIDATION_ERROR", "requestId 不能为空", 422);
  }
  const action = await loadAction(projectId, actionId);
  if (action.isSimulated) {
    throw new AppError("SIMULATED_ACTION", "演示模拟待办不会写入真实日历提醒，请清除模拟后再操作", 409);
  }
  if (!(REMINDABLE_ACTION_STATUSES as readonly string[]).includes(action.status)) {
    throw new AppError(
      "REMINDER_ACTION_NOT_SCHEDULABLE",
      action.status === "DONE" ? "这条待办已完成，不能再安排提醒" : "这条待办已取消，不能再安排提醒",
      409,
    );
  }
  if (action.dedupeKey === null && action.title.trim().length === 0) {
    throw new AppError("VALIDATION_ERROR", "待办标题为空，无法生成日历事件", 422);
  }

  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");
  const assessment = await assessActionFeasibility(projectId, actionId);
  if (assessment.feasibility !== "READY") {
    // 受阻或无法确认的待办不能进时间安排：界面显示「先处理阻塞」而不是静默失败
    throw new AppError("REMINDER_ACTION_BLOCKED", `${assessment.summary} 请先处理阻塞或补充信息再安排提醒`, 409, {
      feasibility: assessment.feasibility,
      summary: assessment.summary,
      guidance: "PLAN_BLOCK" as const,
    });
  }

  const reminderAt = toDate(input.reminderAt, "reminderAt");
  if (reminderAt.getTime() - now.getTime() < MIN_LEAD_TIME_MS) {
    throw new AppError("INVALID_REMINDER_TIME", "提醒时间需要晚于当前时间至少 1 分钟", 422);
  }
  const durationMinutes = normalizeDuration(input.durationMinutes);
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
  const inputHash = reminderInputHash({ actionId, reminderAt, durationMinutes, timezone, deviceKey: actor.deviceKey });

  const existing = await findReminderRow(projectId, actionId, actor);
  if (existing) {
    if (existing.requestId === input.requestId) {
      if (existing.inputHash === inputHash) {
        return {
          reminder: serializeReminder(existing, action.title),
          devicePlan: [],
          message: "这次安排之前已经保存过，直接沿用原来的结果。",
        };
      }
      throw new AppError("REQUEST_ID_REUSED", "该 requestId 已用于不同的提醒安排，请换一个新的请求标识", 409);
    }
    if (isOutstandingDeviceStatus(existing.syncStatus)) {
      throw new AppError(
        "REMINDER_DEVICE_EVENT_EXISTS",
        "这条待办在设备日历里已经有日程，请先删除原日程再改时间，避免留下两条提醒",
        409,
        { reminderId: existing.id, calendarId: existing.calendarId, calendarEventId: existing.calendarEventId },
      );
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
      throw new AppError("REMINDER_REVISION_CHANGED", "提醒已被其他操作修改，请刷新后重试", 409);
    }
  }

  // 之前撤销过但可能尚未在设备上删除：先删后建，保证不会出现两条应用自有事件
  const staleDelete = existing && existing.calendarEventId !== null && existing.syncStatus !== "SYNCED" && existing.syncStatus !== "PENDING"
    ? deleteOperation(existing, action.title)
    : null;

  const saved = await db.actionReminder.upsert({
    where: {
      projectId_actionId_userId_deviceKey: {
        projectId,
        actionId,
        userId: actor.userId,
        deviceKey: actor.deviceKey,
      },
    },
    create: {
      projectId,
      actionId,
      userId: actor.userId,
      deviceKey: actor.deviceKey,
      requestId: input.requestId.trim(),
      reminderAt,
      durationMinutes,
      timezone,
      syncStatus: "PLANNED",
      inputHash,
      revision: 1,
    },
    update: {
      requestId: input.requestId.trim(),
      reminderAt,
      durationMinutes,
      timezone,
      syncStatus: "PLANNED",
      inputHash,
      calendarId: null,
      calendarEventId: null,
      error: null,
      revokedAt: null,
      completionChoice: null,
      revision: (existing?.revision ?? 1) + 1,
    },
  });

  return {
    reminder: serializeReminder(saved, action.title),
    devicePlan: [
      ...(staleDelete ? [staleDelete] : []),
      createOperation(saved.id, action.title, reminderAt, durationMinutes),
    ],
    message: staleDelete
      ? "已更新计划时间。请先在设备上删除原日程，再创建新的日程。"
      : "计划时间已保存。还需要写入设备日历，才会在到点时收到提醒。",
  };
}

/** 设备侧需要执行的一次日历操作；顺序由服务端决定（先删后建，避免留下重复事件） */
function compensationFor(reminderId: string, calendarId: string | null, eventId: string | null) {
  if (!eventId) return null;
  return {
    necessary: true,
    reminderId,
    calendarId,
    eventId,
    message: "设备上已经创建了这条日程，但忆程不能登记它。请在设备日历里删除这条自有日程，避免留下孤儿提醒。",
  };
}

/** 登记设备侧写入结果；没有 eventId 不允许标记为已写入 */
export async function recordActionReminderSync(
  projectId: string,
  reminderId: string,
  input: RecordReminderSyncInput,
  actor: ReminderActor,
): Promise<ActionReminderData> {
  ensureReminderEnabled();
  if (!REPORTABLE_STATUSES.includes(input.status)) {
    throw new AppError("INVALID_CALENDAR_RECEIPT", "不支持的回执状态", 422);
  }
  const row = await findReminderById(projectId, reminderId, actor);
  const action = await loadAction(projectId, row.actionId);
  if (row.syncStatus === "REVOKED") {
    // 回执已撤销时客户端仍可能已经把事件写进设备：明确给出补偿删除指令，不让它变成孤儿日程
    throw new AppError("REMINDER_REVOKED", "这条提醒已撤销，不能再登记写入结果", 409, {
      compensate: compensationFor(row.id, input.calendarId ?? null, input.eventId ?? null),
    });
  }

  const calendarId = input.calendarId ?? null;
  const eventId = input.eventId ?? null;
  try {
    assertDeviceCalendarReceipt({ status: input.status, calendarId, eventId });
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.code, error.message, error.status, {
        ...(typeof error.details === "object" && error.details !== null ? error.details : {}),
        compensate: compensationFor(row.id, calendarId, eventId),
      });
    }
    throw error;
  }

  if (input.status === "SYNCED") {
    if (row.syncStatus === "SYNCED") {
      if (row.calendarId === calendarId && row.calendarEventId === eventId) {
        return serializeReminder(row, action.title);
      }
      throw new AppError("CALENDAR_EVENT_ALREADY_RECORDED", "这条提醒已写入设备日历，请先撤销原日程再重新同步", 409, {
        compensate: compensationFor(row.id, calendarId, eventId),
      });
    }
    const duplicate = await db.actionReminder.findFirst({
      where: { id: { not: row.id }, calendarId, calendarEventId: eventId, syncStatus: "SYNCED" },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError("CALENDAR_EVENT_ALREADY_RECORDED", "该系统日历事件已登记到另一条提醒，不能重复绑定", 409, {
        compensate: compensationFor(row.id, calendarId, eventId),
      });
    }
    const blockDuplicate = await db.scheduleBlock.findFirst({
      where: { calendarId, calendarEventId: eventId, calendarSyncStatus: "SYNCED" },
      select: { id: true },
    });
    if (blockDuplicate) {
      throw new AppError("CALENDAR_EVENT_ALREADY_RECORDED", "该系统日历事件已登记到已确认的安排，不能重复绑定", 409, {
        compensate: compensationFor(row.id, calendarId, eventId),
      });
    }
  }

  const updated = await db.actionReminder.update({
    where: { id: row.id },
    data: {
      syncStatus: input.status,
      calendarId,
      calendarEventId: input.status === "SYNCED" ? eventId : row.calendarEventId,
      error: input.error?.trim() ? input.error.trim() : null,
      revision: row.revision + 1,
    },
  });
  return serializeReminder(updated, action.title);
}

/**
 * 撤销提醒。只针对回执里记录过的 eventId 生成删除指令，
 * 可安全重试：重复调用不会改变状态，也不会指向其他事件。
 */
export async function revokeActionReminder(
  projectId: string,
  reminderId: string,
  actor: ReminderActor,
): Promise<ReminderMutationResult> {
  ensureReminderEnabled();
  const row = await findReminderById(projectId, reminderId, actor);
  const action = await loadAction(projectId, row.actionId);

  if (row.syncStatus === "REVOKED") {
    return {
      reminder: serializeReminder(row, action.title),
      devicePlan: row.calendarEventId !== null ? [deleteOperation(row, action.title)] : [],
      message: "这条提醒此前已经撤销过，可以直接重试设备上的删除操作。",
    };
  }

  const shouldDelete = isOutstandingDeviceStatus(row.syncStatus) && row.calendarEventId !== null;
  const updated = await db.actionReminder.update({
    where: { id: row.id },
    data: {
      syncStatus: "REVOKED",
      revokedAt: new Date(),
      error: null,
      revision: row.revision + 1,
    },
  });
  return {
    reminder: serializeReminder(updated, action.title),
    devicePlan: shouldDelete ? [deleteOperation(updated, action.title)] : [],
    message: shouldDelete
      ? "提醒已撤销。请按返回的事件编号删除设备日历里的那一条自有日程。"
      : "提醒已撤销，设备上没有需要删除的自有日程。",
  };
}

export interface ReminderListItem {
  reminder: ActionReminderData;
  status: ReminderLifecycleStatus;
  statusLabel: string;
  statusDetail: string;
  source: ReminderSource;
}

/**
 * 当前设备可见的提醒与日程。
 * 单条提醒回执与已确认排程写入的时段一起返回，避免两处各说一套状态。
 */
export async function listActionReminders(
  projectId: string,
  actor: ReminderActor,
): Promise<{ reminders: ReminderListItem[]; planBlockEvents: ReminderListItem[] }> {
  ensureReminderEnabled();
  const rows = await db.actionReminder.findMany({
    where: { projectId, userId: actor.userId, deviceKey: actor.deviceKey },
    orderBy: { reminderAt: "asc" },
  });
  const blocks = await db.scheduleBlock.findMany({
    where: {
      plan: { projectId, userId: actor.userId, status: "CONFIRMED" },
      calendarEventId: { not: null },
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      planId: true,
      actionId: true,
      startAt: true,
      endAt: true,
      calendarId: true,
      calendarEventId: true,
      calendarSyncStatus: true,
      calendarError: true,
    },
  });

  const titleByActionId = new Map<string, string>();
  const actionIds = [...new Set([...rows.map((row) => row.actionId), ...blocks.map((block) => block.actionId)])];
  if (actionIds.length > 0) {
    const actions = await db.actionItem.findMany({
      where: { id: { in: actionIds }, projectId },
      select: { id: true, title: true },
    });
    for (const action of actions) titleByActionId.set(action.id, action.title);
  }

  const reminders: ReminderListItem[] = [];
  for (const row of rows) {
    const title = titleByActionId.get(row.actionId) ?? "";
    // 行内状态与已确认排程取并集：同一行动在设备上只应有一条有效记录
    const block = blocks.find((item) => item.actionId === row.actionId);
    const resolved = resolveLifecycleStatus(row.syncStatus as ReminderSyncStatus, block?.calendarSyncStatus);
    const copy = describeReminderStatus(resolved.status);
    reminders.push({
      reminder: serializeReminder(row, title),
      status: resolved.status,
      statusLabel: copy.label,
      statusDetail: copy.detail,
      source: resolved.source,
    });
  }

  const planBlockEvents: ReminderListItem[] = blocks
    .filter((block) => !rows.some((row) => row.actionId === block.actionId))
    .map((block) => {
      const status = mapBlockCalendarStatusToReminderStatus(block.calendarSyncStatus);
      const copy = describeReminderStatus(status);
      return {
        reminder: {
          id: block.id,
          projectId,
          actionId: block.actionId,
          actionTitle: titleByActionId.get(block.actionId) ?? "",
          deviceKey: actor.deviceKey,
          requestId: block.planId,
          reminderAt: iso(block.startAt),
          durationMinutes: Math.max(1, Math.round((block.endAt.getTime() - block.startAt.getTime()) / 60_000)),
          timezone: DEFAULT_TIMEZONE,
          calendarId: block.calendarId,
          calendarEventId: block.calendarEventId,
          syncStatus: status === "NOT_SCHEDULED" ? "PLANNED" : status,
          error: block.calendarError,
          completionChoice: null,
          revision: 1,
          createdAt: iso(block.startAt),
          updatedAt: iso(block.endAt),
          revokedAt: null,
        },
        status,
        statusLabel: copy.label,
        statusDetail: `${copy.detail} 这条来自「安排未来 7 天」的已确认计划。`,
        source: "PLAN_BLOCK" as const,
      };
    });

  return { reminders, planBlockEvents };
}

/**
 * 待办完成时的提醒处置。
 *
 * 顺序有意放在完成事务提交之后：完成回执本身是已经发生的事实，不能因为
 * 设备侧删除失败就回滚。因此这里返回补偿信息，由客户端重试撤销接口。
 */
export async function applyReminderDispositionOnCompletion(
  projectId: string,
  actionId: string,
  disposition: "KEEP" | "REMOVE",
  actor: ReminderActor,
  now: Date = new Date(),
): Promise<ReminderCompletionOutcome> {
  if (!isActionReminderEnabled()) {
    return { recorded: false, disposition: null, reminderId: null, devicePlan: [], compensation: { needed: false, message: "", revokeUrl: null } };
  }
  try {
    const row = await findReminderRow(projectId, actionId, actor);
    if (!row) {
      // 设备上的日程可能来自「安排未来 7 天」的已确认计划：那条事件的归属在计划时段上，
      // 不能由单待办提醒路径代删，也不能假装已经处理。这里如实指路。
      const block = await loadConfirmedPlanBlock(projectId, actionId, actor.userId);
      if (block && isOutstandingDeviceStatus(block.calendarSyncStatus) && block.calendarEventId !== null
        && block.endAt.getTime() > now.getTime()) {
        return {
          recorded: false,
          disposition: null,
          reminderId: null,
          devicePlan: [],
          compensation: {
            needed: false,
            message: "找不到这条待办的提醒回执；设备日历里的日程来自「安排未来 7 天」的已确认计划，请在那里撤销已同步的日程。完成待办不会自动删除它。",
            revokeUrl: null,
          },
        };
      }
      return { recorded: false, disposition: null, reminderId: null, devicePlan: [], compensation: { needed: false, message: "", revokeUrl: null } };
    }
    const action = await loadAction(projectId, actionId);
    if (disposition === "KEEP") {
      const updated = await db.actionReminder.update({
        where: { id: row.id },
        data: { completionChoice: "KEEP", revision: row.revision + 1 },
      });
      return {
        recorded: true,
        disposition: "KEEP",
        reminderId: updated.id,
        devicePlan: [],
        compensation: { needed: false, message: "设备日历里的日程会保留。", revokeUrl: null },
      };
    }

    const hasFutureEvent = isOutstandingDeviceStatus(row.syncStatus) &&
      row.calendarEventId !== null &&
      row.reminderAt.getTime() > now.getTime();
    const updated = await db.actionReminder.update({
      where: { id: row.id },
      data: {
        completionChoice: "REMOVE",
        syncStatus: hasFutureEvent ? "REVOKED" : row.syncStatus,
        revokedAt: hasFutureEvent ? now : row.revokedAt,
        revision: row.revision + 1,
      },
    });
    return {
      recorded: true,
      disposition: "REMOVE",
      reminderId: updated.id,
      devicePlan: hasFutureEvent ? [deleteOperation(updated, action.title)] : [],
      compensation: {
        needed: false,
        message: hasFutureEvent
          ? "请删除设备日历里的这一条自有日程。删除失败时可以再调用撤销接口重试。"
          : "这条待办没有需要移除的未来日程。",
        revokeUrl: hasFutureEvent ? `/api/projects/${projectId}/reminders/${updated.id}/revoke` : null,
      },
    };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "提醒处置写入失败";
    return {
      recorded: false,
      disposition,
      reminderId: null,
      devicePlan: [],
      compensation: {
        needed: true,
        message: `待办已经完成，但提醒处置没有写进去：${message}。可以稍后在待办详情里重新撤销提醒。`,
        revokeUrl: null,
      },
    };
  }
}
