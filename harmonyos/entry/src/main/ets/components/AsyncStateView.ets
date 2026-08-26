import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';

@Component
export struct LoadingStateView {
  @Prop message: string = '数据加载中...';

  build() {
    Column() {
      LoadingProgress()
        .width(40)
        .height(40)
        .color(PMColors.BRAND)
      Text(this.message)
        .fontSize(PMFontSize.BASE)
        .fontColor(PMColors.INK_TERTIARY)
        .margin({ top: PMSpacing.MD })
    }
    .width('100%')
    .height('60%')
    .justifyContent(FlexAlign.Center)
  }
}

@Component
export struct ErrorStateView {
  @Prop message: string = '数据获取失败';
  public onRetry?: () => void;

  build() {
    Column() {
      Text('!')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.RISK)
        .width(44)
        .height(44)
        .textAlign(TextAlign.Center)
        .backgroundColor(PMColors.RISK_LIGHT)
        .borderRadius(PMRadius.FULL)
        .margin({ bottom: PMSpacing.MD })

      Text(this.message)
        .fontSize(PMFontSize.MD)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .textAlign(TextAlign.Center)
        .margin({ bottom: PMSpacing.LG })

      if (this.onRetry) {
        Button('重新加载')
          .fontSize(PMFontSize.BASE)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(PMColors.BRAND)
          .borderRadius(PMRadius.SM)
          .padding({ left: PMSpacing.XL, right: PMSpacing.XL, top: PMSpacing.SM, bottom: PMSpacing.SM })
          .onClick(() => {
            if (this.onRetry) {
              this.onRetry();
            }
          })
      }
    }
    .width('100%')
    .height('60%')
    .justifyContent(FlexAlign.Center)
    .padding({ left: PMSpacing.XXL, right: PMSpacing.XXL })
  }
}

@Component
export struct EmptyStateView {
  @Prop title: string = '暂无数据';
  @Prop description: string = '';
  @Prop actionText: string = '';
  public onAction?: () => void;

  build() {
    Column() {
      Column() {
        Text('◇')
          .fontSize(32)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ bottom: PMSpacing.SM })
        Text(this.title)
          .fontSize(PMFontSize.LG)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
          .textAlign(TextAlign.Center)

        if (this.description !== '') {
          Text(this.description)
            .fontSize(PMFontSize.BASE)
            .fontColor(PMColors.INK_TERTIARY)
            .textAlign(TextAlign.Center)
            .margin({ top: PMSpacing.SM })
        }

        if (this.actionText !== '' && this.onAction) {
          Button(this.actionText)
            .fontSize(PMFontSize.BASE)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .margin({ top: PMSpacing.LG })
            .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.SM, bottom: PMSpacing.SM })
            .onClick(() => {
              if (this.onAction) {
                this.onAction();
              }
            })
        }
      }
      .padding(PMSpacing.XXL)
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%')
    .height('60%')
    .justifyContent(FlexAlign.Center)
  }
}
