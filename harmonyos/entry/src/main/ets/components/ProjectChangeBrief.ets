import { PMColors, PMSpacing, PMFontSize, PMRadius, PMMotion, PMInteraction } from '../common/DesignTokens';
import { BriefEvidence, ChangeBrief, BriefSentence } from '../models/ProjectState';

// C1 变化简报：变化 → 影响 → 建议，逐句可追溯（依据数量）。
// 简报内容来自服务端确定性模板；读简报不创建行动；“已了解”复用状态面板的游标逻辑。
@Component
export struct ProjectChangeBrief {
  @Prop brief: ChangeBrief = new ChangeBrief();
  onClose: () => void = () => {};
  onGoActions: () => void = () => {};
  onOpenEvidence: (entityKind: string, entityId: string) => void = (_kind: string, _id: string) => {};

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

  @Builder
  private sentenceRow(sentence: BriefSentence) {
    Column() {
      Row() {
        Text(`${this.kindGlyph(sentence.kind)} 变化`)
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.kindColor(sentence.kind))
        Text(`依据 ${sentence.evidenceCount} 项`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)

      Text(sentence.text)
        .fontSize(PMFontSize.BODY)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .lineHeight(20)
        .margin({ top: 4 })

      Text(`影响：${sentence.impact}`)
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_SECONDARY)
        .lineHeight(18)
        .margin({ top: 4 })

      Text(`建议：${sentence.suggestion}`)
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.BRAND)
        .lineHeight(18)
        .margin({ top: 2 })

      if (sentence.evidence.length > 0) {
        Row({ space: PMSpacing.XS }) {
          ForEach(sentence.evidence.slice(0, 3), (ref: BriefEvidence) => {
            Text(`📎 ${ref.entityKind === 'card' ? '记忆' : ref.entityKind === 'action' ? '行动' : ref.entityKind === 'deliverable' ? '交付物' : ref.entityKind} · ${ref.field !== '' ? ref.field : '版本证据'}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 2, bottom: 2 })
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.XS)
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                this.onOpenEvidence(ref.entityKind, ref.entityId);
              })
              .accessibilityText(`打开${ref.entityKind}类证据，观察时间${ref.observedAt}`)
          }, (ref: BriefEvidence) => ref.entityId)
          if (sentence.evidence.length > 3) {
            Text(`+${sentence.evidence.length - 3}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
        }
        .margin({ top: 4 })
      }
    }
    .width('100%')
    .padding(PMSpacing.MD)
    .backgroundColor(PMColors.SURFACE_SUBTLE)
    .borderRadius(PMRadius.SM)
    .margin({ bottom: PMSpacing.SM })
    .alignItems(HorizontalAlign.Start)
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
          Text('自上次查看以来')
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

        Text(this.brief.headline)
          .fontSize(PMFontSize.BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .margin({ top: PMSpacing.XS, bottom: PMSpacing.SM })

        Scroll() {
          Column() {
            if (!this.brief.materialChange) {
              Text('没有需要处理的变化。你可以继续推进当前待办，或刷新状态查看最新评估。')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(20)
                .margin({ top: PMSpacing.MD })
            }
            ForEach(this.brief.sentences, (sentence: BriefSentence) => {
              this.sentenceRow(sentence)
            }, (sentence: BriefSentence) => sentence.changeKey)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .scrollable(ScrollDirection.Vertical)
        .layoutWeight(1)

        Button('去处理待办')
          .height(44)
          .fontSize(PMFontSize.BUTTON)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(PMColors.BRAND)
          .borderRadius(PMRadius.SM)
          .width('100%')
          .margin({ top: PMSpacing.MD })
          .onClick(() => {
            this.onClose();
            this.onGoActions();
          })
      }
      .width('92%')
      .height('75%')
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
