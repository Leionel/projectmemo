import { ClaimCorrection } from './ClaimCorrection';
import { ConversationService } from "../services/ConversationService";
import router from '@ohos.router';
import { AgentMemoryService } from '../services/AgentMemoryService';
import { DigestListView, MemoryDigestView, HypothesisListView, HypothesisView, HypothesisEvidence } from '../models/AgentMemory';
import { PMColors } from '../common/DesignTokens';

@Component
export struct AgentMemoryPanel {
  @Prop @Watch('reset') projectId: string = '';
  @State opened: boolean = false;
  @State available: boolean = false;
  @State busy: boolean = false;
  @State error: string = '';
  @State data: DigestListView = new DigestListView();
  @State hypotheses: HypothesisListView = new HypothesisListView();
  @State expanded: string = '';
  private epoch: number = 0;
  private service: AgentMemoryService = new AgentMemoryService();
  private reset(): void { this.epoch++; this.opened = false; this.data = new DigestListView(); this.hypotheses = new HypothesisListView(); this.expanded = ''; this.busy = false; this.error = ''; this.available = false; this.checkAvailability(); }
  aboutToAppear(): void { this.checkAvailability(); }
  private async checkAvailability(): Promise<void> { const token = this.epoch; try { const caps = await new ConversationService().capabilities(); if (token === this.epoch) this.available = caps.enabled; } catch { if (token === this.epoch) this.available = false; } }
  aboutToDisappear(): void { this.epoch++; }
  private async load(): Promise<void> {
    const token = ++this.epoch; this.busy = true; this.error = '';
    try { const reply = await this.service.memory(this.projectId); if (token === this.epoch) { this.data = reply.memory; this.hypotheses = reply.hypotheses; } }
    catch (e) { if (token === this.epoch) { this.data = new DigestListView(); this.hypotheses = new HypothesisListView(); this.error = (e as Error).message; } }
    finally { if (token === this.epoch) this.busy = false; }
  }
  private status(value: string): string {
    if (value === 'SUPPORTED') return '有条件支持';
    if (value === 'REFUTED') return '发现反例';
    if (value === 'INVESTIGATING') return '调查中';
    if (value === 'INCONCLUSIVE') return '尚无结论';
    if (value === 'EXPIRED') return '需要重核';
    if (value === 'RESTRICTED') return '暂不可读';
    return '待核实';
  }
  build() {
    Column({ space: 8 }) {
      if (this.available) {
      Button(this.opened ? '收起当前理解' : '当前理解与待核实', { type: ButtonType.Normal }).height(44)
        .fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).onClick(() => { this.opened = !this.opened; if (this.opened) this.load(); })
      if (this.opened) {
        Button('重新核对', { type: ButtonType.Normal }).height(44).enabled(!this.busy).onClick(() => { this.load(); })
        if (this.busy) { Text('正在核对来源与当前条件…').fontSize(12) }
        if (this.error) { Text(this.error).fontSize(13).fontColor(PMColors.INK_SECONDARY) }
        if (!this.busy && !this.error && this.data.items.length === 0) { Text('还没有调查综合，已有记录仍可在下方查看。').fontSize(13) }
        ForEach(this.data.items, (item: MemoryDigestView) => {
          Column({ space: 6 }) {
            Text(item.effectiveState === 'CURRENT' ? '当前理解' : '历史理解 · 需要重新核对').fontSize(12).fontColor(PMColors.INK_SECONDARY)
            Text(item.synthesis?.summary ?? '这份综合暂不可读，请回原调查查看。').fontSize(15).copyOption(CopyOptions.InApp)
            if (item.sourceMissionId) {
              Button('查看原调查与来源', { type: ButtonType.Normal }).height(44).onClick(() => {
                router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.sourceMissionId } });
              })
            }
            if (item.sourceConversationId) {
              Button('回原讨论接续', { type: ButtonType.Normal }).height(44).onClick(() => {
                router.pushUrl({ url: 'pages/FocusConversation', params: { conversationId: item.sourceConversationId } });
              })
            }
            Button(this.expanded === item.id ? '收起依据' : '依据、条件与待核实', { type: ButtonType.Normal }).height(44)
              .onClick(() => { this.expanded = this.expanded === item.id ? '' : item.id; })
            if (this.expanded === item.id && item.synthesis) {
              Text('这是带来源的模型综合，不是独立证据。').fontSize(12)
              ForEach(item.synthesis.conditions, (line: string) => { Text(line).fontSize(13) })
              ForEach(item.synthesis.retainedReasons, (line: string) => { Text(line).fontSize(13) })
              if (item.origin) { ClaimCorrection({ projectId: this.projectId, sourceId: item.origin.id, kind: item.origin.kind, onChanged: (): void => { this.load(); } }) }
              Text('待核实').fontSize(14).fontWeight(FontWeight.Medium)
              ForEach(item.synthesis.openQuestions, (line: string) => { Text(line).fontSize(13) })
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 8, bottom: 8 })
        }, (item: MemoryDigestView) => item.id)
        ForEach(this.hypotheses.items, (item: HypothesisView) => {
          Column({ space: 6 }) {
            Text(this.status(item.effectiveStatus)).fontSize(12).fontColor(PMColors.INK_SECONDARY)
            Text(item.statement).fontSize(15)
            if (item.effectiveStatus !== 'RESTRICTED') {
              Button(this.expanded === item.id ? '收起依据' : '条件与依据', { type: ButtonType.Normal }).height(44)
                .onClick(() => { this.expanded = this.expanded === item.id ? '' : item.id; })
              if (this.expanded === item.id) {
                ForEach(item.conditions, (line: string) => { Text(line).fontSize(13) })
                Text(item.explanation ?? '').fontSize(13)
                if (item.qualificationReason) { Text(item.qualificationReason).fontSize(13) }
                ForEach(item.evidence, (e: HypothesisEvidence) => {
                  Text(`${e.role === 'COUNTER' ? '反例' : '线索'}：${e.quote}${e.qualified ? '' : ' · 尚不构成独立证据'}`).fontSize(13)
                })
                if (item.nextInformationNeed) { Text(`下一步核对：${item.nextInformationNeed}`).fontSize(13) }
                if (item.sourceMissionId) {
                  Button('回原调查继续核对', { type: ButtonType.Normal }).height(44).onClick(() => {
                    router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.sourceMissionId } });
                  })
                }
                if (item.sourceConversationId) {
                  Button('回原讨论接续', { type: ButtonType.Normal }).height(44).onClick(() => {
                    router.pushUrl({ url: 'pages/FocusConversation', params: { conversationId: item.sourceConversationId } });
                  })
                }
                ClaimCorrection({ projectId: this.projectId, sourceId: item.id, kind: 'CLAIM', onChanged: (): void => { this.load(); } })
              }
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 8, bottom: 8 })
        }, (item: HypothesisView) => item.id)
        if (this.data.coverage.hasMore) { Text('这里只展示最近的部分综合，更多背景请回原任务核对。').fontSize(12) }
      }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
