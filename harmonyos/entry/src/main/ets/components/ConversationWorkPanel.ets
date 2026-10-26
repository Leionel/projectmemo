import util from '@ohos.util';
import { ConversationView } from '../models/Conversation';
import { ConversationWork, ConversationWorkRef, ConversationWorkInput, ConversationScenarioInput, WorkCandidate, WorkChoice } from '../models/ConversationWork';
import { MissionPointer } from '../models/Mission';
import { EvidenceReview } from '../models/EvidenceFit';
import { ApiError } from '../models/Project';
import { ConversationService } from '../services/ConversationService';
import { MissionEvidenceReview } from './MissionEvidenceReview';
import { ConversationReviewPanel } from './ConversationReviewPanel';
import { PMButton } from './PMReferencePrimitives';
import { PMColors } from '../common/DesignTokens';
@Component
export struct ConversationWorkPanel {
  @Prop conversation: ConversationView = new ConversationView();
  @Prop workRef: ConversationWorkRef = new ConversationWorkRef();
  onUpdated: (view: ConversationView) => void = (): void => {};
  onClose: () => void = (): void => {};
  @State private work: ConversationWork = new ConversationWork();
  @State private answer: string = '';
  @State private selected: string[] = [];
  @State private minutes: string = '';
  @State private delivery: string = '';
  @State private error: string = '';
  @State private busy: boolean = false;
  @State private assessed: boolean = false;
  @State private assessmentText: string = '';
  @State private mode: string = 'CONDITIONAL_ANALYSIS';
  @State private premiseHash: string = '';
  private service: ConversationService = new ConversationService();
  private generation: number = 0;
  private keys: Map<string, string> = new Map<string, string>();
  aboutToAppear(): void { this.load(); }
  aboutToDisappear(): void { this.generation++; }
  private fail(e: Error): void { this.error = e.message; if (e instanceof ApiError && [401, 403, 404].includes(e.status)) { this.work = new ConversationWork(); this.answer = ''; this.selected = []; this.premiseHash = ''; } }
  private async load(): Promise<void> {
    const epoch = ++this.generation; this.busy = true;
    try { const w = await this.service.work(this.conversation.id, this.workRef); if (epoch === this.generation) { this.work = w; this.assessed = false; this.assessmentText = ''; } }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private input(operation: string, choice?: WorkChoice): ConversationWorkInput {
    const input = new ConversationWorkInput(); input.ref = this.workRef; input.versionToken = this.work.versionToken;
    input.expectedConversationVersion = this.conversation.version; input.operation = operation;
    if (this.answer.trim() !== '') input.answer = this.answer.trim();
    if (operation === 'continuation') input.sourcePointers = this.work.candidates.filter((c: WorkCandidate) => this.selected.includes(c.sourcePointer.id)).map((c: WorkCandidate): MissionPointer => c.sourcePointer);
    if (this.work.question?.premise && this.premiseHash === this.work.question.premise.premiseHash) {
      const review = new EvidenceReview(); review.mode = this.mode; review.premiseHash = this.premiseHash; review.note = this.answer.trim().slice(0, 1000); input.evidenceReview = review;
    }
    if (choice) { input.scenarioKey = choice.key; input.scenarioProposalId = this.work.scenario?.id; }
    if (operation === 'adopt_artifact' && this.work.output) { input.outputId = this.work.output.id; input.outputRevision = this.work.output.revision; }
    const fingerprint = JSON.stringify(input); input.requestId = this.keys.get(fingerprint) ?? util.generateRandomUUID(); this.keys.set(fingerprint, input.requestId);
    return input;
  }
  private async preview(operation: string, decision: string = '', choice?: WorkChoice): Promise<void> {
    if (this.busy) return;
    const epoch = this.generation; this.busy = true; this.error = '';
    try { const input = this.input(operation, choice); if (decision !== '') { input.decision = decision; input.requestId += ':' + decision; }
      const r = await this.service.previewWork(this.conversation.id, input); if (epoch === this.generation) { this.onUpdated(r.conversation); this.onClose(); } }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private async assess(): Promise<void> {
    const epoch = this.generation; this.busy = true;
    try { const a = await this.service.assessMaterials(this.conversation.id, this.input('continuation')); if (epoch === this.generation) { this.assessed = true; this.assessmentText = a.evidenceFit ? '观察条件：' + a.evidenceFit.fitStatus + '；未决项：' + a.evidenceFit.unresolvedChecks.join('、') : '材料评估：' + a.assessment + '；缺口：' + a.remaining.join('、'); } }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private async compare(): Promise<void> {
    const epoch = this.generation; this.busy = true;
    try { const input = new ConversationScenarioInput(); input.ref = this.workRef; input.versionToken = this.work.versionToken; input.availableMinutes = Number(this.minutes); input.deliveryMinutes = Number(this.delivery);
      const fingerprint = JSON.stringify(input); input.requestId = this.keys.get(fingerprint) ?? util.generateRandomUUID(); this.keys.set(fingerprint, input.requestId);
      const r = await this.service.compareScenarios(this.conversation.id, input); if (epoch === this.generation) { this.onUpdated(r.conversation); if (r.work) this.work = r.work; } }
    catch (e) { if (epoch === this.generation) this.fail(e); }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private reviewed(): boolean { return !this.work.question?.premise || this.premiseHash === this.work.question.premise.premiseHash; }
  build() {
    Column({ space: 12 }) {
      Row() { Text('原任务协作').fontSize(13).fontColor(PMColors.BRAND); Blank(); Button('收起').fontSize(12).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).onClick(() => this.onClose()) }.width('100%')
      Text(this.work.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
      Text(this.work.status === 'WAITING_INPUT' ? '等待补充' : this.work.status === 'PAUSED' ? '已暂停' : this.work.status === 'DONE' ? '行动已完成' : '原任务状态：' + this.work.status).fontSize(12).fontColor(PMColors.INK_TERTIARY)
      if (this.error !== '') { Text(this.error).fontSize(13).fontColor(PMColors.RISK) }
      if (this.work.question) {
        Text(this.work.question.text).fontSize(14).lineHeight(23).fontColor(PMColors.INK_PRIMARY)
        ForEach(this.work.candidates, (c: WorkCandidate) => {
          Row({ space: 8 }) {
            Checkbox().select(this.selected.includes(c.sourcePointer.id)).enabled(c.readable && !this.busy).selectedColor(PMColors.BRAND).onChange((v: boolean) => { this.selected = v ? [...this.selected, c.sourcePointer.id] : this.selected.filter((id: string) => id !== c.sourcePointer.id); this.assessed = false; })
            Column({ space: 4 }) { Text(c.title).fontSize(13).fontColor(PMColors.INK_PRIMARY); Text(c.excerpt).fontSize(12).maxLines(3).fontColor(PMColors.INK_SECONDARY) }.layoutWeight(1).alignItems(HorizontalAlign.Start)
          }.width('100%')
        }, (c: WorkCandidate) => c.sourcePointer.id)
      }
      if (this.work.question || this.workRef.kind === 'ACTION' && !['DONE', 'CANCELLED'].includes(this.work.status)) {
        TextArea({ text: this.answer, placeholder: this.workRef.kind === 'ACTION' ? '实际做了什么，结果如何…' : '围绕原问题填写答复和核对结论…' }).height(100).maxLength(this.workRef.kind === 'ACTION' ? 2000 : 3000).backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.answer = v; this.assessed = false; })
      }
      if (this.work.question?.premise) { MissionEvidenceReview({ premise: this.work.question.premise, mode: this.mode, confirmed: this.reviewed(), disabled: this.busy, onMode: (v: string): void => { this.mode = v; this.assessed = false; }, onConfirm: (v: boolean): void => { this.premiseHash = v ? this.work.question!.premise!.premiseHash : ''; } }) }
      if (this.assessmentText !== '') { Text(this.assessmentText).fontSize(12).lineHeight(20).fontColor(PMColors.INK_SECONDARY) }
      if (this.workRef.kind === 'MISSION' && this.work.version > 0) { ConversationReviewPanel({ conversation: this.conversation, work: this.work, busy: $busy, onUpdated: (view: ConversationView): void => { this.onUpdated(view); } }) }
      if (this.work.question) {
        if (this.selected.length > 0) {
          PMButton({ label: '核对所选资料', secondary: true, disabled: this.busy || !this.reviewed() || this.answer.trim() === '', onAction: (): void => { this.assess(); } })
          PMButton({ label: '预览材料接续', disabled: this.busy || !this.assessed || !this.reviewed(), onAction: (): void => { this.preview('continuation'); } })
        } else { PMButton({ label: '预览提交答复', disabled: this.busy || this.answer.trim() === '' || !this.reviewed() || !!this.work.question.premise && this.mode !== 'CONDITIONAL_ANALYSIS', onAction: (): void => { this.preview('input'); } }) }
      }
      if (this.work.status === 'PAUSED') { PMButton({ label: '预览接续原委托', disabled: this.busy, onAction: (): void => { this.preview('resume'); } }) }
      if (this.workRef.kind === 'ACTION' && !['DONE', 'CANCELLED'].includes(this.work.status)) { PMButton({ label: '预览完成与复盘', disabled: this.busy || this.answer.trim().length < 5, onAction: (): void => { this.preview('complete_action'); } }) }
      if (this.work.approval) {
        Text(this.work.approval.title + '\n' + this.work.approval.description).fontSize(14).fontColor(PMColors.INK_PRIMARY)
        PMButton({ label: '预览批准', disabled: this.busy, onAction: (): void => { this.preview('approval', 'APPROVED'); } })
        PMButton({ label: '预览拒绝', secondary: true, disabled: this.busy, onAction: (): void => { this.preview('approval', 'REJECTED'); } })
      }
      if (this.workRef.kind === 'MISSION' && !['SUCCEEDED', 'CANCELLED', 'RUNNING'].includes(this.work.status)) {
        TextInput({ text: this.minutes, placeholder: '可用时间（分钟）' }).type(InputType.Number).onChange((v: string) => { this.minutes = v; })
        TextInput({ text: this.delivery, placeholder: '交付所需（分钟）' }).type(InputType.Number).onChange((v: string) => { this.delivery = v; })
        PMButton({ label: '对比推进方案', secondary: true, disabled: this.busy || Number(this.minutes) <= 0 || Number(this.delivery) <= 0, onAction: (): void => { this.compare(); } })
      }
      if (this.work.scenario) {
        ForEach(this.work.scenario.choices, (c: WorkChoice) => {
          Text(c.title + '\n' + c.tradeoff + '\n' + c.reasons.join('；')).fontSize(13).lineHeight(22).fontColor(PMColors.INK_SECONDARY)
          if (c.key !== 'BASELINE' && this.work.scenario!.status === 'READY') { PMButton({ label: '预览采用此方案', secondary: true, disabled: this.busy || this.work.scenario!.stale || c.feasibility !== 'READY', onAction: (): void => { this.preview('adopt_scenario', '', c); } }) }
        }, (c: WorkChoice) => c.key)
      }
      if (this.work.output) { Text(this.work.output.title + ' · ' + this.work.output.verificationStatus).fontSize(13).fontColor(PMColors.INK_SECONDARY); PMButton({ label: '预览归入项目成果', secondary: true, disabled: this.busy, onAction: (): void => { this.preview('adopt_artifact'); } }) }
      if (this.work.resultText) { Text(this.work.resultText + '\n复盘回执：' + (this.work.resultCardId ?? '暂无')).fontSize(13).lineHeight(22).fontColor(PMColors.INK_SECONDARY) }
      PMButton({ label: '刷新原任务', secondary: true, disabled: this.busy, onAction: (): void => { this.load(); } })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(16).backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER }).borderRadius(14)
  }
}
