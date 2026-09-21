import { calendarManager } from '@kit.CalendarKit';
import { abilityAccessCtrl, common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { ScheduleBlock, ScheduleCalendarEntry } from '../models/Reentry';

const TAG = 'CalendarSyncService';
const DOMAIN = 0x0000;

const READ_CALENDAR = 'ohos.permission.READ_CALENDAR';
const WRITE_CALENDAR = 'ohos.permission.WRITE_CALENDAR';
/** 事件标题前缀：撤销时只认自己写入的事件，绝不动用户原有日程 */
const EVENT_TITLE_PREFIX = '忆程·';
const EVENT_DESCRIPTION_MARKER = 'ProjectMemo 应用内安排同步；在应用内取消会同步撤销';

export class CalendarCapability {
  supported: boolean = false;
  granted: boolean = false;
  reason: string = '';
}

export class CalendarOption {
  id: string = '';
  label: string = '';
}

export class CalendarConflict {
  blockId: string = '';
  actionTitle: string = '';
  existingTitle: string = '';
  start: string = '';
  end: string = '';
}

function businessCode(error: BusinessError): number {
  return typeof error.code === 'number' ? error.code : -1;
}

/** 权限类错误码：读/写日历被拒 */
const PERMISSION_DENIED_CODES = [201, 12100001];

function isPermissionCode(code: number): boolean {
  return PERMISSION_DENIED_CODES.indexOf(code) >= 0;
}

/**
 * 设备删除结果状态：只有 DELETED 与经过查询确认的 ALREADY_MISSING 才算清理成功。
 * 其余状态都表示「这条自有日程还没有被确认从设备上移除」，不得当作成功。
 */
export class DeviceDeleteResult {
  /** 传入的标识（提醒场景里是 reminderId） */
  blockId: string = '';
  eventId: string = '';
  calendarId: string = '';
  /** DELETED | ALREADY_MISSING | UNVERIFIED | PERMISSION_DENIED | CALENDAR_NOT_FOUND | FAILED */
  state: string = 'FAILED';
  message: string = '';
}

/** 查询结果：用于区分「确认不存在」与「查不到」 */
export class DeviceEventLookup {
  calendarId: string = '';
  /** OK | PERMISSION_DENIED | CALENDAR_NOT_FOUND | FAILED */
  status: string = 'OK';
  message: string = '';
  eventIds: string[] = [];
}

/**
 * 系统日历同步（用户授权 → 选择日历 → 预览 → 确认，可撤销）。
 * 权限被拒或设备不支持时如实返回原因，调用方回退为应用内排程。
 */
export class CalendarSyncService {
  /** 探测能力与权限状态；不弹授权框 */
  static async inspect(context: common.Context): Promise<CalendarCapability> {
    const result = new CalendarCapability();
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const tokenId = context.applicationInfo.accessTokenId;
      const readState = await atManager.checkAccessToken(tokenId, READ_CALENDAR).catch(() => -1);
      const writeState = await atManager.checkAccessToken(tokenId, WRITE_CALENDAR).catch(() => -1);
      result.granted = readState === 0 && writeState === 0;
      const manager = calendarManager.getCalendarManager(context);
      result.supported = manager !== null && manager !== undefined;
      if (!result.supported) {
        result.reason = '当前设备不支持系统日历';
      } else if (!result.granted) {
        result.reason = '尚未授权日历权限';
      }
    } catch (error) {
      const err = error as BusinessError;
      result.supported = false;
      result.granted = false;
      result.reason = businessCode(err) === 801 ? '当前设备不支持系统日历' : `日历能力不可用（${err.message ?? '未知错误'}）`;
      hilog.warn(DOMAIN, TAG, 'calendar inspect failed: %{public}s', CalendarSyncService.safeLogText(JSON.stringify(err)));
    }
    return result;
  }

  /** 运行时授权；拒绝时返回 granted=false 与原因，由调用方回退应用内排程 */
  static async requestPermission(context: common.Context): Promise<CalendarCapability> {
    const result = new CalendarCapability();
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const response = await atManager.requestPermissionsFromUser(context, [READ_CALENDAR, WRITE_CALENDAR]);
      const granted = response.authResults.every((item: number) => item === 0);
      result.granted = granted;
      result.supported = true;
      result.reason = granted ? '' : '用户拒绝了日历权限，已保留应用内安排';
    } catch (error) {
      const err = error as BusinessError;
      result.supported = businessCode(err) !== 801;
      result.granted = false;
      result.reason = businessCode(err) === 801 ? '当前设备不支持系统日历' : `授权失败（${err.message ?? '未知错误'}）`;
    }
    return result;
  }

  /** 可选目标日历；只读展示，不修改任何日历账号 */
  static async listCalendars(context: common.Context): Promise<CalendarOption[]> {
    const options: CalendarOption[] = [];
    try {
      const manager = calendarManager.getCalendarManager(context);
      const calendars = await manager.getAllCalendars();
      for (const calendar of calendars) {
        const option = new CalendarOption();
        option.id = `${calendar.id}`;
        option.label = `日历 #${calendar.id}`;
        options.push(option);
      }
      if (options.length === 0) {
        const fallback = await manager.getCalendar();
        const option = new CalendarOption();
        option.id = `${fallback.id}`;
        option.label = '默认日历';
        options.push(option);
      }
    } catch (error) {
      const err = error as BusinessError;
      hilog.warn(DOMAIN, TAG, 'list calendars failed: %{public}s', CalendarSyncService.safeLogText(JSON.stringify(err)));
    }
    return options;
  }

  /**
   * 写入前检查冲突：与用户已有日程重叠时返回冲突列表，由用户决定，
   * 不静默覆盖、不合并、不删除任何既有日程。
   */
  static async findConflicts(context: common.Context, calendarId: string, blocks: ScheduleBlock[]): Promise<CalendarConflict[]> {
    const conflicts: CalendarConflict[] = [];
    if (blocks.length === 0) {
      return conflicts;
    }
    try {
      const manager = calendarManager.getCalendarManager(context);
      const calendar = calendarId === '' ? await manager.getCalendar() : (await manager.getAllCalendars())
        .find((item) => `${item.id}` === calendarId);
      if (!calendar) {
        throw new Error('目标日历不存在');
      }
      const begin = Math.min(...blocks.map((block) => new Date(block.start).getTime()));
      const end = Math.max(...blocks.map((block) => new Date(block.end).getTime()));
      const ownedEventIds = new Set<string>();
      for (const block of blocks) {
        if (block.calendar !== undefined && block.calendar.eventId !== null && block.calendar.eventId !== '') {
          ownedEventIds.add(block.calendar.eventId);
        }
      }
      const existing = await calendar.getEvents(calendarManager.EventFilter.filterByTime(begin, end), ['id', 'title', 'startTime', 'endTime']);
      for (const block of blocks) {
        const blockStart = new Date(block.start).getTime();
        const blockEnd = new Date(block.end).getTime();
        for (const event of existing) {
          // 只跳过当前这些块已登记的同一事件；其他项目或用户手工创建的“忆程·”日程仍是冲突。
          if (event.id !== undefined && ownedEventIds.has(`${event.id}`)) {
            continue;
          }
          const eventStart = event.startTime ?? 0;
          const eventEnd = event.endTime ?? 0;
          if (eventStart < blockEnd && eventEnd > blockStart) {
            const conflict = new CalendarConflict();
            conflict.blockId = block.id ?? '';
            conflict.actionTitle = block.actionTitle;
            conflict.existingTitle = event.title ?? '（无标题日程）';
            conflict.start = block.start;
            conflict.end = block.end;
            conflicts.push(conflict);
            break;
          }
        }
      }
    } catch (error) {
      const err = error as BusinessError;
      hilog.warn(DOMAIN, TAG, 'conflict check failed: %{public}s', CalendarSyncService.safeLogText(JSON.stringify(err)));
      throw new Error(`无法读取系统日历，未执行写入：${CalendarSyncService.describe(err)}`);
    }
    return conflicts;
  }

  /**
   * 用户确认后写入系统日历；返回可上报服务端的回执条目。
   * 单条失败不影响其他条目，失败原因如实回报。
   */
  static async writeBlocks(context: common.Context, calendarId: string, blocks: ScheduleBlock[]): Promise<ScheduleCalendarEntry[]> {
    const entries: ScheduleCalendarEntry[] = [];
    try {
      const manager = calendarManager.getCalendarManager(context);
      const calendar = calendarId === '' ? await manager.getCalendar() : (await manager.getAllCalendars())
        .find((item) => `${item.id}` === calendarId);
      if (!calendar) {
        for (const block of blocks) {
          entries.push(CalendarSyncService.failedEntry(block, '目标日历不存在'));
        }
        return entries;
      }
      for (const block of blocks) {
        try {
          const eventId = await calendar.addEvent({
            type: calendarManager.EventType.NORMAL,
            title: `${EVENT_TITLE_PREFIX}${block.actionTitle !== '' ? block.actionTitle : '项目行动'}`,
            startTime: new Date(block.start).getTime(),
            endTime: new Date(block.end).getTime(),
            description: EVENT_DESCRIPTION_MARKER,
            // 0 表示在日程开始时提醒。只创建日历事件并不会自动产生提醒，
            // 因此必须随事件明确写入 reminderTime。
            reminderTime: [0],
          });
          const entry = new ScheduleCalendarEntry();
          entry.blockId = block.id ?? '';
          entry.calendarId = `${calendar.id}`;
          entry.eventId = `${eventId}`;
          entry.status = 'SYNCED';
          entries.push(entry);
        } catch (error) {
          entries.push(CalendarSyncService.failedEntry(block, CalendarSyncService.describe(error as BusinessError)));
        }
      }
    } catch (error) {
      const message = CalendarSyncService.describe(error as BusinessError);
      for (const block of blocks) {
        entries.push(CalendarSyncService.failedEntry(block, message));
      }
    }
    return entries;
  }

  /**
   * 设备写入成功、服务端回执登记失败时的补偿删除。
   * 仍复用 revokeBlocks 的标题、描述与 eventId 三重校验，避免误删用户原有日程。
   */
  static async rollbackWrites(context: common.Context, blocks: ScheduleBlock[], entries: ScheduleCalendarEntry[]): Promise<number> {
    const successful = entries.filter((entry: ScheduleCalendarEntry) =>
      entry.status === 'SYNCED' && entry.eventId !== null && entry.eventId !== '');
    if (successful.length === 0) {
      return 0;
    }
    const rollbackBlocks: ScheduleBlock[] = [];
    for (const block of blocks) {
      const entry = successful.find((item: ScheduleCalendarEntry) => item.blockId === (block.id ?? ''));
      if (entry === undefined) {
        continue;
      }
      const rollback = new ScheduleBlock();
      rollback.id = block.id;
      rollback.actionId = block.actionId;
      rollback.actionTitle = block.actionTitle;
      rollback.start = block.start;
      rollback.end = block.end;
      rollback.calendar.status = 'SYNCED';
      rollback.calendar.calendarId = entry.calendarId;
      rollback.calendar.eventId = entry.eventId;
      rollbackBlocks.push(rollback);
    }
    const calendarId = successful[0].calendarId ?? '';
    const results = await CalendarSyncService.deleteOwnedEvents(context, calendarId, rollbackBlocks);
    let confirmed = 0;
    for (const result of results) {
      if (result.state === 'DELETED' || result.state === 'ALREADY_MISSING') {
        confirmed += 1;
      }
    }
    return confirmed;
  }

  /**
   * 重新安排单条提醒后，清理同一待办旧时间上的应用自有事件。
   * 必须同时匹配标题、描述标记和起止时间；不会按标题模糊删除用户日程。
   */
  static async removeMatchingReminder(context: common.Context, actionTitle: string, start: string,
    end: string, excludeEventId: string): Promise<number> {
    try {
      const manager = calendarManager.getCalendarManager(context);
      const calendar = await manager.getCalendar();
      const startTime = new Date(start).getTime();
      const endTime = new Date(end).getTime();
      const events = await calendar.getEvents(
        calendarManager.EventFilter.filterByTime(startTime, endTime),
        ['id', 'title', 'description', 'startTime', 'endTime'],
      );
      let removed = 0;
      for (const event of events) {
        if (event.id === undefined || `${event.id}` === excludeEventId) {
          continue;
        }
        const owned = event.title === `${EVENT_TITLE_PREFIX}${actionTitle !== '' ? actionTitle : '项目行动'}` &&
          event.description === EVENT_DESCRIPTION_MARKER && event.startTime === startTime && event.endTime === endTime;
        if (owned) {
          await calendar.deleteEvent(event.id);
          removed += 1;
        }
      }
      return removed;
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'old reminder cleanup failed: %{public}s', CalendarSyncService.safeLogText(JSON.stringify(error)));
      return 0;
    }
  }

  /** 只读核查：在给定时间窗内查询目标日历，返回查询是否成功以及命中的事件编号 */
  static async lookupOwnedEvents(context: common.Context, calendarId: string, start: string, end: string): Promise<DeviceEventLookup> {
    const lookup = new DeviceEventLookup();
    lookup.calendarId = calendarId;
    let calendar: calendarManager.Calendar | undefined = undefined;
    try {
      const manager = calendarManager.getCalendarManager(context);
      calendar = calendarId === '' ? await manager.getCalendar() : (await manager.getAllCalendars())
        .find((item) => `${item.id}` === calendarId);
    } catch (error) {
      const code = businessCode(error as BusinessError);
      if (isPermissionCode(code)) {
        lookup.status = 'PERMISSION_DENIED';
        lookup.message = '日历权限被拒绝，无法查询设备日历';
      } else {
        lookup.status = 'FAILED';
        lookup.message = CalendarSyncService.describe(error as BusinessError);
      }
      return lookup;
    }
    if (calendar === undefined) {
      lookup.status = 'CALENDAR_NOT_FOUND';
      lookup.message = '目标日历不存在';
      return lookup;
    }
    const granted = await CalendarSyncService.hasCalendarPermission(context);
    if (!granted) {
      lookup.status = 'PERMISSION_DENIED';
      lookup.message = '日历权限被拒绝，无法查询设备日历';
      return lookup;
    }
    try {
      const events = await calendar.getEvents(
        calendarManager.EventFilter.filterByTime(new Date(start).getTime(), new Date(end).getTime()),
        ['id', 'title', 'description'],
      );
      for (const event of events) {
        if (event.id !== undefined) {
          lookup.eventIds.push(`${event.id}`);
        }
      }
      lookup.status = 'OK';
    } catch (error) {
      const code = businessCode(error as BusinessError);
      if (isPermissionCode(code)) {
        lookup.status = 'PERMISSION_DENIED';
        lookup.message = '日历权限被拒绝，无法查询设备日历';
      } else {
        lookup.status = 'FAILED';
        lookup.message = CalendarSyncService.describe(error as BusinessError);
      }
    }
    return lookup;
  }

  /**
   * 删除忆程自己创建的事件，返回逐条结构化结果（不抛异常，全部落到 state 里）。
   * 精确区分：日历找不到 / 权限被拒 / 查询后确认不存在 / 命中但核验未通过 / 删除报错 / 成功。
   */
  static async deleteOwnedEvents(context: common.Context, calendarId: string, targets: ScheduleBlock[]): Promise<DeviceDeleteResult[]> {
    const results: DeviceDeleteResult[] = [];
    const valid = targets.filter((block) => block.calendar !== undefined && block.calendar.eventId !== null && block.calendar.eventId !== '');
    if (valid.length === 0) {
      return results;
    }
    // 先判定能力：日历找不到或权限被拒，整体落到对应状态，不再逐条误判。
    let calendar: calendarManager.Calendar | undefined = undefined;
    try {
      const manager = calendarManager.getCalendarManager(context);
      calendar = calendarId === '' ? await manager.getCalendar() : (await manager.getAllCalendars())
        .find((item) => `${item.id}` === calendarId);
    } catch (error) {
      const denied = isPermissionCode(businessCode(error as BusinessError));
      for (const block of valid) {
        results.push(CalendarSyncService.blockResult(block, denied ? 'PERMISSION_DENIED' : 'CALENDAR_NOT_FOUND',
          denied ? '日历权限被拒绝，无法读取设备日历' : '目标日历不存在'));
      }
      return results;
    }
    if (calendar === undefined) {
      for (const block of valid) {
        results.push(CalendarSyncService.blockResult(block, 'CALENDAR_NOT_FOUND', '目标日历不存在'));
      }
      return results;
    }
    const granted = await CalendarSyncService.hasCalendarPermission(context);
    if (!granted) {
      for (const block of valid) {
        results.push(CalendarSyncService.blockResult(block, 'PERMISSION_DENIED', '日历权限被拒绝，无法删除设备日程'));
      }
      return results;
    }
    for (const block of valid) {
      results.push(await CalendarSyncService.deleteOneOwned(calendar, calendarId, block));
    }
    return results;
  }

  /** 在已确认存在的日历上删除单条自有事件；查询成功才允许判 ALREADY_MISSING */
  private static async deleteOneOwned(calendar: calendarManager.Calendar, calendarId: string, block: ScheduleBlock): Promise<DeviceDeleteResult> {
    const result = new DeviceDeleteResult();
    result.blockId = block.id ?? '';
    result.calendarId = calendarId;
    const eventId = block.calendar !== undefined ? block.calendar.eventId : null;
    if (eventId === null || eventId === '') {
      result.state = 'FAILED';
      result.message = '没有事件编号，无法定位设备日程';
      return result;
    }
    result.eventId = eventId;
    const numericId = Number(eventId);
    if (Number.isNaN(numericId)) {
      result.state = 'FAILED';
      result.message = '事件编号格式不正确，无法删除设备日程';
      return result;
    }
    try {
      const events = await calendar.getEvents(
        calendarManager.EventFilter.filterByTime(new Date(block.start).getTime(), new Date(block.end).getTime()),
        ['id', 'title', 'description'],
      );
      const match = events.find((event) => event.id !== undefined && `${event.id}` === `${numericId}`);
      if (match === undefined) {
        // 只有查询成功（走到了这里）才能判定为「确认不存在」
        result.state = 'ALREADY_MISSING';
        result.message = '设备日历里没有找到这条忆程的日程';
        return result;
      }
      const owned = (match.title ?? '').startsWith(EVENT_TITLE_PREFIX) && match.description === EVENT_DESCRIPTION_MARKER;
      if (!owned) {
        // 编号命中但归属核验未通过：绝不擅自删除用户原有日程
        result.state = 'UNVERIFIED';
        result.message = '这条日程不属于忆程，未删除';
        return result;
      }
      await calendar.deleteEvent(numericId);
      result.state = 'DELETED';
      result.message = '已删除设备日历里忆程创建的日程';
      return result;
    } catch (error) {
      const err = error as BusinessError;
      if (isPermissionCode(businessCode(err))) {
        result.state = 'PERMISSION_DENIED';
        result.message = '日历权限被拒绝，无法删除设备日程';
      } else {
        result.state = 'FAILED';
        result.message = CalendarSyncService.describe(err);
      }
      return result;
    }
  }

  private static blockResult(block: ScheduleBlock, state: string, message: string): DeviceDeleteResult {
    const result = new DeviceDeleteResult();
    result.blockId = block.id ?? '';
    if (block.calendar !== undefined) {
      result.calendarId = block.calendar.calendarId ?? '';
      result.eventId = block.calendar.eventId !== null ? block.calendar.eventId : '';
    }
    result.state = state;
    result.message = message;
    return result;
  }

  private static async hasCalendarPermission(context: common.Context): Promise<boolean> {
    try {
      const atManager = abilityAccessCtrl.createAtManager();
      const tokenId = context.applicationInfo.accessTokenId;
      const readState = await atManager.checkAccessToken(tokenId, READ_CALENDAR).catch(() => -1);
      const writeState = await atManager.checkAccessToken(tokenId, WRITE_CALENDAR).catch(() => -1);
      return readState === 0 && writeState === 0;
    } catch {
      return false;
    }
  }

  /** 撤销：只删除 ProjectMemo 写入过、且带 eventId 的事件；返回已确认清理（删除或确认不存在）的 blockId */
  static async revokeBlocks(context: common.Context, calendarId: string, blocks: ScheduleBlock[]): Promise<string[]> {
    const targets = blocks.filter((block) => block.calendar !== undefined && block.calendar.eventId !== null && block.calendar.eventId !== '');
    if (targets.length === 0) {
      return [];
    }
    const results = await CalendarSyncService.deleteOwnedEvents(context, calendarId, targets);
    const revoked: string[] = [];
    for (const result of results) {
      if (result.state === 'DELETED' || result.state === 'ALREADY_MISSING') {
        revoked.push(result.blockId);
      }
    }
    return revoked;
  }

  private static failedEntry(block: ScheduleBlock, message: string): ScheduleCalendarEntry {
    const entry = new ScheduleCalendarEntry();
    entry.blockId = block.id ?? '';
    entry.calendarId = null;
    entry.eventId = null;
    entry.status = 'FAILED';
    entry.error = message;
    return entry;
  }

  private static describe(error: BusinessError): string {
    const code = businessCode(error);
    if (code === 201) {
      return '用户拒绝日历权限，已保留应用内安排';
    }
    if (code === 801) {
      return '当前设备不支持系统日历，已保留应用内安排';
    }
    return error.message ?? '系统日历写入失败';
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
