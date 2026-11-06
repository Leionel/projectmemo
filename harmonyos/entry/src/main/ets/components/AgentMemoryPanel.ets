import { alertError } from '../common/ErrorAlert';
import { ClaimCorrection } from './ClaimCorrection';
import { ConversationService } from "../services/ConversationService";
import router from '@ohos.router';
import { AgentMemoryService } from '../services/AgentMemoryService';
import { DigestListView, MemoryDigestView, HypothesisListView, HypothesisView, HypothesisEvidence } from '../models/AgentMemory';
import { ExperienceListReply, ExperienceHistoryRow, ExperienceActionBody, ExperienceRefreshBody } from '../models/Experience';
import { experienceStatusLabel, experienceSourceText, experienceUnknownText } from '../common/ExperienceContract';
import { ExperienceService } from '../services/ExperienceService';
import { PMColors, PMFontSize, PMRadius, PMSpacing, PMInteraction } from '../common/DesignTokens';

/**
 * 层 1「项目当前理解」+ 层 2「方法经验与适用条件」。
 * 结论优先：进入页面就读取，不再要求先展开面板；「重新核对」是标题行里的次要动作，不单独占一行按钮。
 * 异步状态如实展示：读取中、读取失败、空态各有独立文案，不用占位数据撑版。
 */
@Component
export struct AgentMemoryPanel {
  @Prop @Watch('reset') projectId: string = '';
  @State available: boolean = false;
  @State busy: boolean = false;
  @State @Watch('alertError') error: string = '';
  private alertError(): void { alertError(this.error); }
  @State data: DigestListView = new DigestListView();
  @State hypotheses: HypothesisListView = new HypothesisListView();
  @State experience: ExperienceListReply | null = null;
  @State expanded: string = '';
  private epoch: number = 0;
  private service: AgentMemoryService = new AgentMemoryService();
  private experienceService: ExperienceService = new ExperienceService();
  private reset(): void { this.epoch++; this.data = new DigestListView(); this.hypotheses = new HypothesisListView(); this.experience = null; this.expanded = ''; this.busy = false; this.error = ''; this.available = false; this.checkAvailability(); }
  aboutToAppear(): void { this.checkAvailability(); }
  private async checkAvailability(): Promise<void> {
    const token = this.epoch;
    try {
      const caps = await new ConversationService().capabilities();
      if (token === this.epoch) {
        this.available = caps.enabled;
        if (this.available) { await this.load(); }
      }
    } catch {
      if (token === this.epoch) { this.available = false; }
    }
  }
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

  @Builder
  private inlineAction(label: string, enabled: boolean, action: () => void) {
    Text(label)
      .fontSize(PMFontSize.CAPTION)
      .fontWeight(FontWeight.Medium)
      .fontColor(enabled ? PMColors.BRAND : PMColors.INK_MUTED)
      .constraintSize({ minHeight: 32 })
      .padding({ left: 2, right: PMSpacing.MD })
      .clickEffect(PMInteraction.PRESS_EFFECT)
      .onClick(() => {
        if (enabled) { action(); }
      })
  }

  build() {
    Column({ space: PMSpacing.MD }) {
      if (this.available) {
        // ---------------- 第 1 层：项目当前理解（结论优先） ----------------
        Column({ space: PMSpacing.SM }) {
          Row({ space: PMSpacing.SM }) {
            Text('项目当前理解')
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .layoutWeight(1)
            Text(this.busy ? '核对中…' : '重新核对')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.busy ? PMColors.INK_MUTED : PMColors.BRAND)
              .constraintSize({ minHeight: 32 })
              .padding({ left: PMSpacing.SM })
              .clickEffect(PMInteraction.PRESS_EFFECT)
              .accessibilityText('重新核对当前理解与来源')
              .onClick(() => {
                if (!this.busy) { this.load(); }
              })
          }
          .width('100%')
          .alignItems(VerticalAlign.Center)

          if (this.busy && this.data.items.length === 0) {
            Text('正在核对来源与当前条件…')
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.INK_TERTIARY)
          } else if (this.error !== '') {
            Text(this.error)
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.RISK)
              .lineHeight(19)
          } else if (this.data.items.length === 0) {
            Text('还没有调查综合；记录事实并完成一次调查后，这里会给出项目当前理解。')
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.INK_TERTIARY)
              .lineHeight(19)
          } else {
            ForEach(this.data.items, (item: MemoryDigestView) => {
              Column({ space: 6 }) {
                Row({ space: 6 }) {
                  Text(item.effectiveState === 'CURRENT' ? '当前理解' : '历史理解')
                    .fontSize(11)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(item.effectiveState === 'CURRENT' ? PMColors.MEMORY : PMColors.INK_TERTIARY)
                  if (item.effectiveState !== 'CURRENT') {
                    Text('需要重新核对')
                      .fontSize(11)
                      .fontColor(PMColors.WARNING)
                  }
                }
                .width('100%')

                Text(item.synthesis?.summary ?? '这份综合暂不可读，请回原调查查看。')
                  .fontSize(PMFontSize.BODY)
                  .lineHeight(22)
                  .fontColor(PMColors.INK_PRIMARY)
                  .copyOption(CopyOptions.InApp)

                Row({ space: 0 }) {
                  this.inlineAction(this.expanded === item.id ? '收起依据' : '依据、条件与待核实', true,
                    (): void => { this.expanded = this.expanded === item.id ? '' : item.id; })
                  if (item.sourceMissionId) {
                    this.inlineAction('原调查 ›', true, (): void => {
                      router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.sourceMissionId } });
                    })
                  }
                  if (item.sourceConversationId) {
                    this.inlineAction('原讨论 ›', true, (): void => {
                      router.pushUrl({ url: 'pages/FocusConversation', params: { conversationId: item.sourceConversationId } });
                    })
                  }
                }
                .width('100%')

                if (this.expanded === item.id && item.synthesis) {
                  Column({ space: 6 }) {
                    Text('这是带来源的模型综合，不是独立证据。')
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)
                    ForEach(item.synthesis.conditions, (line: string) => {
                      Text(line)
                        .fontSize(PMFontSize.SECONDARY)
                        .fontColor(PMColors.INK_SECONDARY)
                        .lineHeight(19)
                    })
                    ForEach(item.synthesis.retainedReasons, (line: string) => {
                      Text(line)
                        .fontSize(PMFontSize.SECONDARY)
                        .fontColor(PMColors.INK_SECONDARY)
                        .lineHeight(19)
                    })
                    if (item.origin) { ClaimCorrection({ projectId: this.projectId, sourceId: item.origin.id, kind: item.origin.kind, onChanged: (): void => { this.load(); } }) }
                    if (item.synthesis.openQuestions.length > 0) {
                      Text('待核实')
                        .fontSize(PMFontSize.CAPTION)
                        .fontWeight(FontWeight.Medium)
                        .fontColor(PMColors.INK_TERTIARY)
                      ForEach(item.synthesis.openQuestions, (line: string) => {
                        Text(line)
                          .fontSize(PMFontSize.SECONDARY)
                          .fontColor(PMColors.INK_SECONDARY)
                          .lineHeight(19)
                      })
                    }
                  }
                  .width('100%')
                  .padding(PMSpacing.MD)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .alignItems(HorizontalAlign.Start)
                }
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
              .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
            }, (item: MemoryDigestView) => item.id)
          }

          if (this.data.coverage.hasMore) {
            Text('这里只展示最近的部分综合，更多背景请回原任务核对。')
              .fontSize(11)
              .fontColor(PMColors.INK_TERTIARY)
          }

          // 待核实清单：与"当前理解"同层，只在有内容时出现。
          if (this.hypotheses.items.length > 0) {
            Text(`待核实 ${this.hypotheses.items.length} 条`)
              .fontSize(PMFontSize.CAPTION)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: PMSpacing.XS })
            ForEach(this.hypotheses.items, (item: HypothesisView) => {
              Column({ space: 4 }) {
                Text(this.status(item.effectiveStatus))
                  .fontSize(11)
                  .fontColor(PMColors.INK_TERTIARY)
                Text(item.statement)
                  .fontSize(PMFontSize.SECONDARY)
                  .lineHeight(19)
                  .fontColor(PMColors.INK_PRIMARY)
                if (item.effectiveStatus !== 'RESTRICTED') {
                  this.inlineAction(this.expanded === item.id ? '收起条件与依据' : '条件与依据', true,
                    (): void => { this.expanded = this.expanded === item.id ? '' : item.id; })
                  if (this.expanded === item.id) {
                    ForEach(item.conditions, (line: string) => {
                      Text(line)
                        .fontSize(PMFontSize.SECONDARY)
                        .fontColor(PMColors.INK_SECONDARY)
                        .lineHeight(19)
                    })
                    if (item.explanation) {
                      Text(item.explanation)
                        .fontSize(PMFontSize.SECONDARY)
                        .fontColor(PMColors.INK_SECONDARY)
                        .lineHeight(19)
                    }
                    if (item.qualificationReason) {
                      Text(item.qualificationReason)
                        .fontSize(PMFontSize.SECONDARY)
                        .fontColor(PMColors.INK_SECONDARY)
                        .lineHeight(19)
                    }
                    ForEach(item.evidence, (e: HypothesisEvidence) => {
                      Text(`${e.role === 'COUNTER' ? '反例' : '线索'}：${e.quote}${e.qualified ? '' : ' · 尚不构成独立证据'}`)
                        .fontSize(PMFontSize.SECONDARY)
                        .fontColor(PMColors.INK_SECONDARY)
                        .lineHeight(19)
                    })
                    if (item.nextInformationNeed) {
                      Text(`下一步核对：${item.nextInformationNeed}`)
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_TERTIARY)
                        .lineHeight(18)
                    }
                    if (item.sourceMissionId) {
                      this.inlineAction('回原调查继续核对 ›', true, (): void => {
                        router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.sourceMissionId } });
                      })
                    }
                    if (item.sourceConversationId) {
                      this.inlineAction('回原讨论接续 ›', true, (): void => {
                        router.pushUrl({ url: 'pages/FocusConversation', params: { conversationId: item.sourceConversationId } });
                      })
                    }
                    ClaimCorrection({ projectId: this.projectId, sourceId: item.id, kind: 'CLAIM', onChanged: (): void => { this.load(); } })
                  }
                }
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
              .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
            }, (item: HypothesisView) => item.id)
          }
        }
        .width('100%')
        .padding(PMSpacing.LG)
        .backgroundColor(PMColors.SURFACE)
        .borderRadius(PMRadius.LG)
        .border({ width: 1, color: PMColors.BORDER_SUBTLE })
        .alignItems(HorizontalAlign.Start)

        // ---------------- 第 2 层：方法经验与适用条件 ----------------
        // 功能关闭时不渲染整块；空态只留一句说明，不撑出空白区域。
        if (this.experience !== null && this.experience.enabled) {
          Column({ space: PMSpacing.SM }) {
            Row({ space: PMSpacing.SM }) {
              Text('方法经验与适用条件')
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .layoutWeight(1)
              Text(this.busy ? '整理中…' : '整理当前结果')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(this.busy ? PMColors.INK_MUTED : PMColors.BRAND)
                .constraintSize({ minHeight: 32 })
                .padding({ left: PMSpacing.SM })
                .clickEffect(PMInteraction.PRESS_EFFECT)
                .accessibilityText('根据当前真实结果整理方法经验')
                .onClick(() => {
                  if (!this.busy) { this.refreshExperience(); }
                })
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)

            if (this.experience.experiences.length === 0) {
              Text('还没有沉淀方法经验；完成行动并写下结果后，可整理成带适用条件的经验。')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(19)
            } else {
              ForEach(this.experience.experiences, (item: ExperienceHistoryRow) => {
                Column({ space: 4 }) {
                  Row({ space: 6 }) {
                    Text(item.title)
                      .fontSize(PMFontSize.SECONDARY)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_PRIMARY)
                      .layoutWeight(1)
                      .maxLines(2)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                    Text(experienceStatusLabel(item))
                      .fontSize(11)
                      .fontColor(item.status === 'ACTIVE' ? PMColors.SUCCESS : PMColors.INK_TERTIARY)
                  }
                  .width('100%')
                  Text(item.statement)
                    .fontSize(PMFontSize.SECONDARY)
                    .fontColor(PMColors.INK_SECONDARY)
                    .lineHeight(19)
                  Text(`适用：${item.conditions.join('；')}`)
                    .fontSize(11)
                    .fontColor(PMColors.INK_TERTIARY)
                    .lineHeight(17)
                  if (experienceUnknownText(item) !== '') {
                    Text(experienceUnknownText(item))
                      .fontSize(11)
                      .fontColor(PMColors.INK_TERTIARY)
                      .lineHeight(17)
                  }
                  Text(experienceSourceText(item))
                    .fontSize(11)
                    .fontColor(PMColors.INK_TERTIARY)
                  if (!item.eligibility.eligible) {
                    Text(`未注入：${item.eligibility.reason}`)
                      .fontSize(11)
                      .fontColor(PMColors.INK_TERTIARY)
                      .lineHeight(17)
                  }
                  Row({ space: 0 }) {
                    if (item.originMissionId !== null) {
                      this.inlineAction('回原结果核对 ›', true, (): void => {
                        router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.originMissionId } });
                      })
                    }
                    if (item.status === 'ACTIVE') {
                      this.inlineAction('停用此经验', !this.busy, (): void => { this.actExperience(item, 'REVOKE'); })
                    } else if (item.status === 'SHADOW') {
                      this.inlineAction('激活为建议', !this.busy, (): void => { this.actExperience(item, 'ACTIVATE'); })
                    }
                  }
                  .width('100%')
                }
                .width('100%')
                .alignItems(HorizontalAlign.Start)
                .padding({ top: PMSpacing.SM, bottom: PMSpacing.SM })
                .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
              }, (item: ExperienceHistoryRow) => item.id + ':' + item.version)
            }
          }
          .width('100%')
          .padding(PMSpacing.LG)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER_SUBTLE })
          .alignItems(HorizontalAlign.Start)
        }
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
