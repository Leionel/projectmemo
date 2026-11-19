import router from '@ohos.router';
import { PMButton } from './PMReferencePrimitives';
import { PMColors, PMRadius, PMSpacing } from '../common/DesignTokens';
import { ApiError } from '../models/Project';
import { DelegationConfirmation, DelegationInput, DelegationLimits, ProjectReturnItem, workbenchTime } from '../models/MissionWorkbench';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';

@Component
export struct ProjectHandoff {
  @Prop projectId: string = '';
  @Prop @Watch('reload') refreshEpoch: number = 0;
  @State private item: ProjectReturnItem | null = null;
  @State private limits: DelegationLimits | undefined = undefined;
  @State private showingForm: boolean = false;
  @State private goal: string = '';
  @State private material: string = '';
  @State private error: string = '';
  @State private busy: boolean = false;
  @State private locked: boolean = false;
  private service: MissionService = new MissionService();
  private pending: DelegationConfirmation | null = null;
  private generation: number = 0;
  private mounted: boolean = false;

  aboutToAppear(): void { this.mounted = true; this.reload(); }
  aboutToDisappear(): void { this.mounted = false; this.generation++; }

  private async reload(): Promise<void> {
    if (!this.projectId || !SessionStore.isTokenValid()) return;
    const generation = ++this.generation, token = SessionStore.getToken();
    try {
      const view = await this.service.projectDelegation(this.projectId);
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      this.item = view.enabled ? view.items[0] ?? null : null;
      this.limits = view.canStart ? view.limits : undefined;
    } catch (_error) {
      if (generation !== this.generation) return;
      this.item = null; this.limits = undefined;
    }
  }

  private open(item: ProjectReturnItem): void {
    if (item.questionId) {
      router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.id, questionId: item.questionId } });
    } else if (item.output) {
      router.pushUrl({ url: 'pages/OutcomeWorkbench', params: { projectId: this.projectId, missionId: item.id,
        revision: String(item.output.revision), baseline: String(item.baseline ?? 0), entry: 'review' } });
    }
  }

  private async start(): Promise<void> {
    if (this.busy || !this.limits || this.goal.trim().length < 3) return;
    if (this.pending === null) {
      const body = new DelegationConfirmation();
      body.goal = this.goal.trim();
      body.materialText = this.material.trim();
      body.requestId = 'harmony-v2-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      this.pending = body;
    }
    const body = this.pending, projectId = this.projectId, token = SessionStore.getToken();
    this.busy = true; this.locked = true; this.error = '';
    try {
      if (!body.previewHash) {
        const input = new DelegationInput();
        input.goal = body.goal; input.materialText = body.materialText;
        const preview = await this.service.previewDelegation(projectId, input);
        if (!this.mounted || token !== SessionStore.getToken() || this.projectId !== projectId) return;
        body.previewHash = preview.previewHash; body.expiresAt = preview.expiresAt;
      }
      const result = await this.service.confirmDelegation(projectId, body);
      if (!this.mounted || token !== SessionStore.getToken() || this.projectId !== projectId || result.projectId !== projectId) return;
      this.pending = null; this.locked = false; this.showingForm = false; this.goal = ''; this.material = '';
      router.pushUrl({ url: 'pages/OutcomeWorkbench', params: { projectId, missionId: result.missionId } });
    } catch (error) {
      if (!this.mounted || token !== SessionStore.getToken() || this.projectId !== projectId) return;
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        this.pending = null; this.locked = false; this.error = error.message;
      } else this.error = '开始结果尚未确认。可以重试同一个托付请求。';
    } finally { this.busy = false; }
  }

  @Builder private Latest(item: ProjectReturnItem) {
    Column({ space: 8 }) {
      Row({ space: 10 }) {
        Image($r('app.media.bookmark_spirit_avatar')).width(38).height(38).objectFit(ImageFit.Contain)
        Column({ space: 3 }) {
          Text(item.questionId ? '有一个问题需要你判断' : `第 ${item.output?.revision} 版已备好`)
            .fontSize(18).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          Text(item.goal).fontSize(13).fontColor(PMColors.INK_SECONDARY)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%')
      if (!item.questionId && item.output) {
        Text(workbenchTime(item.output.recordedAt)).fontSize(12).fontColor(PMColors.INK_SECONDARY)
      }
      PMButton({ label: item.questionId ? '回答原问题' : item.baseline ? '看改了什么' : '打开成果',
        onAction: (): void => { this.open(item); } })
    }.width('100%').padding(PMSpacing.MD).alignItems(HorizontalAlign.Start)
      .backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.MD)
  }

  build() {
    if (this.item !== null || this.limits !== undefined) {
      Column({ space: 10 }) {
        if (this.item !== null) this.Latest(this.item)
        if (this.limits !== undefined) {
          if (this.showingForm) {
            Text('这次要完成什么').fontSize(16).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
            TextInput({ text: this.goal, placeholder: '例如：根据测试记录更新发布说明' }).maxLength(300)
              .enabled(!this.locked).onChange((value: string) => { this.goal = value; }).accessibilityText('跟进目标')
            TextArea({ text: this.material, placeholder: '补充资料（可选）' }).maxLength(20000).height(84)
              .enabled(!this.locked).onChange((value: string) => { this.material = value; }).accessibilityText('补充资料')
            Text(`使用当前项目获准资料，由模型生成私有稿。跟进 ${this.limits.days} 天，最多 ${this.limits.maxModels} 次模型和 ${this.limits.maxTools} 次工具调用，可随时暂停。`)
              .fontSize(13).fontColor(PMColors.INK_SECONDARY)
            if (this.error) Text(this.error).fontSize(13).fontColor(PMColors.RISK)
            PMButton({ label: this.busy ? '正在开始跟进…' : this.locked ? '重试原托付' : '交给忆程跟进',
              disabled: this.busy || this.goal.trim().length < 3, onAction: (): void => { this.start(); } })
          } else {
            PMButton({ label: '交给忆程持续跟进', secondary: true, onAction: (): void => { this.showingForm = true; } })
          }
        }
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
}
