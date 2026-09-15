import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { AlertIcon, FolderIcon } from './PMIcons';

/**
 * 统一加载状态 (LoadingStateView)
 */
/**
 * 统一加载状态 (LoadingStateView)
 * 包含优雅的 Skeleton 骨架屏占位与状态提示，避免页面苍白空旷
 */
@Component
export struct LoadingStateView {
  @Prop message: string = '正在同步项目档案...';

  @Builder
  private SkeletonCard() {
    Column() {
      // 模拟顶部 Badge 与标题条
      Row() {
        Row()
          .width(56)
          .height(18)
          .borderRadius(PMRadius.SM)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
        Row()
          .width(80)
          .height(12)
          .borderRadius(2)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)

      // 模拟主标题
      Row()
        .width('68%')
        .height(16)
        .borderRadius(3)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .margin({ top: PMSpacing.MD })

      // 模拟描述行
      Row()
        .width('92%')
        .height(12)
        .borderRadius(2)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .margin({ top: PMSpacing.SM })

      // 模拟底部进度条与标签
      Row() {
        Row()
          .width(96)
          .height(12)
          .borderRadius(2)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
        Row()
          .width(64)
          .height(12)
          .borderRadius(2)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)
      .margin({ top: PMSpacing.LG })
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .margin({ bottom: PMSpacing.MD })
    .opacity(0.8)
  }

  build() {
    Column() {
      // 骨架屏卡片展示区
      Column() {
        this.SkeletonCard()
        this.SkeletonCard()
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.LG })

      // 居中加载进度提示
      Row({ space: PMSpacing.SM }) {
        LoadingProgress()
          .width(20)
          .height(20)
          .color(PMColors.BRAND)
        Text(this.message)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
      }
      .margin({ top: PMSpacing.LG, bottom: PMSpacing.XL })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }
}

/**
 * 统一用户层错误状态 (ErrorStateView)
 * 自动屏蔽底层 HTTP 500 / Network 等裸错误，转换为友好的原生生产力提示并提供重试。
 */
@Component
export struct ErrorStateView {
  @Prop message: string = '服务暂时不可用';
  public onRetry?: () => void;

  private getUserFriendlyMessage(): string {
    const raw = this.message.toLowerCase();
    if (raw.includes('500') || raw.includes('internal server error')) {
      return '状态分析暂时不可用，请稍后重试';
    }
    if (raw.includes('network') || raw.includes('failed to fetch') || raw.includes('econnrefused')) {
      return '网络连接不稳定，无法同步项目服务';
    }
    return this.message !== '' ? this.message : '服务暂时不可用，请稍后重试';
  }

  build() {
    Column() {
      Row() {
        AlertIcon({ iconSize: 22, color: PMColors.RISK })
      }
      .width(48)
      .height(48)
      .borderRadius(PMRadius.FULL)
      .backgroundColor(PMColors.RISK_LIGHT)
      .justifyContent(FlexAlign.Center)
      .margin({ bottom: PMSpacing.MD })

      Text(this.getUserFriendlyMessage())
        .fontSize(PMFontSize.MD)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .textAlign(TextAlign.Center)
        .margin({ bottom: PMSpacing.LG })

      if (this.onRetry) {
        Button('重新加载')
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(PMColors.BRAND)
          .borderRadius(PMRadius.SM)
          .height(44)
          .padding({ left: PMSpacing.XXL, right: PMSpacing.XXL })
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

/**
 * 统一空状态 (EmptyStateView)
 */
@Component
export struct EmptyStateView {
  @Prop title: string = '暂无数据';
  @Prop description: string = '';
  @Prop actionText: string = '';
  public onAction?: () => void;

  build() {
    Column() {
      Column() {
        Row() {
          FolderIcon({ isSelected: false, iconSize: 24 })
        }
        .width(52)
        .height(52)
        .borderRadius(PMRadius.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
        .justifyContent(FlexAlign.Center)
        .margin({ bottom: PMSpacing.MD })

        Text(this.title)
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
          .textAlign(TextAlign.Center)

        if (this.description !== '') {
          Text(this.description)
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .textAlign(TextAlign.Center)
            .lineHeight(20)
            .margin({ top: PMSpacing.SM })
        }

        if (this.actionText !== '' && this.onAction) {
          Button(this.actionText)
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .height(44)
            .margin({ top: PMSpacing.LG })
            .padding({ left: PMSpacing.XL, right: PMSpacing.XL })
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
