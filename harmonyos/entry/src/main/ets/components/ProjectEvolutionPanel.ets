import { MemoryService } from '../services/MemoryService';
import { SessionStore } from '../services/SessionStore';
import { TemporalDecisionItem, TemporalRelation } from '../models/Memory';
import { PMColors, PMSpacing, PMRadius } from '../common/DesignTokens';

@Component
export struct ProjectEvolutionPanel {
  @Prop projectId: string = '';
  onOpenSources: (cardId: string) => void = (_cardId: string): void => {};
  @State items: TemporalDecisionItem[] = [];
  @State loading: boolean = true;
  @State error: string = '';
  @State evaluatedAt: string = '';
  @State relationsEnabled: boolean = true;
  @State limit: number = 5;
  @State expandedId: string = '';
  private generation: number = 0;
  private expired: () => void = (): void => { this.generation++; this.items = []; this.evaluatedAt = ''; this.loading = false; this.error = '请重新登录后查看项目演进'; };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.read(); }
  aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
  private async read(): Promise<void> {
    const generation = ++this.generation; const token = SessionStore.getToken();
    this.loading = true; this.error = '';
    try {
      const value = await new MemoryService().getDecisionTimeline(this.projectId);
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      this.items = value.items.slice().sort((a: TemporalDecisionItem, b: TemporalDecisionItem) => Date.parse(b.card.createdAt) - Date.parse(a.card.createdAt));
      this.evaluatedAt = value.asOf; this.relationsEnabled = value.enabled;
    } catch (_e) {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      this.items = []; this.evaluatedAt = ''; this.error = '项目演进暂未加载，请重试';
    } finally { if (generation === this.generation) this.loading = false; }
  }
  private relationLabel(value: string): string {
    if (value === 'SUPERSEDES') return '取代';
    if (value === 'CONTRADICTS') return '反驳';
    if (value === 'SUPPORTS') return '支持';
    if (value === 'DERIVED_FROM') return '源自';
    return '关联';
  }
  build() {
    Column({ space: PMSpacing.SM }) {
      Text('结论与关系演进').fontSize(18).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
      Text('按原始记录时间排列；状态来自当前核验，关系确认和撤销时间单独列出。').fontSize(14).fontColor(PMColors.INK_SECONDARY)
      if (this.loading) { Text('正在读取已记录的结论与关系…').fontSize(14) }
      else if (this.error !== '') {
        Text(this.error).fontSize(14).fontColor(PMColors.RISK)
        Button('重新读取项目演进').constraintSize({ minHeight: 48 }).onClick(() => { this.read(); })
      } else {
        if (!this.relationsEnabled) { Text('时态关系评估当前关闭；下方仅供查看原始记录。').fontSize(14).fontColor(PMColors.INK_SECONDARY) }
        if (this.evaluatedAt !== '') { Text(`本次核验：${this.evaluatedAt}`).fontSize(13).fontColor(PMColors.INK_SECONDARY) }
        if (this.items.length === 0) { Text('尚无可展示的结论记录，可先留下真实资料。').fontSize(14).fontColor(PMColors.INK_SECONDARY) }
        ForEach(this.items.slice(0, this.limit), (item: TemporalDecisionItem) => {
          Column({ space: PMSpacing.XS }) {
            Text(`记录于 ${item.card.createdAt}`).fontSize(13).fontColor(PMColors.INK_SECONDARY)
            Text(item.card.title).fontSize(16).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
            if (this.relationsEnabled) {
              Text(`当前核验：${item.statusLabel} · ${item.displayReason}`).fontSize(14).fontColor(PMColors.INK_SECONDARY)
              if (item.supersededBy !== null) { Text(`取代方向：${item.supersededBy.title}`).fontSize(14).fontColor(PMColors.INK_SECONDARY) }
            }
            Button('查看这条来源原文').constraintSize({ minHeight: 48 }).backgroundColor(PMColors.BRAND_LIGHT)
              .fontColor(PMColors.BRAND).onClick(() => { this.onOpenSources(item.card.id); })
            if (item.relations.length > 0) { Button(this.expandedId === item.card.id ? '收起依据与关系' : `查看依据与关系（${item.relations.length}）`)
              .constraintSize({ minHeight: 48 }).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND)
              .onClick(() => { this.expandedId = this.expandedId === item.card.id ? '' : item.card.id; }) }
            if (this.expandedId === item.card.id) {
            ForEach(item.relations, (relation: TemporalRelation) => {
              Text(`${relation.currentCard.title} → ${this.relationLabel(relation.relationType)} → ${relation.relatedCard.title}\n${relation.reason}\n${relation.confirmedAt === null ? '尚未确认' : `确认于 ${relation.confirmedAt}`}${relation.revokedAt === null ? '' : `；撤销于 ${relation.revokedAt}`}`)
                .fontSize(14).fontColor(PMColors.INK_SECONDARY)
              Button('查看关联来源').constraintSize({ minHeight: 48 }).backgroundColor(PMColors.BRAND_LIGHT)
                .fontColor(PMColors.BRAND).onClick(() => { this.onOpenSources(relation.relatedCard.id); })
            }, (relation: TemporalRelation) => relation.id)
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD)
            .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
        }, (item: TemporalDecisionItem) => item.card.id)
        if (this.items.length > this.limit) { Button('继续查看结论记录').constraintSize({ minHeight: 48 }).onClick(() => { this.limit += 5; }) }
      }
      Button('到资料页查看全部来源').constraintSize({ minHeight: 48 }).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND).onClick(() => { this.onOpenSources(''); })
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.LG).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
  }
}
