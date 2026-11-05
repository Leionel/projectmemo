import { PMColors, PMFontFamily, PMFontSize, PMRadius, PMSpacing } from '../common/DesignTokens';

/**
 * 品牌启动页：接在系统启动窗口（同底色、同图标）之后，覆盖登录状态检查的时间。
 * 图标保持静止以与系统启动窗口无缝衔接，只让品牌字样轻微浮现。
 */
@Component
export struct SplashView {
  @State private textOpacity: number = 0;
  @State private textOffset: number = 8;

  aboutToAppear(): void {
    animateTo({ duration: 420, delay: 120, curve: Curve.EaseOut }, () => {
      this.textOpacity = 1;
      this.textOffset = 0;
    });
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column({ space: PMSpacing.XL }) {
        Image($r('app.media.startIcon'))
          .width(96)
          .height(96)
          .borderRadius(PMRadius.XXL)
          .accessibilityText('忆程 ProjectMemo')
        Column({ space: 4 }) {
          Text('忆程')
            .fontSize(30)
            .fontWeight(FontWeight.Medium)
            .fontFamily(PMFontFamily.BRAND_SERIF)
            .letterSpacing(6)
            .fontColor(PMColors.INK_PRIMARY)
          Text('ProjectMemo')
            .fontSize(PMFontSize.SECONDARY)
            .letterSpacing(2)
            .fontColor(PMColors.INK_TERTIARY)
        }
        .opacity(this.textOpacity)
        .translate({ y: this.textOffset })
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)

      Text('留住过程 · 接续行动')
        .fontSize(PMFontSize.CAPTION)
        .letterSpacing(2)
        .fontColor(PMColors.INK_MUTED)
        .opacity(this.textOpacity)
        .margin({ bottom: 56 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.start_window_background'))
    .accessibilityText('忆程 ProjectMemo 正在启动')
  }
}
