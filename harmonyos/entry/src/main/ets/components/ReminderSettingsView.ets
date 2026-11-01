import { InterventionPolicyService } from '../services/InterventionPolicyService';
import { PolicyUpdateBody } from '../models/Intervention';
import { ApiError } from '../models/Project';
import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';

/**
 * 提醒策略（账号级）：
 * 服务端按 USER:${userId} scope 存储策略，该账号全部项目共享同一份每日预算与静默时段；
 * 传入的 projectId 只是服务端授权定位（任一可访问项目皆可），不代表「这个项目的策略」。
 * 系统通知权限由系统设置管理，与本策略是两件事。
 */
@Component
export struct ReminderSettingsView {
  @Prop projectId: string = '';
  onClose: () => void = () => {};
  @State budget: number = 3;
  @State quietStart: string = '';
  @State quietEnd: string = '';
  @State timezone: string = '';
  @State busy: boolean = false;
  @State loaded: boolean = false;
  /** 反馈类型：'' 无 | 'success' | 'error' */
  @State feedbackKind: string = '';
  @State feedback: string = '';
  private service: InterventionPolicyService = new InterventionPolicyService();

  aboutToAppear(): void { this.load(); }

  private timeLabel(minute: number): string {
    return `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
  }

  private minute(label: string): number {
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(label.trim())) { return -1; }
    const parts = label.trim().split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  private async load(): Promise<void> {
    if (this.projectId === '') {
      this.loaded = false;
      this.feedbackKind = 'error';
      this.feedback = '提醒策略按账号生效，但读取与保存需要至少一个可访问的项目作为服务端定位。当前没有可访问的项目。';
      return;
    }
    this.busy = true;
    this.loaded = false;
    try {
      const result = await this.service.get(this.projectId);
      this.applyPolicy(result.policy.dailyBudget, result.policy.quietStartMinute, result.policy.quietEndMinute, result.policy.timezone);
      this.loaded = true;
      this.feedbackKind = '';
      this.feedback = '';
    } catch (e) {
      this.feedbackKind = 'error';
      this.feedback = e instanceof ApiError ? e.message : '读取失败，请稍后重试';
    } finally { this.busy = false; }
  }

  private applyPolicy(budget: number, quietStartMinute: number, quietEndMinute: number, timezone: string): void {
    this.budget = budget;
    this.quietStart = this.timeLabel(quietStartMinute);
    this.quietEnd = this.timeLabel(quietEndMinute);
    this.timezone = timezone;
  }

  private adjustBudget(delta: number): void {
    const next: number = this.budget + delta;
    if (next < 0 || next > 50) { return; }
    this.budget = next;
  }

  /** 时间用系统时间选择器，避免手输 HH:mm 的生硬与格式错误 */
  private showTimePicker(isStart: boolean): void {
    const current: number = isStart ? this.minute(this.quietStart) : this.minute(this.quietEnd);
    const baseMinute: number = current < 0 ? 0 : current;
    const base: Date = new Date();
    base.setHours(Math.floor(baseMinute / 60), baseMinute % 60, 0, 0);
    TimePickerDialog.show({
      selected: base,
      useMilitaryTime: true,
      onAccept: (value: TimePickerResult) => {
        const hour: number = value.hour !== undefined ? value.hour : 0;
        const min: number = value.minute !== undefined ? value.minute : 0;
        const label: string = `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
        if (isStart) { this.quietStart = label; } else { this.quietEnd = label; }
      }
    });
  }

  private async save(): Promise<void> {
    if (this.busy || !this.loaded) { return; }
    const start: number = this.minute(this.quietStart);
    const end: number = this.minute(this.quietEnd);
    if (this.budget < 0 || this.budget > 50 || start < 0 || end < 0) {
      this.feedbackKind = 'error';
      this.feedback = '每日上限须为 0–50 的整数，免打扰时间须为有效时刻'; return;
    }
    this.busy = true;
    try {
      const body = new PolicyUpdateBody();
      body.dailyBudget = this.budget;
      body.quietStartMinute = start;
      body.quietEndMinute = end;
      const result = await this.service.update(this.projectId, body);
      this.applyPolicy(result.policy.dailyBudget, result.policy.quietStartMinute, result.policy.quietEndMinute, result.policy.timezone);
      this.feedbackKind = 'success';
      this.feedback = '已保存到服务端，对你的全部项目生效';
    } catch (e) {
      this.feedbackKind = 'error';
      this.feedback = e instanceof ApiError ? e.message : '保存失败，请稍后重试';
    } finally { this.busy = false; }
  }

  @Builder
  private TimeField(label: string, value: string, isStart: boolean) {
    Column({ space: 6 }) {
      Text(label)
        .fontSize(PMFontSize.SECONDARY)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_SECONDARY)
      Button(value !== '' ? value : '选择时间', { type: ButtonType.Normal })
        .fontSize(PMFontSize.BODY)
        .fontWeight(FontWeight.Medium)
        .fontColor(value !== '' ? PMColors.INK_PRIMARY : PMColors.INK_TERTIARY)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .border({ width: 1, color: PMColors.BORDER })
        .borderRadius(PMRadius.SM)
        .height(44)
        .width('100%')
        .enabled(!this.busy && this.loaded)
        .onClick(() => { this.showTimePicker(isStart); })
        .accessibilityText(`${label}，当前 ${value !== '' ? value : '未选择'}，点击选择时间`)
    }
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Scroll() {
      Column({ space: PMSpacing.MD }) {
        Row() {
          Text('提醒策略')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .layoutWeight(1)
          Button('✕', { type: ButtonType.Normal })
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .backgroundColor(Color.Transparent)
            .width(36)
            .height(36)
            .borderRadius(PMRadius.SM)
            .onClick(() => this.onClose())
            .accessibilityText('关闭提醒策略')
        }
        .width('100%')

        Text('策略按账号生效：你的全部项目共享同一份每日预算与静默时段，修改立即影响所有项目。系统通知权限由系统设置管理，不在这里改变。')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .width('100%')

        if (this.projectId === '') {
          // 没有任何可访问项目时如实说明定位限制，不展示可编辑表单也不伪造保存入口
          Column({ space: PMSpacing.SM }) {
            Text('当前没有可访问的项目')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
            Text('创建或恢复一个项目后，即可在这里管理提醒预算与免打扰时段。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(18)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding(PMSpacing.MD)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.SM)
        } else if (!this.loaded) {
          Column({ space: PMSpacing.SM }) {
            if (this.feedback !== '') {
              Text(this.feedback)
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(this.feedbackKind === 'error' ? PMColors.RISK : PMColors.INK_SECONDARY)
                .lineHeight(20)
                .width('100%')
            }
            Button(this.busy ? '读取中…' : '重新读取', { type: ButtonType.Normal })
              .enabled(!this.busy)
              .onClick(() => { this.load(); })
              .type(ButtonType.Normal)
              .fontSize(PMFontSize.BUTTON)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.SM)
              .constraintSize({ minHeight: 44 })
              .width('100%')
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        } else {
          // 每日预算：步进选择，避免自由文本输入
          Row() {
            Text('每日主动提醒上限')
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .layoutWeight(1)

            Button('−', { type: ButtonType.Normal })
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.budget <= 0 ? PMColors.INK_MUTED : PMColors.INK_PRIMARY)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .width(36)
              .height(36)
              .enabled(this.loaded && !this.busy && this.budget > 0)
              .onClick(() => { this.adjustBudget(-1); })
              .accessibilityText('减少每日提醒上限')

            Text(`${this.budget}`)
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_PRIMARY)
              .fontFeature('"tnum" on')
              .width(44)
              .textAlign(TextAlign.Center)

            Button('+', { type: ButtonType.Normal })
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.budget >= 50 ? PMColors.INK_MUTED : PMColors.INK_PRIMARY)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .width(36)
              .height(36)
              .enabled(this.loaded && !this.busy && this.budget < 50)
              .onClick(() => { this.adjustBudget(1); })
              .accessibilityText('增加每日提醒上限')
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
          .accessibilityText(`每日主动提醒上限 ${this.budget} 条，范围 0 到 50`)

          Text('免打扰时段（开始晚于结束表示跨午夜，例如 23:00–08:00）')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .width('100%')

          Row({ space: PMSpacing.SM }) {
            this.TimeField('开始', this.quietStart, true)
            this.TimeField('结束', this.quietEnd, false)
          }
          .width('100%')
          .alignItems(VerticalAlign.Bottom)

          if (this.timezone !== '') {
            Row() {
              Text('策略时区')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_SECONDARY)
                .layoutWeight(1)
              Text(this.timezone)
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
            }
            .width('100%')
          }

          Button(this.busy ? '保存中…' : '保存提醒策略', { type: ButtonType.Normal })
            .width('100%')
            .enabled(!this.busy)
            .onClick(() => { this.save(); })
            .type(ButtonType.Normal)
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .constraintSize({ minHeight: 44 })

          if (this.feedback !== '') {
            Text(this.feedback)
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(this.feedbackKind === 'error' ? PMColors.RISK : PMColors.SUCCESS)
              .lineHeight(20)
              .width('100%')
          }
        }
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding(PMSpacing.LG)
    }
    .width('100%')
    .scrollable(ScrollDirection.Vertical)
    .scrollBar(BarState.Off)
  }
}
