import { PMColors } from '../common/DesignTokens';

interface ToolPopupState { isVisible: boolean; }

@Component
export struct ConversationToolButton {
  @Prop icon: Resource = $r('sys.symbol.doc_text');
  @Prop label: string = '';
  @Prop count: number = 0;
  @Prop selected: boolean = false;
  @Prop disabled: boolean = false;
  onAction: () => void = () => {};
  @State private showHelp: boolean = false;

  build() {
    Button({ type: ButtonType.Normal }) {
      Stack() {
        SymbolGlyph(this.icon).fontSize(16).fontColor([this.selected ? PMColors.BRAND : PMColors.INK_SECONDARY])
          .accessibilityLevel('no')
        if (this.count > 0) {
          Text(this.count > 99 ? '99+' : this.count.toString()).fontSize(12).fontColor(PMColors.INK_SECONDARY)
            .constraintSize({ minWidth: 16 }).height(16).textAlign(TextAlign.Center)
            .backgroundColor(PMColors.SURFACE).borderRadius(5).position({ x: 27, y: 0 })
            .accessibilityLevel('no')
        }
      }.width(44).height(36)
    }.width(44).height(36).padding(0).borderRadius(8)
      .responseRegion({ x: 0, y: -4, width: 44, height: 44 })
      .backgroundColor(this.selected ? PMColors.BRAND_LIGHT : Color.Transparent).enabled(!this.disabled)
      .accessibilityText(this.label + (this.count > 0 ? ' ' + this.count.toString() : ''))
      .accessibilityDescription(this.selected ? '已展开，再次点击收起' : '')
      .onClick(() => { this.onAction(); })
      .gesture(LongPressGesture({ repeat: false, duration: 500 }).onAction(() => { this.showHelp = true; }))
      .onHover((hover: boolean) => { this.showHelp = hover; })
      .bindPopup(this.showHelp, { message: this.label, placement: Placement.Top,
        onStateChange: (state: ToolPopupState) => { if (!state.isVisible) { this.showHelp = false; } } })
  }
}
