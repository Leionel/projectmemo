import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction, PMMotion, PMMaterial } from '../common/DesignTokens';
import { KnowledgeCard } from '../models/Memory';
import { TextFormatters } from '../common/TextFormatters';

@Component
export struct ClaimAuditorDrawer {
  @Prop cards: KnowledgeCard[] = [];
  @Prop artifactTitle: string = '';
  onClose: () => void = () => {};

  private isCardSuperseded(card: KnowledgeCard): boolean {
    if (card.incomingLinks && card.incomingLinks.length > 0) {
      for (let i = 0; i < card.incomingLinks.length; i++) {
        if (card.incomingLinks[i].relationType === 'SUPERSEDES') {
          return true;
        }
      }
    }
    return false;
  }

  build() {
    Stack() {
      // 遮罩
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .backgroundBlurStyle(PMMaterial.SCRIM, PMMaterial.OPTIONS)
        .onClick(() => {
          this.onClose();
        })

      // 底部/居中上浮抽屉卡片
      Column() {
        // 顶栏
        Row() {
          Row() {
            Circle({ width: 8, height: 8 })
              .fill(PMColors.BRAND)
              .margin({ right: PMSpacing.SM })
            Text('证据透视镜 (Claim Auditor)')
              .fontSize(PMFontSize.TITLE)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_PRIMARY)
          }
          .alignItems(VerticalAlign.Center)

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
        .alignItems(VerticalAlign.Center)

        // 副标题与关联成果提示
        Row() {
          Text(`核验成果：【${this.artifactTitle}】`)
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)

          Text(`已溯源锁定 ${this.cards.length} 项关键存证`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .margin({ top: PMSpacing.XS, bottom: PMSpacing.MD })

        // 存证可信标识
        Row() {
          Row() {
            Text('🛡️')
              .fontSize(PMFontSize.BODY)
              .margin({ right: 6 })
            Text('学术存证与时态账本溯源')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.BRAND)
          }

          Text('端到端不可篡改')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .padding(PMSpacing.SM)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .margin({ bottom: PMSpacing.MD })

        // 证据卡片列表
        Scroll() {
          Column() {
            if (this.cards.length === 0) {
              Text('当前暂无关联证据卡片')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ top: PMSpacing.LG })
            } else {
              ForEach(this.cards, (card: KnowledgeCard, index: number) => {
                Column() {
                  // 卡片头部：类型与时态标签
                  Row() {
                    Text(TextFormatters.memoryTypeToChinese(card.type))
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.MEMORY)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                      .borderRadius(PMRadius.XS)

                    Text(this.isCardSuperseded(card) ? '🔴 已被新方案取代' : '🟢 当前有效')
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.isCardSuperseded(card) ? PMColors.RISK : PMColors.SUCCESS)
                      .backgroundColor(this.isCardSuperseded(card) ? PMColors.RISK_LIGHT : PMColors.BRAND_LIGHT)
                      .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                      .borderRadius(PMRadius.XS)
                      .margin({ left: PMSpacing.SM })
                  }
                  .width('100%')
                  .justifyContent(FlexAlign.SpaceBetween)

                  // 标题
                  Text(card.title)
                    .fontSize(PMFontSize.BODY)
                    .fontWeight(FontWeight.Bold)
                    .fontColor(PMColors.INK_PRIMARY)
                    .margin({ top: PMSpacing.XS })

                  // 内容摘要
                  Text(card.summary)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_SECONDARY)
                    .lineHeight(18)
                    .margin({ top: 4 })

                  // 底部来源与时间
                  Row() {
                    Text(`记录于 ${card.createdAt.length >= 10 ? card.createdAt.substring(0, 10) : '近期'}`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)

                    Text(`存证索引 #${index + 1}`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)
                  }
                  .width('100%')
                  .justifyContent(FlexAlign.SpaceBetween)
                  .margin({ top: PMSpacing.SM })
                }
                .width('100%')
                .padding(PMSpacing.MD)
                .backgroundColor(PMColors.SURFACE)
                .borderRadius(PMRadius.SM)
                .border({ width: 1, color: PMColors.BORDER })
                .margin({ bottom: PMSpacing.SM })
              }, (card: KnowledgeCard) => card.id)
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .scrollable(ScrollDirection.Vertical)
        .constraintSize({ maxHeight: '65%' })
      }
      .width('92%')
      .padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG)
      .border({ width: 1, color: PMColors.BORDER })
      .shadow({ radius: 20, color: 'rgba(0, 0, 0, 0.15)', offsetX: 0, offsetY: 8 })
      .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.95, y: 0.95 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }
}
