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
  /** 文字型右侧动作的独立回调（未设置时回退 onRightAction） */
  public onRightTextAction?: () => void;

  build() {
    Row() {
      if (this.showBack) {
        Row() {
          Text('‹')
            .fontSize(24)
            .fontWeight(FontWeight.Lighter)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: -2, right: this.backLabel !== '' ? 2 : 0 })
            .accessibilityLevel('no')
          if (this.backLabel !== '') {
            Text(this.backLabel.length > 4 ? this.backLabel.substring(0, 4) : this.backLabel)
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.INK_PRIMARY)
              .fontWeight(FontWeight.Medium)
              .maxLines(1)
          }
        }
        .padding({ left: 8, right: this.backLabel !== '' ? 12 : 8, top: 4, bottom: 4 })
        .height(40)
        .borderRadius(PMRadius.SM)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
        .alignItems(VerticalAlign.Center)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          router.back();
        })
        .accessibilityText(this.backDescription !== '' ? this.backDescription : `返回${this.backLabel}`)
      }

      Column() {
        Text(this.title)
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontFamily(PMFontFamily.SANS)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(1)
          .lineHeight(22)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (this.subtitle !== '') {
          Text(this.subtitle)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: 1 })
        }
      }
      .alignItems(HorizontalAlign.Start)
      .justifyContent(FlexAlign.Center)
      .layoutWeight(1)
      .margin({ left: this.showBack ? PMSpacing.SM : 0, right: PMSpacing.SM })

      if (this.rightActionText !== '') {
        Text(this.rightActionText)
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.BRAND)
          .height(36)
          .textAlign(TextAlign.Center)
          .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
          .borderRadius(PMRadius.SM)
          .backgroundColor(PMColors.BRAND_LIGHT)
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            if (this.onRightTextAction) {
              this.onRightTextAction();
            } else if (this.onRightAction) {
              this.onRightAction();
            }
          })
          .accessibilityText(this.rightActionText)
          .margin({ right: this.showRightIcon ? PMSpacing.XS : 0 })
      }

      if (this.showRightIcon) {
        Row() {
          MoreIcon({ isSelected: false, iconSize: 20 })
        }
        .width(40)
        .height(40)
        .borderRadius(PMRadius.SM)
        .justifyContent(FlexAlign.Center)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          if (this.onRightAction) {
            this.onRightAction();
          }
        })
        .accessibilityText(this.rightIconLabel !== '' ? this.rightIconLabel : '更多选项')
        .accessibilityDescription(this.rightIconDescription)
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: PMSpacing.SM, bottom: PMSpacing.SM })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }
}
