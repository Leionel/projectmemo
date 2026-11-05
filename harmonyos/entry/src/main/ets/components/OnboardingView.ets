import { PMColors, PMFontFamily, PMFontSize, PMRadius, PMSpacing, PMButtonSize } from '../common/DesignTokens';
import { TemporalBadge } from './MetricBadge';

interface OnboardingPage {
  title: string;
  body: string;
}

const PAGES: OnboardingPage[] = [
  { title: '随手记，忆程来整理', body: '会议、截图、PDF 丢进来，变成带来源的项目记忆。' },
  { title: '记忆会变，忆程分得清', body: '哪条仍然有效、哪条已被替代，一眼看清。' },
  { title: '隔几天回来，直接接上', body: '告诉你下一步做什么，做完留下复盘。' }
];

/**
 * 首次使用引导：只在本机第一次打开且未登录时出现，结束后进入登录。
 * 插画用产品里真实的卡片和状态标签拼成，让画面本身说明能力。
 */
@Component
export struct OnboardingView {
  onDone: () => void = () => {};
  @State private index: number = 0;
  private swiper: SwiperController = new SwiperController();

  @Builder
  SourceChip(label: string, color: ResourceColor, tint: ResourceColor) {
    Row({ space: PMSpacing.SM }) {
      Row().width(8).height(8).borderRadius(4).backgroundColor(color)
      Text(label).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_PRIMARY)
    }
    .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: PMSpacing.SM, bottom: PMSpacing.SM })
    .borderRadius(PMRadius.FULL)
    .backgroundColor(tint)
  }

  @Builder
  CaptureScene() {
    Column({ space: PMSpacing.MD }) {
      Row({ space: PMSpacing.SM }) {
        this.SourceChip('会议纪要', PMColors.MEMORY, PMColors.MEMORY_LIGHT)
        this.SourceChip('截图', PMColors.EVIDENCE, PMColors.EVIDENCE_LIGHT)
        this.SourceChip('PDF', PMColors.WARNING, PMColors.WARNING_LIGHT)
      }
      Text('↓').fontSize(18).fontColor(PMColors.INK_MUTED)
      Column({ space: 6 }) {
        Text('项目记忆').fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND).fontWeight(FontWeight.Medium)
        Text('答辩前需补齐实验对照组数据').fontSize(PMFontSize.BODY).fontColor(PMColors.INK_PRIMARY).fontWeight(FontWeight.Medium)
        Text('来源 3 · 11/03 组会').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding(PMSpacing.LG)
      .borderRadius(PMRadius.CARD)
      .backgroundColor(PMColors.SURFACE)
      .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    }
  }

  @Builder
  MemoryRow(text: string, date: string, status: string, dimmed: boolean) {
    Row({ space: PMSpacing.MD }) {
      Column({ space: 4 }) {
        Text(text).fontSize(PMFontSize.BODY).fontColor(dimmed ? PMColors.INK_TERTIARY : PMColors.INK_PRIMARY)
          .fontWeight(FontWeight.Medium)
          .decoration({ type: dimmed ? TextDecorationType.LineThrough : TextDecorationType.None, color: PMColors.INK_MUTED })
        Text(date).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      TemporalBadge({ status })
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .borderRadius(PMRadius.CARD)
    .backgroundColor(PMColors.SURFACE)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .opacity(dimmed ? 0.8 : 1)
  }

  @Builder
  ValidityScene() {
    Column({ space: PMSpacing.MD }) {
      this.MemoryRow('答辩改到 11 月 12 日', '11/04 记录', 'CURRENT', false)
      this.MemoryRow('答辩在 11 月 5 日', '10/20 记录', 'SUPERSEDED', true)
    }
  }

  @Builder
  ContinueScene() {
    Column({ space: PMSpacing.MD }) {
      Column({ space: 6 }) {
        Text('当前下一步').fontSize(PMFontSize.CAPTION).fontColor(PMColors.WARNING).fontWeight(FontWeight.Medium)
        Text('核对实验条件后确认汇报').fontSize(PMFontSize.LG).fontFamily(PMFontFamily.BRAND_SERIF)
          .fontColor(PMColors.INK_PRIMARY)
        Row() {
          Text('开始').fontSize(PMFontSize.SECONDARY).fontColor(Color.White).fontWeight(FontWeight.Medium)
        }
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: 6, bottom: 6 })
        .borderRadius(PMRadius.BUTTON)
        .backgroundColor(PMColors.BRAND)
        .margin({ top: PMSpacing.XS })
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding(PMSpacing.LG)
      .borderRadius(PMRadius.CARD)
      .backgroundColor(PMColors.SURFACE)
      .border({ width: 1, color: PMColors.BORDER_SUBTLE })

      Row({ space: PMSpacing.SM }) {
        Text('✓').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.SUCCESS)
        Text('上周完成 · 复盘已留存').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
      }
      .width('100%')
      .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.MD })
      .borderRadius(PMRadius.ITEM)
      .backgroundColor(PMColors.SUCCESS_LIGHT)
    }
  }

  @Builder
  Page(i: number) {
    Column() {
      Column() {
        if (i === 0) {
          this.CaptureScene()
        } else if (i === 1) {
          this.ValidityScene()
        } else {
          this.ContinueScene()
        }
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .accessibilityLevel('no-hide-descendants')

      Column({ space: PMSpacing.MD }) {
        Text(PAGES[i].title)
          .fontSize(PMFontSize.PAGE_TITLE)
          .fontFamily(PMFontFamily.BRAND_SERIF)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
        Text(PAGES[i].body)
          .fontSize(PMFontSize.BODY)
          .lineHeight(24)
          .fontColor(PMColors.INK_SECONDARY)
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding({ bottom: PMSpacing.XXL })
    }
    .width('100%')
    .height('100%')
    .padding({ left: PMSpacing.XXL, right: PMSpacing.XXL })
  }

  private next(): void {
    if (this.index >= PAGES.length - 1) {
      this.onDone();
    } else {
      this.swiper.showNext();
    }
  }

  build() {
    Column() {
      Row() {
        Blank()
        if (this.index < PAGES.length - 1) {
          Button('跳过', { type: ButtonType.Normal })
            .height(PMButtonSize.HEIGHT_SM)
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_TERTIARY)
            .backgroundColor(Color.Transparent)
            .onClick(() => { this.onDone(); })
        }
      }
      .width('100%')
      .height(56)
      .padding({ left: PMSpacing.LG, right: PMSpacing.SM })

      Swiper(this.swiper) {
        ForEach([0, 1, 2], (i: number) => {
          this.Page(i)
        }, (i: number) => i.toString())
      }
      .index(this.index)
      .loop(false)
      .indicator(false)
      .layoutWeight(1)
      .onChange((i: number) => { this.index = i; })

      Column({ space: PMSpacing.XL }) {
        Row({ space: 6 }) {
          ForEach([0, 1, 2], (i: number) => {
            Row()
              .height(6)
              .width(i === this.index ? 18 : 6)
              .borderRadius(3)
              .backgroundColor(i === this.index ? PMColors.BRAND : PMColors.BORDER_STRONG)
              .animation({ duration: 200, curve: Curve.EaseOut })
          }, (i: number) => i.toString())
        }
        .accessibilityText(`第 ${this.index + 1} 页，共 ${PAGES.length} 页`)

        Button(this.index < PAGES.length - 1 ? '下一步' : '开始使用', { type: ButtonType.Normal })
          .width('100%')
          .height(PMButtonSize.HEIGHT_LG)
          .borderRadius(PMRadius.BUTTON)
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Medium)
          .fontColor(Color.White)
          .backgroundColor(PMColors.BRAND)
          .onClick(() => { this.next(); })
      }
      .width('100%')
      .padding({ left: PMSpacing.XXL, right: PMSpacing.XXL, bottom: 40 })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}
