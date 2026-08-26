import router from '@ohos.router';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily } from '../common/DesignTokens';

@Component
export struct PMAppBar {
  @Prop title: string = '';
  @Prop subtitle: string = '';
  @Prop showBack: boolean = true;
  @Prop backLabel: string = '项目';
  @Prop rightActionText: string = '';
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
          Text(this.backLabel)
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_PRIMARY)
            .fontWeight(FontWeight.Medium)
        }
        .padding({ left: PMSpacing.SM, right: PMSpacing.MD, top: PMSpacing.XS, bottom: PMSpacing.XS })
        .borderRadius(PMRadius.SM)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .border({ width: 1, color: PMColors.BORDER })
        .onClick(() => {
          router.back();
        })
        .accessibilityText(`返回${this.backLabel}`)
      }

      Column() {
        Text(this.title)
          .fontSize(PMFontSize.PAGE_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontFamily(PMFontFamily.SANS)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(1)
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
          .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: PMSpacing.SM, bottom: PMSpacing.SM })
          .borderRadius(PMRadius.SM)
          .backgroundColor(PMColors.BRAND_LIGHT)
          .onClick(() => {
            if (this.onRightAction) {
              this.onRightAction();
            }
          })
          .accessibilityText(this.rightActionText)
      }
    }
    .width('100%')
    .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.MD })
    .backgroundColor(PMColors.SURFACE)
    .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }
}
