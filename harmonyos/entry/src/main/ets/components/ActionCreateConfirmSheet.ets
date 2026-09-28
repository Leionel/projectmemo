import { PMColors, PMSpacing, PMFontSize, PMRadius, PMMotion, PMInteraction } from '../common/DesignTokens';
import { Intervention, ProposedAction } from '../models/Intervention';
import { TextFormatters } from '../common/TextFormatters';

/**
 * 候选行动确认面板：预览与提交分开。
 *
 * 「创建行动」不能在点击瞬间写入。这里先展示将要创建的候选行动、优先级、说明与依据条数，
 * 用户确认后才由调用方执行 accept；确认前可以返回去看提醒依据。
 */
@Component
export struct ActionCreateConfirmSheet {
  @Prop intervention: Intervention = new Intervention();
  @Prop actionIndex: number = 0;
  @Prop isSubmitting: boolean = false;
  @Prop operationError: string = '';
  onClose: () => void = () => {};
  onConfirm: () => void = () => {};

  private candidate(): ProposedAction | null {
    if (this.actionIndex < 0 || this.actionIndex >= this.intervention.proposedActions.length) {
      return null;
    }
    return this.intervention.proposedActions[this.actionIndex];
  }

  @Builder
  private DetailRow(label: string, value: string) {
    // 标签不写死宽度：系统字体放大到 200% 时固定宽度会把「来源提醒」这类四字标签截断
    Column() {
      Text(label)
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_TERTIARY)
      Text(value)
        .fontSize(PMFontSize.SECONDARY)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .lineHeight(20)
        .margin({ top: 2 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding({ top: PMSpacing.MD, bottom: PMSpacing.MD })
    .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .onClick(() => {
          if (!this.isSubmitting) {
            this.onClose();
          }
        })

      Column() {
        Row()
          .width(37)
          .height(4)
          .borderRadius(PMRadius.FULL)
          .backgroundColor(PMColors.BORDER_STRONG)
          .margin({ bottom: PMSpacing.LG })

        Text('确认创建行动')
          .fontSize(PMFontSize.TITLE)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
          .width('100%')

        Text('系统提供候选行动，确认后才写入项目待办。')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .width('100%')
          .margin({ top: PMSpacing.XS })

        if (this.candidate() === null) {
          Text('这条提醒没有可选的候选行动，请先到提醒详情查看依据。')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(20)
            .width('100%')
            .margin({ top: PMSpacing.LG })
        } else {
          Column() {
            this.DetailRow('行动', TextFormatters.readableText(this.candidate()!.title, '行动标题无法读取，请重新评估。'))
            this.DetailRow('优先级', TextFormatters.priorityToChinese(this.candidate()!.priority))
            if (this.candidate()!.description !== undefined && this.candidate()!.description !== null && this.candidate()!.description !== '') {
              this.DetailRow('说明', TextFormatters.readableText(this.candidate()!.description!, '行动说明无法读取。'))
            }
            this.DetailRow('来源提醒', TextFormatters.readableText(this.intervention.title, '提醒标题无法读取，请重新评估。'))
            this.DetailRow('依据', TextFormatters.evidenceCountLine(
              this.intervention.evidence.facts !== undefined && this.intervention.evidence.facts !== null ? this.intervention.evidence.facts.length : 0,
              this.intervention.evidence.cardIds !== undefined && this.intervention.evidence.cardIds !== null ? this.intervention.evidence.cardIds.length : 0
            ))
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .margin({ top: PMSpacing.SM })

          if (this.intervention.isSimulated) {
            Text('演示情境生成的模拟提醒：创建的行动会标记为模拟数据，不计入真实项目指标。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.RISK)
              .lineHeight(18)
              .width('100%')
              .padding(PMSpacing.SM)
              .backgroundColor(PMColors.RISK_LIGHT)
              .borderRadius(PMRadius.SM)
              .margin({ top: PMSpacing.MD })
          }

          Text('确认前可返回查看提醒依据；创建行动不等于已排程，也不等于已完成。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(18)
            .width('100%')
            .margin({ top: PMSpacing.MD })
        }

        if (this.operationError !== '') {
          Text(this.operationError)
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.RISK)
            .lineHeight(18)
            .width('100%')
            .margin({ top: PMSpacing.SM })
            .accessibilityText(`创建失败：${this.operationError}`)
        }

        Row({ space: PMSpacing.SM }) {
          Button('返回')
            .layoutWeight(1)
            .height(48)
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)
            .backgroundColor(PMColors.SURFACE)
            .border({ width: 1, color: PMColors.BORDER })
            .borderRadius(PMRadius.SM)
            .enabled(!this.isSubmitting)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              this.onClose();
            })

          Button(this.isSubmitting ? '创建中…' : '确认创建')
            .layoutWeight(1.35)
            .height(48)
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .enabled(!this.isSubmitting && this.candidate() !== null)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .onClick(() => {
              this.onConfirm();
            })
            .accessibilityText('确认创建这条候选行动')
        }
        .width('100%')
        .margin({ top: PMSpacing.LG })
      }
      .width('100%')
      .constraintSize({ maxHeight: '82%' })
      .padding({
        left: PMSpacing.LG,
        right: PMSpacing.LG,
        top: PMSpacing.SM,
        bottom: PMSpacing.XXL
      })
      .backgroundColor(PMColors.SURFACE)
      .borderRadius({ topLeft: PMRadius.XXL, topRight: PMRadius.XXL })
      .transition(TransitionEffect.OPACITY.combine(TransitionEffect.translate({ y: 26 }))
        .animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
    }
    .width('100%')
    .height('100%')
  }
}
