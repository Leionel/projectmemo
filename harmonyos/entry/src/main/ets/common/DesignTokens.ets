/**
 * 忆程 ProjectMemo Design Tokens
 * 视觉风格：Evidence Ledger (证据档案与学术决策手账)
 * 规范：HarmonyOS 6.1.1 (API 24) ArkTS
 */

export class PMFontFamily {
  static readonly SANS: string = 'HarmonyOS Sans, Source Han Sans CN, sans-serif';
  static readonly SERIF: string = 'Noto Serif SC, Source Han Serif SC, serif';
  static readonly SERIF_BLACK: string = 'Noto Serif SC Black, Noto Serif SC, Source Han Serif SC, serif';
}

export class PMColors {
  // 所有颜色都来自语义资源。系统处于深色模式时，ArkUI 会自动解析 dark/element/color.json。
  static readonly BACKGROUND: ResourceColor = $r('app.color.pm_background');
  static readonly SURFACE: ResourceColor = $r('app.color.pm_surface');
  static readonly SURFACE_SUBTLE: ResourceColor = $r('app.color.pm_surface_subtle');
  static readonly SURFACE_ELEVATED: ResourceColor = $r('app.color.pm_surface_elevated');

  // 墨色文字体系 (Ink Hierarchy)
  static readonly INK_PRIMARY: ResourceColor = $r('app.color.pm_ink_primary');
  static readonly INK_SECONDARY: ResourceColor = $r('app.color.pm_ink_secondary');
  static readonly INK_TERTIARY: ResourceColor = $r('app.color.pm_ink_tertiary');
  static readonly INK_MUTED: ResourceColor = $r('app.color.pm_ink_muted');

  // 语义领域色彩 (Domain Semantics)
  static readonly MEMORY: ResourceColor = $r('app.color.pm_memory');
  static readonly MEMORY_LIGHT: ResourceColor = $r('app.color.pm_memory_light');

  static readonly EVIDENCE: ResourceColor = $r('app.color.pm_evidence');
  static readonly EVIDENCE_LIGHT: ResourceColor = $r('app.color.pm_evidence_light');
  static readonly EVIDENCE_BORDER: ResourceColor = $r('app.color.pm_evidence_border');
  static readonly EVIDENCE_TINT: ResourceColor = $r('app.color.pm_evidence_tint');

  static readonly RISK: ResourceColor = $r('app.color.pm_risk');
  static readonly RISK_LIGHT: ResourceColor = $r('app.color.pm_risk_light');
  static readonly RISK_BORDER: ResourceColor = $r('app.color.pm_risk_border');

  static readonly SUCCESS: ResourceColor = $r('app.color.pm_success');
  static readonly SUCCESS_LIGHT: ResourceColor = $r('app.color.pm_success_light');

  // 交互行动主色、当前选中国态 (沉静深蓝)
  static readonly BRAND: ResourceColor = $r('app.color.pm_brand');
  static readonly BRAND_LIGHT: ResourceColor = $r('app.color.pm_brand_light');
  static readonly BRAND_PRESSED: ResourceColor = $r('app.color.pm_brand_pressed');

  // 边框、分割线与弹层遮罩
  static readonly BORDER: ResourceColor = $r('app.color.pm_border');
  static readonly BORDER_SUBTLE: ResourceColor = $r('app.color.pm_border_subtle');
  static readonly BORDER_STRONG: ResourceColor = $r('app.color.pm_border_strong');
  static readonly DIVIDER: ResourceColor = $r('app.color.pm_divider');
  static readonly SCRIM: ResourceColor = $r('app.color.pm_scrim');
}

export class PMSpacing {
  static readonly XS: number = 4;
  static readonly SM: number = 8;
  static readonly MD: number = 12;
  static readonly LG: number = 16;
  static readonly XL: number = 20;
  static readonly XXL: number = 24;
  static readonly SECTION: number = 32;
}

export class PMRadius {
  static readonly XS: number = 4;
  static readonly SM: number = 8;
  static readonly MD: number = 12;
  static readonly LG: number = 16;
  static readonly FULL: number = 999;
}

export class PMFontSize {
  static readonly CAPTION: number = 12;
  static readonly BOTTOM_NAV: number = 12;
  static readonly SECONDARY: number = 13;
  static readonly SM: number = 12;
  static readonly BODY: number = 14;
  static readonly BASE: number = 14;
  static readonly BUTTON: number = 14;
  static readonly MD: number = 15;
  static readonly SECTION_TITLE: number = 16;
  static readonly LG: number = 17;
  static readonly PRIMARY_JUDGEMENT: number = 18;
  static readonly PAGE_TITLE: number = 20;
  static readonly XL: number = 20;
  static readonly BRAND: number = 26;
  static readonly TITLE: number = 22;
  static readonly DISPLAY: number = 28;
  static readonly CRITICAL_METRIC: number = 32;
}
