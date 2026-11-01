import util from '@ohos.util';
import { AgentMemoryService } from '../services/AgentMemoryService';
import { ClaimControls, ClaimCommand, ClaimHead, ClaimText, ClaimOrigin } from '../models/AgentMemory';
import { ConversationDraftStore } from '../services/ConversationDraftStore';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { ConversationProject } from '../models/Conversation';
import { PMColors, PMRadius } from '../common/DesignTokens';

/**
 * 纠正面板内容：原文选择始终基于原始文本偏移（UTF16 code units），渲染层不参与选区换算。
 * 由消息工具栏或独立入口（记忆页）通过 bindSheet 挂载；保存或撤回成功后由调用方收起弹层。
 */
@Component
export struct ClaimCorrectionPanel {
  @Prop @Watch('identityChanged') projectId: string = '';
  @Prop @Watch('identityChanged') sourceId: string = '';
  @Prop kind: string = 'MESSAGE';
  @Prop projects: ConversationProject[] = [];
  onClose: () => void = (): void => {};
  onChanged: () => void = (): void => {};
  @State chosenProject: string = '';
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
  private activeProject(): string {
    if (this.projects.length > 1) { return this.chosenProject; }
    if (this.projects.length === 1) { return this.projects[0].id; }
    return this.projectId;
  }
  private draftKey(): string { return `claim:${this.activeProject()}:${this.kind}:${this.sourceId}`; }
  private identityChanged(): void { this.epoch++; this.ready = false; this.source = undefined; this.controls = new ClaimControls(); this.quote = ''; this.pending = undefined; this.error = ''; this.busy = false; this.chosenProject = ''; }
  aboutToAppear(): void {
    try { this.storeReady = ConversationDraftStore.bind(getContext(this), SessionStore.getUser().id); } catch { this.storeReady = Promise.resolve(); }
    if (this.projects.length > 1) { this.chosenProject = this.projects[0].id; }
    this.load();
  }
  private chooseProject(id: string): void {
    if (this.chosenProject === id) { return; }
    this.epoch++; this.ready = false; this.source = undefined; this.controls = new ClaimControls();
    this.quote = ''; this.pending = undefined; this.error = ''; this.busy = false;
    this.selected = ''; this.selectedStart = -1; this.selectedEnd = -1;
    this.chosenProject = id;
    this.load();
  }
  private async load(): Promise<void> {
    const token = ++this.epoch; this.busy = true; this.error = '';
    const draft = ConversationDraftStore.read(this.draftKey()); this.quote = draft.answer;
    try { this.pending = draft.claimRequest ? JSON.parse(draft.claimRequest) as ClaimCommand : undefined; } catch { this.pending = undefined; }
    try {
      const controls = await this.service.controls(this.activeProject());
      if (token !== this.epoch) { return; }
      this.controls = controls; this.ready = true;
      try {
        const source = await this.service.source(this.activeProject(), this.kind, this.sourceId);
        if (token !== this.epoch) { return; }
        this.source = source; this.selected = source.text.length <= 6000 ? source.text : ''; this.selectedStart = this.selected ? 0 : -1; this.selectedEnd = this.selected.length;
      } catch { if (token === this.epoch) { this.source = undefined; this.error = '原内容暂不可读，仍可核对历史纠正或原次提交'; } }
    } catch (e) { if (token === this.epoch) { this.error = (e as Error).message; this.ready = false; } }
    finally { if (token === this.epoch) this.busy = false; }
  }
  private heads(): ClaimHead[] { return this.controls.heads.filter((h: ClaimHead) => h.origin.kind === this.kind && h.origin.id === this.sourceId); }
  private async save(withdraw?: ClaimHead): Promise<void> {
    if (!this.ready || this.busy || this.activeProject() === '') { return; }
    let command = this.pending;
    if (!command) {
      command = new ClaimCommand(); command.requestId = util.generateRandomUUID(true);
      command.scope.projectId = this.activeProject(); command.expectedSeq = this.controls.seq; command.expectedOwnerUserId = this.controls.ownerUserId;
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
        if (head) { command.expectedRevision = head.revision; }
      }
    }
    const draft = ConversationDraftStore.read(this.draftKey()); draft.claimRequest = JSON.stringify(command); ConversationDraftStore.save(this.draftKey(), draft);
    this.pending = command; this.busy = true; this.error = ''; const token = this.epoch;
    try {
      await this.storeReady;
      if (!await ConversationDraftStore.flush()) { throw new ApiError("DRAFT_NOT_SAVED", "草稿尚未保存，暂未提交；请稍后核对", 0); }
      if (token !== this.epoch) { return; }
      await this.service.submit(this.activeProject(), command);
      if (token !== this.epoch) { return; }
      draft.claimRequest = ''; draft.answer = ''; ConversationDraftStore.save(this.draftKey(), draft); this.pending = undefined; this.quote = '';
      this.onChanged(); this.onClose();
    } catch (e) {
      if (token !== this.epoch) { return; }
      const error = e as ApiError;
      if (error.status >= 400 && error.status < 500) { draft.claimRequest = ''; ConversationDraftStore.save(this.draftKey(), draft); this.pending = undefined; }
      this.error = error.message;
    } finally { if (token === this.epoch) this.busy = false; }
  }
  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text('纠正理解').fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
        Button('完成', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
          .fontColor(PMColors.INK_SECONDARY).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).padding({ left: 14, right: 14 })
          .onClick(() => { this.onClose(); })
      }.width('100%')
      Scroll() {
        Column({ space: 12 }) {
          Text('用于我在这个项目中的后续理解，原记录保留。').fontSize(12).lineHeight(19).fontColor(PMColors.INK_TERTIARY)
          if (this.projects.length > 1) {
            Column({ space: 6 }) {
              Text('纠正适用的项目').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
              ForEach(this.projects, (p: ConversationProject) => {
                Button((this.chosenProject === p.id ? '✓ ' : '') + p.title, { type: ButtonType.Normal })
                  .width('100%').constraintSize({ minHeight: 44 }).fontSize(14)
                  .fontColor(this.chosenProject === p.id ? PMColors.BRAND : PMColors.INK_PRIMARY)
                  .backgroundColor(this.chosenProject === p.id ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
                  .borderRadius(10).padding({ left: 14, right: 14 })
                  .onClick(() => { this.chooseProject(p.id); })
              }, (p: ConversationProject) => p.id)
            }.width('100%').alignItems(HorizontalAlign.Start)
          }
          if (this.activeProject() === '') {
            Text('先选择纠正适用的项目；纠正只影响你在该项目中的后续理解。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
          } else {
            if (this.source) {
              Text('需要纠正的原文（长按选择其中一段）').fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
              Text(this.source.text).fontSize(14).lineHeight(23).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.InApp)
                .onTextSelectionChange((start: number, end: number) => {
                  if (this.source && !this.busy && !this.pending && end > start) {
                    this.selectedStart = start; this.selectedEnd = end; this.selected = this.source.text.slice(start, end);
                  }
                })
              if (this.selectedStart >= 0 && this.selectedEnd > this.selectedStart) {
                Text('已选择：「' + this.selected + '」').fontSize(12).lineHeight(19).fontColor(PMColors.BRAND)
              } else {
                Text('尚未选择原文片段。').fontSize(12).fontColor(PMColors.INK_TERTIARY)
              }
              TextArea({ text: this.selected, placeholder: '或粘贴唯一的一段原文' }).accessibilityText('需纠正的原文')
                .enabled(!this.busy && this.pending === undefined).height(84)
                .onChange((v: string) => { this.selected = v; this.selectedStart = -1; this.selectedEnd = -1; })
            }
            TextArea({ text: this.quote, placeholder: '应怎样理解' }).maxLength(2000).accessibilityText('应怎样理解')
              .enabled(!this.busy && this.pending === undefined).height(84).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
              .onChange((v: string) => { this.quote = v; const draft = ConversationDraftStore.read(this.draftKey()); draft.answer = v; ConversationDraftStore.save(this.draftKey(), draft); })
            Row({ space: 10 }) {
              Button(this.pending ? '核对原次提交' : '保存纠正', { type: ButtonType.Normal }).layoutWeight(1).constraintSize({ minHeight: 44 })
                .borderRadius(PMRadius.BUTTON).fontSize(15).fontWeight(FontWeight.Medium)
                .fontColor(Color.White).backgroundColor(PMColors.BRAND).enabled(!this.busy && this.ready).onClick(() => { this.save(); })
              Button('重新核对', { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).fontSize(14)
                .fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.BUTTON).padding({ left: 14, right: 14 })
                .enabled(!this.busy).onClick(() => { this.load(); })
            }.width('100%')
            if (this.pending !== undefined) { Text('上次提交结果未确认，保存将核对原次提交。').fontSize(12).fontColor(PMColors.INK_TERTIARY) }
            ForEach(this.heads(), (h: ClaimHead) => {
              Column({ space: 5 }) {
                Text(h.origin.quote).fontSize(13).lineHeight(20).fontColor(PMColors.INK_SECONDARY)
                Text(h.userQuote ?? '').fontSize(14).lineHeight(22).fontColor(PMColors.INK_PRIMARY)
                Row() {
                  Text(h.active ? '当前纠正' : '历史纠正').fontSize(12).fontColor(PMColors.INK_TERTIARY).layoutWeight(1)
                  if (h.active) {
                    Button('撤回这次纠正', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
                      .fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(9).padding({ left: 12, right: 12 })
                      .enabled(!this.busy && this.pending === undefined).onClick(() => { this.save(h); })
                  }
                }.width('100%')
              }.width('100%').alignItems(HorizontalAlign.Start).padding(12)
                .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
            }, (h: ClaimHead) => h.claimId)
            if (this.busy) { Text('正在核对原记录…').fontSize(12).fontColor(PMColors.INK_TERTIARY) }
            if (this.error !== '') { Text(this.error).fontSize(13).lineHeight(20).fontColor(PMColors.RISK) }
          }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ bottom: 12 })
      }.width('100%').constraintSize({ maxHeight: 560 }).scrollBar(BarState.Auto).align(Alignment.Top)
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 18, right: 18, top: 14, bottom: 10 })
  }
}

/** 记忆页/假设卡片等处的独立入口：自带「纠正理解」按钮与弹层。 */
@Component
export struct ClaimCorrection {
  @Prop projectId: string = '';
  @Prop sourceId: string = '';
  @Prop kind: string = 'MESSAGE';
  onChanged: () => void = (): void => {};
  @State sheetOpen: boolean = false;
  @Builder
  private Sheet() {
    ClaimCorrectionPanel({ projectId: this.projectId, sourceId: this.sourceId, kind: this.kind,
      onClose: (): void => { this.sheetOpen = false; }, onChanged: (): void => { this.onChanged(); } })
  }
  build() {
    Column() {
      Button('纠正理解', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
        .fontColor(PMColors.INK_TERTIARY).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
        .accessibilityText('纠正理解').onClick(() => { this.sheetOpen = true; })
    }
    .bindSheet($$this.sheetOpen, this.Sheet(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true,
      showClose: false
    })
  }
}
