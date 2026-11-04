import { PMFontFamily, PMColors, PMFontSize, PMSpacing, PMRadius, PMInteraction } from '../common/DesignTokens';
import { CloseIcon } from './PMIcons';

@Component
export struct PMButton {
  @Prop label: string = '';
  @Prop secondary: boolean = false;
  @Prop disabled: boolean = false;
  /** true：按文字定宽（卡片内的主操作），false：占满所在行（表单、弹层底部）。 */
  @Prop fit: boolean = false;
  onAction: () => void = (): void => {};
  build() {
    Button(this.label, { type: ButtonType.Normal })
      .width(this.fit ? 'auto' : '100%').constraintSize({ minHeight: 44 }).padding({ left: 18, right: 18, top: 10, bottom: 10 })
      .fontSize(PMFontSize.BUTTON).fontWeight(FontWeight.Medium)
      .fontColor(this.secondary ? PMColors.INK_PRIMARY : PMColors.SURFACE)
      .backgroundColor(this.secondary ? PMColors.SURFACE : PMColors.BRAND)
      .border({ width: this.secondary ? 1 : 0, color: PMColors.BORDER })
      .borderRadius(PMRadius.BUTTON).enabled(!this.disabled)
      .onClick(() => { this.onAction(); })
  }
}

/**
 * 统一关闭按钮：真实图标 + 44×44 触控区 + 浅色底。
 * 所有底部弹层/浮层的右上角关闭都使用本组件，避免各自用文字 '✕' 导致
 * 字号、粗细、触控区与背景不一致。
 */
@Component
export struct PMCloseButton {
  @Prop accessibilityLabel: string = '关闭';
  @Prop closeDisabled: boolean = false;
  onAction: () => void = (): void => {};

  build() {
    Button({ type: ButtonType.Normal }) {
      CloseIcon({ iconSize: 20, iconColor: PMColors.INK_SECONDARY })
    }
    .width(44)
    .height(44)
    .borderRadius(PMRadius.FULL)
    .backgroundColor(PMColors.SURFACE_SUBTLE)
    .enabled(!this.closeDisabled)
    .opacity(this.closeDisabled ? 0.4 : 1)
    .clickEffect(PMInteraction.PRESS_EFFECT)
    .accessibilityText(this.accessibilityLabel)
    .onClick(() => { this.onAction(); })
  }
}

/**
 * 统一弹层标题行：左侧标题（可带副标题），右侧统一关闭按钮。
 * 弹层容器使用统一内边距，标题与关闭按钮基线一致。
 */
@Component
export struct PMSheetHeader {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop closeLabel: string = '关闭';
  @Prop closeDisabled: boolean = false;
  onClose: () => void = (): void => {};

  build() {
    Row({ space: PMSpacing.SM }) {
      Column({ space: 2 }) {
        Text(this.title)
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.subtitle !== '') {
          Text(this.subtitle)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      PMCloseButton({ accessibilityLabel: this.closeLabel, closeDisabled: this.closeDisabled, onAction: () => { this.onClose(); } })
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
  }
}

@Component
export struct PMStatusPill {
  @Prop label: string = '';
  @Prop tone: string = 'brand';
  build() {
    Text(this.label).fontSize(PMFontSize.CAPTION).fontWeight(FontWeight.Medium)
      .fontColor(this.tone === 'risk' ? PMColors.RISK : this.tone === 'warning' ? PMColors.WARNING : PMColors.BRAND)
      .padding({ left: 8, right: 8, top: 5, bottom: 5 }).borderRadius(PMRadius.SM)
      .backgroundColor(this.tone === 'risk' ? PMColors.RISK_LIGHT : this.tone === 'warning' ? PMColors.WARNING_LIGHT : PMColors.BRAND_LIGHT)
  }
}

@Component
export struct PMPageIntro {
  @Prop compact: boolean = false;
  @Prop eyebrow: string = '';
  @Prop title: string = '';
  @Prop description: string = '';
  build() {
    Column({ space: 6 }) {
      if (this.eyebrow !== '') { Text(this.eyebrow).fontSize(12).fontColor(PMColors.INK_TERTIARY) }
      Text(this.title).fontSize(this.compact ? 24 : PMFontSize.PAGE_TITLE).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
      if (this.description !== '') { Text(this.description).fontSize(13).fontColor(PMColors.INK_SECONDARY).lineHeight(21).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis }) }
    }.width('100%').alignItems(HorizontalAlign.Start).margin({ bottom: this.compact ? 10 : 18 })
  }
}

@Component
export struct PMMetricTile {
  @Prop label: string = '';
  @Prop value: string = '';
  @Prop hint: string = '';
  onOpen: () => void = (): void => {};
  build() {
    Column({ space: 6 }) {
      Text(this.label).fontSize(12).fontColor(PMColors.INK_TERTIARY)
      Text(this.value).fontSize(27).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
      Text(this.hint).fontSize(12).fontWeight(FontWeight.Medium).fontColor(PMColors.BRAND)
    }.width('100%').alignItems(HorizontalAlign.Start).padding(14)
      .backgroundColor(PMColors.SURFACE).borderRadius(14).border({ width: 1, color: PMColors.BORDER_SUBTLE })
      .clickEffect(PMInteraction.PRESS_EFFECT).onClick(() => { this.onOpen(); })
      .accessibilityText(`${this.label} ${this.value}，${this.hint}`)
  }
}

@Component
export struct PMListRow {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop meta: string = '';
  @Prop kind: string = 'record';
  @Prop status: string = '';
  @Prop risk: boolean = false;
  onOpen: () => void = (): void => {};
  build() {
    Row({ space: 10 }) {
      Column({ space: 4 }) {
        if (this.status !== '' || this.meta !== '') {
          Row({ space: 8 }) {
            if (this.status !== '') { PMStatusPill({ label: this.status, tone: this.risk ? 'risk' : this.kind === 'reminder' ? 'warning' : 'brand' }) }
            if (this.meta !== '') { Text(this.meta).fontSize(12).fontColor(PMColors.INK_TERTIARY).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1) }
          }.width('100%')
        }
        Text(this.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.subtitle !== '') { Text(this.subtitle).fontSize(13).fontColor(PMColors.INK_SECONDARY).lineHeight(19).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }) }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      Text('›').fontSize(20).fontColor(PMColors.INK_MUTED)
    }.width('100%').alignItems(VerticalAlign.Center).padding({ left: 16, right: 12, top: 14, bottom: 14 })
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      .clickEffect(PMInteraction.PRESS_EFFECT).onClick(() => { this.onOpen(); })
      .accessibilityText(`${this.title}，${this.subtitle}，${this.status}，查看详情`)
  }
}
