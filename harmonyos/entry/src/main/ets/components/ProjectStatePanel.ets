import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction } from '../common/DesignTokens';
import {
  StateDiff,
  StateDiffItem,
  StateDiffResponse,
  StateRefreshResponse,
  StateSnapshot,
  StateUnknown,
  StateFreshness
} from '../models/ProjectState';
import { ApiError } from '../models/Project';
import { ProjectStateService } from '../services/ProjectStateService';

@Component
export struct ProjectStatePanel {
  @Prop projectId: string = '';
  @State private phase: string = 'loading'; // loading | error | empty | ready
  @State private errorMessage: string = '';
  @State private snapshot: StateSnapshot = new StateSnapshot();
  @State private freshness: StateFreshness = new StateFreshness();
  @State private diff: StateDiff = new StateDiff();
  @State private isRefreshing: boolean = false;
  @State private isMarkingRead: boolean = false;
  @State private baselineMessage: string = '';
  private stateService: ProjectStateService = new ProjectStateService();
  onOpenDiffSheet: (diff: StateDiff) => void = (_diff: StateDiff) => {};
  onOpenBrief: (fromId: string, toId: string) => void = (_fromId: string, _toId: string) => {};
  onGoActions: () => void = () => {};

  aboutToAppear(): void {
    this.loadState();
  }

  private lastSeenKey(): string {
    return `stateLastSeen_${this.projectId}`;
  }

  private formatDay(value: string): string {
    return value !== '' && value.length >= 10 ? value.substring(0, 10) : '未知';
  }

  private async loadState(): Promise<void> {
    this.phase = 'loading';
    this.errorMessage = '';
    try {
      // 进入项目显式刷新再读取（§5.3）：业务写入后状态刷新失败时，这里做崩溃补偿
      const refresh: StateRefreshResponse = await this.stateService.refresh(this.projectId);
      this.freshness = refresh.freshness;
      if (refresh.snapshot === null) {
        this.errorMessage = refresh.freshness.errorMessage ?? '还没有可展示的状态快照，请稍后重试';
        this.phase = 'error';
        return;
      }
      this.snapshot = refresh.snapshot;
      if (refresh.status === 'STALE' || refresh.freshness.status === 'FAILED') {
        this.baselineMessage = refresh.freshness.errorMessage ?? '状态刷新失败，当前展示上一份快照；可稍后重试。';
      }
      if (refresh.status === 'BASELINE_CREATED') {
        this.baselineMessage = '这是第一份状态记录，后续变化都会与它对比。';
      }
      await this.loadDiffAgainstLastSeen();
      this.phase = 'ready';
    } catch (e) {
      this.errorMessage = e instanceof ApiError ? e.message : '状态加载失败，请检查网络后重试';
      this.phase = 'error';
    }
  }

  private async loadDiffAgainstLastSeen(): Promise<void> {
    this.diff = new StateDiff();
    const lastSeen = AppStorage.get<string>(this.lastSeenKey());
    if (lastSeen === undefined || lastSeen === '' || lastSeen === this.snapshot.id) {
      return;
    }
    try {
      const diffResponse: StateDiffResponse =
        await this.stateService.diff(this.projectId, lastSeen, this.snapshot.id);
      this.diff = diffResponse.diff;
    } catch (_e) {
      // Diff 拉取失败不冒充“没有变化”：保留未读提示，由用户重试或直接查看快照
      this.diff = new StateDiff();
      this.baselineMessage = '变化详情暂时无法获取，可点击刷新重试。';
    }
  }

  private async refreshState(): Promise<void> {
    if (this.isRefreshing) {
      return;
    }
    this.isRefreshing = true;
    try {
      const response: StateRefreshResponse = await this.stateService.refresh(this.projectId);
      this.freshness = response.freshness;
      if (response.snapshot === null) {
        this.errorMessage = response.freshness.errorMessage ?? '还没有可展示的状态快照，请稍后重试';
        this.phase = 'error';
        return;
      }
      this.snapshot = response.snapshot;
      if (response.status === 'STALE' || response.freshness.status === 'FAILED') {
        this.baselineMessage = response.freshness.errorMessage ?? '状态刷新失败，当前展示上一份快照；可稍后重试。';
      }
      if (response.status === 'BASELINE_CREATED') {
        this.baselineMessage = '这是第一份状态记录，后续变化都会与它对比。';
      }
      await this.loadDiffAgainstLastSeen();
      this.phase = 'ready';
    } catch (e) {
      this.errorMessage = e instanceof ApiError ? e.message : '状态刷新失败，请稍后重试';
      if (this.phase !== 'ready') {
        this.phase = 'error';
      }
    } finally {
      this.isRefreshing = false;
    }
  }

  private hasUnreadChange(): boolean {
    const lastSeen = AppStorage.get<string>(this.lastSeenKey());
    return lastSeen === undefined || lastSeen === '' || lastSeen !== this.snapshot.id;
  }

  private async markRead(): Promise<void> {
    if (this.isMarkingRead || !this.hasUnreadChange()) {
      return;
    }
    this.isMarkingRead = true;
    try {
      const consumerKey = AppStorage.get<string>('deviceConsumerKey') ?? '';
      await this.stateService.checkIn(this.projectId, this.snapshot.id, consumerKey);
      AppStorage.setOrCreate<string>(this.lastSeenKey(), this.snapshot.id);
      this.diff = new StateDiff();
    } catch (e) {
      // 已了解失败不吞掉：保留未读状态，用户可重试
      const message = e instanceof ApiError ? e.message : '标记已读失败，请重试';
      this.errorMessage = message;
    } finally {
      this.isMarkingRead = false;
    }
  }

  private healthGlyph(): string {
    if (this.snapshot.payload.health === 'AT_RISK') return '!';
    if (this.snapshot.payload.health === 'ON_TRACK') return '✓';
    return '?';
  }

  private healthLabel(): string {
    if (this.snapshot.payload.health === 'AT_RISK') return '存在已确认的风险';
    if (this.snapshot.payload.health === 'ON_TRACK') return '暂无已确认风险';
    return '信息不足，无法判断';
  }

  private healthColor(): ResourceColor {
    if (this.snapshot.payload.health === 'AT_RISK') return PMColors.RISK;
    if (this.snapshot.payload.health === 'ON_TRACK') return PMColors.SUCCESS;
    return PMColors.INK_SECONDARY;
  }

  private topRiskText(): string {
    for (let i = 0; i < this.snapshot.payload.risks.length; i++) {
      const risk = this.snapshot.payload.risks[i];
      if (risk.truth === 'TRUE') {
        return `[${risk.severity}] ${risk.text}`;
      }
    }
    return '';
  }

  private topUnknown(): StateUnknown | null {
    if (this.snapshot.payload.unknowns.length > 0) {
      return this.snapshot.payload.unknowns[0];
    }
    return null;
  }

  private topUnknownText(): string {
    const unknown = this.topUnknown();
    return unknown !== null ? unknown.text : '';
  }

  private nextStepText(): string {
    const unknown = this.topUnknown();
    if (this.topRiskText() !== '') {
      return '先处理上方风险对应的任务。';
    }
    if (unknown !== null) {
      return unknown.suggestedInputAction;
    }
    return '继续推进当前待办。';
  }

  @Builder
  private changeRow(item: StateDiffItem) {
    Row() {
      Text(this.diffGlyph(item.kind))
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.diffColor(item.kind))
      Text(item.summary)
        .fontSize(PMFontSize.BODY)
        .fontColor(PMColors.INK_PRIMARY)
        .lineHeight(20)
        .layoutWeight(1)
        .margin({ left: PMSpacing.SM })
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
    .margin({ bottom: PMSpacing.XS })
  }

  private diffGlyph(kind: string): string {
    if (kind === 'ADDED') return '＋';
    if (kind === 'RESOLVED') return '✓';
    if (kind === 'REGRESSED') return '!';
    if (kind === 'UNCERTAIN') return '?';
    return '→';
  }

  private diffColor(kind: string): ResourceColor {
    if (kind === 'RESOLVED') return PMColors.SUCCESS;
    if (kind === 'REGRESSED') return PMColors.RISK;
    if (kind === 'UNCERTAIN') return PMColors.EVIDENCE;
    return PMColors.BRAND;
  }

  build() {
    Column() {
      // 头部：标题与评估时间
      Row() {
        Text('状态与变化')
          .fontSize(PMFontSize.SECTION_TITLE)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
        Text(`评估于 ${this.formatDay(this.snapshot.evaluatedAt)}`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)

      if (this.phase === 'loading') {
        Row() {
          LoadingProgress()
            .width(20)
            .height(20)
            .color(PMColors.BRAND)
          Text('正在读取项目状态…')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ left: PMSpacing.SM })
        }
        .width('100%')
        .margin({ top: PMSpacing.MD })
      } else if (this.phase === 'error') {
        Column() {
          Text(`⚠ ${this.errorMessage}`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.RISK)
          Button(this.isRefreshing ? '重试中…' : '重试')
            .height(32)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .margin({ top: PMSpacing.SM })
            .enabled(!this.isRefreshing)
            .onClick(() => {
              this.loadState();
            })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .margin({ top: PMSpacing.MD })
      } else {
        // ready：本次变化 → 风险/未知 → 建议下一步 → 操作
        if (this.freshness.status === 'STALE' || this.freshness.status === 'FAILED') {
          Text('⚠ 当前快照不是最新评估结果，系统保留了上一份状态；刷新成功后再更新。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.RISK)
            .lineHeight(18)
            .margin({ top: PMSpacing.SM })
        }
        if (this.baselineMessage !== '') {
          Text(this.baselineMessage)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .margin({ top: PMSpacing.SM })
        }

        Column() {
          Text('本次变化')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_SECONDARY)
          if (this.diff.materialChange) {
            ForEach(this.diff.items.slice(0, 3), (item: StateDiffItem) => {
              this.changeRow(item)
            }, (item: StateDiffItem) => item.changeKey)
            if (this.diff.items.length > 3) {
              Text(`还有 ${this.diff.items.length - 3} 项变化`)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
            }
          } else {
            Text('· 没有未读的重要变化')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
          }
          Row({ space: PMSpacing.MD }) {
            Text('查看全部变化与依据')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.BRAND)
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                this.onOpenDiffSheet(this.diff);
              })

            Text('查看简报（变化/影响/建议）')
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.BRAND)
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                const lastSeen = AppStorage.get<string>(this.lastSeenKey());
                this.onOpenBrief(lastSeen === undefined || lastSeen === '' ? '' : lastSeen, this.snapshot.id);
              })
          }
          .width('100%')
          .margin({ top: PMSpacing.XS })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .margin({ top: PMSpacing.SM })

        Divider()
          .color(PMColors.BORDER)
          .margin({ top: PMSpacing.SM, bottom: PMSpacing.SM })

        Column() {
          Text(`${this.healthGlyph()} ${this.healthLabel()}`)
            .fontSize(PMFontSize.BODY)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.healthColor())
          if (this.topRiskText() !== '') {
            Text(`最大风险：${this.topRiskText()}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.RISK)
              .lineHeight(18)
              .margin({ top: PMSpacing.XS })
          } else if (this.topUnknownText() !== '') {
            Text(`未知项：${this.topUnknownText()}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(18)
              .margin({ top: PMSpacing.XS })
          }
          Text(`建议下一步：${this.nextStepText()}`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .lineHeight(18)
            .margin({ top: PMSpacing.XS })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        Row({ space: PMSpacing.SM }) {
          Button(this.isMarkingRead ? '标记中…' : (this.hasUnreadChange() ? '已了解' : '已读至最新'))
            .height(40)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .layoutWeight(1)
            .enabled(!this.isMarkingRead && this.hasUnreadChange())
            .onClick(() => {
              this.markRead();
            })

          Button(this.isRefreshing ? '刷新中…' : '刷新')
            .height(40)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .layoutWeight(1)
            .enabled(!this.isRefreshing)
            .onClick(() => {
              this.refreshState();
            })

          Button('待办')
            .height(40)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .borderRadius(PMRadius.SM)
            .onClick(() => {
              this.onGoActions();
            })
        }
        .width('100%')
        .margin({ top: PMSpacing.MD })
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER })
    .alignItems(HorizontalAlign.Start)
  }
}
