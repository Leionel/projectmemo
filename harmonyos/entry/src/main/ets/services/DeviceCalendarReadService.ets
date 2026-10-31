import { calendarManager } from '@kit.CalendarKit';
import { common } from '@kit.AbilityKit';

export interface DeviceCalendarEvent {
  id: number; title: string; startTime: number; endTime: number; isAllDay: boolean; timeZone: string; calendarId: string; calendarName: string;
}
export class DeviceCalendarReadResult {
  events: DeviceCalendarEvent[] = [];
  calendarsRead: number = 0;
  complete: boolean = false;
  error: string = '';
}

/** 设备本地只读：结果只留在当前页面，不上传、不写入服务端来源或模型上下文。 */
export class DeviceCalendarReadService {
  static async readWindow(context: common.UIAbilityContext, start: number, end: number): Promise<DeviceCalendarReadResult> {
    const result = new DeviceCalendarReadResult();
    try {
      const manager = calendarManager.getCalendarManager(context);
      const calendars = await manager.getAllCalendars();
      result.calendarsRead = Math.min(calendars.length, 3);
      if (calendars.length > 3) result.error = '仅读取前 3 个本应用可见日历';
      for (let index = 0; index < result.calendarsRead; index++) {
        const calendar = calendars[index];
        try {
          const events = await calendar.getEvents(calendarManager.EventFilter.filterByTime(start, end));
          for (const event of events) {
            result.events.push({
              id: Number(event.id ?? 0), title: String(event.title ?? '(无标题)'), startTime: Number(event.startTime ?? 0), endTime: Number(event.endTime ?? 0),
              isAllDay: event.isAllDay === true, timeZone: String(event.timeZone ?? ''), calendarId: String(calendar.id ?? ''), calendarName: String(calendar.id ?? '')
            });
          }
        } catch (error) {
          result.error = '部分设备日历不可读';
        }
      }
      result.events.sort((left: DeviceCalendarEvent, right: DeviceCalendarEvent) => left.startTime - right.startTime);
      if (result.events.length > 12) result.error = '仅读取前 12 项设备日程，未展示部分不能当作不存在';
      result.events = result.events.slice(0, 12);
      result.complete = result.error === '' && calendars.length <= 3;
      if (result.calendarsRead === 0) { result.error = '设备上没有本应用可见的日历'; result.complete = false; }
    } catch (error) {
      result.error = '无法读取设备日历，请检查日历权限';
    }
    return result;
  }
}
