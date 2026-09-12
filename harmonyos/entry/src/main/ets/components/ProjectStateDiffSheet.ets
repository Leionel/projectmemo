import { PMColors, PMSpacing, PMFontSize, PMRadius, PMMotion } from '../common/DesignTokens';
import { StateDiff, StateDiffItem } from '../models/ProjectState';

@Component
export struct ProjectStateDiffSheet {
  @Prop diff: StateDiff = new StateDiff();
  onClose: () => void = () => {};

  private kindGlyph(kind: string): string {
    if (kind === 'ADDED') return '＋';
    if (kind === 'RESOLVED') return '✓';
    if (kind === 'REGRESSED') return '!';
    if (kind === 'UNCERTAIN') return '?';
    return '→';
  }

  private kindColor(kind: string): ResourceColor {
    if (kind === 'RESOLVED') return PMColors.SUCCESS;
    if (kind === 'REGRESSED') return PMColors.RISK;
    if (kind === 'UNCERTAIN') return PMColors.EVIDENCE;
    return PMColors.BRAND;
  }

  build() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .onClick(() => {
          this.onClose();
        })

      Column() {
        Row() {
          Text('状态变化详情')
            .fontSize(PMFontSize.TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
          Button('✕')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .backgroundColor('transparent')
            .onClick(() => {
              this.onClose();
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)

        Text(this.diff.summary)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_SECONDARY)
          .margin({ top: PMSpacing.XS, bottom: PMSpacing.SM })

        Scroll() {
          Column() {
            if (this.diff.items.length === 0) {
              Text('两个状态之间没有可确认的重要变化。')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ top: PMSpacing.LG })
            }
            ForEach(this.diff.items, (item: StateDiffItem) => {
              Row() {
                Text(`${this.kindGlyph(item.kind)} ${item.kind}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.kindColor(item.kind))
                  .width(64)

                Column() {
                  Text(item.summary)
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.INK_PRIMARY)
                    .lineHeight(20)
                  Text(`依据：${item.evidenceRefs.length} 项记录（${item.evidenceRefs.length > 0 ? item.evidenceRefs[0].entityKind : '-'}）`)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .margin({ top: 2 })
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                .margin({ left: PMSpacing.SM })
              }
              .width('100%')
              .alignItems(VerticalAlign.Top)
              .padding(PMSpacing.SM)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .margin({ bottom: PMSpacing.SM })
            }, (item: StateDiffItem) => item.changeKey)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .scrollable(ScrollDirection.Vertical)
        .layoutWeight(1)
      }
      .width('92%')
      .height('70%')
      .padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG)
      .border({ width: 1, color: PMColors.BORDER })
      .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.96, y: 0.96 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }
}
