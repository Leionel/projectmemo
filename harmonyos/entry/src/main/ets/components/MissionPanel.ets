import router from '@ohos.router';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';
import { MissionWorkspaceItem, MissionWorkspaceSummary } from '../models/Mission';
import { ApiError } from '../models/Project';
import { missionStatusLabel } from '../common/MissionContract';
import { PMColors, PMSpacing, PMRadius } from '../common/DesignTokens';
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
  build() {
    if (this.available || this.loading || this.error !== '' || !this.compact) {
      Column({ space: PMSpacing.SM }) {
        Text('长期委托').fontSize(18).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
        if (this.loading) { Text('正在读取委托状态…').fontSize(14).fontColor(PMColors.INK_SECONDARY) }
        else if (this.error !== '') {
          Text(this.error).fontSize(14).fontColor(PMColors.RISK)
          Button('重新读取委托').onClick(() => { this.probe(); })
        } else if (!this.available) {
          Text('委托入口当前未开启；项目资料和原有记录仍保留。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
        } else {
          if (this.items.length === 0) {
            Text('交给忆程一个目标，步骤、草稿和审阅记录会保留。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
          }
          ForEach(this.items.filter((item: MissionWorkspaceItem) => item.id !== this.excludedMissionId).slice(0, this.compact ? 2 : 3), (item: MissionWorkspaceItem) => {
            Column({ space: PMSpacing.XS }) {
              Text(missionStatusLabel(item.status)).fontSize(13).fontColor(PMColors.BRAND)
              Text(item.attention ?? item.goal).maxLines(3).textOverflow({ overflow: TextOverflow.Ellipsis }).fontSize(16).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
              if (item.attention !== null) { Text(item.goal).fontSize(13).maxLines(2).fontColor(PMColors.INK_SECONDARY) }
              if (item.activity !== null) { Text(item.activity).fontSize(13).fontColor(PMColors.INK_SECONDARY) }
              Button(item.status === 'WAITING_INPUT' ? '补充信息' : item.status === 'WAITING_APPROVAL' ? '审阅行动提案' : '查看原委托')
                .constraintSize({ minHeight: 48 }).backgroundColor(this.compact ? PMColors.BRAND_LIGHT : PMColors.BRAND)
                .fontColor(this.compact ? PMColors.BRAND : PMColors.SURFACE).onClick(() => { this.open(item.id); })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }, (item: MissionWorkspaceItem) => item.id)
          Button(this.total > 0 ? `查看全部 ${this.total} 项未结束委托` : '委托一个目标')
            .backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).onClick(() => { this.open(); })
        }
      }.padding(PMSpacing.MD).width('100%').alignItems(HorizontalAlign.Start)
        .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER })
    }
  }
}
