import util from '@ohos.util';
import { ConversationView } from '../models/Conversation';
import { ConversationWork, ConversationWorkInput } from '../models/ConversationWork';
import { ConversationReviews, ConversationReviewInput, ReviewCandidate, ReviewMaterial } from '../models/ChangeReview';
import { MissionPointer } from '../models/Mission';
import { ConversationService } from '../services/ConversationService';
import { PMButton } from './PMReferencePrimitives';
import { PMColors } from '../common/DesignTokens';
@Component
export struct ConversationReviewPanel {
  @Prop conversation: ConversationView = new ConversationView();
  @Prop work: ConversationWork = new ConversationWork();
  @Link busy: boolean;
  onUpdated: (view: ConversationView) => void = (_: ConversationView): void => {};
  @State private expanded: boolean = false;
  @State private data: ConversationReviews = new ConversationReviews();
  @State private selected: string[] = [];
  @State private rejected: string[] = [];
  @State private feedback: string = '';
  @State private error: string = '';
  private service: ConversationService = new ConversationService();
  private keys: Map<string, string> = new Map<string, string>();
  private generation: number = 0;
  aboutToDisappear(): void { this.generation++; }
  private async load(): Promise<void> {
    if (this.busy) return;
    const epoch = this.generation; this.busy = true; this.error = '';
    try { const data = await this.service.reviews(this.conversation.id, this.work.ref); if (epoch === this.generation) this.data = data; }
    catch (e) { if (epoch === this.generation) this.error = (e as Error).message; }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private requestKey(input: ConversationReviewInput | ConversationWorkInput): string {
    const fingerprint = JSON.stringify(input); const key = this.keys.get(fingerprint) ?? util.generateRandomUUID(); this.keys.set(fingerprint, key); return key;
  }
  private async submit(purpose: string, retry: boolean = false): Promise<void> {
    if (this.busy) return;
    const epoch = this.generation; this.busy = true; this.error = '';
    try {
      const input = new ConversationReviewInput(); input.ref = this.work.ref; input.expectedVersion = this.work.version;
      input.expectedConversationVersion = this.conversation.version; input.purpose = purpose;
      if (purpose === 'CHANGE_REVIEW') input.sources = this.data.materials.filter((m: ReviewMaterial) => this.selected.includes(m.sourcePointer.id)).map((m: ReviewMaterial): MissionPointer => m.sourcePointer);
      else { input.reviewId = this.data.change?.id; input.feedback = this.feedback; input.retry = retry; input.rejectedCandidateIds = this.rejected; }
      input.requestId = this.requestKey(input);
      const result = await this.service.submitReview(this.conversation.id, input);
      if (epoch === this.generation) { this.onUpdated(result.conversation); const data = await this.service.reviews(this.conversation.id, this.work.ref); if (epoch === this.generation) this.data = data; }
    } catch (e) { if (epoch === this.generation) this.error = (e as Error).message; }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  private async preview(candidate: ReviewCandidate): Promise<void> {
    if (this.busy || !this.data.dynamic) return;
    const epoch = this.generation; this.busy = true; this.error = '';
    try {
      const input = new ConversationWorkInput(); input.ref = this.work.ref; input.versionToken = this.work.versionToken;
      input.expectedConversationVersion = this.conversation.version; input.operation = 'adopt_dynamic'; input.dynamicProposalId = this.data.dynamic.id; input.candidateId = candidate.candidateId; input.requestId = this.requestKey(input);
      const result = await this.service.previewWork(this.conversation.id, input); if (epoch === this.generation) this.onUpdated(result.conversation);
    } catch (e) { if (epoch === this.generation) this.error = (e as Error).message; }
    finally { if (epoch === this.generation) this.busy = false; }
  }
  build() {
    Column({ space: 12 }) {
      Row() { Text('复核资料变化').fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY); Blank(); Button(this.expanded ? '收起' : '展开').fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.busy).onClick(() => { this.expanded = !this.expanded; if (this.expanded) this.load(); }) }.width('100%')
      if (this.expanded) {
        if (this.error !== '') { Text(this.error).fontSize(12).fontColor(PMColors.RISK) }
        if (!this.data.enabled) { Text('变化复核尚未开启').fontSize(12).fontColor(PMColors.INK_TERTIARY) }
        else {
          ForEach(this.data.materials, (m: ReviewMaterial) => {
            Row({ space: 8 }) {
              Checkbox().select(this.selected.includes(m.sourcePointer.id)).selectedColor(PMColors.BRAND).enabled(!this.busy && m.readable && (this.selected.length < 5 || this.selected.includes(m.sourcePointer.id))).onChange((v: boolean) => { this.selected = v ? [...this.selected, m.sourcePointer.id] : this.selected.filter((id: string) => id !== m.sourcePointer.id); })
              Column({ space: 3 }) { Text(m.title).fontSize(13).fontColor(PMColors.INK_PRIMARY); Text(m.excerpt).fontSize(12).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).fontColor(PMColors.INK_SECONDARY) }.layoutWeight(1).alignItems(HorizontalAlign.Start)
            }.width('100%')
          }, (m: ReviewMaterial) => m.sourcePointer.id)
          Text('最多 5 份。向云端发送原目标、约束和相关片段，占用原委托额度。').fontSize(12).lineHeight(19).fontColor(PMColors.INK_TERTIARY)
          PMButton({ label: '云端复核所选资料', secondary: true, disabled: this.busy || this.selected.length === 0 || !['READY', 'PAUSED'].includes(this.work.status), onAction: (): void => { this.submit('CHANGE_REVIEW'); } })
          if (this.data.change) {
            Text(this.data.change.stale ? '复核依据已变化' : this.data.change.result?.summary ?? '正在读取复核状态；不会自动重发模型').fontSize(14).lineHeight(23).fontColor(PMColors.INK_PRIMARY)
            if (this.data.change.result) { ForEach(this.data.change.result.candidates, (c: ReviewCandidate) => { Text(c.question ?? '').fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY) }, (c: ReviewCandidate) => c.candidateId) }
            if (this.data.change.status === 'READY' && !this.data.change.stale && this.data.change.result?.decision !== 'KEEP_PLAN' && !this.data.dynamic) { PMButton({ label: '比较本轮推进方案', secondary: true, disabled: this.busy, onAction: (): void => { this.submit('DYNAMIC_PLAN'); } }) }
          }
          if (this.data.dynamic) {
            Text(this.data.dynamic.stale ? '方案依据已变化' : this.data.dynamic.result?.summary ?? '方案状态：' + this.data.dynamic.status).fontSize(14).lineHeight(23).fontColor(PMColors.INK_PRIMARY)
            if (this.data.dynamic.result) {
              ForEach(this.data.dynamic.result.candidates, (c: ReviewCandidate) => {
                Column({ space: 8 }) {
                  Text(c.title ?? '保留当前计划').fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
                  Text(c.reason).fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY)
                  Text((c.feasibilityReasons ?? []).join('；') || c.stopCondition || '').fontSize(12).fontColor(PMColors.INK_TERTIARY)
                  Row() { Checkbox().select(this.rejected.includes(c.candidateId)).selectedColor(PMColors.BRAND).enabled(!this.busy && this.data.dynamic!.base.attempt < 2).onChange((v: boolean) => { this.rejected = v ? [...this.rejected, c.candidateId] : this.rejected.filter((id: string) => id !== c.candidateId); }); Text('不采用').fontSize(12).fontColor(PMColors.INK_SECONDARY) }
                  PMButton({ label: '预览采用', secondary: true, disabled: this.busy || this.data.dynamic!.stale || this.data.dynamic!.status !== 'READY' || c.feasibility !== 'READY' || this.rejected.includes(c.candidateId), onAction: (): void => { this.preview(c); } })
                }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 12, bottom: 12 }).border({ width: { bottom: 1 }, color: PMColors.BORDER })
              }, (c: ReviewCandidate) => c.candidateId)
            }
            if (this.data.dynamic.base.attempt < 2 && this.data.dynamic.status !== 'BUILDING' && !this.data.dynamic.stale) {
              TextArea({ text: this.feedback, placeholder: '补充新观察，或说明方案哪里不合适…' }).height(80).maxLength(500).backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onChange((v: string) => { this.feedback = v; })
              PMButton({ label: '带新反馈再分析一次', secondary: true, disabled: this.busy || this.feedback.trim() === '' && this.rejected.length === 0 && (this.data.change?.toolAttempts ?? 0) === 0, onAction: (): void => { this.submit('DYNAMIC_PLAN', true); } })
            }
          }
          PMButton({ label: '读取复核状态', secondary: true, disabled: this.busy, onAction: (): void => { this.load(); } })
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 12, bottom: 12 }).border({ width: { top: 1 }, color: PMColors.BORDER })
  }
}
