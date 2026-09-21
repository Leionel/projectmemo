import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ApiError } from '../models/Project';
import { DeviceIdentity } from '../common/DeviceIdentity';
import { ScheduleBlock } from '../models/Reentry';
import { CalendarSyncService, CalendarOption, CalendarConflict } from './CalendarSyncService';
import { ApiClient } from './ApiClient';
import {
  ActionReminderState,
  ActionReminderStateResponse,
  DeviceCleanupSummary,
  ReminderArrangeBody,
  ReminderDeviceOp,
  ReminderMutationResponse,
  ReminderOutcome,
  ReminderRevokeBody,
  ReminderSyncBody,
} from '../models/Reminder';

const TAG = 'ReminderService';
const DOMAIN = 0x0000;

/** 授权被拒后如何恢复的说明；与界面文案共用同一份，避免各处说法不一致 */
const PERMISSION_RECOVERY_HINT = '到系统设置 → 应用 → 忆程 → 权限里允许「日历」的读取与写入，再回来重试。';

/**
 * 单条待办的日历提醒。
 *
 * 分工：
 * - 计划时间由服务端持久化（ActionReminder 回执），dueAt 不代表设备上有事件；
 * - 设备日历写入与删除复用 CalendarSyncService：只操作忆程自己创建的事件，
 *   删除前同时核对事件编号、标题前缀、应用描述标记与时间窗，绝不按标题模糊删除。
 */
export class ReminderService {
  private api: ApiClient = new ApiClient();

  /**
   * 功能开关探测：开关关闭时服务端返回 503 PROJECT_CALENDAR_REMINDER_DISABLED。
   * 入口按钮据此决定是否显示，避免用户点下去才看到模糊错误。
   */
  async isAvailable(projectId: string): Promise<boolean> {
    try {
      const deviceKey = DeviceIdentity.getConsumerKey();
      await this.api.get<Object>(`/api/projects/${projectId}/reminders?deviceKey=${encodeURIComponent(deviceKey)}`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PROJECT_CALENDAR_REMINDER_DISABLED') {
        return false;
      }
      // 其他错误（网络等）不隐藏入口：用户重试即可，不能因为一次网络失败就永久关掉能力
      return true;
    }
  }

  /** 读取某条待办的提醒状态；只读，不产生业务写入 */
  async load(projectId: string, actionId: string): Promise<ActionReminderState> {
    const deviceKey = DeviceIdentity.getConsumerKey();
    const response = await this.api.get<ActionReminderStateResponse>(
      `/api/projects/${projectId}/actions/${actionId}/reminder?deviceKey=${encodeURIComponent(deviceKey)}`,
    );
    return response.state;
  }

  /**
   * 保存或修改计划时间（不写设备日历）。
   * requestId 由调用方保证「一次用户意图一个」以实现幂等；expectedRevision 修改已有提醒时必带，
   * 首次创建传 0（或不传）。服务端按 requestId 判定幂等，同载荷重放返回同一个回执。
   */
  async arrange(projectId: string, actionId: string, requestId: string, reminderAtIso: string, durationMinutes: number,
    expectedRevision: number = 0): Promise<ReminderMutationResponse> {
    const body = new ReminderArrangeBody();
    body.requestId = requestId;
    body.reminderAt = reminderAtIso;
    body.durationMinutes = durationMinutes;
    body.deviceKey = DeviceIdentity.getConsumerKey();
    body.expectedRevision = expectedRevision;
    return await this.api.post<ReminderMutationResponse>(
      `/api/projects/${projectId}/actions/${actionId}/reminder`,
      body,
    );
  }

  /** 登记设备侧写入结果；没有真实事件编号不允许报告已写入 */
  async reportSync(projectId: string, reminderId: string, status: string, calendarId: string | null,
    eventId: string | null, error: string | null): Promise<void> {
    const body = new ReminderSyncBody();
    body.status = status;
    body.calendarId = calendarId;
    body.eventId = eventId;
    body.error = error;
    body.deviceKey = DeviceIdentity.getConsumerKey();
    await this.api.post<Object>(`/api/projects/${projectId}/reminders/${reminderId}/sync`, body);
  }

  /** 撤销提醒回执；服务端返回需要删除的自有事件编号 */
  async revoke(projectId: string, reminderId: string, requestId: string): Promise<ReminderMutationResponse> {
    const body = new ReminderRevokeBody();
    body.deviceKey = DeviceIdentity.getConsumerKey();
    body.requestId = requestId;
    return await this.api.post<ReminderMutationResponse>(
      `/api/projects/${projectId}/reminders/${reminderId}/revoke`,
      body,
    );
  }

  /**
   * 把计划时间写入设备日历。
   *
   * 顺序与补偿：
   * 1. 能力探测 → 不支持就如实回退为「仅保存项目计划时间」，并登记 UNSUPPORTED；
   * 2. 首次实际使用时申请权限 → 被拒时保留用户填写的日期时间，并登记 PERMISSION_DENIED；
   * 3. 写入前查冲突 → 有冲突先让用户确认，不静默覆盖；
   * 4. 设备写入成功后才向服务端登记真实事件编号；
   * 5. 服务端登记失败时删除刚写入的事件（补偿），不让设备留下孤儿日程。
   */
  async writeToDevice(context: common.Context, projectId: string, reminderId: string, actionTitle: string,
    reminderAtIso: string, durationMinutes: number, conflictConfirmed: boolean): Promise<ReminderOutcome> {
    const outcome = new ReminderOutcome();
    const capability = await CalendarSyncService.inspect(context);
    if (!capability.supported) {
      // 设备不支持：只保存项目内计划时间，不显示假成功
      await this.safeReport(projectId, reminderId, 'UNSUPPORTED', null, null,
        capability.reason !== '' ? capability.reason : '当前设备不支持系统日历');
      outcome.message = `${capability.reason}。忆程只保存了项目内的计划时间，不会有设备级提醒。`;
      return outcome;
    }

    if (!capability.granted) {
      const permission = await CalendarSyncService.requestPermission(context);
      if (!permission.granted) {
        // 拒绝后保留用户填写的日期时间，并说明如何重新授权
        await this.safeReport(projectId, reminderId, 'PERMISSION_DENIED', null, null,
          permission.reason !== '' ? permission.reason : '用户拒绝了日历权限');
        outcome.message = `没有获得日历权限，计划时间已保留在忆程里。${PERMISSION_RECOVERY_HINT}`;
        return outcome;
      }
    }

    const options: CalendarOption[] = await CalendarSyncService.listCalendars(context);
    const calendarId = options.length > 0 ? options[0].id : '';
    const block = ReminderService.toBlock(reminderId, actionTitle, reminderAtIso, durationMinutes);

    if (!conflictConfirmed) {
      const conflicts: CalendarConflict[] = await CalendarSyncService.findConflicts(context, calendarId, [block]);
      if (conflicts.length > 0) {
        for (const conflict of conflicts) {
          outcome.conflictTitles.push(conflict.existingTitle);
        }
        outcome.needsConflictConfirm = true;
        outcome.message = `这个时段已有 ${conflicts.length} 条日程，忆程不会自动覆盖它们。确认后仍要写入吗？`;
        return outcome;
      }
    }

    // 先登记「正在写入」，让服务端状态与设备进度一致
    await this.safeReport(projectId, reminderId, 'PENDING', calendarId, null, null);

    const entries = await CalendarSyncService.writeBlocks(context, calendarId, [block]);
    const entry = entries.length > 0 ? entries[0] : undefined;
    if (entry === undefined || entry.status !== 'SYNCED' || entry.eventId === null || entry.eventId === '') {
      const reason = entry !== undefined && entry.error !== null && entry.error !== ''
        ? entry.error
        : '系统日历写入失败';
      await this.safeReport(projectId, reminderId, 'FAILED', null, null, reason);
      outcome.message = `${reason}。计划时间仍保留在忆程里，可以重试写入。${PERMISSION_RECOVERY_HINT}`;
      return outcome;
    }

    try {
      await this.reportSync(projectId, reminderId, 'SYNCED', entry.calendarId, entry.eventId, null);
    } catch (error) {
      // 设备已写入、服务端登记失败：删除刚写入的自有事件，不留孤儿日程
      const rollbackBlock = ReminderService.toBlock(reminderId, actionTitle, reminderAtIso, durationMinutes);
      rollbackBlock.calendar.status = 'SYNCED';
      rollbackBlock.calendar.calendarId = entry.calendarId;
      rollbackBlock.calendar.eventId = entry.eventId;
      const results = await CalendarSyncService.deleteOwnedEvents(context, calendarId, [rollbackBlock]);
      const cleaned = results.length > 0 && results.every((result) => result.state === 'DELETED' || result.state === 'ALREADY_MISSING');
      const detail = error instanceof ApiError ? error.message : '服务端暂时无法登记这次写入';
      if (cleaned) {
        outcome.message = `${detail}。设备上刚创建的日程已删除，避免留下无法管理的提醒；计划时间仍然保留。`;
      } else {
        // 没有确认删除就不能报「已删除」：如实告诉用户去系统日历检查
        outcome.deviceConfirmed = false;
        outcome.message = `${detail}。刚写入的日程没有确认删除，请到系统日历检查「忆程·」事件；计划时间仍然保留。`;
      }
      return outcome;
    }

    outcome.ok = true;
    outcome.message = `已写入设备日历：${ReminderService.previewTime(reminderAtIso)}，默认持续 ${durationMinutes} 分钟，在事件开始时提醒。`;
    return outcome;
  }

  /**
   * 执行服务端给出的设备操作计划（先删后建），返回结构化清理结果。
   * 只有每条都 DELETED 或 ALREADY_MISSING 时 summary.confirmed 才为真；
   * 权限被拒 / 日历不存在 / 核验未通过 / 删除报错都不算清理成功，必须如实上报。
   */
  async applyDevicePlanDetailed(context: common.Context, devicePlan: ReminderDeviceOp[]): Promise<DeviceCleanupSummary> {
    const summary = new DeviceCleanupSummary();
    const targets: ScheduleBlock[] = [];
    for (const op of devicePlan) {
      if (op.kind !== 'DELETE' || op.eventId === null || op.eventId === '') {
        continue;
      }
      const block = new ScheduleBlock();
      block.id = op.reminderId;
      block.actionTitle = ReminderService.stripPrefix(op.title, op.prefix);
      block.start = op.start;
      block.end = op.end;
      block.calendar.status = 'SYNCED';
      block.calendar.calendarId = op.calendarId;
      block.calendar.eventId = op.eventId;
      targets.push(block);
    }
    if (targets.length === 0) {
      summary.requested = 0;
      summary.confirmed = true;
      summary.message = '没有需要清理的设备日程。';
      return summary;
    }
    const calendarId = targets[0].calendar.calendarId !== null ? targets[0].calendar.calendarId : '';
    const results = await CalendarSyncService.deleteOwnedEvents(context, calendarId, targets);
    for (const result of results) {
      summary.requested += 1;
      if (result.state === 'DELETED') {
        summary.deleted += 1;
      } else if (result.state === 'ALREADY_MISSING') {
        summary.alreadyMissing += 1;
      } else if (result.state === 'UNVERIFIED') {
        summary.unverified += 1;
        summary.pendingEventIds.push(result.eventId);
        summary.pendingCalendarIds.push(result.calendarId);
      } else if (result.state === 'PERMISSION_DENIED') {
        summary.permissionDenied += 1;
        summary.pendingEventIds.push(result.eventId);
        summary.pendingCalendarIds.push(result.calendarId);
      } else if (result.state === 'CALENDAR_NOT_FOUND') {
        summary.calendarNotFound += 1;
        summary.pendingEventIds.push(result.eventId);
        summary.pendingCalendarIds.push(result.calendarId);
      } else {
        summary.failed += 1;
        summary.pendingEventIds.push(result.eventId);
        summary.pendingCalendarIds.push(result.calendarId);
      }
    }
    summary.confirmed = summary.requested > 0 && (summary.deleted + summary.alreadyMissing) === summary.requested;
    if (summary.confirmed) {
      summary.message = summary.requested === 0
        ? '没有需要清理的设备日程。'
        : `设备日历里的自有日程已确认清理（共 ${summary.deleted + summary.alreadyMissing} 条）。`;
    } else {
      summary.message = `设备日历里的自有日程还没有全部确认删除（待处理 ${summary.pendingEventIds.length} 条）。`;
    }
    hilog.info(DOMAIN, TAG, 'device cleanup summary: %{public}s', ReminderService.safeLogText(JSON.stringify(summary)));
    return summary;
  }

  /**
   * 兼容旧调用方（ActionBoard 的提醒处置提示）：返回面向用户的自然中文结果字符串。
   * 新代码请改用 applyDevicePlanDetailed 拿到结构化结果。
   */
  async applyDevicePlan(context: common.Context, devicePlan: ReminderDeviceOp[]): Promise<string> {
    const summary = await this.applyDevicePlanDetailed(context, devicePlan);
    return summary.message;
  }

  /** 撤销提醒并清理设备上的自有日程 */
  async revokeAndRemove(context: common.Context, projectId: string, reminderId: string, requestId: string): Promise<ReminderOutcome> {
    const outcome = new ReminderOutcome();
    const mutation = await this.revoke(projectId, reminderId, requestId);
    const cleanup = await this.applyDevicePlanDetailed(context, mutation.devicePlan);
    outcome.ok = true;
    outcome.state = null;
    outcome.cleanup = cleanup;
    outcome.deviceConfirmed = cleanup.confirmed;
    if (!cleanup.confirmed) {
      // 未确认清理：权限被拒 / 日历不存在 / 核验未通过 / 删除报错，不得报「已删除」
      const reasons: string[] = [];
      if (cleanup.permissionDenied > 0) {
        reasons.push('日历权限被拒绝');
      }
      if (cleanup.calendarNotFound > 0) {
        reasons.push('目标日历不存在');
      }
      if (cleanup.unverified > 0) {
        reasons.push('部分日程核验未通过，不是忆程创建的');
      }
      if (cleanup.failed > 0) {
        reasons.push('删除设备日程时报错');
      }
      const reason = reasons.length > 0 ? reasons.join('、') : '原因未知';
      outcome.message = `服务端提醒已撤销，但设备日历里的日程还没有确认删除（${reason}）。请重试删除；如果仍然失败，请到系统日历检查「忆程·」事件。`;
    } else if (cleanup.deleted > 0) {
      outcome.message = `提醒已撤销，设备日历里的自有日程已删除（共 ${cleanup.deleted + cleanup.alreadyMissing} 条）。`;
    } else {
      outcome.message = '提醒已撤销；设备日历里没有找到忆程的这条日程，无需删除。';
    }
    return outcome;
  }

  private async safeReport(projectId: string, reminderId: string, status: string, calendarId: string | null,
    eventId: string | null, error: string | null): Promise<void> {
    try {
      await this.reportSync(projectId, reminderId, status, calendarId, eventId, error);
    } catch {
      // 回执登记失败不能阻断用户操作：下一次打开待办时会重新读取真实状态
    }
  }

  private static toBlock(reminderId: string, actionTitle: string, reminderAtIso: string, durationMinutes: number): ScheduleBlock {
    const block = new ScheduleBlock();
    block.id = reminderId;
    block.actionId = '';
    block.actionTitle = actionTitle;
    block.start = reminderAtIso;
    block.end = new Date(new Date(reminderAtIso).getTime() + durationMinutes * 60000).toISOString();
    return block;
  }

  private static stripPrefix(title: string, prefix: string): string {
    if (prefix !== '' && title.startsWith(prefix)) {
      return title.substring(prefix.length);
    }
    return title;
  }

  private static previewTime(iso: string): string {
    if (iso.length < 16) {
      return iso;
    }
    return `${iso.substring(0, 10)} ${iso.substring(11, 16)}`;
  }

  /**
   * 日志脱敏：把形如 Bearer <token>、token=xxx、"token":"xxx"、apiKey 的值替换成 [redacted]，
   * 并截断到 200 字符，避免把会话凭证写入日志。所有 hilog 调用都应经过它。
   */
  private static safeLogText(value: string): string {
    let text = value;
    text = text.replace(/Bearer\s+[^\s,"}]+/g, 'Bearer [redacted]');
    text = text.replace(/token=[^\s,&"]+/gi, 'token=[redacted]');
    text = text.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"[redacted]"');
    text = text.replace(/apikey\s*[:=]\s*[^\s,&"}]+/gi, 'apiKey=[redacted]');
    text = text.replace(/"apikey"\s*:\s*"[^"]*"/gi, '"apiKey":"[redacted]"');
    if (text.length > 200) {
      text = text.substring(0, 200);
    }
    return text;
  }
}
