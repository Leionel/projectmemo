import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { TextFormatters } from '../common/TextFormatters';

@Component
export struct SeverityBadge {
  @Prop severity: number = 1;

  private getLabel(): string {
    if (this.severity >= 3) {
      return '高风险';
    }
    if (this.severity === 2) {
      return '中优先级';
    }
    return '低优先级';
  }

  private getBgColor(): ResourceColor {
    if (this.severity >= 3) {
      return PMColors.RISK_LIGHT;
    }
    if (this.severity === 2) {
      return PMColors.EVIDENCE_LIGHT;
    }
    return PMColors.SURFACE_SUBTLE;
  }

  private getTextColor(): ResourceColor {
    if (this.severity >= 3) {
      return PMColors.RISK;
    }
    if (this.severity === 2) {
      return PMColors.EVIDENCE;
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
    }
    .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 2, bottom: 2 })
    .borderRadius(PMRadius.XS)
    .backgroundColor(this.getBgColor())
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
    Text(this.getLabel())
      .fontSize(PMFontSize.CAPTION)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.getTextColor())
      .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 2, bottom: 2 })
      .borderRadius(PMRadius.XS)
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
    Text(this.getLabel())
      .fontSize(PMFontSize.CAPTION)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.getTextColor())
      .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 2, bottom: 2 })
      .borderRadius(PMRadius.XS)
      .backgroundColor(this.getBgColor())
  }
}
