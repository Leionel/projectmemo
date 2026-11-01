import { PMColors, PMFontFamily } from '../common/DesignTokens';
import { CopilotIcon } from './PMIcons';

/** 「问忆程」胶囊悬浮入口：品牌对话气泡 + 文字，克制的边框与阴影。 */
@Component
export struct FocusAgentLauncher {
  onOpen: () => void = (): void => {};
  build() {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 7 }) {
        CopilotIcon({ iconSize: 19, isSelected: true })
        Text('问忆程').fontFamily(PMFontFamily.SANS).fontSize(15).fontWeight(FontWeight.Medium).letterSpacing(0.5).fontColor(PMColors.INK_PRIMARY)
      }.padding({ left: 14, right: 16 }).height(50)
    }.backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER_STRONG }).borderRadius(999).clip(true)
      .shadow({ radius: 12, color: 'rgba(19,36,58,0.10)', offsetX: 0, offsetY: 3 })
      .accessibilityText('问忆程，打开项目协作对话').onClick(() => { this.onOpen(); })
  }
}
