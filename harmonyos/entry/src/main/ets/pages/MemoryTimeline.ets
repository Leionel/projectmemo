import router from '@ohos.router';
import { ApiError } from '../models/Project';
import { KnowledgeCard, CardLink, IncomingCardLink } from '../models/Memory';
import { MemoryService } from '../services/MemoryService';

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
      this.routeError = '页面参数缺失';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    if (this.projectId === '') {
      this.routeError = '页面参数缺失';
      return;
    }
    this.loadTimeline();
  }

  private async loadTimeline(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      // 后端已按 createdAt desc 返回，客户端不重排
      this.cards = await this.memoryService.getTimeline(this.projectId);
    } catch (e) {
      if (e instanceof ApiError) {
        this.errorMessage = e.message;
      } else {
        this.errorMessage = '未知错误';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private typeLabel(type: string): string {
    switch (type) {
      case 'paper_note':
        return '论文笔记';
      case 'code_issue':
        return '代码问题';
      case 'experiment_log':
        return '实验记录';
      case 'meeting_note':
        return '会议纪要';
      case 'idea':
        return '灵感想法';
      case 'task':
        return '待办任务';
      case 'risk':
        return '项目风险';
      case 'requirement':
        return '材料要求';
      case 'reflection':
        return '阶段复盘';
      default:
        return type;
    }
  }

  private formatDate(createdAt: string): string {
    // createdAt 形如 2026-08-20T12:00:00.000Z，截取日期部分
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
      Row() {
        Text(this.typeLabel(card.type))
          .fontSize(12)
          .fontColor('#007DFF')
        Text(this.formatDate(card.createdAt))
          .fontSize(12)
          .fontColor('#999999')
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)

      Text(card.title)
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ top: 8 })

      if (card.summary !== '') {
        Text(card.summary)
          .fontSize(14)
          .fontColor('#666666')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: 4 })
      }

      Button(this.expandedCardId === card.id ? '收起原始记录' : '展开原始记录')
        .fontSize(12)
        .margin({ top: 8 })
        .onClick(() => {
          this.toggleExpand(card.id);
        })

      if (this.expandedCardId === card.id) {
        Column() {
          Text('原始记录')
            .fontSize(12)
            .fontColor('#999999')
          // Prisma 无关联时 capture 为 null，JSON 字段缺失时为 undefined，两者都判空
          if (card.capture !== undefined && card.capture !== null) {
            Text(card.capture.rawText)
              .fontSize(14)
              .fontColor('#666666')
              .margin({ top: 4 })
            Text(`来源：${card.capture.sourceType ?? '未知'}`)
              .fontSize(12)
              .fontColor('#999999')
              .margin({ top: 4 })
          } else {
            Text('无原始记录')
              .fontSize(14)
              .fontColor('#999999')
              .margin({ top: 4 })
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .margin({ top: 8 })
      }

      if (card.outgoingLinks.length > 0 || card.incomingLinks.length > 0) {
        Column() {
          Text('关联记忆')
            .fontSize(12)
            .fontColor('#999999')
          ForEach(card.outgoingLinks, (link: CardLink, index: number) => {
            Column() {
              Text(`关联 → ${link.relatedCard.title}`)
                .fontSize(14)
                .fontColor('#666666')
              if (link.reason !== '') {
                Text(link.reason)
                  .fontSize(12)
                  .fontColor('#999999')
                  .margin({ top: 2 })
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 4 })
          }, (link: CardLink, index: number) => `${card.id}-out-${index}`)

          ForEach(card.incomingLinks, (link: IncomingCardLink, index: number) => {
            Column() {
              Text(`被关联 ← ${link.currentCard.title}`)
                .fontSize(14)
                .fontColor('#666666')
              if (link.reason !== '') {
                Text(link.reason)
                  .fontSize(12)
                  .fontColor('#999999')
                  .margin({ top: 2 })
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 4 })
          }, (link: IncomingCardLink, index: number) => `${card.id}-in-${index}`)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .margin({ top: 8 })
      } else {
        Text('暂无关联记忆')
          .fontSize(12)
          .fontColor('#999999')
          .margin({ top: 8 })
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor('#FFFFFF')
    .borderRadius(12)
    .alignItems(HorizontalAlign.Start)
    .onClick(() => {
      this.toggleExpand(card.id);
    })
  }

  build() {
    Column() {
      Row() {
        Text('返回')
          .fontSize(16)
          .fontColor('#007DFF')
          .onClick(() => {
            router.back();
          })
        Text('项目记忆')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .margin({ left: 16 })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })

      if (this.routeError !== '') {
        Column() {
          Text(this.routeError)
            .fontSize(16)
            .fontColor('#E84026')
            .margin({ bottom: 16 })
          Button('返回')
            .fontSize(14)
            .onClick(() => {
              router.back();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.isLoading) {
        Column() {
          LoadingProgress()
            .width(48)
            .height(48)
            .color('#007DFF')
          Text('加载中...')
            .fontSize(14)
            .fontColor('#999999')
            .margin({ top: 12 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.errorMessage !== '') {
        Column() {
          Text(this.errorMessage)
            .fontSize(16)
            .fontColor('#E84026')
            .textAlign(TextAlign.Center)
            .margin({ bottom: 16 })
          Button('重试')
            .fontSize(14)
            .onClick(() => {
              this.loadTimeline();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .padding({ left: 32, right: 32 })
      } else if (this.cards.length === 0) {
        Column() {
          Text('暂无记忆，去首页记录第一条碎片')
            .fontSize(16)
            .fontColor('#999999')
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .padding({ left: 32, right: 32 })
      } else {
        List({ space: 12 }) {
          ForEach(this.cards, (card: KnowledgeCard) => {
            ListItem() {
              this.cardItem(card)
            }
          }, (card: KnowledgeCard) => card.id)
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ left: 16, right: 16, bottom: 16 })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F5F5')
  }
}
