import { common, abilityAccessCtrl, Permissions } from '@kit.AbilityKit';
import { DeviceCalendarEvent, DeviceCalendarReadService, DeviceCalendarReadResult } from '../services/DeviceCalendarReadService';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction } from '../common/DesignTokens';

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
    Column({ space: PMSpacing.SM }) {
      // 未读取时只给一条状态和一个读取入口；权限与来源说明放到结果之后，避免整块说明文字。
      Row({ space: PMSpacing.SM }) {
        Column({ space: 2 }) {
          Text('设备日历（只读）')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
          Text(this.status)
            .fontSize(11)
            .fontColor(PMColors.INK_TERTIARY)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        Text(this.busy ? '读取中…' : (this.events.length > 0 ? '重新读取' : '读取'))
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.busy ? PMColors.INK_MUTED : PMColors.BRAND)
          .constraintSize({ minHeight: 44 })
          .padding({ left: PMSpacing.SM, right: 2 })
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .accessibilityText('读取设备日历未来 30 天的日程，只在本机使用')
          .onClick(() => {
            if (!this.busy) { void this.load(); }
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.events.length > 0) {
        Column({ space: 6 }) {
          ForEach(this.events, (event: DeviceCalendarEvent) => {
            Column({ space: 2 }) {
              Text(event.title).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_PRIMARY).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
              Text((event.isAllDay ? '全天' : this.formatTime(event.startTime) + ' → ' + this.formatTime(event.endTime)) + (event.calendarName !== '' ? ' · ' + event.calendarName : '')).fontSize(11).fontColor(PMColors.INK_TERTIARY)
            }.width('100%').alignItems(HorizontalAlign.Start)
          }, (event: DeviceCalendarEvent) => `${event.calendarId}:${event.id}:${event.startTime}`)
        }.width('100%').padding(PMSpacing.SM).borderRadius(PMRadius.SM).backgroundColor(PMColors.SURFACE_SUBTLE)
        if (!this.complete) { Text('本次只读取部分可见日历，不能当作设备全部日程。').fontSize(11).fontColor(PMColors.WARNING) }
        Text('仅在本机读取未来 30 天，不上传，也不写入项目资料或模型上下文。')
          .fontSize(11)
          .fontColor(PMColors.INK_TERTIARY)
          .lineHeight(17)
      } else if (!this.busy && this.status !== '尚未读取设备日历') {
        Text('只在本机读取；未授权时会明确提示，不会改用云端日历。')
          .fontSize(11)
          .fontColor(PMColors.INK_TERTIARY)
          .lineHeight(17)
      }
    }
    .width('100%')
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
    .alignItems(HorizontalAlign.Start)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .margin({ top: PMSpacing.SM })
  }
}
