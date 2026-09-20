/**
 * R2 可执行安排契约。排程是确定性规则，不声称最优；
 * DRAFT 只是预览，CONFIRMED 才占用应用内时段。
 */

export type SchedulePlanStatus = "DRAFT" | "CONFIRMED" | "STALE" | "SUPERSEDED" | "CANCELLED";

/** 每个未安排行动都必须有原因；不允许 500 或静默丢弃 */
export type ScheduleSkipReasonCode =
  | "MISSING_ESTIMATE"
  | "BLOCKED"
  | "UNKNOWN"
  | "NO_CAPACITY"
  | "CROSS_PROJECT_CONFLICT"
  | "VERSION_CHANGED"
  | "ALREADY_SCHEDULED"
  | "DONE_OR_CANCELLED";

export interface ScheduleSkipReason {
  actionId: string;
  actionTitle: string;
  reasonCode: ScheduleSkipReasonCode;
  message: string;
}

export interface ScheduleSlotInput {
  /** ISO 8601 绝对时刻；跨午夜/DST 由客户端按显式时区换算成时刻传入 */
  start: string;
  end: string;
}

export interface ScheduleLockedBlockInput {
  actionId?: string;
  /** 锁定已有行动的时段；新块不使用 */
  title?: string;
  start: string;
  end: string;
}

export interface SchedulePreviewInput {
  requestId: string;
  timezone?: string;
  rangeStart: string;
  rangeEnd: string;
  /** 未来 7 天可用时间窗；先合并重叠、剔除空区间，再扣除占用 */
  slots: ScheduleSlotInput[];
  /** 用户指定要安排的行动；缺省时取检查点建议或全部 READY 行动 */
  actionIds?: string[];
  episodeRevisionId?: string;
  lockedBlocks?: ScheduleLockedBlockInput[];
}

export interface ScheduleBlockData {
  id: string | null;
  actionId: string;
  actionTitle: string;
  /** 行动 dependencyVersion；确认前重新读取比对 */
  actionVersion: number;
  start: string;
  end: string;
  locked: boolean;
  /** 系统日历同步回执；只记录 ProjectMemo 自己写入的事件 */
  calendar: ScheduleCalendarState;
}

export type CalendarSyncStatus = "NONE" | "PENDING" | "SYNCED" | "FAILED" | "REVOKED";

export interface ScheduleCalendarState {
  status: CalendarSyncStatus;
  calendarId: string | null;
  eventId: string | null;
  syncedAt: string | null;
  error: string | null;
}

export interface SchedulePlanData {
  id: string;
  projectId: string;
  /** 个人时间的所有者；来自鉴权结果，不接受客户端传入 */
  userId: string | null;
  episodeRevisionId: string | null;
  requestId: string;
  timezone: string;
  rangeStart: string;
  rangeEnd: string;
  version: number;
  status: SchedulePlanStatus;
  blocks: ScheduleBlockData[];
  scheduled: ScheduleBlockData[];
  unscheduled: ScheduleSkipReason[];
  createdAt: string;
  updatedAt: string;
}
