import { PMColors, PMFontFamily } from '../common/DesignTokens';

/** 「问忆程」胶囊悬浮入口：品牌“忆”字标 + 文字，与设计稿及 Web 协作栏同一枚标识。 */
@Component
export struct FocusAgentLauncher {
  onOpen: () => void = (): void => {};
  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        Text('忆').fontFamily(PMFontFamily.BRAND_SERIF).fontSize(14).fontWeight(FontWeight.Bold).fontColor(PMColors.BRAND)
          .width(26).height(26).textAlign(TextAlign.Center).borderRadius(8).backgroundColor(PMColors.BRAND_LIGHT)
        Text('问忆程').fontFamily(PMFontFamily.SANS).fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
      }.padding({ left: 10, right: 16 }).height(48)
    }.backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER }).borderRadius(999).clip(true)
      .shadow({ radius: 14, color: 'rgba(28,46,44,0.10)', offsetX: 0, offsetY: 4 })
      .accessibilityText('问忆程，打开项目协作对话').onClick(() => { this.onOpen(); })
  }
}
