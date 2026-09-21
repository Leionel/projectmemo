// ---- 单条待办的日历提醒生命周期（与 lib/services/actionReminderService.ts 契约一致） ----
//
// 三种状态必须分开，界面不能混为一谈：
// 1. 项目内计划时间（reminderAt）：只在忆程里，不代表设备上有日程；
// 2. 设备系统日历事件（calendarEventId 且已写入）：只有拿到真实编号才算写入；
// 3. 待办完成（行动状态）：与上面两者互不等价。

export class ReminderDeviceOp {
  /** CREATE | DELETE */
  kind: string = 'CREATE';
  reminderId: string = '';
  calendarId: string | null = null;
  eventId: string | null = null;
  title: string = '';
  start: string = '';
  end: string = '';
  durationMinutes: number = 30;
  prefix: string = '忆程·';
  /** 0 表示在事件开始时提醒：与设备写入时写入日历的 reminderTime 保持一致 */
  reminderMinutesBeforeStart: number[] = [0];
  note: string = '';
}

export class ActionReminder {
  id: string = '';
  projectId: string = '';
  actionId: string = '';
  actionTitle: string = '';
  deviceKey: string = '';
  requestId: string = '';
  reminderAt: string = '';
  durationMinutes: number = 30;
  timezone: string = '';
  calendarId: string | null = null;
  calendarEventId: string | null = null;
  syncStatus: string = 'PLANNED';
  error: string | null = null;
  completionChoice: string | null = null;
  revision: number = 1;
  createdAt: string = '';
  updatedAt: string = '';
  revokedAt: string | null = null;
}

export class ReminderOutstandingEvent {
  reminderId: string | null = null;
  calendarId: string | null = null;
  eventId: string = '';
  /** ACTION_REMINDER | PLAN_BLOCK */
  source: string = 'ACTION_REMINDER';
}

export class ReminderPlanBlock {
  planId: string = '';
  blockId: string = '';
  start: string = '';
  end: string = '';
  calendarId: string | null = null;
  calendarEventId: string | null = null;
  calendarStatus: string | null = null;
  error: string | null = null;
}

export class ReminderCompletionOption {
  value: string = '';
  label: string = '';
}

export class ReminderCompletionPrompt {
  required: boolean = false;
  question: string = '';
  options: ReminderCompletionOption[] = [];
}

export class ActionReminderState {
  actionId: string = '';
  actionTitle: string = '';
  actionStatus: string = '';
  feasibility: string = 'READY';
  feasibilitySummary: string = '';
  /** NOT_SCHEDULED | PLANNED | PENDING | SYNCED | FAILED | PERMISSION_DENIED | MISSING | UNSUPPORTED | REVOKED */
  status: string = 'NOT_SCHEDULED';
  statusLabel: string = '';
  statusDetail: string = '';
  source: string = 'NONE';
  reminder: ActionReminder | null = null;
  planBlock: ReminderPlanBlock | null = null;
  canArrange: boolean = false;
  blockedReason: string | null = null;
  requiresRevokeBeforeChange: boolean = false;
  outstandingDeviceEvent: ReminderOutstandingEvent | null = null;
  completionPrompt: ReminderCompletionPrompt | null = null;
  durationMinutes: number = 30;
  permissionPurpose: string = '';
}

export class ActionReminderStateResponse {
  state: ActionReminderState = new ActionReminderState();
}

export class ReminderMutationResponse {
  reminder: ActionReminder = new ActionReminder();
  /** 客户端按顺序执行的设备日历操作：先删后建，避免留下两条应用自有事件 */
  devicePlan: ReminderDeviceOp[] = [];
  message: string = '';
  /** 幂等重放：同 requestId 重复提交返回同一回执 */
  replayed: boolean = false;
  /** 操作针对历史已撤销/已存在的提醒 */
  historical: boolean = false;
}

// ---- 请求体 ----

export class ReminderArrangeBody {
  requestId: string = '';
  reminderAt: string = '';
  durationMinutes: number = 30;
  deviceKey: string = '';
  /** 修改已有提醒时的乐观版本号；首次创建传 0（或不传） */
  expectedRevision: number = 0;
}

export class ReminderSyncBody {
  status: string = '';
  calendarId: string | null = null;
  eventId: string | null = null;
  error: string | null = null;
  deviceKey: string = '';
}

export class ReminderRevokeBody {
  deviceKey: string = '';
  /** 幂等请求编号：一次用户撤销意图一个，重试沿用 */
  requestId: string = '';
}

// ---- 服务端返回之外的本地结果 ----

/**
 * 设备侧清理结果汇总：只有每条都 DELETED 或 ALREADY_MISSING 时 confirmed 才为真。
 * 用于区分「服务端已撤销」与「设备日程已确认删除」，避免虚假成功。
 */
export class DeviceCleanupSummary {
  requested: number = 0;
  deleted: number = 0;
  alreadyMissing: number = 0;
  unverified: number = 0;
  permissionDenied: number = 0;
  calendarNotFound: number = 0;
  failed: number = 0;
  /** 仍需重试清理的自有事件编号，界面据此提供「重试删除设备日程」 */
  pendingEventIds: string[] = [];
  pendingCalendarIds: string[] = [];
  /** 只有每条都 DELETED 或 ALREADY_MISSING 时才为 true */
  confirmed: boolean = false;
  /** 面向用户的自然中文结果 */
  message: string = '';
}

export class ReminderOutcome {
  /** 服务端是否完成了请求（撤销 / 写入） */
  ok: boolean = false;
  /** 设备侧是否确认清理干净 */
  deviceConfirmed: boolean = false;
  /** 设备清理结构化结果；未确认时据此提供重试 */
  cleanup: DeviceCleanupSummary = new DeviceCleanupSummary();
  /** 面向用户的自然中文结果；成功时必须说明实际完成了什么 */
  message: string = '';
  /** 需要用户确认的系统日历冲突（不静默覆盖） */
  conflictTitles: string[] = [];
  needsConflictConfirm: boolean = false;
  state: ActionReminderState | null = null;
}

/** 待办完成时的提醒处置结果：完成回执先提交，设备删除由设备侧补偿执行 */
export class ReminderCompensation {
  needed: boolean = false;
  message: string = '';
  revokeUrl: string | null = null;
}

export class ReminderCompletionOutcome {
  recorded: boolean = false;
  disposition: string | null = null;
  reminderId: string | null = null;
  devicePlan: ReminderDeviceOp[] = [];
  compensation: ReminderCompensation = new ReminderCompensation();
}

/** 状态 → 自然文案兜底：服务端已给出中文，这里只用于本地先行展示 */
export class ReminderStatusCopy {
  static label(status: string): string {
    if (status === 'NOT_SCHEDULED') return '还没安排提醒';
    if (status === 'PLANNED') return '已保存计划时间，还没写进设备日历';
    if (status === 'PENDING') return '正在写入设备日历';
    if (status === 'SYNCED') return '已写入设备日历';
    if (status === 'FAILED') return '写入设备日历失败';
    if (status === 'PERMISSION_DENIED') return '日历权限被拒绝';
    if (status === 'MISSING') return '设备上的日程已不存在';
    if (status === 'UNSUPPORTED') return '这台设备不支持系统日历';
    if (status === 'REVOKED') return '提醒已撤销';
    return '提醒状态未知';
  }

  /** 这些状态下设备上可能仍有忆程写入的事件，删除必须走回执记录的事件编号 */
  static hasOwnDeviceEvent(status: string): boolean {
    return status === 'SYNCED' || status === 'PENDING';
  }
}
