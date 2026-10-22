import { PMColors, PMFontSize, PMSpacing, PMRadius, PMInteraction } from '../common/DesignTokens';
import { AlertIcon, MemoryIcon, TaskIcon, ClockIcon } from './PMIcons';

@Component
export struct PMButton {
  @Prop label: string = '';
  @Prop secondary: boolean = false;
  @Prop disabled: boolean = false;
  onAction: () => void = (): void => {};
  build() {
    Button(this.label, { type: ButtonType.Normal })
      .width('100%').constraintSize({ minHeight: 44 }).padding({ left: 14, right: 14, top: 10, bottom: 10 })
      .fontSize(PMFontSize.BUTTON).fontWeight(FontWeight.Medium)
      .fontColor(this.secondary ? PMColors.BRAND : PMColors.SURFACE)
      .backgroundColor(this.secondary ? PMColors.BRAND_LIGHT : PMColors.BRAND)
      .borderRadius(PMRadius.BUTTON).enabled(!this.disabled)
      .onClick(() => { this.onAction(); })
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
      if (this.eyebrow !== '') { Text(this.eyebrow).fontSize(12).fontWeight(FontWeight.Medium).fontColor(PMColors.BRAND) }
      Text(this.title).fontSize(this.compact ? 20 : PMFontSize.PAGE_TITLE).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
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
    Row({ space: 11 }) {
      Row() {
        if (this.kind === 'mission') { AlertIcon({ iconSize: 18, color: PMColors.BRAND }) }
        else if (this.kind === 'action') { TaskIcon({ iconSize: 18, isSelected: true }) }
        else if (this.kind === 'reminder') { ClockIcon({ iconSize: 18, color: PMColors.BRAND }) }
        else { MemoryIcon({ iconSize: 18, isSelected: true }) }
      }.width(33).height(33).justifyContent(FlexAlign.Center).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(10)
      Column({ space: 4 }) {
        Text(this.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (this.subtitle !== '') { Text(this.subtitle).fontSize(12).fontColor(PMColors.INK_SECONDARY).lineHeight(18).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }) }
        if (this.meta !== '') { Text(this.meta).fontSize(11).fontColor(PMColors.INK_TERTIARY).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }) }
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      if (this.status !== '') { PMStatusPill({ label: this.status, tone: this.risk ? 'risk' : 'brand' }) }
      Text('›').fontSize(22).fontColor(PMColors.INK_TERTIARY)
    }.width('100%').alignItems(VerticalAlign.Top).padding(14)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      .clickEffect(PMInteraction.PRESS_EFFECT).onClick(() => { this.onOpen(); })
      .accessibilityText(`${this.title}，${this.subtitle}，${this.status}，查看详情`)
  }
}
