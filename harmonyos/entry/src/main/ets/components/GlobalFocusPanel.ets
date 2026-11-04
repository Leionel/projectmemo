import { workPhaseLabel } from '../common/GlobalFocusPresentation';
import { GoalQuestionPanel } from './GoalQuestionPanel';
import { SessionStore } from '../services/SessionStore';
import router from '@ohos.router';
import { focusStatusLabel, focusActionLabel, focusPrimary, focusEntryKind, focusDeadlineConflict } from '../common/GlobalFocusPresentation';
import { FocusEntry, GlobalFocusReply } from '../models/GlobalFocus';
import { GlobalFocusService } from '../services/GlobalFocusService';
import { ConversationService } from '../services/ConversationService';
import { ApiError } from '../models/Project';
import { LoadingStateView, ErrorStateView } from './AsyncStateView';
import { PMColors, PMRadius } from '../common/DesignTokens';
import { PMButton, PMStatusPill, PMPageIntro, PMListRow } from './PMReferencePrimitives';
import { SettingsIcon } from './PMIcons';
import { FocusAgentLauncher } from './FocusAgentLauncher';
import { WorkStateBadges } from './WorkStateBadge';
import { nextActorLabel, primaryActionTone } from '../common/WorkStateBadge';
import { MissionService } from '../services/MissionService';
import { MissionReadTarget } from '../models/MissionReadback';
import { readbackDelta, WorkPacketView, shortPacketTime } from '../models/WorkPacket';
import { missionToolLabel } from '../common/MissionContract';

@Component
export struct GlobalFocusPanel {
  @State private agentEnabled: boolean = false;
  @Prop @Watch('refresh') refreshKey: number = 0;
  onOpenActions: (reminders: boolean) => void = (_reminders: boolean): void => {};
  @State private view: GlobalFocusReply = new GlobalFocusReply();
  @State private busy: boolean = true;
  @State private errorText: string = '';
  @State private observedAt: string = '';
  @State private lastKnown: boolean = false;
  @State private includeArchived: boolean = false;
  @State private expandedGroups: string[] = [];
  @State private heroPacket: WorkPacketView | null = null;
  private generation: number = 0;
  private boundaryTimer:number=-1;
  private service: GlobalFocusService = new GlobalFocusService();
  private expired: () => void = () => { this.generation++; this.view = new GlobalFocusReply(); this.lastKnown = false; this.observedAt = ''; this.errorText = '请重新登录后查看焦点'; this.busy = false; };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.refresh(); const epoch = this.generation; new ConversationService().capabilities().then(c => { if (epoch === this.generation) this.agentEnabled = c.enabled; }).catch(() => {}); }
  aboutToDisappear(): void { if(this.boundaryTimer>=0)clearTimeout(this.boundaryTimer);this.generation++; SessionStore.offSessionExpired(this.expired); }
  private async refresh(): Promise<void> {
    const generation = ++this.generation; const token = SessionStore.getToken();
    this.busy = true; this.errorText = '';
    try {
      const reply = await this.service.read(this.includeArchived);
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      if (reply.schemaVersion !== 1) throw new Error('当前客户端尚不支持这份焦点摘要，请更新应用');
      this.view = reply;if(this.boundaryTimer>=0)clearTimeout(this.boundaryTimer);const boundary=reply.primaryContext?.nextBoundary;if(boundary){this.boundaryTimer=setTimeout(()=>{this.refresh();},Math.min(Math.max(Date.parse(boundary)-Date.now()+20,20),2147483647));} this.observedAt = new Date().toLocaleString('zh-CN'); this.lastKnown = false; this.loadHeroPacket(generation, token);
    } catch (error) {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) { this.view = new GlobalFocusReply(); this.observedAt = ''; }
      this.lastKnown = this.observedAt !== '';
      this.errorText = (error instanceof ApiError ? error.message : '焦点暂未加载，请检查网络后重试') + (this.lastKnown ? `；保留上次读取 ${this.observedAt} 的历史摘要` : '');
    } finally { if (generation === this.generation) this.busy = false; }
  }
  /** 主卡片为委托时读原工作包，只摘要「做到哪 / 为什么停」；读取失败不显示，不用空白冒充无进展。 */
  private loadHeroPacket(generation: number, token: string): void {
    const item = this.primary();
    if (item === null || this.kind(item) !== 'mission') { this.heroPacket = null; return; }
    new MissionService().readback(item.id, new MissionReadTarget()).then(value => {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      const packet = readbackDelta(value.readback).workPacket;
      this.heroPacket = packet !== null && packet.present ? packet : null;
    }).catch(() => { if (generation === this.generation) this.heroPacket = null; });
  }
  private packetDone(packet: WorkPacketView): string {
    const steps = packet.done.steps;
    const head = steps.length > 0 ? `${steps.length} 步${steps[0].note !== '' ? ' · ' + steps[0].note : ' · ' + missionToolLabel(steps[0].toolName)}` : '窗口内暂无步骤';
    return packet.stopped.unsettledPresent ? head + ' · 1 步待结算' : head;
  }
  private packetStop(packet: WorkPacketView): string {
    return packet.blockers.length > 0 ? packet.blockers[0].text : packet.stopped.phase === 'RUNNING' ? '无阻断' : packet.stopped.reasonText;
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
    return items.filter((item: FocusEntry) => primary === null || item.id !== primary.id || item.projectId !== primary.projectId);
  }
  private visible(title: string, items: FocusEntry[], kind: string): FocusEntry[] {
    const remaining = this.remaining(items);
    if (this.expandedGroups.includes(title)) return remaining;
    // 同一项目、同一停止状态、同一目标的委托只是错误文案不同，折叠后只留一条；首屏主卡已展示的同类也不再重复。
    const seen: string[] = [];
    const primary = this.primary();
    if (primary !== null && kind === 'mission' && (primary.status === 'PAUSED' || primary.status === 'FAILED')) {
      seen.push(this.stoppedMissionKey(primary));
    }
    return remaining.filter((item: FocusEntry) => {
      if (kind !== 'mission' || item.status !== 'PAUSED' && item.status !== 'FAILED') return true;
      const key = this.stoppedMissionKey(item);
      if (seen.includes(key)) return false;
      seen.push(key); return true;
    }).slice(0, 3);
  }
  private duplicateCount(item: FocusEntry, items: FocusEntry[]): number {
    if (item.status !== 'PAUSED' && item.status !== 'FAILED') return 1;
    const key = this.stoppedMissionKey(item);
    return items.filter((other: FocusEntry) => this.stoppedMissionKey(other) === key).length;
  }
  private stoppedMissionKey(item: FocusEntry): string { return `${item.projectId}|${item.status}|${item.title}`; }
  private rowTitle(item: FocusEntry, kind: string): string {
    if (kind === 'reminder' && focusDeadlineConflict(item, Date.now())) return '核对提醒与当前截止日';
    if (kind === 'mission' && item.status === 'PAUSED') return '委托已暂停，需要检查后继续';
    if (kind === 'mission' && item.status === 'FAILED') return '委托未能完成';
    return item.title;
  }
  private missionInterrupted(item: FocusEntry): string {
    return item.status === 'FAILED' ? '执行已中断，进入详情查看原因与恢复方式。' : '进入详情查看原因与继续方式。';
  }
  private rowSubtitle(item: FocusEntry, items: FocusEntry[]): string {
    if (this.kind(item) === 'reminder' && focusDeadlineConflict(item, Date.now())) return this.primaryDetail(item);
    if (this.kind(item) === 'mission' && (item.status === 'PAUSED' || item.status === 'FAILED')) {
      const count = this.duplicateCount(item, items);
      return `${count > 1 ? '已合并 ' + count + ' 条同类记录 · ' : ''}${this.missionInterrupted(item)}`;
    }
    const count = this.duplicateCount(item, items);
    return `${count > 1 ? '已合并 ' + count + ' 条同类记录 · ' : ''}${item.detail || item.activity}`;
  }
  private primaryDetail(item: FocusEntry): string {
    if (this.kind(item) === 'mission' && (item.status === 'PAUSED' || item.status === 'FAILED')) { return this.missionInterrupted(item); }
    if (this.kind(item) === 'reminder' && focusDeadlineConflict(item, Date.now())) {
      const deadline = new Date(item.projectDeadline!).toLocaleDateString('zh-CN');
      return `原提醒写“${item.title}”，当前项目截止日为 ${deadline}。请核对日期与适用阶段。`;
    }
    return item.detail;
  }
  /** 用用户能理解的时间表达提醒截止；不直接展示 ISO 时间戳。 */
  private reminderTime(item: FocusEntry): string {
    const raw = item.dueAt !== '' ? item.dueAt : (item.projectDeadline ?? '');
    if (raw === '') { return ''; }
    const due = Date.parse(raw);
    if (isNaN(due)) { return ''; }
    const d = new Date(due);
    const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    const days = Math.ceil((due - Date.now()) / 86400000);
    if (days < 0) { return '已逾期 · 截止于 ' + md; }
    if (days === 0) { return '今日截止'; }
    if (days <= 7) { return '距截止 ' + days + ' 天 · ' + md; }
    return '截止于 ' + md;
  }
  private reminderMeta(item: FocusEntry): string {
    const parts: string[] = [];
    const time = this.reminderTime(item);
    if (time !== '') { parts.push(time); }
    parts.push(item.projectTitle);
    return parts.join(' · ');
  }
  private openMission(item: FocusEntry): void {
    const state = item.workState;
    router.pushUrl({ url: 'pages/MissionDetail', params: {
      projectId: item.projectId,
      missionId: item.id,
      // 有原问题/提案时带上精确身份；没有时空字符串表示由详情读回当前对象，不另建任务。
      questionId: state !== undefined ? (state.exactQuestionRef ?? '') : '',
      approvalId: state !== undefined ? (state.exactApprovalRef ?? '') : '',
      handoffMissionVersion: state !== undefined ? String(state.originalRef.version) : ''
    } });
  }
  /** 焦点状态标签：停止请求在途/额度等待/UNKNOWN 不写成已停止或成功。 */
  private focusStatusText(item: FocusEntry): string {
    const state = item.workState;
    if (state !== undefined) {
      if (state.reasonCode === 'STOP_REQUESTED_IN_FLIGHT') { return '停止请求待结算'; }
      if (state.reasonCode === 'DAILY_BUDGET_WAITING') { return '等待额度恢复'; }
      return workPhaseLabel(state.phase);
    }
    return focusStatusLabel(item.status);
  }
  private open(item: FocusEntry, kind: string): void {
    if (kind === 'project') { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: item.projectId } }); return; }
    if (kind === 'mission') this.openMission(item);
    else if (kind === 'reminder') router.pushUrl({ url: 'pages/InterventionDetail', params: { projectId: item.projectId, interventionId: item.id } });
    else router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: item.projectId,
      tab: kind === 'action' ? 'actions' : 'memory', actionId: kind === 'action' ? item.id : '', cardId: kind === 'record' ? item.id : '' } });
  }
  private askReason(item: FocusEntry): void {
    router.pushUrl({ url: 'pages/FocusConversation', params: { projectId: item.projectId, originKind: 'INTERVENTION', originId: item.id } });
  }
  private focusMenuItems(): MenuElement[] {
    const items: MenuElement[] = [];
    items.push({ value: this.includeArchived ? '包含归档项目 · 已开启' : '包含归档项目 · 未开启', action: (): void => {
      this.includeArchived = !this.includeArchived; this.refresh();
    } });
    items.push({ value: '刷新焦点', action: (): void => { this.refresh(); } });
    return items;
  }
  @Builder private Primary(item: FocusEntry) {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        if (item.workState !== undefined && this.kind(item) === 'mission' && (this.view.primaryContext === undefined || this.view.primaryContext === null || this.view.primaryContext.freshness === 'FRESH')) {
          WorkStateBadges({ state: item.workState })
        } else {
          PMStatusPill({ label: this.view.primaryContext !== undefined && this.view.primaryContext !== null && this.view.primaryContext.freshness !== 'FRESH' ? '部分摘要暂不可用' : this.kind(item) === 'reminder' ? '待你核对' : this.kind(item) === 'record' ? '最近记录' : this.focusStatusText(item),
          tone: item.status === 'PAUSED' || item.status === 'FAILED' ? 'risk' : 'warning' })
        }
        Text(item.projectTitle).fontSize(12).fontColor(PMColors.INK_TERTIARY).layoutWeight(1)
          .textAlign(TextAlign.End).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
      }.width('100%')
      Text(this.rowTitle(item, this.kind(item))).fontSize(21).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        .maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis }).lineHeight(29)
      if (this.kind(item) === 'reminder' && this.reminderTime(item) !== '') {
        Text(this.reminderTime(item)).fontSize(13).fontColor(PMColors.INK_SECONDARY)
      }
      if (this.view.primaryContext?.workingObjective) { Text('当前重点：'+this.view.primaryContext!.workingObjective).fontSize(14).fontColor(PMColors.INK_SECONDARY) }
      if (this.primaryDetail(item) !== '') { Text(this.primaryDetail(item)).fontSize(14).lineHeight(22).fontColor(PMColors.INK_SECONDARY).maxLines(4).textOverflow({ overflow: TextOverflow.Ellipsis }) }
      if (this.heroPacket !== null && this.kind(item) === 'mission') {
        Row() {
          Column({ space: 2 }) {
            Text('做到哪').fontSize(11).fontColor(PMColors.INK_TERTIARY)
            Text(this.packetDone(this.heroPacket)).fontSize(13).fontColor(PMColors.INK_PRIMARY).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }.layoutWeight(1).alignItems(HorizontalAlign.Start).padding({ left: 12, right: 12, top: 8, bottom: 8 })
          Column({ space: 2 }) {
            Text('为什么停').fontSize(11).fontColor(PMColors.INK_TERTIARY)
            Text(this.packetStop(this.heroPacket)).fontSize(13).fontColor(PMColors.INK_PRIMARY).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          }.layoutWeight(1).alignItems(HorizontalAlign.Start).padding({ left: 12, right: 12, top: 8, bottom: 8 })
            .border({ width: { left: 1 }, color: PMColors.BORDER_SUBTLE })
        }.width('100%').borderRadius(13).backgroundColor(PMColors.SURFACE_SUBTLE)
      }
      PMButton({ label: this.view.primaryContext?.nextStep.actionLabel ?? focusActionLabel(item.status, this.kind(item)), secondary: primaryActionTone(item.workState) !== 'solid', onAction: (): void => { this.open(item, this.kind(item)); } })
      if (item.workState !== undefined && this.kind(item) === 'mission') {
        Row() {
          if (nextActorLabel(item.workState.nextActor) !== '') {
            Text('下一步：' + nextActorLabel(item.workState.nextActor)).fontSize(12).fontColor(PMColors.INK_TERTIARY)
          }
          Blank()
          Text(item.workState.observedAt !== null && item.workState.observedAt !== '' ? '最近观察 ' + shortPacketTime(item.workState.observedAt) : '尚无成功观察')
            .fontSize(12).fontColor(PMColors.INK_TERTIARY)
        }.width('100%')
      }
      if (this.agentEnabled && this.kind(item) === 'reminder') { PMButton({ label: '问问提醒原因', secondary: true, onAction: (): void => { this.askReason(item); } }) }
      if (this.kind(item) === 'mission') { GoalQuestionPanel({ projectId: item.projectId, missionId: item.id, compact: true }) }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(16).backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER }).margin({ bottom: 12 })
  }
  @Builder private SummaryChip(label: string, value: string, onOpen: () => void) {
    Row({ space: 6 }) {
      Text(label).fontSize(13).fontColor(value === '0' ? PMColors.INK_TERTIARY : PMColors.INK_SECONDARY)
      Text(value).fontSize(16).fontWeight(FontWeight.Bold).fontColor(value === '0' ? PMColors.INK_TERTIARY : PMColors.INK_PRIMARY)
    }.height(36).padding({ left: 14, right: 14 }).borderRadius(999)
      .backgroundColor(PMColors.SURFACE).border({ width: 1, color: value === '0' ? PMColors.BORDER_SUBTLE : PMColors.BORDER })
      .clickEffect({ level: ClickEffectLevel.LIGHT, scale: 0.96 })
      .onClick(() => { onOpen(); })
      .accessibilityText(label + ' ' + value + '，查看' + label + '列表')
  }
  @Builder private ReminderRow(item: FocusEntry) {
    Row({ space: 8 }) {
      Column({ space: 4 }) {
        Text(this.rowTitle(item, 'reminder')).fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        Text(this.rowSubtitle(item, this.view.reminders)).fontSize(12).lineHeight(18).fontColor(PMColors.INK_SECONDARY)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
        Text(this.reminderMeta(item)).fontSize(11).fontColor(PMColors.INK_TERTIARY)
          .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        .onClick(() => { this.open(item, 'reminder'); })
      Column({ space: 2 }) {
        if (this.agentEnabled) {
          Text('提醒原因').fontSize(12).fontColor(PMColors.BRAND).padding({ left: 8, right: 4, top: 8, bottom: 8 })
            .onClick(() => { this.askReason(item); })
        }
        Text('›').fontSize(20).fontColor(PMColors.INK_TERTIARY).padding({ left: 8, right: 2, bottom: 6 })
          .onClick(() => { this.open(item, 'reminder'); })
      }.alignItems(HorizontalAlign.End)
    }.width('100%').alignItems(VerticalAlign.Top).padding({ top: 12, bottom: 12, left: 14, right: 10 })
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
  }
  @Builder private RecordRow(item: FocusEntry) {
    Column({ space: 3 }) {
      Text(item.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
      Text(item.projectTitle).fontSize(11).fontColor(PMColors.INK_TERTIARY)
        .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 10, bottom: 10, left: 14, right: 14 })
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      .onClick(() => { this.open(item, 'record'); })
      .accessibilityText(item.title + '，' + item.projectTitle + '，查看原始记录')
  }
  @Builder private Group(title: string, items: FocusEntry[], kind: string) {
    if (this.remaining(items).length > 0) {
      Text(title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).margin({ top: 18, bottom: 8 })
      Column() {
        ForEach(this.visible(title, items, kind), (item: FocusEntry) => {
          if (kind === 'reminder') { this.ReminderRow(item) }
          else if (kind === 'record') { this.RecordRow(item) }
          else {
            PMListRow({ title: this.rowTitle(item, kind), subtitle: this.rowSubtitle(item, items), meta: item.projectTitle,
              kind: kind, status: kind === 'mission' && (item.status === 'PAUSED' || item.status === 'FAILED') ? '需处理' : '',
              risk: item.status === 'PAUSED' || item.status === 'FAILED', onOpen: (): void => { this.open(item, kind); } })
          }
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
      Stack({ alignContent: Alignment.BottomEnd }) {
      Scroll() {
        Column() {
          if (this.errorText !== '') { Text(this.errorText).fontSize(12).fontColor(PMColors.RISK) }
          Row({ space: 8 }) {
            PMPageIntro({ eyebrow: this.dateLabel(), title: '今日焦点', compact: true }).layoutWeight(1)
            Button({ type: ButtonType.Circle }) { SettingsIcon({ iconSize: 18 }) }
              .width(40).height(40).backgroundColor(Color.Transparent)
              .accessibilityText('焦点设置：归档筛选与刷新')
              .bindMenu(this.focusMenuItems())
          }.width('100%').alignItems(VerticalAlign.Top)
          if (this.primary() !== null) { this.Primary(this.primary()!) }
          else { Text('当前范围内没有待回应的事项，进入项目记录新进展。').fontSize(14).fontColor(PMColors.INK_SECONDARY).margin({ bottom: 16 }) }
          Row({ space: 10 }) {
            this.SummaryChip('待办', this.count(false), (): void => { this.onOpenActions(false); })
            this.SummaryChip('提醒', this.count(true), (): void => { this.onOpenActions(true); })
            Blank()
          }.width('100%')
          this.Group('其他需要关注', this.view.waiting, 'mission')
          this.Group('正在推进', this.view.running, 'mission')
          this.Group('下一步行动', this.view.actions, 'action')
          this.Group('其他提醒', this.view.reminders, 'reminder')
          this.Group('最近保存的资料', this.view.records, 'record')
          if (!this.view.missionEnabled) { Text('长期委托当前未开启，已有记录仍保留。').fontSize(12).fontColor(PMColors.INK_TERTIARY).margin({ top: 14 }) }
          if (this.view.hasMore || this.view.coverage?.complete===false) { Text('当前显示部分摘要，进入所属项目可查看全部。').fontSize(12).fontColor(PMColors.INK_TERTIARY).margin({ top: 8 }) }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 16, right: 16, top: 18, bottom: 88 })
      }.width('100%').height('100%').align(Alignment.TopStart).scrollBar(BarState.Off)
      if (this.agentEnabled) {
        FocusAgentLauncher({ onOpen: (): void => { router.pushUrl({ url: 'pages/FocusConversation' }); } })
          .margin({ right: 16, bottom: 16 })
      }
      }.width('100%').height('100%')
    }
  }
}
