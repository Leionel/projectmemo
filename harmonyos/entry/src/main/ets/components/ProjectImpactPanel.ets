import { ImpactReply, ImpactItem, ImpactEdge } from '../models/DecisionEvolution';
import { DecisionEvolutionService } from '../services/DecisionEvolutionService';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { PMColors, PMFontSize, PMRadius } from '../common/DesignTokens';
@Component
export struct ProjectImpactPanel {
 @Prop projectId: string = '';
 @State open: boolean = false;
 @State data: ImpactReply | null = null;
 @State busy: boolean = false;
 @State error: string = '';
 private generation: number = 0;
 private expired: () => void = () => { this.generation++; this.data = null; this.error = ''; this.busy = false; };
 aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); }
 aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
 private async load(): Promise<void> {
  const g = ++this.generation; const token = SessionStore.getToken(); this.busy = true; this.error = '';
  try { const reply = await new DecisionEvolutionService().impact(this.projectId); if (g !== this.generation || token !== SessionStore.getToken()) return; this.data = reply; }
  catch (e) { if (g !== this.generation || token !== SessionStore.getToken()) return; this.error = e instanceof ApiError ? e.message : '影响摘要暂不可用'; if (e instanceof ApiError && [401, 403, 404].includes(e.status)) this.data = null; }
  finally { if (g === this.generation) this.busy = false; }
 }
 private label(kind: string): string { return kind === 'PLAN_STALE' ? '计划需重评' : kind === 'HARD_PREREQUISITE_UNMET' ? '硬前提未满足' : kind === 'SUPPORT_CHANGED' ? '支持变化' : '需要复核'; }
 build() {
  Column({ space: 10 }) {
   Button(this.open ? '收起资料影响路径' : '新资料影响了哪些计划与成果').height(44).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).onClick(() => { this.open = !this.open; if (this.open && this.data === null) this.load(); })
   if (this.open) {
    if (this.error !== '') { Text(`${this.error}${this.data !== null ? '；以下为上次读取的历史结果' : ''}`).fontSize(12).fontColor(PMColors.RISK) }
    Button(this.busy ? '正在读取影响路径…' : '重新读取影响').height(44).enabled(!this.busy).onClick(() => { this.load(); }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
    if (this.data !== null && this.data.enabled) {
     Text(`读取于 ${this.data.assessment.observedAt} · ${this.data.assessment.coverage.state === 'COMPLETE' ? '当前窄范围已覆盖' : '范围不完整，部分影响未知'} · ${this.data.pendingJobs} 项影响处理待完成`).fontSize(12)
     Text(this.data.assessment.note).fontSize(12).fontColor(PMColors.INK_SECONDARY)
     if (this.data.assessment.items.length === 0) { Text('当前范围内没有找到相关路径；未映射来源的旧文稿不在自动判断范围。').fontSize(13) }
     ForEach(this.data.assessment.items.slice(0, 8), (item: ImpactItem) => {
      Column({ space: 6 }) {
       Text(`${this.label(item.kind)} · ${item.title}${item.historical ? '（历史保留）' : ''}`).fontSize(14).fontWeight(FontWeight.Medium)
       ForEach(item.path, (e: ImpactEdge) => { Text(`${e.fromTitle || e.from} → ${e.toTitle || e.to}`).fontSize(11).fontColor(PMColors.INK_TERTIARY) })
      }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(12)
     }, (item: ImpactItem) => item.target)
    }
   }
  }.width('100%').alignItems(HorizontalAlign.Start)
 }
}
