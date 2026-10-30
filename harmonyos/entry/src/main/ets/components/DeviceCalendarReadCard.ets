import { common, abilityAccessCtrl, Permissions } from '@kit.AbilityKit';
import { DeviceCalendarEvent, DeviceCalendarReadService, DeviceCalendarReadResult } from '../services/DeviceCalendarReadService';
import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';

@Component
export struct DeviceCalendarReadCard {
  @State events: DeviceCalendarEvent[] = [];
  @State status: string = '尚未读取设备日历';
  @State busy: boolean = false;
  @State complete: boolean = false;
  @State calendarsRead: number = 0;

  private formatTime(milliseconds: number): string {
    if (milliseconds <= 0) return '';
    const date = new Date(milliseconds);
    const pad = (value: number): string => value < 10 ? `0${value}` : value.toString();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private async load(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status = '正在请求日历权限…';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const manager = abilityAccessCtrl.createAtManager();
      const permission: Permissions[] = ['ohos.permission.READ_CALENDAR'];
      const permissionResult = await manager.requestPermissionsFromUser(context, permission);
      if (permissionResult.authResults.some(result => result !== 0)) {
        this.status = '未授予日历读取权限，设备日历保持不可读';
        this.events = [];
        return;
      }
      const start = Date.now();
      const end = start + 30 * 24 * 60 * 60 * 1000;
      const result: DeviceCalendarReadResult = await DeviceCalendarReadService.readWindow(context, start, end);
      this.events = result.events;
      this.complete = result.complete;
      this.calendarsRead = result.calendarsRead;
      this.status = result.error !== '' ? result.error : `已读取 ${result.calendarsRead} 个可见日历未来 30 天，共 ${result.events.length} 条`;
    } catch (error) {
      this.status = '读取设备日历失败';
    } finally {
      this.busy = false;
    }
  }

  build() {
    Column({ space: 8 }) {
      Text('设备日历（只读）').fontSize(PMFontSize.SECTION_TITLE).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
      Text('仅在本机查看未来 30 天，不上传、不写入项目来源或模型上下文；设备日历不等于飞书云端日历。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
      Row({ space: 8 }) {
        Button(this.busy ? '读取中…' : '读取设备日历', { type: ButtonType.Normal }).height(40).fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy)
          .onClick(() => { void this.load(); })
        Text(this.status).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY).layoutWeight(1)
      }.width('100%')
      if (this.events.length > 0) {
        Column({ space: 6 }) {
          ForEach(this.events, (event: DeviceCalendarEvent) => {
            Column({ space: 2 }) {
              Text(event.title).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_PRIMARY).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text((event.isAllDay ? '全天' : this.formatTime(event.startTime) + ' → ' + this.formatTime(event.endTime)) + (event.calendarName !== '' ? ' · ' + event.calendarName : '')).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
            }.width('100%').alignItems(HorizontalAlign.Start)
          }, (event: DeviceCalendarEvent) => `${event.calendarId}:${event.id}:${event.startTime}`)
        }.width('100%').padding(PMRadius.SM).borderRadius(PMRadius.SM).backgroundColor(PMColors.SURFACE_SUBTLE)
        if (!this.complete) { Text('本次只读取部分可见日历，不能当作设备全部日程。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.WARNING) }
      }
    }
    .width('100%').padding(PMSpacing.LG).alignItems(HorizontalAlign.Start)
    .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.LG)
    .border({ width: 1, color: PMColors.BORDER })
  }
}
