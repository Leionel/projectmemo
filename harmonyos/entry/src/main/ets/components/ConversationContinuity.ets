import util from '@ohos.util';
import { ContinuityView, DirectiveInput, EffectiveDirective, HandoffMission, HandoffResult, OpenHandoffInput, DirectiveScope } from '../models/Continuity';
import { ConversationService } from '../services/ConversationService';
import { ConversationWorkRef } from '../models/ConversationWork';
import { PMColors } from '../common/DesignTokens';

@Component
export struct ConversationContinuity {
  @Prop conversationId: string = '';
  @Prop projectId: string = '';
  @Prop info: ContinuityView;
  onSaved: () => void = (): void => {};
  onWork: (ref: ConversationWorkRef) => void = (_ref: ConversationWorkRef): void => {};
  @State private open: boolean = false;
  @State private quote: string = '';
  @State private until: string = '';
  @State private question: string = '';
  @State private saving: boolean = false;
  @State private preview: DirectiveInput | null = null;
  @State private candidateId: string = '';
  @State private kind: string = 'WORKING_OBJECTIVE';
  @State private candidateScope: DirectiveScope = new DirectiveScope();
  private service: ConversationService = new ConversationService();
  private input(): DirectiveInput {
    const input = new DirectiveInput(); input.commandId = util.generateRandomUUID(true); input.expectedSeq = this.info.seq;
    input.scope.projectId = this.projectId; if (this.quote.trim() !== '') input.quote = this.quote;
    if (this.candidateId !== '') { input.candidateId = this.candidateId; input.scope = this.candidateScope; }
    return input;
  }
  private async send(input: DirectiveInput): Promise<void> {
    if (this.saving) return;
    const conversationId = this.conversationId; this.saving = true;
    try {
      const result = await this.service.saveDirective(conversationId, input);
      if (this.conversationId !== conversationId) return;
      if (result.command) { this.preview = result.command; return; }
      if (result.events && result.events.length > 0) { this.open = false; this.quote = ''; this.question = ''; this.preview = null; this.candidateId = ''; this.onSaved(); }
      else { this.question = result.admission?.question || '这句话还未生效，请核对措辞和有效期'; }
    } catch { if (this.conversationId === conversationId) this.question = '指引暂未保存，请读取原状态后核对'; }
    finally { this.saving = false; }
  }
  private withdraw(d: EffectiveDirective): void {
    const input = this.input(); input.scope = d.scope; input.operation = 'WITHDRAW'; input.directiveId = d.directiveId;
    this.send(input);
  }
  private async openWork(kind: string, id: string): Promise<void> {
    const conversationId = this.conversationId, input = new OpenHandoffInput();
    input.openWork = { kind, id, projectId: this.projectId };
    try { const result = await this.service.openHandoff(conversationId, input); if (this.conversationId === conversationId) this.onWork(result.ref); }
    catch { if (this.conversationId === conversationId) this.question = '原任务已变化，请读取当前状态'; }
  }
  private prepare(): void {
    const date = new Date(this.until.trim().replace(' ', 'T') + ':00+08:00');
    if (!Number.isFinite(date.getTime())) { this.question = '请输入北京时间，例如 2026-10-30 20:00'; return; }
    const input = this.input(); input.kind = this.kind; input.validUntil = date.toISOString(); input.preview = true; this.send(input);
  }
  build() {
    Column({ space: 8 }) {
      if (this.info.workingObjective) { Text('当前重点：' + this.info.workingObjective).fontSize(14).fontColor(PMColors.INK_PRIMARY) }
      if (this.info.stopped) { Text('这项工作已暂停').fontSize(14) }
      ForEach(this.info.directives, (d: EffectiveDirective) => {
        Row({ space: 8 }) {
          Text(d.quote + (d.validUntil ? ' · 到 ' + new Date(d.validUntil).toLocaleString() : '')).fontSize(13).layoutWeight(1)
          Button('撤回', { type: ButtonType.Normal }).height(44).fontSize(13).backgroundColor(Color.Transparent).fontColor(PMColors.BRAND).enabled(!this.saving).onClick(() => { this.withdraw(d); })
        }.width('100%')
      }, (d: EffectiveDirective) => d.id)
      Button('调整当前方向', { type: ButtonType.Normal }).height(44).fontSize(13).backgroundColor(Color.Transparent).fontColor(PMColors.BRAND).onClick(() => { this.open = !this.open; })
      if (this.info.candidate) {
        Text('我理解你现在更关注：' + this.info.candidate.interpretation).fontSize(14)
        Text('你的原话：' + this.info.candidate.quote).fontSize(12).fontColor(PMColors.INK_SECONDARY)
        Button('核对这项理解').height(44).onClick(() => {
          if (this.info.candidate) { this.quote = this.info.candidate.interpretation; this.kind = this.info.candidate.kind; this.candidateId = this.info.candidate.id; this.candidateScope = this.info.candidate.scope; this.open = true; this.question = '这项理解先持续到什么时候？'; this.preview = null; }
        })
      }
      if (this.open) {
        TextInput({ text: this.quote, placeholder: '例如：本周先稳演示，先别加功能' }).height(44).onChange((v: string) => { this.quote = v; this.preview = null; this.question = ''; this.candidateId = ''; })
        Button('按这句话调整').height(44).enabled(!this.saving && this.quote.trim() !== '').onClick(() => { if (this.candidateId !== '') this.question = '这项理解先持续到什么时候？'; else this.send(this.input()); })
        if (this.question !== '') {
          Text(this.question).fontSize(13).fontColor(PMColors.WARNING)
          TextInput({ text: this.until, placeholder: '有效至（北京时间）：2026-10-30 20:00' }).height(44).onChange((v: string) => { this.until = v; this.preview = null; })
          Button('核对调整内容').height(44).enabled(!this.saving && this.until.trim() !== '').onClick(() => { this.prepare(); })
        }
        if (this.preview !== null) {
          Text((this.preview.scope.missionId ? '仅此委托：' : '仅此项目：') + (this.preview.quote || '') + '，有效到 ' + new Date(this.preview.validUntil || '').toLocaleString()).fontSize(13)
          Button('确认这条工作指引').height(44).enabled(!this.saving).onClick(() => { if (this.preview) this.send(this.preview); })
          Button('返回修改').height(44).onClick(() => { this.preview = null; })
        }
      }
      if (this.info.handoff) {
        ForEach(this.info.handoff.missions, (m: HandoffMission) => {
          Button(m.goal + (m.nextOwner === 'USER' ? ' · 等你接续' : ' · Agent 处理中'), { type: ButtonType.Normal }).fontSize(13).constraintSize({ minHeight: 44 }).backgroundColor(Color.Transparent).fontColor(PMColors.BRAND).onClick(() => { this.openWork('MISSION', m.id); })
        }, (m: HandoffMission) => m.id)
        ForEach(this.info.handoff.results, (a: HandoffResult) => {
          Button(a.title + ' · 查看原回执', { type: ButtonType.Normal }).fontSize(13).constraintSize({ minHeight: 44 }).backgroundColor(Color.Transparent).fontColor(PMColors.BRAND).onClick(() => { this.openWork('ACTION', a.id); })
        }, (a: HandoffResult) => a.id)
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
