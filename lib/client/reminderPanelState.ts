/**
 * 单待办提醒面板的展示决策（纯函数，可被测试固定）。
 *
 * 这里只做一件事：把服务端返回的状态翻译成「现在允许做什么、必须先做什么」。
 * 目标是消灭两种坏交互：
 * 1. 点下去必然 409 的按钮（设备上已有自有日程时仍允许直接改时间）；
 * 2. 把「服务端已撤销」「设备事件已写入」「计划时间已保存」三件事说成一件事。
 */

export type ReminderLifecycleStatus =
  | "NOT_SCHEDULED"
  | "PLANNED"
  | "PENDING"
  | "SYNCED"
  | "FAILED"
  | "PERMISSION_DENIED"
  | "MISSING"
  | "UNSUPPORTED"
  | "REVOKED";

export interface ReminderPanelInput {
  status: string;
  /** 服务端判断当前是否可以安排（受阻/已完成时为 false） */
  canArrange: boolean;
  /** 设备日历里已有本应用创建的事件：必须先撤销并确认设备清理 */
  requiresRevokeBeforeChange: boolean;
  blockedReason: string | null;
  /** 乐观版本号；有提醒记录时必须随修改请求提交 */
  revision: number | null;
  /** 是否已经存在提醒回执（决定首次创建 vs 修改） */
  hasReminderRecord: boolean;
  calendarEventId: string | null;
  calendarId: string | null;
}

export interface ReminderPanelDecision {
  /** 是否允许提交新的日期时间（false 时界面不得出现可提交的表单） */
  canSubmitTime: boolean;
  /** 不允许提交时的原因，直接展示给用户 */
  reason: string | null;
  /** 是否必须回到鸿蒙客户端处理设备上的日程 */
  requiresHarmonyDevice: boolean;
  /** 计划时间的状态文案 */
  planStateLabel: string;
  /** 设备日历事件的状态文案 */
  deviceStateLabel: string;
  /** 界面应引导的下一步 */
  nextStep: string;
  /** 提交时是否需要带 expectedRevision（修改已有提醒时必须带） */
  requiresExpectedRevision: boolean;
}

const REVOKE_FIRST_REASON =
  "设备日历里已经有这条待办的自有日程。要先撤销原提醒，并确认设备上的日程已删除，才能改到新的时间。";
const HARMONY_HINT = "浏览器不能读写系统日历；设备上的日程删除需要在鸿蒙客户端完成。";

export function resolveReminderPanel(input: ReminderPanelInput): ReminderPanelDecision {
  const status = input.status as ReminderLifecycleStatus;
  const requiresExpectedRevision = input.hasReminderRecord;
  /**
   * 设备上是否已经存在忆程创建的事件。
   * 不只看服务端的 requiresRevokeBeforeChange 一个字段：只要状态是「已写入/正在写入」
   * 且回执里记着事件编号，就必须先撤销，避免客户端因字段缺失而放出一个必然 409 的提交。
   */
  const deviceEventExists = input.requiresRevokeBeforeChange
    || ((status === "SYNCED" || status === "PENDING") && input.calendarEventId !== null);

  let planStateLabel = "还没有安排计划时间";
  if (input.hasReminderRecord) {
    planStateLabel = status === "REVOKED" ? "计划时间已撤销" : "计划时间已保存，可继续改时间";
  }

  let deviceStateLabel: string;
  if (status === "SYNCED") deviceStateLabel = "设备日历里已有这条日程";
  else if (status === "PENDING") deviceStateLabel = "正在写入设备日历";
  else if (status === "REVOKED" && input.calendarEventId !== null) deviceStateLabel = "服务端已撤销，设备上的旧日程待清理";
  else if (status === "REVOKED") deviceStateLabel = "设备上没有这条日程";
  else if (input.calendarEventId !== null) deviceStateLabel = "设备上有登记过的日程";
  else deviceStateLabel = "还没有写进设备日历";

  if (!input.canArrange) {
    return {
      canSubmitTime: false,
      reason: input.blockedReason ?? "这条待办当前不能安排提醒。",
      requiresHarmonyDevice: false,
      planStateLabel,
      deviceStateLabel,
      nextStep: "先处理阻塞",
      requiresExpectedRevision,
    };
  }

  // 设备上已有自有事件：直接禁止提交，避免点击后必然 409
  if (deviceEventExists) {
    return {
      canSubmitTime: false,
      reason: `${REVOKE_FIRST_REASON}${HARMONY_HINT}`,
      requiresHarmonyDevice: true,
      planStateLabel,
      deviceStateLabel,
      nextStep: "先撤销原提醒",
      requiresExpectedRevision,
    };
  }

  const needsCleanupRetry = status === "REVOKED" && input.calendarEventId !== null;
  return {
    canSubmitTime: true,
    reason: null,
    requiresHarmonyDevice: needsCleanupRetry,
    planStateLabel,
    deviceStateLabel,
    nextStep: needsCleanupRetry
      ? "可以保存新的计划时间；设备上的旧日程请在鸿蒙客户端删除"
      : (requiresExpectedRevision ? "改到新的时间" : "保存计划时间"),
    requiresExpectedRevision,
  };
}
