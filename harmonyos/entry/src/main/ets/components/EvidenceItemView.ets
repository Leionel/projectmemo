import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction } from '../common/DesignTokens';
import { PaperclipIcon, AlertIcon, SpineNodeIcon, BookOpenIcon, ClockIcon } from './PMIcons';

/**
 * 统一结构化证据项组件 (EvidenceItemView)
 * 专用于问忆程、主动提醒详情、成果依据与证据脊线。
 * 将纯点号长文本转为具象化、可追溯的证据条目。
 */
@Component
export struct EvidenceItemView {
  @Prop title: string = '';
  @Prop sourceLabel: string = '';
  @Prop timeText: string = '';
  @Prop iconType: string = 'memory'; // 'memory' | 'risk' | 'action' | 'requirement' | 'calendar'
  public onClickItem?: () => void;

  private getIconBg(): ResourceColor {
    switch (this.iconType) {
      case 'risk':
        return PMColors.RISK_LIGHT;
      case 'requirement':
        return PMColors.EVIDENCE_LIGHT;
      case 'action':
        return PMColors.SUCCESS_LIGHT;
      case 'memory':
      default:
        return PMColors.BRAND_LIGHT;
    }
  }

  private getIconColor(): ResourceColor {
    switch (this.iconType) {
      case 'risk':
        return PMColors.RISK;
      case 'requirement':
        return PMColors.EVIDENCE;
      case 'action':
        return PMColors.SUCCESS;
      case 'memory':
      default:
        return PMColors.BRAND;
    }
  }

  build() {
    Row() {
      // 左侧图标容器
      Row() {
        if (this.iconType === 'risk') {
          AlertIcon({ iconSize: 14, color: PMColors.RISK })
        } else if (this.iconType === 'calendar') {
          ClockIcon({ iconSize: 14 })
        } else if (this.iconType === 'requirement') {
          BookOpenIcon({ iconSize: 14 })
        } else {
          SpineNodeIcon({ iconSize: 14 })
        }
      }
      .width(28)
      .height(28)
      .justifyContent(FlexAlign.Center)
      .alignItems(VerticalAlign.Center)
      .borderRadius(PMRadius.SM)
      .backgroundColor(this.getIconBg())
      .margin({ right: PMSpacing.MD })

      // 中间事实文本
      Column() {
        if (this.timeText !== '') {
          Row() {
            Text(this.timeText)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .margin({ bottom: 2 })
        }
        Text(this.title)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_PRIMARY)
          .fontWeight(FontWeight.Regular)
          .lineHeight(18)
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      // 右侧来源 Badge (若有)
      if (this.sourceLabel !== '') {
        Text(this.sourceLabel)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.getIconColor())
          .backgroundColor(this.getIconBg())
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .borderRadius(PMRadius.XS)
          .margin({ left: PMSpacing.SM })
          .maxLines(1)
      }
    }
    .width('100%')
    .padding(PMSpacing.MD)
    .backgroundColor(PMColors.SURFACE_SUBTLE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .clickEffect(this.onClickItem !== undefined ? PMInteraction.PRESS_EFFECT : undefined)
    .onClick(() => {
      if (this.onClickItem !== undefined) {
        this.onClickItem();
      }
    })
  }
}
