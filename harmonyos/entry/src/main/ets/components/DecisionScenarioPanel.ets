import { alertError } from '../common/ErrorAlert';
import { DecisionProposal, DecisionChoice, DecisionInput, DecisionConfirm, DecisionReceipt } from '../models/DecisionEvolution';
import { DecisionEvolutionService } from '../services/DecisionEvolutionService';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { PMColors, PMFontSize, PMRadius } from '../common/DesignTokens';

/** 本轮方案比较：点选式对比卡；默认展示核心动作、投入、风险与执行权限，细节按需展开。 */
@Component
export struct DecisionScenarioPanel {
 @Prop missionId: string = '';
 @Prop disabled: boolean = false;
 @State open: boolean = false;
 @State available: string = '';
 @State estimate: string = '';
 @State allowActions: boolean = false;
 @State cloud: boolean = false;
 @State proposal: DecisionProposal | null = null;
 @State selected: string = '';
 @State receipt: DecisionReceipt | null = null;
 @State busy: boolean = false;
 @State @Watch('alertError') error: string = '';
 private alertError(): void { alertError(this.error); }
 @State expanded: string = '';
 onAdopted: () => void = (): void => {};
 private generation: number = 0;
 private loaded: boolean = false;
 private keys: Record<string, string> = {};
 private expired: () => void = () => { this.generation++; this.proposal = null; this.receipt = null; this.available = ''; this.estimate = ''; this.selected = ''; this.cloud = false; this.allowActions = false; this.busy = false; };
 aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); if (!this.loaded) { this.loaded = true; this.perform('latest'); } }
 aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
 private requestKey(body: Object): string { const value = JSON.stringify(body); if (this.keys[value] === undefined) { this.keys[value] = `decision-${Date.now()}-${Math.random().toString(36).slice(2)}`; } return this.keys[value]; }
 private valid(g: number, token: string): boolean { return g === this.generation && token === SessionStore.getToken(); }
 private stale(): boolean { return this.proposal !== null && (this.proposal.stale || new Date(this.proposal.expiresAt).getTime() <= Date.now()); }
 private async perform(action: string): Promise<void> {
  if (this.busy || this.disabled && !['read', 'latest'].includes(action)) { return; }
  const g = this.generation; const token = SessionStore.getToken(); this.busy = true; this.error = '';
  try {
   const service = new DecisionEvolutionService();
   if (action === 'latest') { const reply = await service.latest(this.missionId); if (!this.valid(g, token)) { return; } this.proposal = reply.proposal; this.receipt = reply.proposal?.receipt ?? null; } else if (action === 'create') {
    const body = new DecisionInput(); body.availableMinutes = Number(this.available); body.deliveryMinutes = Number(this.estimate); body.allowActionProposals = this.allowActions; body.requestModelAdvice = this.cloud; body.parentId = this.proposal !== null && !['CONFIRMED', 'REJECTED'].includes(this.proposal.status) ? this.proposal.id : undefined; body.requestId = this.requestKey(body);
    const reply = await service.create(this.missionId, body); if (!this.valid(g, token)) { return; } this.proposal = reply.proposal; this.receipt = null;
   } else if (this.proposal !== null && action === 'read') { const reply = await service.read(this.proposal.id); if (!this.valid(g, token)) { return; } this.proposal = reply.proposal; this.receipt = reply.proposal?.receipt ?? null; }
   else if (this.proposal !== null && action === 'adopt') {
    const body = new DecisionConfirm(); body.proposalHash = this.proposal.proposalHash; body.scenarioKey = this.selected; body.expectedVersion = this.proposal.currentVersion ?? this.proposal.base.expectedVersion; body.requestId = this.requestKey(body);
    const result = await service.adopt(this.proposal.id, body); if (!this.valid(g, token)) { return; } this.receipt = result.receipt; this.onAdopted();
   } else if (this.proposal !== null && action === 'reject') { await service.reject(this.proposal.id); if (!this.valid(g, token)) { return; } this.proposal.status = 'REJECTED'; this.selected = ''; }
  } catch (e) { if (!this.valid(g, token)) { return; } this.error = e instanceof ApiError ? e.message : '结果尚未确认，请重新读取原方案'; if (e instanceof ApiError && e.status === 409 && this.proposal !== null) { this.proposal.stale = true; } if (e instanceof ApiError && [401, 403, 404].includes(e.status)) { this.expired(); } }
  finally { if (g === this.generation) { this.busy = false; } }
 }
 @Builder
 private ChoiceCard(s: DecisionChoice, index: number) {
  Column({ space: 6 }) {
   Row({ space: 8 }) {
    Text(`${index + 1}`).fontSize(13).fontWeight(FontWeight.Bold).fontColor(this.selected === s.key ? PMColors.BRAND : PMColors.INK_TERTIARY)
      .width(26).height(26).textAlign(TextAlign.Center).backgroundColor(this.selected === s.key ? PMColors.BRAND_LIGHT : PMColors.SURFACE).borderRadius(13)
    Text(s.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
    if (this.selected === s.key) { Text('已选择').fontSize(11).fontColor(PMColors.BRAND) }
   }.width('100%')
   Text('预计投入：' + (s.minutes === null ? '时长待核对，非保证时间' : `${s.minutes} 分钟（${s.estimateSource}）`)).fontSize(12).fontColor(PMColors.INK_SECONDARY)
   if (s.reasons.length > 0) { Text('主要风险：' + s.reasons[0]).fontSize(12).fontColor(PMColors.RISK).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }) }
   Text('执行权限：' + (s.executionBoundary === 'READ_ANALYZE' ? '仅读取、分析和保存草稿' : '可提议行动，创建仍需批准')).fontSize(12).fontColor(PMColors.INK_SECONDARY)
   if (this.expanded === s.key) {
    if (s.tradeoff !== '') { Text(s.tradeoff).fontSize(13).fontColor(PMColors.INK_PRIMARY).lineHeight(20) }
    ForEach(s.reasons.slice(1), (r: string) => { Text('风险：' + r).fontSize(12).fontColor(PMColors.RISK) }, (r: string) => r)
    Text(s.modelTradeoff === undefined ? '依据：规则对比，未使用模型权衡' : `模型补充（非保证）：${s.modelTradeoff}`).fontSize(12).fontColor(PMColors.INK_SECONDARY)
   }
   if (s.feasibility !== 'READY') { Text('当前条件暂不满足，无法选择此方案').fontSize(12).fontColor(PMColors.INK_TERTIARY) }
   Text(this.expanded === s.key ? '收起方案细节 ⌃' : '方案细节与依据 ⌄').fontSize(12).fontColor(PMColors.BRAND)
     .onClick(() => { this.expanded = this.expanded === s.key ? '' : s.key; })
  }.width('100%').alignItems(HorizontalAlign.Start).padding(12)
   .backgroundColor(this.selected === s.key ? PMColors.BRAND_LIGHT : PMColors.SURFACE)
   .borderRadius(12).border({ width: 1, color: this.selected === s.key ? PMColors.BRAND : PMColors.BORDER_SUBTLE })
   .enabled(!this.busy && !this.disabled && s.feasibility === 'READY')
   .accessibilitySelected(this.selected === s.key)
   .accessibilityText(`方案${index + 1}：${s.title}`)
   .onClick(() => { this.selected = s.key; })
 }
 build() {
  Column({ space: 10 }) {
   Text('本轮方案比较').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
   if (true) {
    Text('保留原目标与成功条件；采用只更新当前委托的计划，不创建新任务。').fontSize(12).fontColor(PMColors.INK_SECONDARY).lineHeight(18)
    Row({ space: 8 }) {
      TextInput({ text: this.available, placeholder: '这轮可投入分钟' }).type(InputType.Number).layoutWeight(1).height(44).fontSize(14)
        .borderRadius(10).backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy && !this.disabled).onChange((v: string) => { this.available = v; })
      TextInput({ text: this.estimate, placeholder: '最小草稿估计分钟' }).type(InputType.Number).layoutWeight(1).height(44).fontSize(14)
        .borderRadius(10).backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy && !this.disabled).onChange((v: string) => { this.estimate = v; })
    }.width('100%')
    Row({ space: 8 }) { Toggle({ type: ToggleType.Switch, isOn: this.allowActions }).selectedColor(PMColors.BRAND).onChange((v: boolean) => { this.allowActions = v; }); Text('允许草稿方案提议行动；创建仍需逐项批准').fontSize(12).layoutWeight(1) }
    Row({ space: 8 }) { Toggle({ type: ToggleType.Switch, isOn: this.cloud }).selectedColor(PMColors.BRAND).onChange((v: boolean) => { this.cloud = v; }); Text('另请已授权云模型补充一轮定性权衡，占用原额度').fontSize(12).layoutWeight(1) }
    Button(this.proposal === null ? '生成对比预览' : '更新对比预览（读取最新依据）').enabled(!this.busy && !this.disabled && Number(this.available) > 0 && Number(this.estimate) > 0).onClick(() => { this.perform('create'); }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
    if (this.proposal !== null) {
     Text(`原目标：${this.proposal.base.goal}`).fontSize(13).fontColor(PMColors.INK_PRIMARY).lineHeight(20)
     Text(`成功条件保持不变 · 本轮上限 ${this.proposal.base.availableMinutes} 分钟 · 修订 ${this.proposal.revision}/3`).fontSize(12).fontColor(PMColors.INK_TERTIARY)
     if (this.stale()) { Text('预览已陈旧或过期；原选择保留，请更新对比后再采用。').fontSize(12).fontColor(PMColors.RISK) }
     ForEach(this.proposal.scenarios, (s: DecisionChoice, index: number) => {
      this.ChoiceCard(s, index)
     }, (s: DecisionChoice) => s.key)
     Row({ space: 12 }) {
      Button('重新读取原方案', { type: ButtonType.Normal }).enabled(!this.busy).onClick(() => { this.perform('read'); }).height(44).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 4 })
      Blank()
      Button('保留原计划，不采用', { type: ButtonType.Normal }).enabled(!this.busy && !this.disabled && this.proposal.status === 'READY').onClick(() => { this.perform('reject'); }).height(44).fontSize(13).fontColor(PMColors.INK_SECONDARY).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(PMRadius.BUTTON)
     }.width('100%')
     Button('采用所选方案', { type: ButtonType.Normal }).width('100%').constraintSize({ minHeight: 48 }).borderRadius(PMRadius.BUTTON).fontSize(15).fontWeight(FontWeight.Medium)
      .fontColor(PMColors.SURFACE).backgroundColor(PMColors.BRAND)
      .enabled(!this.busy && !this.disabled && this.selected !== '' && this.proposal.status === 'READY' && !this.stale()).onClick(() => { this.perform('adopt'); })
     Text('采用不改变原目标、成功条件与执行边界；模型估计时间不构成完成保证。').fontSize(11).fontColor(PMColors.INK_TERTIARY).lineHeight(16)
    }
    if (this.receipt !== null) { Text(`已采用到同一委托，计划修订为 ${this.receipt.planRevision}；原步骤、草稿和回执保留。`).fontSize(13).fontColor(PMColors.BRAND) }
    if (this.error !== '') { Text(this.error).fontSize(12).fontColor(PMColors.RISK) }
   }
  }.width('100%').alignItems(HorizontalAlign.Start)
 }
}
