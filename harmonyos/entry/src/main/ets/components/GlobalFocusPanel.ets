import { GoalQuestionPanel } from './GoalQuestionPanel';
import { SessionStore } from '../services/SessionStore';
import router from '@ohos.router';
import { focusStatusLabel, focusActionLabel, focusPrimary, focusEntryKind, focusDeadlineConflict } from '../common/GlobalFocusPresentation';
import { FocusEntry, GlobalFocusReply } from '../models/GlobalFocus';
import { GlobalFocusService } from '../services/GlobalFocusService';
import { ApiError } from '../models/Project';
import { LoadingStateView, ErrorStateView } from './AsyncStateView';
import { PMColors, PMRadius } from '../common/DesignTokens';
import { PMButton, PMStatusPill, PMPageIntro, PMMetricTile, PMListRow } from './PMReferencePrimitives';

@Component
export struct GlobalFocusPanel {
  @Prop @Watch('refresh') refreshKey: number = 0;
  onOpenActions: (reminders: boolean) => void = (_reminders: boolean): void => {};
  @State private view: GlobalFocusReply = new GlobalFocusReply();
  @State private busy: boolean = true;
  @State private errorText: string = '';
  @State private observedAt: string = '';
  @State private lastKnown: boolean = false;
  @State private includeArchived: boolean = false;
  @State private expandedGroups: string[] = [];
  private generation: number = 0;
  private service: GlobalFocusService = new GlobalFocusService();
  private expired: () => void = () => { this.generation++; this.view = new GlobalFocusReply(); this.lastKnown = false; this.observedAt = ''; this.errorText = '请重新登录后查看焦点'; this.busy = false; };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.refresh(); }
  aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
  private async refresh(): Promise<void> {
    const generation = ++this.generation; const token = SessionStore.getToken();
    this.busy = true; this.errorText = '';
    try {
      const reply = await this.service.read(this.includeArchived);
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      if (reply.schemaVersion !== 1) throw new Error('当前客户端尚不支持这份焦点摘要，请更新应用');
      this.view = reply; this.observedAt = new Date().toLocaleString('zh-CN'); this.lastKnown = false;
    } catch (error) {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { this.view = new GlobalFocusReply(); this.observedAt = ''; }
      this.lastKnown = this.observedAt !== '';
      this.errorText = (error instanceof ApiError ? error.message : '焦点暂未加载，请检查网络后重试') + (this.lastKnown ? `；保留上次读取 ${this.observedAt} 的历史摘要` : '');
    } finally { if (generation === this.generation) this.busy = false; }
  }
  private dateLabel(): string {
    const today = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekdays[today.getDay()]} · ${today.getMonth() + 1}月${today.getDate()}日`;
  }
  private primary(): FocusEntry | null { return focusPrimary(this.view); }
  private kind(item: FocusEntry): string { return focusEntryKind(this.view, item); }
  private count(reminders: boolean): string {
    const count = reminders ? this.view.counts?.reminders : this.view.counts?.actions;
    if (count !== undefined) return `${count}`;
    return `${reminders ? this.view.reminders.length : this.view.actions.length}${this.view.hasMore ? '+' : ''}`;
  }
  private remaining(items: FocusEntry[]): FocusEntry[] {
    const primary = this.primary();
    return items.filter((item: FocusEntry) => primary === null || item.id !== primary.id);
  }
  private visible(title: string, items: FocusEntry[], kind: string): FocusEntry[] {
    const remaining = this.remaining(items);
    if (this.expandedGroups.includes(title)) return remaining;
    const seen: string[] = [];
    return remaining.filter((item: FocusEntry) => {
      if (kind !== 'mission' || item.status !== 'PAUSED' && item.status !== 'FAILED') return true;
      const key = `${item.projectId}|${item.status}|${item.detail || item.title}`;
      if (seen.includes(key)) return false;
      seen.push(key); return true;
    }).slice(0, 3);
  }
  private duplicateCount(item: FocusEntry, items: FocusEntry[]): number {
    if (item.status !== 'PAUSED' && item.status !== 'FAILED') return 1;
    return items.filter((other: FocusEntry) => other.projectId === item.projectId && other.status === item.status &&
      (other.detail || other.title) === (item.detail || item.title)).length;
  }
  private rowTitle(item: FocusEntry, kind: string): string {
    if (kind === 'reminder' && focusDeadlineConflict(item, Date.now())) return '核对提醒与当前截止日';
    if (kind === 'mission' && item.status === 'PAUSED') return '委托已暂停，需要检查后继续';
    if (kind === 'mission' && item.status === 'FAILED') return '委托未能完成';
    return item.title;
  }
  private rowSubtitle(item: FocusEntry, items: FocusEntry[]): string {
    if (this.kind(item) === 'reminder' && focusDeadlineConflict(item, Date.now())) return this.primaryDetail(item);
    const count = this.duplicateCount(item, items);
    return `${count > 1 ? '已合并 ' + count + ' 条同类记录 · ' : ''}${item.detail || item.activity}`;
  }
  private primaryDetail(item: FocusEntry): string {
    if (this.kind(item) === 'reminder' && focusDeadlineConflict(item, Date.now())) {
      const deadline = new Date(item.projectDeadline!).toLocaleDateString('zh-CN');
      return `原提醒写“${item.title}”，当前项目截止日为 ${deadline}。请核对日期与适用阶段。`;
    }
    return item.detail;
  }
  private open(item: FocusEntry, kind: string): void {
    if (kind === 'project') { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: item.projectId } }); return; }
    if (kind === 'mission') router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: item.projectId, missionId: item.id } });
    else if (kind === 'reminder') router.pushUrl({ url: 'pages/InterventionDetail', params: { projectId: item.projectId, interventionId: item.id } });
    else router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: item.projectId,
      tab: kind === 'action' ? 'actions' : 'memory', actionId: kind === 'action' ? item.id : '', cardId: kind === 'record' ? item.id : '' } });
  }
  @Builder private Primary(item: FocusEntry) {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        PMStatusPill({ label: this.view.primaryContext !== undefined && this.view.primaryContext !== null && this.view.primaryContext.freshness !== 'FRESH' ? '部分摘要暂不可用' : this.kind(item) === 'reminder' ? '待你核对' : this.kind(item) === 'record' ? '最近记录' : focusStatusLabel(item.status),
          tone: item.status === 'PAUSED' || item.status === 'FAILED' ? 'risk' : 'warning' })
        Text(item.projectTitle).fontSize(12).fontColor(PMColors.INK_TERTIARY).layoutWeight(1)
          .textAlign(TextAlign.End).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%')
      Text(this.rowTitle(item, this.kind(item))).fontSize(21).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        .maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis }).lineHeight(29)
      if (this.primaryDetail(item) !== '') { Text(this.primaryDetail(item)).fontSize(14).lineHeight(22).fontColor(PMColors.INK_SECONDARY).maxLines(4).textOverflow({ overflow: TextOverflow.Ellipsis }) }
      PMStatusPill({ label: this.kind(item) === 'mission' ? '执行记录可追溯' : this.kind(item) === 'reminder' ? '待核对提醒依据' : '查看原始记录' })
      if (this.kind(item) === 'mission') { GoalQuestionPanel({ projectId: item.projectId, missionId: item.id, compact: true }) }
      PMButton({ label: this.view.primaryContext?.nextStep.actionLabel ?? focusActionLabel(item.status, this.kind(item)), onAction: (): void => { this.open(item, this.kind(item)); } })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(16).backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER }).margin({ bottom: 12 })
  }
  @Builder private Group(title: string, items: FocusEntry[], kind: string) {
    if (this.remaining(items).length > 0) {
      Text(title).fontSize(16).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).margin({ top: 22, bottom: 10 })
      Column() {
        ForEach(this.visible(title, items, kind), (item: FocusEntry) => {
          PMListRow({ title: this.rowTitle(item, kind), subtitle: this.rowSubtitle(item, items), meta: item.projectTitle,
            kind: kind, status: kind === 'mission' && (item.status === 'PAUSED' || item.status === 'FAILED') ? '需处理' : '',
            risk: item.status === 'PAUSED' || item.status === 'FAILED', onOpen: (): void => { this.open(item, kind); } })
        }, (item: FocusEntry) => item.id)
        if (this.remaining(items).length > this.visible(title, items, kind).length && !this.expandedGroups.includes(title)) {
          Button('展开本组全部原记录', { type: ButtonType.Normal }).height(44).width('100%').fontSize(12)
            .fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE)
            .onClick(() => { this.expandedGroups = [...this.expandedGroups, title]; })
        }
      }.width('100%').backgroundColor(PMColors.SURFACE).borderRadius(17).clip(true).border({ width: 1, color: PMColors.BORDER_SUBTLE })
    }
  }
  build() {
    if (this.busy) { LoadingStateView({ message: '正在读取当前焦点…' }) }
    else if (this.errorText !== '' && !this.lastKnown) { ErrorStateView({ message: this.errorText, onRetry: () => { this.refresh(); } }) }
    else {
      Scroll() {
        Column() {
          if (this.errorText !== '') { Text(this.errorText).fontSize(12).fontColor(PMColors.RISK) }
          PMPageIntro({ eyebrow: this.dateLabel(), title: '今天，先处理重要的事', description: '优先回应与你有关的判断，再继续推进项目。' })
          if (this.primary() !== null) { this.Primary(this.primary()!) }
          else { Text('当前范围内没有待回应的事项，进入项目记录新进展。').fontSize(14).fontColor(PMColors.INK_SECONDARY).margin({ bottom: 16 }) }
          Row({ space: 10 }) {
            PMMetricTile({ label: '待处理行动', value: this.count(false), hint: '查看待办 →', onOpen: (): void => { this.onOpenActions(false); } }).layoutWeight(1)
            PMMetricTile({ label: '主动提醒', value: this.count(true), hint: '查看原因 →', onOpen: (): void => { this.onOpenActions(true); } }).layoutWeight(1)
          }.width('100%')
          this.Group('其他需要关注', this.view.waiting, 'mission')
          this.Group('正在推进', this.view.running, 'mission')
          this.Group('下一步行动', this.view.actions, 'action')
          this.Group('其他提醒', this.view.reminders, 'reminder')
          this.Group('最近保存的资料', this.view.records, 'record')
          Row() {
            Checkbox({ name: '包含归档项目' }).width(20).height(20).select(this.includeArchived)
              .onChange((value: boolean) => { this.includeArchived = value; this.refresh(); }).accessibilityText('包含归档项目')
            Text('包含归档项目').fontSize(12).fontColor(PMColors.INK_TERTIARY)
            Blank()
            Button('刷新焦点', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
              .onClick(() => { this.refresh(); })
          }.width('100%').margin({ top: 16 })
          if (!this.view.missionEnabled) { Text('长期委托当前未开启，已有记录仍保留。').fontSize(12).fontColor(PMColors.INK_TERTIARY) }
          if (this.view.hasMore) { Text('当前显示部分摘要，进入所属项目可查看全部。').fontSize(12).fontColor(PMColors.INK_TERTIARY) }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 16, right: 16, top: 22, bottom: 20 })
      }.width('100%').height('100%').align(Alignment.TopStart).scrollBar(BarState.Off)
    }
  }
}
