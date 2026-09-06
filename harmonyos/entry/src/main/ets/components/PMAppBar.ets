import router from '@ohos.router';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily, PMInteraction } from '../common/DesignTokens';
import { MoreIcon } from './PMIcons';

/**
 * 全站唯一顶栏。ProjectHome 曾经有一份等价实现，两处并行会随材质与状态改动漂移。
 */
@Component
export struct PMAppBar {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop showBack: boolean = true;
  @Prop backLabel: string = '项目';
  @Prop backDescription: string = '';
  @Prop rightActionText: string = '';
  @Prop showRightIcon: boolean = false;
  @Prop rightIconLabel: string = '';
  @Prop rightIconDescription: string = '';
  public onRightAction?: () => void;

  build() {
    Row() {
      if (this.showBack) {
        Row() {
          Text('‹')
            .fontSize(22)
            .fontWeight(FontWeight.Regular)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: -2, right: 4 })
            .accessibilityLevel('no')
          Text(this.backLabel)
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_PRIMARY)
            .fontWeight(FontWeight.Medium)
        }
        .padding({ left: PMSpacing.SM, right: PMSpacing.MD, top: PMSpacing.XS, bottom: PMSpacing.XS })
        .height(44)
        .borderRadius(PMRadius.SM)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .border({ width: 1, color: PMColors.BORDER })
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          router.back();
        })
        .accessibilityText(this.backDescription !== '' ? this.backDescription : `返回${this.backLabel}`)
      }

      Column() {
        Text(this.title)
          .fontSize(PMFontSize.PAGE_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontFamily(PMFontFamily.SANS)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(2)
          .lineHeight(24)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (this.subtitle !== '') {
          Text(this.subtitle)
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_SECONDARY)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: 2 })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      .margin({ left: this.showBack ? PMSpacing.MD : 0 })

      if (this.rightActionText !== '') {
        Text(this.rightActionText)
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.BRAND)
          .height(44)
          .textAlign(TextAlign.Center)
          .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: PMSpacing.SM, bottom: PMSpacing.SM })
          .borderRadius(PMRadius.SM)
          .backgroundColor(PMColors.BRAND_LIGHT)
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            if (this.onRightAction) {
              this.onRightAction();
            }
          })
          .accessibilityText(this.rightActionText)
      }

      if (this.showRightIcon) {
        Row() {
          MoreIcon({ isSelected: false, iconSize: 20 })
        }
        .width(44)
        .height(44)
        .justifyContent(FlexAlign.Center)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          if (this.onRightAction) {
            this.onRightAction();
          }
        })
        .accessibilityText(this.rightIconLabel)
        .accessibilityDescription(this.rightIconDescription)
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.MD })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }
}
