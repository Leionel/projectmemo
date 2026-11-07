import { ConversationReadStep, ConversationProgress } from '../models/Conversation';
import { PMColors, PMMotion } from '../common/DesignTokens';

const STALE_AFTER_SECONDS: number = 20;

/**
 * 一轮调查的接续线，与 Web 的 AgentRunThread 同一套语义。
 * 只呈现服务端已返回的阶段和步骤；超过 20 秒没有新进度就停止运动，如实显示等待时长。
 */
@Component
export struct AgentRunThread {
  @Prop progress: ConversationProgress | undefined = undefined;
  @Prop label: string = '';
  public onStop?: () => void;
  @State private scan: number = -1.5;
  @State private seconds: number = 0;
  @StorageProp('pm.reduceMotion') private reduceMotion: boolean = false;
  private signature: string = '';
  private timer: number = -1;

  aboutToAppear(): void {
    this.timer = setInterval(() => { this.tick(); }, 1000);
  }
  aboutToDisappear(): void {
    if (this.timer >= 0) { clearInterval(this.timer); }
  }
  private tick(): void {
    const steps = this.progress?.steps ?? [];
    const next = `${this.progress?.phase ?? ''}:${steps.length}:${steps.filter((s: ConversationReadStep) => s.status === 'SUCCEEDED').length}`;
    if (next !== this.signature) { this.signature = next; this.seconds = 0; return; }
    this.seconds++;
  }
  private running(): boolean {
    return !this.reduceMotion && this.seconds < STALE_AFTER_SECONDS && this.progress?.phase !== 'STOPPING';
  }
  private nodeColor(status: string): ResourceColor {
    if (status === 'SUCCEEDED' || status === 'STARTED') { return PMColors.BRAND; }
    if (status === 'FAILED') { return PMColors.RISK; }
    if (status === 'UNKNOWN') { return PMColors.WARNING; }
    return PMColors.BORDER_STRONG;
  }
  private statusText(status: string): string {
    return status === 'SUCCEEDED' ? '已完成' : status === 'FAILED' ? '未读取到' : status === 'UNKNOWN' ? '结果未知' : status === 'STOPPED' ? '已停止' : '进行中';
  }

  @Builder
  private Node(status: string, live: boolean) {
    Stack() {
      if (status === 'FAILED') {
        Row().width(6).height(1.5).backgroundColor(PMColors.RISK)
      } else if (live) {
        Row().width(4).height(4).borderRadius(2).backgroundColor(PMColors.BRAND)
          .translate({ x: this.running() ? this.scan : 0 })
          .onAppear(() => {
            if (!this.running()) { return; }
            animateTo({ duration: 1100, curve: Curve.EaseInOut, iterations: -1, playMode: PlayMode.Alternate }, () => { this.scan = 1.5; });
          })
      }
    }
    .width(12).height(12).borderRadius(6).margin({ top: 5 }).flexShrink(0)
    .border({ width: 1.5, color: this.nodeColor(status), style: status === 'STOPPED' ? BorderStyle.Dashed : BorderStyle.Solid })
    .backgroundColor(status === 'SUCCEEDED' ? PMColors.BRAND : status === 'FAILED' ? PMColors.RISK_LIGHT : PMColors.SURFACE)
    .animation({ duration: PMMotion.STATE, curve: Curve.EaseOut })
  }

  build() {
    Column({ space: 8 }) {
      ForEach(this.progress?.steps ?? [], (step: ConversationReadStep) => {
        Row({ space: 10 }) {
          this.Node(step.status, step.status === 'STARTED')
          Text(step.label).fontSize(13).lineHeight(20).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
        }.width('100%').alignItems(VerticalAlign.Top)
        .accessibilityGroup(true).accessibilityText(`${step.label}，${this.statusText(step.status)}`)
      }, (step: ConversationReadStep) => step.id + step.status)
      Row({ space: 10 }) {
        this.Node(this.progress?.phase === 'STOPPING' ? 'STOPPED' : 'STARTED', this.running())
        Text(this.label).fontSize(14).lineHeight(22).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
        if (this.seconds >= STALE_AFTER_SECONDS) {
          Text(`已等待 ${this.seconds} 秒`).fontSize(12).fontColor(PMColors.INK_TERTIARY)
        }
      }.width('100%').alignItems(VerticalAlign.Top)
      if (this.progress && this.onStop) {
        Button('停止本轮调查', { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).fontSize(13).fontColor(PMColors.BRAND)
          .backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).enabled(this.progress.phase !== 'STOPPING')
          .onClick(() => { this.onStop?.(); })
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 4, bottom: 8 })
  }
}
