import router from '@ohos.router';
import { ApiError } from '../models/Project';
import { KnowledgeCard, CardLink, IncomingCardLink } from '../models/Memory';
import { MemoryService } from '../services/MemoryService';
import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { MemoryTypeBadge } from '../components/MetricBadge';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import { AlertIcon } from '../components/PMIcons';
import { TextFormatters } from '../common/TextFormatters';

@Entry
@Component
struct MemoryTimeline {
  @State projectId: string = '';
  @State cards: KnowledgeCard[] = [];
  @State isLoading: boolean = false;
  @State errorMessage: string = '';
  @State routeError: string = '';
  @State expandedCardId: string = '';

  private memoryService: MemoryService = new MemoryService();

  aboutToAppear(): void {
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    if (params === undefined || params === null) {
      this.routeError = '页面参数缺失，无法定位项目记忆';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    if (this.projectId === '') {
      this.routeError = '页面参数缺失，项目ID无效';
      return;
    }
    this.loadTimeline();
  }

  private async loadTimeline(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      this.cards = await this.memoryService.getTimeline(this.projectId);
    } catch (e) {
      if (e instanceof ApiError) {
        this.errorMessage = e.message;
      } else {
        this.errorMessage = '无法加载记忆时序，请检查网络';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private formatDate(createdAt: string): string {
    if (createdAt.length >= 10) {
      return createdAt.substring(0, 10);
    }
    return createdAt;
  }

  private toggleExpand(cardId: string): void {
    if (this.expandedCardId === cardId) {
      this.expandedCardId = '';
    } else {
      this.expandedCardId = cardId;
    }
  }

  private isDamagedMemoryCard(card: KnowledgeCard): boolean {
    const rawText = card.capture !== undefined && card.capture !== null ? card.capture.rawText : '';
    return TextFormatters.isDamagedMemory(card.title, card.summary, rawText);
  }

  @Builder
  private cardItem(card: KnowledgeCard) {
    Column() {
      if (this.isDamagedMemoryCard(card)) {
        Row() {
          Row() {
            AlertIcon({ iconSize: 14, color: PMColors.RISK })
            Text('需要修复')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.RISK)
              .margin({ left: PMSpacing.XS })
          }
          Text(this.formatDate(card.createdAt))
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .alignItems(VerticalAlign.Center)

        Text('这条历史记忆无法完整读取，原内容未被替换。')
          .fontSize(PMFontSize.BODY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .lineHeight(20)
          .margin({ top: PMSpacing.SM })

        Text('请展开查看原始采集碎片并重新录入。')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(18)
          .margin({ top: PMSpacing.XS })
      } else {
        // 头部：类型徽标与日期
        Row() {
          MemoryTypeBadge({ type: card.type })
          Text(this.formatDate(card.createdAt))
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .alignItems(VerticalAlign.Center)

        // 标题
        Text(TextFormatters.readableText(card.title, '记忆标题无法读取，请重新录入。'))
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: PMSpacing.SM })

        // 摘要：标题与摘要相同时只保留一份，避免卡片重复
        if (TextFormatters.shouldShowSummary(card.title, card.summary)) {
          Text(TextFormatters.readableText(card.summary, '这条记忆摘要无法读取，请重新录入。'))
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(20)
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .margin({ top: PMSpacing.XS })
        }
      }

      if (card.attachment !== undefined && card.attachment !== null) {
        Row() {
          Text('附件证据')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.EVIDENCE)
          Text(`${card.attachment.fileName} · ${card.attachment.extractionStatus}`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ left: PMSpacing.XS })
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .width('100%')
        .margin({ top: PMSpacing.SM })
        .accessibilityText(`附件证据：${card.attachment.fileName}，提取状态${card.attachment.extractionStatus}`)
      }

      // 展开/收起原始记录按钮
      Row() {
        Text(this.expandedCardId === card.id ? '▲ 收起原始碎片' : '▼ 查看原始采集碎片')
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.BRAND)
      }
      .padding({ top: PMSpacing.SM, bottom: PMSpacing.XS })
      .accessibilityText(this.expandedCardId === card.id ? '收起原始采集碎片' : '查看原始采集碎片')
      .accessibilityDescription(this.isDamagedMemoryCard(card) ? '该记忆需要修复，原始采集碎片仍可查看' : '展开查看这条记忆的来源与原始内容')
      .onClick(() => {
        this.toggleExpand(card.id);
      })

      // 原始记录展开面板
      if (this.expandedCardId === card.id) {
        Column() {
          Text('原始记录')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_TERTIARY)

          if (card.capture !== undefined && card.capture !== null) {
            Text(TextFormatters.readableText(card.capture.rawText, '原始记录文本无法读取，请重新录入。'))
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.INK_PRIMARY)
              .lineHeight(20)
              .margin({ top: PMSpacing.XS })

            Row() {
              Text(`来源: ${card.capture.sourceType ?? '随手记录'}`)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
            }
            .margin({ top: PMSpacing.SM })
          } else {
            Text('该记忆卡片暂无原始采集记录')
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: PMSpacing.XS })
          }
        }
        .width('100%')
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
        .alignItems(HorizontalAlign.Start)
        .margin({ top: PMSpacing.XS })
      }

      // 关联记忆网络
      if (card.outgoingLinks.length > 0 || card.incomingLinks.length > 0) {
        Column() {
          Row() {
            Text('关联记忆网')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.MEMORY)
          }
          .margin({ top: PMSpacing.SM, bottom: PMSpacing.XS })

          ForEach(card.outgoingLinks, (link: CardLink, index: number) => {
            Row() {
              Text('→ ')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.MEMORY)
              Text(TextFormatters.readableText(link.relatedCard.title, '关联记忆标题无法读取'))
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }
            .width('100%')
            .padding({ top: 2, bottom: 2 })

            if (link.reason !== '') {
              Text(link.reason)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ left: PMSpacing.MD, bottom: PMSpacing.XS })
            }
          }, (link: CardLink, index: number) => `${card.id}-out-${index}`)

          ForEach(card.incomingLinks, (link: IncomingCardLink, index: number) => {
            Row() {
              Text('← ')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.EVIDENCE)
              Text(TextFormatters.readableText(link.currentCard.title, '关联记忆标题无法读取'))
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_PRIMARY)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }
            .width('100%')
            .padding({ top: 2, bottom: 2 })

            if (link.reason !== '') {
              Text(link.reason)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ left: PMSpacing.MD, bottom: PMSpacing.XS })
            }
          }, (link: IncomingCardLink, index: number) => `${card.id}-in-${index}`)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ top: PMSpacing.XS })
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER })
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Column() {
      PMAppBar({
        title: '记忆',
        subtitle: '',
        backLabel: '项目',
        showBack: true
      })

      if (this.routeError !== '') {
        ErrorStateView({
          message: this.routeError,
          onRetry: () => {
            router.back();
          }
        })
      } else if (this.isLoading) {
        LoadingStateView({ message: '加载记忆脉络...' })
      } else if (this.errorMessage !== '') {
        ErrorStateView({
          message: this.errorMessage,
          onRetry: () => {
            this.loadTimeline();
          }
        })
      } else if (this.cards.length === 0) {
        EmptyStateView({
          title: '暂无记忆档案',
          description: '项目尚未记录任何碎片，返回项目首页记录第一条知识',
          actionText: '返回工作台',
          onAction: () => {
            router.back();
          }
        })
      } else {
        List({ space: PMSpacing.MD }) {
          ForEach(this.cards, (card: KnowledgeCard) => {
            ListItem() {
              this.cardItem(card)
            }
          }, (card: KnowledgeCard) => card.id)
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}
