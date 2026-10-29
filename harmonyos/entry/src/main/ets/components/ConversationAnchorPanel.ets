import util from '@ohos.util';
import { ConversationView } from '../models/Conversation';
import { ConversationAnchor, ConversationAnchorInput, ConversationAnchorReply } from '../models/ConversationAnchor';
import { ConversationService } from '../services/ConversationService';
import { PMColors } from '../common/DesignTokens';
import { PMButton } from './PMReferencePrimitives';

@Component
export struct ConversationAnchorPanel {
  @Prop conversationId: string = '';
  @Prop @Watch('refreshList') revision: number = 0;
  @Prop @Watch('resume') visible: boolean = true;
  @Link @Watch('resumeWhenIdle') busy: boolean;
  @Prop suspended: boolean = false;
  onUpdated: (view: ConversationView) => void = (): void => {};
  onReadResults: () => void = (): void => {};
  @State private anchors: ConversationAnchor[] = [];
  @State private followEnabled: boolean = false;
  @State private error: string = '';
  private service: ConversationService = new ConversationService();
  private generation: number = 0;
  private readGeneration: number = 0;
  private running: boolean = false;
  private coldSync: boolean = false;
  private timer: number = -1;
  private keys: Map<string, string> = new Map<string, string>();
  aboutToAppear(): void {
    this.generation++; this.refreshList();
    this.timer = setInterval(() => {
      if (!this.visible || !this.followEnabled || this.busy || this.suspended || !this.anchors.some((a: ConversationAnchor) => a.mode === 'FOLLOWING' || a.mode === 'LATER')) return;
      this.sync();
    }, 15000);
  }
  aboutToDisappear(): void { this.generation++; if (this.timer !== -1) clearInterval(this.timer); }
  private resume(): void { if (this.visible) this.refreshList(); }
  private resumeWhenIdle(): void { if (!this.busy && !this.coldSync && this.followEnabled && this.visible && !this.suspended && this.anchors.length > 0) { this.coldSync = true; this.sync(); } }
  private async refreshList(): Promise<void> {
    if (this.conversationId === '' || this.running || !this.visible) return;
    const epoch = this.generation, ticket = ++this.readGeneration;
    try {
      const reply = await this.service.anchors(this.conversationId);
      if (epoch !== this.generation || ticket !== this.readGeneration) return;
      this.anchors = reply.anchors; this.followEnabled = reply.enabled;
      if (!this.coldSync && this.followEnabled && !this.busy && !this.suspended && this.anchors.length > 0) {
        this.coldSync = true; this.sync();
      }
    } catch (e) { if (epoch === this.generation && ticket === this.readGeneration) this.error = e.message; }
  }
  private apply(reply: ConversationAnchorReply): void {
    this.anchors = reply.anchors;
    if (reply.enabled !== undefined) this.followEnabled = reply.enabled;
    this.onUpdated(reply.conversation);
  }
  private async sync(explicit: boolean = false): Promise<void> {
    if (this.running || this.busy || this.suspended || !this.visible) return;
    const epoch = this.generation; this.running = true; this.busy = true; this.readGeneration++;
    try { const reply = await this.service.syncAnchors(this.conversationId); if (epoch === this.generation) { this.apply(reply); this.error = ''; if (explicit) this.onReadResults(); } }
    catch (e) { if (epoch === this.generation) this.error = e.message; }
    finally { this.running = false; if (epoch === this.generation) this.busy = false; }
  }
  private async act(anchor: ConversationAnchor, action: string): Promise<void> {
    if (this.running || this.busy || this.suspended) return;
    const epoch = this.generation; this.running = true; this.busy = true; this.readGeneration++;
    const fingerprint = anchor.id + ':' + anchor.version + ':' + action + ':' + anchor.projectedSeq;
    const input = new ConversationAnchorInput(); input.requestId = this.keys.get(fingerprint) ?? util.generateRandomUUID();
    this.keys.set(fingerprint, input.requestId); input.expectedVersion = anchor.version; input.action = action;
    if (action === 'ACK') input.seenSeq = anchor.projectedSeq;
    try { const reply = await this.service.updateAnchor(this.conversationId, anchor.id, input); if (epoch === this.generation) { this.apply(reply); this.error = ''; } }
    catch (e) {
      if (epoch === this.generation) { this.error = e.message;
        try { const reply = await this.service.anchors(this.conversationId); if (epoch === this.generation) { this.anchors = reply.anchors; this.followEnabled = reply.enabled; } } catch (ignored) { /* Preserve the original error. */ }
      }
    }
    finally { this.running = false; if (epoch === this.generation) this.busy = false; }
  }
  private status(anchor: ConversationAnchor): string {
    if (anchor.unread > 0) return anchor.unread + ' 条未读';
    return anchor.mode === 'FOLLOWING' ? '关注中' : anchor.mode === 'LATER' ? '稍后再看' : anchor.mode === 'STOPPED' ? '已停止关注' : '';
  }
  @Builder private Action(anchor: ConversationAnchor, action: string, label: string) {
    Button(label, { type: ButtonType.Normal }).height(48).padding({ left: 8, right: 8 }).fontSize(12).fontColor(PMColors.BRAND)
      .backgroundColor(Color.Transparent).enabled(!this.busy && !this.suspended).onClick(() => { this.act(anchor, action); })
  }
  build() {
    if (this.anchors.length > 0 || this.error !== '') {
      Column({ space: 8 }) {
        if (this.anchors.length > 0) {
          Row() {
            Text('讨论后续').fontSize(13).fontColor(PMColors.INK_SECONDARY)
            Blank()
            Button('读取新结果', { type: ButtonType.Normal }).height(48).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
              .enabled(!this.busy && !this.suspended).onClick(() => { this.sync(true); })
          }.width('100%')
          ForEach(this.anchors, (anchor: ConversationAnchor) => {
            Column({ space: 4 }) {
              Text(anchor.title).fontSize(14).lineHeight(22).fontColor(PMColors.INK_PRIMARY).width('100%')
              if (this.status(anchor) !== '') { Text(this.status(anchor)).fontSize(12).fontColor(PMColors.BRAND) }
              Flex({ wrap: FlexWrap.Wrap }) {
                if (this.followEnabled && anchor.mode !== 'FOLLOWING') { this.Action(anchor, 'FOLLOW', '关注后续') }
                if (this.followEnabled && anchor.mode === 'FOLLOWING') { this.Action(anchor, 'LATER', '稍后再看') }
                if (anchor.mode === 'FOLLOWING' || anchor.mode === 'LATER') { this.Action(anchor, 'STOP', '停止关注') }
                if (anchor.unread > 0) { this.Action(anchor, 'ACK', '标记已读') }
              }.width('100%')
            }.width('100%').alignItems(HorizontalAlign.Start).padding({ bottom: 8 }).border({ width: { bottom: 1 }, color: PMColors.BORDER })
          }, (anchor: ConversationAnchor) => anchor.id)
        }
        if (this.error !== '') {
          Text(this.error).fontSize(12).lineHeight(20).fontColor(PMColors.RISK)
          PMButton({ label: '重试', secondary: true, disabled: this.busy || this.suspended, onAction: (): void => { this.refreshList(); } })
        }
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
}
