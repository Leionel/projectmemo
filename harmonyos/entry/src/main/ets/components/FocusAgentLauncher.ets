import { PMColors, PMFontFamily, PMMotion } from '../common/DesignTokens';

/** 「问忆程」悬浮入口：内容滚动时收成字标，不再压住卡片操作。 */
@Component
export struct FocusAgentLauncher {
  @Prop collapsed: boolean = false;
  onOpen: () => void = (): void => {};
  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: this.collapsed ? 0 : 8 }) {
        Text('忆').fontFamily(PMFontFamily.BRAND_SERIF).fontSize(14).fontWeight(FontWeight.Bold).fontColor(PMColors.BRAND)
          .width(26).height(26).textAlign(TextAlign.Center).borderRadius(8).backgroundColor(PMColors.BRAND_LIGHT)
        if (!this.collapsed) {
          Text('问忆程').fontFamily(PMFontFamily.SANS).fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
            .transition(TransitionEffect.OPACITY.animation({ duration: PMMotion.STATE, curve: Curve.EaseOut }))
        }
      }.padding(this.collapsed ? { left: 10, right: 10 } : { left: 10, right: 16 }).height(48)
    }.backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER }).borderRadius(999).clip(true)
      .shadow({ radius: 14, color: 'rgba(28,46,44,0.10)', offsetX: 0, offsetY: 4 })
      .animation({ duration: PMMotion.ENTER, curve: Curve.Friction })
      .accessibilityText('问忆程，打开项目协作对话').onClick(() => { this.onOpen(); })
  }
}

const SWIPE_THRESHOLD: number = 12;

/** 只读手势方向，不拦截列表滚动。 */
export class LauncherScrollTracker {
  private lastY: number = 0;
  update(event: TouchEvent, onChange: (collapsed: boolean) => void): void {
    const point = event.touches[0];
    if (!point) { return; }
    if (event.type === TouchType.Down) { this.lastY = point.y; return; }
    if (event.type !== TouchType.Move) { return; }
    const delta = point.y - this.lastY;
    if (delta < -SWIPE_THRESHOLD) { this.lastY = point.y; onChange(true); }
    if (delta > SWIPE_THRESHOLD) { this.lastY = point.y; onChange(false); }
  }
}
