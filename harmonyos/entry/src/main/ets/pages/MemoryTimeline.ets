import router from '@ohos.router';
import { ApiError } from '../models/Project';
import { KnowledgeCard, CardLink, IncomingCardLink } from '../models/Memory';
import { MemoryService } from '../services/MemoryService';
import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { MemoryTypeBadge } from '../components/MetricBadge';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';

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

  @Builder
  private cardItem(card: KnowledgeCard) {
    Column() {
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
      Text(card.title)
        .fontSize(PMFontSize.SECTION_TITLE)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ top: PMSpacing.SM })

      // 摘要
      if (card.summary !== '') {
        Text(card.summary)
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: PMSpacing.XS })
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
            Text(card.capture.rawText)
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
              Text(link.relatedCard.title)
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
              Text(link.currentCard.title)
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
          actionText: '返回驾驶舱',
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
