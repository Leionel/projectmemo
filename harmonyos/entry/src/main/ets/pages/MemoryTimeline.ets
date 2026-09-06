import router from '@ohos.router';
import { ApiError } from '../models/Project';
import { KnowledgeCard, CardLink, IncomingCardLink, TemporalDecisionItem, TemporalRelation } from '../models/Memory';
import { MemoryService } from '../services/MemoryService';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction, PMMotion } from '../common/DesignTokens';
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
  @State decisions: TemporalDecisionItem[] = [];
  @State temporalEnabled: boolean = true;
  @State relationActionId: string = '';

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
      const cards = await this.memoryService.getTimeline(this.projectId);
      const timeline = await this.memoryService.getDecisionTimeline(this.projectId);
      this.cards = cards;
      this.decisions = timeline.items;
      this.temporalEnabled = timeline.enabled;
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

  private statusColor(status: string): ResourceColor {
    if (status === 'CURRENT') return PMColors.SUCCESS;
    if (status === 'CONFLICT') return PMColors.RISK;
    if (status === 'PENDING') return PMColors.EVIDENCE;
    if (status === 'SUPERSEDED' || status === 'REVOKED') return PMColors.INK_TERTIARY;
    return PMColors.INK_SECONDARY;
  }

  private actionableRelation(item: TemporalDecisionItem): TemporalRelation | undefined {
    for (let index = 0; index < item.relations.length; index += 1) {
      const relation = item.relations[index];
      if (relation.relationType !== 'RELATED') return relation;
    }
    return undefined;
  }

  private meaningfulDecisions(): TemporalDecisionItem[] {
    const result: TemporalDecisionItem[] = [];
    for (let index = 0; index < this.decisions.length; index += 1) {
      if (this.decisions[index].status !== 'INSUFFICIENT') result.push(this.decisions[index]);
    }
    return result;
  }

  private insufficientDecisionCount(): number {
    return this.decisions.length - this.meaningfulDecisions().length;
  }

  private async confirmRelation(relationId: string): Promise<void> {
    this.relationActionId = relationId;
    try {
      await this.memoryService.confirmTemporalRelation(this.projectId, relationId);
      await this.loadTimeline();
    } catch (e) {
      this.errorMessage = e instanceof ApiError ? e.message : '确认关系失败，请稍后重试';
    } finally {
      this.relationActionId = '';
    }
  }

  private async revokeRelation(relationId: string): Promise<void> {
    this.relationActionId = relationId;
    try {
      await this.memoryService.revokeTemporalRelation(this.projectId, relationId);
      await this.loadTimeline();
    } catch (e) {
      this.errorMessage = e instanceof ApiError ? e.message : '撤销关系失败，请稍后重试';
    } finally {
      this.relationActionId = '';
    }
  }

  @Builder
  private decisionItem(item: TemporalDecisionItem) {
    Column() {
      Row() {
        Text(item.statusLabel)
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.statusColor(item.status))
          .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: PMSpacing.XS, bottom: PMSpacing.XS })
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.FULL)

        Text(this.formatDate(item.card.createdAt))
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)

      Text(item.card.title)
        .fontSize(PMFontSize.SECTION_TITLE)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ top: PMSpacing.SM })

      if (item.supersededBy !== null) {
        Text(`由「${item.supersededBy.title}」取代`)
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_SECONDARY)
          .margin({ top: PMSpacing.XS })
      }

      if (item.temporalReason !== null && item.temporalReason !== '') {
        Text(item.temporalReason)
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(20)
          .margin({ top: PMSpacing.XS })
      } else {
        Text('尚无经过确认的关系证据，当前结论不能自动升级。')
          .fontSize(PMFontSize.BODY)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: PMSpacing.XS })
      }

      if (this.actionableRelation(item) !== undefined) {
        Row({ space: PMSpacing.SM }) {
          if (!this.actionableRelation(item)!.confirmed && this.actionableRelation(item)!.revokedAt === null) {
            Button(this.relationActionId === this.actionableRelation(item)!.id ? '确认中…' : '确认关系')
              .height(44)
              .fontSize(PMFontSize.BUTTON)
              .enabled(this.relationActionId === '')
              .onClick(() => {
                this.confirmRelation(this.actionableRelation(item)!.id);
              })
          }
          if (this.actionableRelation(item)!.confirmed && this.actionableRelation(item)!.revokedAt === null) {
            Button(this.relationActionId === this.actionableRelation(item)!.id ? '撤销中…' : '撤销关系')
              .height(44)
              .fontSize(PMFontSize.BUTTON)
              .type(ButtonType.Normal)
              .enabled(this.relationActionId === '')
              .onClick(() => {
                this.revokeRelation(this.actionableRelation(item)!.id);
              })
          }
        }
        .width('100%')
        .margin({ top: PMSpacing.SM })
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: this.statusColor(item.status) })
    .alignItems(HorizontalAlign.Start)
    .accessibilityText(`${item.statusLabel}，${item.card.title}${item.temporalReason !== null ? `，${item.temporalReason}` : ''}`)
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
      .clickEffect(PMInteraction.PRESS_EFFECT)
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
        .transition(TransitionEffect.OPACITY.animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
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
          ListItem() {
            Column() {
              Text('决策演化')
                .fontSize(PMFontSize.PAGE_TITLE)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_PRIMARY)
              Text(this.temporalEnabled ? '确认、取代和撤销都会保留证据链；未确认关系不会改变当前事实。' : '时态证据账本已关闭，当前仅展示原始记忆。')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_SECONDARY)
                .lineHeight(20)
                .margin({ top: PMSpacing.XS, bottom: PMSpacing.MD })
              if (this.temporalEnabled) {
                if (this.meaningfulDecisions().length === 0) {
                  Column() {
                    Text('证据不足')
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_SECONDARY)
                    Text('尚未建立决策关系。普通记忆仍安全保留，不会被自动判定为当前事实。')
                      .fontSize(PMFontSize.BODY)
                      .fontColor(PMColors.INK_SECONDARY)
                      .lineHeight(20)
                      .margin({ top: PMSpacing.XS })
                  }
                  .width('100%')
                  .padding(PMSpacing.LG)
                  .backgroundColor(PMColors.SURFACE)
                  .borderRadius(PMRadius.MD)
                  .border({ width: 1, color: PMColors.BORDER })
                  .alignItems(HorizontalAlign.Start)
                } else {
                  ForEach(this.meaningfulDecisions(), (item: TemporalDecisionItem) => {
                    this.decisionItem(item)
                    Blank().height(PMSpacing.SM)
                  }, (item: TemporalDecisionItem) => item.card.id)
                }
                if (this.insufficientDecisionCount() > 0) {
                  Text(`${this.insufficientDecisionCount()} 条普通记忆尚无决策关系，已归入“证据不足”，可在下方继续查看。`)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .lineHeight(18)
                    .margin({ top: PMSpacing.XS })
                }
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }

          ListItem() {
            Text('全部记忆')
              .width('100%')
              .fontSize(PMFontSize.PAGE_TITLE)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_PRIMARY)
              .padding({ top: PMSpacing.SM })
          }

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
