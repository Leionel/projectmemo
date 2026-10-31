import { ClaimCorrection } from './ClaimCorrection';
import { ConversationService } from "../services/ConversationService";
import router from '@ohos.router';
import { AgentMemoryService } from '../services/AgentMemoryService';
import { DigestListView, MemoryDigestView, HypothesisListView, HypothesisView, HypothesisEvidence, AgentMemoryReply } from '../models/AgentMemory';
import { ExperienceListReply, ExperienceHistoryRow, ExperienceActionBody, ExperienceRefreshBody } from '../models/Experience';
import { experienceStatusLabel, experienceSourceText, experienceUnknownText } from '../common/ExperienceContract';
import { ExperienceService } from '../services/ExperienceService';
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
  @State experience: ExperienceListReply | null = null;
  @State expanded: string = '';
  private epoch: number = 0;
  private service: AgentMemoryService = new AgentMemoryService();
  private experienceService: ExperienceService = new ExperienceService();
  private reset(): void { this.epoch++; this.opened = false; this.data = new DigestListView(); this.hypotheses = new HypothesisListView(); this.experience = null; this.expanded = ''; this.busy = false; this.error = ''; this.available = false; this.checkAvailability(); }
  aboutToAppear(): void { this.checkAvailability(); }
  private async checkAvailability(): Promise<void> { const token = this.epoch; try { const caps = await new ConversationService().capabilities(); if (token === this.epoch) this.available = caps.enabled; } catch { if (token === this.epoch) this.available = false; } }
  aboutToDisappear(): void { this.epoch++; }
  private async load(): Promise<void> {
    const token = ++this.epoch; this.busy = true; this.error = '';
    try { const reply = await this.service.memory(this.projectId); if (token === this.epoch) { this.data = reply.memory; this.hypotheses = reply.hypotheses; this.experience = reply.experience; } }
    catch (e) { if (token === this.epoch) { this.data = new DigestListView(); this.hypotheses = new HypothesisListView(); this.experience = null; this.error = (e as Error).message; } }
    finally { if (token === this.epoch) this.busy = false; }
  }
  private async refreshExperience(): Promise<void> {
    if (this.busy) { return; }
    const token = this.epoch; this.busy = true; this.error = '';
    try {
      const body: ExperienceRefreshBody = new ExperienceRefreshBody();
      body.requestId = `exp-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const reply = await this.experienceService.refresh(this.projectId, body);
      if (token === this.epoch) { this.experience = reply; }
    } catch (e) { if (token === this.epoch) { this.error = (e as Error).message; } }
    finally { if (token === this.epoch) { this.busy = false; } }
  }
  private async actExperience(item: ExperienceHistoryRow, action: string): Promise<void> {
    if (this.busy) { return; }
    this.busy = true; this.error = '';
    try {
      const body: ExperienceActionBody = new ExperienceActionBody();
      body.action = action;
      body.requestId = `exp-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      body.expectedVersion = item.version;
      await this.experienceService.act(this.projectId, item.id, body);
      await this.load();
    } catch (e) { this.error = (e as Error).message; }
    finally { this.busy = false; }
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
      Button(this.opened ? '收起当前理解' : '当前理解与待核实', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
        .fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).onClick(() => { this.opened = !this.opened; if (this.opened) this.load(); })
      if (this.opened) {
        Button('重新核对', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).enabled(!this.busy).onClick(() => { this.load(); })
        if (this.busy) { Text('正在核对来源与当前条件…').fontSize(12) }
        if (this.error) { Text(this.error).fontSize(13).fontColor(PMColors.INK_SECONDARY) }
        if (!this.busy && !this.error && this.data.items.length === 0) { Text('还没有调查综合，已有记录仍可在下方查看。').fontSize(13) }
        ForEach(this.data.items, (item: MemoryDigestView) => {
          Column({ space: 6 }) {
            Text(item.effectiveState === 'CURRENT' ? '当前理解' : '历史理解 · 需要重新核对').fontSize(12).fontColor(PMColors.INK_SECONDARY)
            Text(item.synthesis?.summary ?? '这份综合暂不可读，请回原调查查看。').fontSize(15).copyOption(CopyOptions.InApp)
            if (item.sourceMissionId) {
              Button('查看原调查与来源', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).onClick(() => {
                router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.sourceMissionId } });
              })
            }
            if (item.sourceConversationId) {
              Button('回原讨论接续', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).onClick(() => {
                router.pushUrl({ url: 'pages/FocusConversation', params: { conversationId: item.sourceConversationId } });
              })
            }
            Button(this.expanded === item.id ? '收起依据' : '依据、条件与待核实', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
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
        if (this.experience !== null && this.experience.enabled) {
          Row({ space: 8 }) {
            Text('方法经验与适用条件').fontSize(14).fontWeight(FontWeight.Medium)
            Button('整理当前真实结果', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
              .enabled(!this.busy).onClick(() => { this.refreshExperience(); })
          }.width('100%')
          ForEach(this.experience.experiences, (item: ExperienceHistoryRow) => {
            Column({ space: 4 }) {
              Row({ space: 6 }) {
                Text(item.title).fontSize(13).fontWeight(FontWeight.Medium).layoutWeight(1)
                Text(experienceStatusLabel(item)).fontSize(11).fontColor(PMColors.INK_SECONDARY)
              }.width('100%')
              Text(item.statement).fontSize(13).lineHeight(19)
              Text(`适用：${item.conditions.join('；')}`).fontSize(12).fontColor(PMColors.INK_TERTIARY)
              if (experienceUnknownText(item) !== '') { Text(experienceUnknownText(item)).fontSize(12).fontColor(PMColors.INK_TERTIARY) }
              Text(experienceSourceText(item)).fontSize(11).fontColor(PMColors.INK_TERTIARY)
              if (!item.eligibility.eligible) { Text(`未注入：${item.eligibility.reason}`).fontSize(11).fontColor(PMColors.INK_TERTIARY) }
              if (item.originMissionId !== null) {
                Button('回原结果核对', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
                  .onClick(() => { router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.originMissionId } }); })
              }
              if (item.status === 'ACTIVE') {
                Button('停用此经验', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
                  .enabled(!this.busy).onClick(() => { this.actExperience(item, 'REVOKE'); })
              } else if (item.status === 'SHADOW') {
                Button('激活为建议', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT)
                  .enabled(!this.busy).onClick(() => { this.actExperience(item, 'ACTIVATE'); })
              }
            }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: 8, bottom: 8 })
          }, (item: ExperienceHistoryRow) => item.id + ':' + item.version)
        }
        ForEach(this.hypotheses.items, (item: HypothesisView) => {
          Column({ space: 6 }) {
            Text(this.status(item.effectiveStatus)).fontSize(12).fontColor(PMColors.INK_SECONDARY)
            Text(item.statement).fontSize(15)
            if (item.effectiveStatus !== 'RESTRICTED') {
              Button(this.expanded === item.id ? '收起依据' : '条件与依据', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
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
                  Button('回原调查继续核对', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).onClick(() => {
                    router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.sourceMissionId } });
                  })
                }
                if (item.sourceConversationId) {
                  Button('回原讨论接续', { type: ButtonType.Normal }).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 }).onClick(() => {
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
