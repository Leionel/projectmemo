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
  // 基础背景与表面
  static readonly BACKGROUND: string = '#F3F6F8';
  static readonly BACKGROUND_DARK: string = '#0E151E';

  static readonly SURFACE: string = '#FFFFFF';
  static readonly SURFACE_DARK: string = '#17212C';

  static readonly SURFACE_SUBTLE: string = '#F8FAFC';
  static readonly SURFACE_SUBTLE_DARK: string = '#121B24';

  static readonly SURFACE_ELEVATED: string = '#FFFFFF';

  // 墨色文字体系 (Ink Hierarchy)
  static readonly INK_PRIMARY: string = '#13243A';
  static readonly INK_PRIMARY_DARK: string = '#EAF0F4';

  static readonly INK_SECONDARY: string = '#485E75';
  static readonly INK_SECONDARY_DARK: string = '#8C9DAE';

  static readonly INK_TERTIARY: string = '#7C8F9F';
  static readonly INK_TERTIARY_DARK: string = '#5D7082';

  static readonly INK_MUTED: string = '#A1B1C2';

  // 语义领域色彩 (Domain Semantics)
  // 1. Memory / 知识沉淀、已完成、行动回写 (深青绿)
  static readonly MEMORY: string = '#2D6F6D';
  static readonly MEMORY_LIGHT: string = '#EAF3F2';
  static readonly MEMORY_DARK: string = '#64AAA6';

  // 2. Evidence / 提醒依据、时间脉络、证据节点 (琥珀金)
  static readonly EVIDENCE: string = '#A87528';
  static readonly EVIDENCE_LIGHT: string = '#FBF5EB';
  static readonly EVIDENCE_DARK: string = '#D8AD63';

  // 3. Risk / 截止风险、阻断与警示 (深绯红)
  static readonly RISK: string = '#C44738';
  static readonly RISK_LIGHT: string = '#FDF2F0';
  static readonly RISK_DARK: string = '#EF786B';

  // 4. Success / 阶段完成与复盘解决 (墨青绿)
  static readonly SUCCESS: string = '#2D6F6D';
  static readonly SUCCESS_LIGHT: string = '#EDF7F3';
  static readonly SUCCESS_DARK: string = '#5BB794';

  // 5. Brand / 交互行动主色、当前选中国态 (沉静深蓝)
  static readonly BRAND: string = '#1E56A0';
  static readonly BRAND_LIGHT: string = '#EFF5FC';
  static readonly BRAND_PRESSED: string = '#163E75';

  // 边框与分割线
  static readonly BORDER: string = '#E2E8F0';
  static readonly BORDER_SUBTLE: string = '#EDF2F7';
  static readonly BORDER_STRONG: string = '#CBD5E1';
  static readonly DIVIDER: string = '#EAEEF3';
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
