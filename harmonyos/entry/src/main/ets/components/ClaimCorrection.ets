import util from '@ohos.util';
import { AgentMemoryService } from '../services/AgentMemoryService';
import { ClaimControls, ClaimCommand, ClaimHead, ClaimText, ClaimOrigin } from '../models/AgentMemory';
import { ConversationDraftStore } from '../services/ConversationDraftStore';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { PMColors } from '../common/DesignTokens';

@Component
export struct ClaimCorrection {
  @Prop @Watch('identityChanged') projectId: string = '';
  @Prop @Watch('identityChanged') sourceId: string = '';
  @Prop kind: string = 'MESSAGE';
  onChanged: () => void = (): void => {};
  @State opened: boolean = false;
  @State busy: boolean = false;
  @State error: string = '';
  @State quote: string = '';
  @State selected: string = '';
  @State selectedStart: number = -1;
  @State selectedEnd: number = -1;
  @State source: ClaimText | undefined = undefined;
  @State controls: ClaimControls = new ClaimControls();
  @State pending: ClaimCommand | undefined = undefined;
  private ready: boolean = false;
  private epoch: number = 0;
  private storeReady: Promise<void> = Promise.resolve();
  private service: AgentMemoryService = new AgentMemoryService();
  private draftKey(): string { return `claim:${this.projectId}:${this.kind}:${this.sourceId}`; }
  private identityChanged(): void { this.epoch++; this.opened = false; this.ready = false; this.source = undefined; this.controls = new ClaimControls(); this.quote = ''; this.pending = undefined; this.error = ''; this.busy = false; }
  aboutToAppear(): void { try { this.storeReady = ConversationDraftStore.bind(getContext(this), SessionStore.getUser().id); } catch { this.storeReady = Promise.resolve(); } }
  aboutToDisappear(): void { this.epoch++; }
  private async load(): Promise<void> {
    const token = ++this.epoch; this.busy = true; this.error = '';
    const draft = ConversationDraftStore.read(this.draftKey()); this.quote = draft.answer;
    try { this.pending = draft.claimRequest ? JSON.parse(draft.claimRequest) as ClaimCommand : undefined; } catch { this.pending = undefined; }
    try {
      const controls = await this.service.controls(this.projectId);
      if (token !== this.epoch) return;
      this.controls = controls; this.ready = true;
      try {
        const source = await this.service.source(this.projectId, this.kind, this.sourceId);
        if (token !== this.epoch) return;
        this.source = source; this.selected = source.text.length <= 6000 ? source.text : ''; this.selectedStart = this.selected ? 0 : -1; this.selectedEnd = this.selected.length;
      } catch { if (token === this.epoch) { this.source = undefined; this.error = '原内容暂不可读，仍可核对历史纠正或原次提交'; } }
    } catch (e) { if (token === this.epoch) { this.error = (e as Error).message; this.ready = false; } }
    finally { if (token === this.epoch) this.busy = false; }
  }
  private heads(): ClaimHead[] { return this.controls.heads.filter((h: ClaimHead) => h.origin.kind === this.kind && h.origin.id === this.sourceId); }
  private async save(withdraw?: ClaimHead): Promise<void> {
    if (!this.ready || this.busy) return;
    let command = this.pending;
    if (!command) {
      command = new ClaimCommand(); command.requestId = util.generateRandomUUID(true);
      command.scope.projectId = this.projectId; command.expectedSeq = this.controls.seq; command.expectedOwnerUserId = this.controls.ownerUserId;
      if (withdraw) { command.origin = withdraw.origin; command.expectedRevision = withdraw.revision; command.operation = 'WITHDRAW'; }
      else {
        const raw = this.source?.text ?? '';
        const hasRange = this.selectedStart >= 0 && this.selectedEnd > this.selectedStart && raw.slice(this.selectedStart, this.selectedEnd) === this.selected;
        const start = hasRange ? this.selectedStart : raw.indexOf(this.selected);
        if (!this.source || this.selected.length === 0 || this.selected.length > 6000 || start < 0 || (!hasRange && raw.indexOf(this.selected, start + 1) >= 0) || this.quote.trim() === '') {
          this.error = '请复制唯一的一段原文，或选择完整原文，并说明应怎样理解'; return;
        }
        const origin = new ClaimOrigin(); origin.kind = this.kind; origin.id = this.sourceId; origin.contentHash = this.source.contentHash;
        origin.start = start; origin.end = start + this.selected.length; origin.quote = this.selected; command.origin = origin;
        command.userQuote = this.quote.trim();
        const head = this.heads().find((h: ClaimHead) => h.origin.contentHash === origin.contentHash && h.origin.start === origin.start && h.origin.end === origin.end);
        if (head) command.expectedRevision = head.revision;
      }
    }
    const draft = ConversationDraftStore.read(this.draftKey()); draft.claimRequest = JSON.stringify(command); ConversationDraftStore.save(this.draftKey(), draft);
    this.pending = command; this.busy = true; this.error = ''; const token = this.epoch;
    try {
      await this.storeReady;
      if (!await ConversationDraftStore.flush()) throw new ApiError("DRAFT_NOT_SAVED", "草稿尚未保存，暂未提交；请稍后核对", 0);
      if (token !== this.epoch) return;
      await this.service.submit(this.projectId, command);
      if (token !== this.epoch) return;
      draft.claimRequest = ''; draft.answer = ''; ConversationDraftStore.save(this.draftKey(), draft); this.pending = undefined; this.quote = '';
      this.onChanged(); await this.load();
    } catch (e) {
      if (token !== this.epoch) return;
      const error = e as ApiError;
      if (error.status >= 400 && error.status < 500) { draft.claimRequest = ''; ConversationDraftStore.save(this.draftKey(), draft); this.pending = undefined; }
      this.error = error.message;
    } finally { if (token === this.epoch) this.busy = false; }
  }
  build() {
    Column({ space: 8 }) {
      Button(this.opened ? '收起纠正' : '纠正理解', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
        .onClick(() => { this.opened = !this.opened; if (this.opened) this.load(); })
      if (this.opened) {
        Text('用于我在这个项目中的后续理解，原记录保留。').fontSize(12).fontColor(PMColors.INK_SECONDARY)
        if (this.source) {
          Text(this.source.text).fontSize(14).copyOption(CopyOptions.InApp)
            .onTextSelectionChange((start: number, end: number) => { if (this.source && !this.busy && !this.pending && end > start) { this.selectedStart = start; this.selectedEnd = end; this.selected = this.source.text.slice(start, end); } })
          TextArea({ text: this.selected, placeholder: '需纠正的完整原文或唯一片段' }).accessibilityText('需纠正的原文').enabled(!this.busy && this.pending === undefined).onChange((v: string) => { this.selected = v; this.selectedStart = -1; this.selectedEnd = -1; })
        }
        TextArea({ text: this.quote, placeholder: '应怎样理解' }).maxLength(2000).accessibilityText('应怎样理解').enabled(!this.busy && this.pending === undefined)
          .onChange((v: string) => { this.quote = v; const draft = ConversationDraftStore.read(this.draftKey()); draft.answer = v; ConversationDraftStore.save(this.draftKey(), draft); })
        Button(this.pending ? '核对原次提交' : '保存纠正').height(44).enabled(!this.busy && this.ready).onClick(() => { this.save(); })
        Button('重新核对', { type: ButtonType.Normal }).height(44).enabled(!this.busy).onClick(() => { this.load(); })
        ForEach(this.heads(), (h: ClaimHead) => {
          Column({ space: 4 }) {
            Text(h.origin.quote).fontSize(13)
            Text(h.userQuote ?? '').fontSize(14)
            Text(h.active ? '当前纠正' : '历史纠正').fontSize(12)
            if (h.active) { Button('撤回这次纠正').height(44).enabled(!this.busy && this.pending === undefined).onClick(() => { this.save(h); }) }
          }.width('100%').alignItems(HorizontalAlign.Start)
        }, (h: ClaimHead) => h.claimId)
        if (this.busy) { Text('正在核对原记录…').fontSize(12) }
        if (this.error) { Text(this.error).fontSize(13).fontColor(PMColors.INK_SECONDARY) }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
