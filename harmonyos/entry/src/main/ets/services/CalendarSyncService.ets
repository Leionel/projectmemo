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
      const readState = await atManager.checkAccessToken(0, READ_CALENDAR).catch(() => -1);
      result.granted = readState === 0;
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
      hilog.warn(DOMAIN, TAG, 'calendar inspect failed: %{public}s', JSON.stringify(err));
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
      hilog.warn(DOMAIN, TAG, 'list calendars failed: %{public}s', JSON.stringify(err));
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
        return conflicts;
      }
      const begin = Math.min(...blocks.map((block) => new Date(block.start).getTime()));
      const end = Math.max(...blocks.map((block) => new Date(block.end).getTime()));
      const existing = await calendar.getEvents(calendarManager.EventFilter.filterByTime(begin, end), ['title', 'startTime', 'endTime']);
      for (const block of blocks) {
        const blockStart = new Date(block.start).getTime();
        const blockEnd = new Date(block.end).getTime();
        for (const event of existing) {
          // 自己此前写入的事件不算冲突
          if ((event.title ?? '').startsWith(EVENT_TITLE_PREFIX) && event.id !== undefined) {
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
      hilog.warn(DOMAIN, TAG, 'conflict check failed: %{public}s', JSON.stringify(err));
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
            description: 'ProjectMemo 应用内安排同步；在应用内取消会同步撤销',
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

  /** 撤销：只删除 ProjectMemo 写入过、且带 eventId 的事件 */
  static async revokeBlocks(context: common.Context, calendarId: string, blocks: ScheduleBlock[]): Promise<string[]> {
    const revoked: string[] = [];
    const targets = blocks.filter((block) => block.calendar !== undefined && block.calendar.eventId !== null && block.calendar.eventId !== '');
    if (targets.length === 0) {
      return revoked;
    }
    try {
      const manager = calendarManager.getCalendarManager(context);
      const calendar = calendarId === '' ? await manager.getCalendar() : (await manager.getAllCalendars())
        .find((item) => `${item.id}` === calendarId);
      if (!calendar) {
        return revoked;
      }
      for (const block of targets) {
        const eventId = Number(block.calendar!.eventId);
        if (Number.isNaN(eventId)) {
          continue;
        }
        try {
          await calendar.deleteEvent(eventId);
          if (block.id !== null) {
            revoked.push(block.id);
          }
        } catch (error) {
          hilog.warn(DOMAIN, TAG, 'delete event failed: %{public}s', JSON.stringify(error));
        }
      }
    } catch (error) {
      hilog.warn(DOMAIN, TAG, 'revoke failed: %{public}s', JSON.stringify(error));
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
}
