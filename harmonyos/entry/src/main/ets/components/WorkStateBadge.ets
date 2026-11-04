import { WorkState } from '../models/WorkState';
import { workTone, workStateLabel, stopRequestBadge } from '../common/WorkStateBadge';
import { PMColors } from '../common/DesignTokens';

function toneBackground(tone: string): ResourceColor {
  if (tone === 'user') return PMColors.WARNING_LIGHT;
  if (tone === 'agent' || tone === 'observing' || tone === 'done') return PMColors.BRAND_LIGHT;
  if (tone === 'failed') return PMColors.RISK_LIGHT;
  if (tone === 'system') return Color.Transparent;
  return PMColors.SURFACE_SUBTLE;
}

function toneForeground(tone: string): ResourceColor {
  if (tone === 'user') return PMColors.WARNING;
  if (tone === 'agent' || tone === 'observing' || tone === 'done') return PMColors.BRAND;
  if (tone === 'failed') return PMColors.RISK;
  return PMColors.INK_SECONDARY;
}

/** 委托阶段徽标 + 并列的停止请求徽标；颜色取自 PMColors，深色资源随系统切换。 */
@Component
export struct WorkStateBadges {
  @Prop state: WorkState;

  @Builder private Badge(label: string, tone: string) {
    Row({ space: 5 }) {
      if (tone === 'user' || tone === 'agent' || tone === 'paused' || tone === 'failed') {
        Circle().width(6).height(6).fill(tone === 'paused' ? PMColors.INK_TERTIARY : toneForeground(tone))
      } else if (tone === 'observing') {
        Circle().width(6).height(6).fillOpacity(0).stroke(toneForeground(tone)).strokeWidth(1.5)
      }
      Text(label).fontSize(12).fontWeight(FontWeight.Medium).fontColor(toneForeground(tone)).maxLines(1)
    }.height(24).padding({ left: 9, right: 9 }).borderRadius(999).backgroundColor(toneBackground(tone))
      .border(tone === 'system' ? { width: 1, color: PMColors.BORDER_STRONG, style: BorderStyle.Dashed } : { width: 0 })
  }

  build() {
    Row({ space: 6 }) {
      this.Badge(workStateLabel(this.state), workTone(this.state))
      if (stopRequestBadge(this.state) !== '') {
        this.Badge(stopRequestBadge(this.state), 'system')
      }
    }
  }
}
