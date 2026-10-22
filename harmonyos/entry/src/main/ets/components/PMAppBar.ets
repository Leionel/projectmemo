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
            .fontSize(30)
            .fontWeight(FontWeight.Lighter)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: -2, right: this.backLabel !== '' ? 2 : 0 })
            .accessibilityLevel('no')
        }
        .width(44).height(44)
        .justifyContent(FlexAlign.Center)
        .alignItems(VerticalAlign.Center)
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .onClick(() => {
          router.back();
        })
        .accessibilityText(this.backDescription !== '' ? this.backDescription : `返回${this.backLabel}`)
      }

      Column() {
        Text(this.title)
          .fontSize(17)
          .fontWeight(FontWeight.Bold)
          .fontFamily(PMFontFamily.SANS)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(1)
          .lineHeight(22)
          .textOverflow({ overflow: TextOverflow.Ellipsis })

        if (this.subtitle !== '') {
          Text(this.subtitle)
            .fontSize(11)
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
          .height(44)
          .textAlign(TextAlign.Center)
          .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
          .borderRadius(PMRadius.SM)
          .backgroundColor(Color.Transparent)
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
        .width(44)
        .height(44)
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
    .constraintSize({ minHeight: 58 })
    .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 7, bottom: 7 })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }
}
