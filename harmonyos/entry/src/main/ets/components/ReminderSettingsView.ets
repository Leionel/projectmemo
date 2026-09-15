import { InterventionPolicyService } from '../services/InterventionPolicyService';
import { PolicyUpdateBody } from '../models/Intervention';
import { ApiError } from '../models/Project';
import { PMColors, PMSpacing, PMFontSize } from '../common/DesignTokens';

@Component
export struct ReminderSettingsView {
  @Prop projectId: string = '';
  onClose: () => void = () => {};
  @State budget: string = '';
  @State quietStart: string = '';
  @State quietEnd: string = '';
  @State timezone: string = '';
  @State busy: boolean = false;
  @State loaded: boolean = false;
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
    if (this.projectId === '') { this.feedback = '请先创建一个项目，再配置提醒策略'; return; }
    this.busy = true;
    this.loaded = false;
    try {
      const result = await this.service.get(this.projectId);
      this.budget = result.policy.dailyBudget.toString();
      this.quietStart = this.timeLabel(result.policy.quietStartMinute);
      this.quietEnd = this.timeLabel(result.policy.quietEndMinute);
      this.timezone = result.policy.timezone;
      this.loaded = true;
      this.feedback = '';
    } catch (e) {
      this.feedback = e instanceof ApiError ? e.message : '读取失败，请重试';
    } finally { this.busy = false; }
  }

  private async save(): Promise<void> {
    if (this.busy || !this.loaded) { return; }
    const start = this.minute(this.quietStart);
    const end = this.minute(this.quietEnd);
    if (!/^\d+$/.test(this.budget.trim()) || Number(this.budget) > 50 || start < 0 || end < 0) {
      this.feedback = '每日上限须为 0–50 的整数，时间须为 HH:mm'; return;
    }
    this.busy = true;
    try {
      const body = new PolicyUpdateBody();
      body.dailyBudget = Number(this.budget);
      body.quietStartMinute = start;
      body.quietEndMinute = end;
      const result = await this.service.update(this.projectId, body);
      this.budget = result.policy.dailyBudget.toString();
      this.quietStart = this.timeLabel(result.policy.quietStartMinute);
      this.quietEnd = this.timeLabel(result.policy.quietEndMinute);
      this.feedback = '已保存到服务端，重新打开仍然有效';
    } catch (e) {
      this.feedback = e instanceof ApiError ? e.message : '保存失败，请重试';
    } finally { this.busy = false; }
  }

  build() {
    Column({ space: PMSpacing.MD }) {
      Row() {
        Text('提醒策略').fontSize(PMFontSize.SECTION_TITLE).layoutWeight(1)
        Button('关闭').onClick(() => this.onClose()).accessibilityText('关闭提醒策略')
      }.width('100%')
      Text('当前为服务端共享策略，修改会影响该服务上的项目。不会修改系统通知权限。')
        .fontColor(PMColors.INK_SECONDARY)
      if (this.loaded) {
        Text(`策略时区：${this.timezone}`).fontSize(PMFontSize.CAPTION)
        Text('每日主动提醒上限（0–50）')
        TextInput({ text: this.budget, placeholder: '例如 3' })
          .enabled(!this.busy).onChange((v: string) => { this.budget = v; })
        Text('免打扰开始时间')
        TextInput({ text: this.quietStart, placeholder: '23:00' })
          .enabled(!this.busy).onChange((v: string) => { this.quietStart = v; })
        Text('免打扰结束时间')
        TextInput({ text: this.quietEnd, placeholder: '08:00' })
          .enabled(!this.busy).onChange((v: string) => { this.quietEnd = v; })
        Button(this.busy ? '保存中…' : '保存提醒策略').width('100%')
          .enabled(!this.busy).onClick(() => { this.save(); })
      } else {
        Button(this.busy ? '读取中…' : '重新读取').enabled(!this.busy)
          .onClick(() => { this.load(); })
      }
      if (this.feedback !== '') { Text(this.feedback).fontColor(PMColors.INK_SECONDARY) }
    }
    .width('100%').padding(PMSpacing.LG).alignItems(HorizontalAlign.Start)
  }
}
