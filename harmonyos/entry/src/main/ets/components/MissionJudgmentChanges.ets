import { HypothesisView, HypothesisEvidence, AgentMemoryReply } from '../models/AgentMemory';
import { AgentMemoryService } from '../services/AgentMemoryService';
import { SessionStore } from '../services/SessionStore';
import { PMColors, PMRadius } from '../common/DesignTokens';
import { shortPacketTime } from '../models/WorkPacket';

/**
 * 本委托形成的判断如何随新证据改变；与 Web MissionJudgmentChanges 同口径。
 * 只读原项目判断投影，判断是有条件的模型评估，详情与纠正仍在 Web 项目判断页。
 */
@Component
export struct MissionJudgmentChanges {
  @Prop projectId: string = '';
  @Prop missionId: string = '';
  @Prop @Watch('load') missionVersion: number = 0;
  @State private items: HypothesisView[] = [];
  private generation: number = 0;

  aboutToAppear(): void { this.load(); }

  load(): void {
    if (this.projectId === '' || this.missionId === '') return;
    const generation = ++this.generation;
    const token = SessionStore.getToken();
    new AgentMemoryService().memory(this.projectId).then((reply: AgentMemoryReply) => {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      this.items = reply.hypotheses.items.filter((h: HypothesisView) => h.sourceMissionId === this.missionId &&
        ((h.history ?? []).length > 1 || ['REFUTED', 'INCONCLUSIVE', 'EXPIRED'].includes(h.effectiveStatus))).slice(0, 3);
    }).catch(() => { if (generation === this.generation) this.items = []; });
  }

  private label(state: string | undefined): string {
    const labels: Record<string, string> = { 'PROPOSED': '待核实', 'INVESTIGATING': '调查中', 'SUPPORTED': '有条件支持', 'REFUTED': '发现反例',
      'INCONCLUSIVE': '尚无结论', 'EXPIRED': '需要重核', 'RESTRICTED': '暂不可读' };
    return labels[state ?? ''] ?? '待核实';
  }

  private stateLine(h: HypothesisView): string {
    const history = h.history ?? [];
    const head = history.length > 1 ? this.label(history[1].state) + ' → ' + this.label(h.effectiveStatus) : this.label(h.effectiveStatus);
    return history.length > 0 ? head + ' · ' + shortPacketTime(history[0].at) : head;
  }

  private previousStatement(h: HypothesisView): string {
    const history = h.history ?? [];
    const previous = history.length > 1 ? history[1].statement ?? '' : '';
    return previous !== '' && previous !== h.statement ? previous : '';
  }

  private counters(h: HypothesisView): number {
    return h.evidence.filter((e: HypothesisEvidence) => e.role === 'COUNTER' && e.qualified).length;
  }

  build() {
    if (this.items.length > 0) {
      Column({ space: 10 }) {
        Text('判断变化').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        ForEach(this.items, (h: HypothesisView) => {
          Column({ space: 4 }) {
            Text(this.stateLine(h)).fontSize(12).fontColor(PMColors.INK_SECONDARY)
            Text(h.statement).fontSize(14).lineHeight(21).fontColor(PMColors.INK_PRIMARY).width('100%')
            if (this.previousStatement(h) !== '') {
              Text('原判断：' + this.previousStatement(h)).fontSize(13).lineHeight(19).fontColor(PMColors.INK_TERTIARY)
                .decoration({ type: TextDecorationType.LineThrough, color: PMColors.BORDER })
            }
            if (this.counters(h) > 0) {
              Text(this.counters(h) + ' 处反例来自已核对的原文').fontSize(12).fontColor(PMColors.INK_TERTIARY)
            }
          }.width('100%').alignItems(HorizontalAlign.Start)
        }, (h: HypothesisView) => h.id + ':' + h.revision)
      }.width('100%').alignItems(HorizontalAlign.Start).padding(14)
        .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.CARD).border({ width: 1, color: PMColors.BORDER_SUBTLE })
    }
  }
}
