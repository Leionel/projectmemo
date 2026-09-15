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

  static readonly WARNING: ResourceColor = $r('app.color.pm_warning');
  static readonly WARNING_LIGHT: ResourceColor = $r('app.color.pm_warning_light');

  static readonly SUCCESS: ResourceColor = $r('app.color.pm_success');
  static readonly SUCCESS_LIGHT: ResourceColor = $r('app.color.pm_success_light');

  // AI 辅助色彩（问忆程/智能体少量重点标记）
  static readonly AI_ACCENT: ResourceColor = $r('app.color.pm_ai_accent');
  static readonly AI_ACCENT_LIGHT: ResourceColor = $r('app.color.pm_ai_accent_light');

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
  static readonly SECTION: number = 28;
}

export class PMRadius {
  static readonly XS: number = 4;
  static readonly SM: number = 8;
  static readonly MD: number = 12;
  static readonly LG: number = 16;
  static readonly XL: number = 18;
  static readonly XXL: number = 24;
  static readonly FULL: number = 999;
}

export class PMFontSize {
  static readonly CAPTION: number = 12;
  static readonly BOTTOM_NAV: number = 12;
  static readonly SECONDARY: number = 13;
  static readonly BODY: number = 15;
  static readonly BUTTON: number = 15;
  static readonly MD: number = 15;
  static readonly SECTION_TITLE: number = 16;
  static readonly LG: number = 17;
  static readonly PRIMARY_JUDGEMENT: number = 18;
  static readonly PAGE_TITLE: number = 20;
  static readonly TITLE: number = 22;
  static readonly BRAND: number = 24;
  static readonly DISPLAY: number = 26;
  static readonly CRITICAL_METRIC: number = 30;
}

export class PMCardStyle {
  static readonly BORDER_WIDTH: number = 1;
  static readonly RADIUS: number = PMRadius.LG;
  static readonly PADDING: number = PMSpacing.LG;
  static readonly SHADOW_RADIUS: number = 8;
  static readonly SHADOW_COLOR: string = 'rgba(19, 36, 58, 0.04)';
  static readonly SHADOW_OFFSET_Y: number = 2;
}

export class PMButtonSize {
  static readonly HEIGHT_LG: number = 48; // 主要交互按钮
  static readonly HEIGHT_MD: number = 40; // 次级/卡片操作按钮
  static readonly HEIGHT_SM: number = 32; // 标签/紧凑按钮
  static readonly RADIUS: number = PMRadius.SM;
}

/**
 * 动效时长取自 OpenHarmony 公开参考区间（局部约 200ms、短距离约 250ms 内、
 * 全屏约 350ms 内）。这里只保留页面真正用到的两档，其余按需再加。
 */
export class PMMotion {
  static readonly COLOR: number = 100;
  static readonly LOCAL: number = 200;
  // 内容进出用 Sharp（减速收住），保持方向感。
  static readonly CURVE_CONTENT: Curve = Curve.Sharp;
}

/**
 * 页面切换只淡入、不淡出。
 * 离场若也带 transition，ArkUI 会在动画期间继续保留旧节点；
 * 而各 Tab 页面都是 Column 里争抢 layoutWeight(1) 的兄弟，
 * 结果是新页面要在 200ms 里和旧页面平分高度，看起来像被压扁一下。
 */
export class PMTransition {
  static readonly CONTENT_ENTER: TransitionEffect = TransitionEffect.asymmetric(
    TransitionEffect.OPACITY.animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }),
    TransitionEffect.IDENTITY
  );
}

export class PMInteraction {
  static readonly PRESS_EFFECT: ClickEffect = { level: ClickEffectLevel.LIGHT, scale: 0.95 };
}

/**
 * 只给覆盖层（弹层遮罩）用材质，内容卡片保持实心纸面。
 *
 * 本项目 SDK 为 6.1.1(24)：BlurStyle 最高只有 COMPONENT_ULTRA_THICK，
 * 没有 HarmonyOS 7 的 systemMaterial / IMMERSIVE_*。
 * 该版本的自适应材质（systemMaterialEffect）只在 HdsTabsFloatingStyle
 * 与 TitleBarStyleOptions 上开放，因此顶栏/底栏要真正的玻璃材质，
 * 需要把手绘导航换成 HdsTabs / HdsNavigation，而不是给普通 Row 叠 blur——
 * 现有导航在布局流里，背后没有滚动内容，blur 只会糊到一片纯色背景上，看不出来。
 */
export class PMMaterial {
  static readonly SCRIM: BlurStyle = BlurStyle.COMPONENT_ULTRA_THICK;
  static readonly OPTIONS: BackgroundBlurStyleOptions = {
    colorMode: ThemeColorMode.SYSTEM,
    adaptiveColor: AdaptiveColor.AVERAGE
  };
}
