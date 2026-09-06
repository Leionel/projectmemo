import { display, window } from '@kit.ArkUI';

/**
 * 宽度断点。此前全站没有任何设备形态判断，平板和折叠屏展开时导航项与正文行长
 * 会随屏幕等比拉伸。断点阈值取 HarmonyOS 公开参考区间。
 * sm 与 md 区间不改变任何布局，只有 lg（约 840vp 以上）才启用宽度上限，
 * 因此手机上的表现与改动前完全一致。
 */
export class PMWidthBp {
  static readonly SM: string = 'sm';
  static readonly MD: string = 'md';
  static readonly LG: string = 'lg';
}

export class PMBreakpoint {
  static readonly MD_START: number = 600;
  static readonly LG_START: number = 840;
  // 导航条与正文在宽屏上的最大居中宽度（vp）。
  static readonly BAR_MAX: number = 600;
  static readonly CONTENT_MAX: number = 720;

  static of(widthVp: number): string {
    if (widthVp >= PMBreakpoint.LG_START) {
      return PMWidthBp.LG;
    }
    return widthVp >= PMBreakpoint.MD_START ? PMWidthBp.MD : PMWidthBp.SM;
  }

  static isWide(bp: string): boolean {
    return bp === PMWidthBp.LG;
  }

  static barMaxWidth(bp: string): number | undefined {
    return PMBreakpoint.isWide(bp) ? PMBreakpoint.BAR_MAX : undefined;
  }

  static contentMaxWidth(bp: string): number | undefined {
    return PMBreakpoint.isWide(bp) ? PMBreakpoint.CONTENT_MAX : undefined;
  }
}

export class PMStorageKey {
  static readonly WIDTH_BP: string = 'pmWidthBp';
}

export class PMWindowMetrics {
  private static tracked: window.Window | null = null;

  /**
   * 由 EntryAbility 在窗口装载后调用一次；重复调用不会重复注册监听。
   */
  static start(win: window.Window): void {
    if (PMWindowMetrics.tracked === win) {
      return;
    }
    PMWindowMetrics.tracked = win;
    PMWindowMetrics.publish(win);
    win.on('windowSizeChange', (): void => {
      PMWindowMetrics.publish(win);
    });
  }

  private static publish(win: window.Window): void {
    let bucket: string = PMWidthBp.SM;
    try {
      const density = display.getDefaultDisplaySync().densityPixels;
      bucket = PMBreakpoint.of(win.getWindowProperties().windowRect.width / density);
    } catch (err) {
      bucket = PMWidthBp.SM;
    }
    AppStorage.setOrCreate<string>(PMStorageKey.WIDTH_BP, bucket);
  }
}
