import { ProjectAgentContextService } from '../services/ProjectAgentContextService';
import router from '@ohos.router';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';
import { MissionWorkspaceItem, MissionWorkspaceSummary } from '../models/Mission';
import { ApiError } from '../models/Project';
import { missionStatusLabel } from '../common/MissionContract';
import { PMColors, PMSpacing, PMRadius } from '../common/DesignTokens';
import { PMButton, PMStatusPill } from './PMReferencePrimitives';
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
  @State total: number = 0;
  @State items: MissionWorkspaceItem[] = [];
  private generation: number = 0;
  private disposed: boolean = false;
  private expired: () => void = () => {
    this.generation++; this.items = []; this.total = 0; this.available = false; this.loading = false; this.error = '请重新登录后查看委托';
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
      this.available = summary.enabled; this.total = summary.totalActive; this.items = summary.items;
      this.onSummary(summary);
    } catch (e) {
      if (this.disposed || generation !== this.generation || token !== SessionStore.getToken()) return;
      this.items = []; this.total = 0;
      this.onSummary({ enabled: false, totalActive: 0, items: [] });
      this.error = e instanceof ApiError && e.status === 404 ? '当前账号无权查看本项目的私有委托' : e instanceof ApiError ? e.message : '委托摘要暂未加载，请检查网络后重试';
    } finally { if (generation === this.generation && !this.disposed) this.loading = false; }
  }
  private refreshChanged(): void { if (!this.disposed && this.projectId !== '') this.probe(); }
  private open(id: string = ''): void {
    router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: id } });
  }
  private visibleItems(): MissionWorkspaceItem[] {
    const candidates = this.items.filter((item: MissionWorkspaceItem) => item.id !== this.excludedMissionId);
    const seen: string[] = [];
    return candidates.filter((item: MissionWorkspaceItem) => {
      if (item.status !== 'PAUSED' && item.status !== 'FAILED') return true;
      const key = `${item.status}|${item.attention ?? item.goal}`;
      if (seen.includes(key)) return false;
      seen.push(key);
      return true;
    }).slice(0, this.compact ? 2 : 3);
  }
  private sameFailureCount(item: MissionWorkspaceItem): number {
    if (item.status !== 'PAUSED' && item.status !== 'FAILED') return 1;
    return this.items.filter((other: MissionWorkspaceItem) => other.id !== this.excludedMissionId &&
      other.status === item.status && (other.attention ?? other.goal) === (item.attention ?? item.goal)).length;
  }
  build() {
    if (this.available || this.loading || this.error !== '' || !this.compact) {
      Column({ space: PMSpacing.MD }) {
        Row() {
          Text('长期委托').fontSize(16).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
          Text(this.total > 0 ? `全部 ${this.total} 项 ›` : '管理委托 ›').fontSize(12).fontColor(PMColors.BRAND).height(44)
            .onClick(() => { this.open(); }).accessibilityText('管理全部长期委托')
        }.width('100%')
        if (this.loading) { Text('正在读取委托状态…').fontSize(14).fontColor(PMColors.INK_SECONDARY) }
        else if (this.error !== '') {
          Text(this.error).fontSize(14).fontColor(PMColors.RISK)
          Button('重新读取委托').type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).height(44).fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
            .onClick(() => { this.probe(); })
        } else if (!this.available) {
          Text('委托入口当前未开启；项目资料和原有记录仍保留。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
        } else {
          if (this.items.length === 0) {
            Text('交给忆程一个目标，步骤、草稿和审阅记录会保留。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
          }
          ForEach(this.visibleItems(), (item: MissionWorkspaceItem) => {
            Column({ space: 11 }) {
              Row({ space: 8 }) {
                PMStatusPill({ label: missionStatusLabel(item.status), tone: item.status === 'FAILED' || item.status === 'PAUSED' ? 'risk' : 'brand' })
                if (this.sameFailureCount(item) > 1) { Text(`${this.sameFailureCount(item)} 条同类记录已合并`).fontSize(11).fontColor(PMColors.INK_TERTIARY) }
              }.width('100%')
              Text(item.goal).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                .fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).lineHeight(22)
              if (item.attention !== null) { Text(item.attention).fontSize(13).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).fontColor(PMColors.INK_SECONDARY).lineHeight(20) }
              if (item.activity !== null) {
                Column({ space: 4 }) {
                  Text('最近一次进展').fontSize(11).fontColor(PMColors.INK_TERTIARY)
                  Text(item.activity).fontSize(13).maxLines(2).fontColor(PMColors.INK_PRIMARY)
                }.width('100%').padding(12).alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(12)
              }
              Button('设为当前关注').height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT)
                .onClick(async () => {
                  try { await new ProjectAgentContextService().focus(this.projectId, item.id); this.error = ''; this.probe(); }
                  catch (e) { this.error = e instanceof ApiError ? e.message : '未能设置关注委托'; }
                })
              PMButton({ label: item.status === 'WAITING_INPUT' ? '补充信息 →' : item.status === 'WAITING_APPROVAL' ? '审阅行动提案 →' : '查看委托详情 →',
                secondary: true, onAction: (): void => { this.open(item.id); } })
            }.width('100%').alignItems(HorizontalAlign.Start).padding(16).backgroundColor(PMColors.SURFACE)
              .borderRadius(PMRadius.LG).border({ width: 1, color: PMColors.BORDER_SUBTLE })
          }, (item: MissionWorkspaceItem) => item.id)
          if (this.total === 0) { PMButton({ label: '委托一个目标 →', secondary: true, onAction: (): void => { this.open(); } }) }
        }
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
}
