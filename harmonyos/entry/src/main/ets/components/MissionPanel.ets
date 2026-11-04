import { WorkStateBadges } from './WorkStateBadge';
import { failedReadState } from '../common/ReadState';
import { ProjectAgentContextService } from '../services/ProjectAgentContextService';
import router from '@ohos.router';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';
import { MissionWorkspaceItem, MissionWorkspaceSummary } from '../models/Mission';
import { ApiError } from '../models/Project';
import { missionStatusLabel } from '../common/MissionContract';
import { PMColors, PMSpacing, PMRadius } from '../common/DesignTokens';
import { PMStatusPill } from './PMReferencePrimitives';

interface MissionGroupView { title: string; statuses: string[]; }

/** 项目内委托列表：按「需要回应 / 正在推进 / 暂停或异常 / 已结束」组织，行内保留真实进展与当前所需操作。 */
@Component
export struct MissionPanel {
  @Prop projectId: string = '';
  @Prop compact: boolean = false;
  @Prop excludedMissionId: string = '';
  onSummary: (summary: MissionWorkspaceSummary) => void = (_summary: MissionWorkspaceSummary): void => {};
  @Prop @Watch('refreshChanged') refreshKey: number = 0;
  @State available: boolean = false;
  @State loading: boolean = true;
  @State error: string = '';
  @State readState: string = 'unavailable';
  @State observedAt: string = '';
  @State total: number = 0;
  @State items: MissionWorkspaceItem[] = [];
  private generation: number = 0;
  private disposed: boolean = false;
  private expired: () => void = () => {
    this.generation++; this.readState = 'unavailable'; this.observedAt = ''; this.items = []; this.total = 0; this.available = false; this.loading = false; this.error = '请重新登录后查看委托';
    this.onSummary({ enabled: false, totalActive: 0, items: [] });
  };
  aboutToAppear(): void { this.disposed = false; SessionStore.onSessionExpired(this.expired); this.probe(); }
  aboutToDisappear(): void { this.disposed = true; this.generation++; SessionStore.offSessionExpired(this.expired); }
  private async probe(): Promise<void> {
    const generation = ++this.generation; const token = SessionStore.getToken(); const project = this.projectId;
    this.loading = true; this.error = '';
    try {
      const summary = await new MissionService().summary(project);
      if (this.disposed || generation !== this.generation || token !== SessionStore.getToken() || project !== this.projectId) return;
      this.readState = 'fresh'; this.observedAt = new Date().toLocaleString('zh-CN'); this.available = summary.enabled; this.total = summary.totalActive; this.items = summary.items;
      this.onSummary(summary);
    } catch (e) {
      if (this.disposed || generation !== this.generation || token !== SessionStore.getToken()) return;
      this.readState = failedReadState(this.observedAt !== '', e instanceof ApiError ? e.status : 0);
      if (this.readState === 'unavailable') { this.items = []; this.total = 0; this.available = false; this.observedAt = ''; this.onSummary({ enabled: false, totalActive: 0, items: [] }); }
      this.error = e instanceof ApiError && e.status === 404 ? '当前账号无权查看本项目的私有委托' : e instanceof ApiError ? e.message : '委托摘要暂未加载，请检查网络后重试';
    } finally { if (generation === this.generation && !this.disposed) this.loading = false; }
  }
  private refreshChanged(): void { if (!this.disposed && this.projectId !== '') this.probe(); }
  private open(id: string = ''): void {
    router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: id } });
  }
  /** 行入口带原问题/提案身份与卡片版本线索；详情读回后仍以服务端当前对象为准。 */
  private openItem(item: MissionWorkspaceItem): void {
    const state = item.workState;
    router.pushUrl({ url: 'pages/MissionDetail', params: {
      projectId: this.projectId, missionId: item.id,
      questionId: state !== undefined ? (state.exactQuestionRef ?? '') : '',
      approvalId: state !== undefined ? (state.exactApprovalRef ?? '') : '',
      handoffMissionVersion: state !== undefined ? String(state.originalRef.version) : ''
    } });
  }
  private groups(): MissionGroupView[] {
    return [
      { title: '需要回应', statuses: ['WAITING_INPUT', 'WAITING_APPROVAL'] },
      { title: '正在推进', statuses: ['READY', 'RUNNING'] },
      { title: '暂停或异常', statuses: ['PAUSED', 'FAILED', 'UNKNOWN'] },
      { title: '已结束', statuses: ['SUCCEEDED', 'CANCELLED', 'OBSOLETE', 'SKIPPED'] },
    ];
  }
  private groupItems(statuses: string[]): MissionWorkspaceItem[] {
    const base = this.items.filter((item: MissionWorkspaceItem) => item.id !== this.excludedMissionId && statuses.includes(item.status));
    const seen: string[] = [];
    return base.filter((item: MissionWorkspaceItem) => {
      if (item.status !== 'PAUSED' && item.status !== 'FAILED') return true;
      const key = `${item.status}|${item.attention ?? item.goal}`;
      if (seen.includes(key)) return false;
      seen.push(key); return true;
    }).slice(0, this.compact ? 2 : 4);
  }
  private groupCount(statuses: string[]): number {
    return this.items.filter((item: MissionWorkspaceItem) => item.id !== this.excludedMissionId && statuses.includes(item.status)).length;
  }
  private actionLabel(item: MissionWorkspaceItem): string {
    if (item.workState?.actionLabel) { return item.workState.actionLabel; }
    if (item.status === 'WAITING_INPUT') { return '补充信息 →'; }
    if (item.status === 'WAITING_APPROVAL') { return '审阅提案 →'; }
    if (['SUCCEEDED', 'CANCELLED'].includes(item.status)) { return '查看成果与回执 →'; }
    return '查看委托详情 →';
  }
  private shortTime(at: string | null): string {
    if (at === null || at === '') { return ''; }
    const t = Date.parse(at);
    if (Number.isNaN(t)) { return ''; }
    const d = new Date(t);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
  @Builder
  private MissionRow(item: MissionWorkspaceItem) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        if (item.workState) {
          WorkStateBadges({ state: item.workState! })
        } else {
          PMStatusPill({ label: missionStatusLabel(item.status), tone: item.status === 'FAILED' || item.status === 'PAUSED' ? 'risk' : 'brand' })
        }
        Blank()
        if (this.shortTime(item.activityAt) !== '') { Text('更新于 ' + this.shortTime(item.activityAt)).fontSize(11).fontColor(PMColors.INK_TERTIARY) }
      }.width('100%')
      Text(item.goal).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        .fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).lineHeight(22)
      if (item.attention !== null) {
        Text(item.status === 'FAILED' || item.status === 'PAUSED' ? '执行中断，进入详情查看原因与恢复方式。' : item.attention)
          .fontSize(13).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor(item.status === 'FAILED' || item.status === 'PAUSED' ? PMColors.INK_PRIMARY : PMColors.INK_SECONDARY).lineHeight(20)
      }
      if (item.activity !== null && item.activity !== '') {
        Text('最近进展：' + item.activity).fontSize(12).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor(PMColors.INK_SECONDARY).lineHeight(18)
      }
      Row({ space: 10 }) {
        Text('设为当前关注', ).fontSize(12).fontColor(PMColors.INK_TERTIARY).height(36)
          .enabled(this.readState === 'fresh' && item.status !== 'SUCCEEDED' && item.status !== 'CANCELLED')
          .onClick(async () => {
            try { await new ProjectAgentContextService().focus(this.projectId, item.id); this.error = ''; this.probe(); }
            catch (e) { this.error = e instanceof ApiError ? e.message : '未能设置关注委托'; }
          })
          .accessibilityText('把这条委托设为当前关注')
        Blank()
        Text(this.actionLabel(item)).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.BRAND).height(36)
          .onClick(() => { this.openItem(item); })
          .accessibilityText(this.actionLabel(item))
      }.width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }
  build() {
    if (this.available || this.loading || this.error !== '' || !this.compact) {
      Column({ space: PMSpacing.MD }) {
        Row() {
          Blank()
          Text(this.total > 0 ? `全部 ${this.total} 项 ›` : '管理委托 ›').fontSize(12).fontColor(PMColors.BRAND).height(36)
            .onClick(() => { this.open(); }).accessibilityText('管理全部长期委托')
        }.width('100%')
        if (this.loading) { Text('正在读取委托状态…').fontSize(14).fontColor(PMColors.INK_SECONDARY) }
        else if (this.error !== '') {
          Text(this.error).fontSize(14).fontColor(PMColors.RISK)
          Button('重新读取委托').type(ButtonType.Normal).height(44).fontSize(13).fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
            .onClick(() => { this.probe(); })
        } else if (!this.available) {
          Text('委托入口当前未开启；项目资料和原有记录仍保留。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
        }
        if (!this.loading && this.available) {
          if (this.readState === 'lastKnown') { Text(`上次读取于 ${this.observedAt}；以下为历史摘要`).fontSize(12).fontColor(PMColors.RISK) }
          if (this.items.length === 0) {
            Text('交给忆程一个目标，步骤、草稿和审阅记录会保留。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
          }
          ForEach(this.groups(), (group: MissionGroupView) => {
            if (this.groupItems(group.statuses).length > 0) {
              Column({ space: 8 }) {
                Text(group.title + (this.groupCount(group.statuses) > this.groupItems(group.statuses).length
                  ? ` · ${this.groupCount(group.statuses)}` : '')).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
                ForEach(this.groupItems(group.statuses), (item: MissionWorkspaceItem) => {
                  this.MissionRow(item)
                }, (item: MissionWorkspaceItem) => item.id)
              }.width('100%').alignItems(HorizontalAlign.Start)
            }
          }, (group: MissionGroupView) => group.title)
          if (this.total === 0) { Text('还没有进行中的委托。').fontSize(13).fontColor(PMColors.INK_TERTIARY) }
        }
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
}
