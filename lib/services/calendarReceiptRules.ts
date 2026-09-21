/**
 * 设备系统日历回执的统一规则。
 *
 * 这里同时服务两条入口：
 * 1. 单条待办的日历提醒（ActionReminder，按设备归属，一份回执对应一次提醒意图）；
 * 2. 批量排程确认后的时段同步（ScheduleBlock.calendar*，按计划时段归属）。
 *
 * 两条入口必须共用同一套状态词表与校验，避免出现「排程说已同步、提醒说未安排」
 * 这种互相冲突的回执语义。判定「设备上是否真的存在本应用写入的事件」只有一个标准：
 * 回执里必须存在真实 eventId，且该事件由 ProjectMemo 用固定前缀创建。
 * ActionItem.dueAt 只表示项目内计划时间，永远不充当写入回执。
 */
import { AppError } from "@/lib/api";

/** 应用自有事件的固定前缀；更新/撤销只按记录过的 eventId 操作，绝不按标题模糊删除 */
export const CALENDAR_EVENT_PREFIX = "忆程·";

/** 首版固定时长；界面必须明确说明「默认持续 30 分钟」 */
export const DEFAULT_REMINDER_DURATION_MINUTES = 30;

/** 事件开始时提醒 */
export const REMINDER_MINUTES_BEFORE_START = [0];

/** 事件标题上限，避免超长待办标题在日历里被截断得无法辨认 */
const MAX_EVENT_TITLE_LENGTH = 60;

/** 单条提醒的状态词表。NOT_SCHEDULED 表示还没有任何提醒回执 */
export const REMINDER_SYNC_STATUSES = [
  "PLANNED",
  "PENDING",
  "SYNCED",
  "FAILED",
  "PERMISSION_DENIED",
  "MISSING",
  "UNSUPPORTED",
  "REVOKED",
] as const;

export type ReminderSyncStatus = (typeof REMINDER_SYNC_STATUSES)[number];

/** 含「尚未安排」的完整用户可见状态 */
export type ReminderLifecycleStatus = "NOT_SCHEDULED" | ReminderSyncStatus;

/** 批量排程时段沿用同一状态名，另外保留 NONE 表示从未尝试同步 */
export const BLOCK_CALENDAR_STATUSES = ["NONE", "PENDING", "SYNCED", "FAILED", "REVOKED"] as const;
export type BlockCalendarStatus = (typeof BLOCK_CALENDAR_STATUSES)[number];

/** 这些状态说明设备上可能仍存在我们写入的事件，删除必须走回执里记录的 eventId */
export function isOutstandingDeviceStatus(status: string | null | undefined): boolean {
  return status === "SYNCED" || status === "PENDING";
}

/** 提示：写入前需要向用户说明的用途文案，权限与不支持机型共用同一份解释 */
export const CALENDAR_PERMISSION_PURPOSE =
  "忆程需要在系统日历里创建一条日程，才能在设定的时间提醒你。日程标题以「忆程·」开头，只用于推送提醒。";

export function buildCalendarEventTitle(actionTitle: string): string {
  const trimmed = actionTitle.trim() || "待办提醒";
  const budget = Math.max(1, MAX_EVENT_TITLE_LENGTH - CALENDAR_EVENT_PREFIX.length);
  const clipped = trimmed.length > budget ? `${trimmed.slice(0, budget - 1)}…` : trimmed;
  return `${CALENDAR_EVENT_PREFIX}${clipped}`;
}

/**
 * 把排程时段已有的同步状态映射到提醒的状态词表。
 * 一个行动已经通过批量排程写进设备日历时，单待办提醒界面必须看到同一个事实，
 * 而不是显示「尚未安排」。
 */
export function mapBlockCalendarStatusToReminderStatus(status: string | null | undefined): ReminderLifecycleStatus {
  switch (status) {
    case "SYNCED":
      return "SYNCED";
    case "PENDING":
      return "PENDING";
    case "FAILED":
      return "FAILED";
    case "REVOKED":
      return "REVOKED";
    default:
      return "NOT_SCHEDULED";
  }
}

export interface ReminderStatusCopy {
  /** 面向用户的自然中文，不出现工程枚举 */
  label: string;
  detail: string;
}

/**
 * 状态 → 自然文案。界面不得直接显示 PLANNED/FAILED/SYNCED 这类枚举，
 * 辅助说明里只允许出现「可以开始」「还有前置事项」「暂时无法确认」这样的自然表达。
 */
export function describeReminderStatus(status: ReminderLifecycleStatus): ReminderStatusCopy {
  switch (status) {
    case "NOT_SCHEDULED":
      return { label: "还没安排提醒", detail: "可以选一个时间，到点由系统日历提醒你。" };
    case "PLANNED":
      return {
        label: "已保存计划时间，还没写进设备日历",
        detail: "计划时间只记在忆程里。要在设备上收到提醒，还需要写入系统日历。",
      };
    case "PENDING":
      return { label: "正在写入设备日历", detail: "写入完成后才会有真实的日历事件编号。" };
    case "SYNCED":
      return { label: "已写入设备日历", detail: "设备日历里已有这条日程，到点会提醒。" };
    case "FAILED":
      return { label: "写入设备日历失败", detail: "计划时间仍保留在忆程里，可以重试写入。" };
    case "PERMISSION_DENIED":
      return {
        label: "日历权限被拒绝",
        detail: "计划时间已保存。想收到提醒，需要到系统设置里允许忆程使用日历。",
      };
    case "MISSING":
      return {
        label: "设备上的日程已不存在",
        detail: "记录里的日历事件编号在当前设备上找不到对应日程，可能是被手动删除了。",
      };
    case "UNSUPPORTED":
      return {
        label: "这台设备不支持系统日历",
        detail: "只保存了项目内的计划时间，不会有设备级提醒。",
      };
    case "REVOKED":
      return { label: "提醒已撤销", detail: "设备日历里的对应日程已移除，计划时间也不再提醒。" };
    default:
      return { label: "提醒状态未知", detail: "请重新打开这条待办查看。" };
  }
}

export interface DeviceCalendarReceiptInput {
  status: string;
  calendarId?: string | null;
  eventId?: string | null;
}

/**
 * 回执校验：写入成功必须有真实事件编号，失败类回执不能携带事件编号。
 * 没有 eventId 就不允许报告「已写入设备日历」，避免假成功。
 *
 * PENDING 表示「正在写入」：此时设备还没返回编号，因此不要求、也不允许携带 eventId，
 * 否则就成了用假编号冒充写入回执。
 */
export function assertDeviceCalendarReceipt(input: DeviceCalendarReceiptInput): asserts input is DeviceCalendarReceiptInput {
  const { status } = input;
  if (status === "SYNCED") {
    if (!input.calendarId?.trim() || !input.eventId?.trim()) {
      throw new AppError("INVALID_CALENDAR_RECEIPT", "成功回执必须包含 calendarId 与 eventId", 422);
    }
    return;
  }
  if (input.eventId) {
    throw new AppError("INVALID_CALENDAR_RECEIPT", "尚未写入或写入失败的回执不能登记 eventId", 422);
  }
}

/** 设备侧需要执行的一次日历操作；顺序由服务端决定（先删后建，避免留下重复事件） */
export interface DeviceCalendarOperation {
  kind: "CREATE" | "DELETE";
  reminderId: string;
  /** DELETE 用于定位本应用写过的事件；CREATE 后由客户端回报真实编号 */
  calendarId: string | null;
  eventId: string | null;
  title: string;
  start: string | null;
  end: string | null;
  durationMinutes: number;
  prefix: string;
  reminderMinutesBeforeStart: number[];
  note: string;
}
