import router from '@ohos.router';
import { CopilotContinuationSuggestion, CopilotMissionPreview, CopilotMissionPreviewInput, CopilotMissionConfirmInput } from '../models/Copilot';
import { CopilotService } from '../services/CopilotService';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { PMColors, PMFontSize, PMRadius } from '../common/DesignTokens';
@Component
export struct CopilotContinuationCard {
  @Prop suggestion: CopilotContinuationSuggestion = new CopilotContinuationSuggestion();
  @State goal: string = '';
  @State cloud: boolean = false;
  @State editing: boolean = false;
  @State preview: CopilotMissionPreview | null = null;
  @State receiptId: string = '';
  @State busy: boolean = false;
  @State error: string = '';
  private generation: number = 0;
  private requestId: string = '';
  aboutToAppear(): void { this.goal = this.suggestion.goal; }
  aboutToDisappear(): void { this.generation++; }
  private open(id: string): void {
    const m = this.suggestion.mission;
    router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.suggestion.projectId, missionId: id,
      questionId: m?.questionId ?? '', approvalId: m?.approvalId ?? '', outputId: m?.outputId ?? '', revision: m?.outputRevision?.toString() ?? '' } });
  }
  private async submit(confirm: boolean): Promise<void> {
    if (this.busy) return;
    const generation = this.generation; const token = SessionStore.getToken();
    this.busy = true; this.error = '';
    try {
      const service = new CopilotService();
      if (confirm && this.preview !== null) {
        const body = new CopilotMissionConfirmInput(); body.sourceRunId = this.suggestion.sourceRunId; body.previewHash = this.preview.previewHash; body.requestId = this.requestId;
        const result = await service.confirmMission(this.suggestion.projectId, body);
        if (generation !== this.generation || token !== SessionStore.getToken()) return;
        this.receiptId = result.receipt.missionId;
      } else {
        const body = new CopilotMissionPreviewInput(); body.sourceRunId = this.suggestion.sourceRunId; body.goal = this.goal; body.llmContextApproved = this.cloud;
        const result = await service.previewMission(this.suggestion.projectId, body);
        if (generation !== this.generation || token !== SessionStore.getToken()) return;
        this.preview = result.preview; this.requestId = `harmony-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
    } catch (e) {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      this.error = e instanceof ApiError ? e.message : '结果尚未确认，请使用同一预览重试';
      if (e instanceof ApiError && [401, 403, 404].includes(e.status)) { this.preview = null; this.goal = ''; this.editing = false; }
    } finally { if (generation === this.generation) this.busy = false; }
  }
  build() {
    if (this.suggestion.kind !== 'ANSWER_ONLY') {
      Column({ space: 10 }) {
        Text(this.suggestion.reason).fontSize(13).fontColor(PMColors.INK_SECONDARY)
        if (this.receiptId !== '') { Button('查看已受理的原委托 →').onClick(() => this.open(this.receiptId)).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 }) }
        else if (this.suggestion.kind === 'OPEN_MISSION') { Button('继续此委托 →').onClick(() => this.open(this.suggestion.mission?.id ?? '')).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 }) }
        else if (!this.editing) { Button('交给长期委托').onClick(() => { this.editing = true; }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 }) }
        else {
          Text('委托目标').fontSize(14).fontWeight(FontWeight.Medium)
          TextArea({ text: this.goal, placeholder: '想推进什么' }).height(100).maxLength(2000).enabled(!this.busy).onChange((v: string) => { this.goal = v; this.preview = null; })
          Row({ space: 8 }) {
            Toggle({ type: ToggleType.Switch, isOn: this.cloud }).selectedColor(PMColors.BRAND).enabled(!this.busy).onChange((v: boolean) => { this.cloud = v; this.preview = null; })
            Text('允许云模型处理本委托所需资料（受账户配额限制）').fontSize(12).layoutWeight(1)
          }
          Text('只读取、分析和保存草稿；不联网研究，不创建或修改行动。资料不足时等待补充。').fontSize(12).fontColor(PMColors.INK_SECONDARY)
          if (this.preview !== null) { Text('将创建 1 项委托；验收条件为保存草稿，内容仍需审阅。').fontSize(12) }
          Button(this.preview === null ? '预览委托' : '确认创建委托').enabled(!this.busy && this.goal.trim().length >= 3).onClick(() => { this.submit(this.preview !== null); }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.SURFACE).backgroundColor(PMColors.BRAND).constraintSize({ minHeight: 44 })
          Button('暂不创建').enabled(!this.busy).onClick(() => { this.editing = false; this.preview = null; }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
        }
        if (this.error !== '') { Text(this.error).fontSize(12).fontColor(PMColors.RISK) }
      }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(12)
    }
  }
}
