import { alertError } from '../common/ErrorAlert';
import router from '@ohos.router';
import { RepoCiGrant } from '../models/RepoSignal';
import { ConversationService } from '../services/ConversationService';
import { ConversationCreateInput } from '../models/Conversation';
import { ConnectionView, SignalView } from '../models/RepoSignal';
import { ConnectionActionBody, ConnectionCreateBody, SignalActionBody } from '../models/RepoSignal';
import { RepoSignalService } from '../services/RepoSignalService';
import { PMColors, PMFontSize, PMRadius, PMSpacing, PMInteraction } from '../common/DesignTokens';

// P3-B 仓库信号候选：外部公开仓库只读信号；未采纳零事实写入，
// 采纳只产生资料记录与可选行动关联；commit 不构成现实完成证明。
@Component
export struct RepoSignalPanel {
  @Prop projectId: string = '';
  @Prop initialOpen: boolean = false;
  @State open: boolean = false;
  @State loaded: boolean = false;
  @State ciAvailable: boolean = false;
  @State busy: boolean = false;
  @State @Watch('alertError') error: string = '';
  private alertError(): void { alertError(this.error); }
  @State note: string = '来自公开仓库的只读候选；未采纳不写入任何项目事实。';
  @State connections: ConnectionView[] = [];
  @State signals: SignalView[] = [];
  @State newRepo: string = '';
  @State newRef: string = 'main';
  @State showCreate: boolean = false;
  @State showNotes: boolean = false;
  private service: RepoSignalService = new RepoSignalService();

  private async discuss(connectionId: string): Promise<void> {
    const input = new ConversationCreateInput(); input.requestId = 'repo-discuss-' + Date.now().toString(); input.scope = 'PROJECT'; input.projectId = this.projectId; input.entry = { kind: 'SOURCE_OBSERVATION', projectId: this.projectId, id: connectionId };
    try { const created = await new ConversationService().entry(input); router.pushUrl({ url: 'pages/FocusConversation', params: { conversationId: created.id, projectId: this.projectId } }); } catch { this.error = '仓库观察已不可访问，请刷新原连接'; }
  }

  aboutToAppear(): void {
    this.open = this.initialOpen;
    this.load();
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

  private activeConnections(): ConnectionView[] {
    return this.connections.filter((c: ConnectionView) => c.status === 'ACTIVE');
  }

  private connectionSignals(connectionId: string): SignalView[] {
    return this.signals.filter((s: SignalView) => s.connectionId === connectionId);
  }

  /** 最近观察时间只用于说明"这条线索何时读取"，不当作现实进度。 */
  private observedLabel(c: ConnectionView): string {
    if (c.lastFetchedAt === null || c.lastFetchedAt === '') { return '尚未观察'; }
    return c.lastFetchedAt.length >= 16 ? c.lastFetchedAt.substring(0, 16).replace('T', ' ') : c.lastFetchedAt;
  }

  private async load(): Promise<void> {
    this.busy = true;
    try {
      const reply = await this.service.list(this.projectId);
      this.note = reply.note;
      this.ciAvailable = reply.ciAvailable === true;
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
      this.showCreate = false;
      this.open = true;
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

  private async setCi(c: ConnectionView, access: string): Promise<void> {
    if (this.busy) return; this.busy = true;
    const body = new RepoCiGrant(); body.requestId = 'ci-' + Date.now().toString(); body.expectedRevision = c.revision || 0; body.access = access;
    try { await this.service.ciGrant(this.projectId, c.id, body); await this.load(); } catch { this.error = 'CI 授权未保存，请刷新原连接'; } finally { this.busy = false; }
  }

  @Builder
  private compactAction(label: string, enabled: boolean, action: () => void) {
    Text(label)
      .fontSize(PMFontSize.CAPTION)
      .fontWeight(FontWeight.Medium)
      .fontColor(enabled ? PMColors.BRAND : PMColors.INK_MUTED)
      .constraintSize({ minHeight: 32 })
      .padding({ left: 2, right: PMSpacing.MD })
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        if (enabled) { action(); }
      })
  }

  build() {
    Column({ space: PMSpacing.SM }) {
      // 层 3 工具卡：先回答"连没连"，再按需展开细节；连接表单按需展开，技术说明默认收起。
      Row({ space: PMSpacing.SM }) {
        Text('GitHub 仓库')
          .fontSize(PMFontSize.MD)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .layoutWeight(1)
        Text(this.activeConnections().length > 0 ? `${this.activeConnections().length} 个连接` : (this.loaded ? '未连接' : '读取中…'))
          .fontSize(11)
          .fontColor(PMColors.INK_TERTIARY)
        if (this.activeConnections().length > 0) {
          Text(this.open ? '收起' : '详情 ›')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.BRAND)
            .constraintSize({ minHeight: 32 })
            .padding({ left: PMSpacing.SM })
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .accessibilityText(this.open ? '收起仓库详情' : '展开仓库详情与候选提交')
            .onClick(() => { void this.toggle(); })
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.error !== '') {
        Text(this.error)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.RISK)
      }

      if (!this.loaded && this.busy) {
        Text('正在读取仓库连接…')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_TERTIARY)
      } else if (this.activeConnections().length === 0) {
        Text('尚未连接 GitHub 仓库；连接后可把公开提交、CI 状态作为资料线索，采纳前不写入任何项目事实。')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_TERTIARY)
          .lineHeight(19)
        if (!this.showCreate) {
          Button('连接 GitHub 仓库', { type: ButtonType.Normal })
            .height(36)
            .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)
            .backgroundColor(PMColors.BRAND_LIGHT)
            .borderRadius(PMRadius.SM)
            .clickEffect(PMInteraction.PRESS_EFFECT)
            .accessibilityText('连接一个公开 GitHub 仓库')
            .onClick(() => {
              if (!this.busy) { this.showCreate = true; }
            })
        }
      }

      // 新连接表单：按需展开，字段带明确标签，避免只看 placeholder 猜格式。
      if (this.showCreate && this.activeConnections().length < 3) {
        Column({ space: PMSpacing.SM }) {
          Text('仓库（owner/repo）')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          TextInput({ text: this.newRepo, placeholder: '例如 octocat/Hello-World' })
            .fontSize(PMFontSize.SECONDARY)
            .height(40)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.BORDER })
            .onChange((value: string) => { this.newRepo = value; })
          Text('分支或 ref')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          TextInput({ text: this.newRef, placeholder: 'main' })
            .fontSize(PMFontSize.SECONDARY)
            .height(40)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.SM)
            .border({ width: 1, color: PMColors.BORDER })
            .onChange((value: string) => { this.newRef = value; })
          Row({ space: PMSpacing.LG }) {
            Text('取消')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .constraintSize({ minHeight: 36 })
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .onClick(() => {
                if (!this.busy) { this.showCreate = false; this.newRepo = ''; this.newRef = 'main'; }
              })
            Button(this.busy ? '创建中…' : '创建并首次刷新', { type: ButtonType.Normal })
              .height(36)
              .padding({ left: PMSpacing.MD, right: PMSpacing.MD })
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(PMColors.BRAND)
              .borderRadius(PMRadius.SM)
              .enabled(!this.busy && this.newRepo !== '')
              .onClick(() => { void this.create(); })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)
        }
        .width('100%')
        .padding(PMSpacing.MD)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .alignItems(HorizontalAlign.Start)
      }

      ForEach(this.activeConnections(), (c: ConnectionView) => {
        Column({ space: 6 }) {
          Row({ space: 6 }) {
            Text(c.repo)
              .fontSize(PMFontSize.SECONDARY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(c.ref)
              .fontSize(11)
              .fontColor(PMColors.INK_TERTIARY)
          }
          .width('100%')

          Text(`${this.fetchLabel(c.lastStatus)} · 最近观察 ${this.observedLabel(c)} · 候选 ${c.candidateCount} · 已采纳 ${c.adoptedCount}`)
            .fontSize(11)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(17)
          if (c.lastError !== null && c.lastError !== '') {
            Text(c.lastError)
              .fontSize(11)
              .fontColor(PMColors.RISK)
          }

          Row({ space: 0 }) {
            this.compactAction(this.busy ? '刷新中…' : '刷新', !this.busy, (): void => { void this.refresh(c.id); })
            this.compactAction('在忆程中讨论', !this.busy, (): void => { void this.discuss(c.id); })
          }
          .width('100%')

          // CI 读取授权：只在展开时出现，措辞与"只读"语义一致，可随时停止。
          if (this.open && this.ciAvailable) {
            Row({ space: 0 }) {
              this.compactAction(c.access === 'COMMITS' ? '允许读取 CI 状态' : '停止 CI 读取', !this.busy,
                (): void => { void this.setCi(c, c.access === 'COMMITS' ? 'COMMITS_AND_CI' : 'COMMITS'); })
              if (c.access !== 'COMMITS') {
                this.compactAction(c.access === 'COMMITS_CI_LOGS' ? '停止日志读取' : '允许读取脱敏失败日志', !this.busy,
                  (): void => { void this.setCi(c, c.access === 'COMMITS_CI_LOGS' ? 'COMMITS_AND_CI' : 'COMMITS_CI_LOGS'); })
              }
            }
            .width('100%')
          }

          if (this.open) {
            if (this.connectionSignals(c.id).length === 0) {
              Text('还没有候选提交；点刷新拉取最近的公开提交。')
                .fontSize(11)
                .fontColor(PMColors.INK_TERTIARY)
                .margin({ top: PMSpacing.XS })
            }
            ForEach(this.connectionSignals(c.id), (s: SignalView) => {
              Column({ space: 3 }) {
                Row({ space: 6 }) {
                  Text(s.title)
                    .fontSize(PMFontSize.SECONDARY)
                    .fontColor(PMColors.INK_PRIMARY)
                    .layoutWeight(1)
                    .maxLines(2)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(this.statusLabel(s.status))
                    .fontSize(11)
                    .fontColor(s.status === 'ADOPTED' ? PMColors.SUCCESS : PMColors.INK_TERTIARY)
                }
                .width('100%')
                Text(`${s.sha.substring(0, 10)} · ${s.authorName}`)
                  .fontSize(11)
                  .fontColor(PMColors.INK_TERTIARY)
                if (s.status === 'CANDIDATE') {
                  Row({ space: 0 }) {
                    this.compactAction('采纳为项目资料', !this.busy && s.canAdopt !== false, (): void => { void this.adopt(s.id); })
                    this.compactAction('忽略', !this.busy, (): void => { void this.dismiss(s.id); })
                  }
                  .width('100%')
                  if (s.canAdopt === false && s.adoptionUnavailableReason) {
                    Text(s.adoptionUnavailableReason ?? '')
                      .fontSize(11)
                      .fontColor(PMColors.INK_TERTIARY)
                  }
                } else if (s.status === 'ADOPTED' && s.adoptedCaptureId !== null) {
                  Text('已写入资料记录，可在记忆里查看来源。')
                    .fontSize(11)
                    .fontColor(PMColors.SUCCESS)
                }
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ top: PMSpacing.SM })
              .border({ width: { top: 1 }, color: PMColors.BORDER_SUBTLE })
            })
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ top: PMSpacing.SM })
        .border({ width: { top: 1 }, color: PMColors.BORDER_SUBTLE })
      })

      if (this.activeConnections().length > 0 && this.activeConnections().length < 3 && !this.showCreate) {
        Text('再连接一个公开仓库')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.BRAND)
          .constraintSize({ minHeight: 32 })
          .clickEffect(PMInteraction.PRESS_EFFECT)
          .onClick(() => {
            if (!this.busy) { this.showCreate = true; }
          })
      }

      // 技术说明默认收起，避免每屏都占一条长文案。
      Text(this.showNotes ? '收起说明' : '说明 ›')
        .fontSize(11)
        .fontColor(PMColors.INK_TERTIARY)
        .constraintSize({ minHeight: 32 })
        .clickEffect(PMInteraction.PRESS_EFFECT)
        .accessibilityText(this.showNotes ? '收起仓库说明' : '查看仓库说明与限制')
        .onClick(() => { this.showNotes = !this.showNotes; })
      if (this.showNotes) {
        Column({ space: 2 }) {
          Text(this.note)
            .fontSize(11)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(17)
          Text('提交/CI 状态只是资料线索，不等于现实完成；行动完成仍以你填写的回执为准。')
            .fontSize(11)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(17)
          Text('只读取公开仓库，不携带凭据；采纳会生成资料记录，可随时忽略后续候选。')
            .fontSize(11)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(17)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .alignItems(HorizontalAlign.Start)
  }
}
