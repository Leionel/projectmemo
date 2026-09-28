import { PMColors, PMSpacing, PMFontSize, PMRadius, PMMotion, PMInteraction } from '../common/DesignTokens';
import { CompetitionReadiness, ReadinessItem } from '../models/Project';
import { TextFormatters } from '../common/TextFormatters';

/**
 * 项目内准备项逐项说明。
 *
 * 这六项是应用内信号（记忆、行动回执、成果草稿是否形成），全部来自服务端
 * `dashboard.readiness.items`，不是模型评分；它没有核验可安装 HAP、作品说明 PDF
 * 或演示 MP4，因此界面不能把这个百分比读作复赛提交已通过验收。
 */
@Component
export struct ReadinessBreakdownSheet {
  @Prop readiness: CompetitionReadiness = new CompetitionReadiness();
  /** 是否提供逐项入口：项目工作台可以跳 Tab，项目列表页只读 */
  @Prop showItemEntry: boolean = false;
  onClose: () => void = () => {};
  onOpenItem: (key: string) => void = (_key: string) => {};

  private completedCount(): number {
    let count = 0;
    for (let i = 0; i < this.readiness.items.length; i++) {
      if (this.readiness.items[i].complete) {
        count++;
      }
    }
    return count;
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .onClick(() => {
          this.onClose();
        })

      Column() {
        // 拖拽条：提示这是可中途收起的底部面板
        Row()
          .width(37)
          .height(4)
          .borderRadius(PMRadius.FULL)
          .backgroundColor(PMColors.BORDER_STRONG)
          .margin({ bottom: PMSpacing.LG })

        Row() {
          Text(`项目内准备项 · ${this.completedCount()} / ${this.readiness.items.length}`)
            .fontSize(PMFontSize.TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .layoutWeight(1)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Button('✕')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .backgroundColor('transparent')
            .width(44)
            .height(44)
            .onClick(() => {
              this.onClose();
            })
            .accessibilityText('关闭项目内准备项说明')
        }
        .width('100%')
        .alignItems(VerticalAlign.Top)

        Text('按项目记录、行动回执与成果草稿是否形成计数；不是模型评分，也不代表复赛材料已通过提交验收。')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .width('100%')

        Scroll() {
          Column() {
            if (this.readiness.items.length === 0) {
              Text('服务端暂时没有返回准备项清单，可稍后重试；这里不会用默认值凑数。')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(20)
                .width('100%')
                .padding({ top: PMSpacing.LG, bottom: PMSpacing.LG })
            }

            ForEach(this.readiness.items, (item: ReadinessItem) => {
              Column() {
                Row() {
                  Text(TextFormatters.readableText(item.label, '准备项名称无法读取'))
                    .fontSize(PMFontSize.BODY)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)
                    .layoutWeight(1)
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })

                  Text(TextFormatters.readinessStateLabel(item.key, item.complete))
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(item.complete ? PMColors.SUCCESS : PMColors.INK_TERTIARY)
                    .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .borderRadius(PMRadius.XS)
                    .accessibilityText(`状态：${TextFormatters.readinessStateLabel(item.key, item.complete)}`)
                }
                .width('100%')
                .alignItems(VerticalAlign.Top)

                Text(`计算口径：${TextFormatters.readinessCriterion(item.key)}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .lineHeight(18)
                  .width('100%')
                  .margin({ top: PMSpacing.XS })

                if (this.showItemEntry && !item.complete) {
                  Button(item.actionLabel !== '' ? `${item.actionLabel} →` : '去处理 →')
                    .fontSize(PMFontSize.CAPTION)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.BRAND)
                    .backgroundColor(PMColors.BRAND_LIGHT)
                    .borderRadius(PMRadius.SM)
                    .height(36)
                    .margin({ top: PMSpacing.SM })
                    .clickEffect(PMInteraction.PRESS_EFFECT)
                    .onClick(() => {
                      this.onOpenItem(item.key);
                    })
                    .accessibilityText(`${item.actionLabel}，前往对应入口`)
                }
              }
              .width('100%')
              .padding(PMSpacing.MD)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: { left: 2 }, color: item.complete ? PMColors.EVIDENCE : PMColors.BORDER })
              .alignItems(HorizontalAlign.Start)
              .margin({ top: PMSpacing.SM })
            }, (item: ReadinessItem) => item.key)

            Row() {
              Text('计算口径')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_SECONDARY)
                .layoutWeight(1)
              Text(`${this.completedCount()} ÷ ${this.readiness.items.length} ≈ ${this.readiness.percentage}%`)
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_PRIMARY)
            }
            .width('100%')
            .padding(PMSpacing.MD)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .margin({ top: PMSpacing.MD })

            Text('可安装 HAP、作品说明 PDF 与演示 MP4 属于复赛提交材料，需要单独验收，不计入这个百分比。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .lineHeight(18)
              .width('100%')
              .margin({ top: PMSpacing.SM })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .scrollable(ScrollDirection.Vertical)
        .scrollBar(BarState.Auto)
        .layoutWeight(1)
        .margin({ top: PMSpacing.SM })

        Button('知道了')
          .width('100%')
          .height(48)
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(PMColors.BRAND)
          .borderRadius(PMRadius.SM)
          .margin({ top: PMSpacing.LG })
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')
      .constraintSize({ maxHeight: '82%' })
      // 底部留出导航指示条区域：固定操作区不能压在系统手势区上
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
