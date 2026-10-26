import { PMColors, PMFontFamily } from '../common/DesignTokens';
@Component
export struct FocusAgentLauncher {
  onOpen: () => void = (): void => {};
  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        Text('忆').fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.BRAND).width(27).height(27).textAlign(TextAlign.Center).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(9)
        Text('问忆程').fontFamily(PMFontFamily.SANS).fontSize(15).fontWeight(FontWeight.Medium).letterSpacing(0.5).fontColor(PMColors.INK_PRIMARY)
      }.padding({ left: 12, right: 15 }).height(48)
    }.backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER_STRONG }).borderRadius(16).clip(true)
      .shadow({ radius: 14, color: '#16203832', offsetX: 0, offsetY: 4 })
      .accessibilityText('问忆程，打开项目协作对话').onClick(() => { this.onOpen(); })
  }
}
