import { PMButton } from './PMReferencePrimitives';
import { PMColors, PMRadius } from '../common/DesignTokens';
import { ApiError } from '../models/Project';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';
import { WorkbenchSprintView, WorkbenchSprintCommand, WorkbenchSource, SprintReceipt, workbenchTime } from '../models/MissionWorkbench';

@Component
export struct WorkbenchSprint {
  @Prop missionId: string = '';
  @Prop sources: WorkbenchSource[] = [];
  openRevision: (revision: number) => void = (_revision: number): void => {};
  openSource: (key: string) => void = (_key: string): void => {};
  @State private view: WorkbenchSprintView | null = null;
  @State private objective: string = '';
  @State private busy: boolean = false;
  @State private uncertain: boolean = false;
  @State private error: string = '';
  private service: MissionService = new MissionService();
  private pending: WorkbenchSprintCommand | null = null;
  private timer: number = -1;
  private active: boolean = false;

  aboutToAppear(): void {
    this.active = true;
    this.reload();
    this.timer = setInterval(() => { this.reload(); }, 5000);
  }
  aboutToDisappear(): void {
    this.active = false;
    clearInterval(this.timer);
  }

  private async reload(): Promise<void> {
    if (this.busy || !SessionStore.isTokenValid()) return;
    const token = SessionStore.getToken();
    try {
      const value = await this.service.workbenchSprint(this.missionId);
      if (this.active && !this.busy && token === SessionStore.getToken()) this.view = value;
    } catch (error) {
      if (!this.active || token !== SessionStore.getToken()) return;
      this.view = null;
      this.error = error instanceof ApiError ? error.message : '暂时读不到冲刺进展。';
    }
  }

  private async send(action: string, sourceKey: string = ''): Promise<void> {
    if (this.busy) return;
    if (this.pending === null) {
      const body = new WorkbenchSprintCommand();
      body.action = action;
      body.requestId = 'harmony-sprint-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      if (action === 'START') { body.objective = this.objective.trim(); body.minutes = 15; }
      else {
        if (!this.view?.session) return;
        body.sprintId = this.view.session.id;
        if (action === 'SELF_REPORT') body.done = true;
        if (action === 'OPEN_SOURCE') body.sourceKey = sourceKey;
      }
      this.pending = body;
    }
    const sent = this.pending, token = SessionStore.getToken();
    this.busy = true; this.error = '';
    try {
      const updated = await this.service.commandSprint(this.missionId, sent);
      if (!this.active || token !== SessionStore.getToken()) return;
      this.view = updated;
      if (sent.action === 'OPEN_SOURCE' && sent.sourceKey) this.openSource(sent.sourceKey);
      this.pending = null; this.uncertain = false;
    } catch (error) {
      if (!this.active || token !== SessionStore.getToken()) return;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        this.pending = null; this.uncertain = false; this.error = error.message;
      } else {
        this.uncertain = true; this.error = '结果尚未确认，可以重试原请求。';
      }
    } finally { this.busy = false; }
  }

  build() {
    Column({ space: 8 }) {
      Text('双人冲刺').fontSize(18).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
      if (this.error) Text(this.error).fontColor(PMColors.RISK).fontSize(13)
      if (this.uncertain) {
        PMButton({ label: '重试原冲刺请求', disabled: this.busy, onAction: (): void => { this.send(''); } })
      }
      if (this.view?.session) {
        Text(this.view.session.objective).fontSize(16).fontColor(PMColors.INK_PRIMARY)
        Text(this.view.session.status === 'ACTIVE' ? '进行中 · ' + workbenchTime(this.view.session.endsAt) + ' 结束' : '本轮已结束')
          .fontSize(13).fontColor(PMColors.INK_SECONDARY)
        Text(this.view.session.agent.label).fontSize(14).fontColor(PMColors.INK_PRIMARY)
        ForEach(this.view.session.agent.receipts, (receipt: SprintReceipt) => {
          Text(receipt.label + ' · ' + workbenchTime(receipt.at)).fontSize(13).fontColor(PMColors.INK_SECONDARY)
        }, (receipt: SprintReceipt) => receipt.id)
        ForEach(this.view.session.agent.openItems, (item: string) => { Text(item).fontSize(13).fontColor(PMColors.INK_SECONDARY) })
        if (this.view.session.agent.latestNewRevision !== null) {
          PMButton({ label: '打开本轮新稿', secondary: true, onAction: (): void => {
            const revision = this.view?.session?.agent.latestNewRevision;
            if (revision !== null && revision !== undefined) this.openRevision(revision);
          } })
        }
        if (this.view.session.status === 'ACTIVE') {
          ForEach(this.sources.slice(0, 5), (source: WorkbenchSource) => {
            PMButton({ label: '核对 · ' + (source.name ?? '原始资料'), secondary: true,
              disabled: this.busy || this.uncertain, onAction: (): void => { this.send('OPEN_SOURCE', source.key); } })
          }, (source: WorkbenchSource) => source.key)
          PMButton({ label: this.view.session.selfReportedDone ? '已记录本轮核对' : '记录我已核对', secondary: true,
            disabled: this.busy || this.uncertain || this.view.session.selfReportedDone, onAction: (): void => { this.send('SELF_REPORT'); } })
          PMButton({ label: '结束本轮冲刺', secondary: true, disabled: this.busy || this.uncertain, onAction: (): void => { this.send('END'); } })
        }
      }
      if (this.view?.canStart && this.view.session?.status !== 'ACTIVE') {
        TextInput({ text: this.objective, placeholder: '写下你这轮要做什么' }).maxLength(300).enabled(!this.busy && !this.uncertain)
          .onChange((value: string) => { this.objective = value; })
        PMButton({ label: '开始 15 分钟冲刺', disabled: this.busy || this.uncertain || !this.objective.trim(),
          onAction: (): void => { this.send('START'); } })
      } else if (this.view !== null && this.view.session === null) {
        Text(this.view.reason).fontSize(13).fontColor(PMColors.INK_SECONDARY)
      }
    }.width('100%').padding(12).alignItems(HorizontalAlign.Start)
      .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.MD)
  }
}
