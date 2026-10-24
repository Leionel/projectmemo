import { ConnectionView, SignalView } from '../models/RepoSignal';
import { ConnectionActionBody, ConnectionCreateBody, SignalActionBody } from '../models/RepoSignal';
import { RepoSignalService } from '../services/RepoSignalService';
import { PMColors, PMSpacing } from '../common/DesignTokens';

// P3-B 仓库信号候选：外部公开仓库只读信号；未采纳零事实写入，
// 采纳只产生资料记录与可选行动关联；commit 不构成现实完成证明。
@Component
export struct RepoSignalPanel {
  @Prop projectId: string = '';
  @Prop initialOpen: boolean = false;
  @State open: boolean = false;
  @State loaded: boolean = false;
  @State busy: boolean = false;
  @State error: string = '';
  @State note: string = '来自公开仓库的只读候选；未采纳不写入任何项目事实。';
  @State connections: ConnectionView[] = [];
  @State signals: SignalView[] = [];
  @State newRepo: string = '';
  @State newRef: string = 'main';
  private service: RepoSignalService = new RepoSignalService();

  aboutToAppear(): void {
    if (this.initialOpen) { this.open = true; this.load(); }
  }

  private statusLabel(status: string): string {
    if (status === 'CANDIDATE') { return '候选'; }
    if (status === 'ADOPTED') { return '已采纳'; }
    if (status === 'DISMISSED') { return '已忽略'; }
    return status;
  }
  private fetchLabel(status: string | null): string {
    if (status === null) { return '未刷新'; }
    if (status === 'OK') { return '已刷新'; }
    if (status === 'PARTIAL') { return '尚有提交待同步'; }
    if (status === 'NOT_MODIFIED') { return '无新提交'; }
    if (status === 'RATE_LIMITED') { return '被限流'; }
    if (status === 'FORBIDDEN') { return '被拒绝'; }
    if (status === 'NOT_FOUND') { return '仓库或分支不存在'; }
    if (status === 'ERROR') { return '出错'; }
    return status;
  }

  private async load(): Promise<void> {
    this.busy = true;
    try {
      const reply = await this.service.list(this.projectId);
      this.note = reply.note;
      this.connections = reply.connections;
      this.signals = reply.signals;
      this.loaded = true;
      this.error = '';
    } catch (e) {
      this.error = e instanceof Error ? e.message : '信号列表暂不可用';
    } finally {
      this.busy = false;
    }
  }

  private async toggle(): Promise<void> {
    this.open = !this.open;
    if (this.open && !this.loaded) { await this.load(); }
  }

  private async refresh(connectionId: string): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    try {
      const body: ConnectionActionBody = new ConnectionActionBody();
      body.action = 'REFRESH';
      body.requestId = `rs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await this.service.refresh(this.projectId, connectionId, body);
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : '刷新失败';
    } finally {
      this.busy = false;
    }
  }

  private async create(): Promise<void> {
    if (this.busy || this.newRepo === '') { return; }
    this.busy = true;
    try {
      const body: ConnectionCreateBody = new ConnectionCreateBody();
      body.repo = this.newRepo;
      body.ref = this.newRef === '' ? 'main' : this.newRef;
      body.requestId = `rs-create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await this.service.create(this.projectId, body);
      this.newRepo = '';
      this.newRef = 'main';
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : '创建连接失败';
    } finally {
      this.busy = false;
    }
  }

  private async adopt(signalId: string): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    try {
      const body: SignalActionBody = new SignalActionBody();
      body.action = 'ADOPT';
      body.requestId = `rs-adopt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await this.service.act(this.projectId, signalId, body);
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : '采纳失败';
    } finally {
      this.busy = false;
    }
  }

  private async dismiss(signalId: string): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    try {
      const body: SignalActionBody = new SignalActionBody();
      body.action = 'DISMISS';
      body.requestId = `rs-dismiss-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await this.service.act(this.projectId, signalId, body);
      await this.load();
    } catch (e) {
      this.error = e instanceof Error ? e.message : '操作失败';
    } finally {
      this.busy = false;
    }
  }

  build() {
    Column({ space: 8 }) {
      Button(this.open ? '收起 GitHub 仓库' : `GitHub 仓库 · ${this.loaded ? `${this.connections.filter((c: ConnectionView) => c.status === 'ACTIVE').length} 个连接` : '连接与提交记录'}`)
        .fontSize(14).constraintSize({ minHeight: 44 }).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND)
        .onClick(() => { this.toggle(); })
      if (this.open) {
        Text(this.note).fontSize(11).fontColor(PMColors.INK_TERTIARY)
        if (this.error !== '') { Text(this.error).fontSize(12).fontColor(PMColors.RISK) }
        ForEach(this.connections, (c: ConnectionView) => {
          Column({ space: 4 }) {
            Row({ space: 6 }) {
              Text(`${c.repo}@${c.ref}`).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
              Text(c.status === 'ACTIVE' ? '活跃' : '已撤销').fontSize(11).fontColor(PMColors.INK_SECONDARY)
              Text(this.fetchLabel(c.lastStatus)).fontSize(11).fontColor(PMColors.INK_TERTIARY)
            }.width('100%')
            Text(`候选 ${c.candidateCount} · 已采纳 ${c.adoptedCount}${c.lastError !== null && c.lastError !== '' ? ` · ${c.lastError}` : ''}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
            if (c.status === 'ACTIVE') {
              Row({ space: 8 }) {
                Button('刷新').fontSize(12).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.refresh(c.id); })
              }
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(10).borderRadius(10)
            .backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER_SUBTLE })
        }, (c: ConnectionView) => c.id)
        if (this.connections.filter((c: ConnectionView) => c.status !== 'REVOKED').length < 3) {
          Column({ space: 4 }) {
            TextInput({ placeholder: 'owner/repo', text: this.newRepo }).fontSize(12).onChange((v: string) => { this.newRepo = v; })
            TextInput({ placeholder: '分支或 ref', text: this.newRef }).fontSize(12).onChange((v: string) => { this.newRef = v; })
            Button('创建并首次刷新').fontSize(12).backgroundColor(PMColors.BRAND).fontColor(PMColors.SURFACE).enabled(!this.busy && this.newRepo !== '').onClick(() => { this.create(); })
          }.width('100%').alignItems(HorizontalAlign.Start)
        }
        ForEach(this.signals, (s: SignalView) => {
          Column({ space: 4 }) {
            Row({ space: 6 }) {
              Text(s.title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
              Text(this.statusLabel(s.status)).fontSize(11).fontColor(PMColors.INK_SECONDARY)
            }.width('100%')
            Text(`${s.sha.substring(0, 10)} · ${s.authorName}${s.status === 'ADOPTED' && s.adoptedCaptureId !== null ? ' · 已写入资料记录' : ''}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
            if (s.status === 'CANDIDATE') {
              Row({ space: 8 }) {
                Button('采纳为项目资料').fontSize(12).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).enabled(!this.busy).onClick(() => { this.adopt(s.id); })
                Button('忽略').fontSize(12).backgroundColor(PMColors.SURFACE).fontColor(PMColors.INK_SECONDARY).enabled(!this.busy).onClick(() => { this.dismiss(s.id); })
              }
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(10).borderRadius(10)
            .backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER_SUBTLE })
        }, (s: SignalView) => s.id)
        if (this.loaded && this.signals.length === 0) { Text('还没有信号；创建连接或点刷新拉取。').fontSize(12).fontColor(PMColors.INK_TERTIARY) }
        Text('提交/CI 状态只是资料线索，不等于现实完成；行动完成仍以你填写的回执为准。').fontSize(11).fontColor(PMColors.INK_TERTIARY)
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
      .backgroundColor(PMColors.SURFACE).borderRadius(12).border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }
}
