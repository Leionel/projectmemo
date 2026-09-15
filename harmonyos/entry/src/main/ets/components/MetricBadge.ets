import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { TextFormatters } from '../common/TextFormatters';

@Component
export struct SeverityBadge {
  @Prop severity: number = 1;
  @Prop level: string = ''; // 可选传入 'HIGH' | 'MEDIUM' | 'LOW'

  private getLabel(): string {
    if (this.level !== '') {
      switch (this.level.toUpperCase()) {
        case 'HIGH':
          return '高风险';
        case 'MEDIUM':
          return '中优先级';
        case 'LOW':
        default:
          return '低优先级';
      }
    }
    if (this.severity >= 3) {
      return '高风险';
    }
    if (this.severity === 2) {
      return '中优先级';
    }
    return '低优先级';
  }

  private getBgColor(): ResourceColor {
    const isHigh = this.level.toUpperCase() === 'HIGH' || this.severity >= 3;
    const isMed = this.level.toUpperCase() === 'MEDIUM' || this.severity === 2;
    if (isHigh) {
      return PMColors.RISK_LIGHT;
    }
    if (isMed) {
      return PMColors.WARNING_LIGHT;
    }
    return PMColors.SURFACE_SUBTLE;
  }

  private getTextColor(): ResourceColor {
    const isHigh = this.level.toUpperCase() === 'HIGH' || this.severity >= 3;
    const isMed = this.level.toUpperCase() === 'MEDIUM' || this.severity === 2;
    if (isHigh) {
      return PMColors.RISK;
    }
    if (isMed) {
      return PMColors.WARNING;
    }
    return PMColors.INK_SECONDARY;
  }

  build() {
    Row() {
      Circle({ width: 6, height: 6 })
        .fill(this.getTextColor())
        .margin({ right: PMSpacing.XS })
      Text(this.getLabel())
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.getTextColor())
        .maxLines(1)
    }
    .height(24)
    .padding({ left: 8, right: 8 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(PMRadius.SM)
    .backgroundColor(this.getBgColor())
  }
}

/**
 * 统一 Priority / Risk Badge 别名组件
 */
@Component
export struct RiskBadge {
  @Prop level: string = 'HIGH';

  build() {
    SeverityBadge({ level: this.level })
  }
}

@Component
export struct MemoryTypeBadge {
  @Prop type: string = '';

  private getLabel(): string {
    return TextFormatters.memoryTypeToChinese(this.type);
  }

  private getBgColor(): ResourceColor {
    switch (this.type) {
      case 'reflection':
        return PMColors.SUCCESS_LIGHT;
      case 'risk':
      case 'risk_alert':
        return PMColors.RISK_LIGHT;
      case 'paper_note':
      case 'experiment_log':
        return PMColors.MEMORY_LIGHT;
      case 'requirement':
      case 'material_requirement':
        return PMColors.EVIDENCE_LIGHT;
      default:
        return PMColors.SURFACE_SUBTLE;
    }
  }

  private getTextColor(): ResourceColor {
    switch (this.type) {
      case 'reflection':
        return PMColors.SUCCESS;
      case 'risk':
      case 'risk_alert':
        return PMColors.RISK;
      case 'paper_note':
      case 'experiment_log':
        return PMColors.MEMORY;
      case 'requirement':
      case 'material_requirement':
        return PMColors.EVIDENCE;
      default:
        return PMColors.INK_SECONDARY;
    }
  }

  build() {
    Row() {
      Text(this.getLabel())
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.getTextColor())
        .maxLines(1)
    }
    .height(24)
    .padding({ left: 8, right: 8 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(PMRadius.SM)
    .backgroundColor(this.getBgColor())
  }
}

@Component
export struct StatusBadge {
  @Prop status: string = '';

  private getLabel(): string {
    return TextFormatters.statusToChinese(this.status);
  }

  private getBgColor(): ResourceColor {
    switch (this.status) {
      case 'OPEN':
      case 'DOING':
        return PMColors.BRAND_LIGHT;
      case 'ACCEPTED':
      case 'DONE':
      case 'RESOLVED':
        return PMColors.SUCCESS_LIGHT;
      case 'DISMISSED':
        return PMColors.SURFACE_SUBTLE;
      case 'SNOOZED':
        return PMColors.EVIDENCE_LIGHT;
      default:
        return PMColors.SURFACE_SUBTLE;
    }
  }

  private getTextColor(): ResourceColor {
    switch (this.status) {
      case 'OPEN':
      case 'DOING':
        return PMColors.BRAND;
      case 'ACCEPTED':
      case 'DONE':
      case 'RESOLVED':
        return PMColors.SUCCESS;
      case 'DISMISSED':
        return PMColors.INK_TERTIARY;
      case 'SNOOZED':
        return PMColors.EVIDENCE;
      default:
        return PMColors.INK_SECONDARY;
    }
  }

  build() {
    Row() {
      Text(this.getLabel())
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.getTextColor())
        .maxLines(1)
    }
    .height(24)
    .padding({ left: 8, right: 8 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(PMRadius.SM)
    .backgroundColor(this.getBgColor())
  }
}

/**
 * 项目分类 Badge（中性蓝灰体系，克制沉稳）
 */
@Component
export struct CategoryBadge {
  @Prop category: string = '';

  private getLabel(): string {
    switch (this.category) {
      case 'COMPETITION':
        return '竞赛备赛';
      case 'COURSE_DESIGN':
        return '课程设计';
      case 'RESEARCH':
        return '学术研究';
      case 'ACADEMIC':
        return '学术备赛';
      default:
        return this.category !== '' ? this.category : '项目';
    }
  }

  build() {
    Row() {
      Text(this.getLabel())
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.BRAND)
        .maxLines(1)
    }
    .height(24)
    .padding({ left: 8, right: 8 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(PMRadius.SM)
    .backgroundColor(PMColors.BRAND_LIGHT)
  }
}

/**
 * 证据与时态生命周期 Badge (CURRENT, SUPERSEDED, CONTESTED, INSUFFICIENT, UNKNOWN 等)
 */
@Component
export struct TemporalBadge {
  @Prop status: string = 'CURRENT';

  private getLabel(): string {
    switch (this.status) {
      case 'CURRENT':
        return '当前有效';
      case 'SUPERSEDED':
        return '已被替代';
      case 'CONTESTED':
        return '存在争议';
      case 'INSUFFICIENT':
        return '证据不足';
      case 'SUPPORTED':
        return '充分佐证';
      case 'UNKNOWN':
      default:
        return '暂未确定';
    }
  }

  private getBgColor(): ResourceColor {
    switch (this.status) {
      case 'CURRENT':
      case 'SUPPORTED':
        return PMColors.SUCCESS_LIGHT;
      case 'SUPERSEDED':
        return PMColors.SURFACE_SUBTLE;
      case 'CONTESTED':
        return PMColors.RISK_LIGHT;
      case 'INSUFFICIENT':
        return PMColors.WARNING_LIGHT;
      case 'UNKNOWN':
      default:
        return PMColors.SURFACE_SUBTLE;
    }
  }

  private getTextColor(): ResourceColor {
    switch (this.status) {
      case 'CURRENT':
      case 'SUPPORTED':
        return PMColors.SUCCESS;
      case 'SUPERSEDED':
        return PMColors.INK_TERTIARY;
      case 'CONTESTED':
        return PMColors.RISK;
      case 'INSUFFICIENT':
        return PMColors.WARNING;
      case 'UNKNOWN':
      default:
        return PMColors.INK_SECONDARY;
    }
  }

  build() {
    Row() {
      if (this.status === 'CURRENT' || this.status === 'SUPPORTED') {
        Circle({ width: 5, height: 5 })
          .fill(this.getTextColor())
          .margin({ right: PMSpacing.XS })
      }
      Text(this.getLabel())
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.getTextColor())
        .maxLines(1)
    }
    .height(24)
    .padding({ left: 8, right: 8 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(PMRadius.SM)
    .backgroundColor(this.getBgColor())
  }
}
