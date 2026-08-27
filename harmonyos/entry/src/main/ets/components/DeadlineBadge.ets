import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { DeadlineState } from '../models/Project';
import { ClockIcon } from './PMIcons';

/**
 * 截止状态徽标：只有临近/逾期使用风险色，未设置截止日保持中性。
 */
@Component
export struct DeadlineBadge {
  @Prop deadline: DeadlineState = new DeadlineState();

  private badgeTextColor(): ResourceColor {
    if (this.deadline.kind === 'urgent' || this.deadline.kind === 'overdue') {
      return PMColors.RISK;
    }
    if (this.deadline.kind === 'upcoming') {
      return PMColors.EVIDENCE;
    }
    return PMColors.INK_TERTIARY;
  }

  private badgeBackgroundColor(): ResourceColor {
    if (this.deadline.kind === 'urgent' || this.deadline.kind === 'overdue') {
      return PMColors.RISK_LIGHT;
    }
    if (this.deadline.kind === 'upcoming') {
      return PMColors.EVIDENCE_LIGHT;
    }
    return PMColors.SURFACE_SUBTLE;
  }

  private badgeBorderColor(): ResourceColor {
    if (this.deadline.kind === 'urgent' || this.deadline.kind === 'overdue') {
      return PMColors.RISK_BORDER;
    }
    if (this.deadline.kind === 'upcoming') {
      return PMColors.EVIDENCE_BORDER;
    }
    return PMColors.BORDER;
  }

  build() {
    if (this.deadline.label !== '') {
      Row() {
        ClockIcon({ iconSize: 12, color: this.badgeTextColor() })
        Text(this.deadline.label)
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.badgeTextColor())
          .margin({ left: 4 })
      }
      .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 2, bottom: 2 })
      .borderRadius(PMRadius.XS)
      .backgroundColor(this.badgeBackgroundColor())
      .border({ width: 1, color: this.badgeBorderColor() })
      .accessibilityText(this.deadline.kind === 'none' ? '截止日期未设置' : `截止日期：${this.deadline.label}`)
    }
  }
}
