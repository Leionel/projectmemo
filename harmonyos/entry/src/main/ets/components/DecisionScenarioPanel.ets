import { DecisionProposal, DecisionChoice, DecisionInput, DecisionConfirm, DecisionReceipt } from '../models/DecisionEvolution';
import { DecisionEvolutionService } from '../services/DecisionEvolutionService';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { PMColors } from '../common/DesignTokens';
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
 @State error: string = '';
 onAdopted: () => void = (): void => {};
 private generation: number = 0;
 private loaded: boolean = false;
 private keys: Record<string, string> = {};
 private expired: () => void = () => { this.generation++; this.proposal = null; this.receipt = null; this.available = ''; this.estimate = ''; this.selected = ''; this.cloud = false; this.allowActions = false; this.busy = false; };
 aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); }
 aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
 private requestKey(body: Object): string { const value = JSON.stringify(body); if (this.keys[value] === undefined) this.keys[value] = `decision-${Date.now()}-${Math.random().toString(36).slice(2)}`; return this.keys[value]; }
 private valid(g: number, token: string): boolean { return g === this.generation && token === SessionStore.getToken(); }
 private async perform(action: string): Promise<void> {
  if (this.busy || this.disabled && !['read', 'latest'].includes(action)) return;
  const g = this.generation; const token = SessionStore.getToken(); this.busy = true; this.error = '';
  try {
   const service = new DecisionEvolutionService();
   if (action === 'latest') { const reply = await service.latest(this.missionId); if (!this.valid(g, token)) return; this.proposal = reply.proposal; this.receipt = reply.proposal?.receipt ?? null; } else if (action === 'create') {
    const body = new DecisionInput(); body.availableMinutes = Number(this.available); body.deliveryMinutes = Number(this.estimate); body.allowActionProposals = this.allowActions; body.requestModelAdvice = this.cloud; body.parentId = this.proposal !== null && !['CONFIRMED', 'REJECTED'].includes(this.proposal.status) ? this.proposal.id : undefined; body.requestId = this.requestKey(body);
    const reply = await service.create(this.missionId, body); if (!this.valid(g, token)) return; this.proposal = reply.proposal; this.receipt = null;
   } else if (this.proposal !== null && action === 'read') { const reply = await service.read(this.proposal.id); if (!this.valid(g, token)) return; this.proposal = reply.proposal; this.receipt = reply.proposal?.receipt ?? null; }
   else if (this.proposal !== null && action === 'adopt') {
    const body = new DecisionConfirm(); body.proposalHash = this.proposal.proposalHash; body.scenarioKey = this.selected; body.expectedVersion = this.proposal.currentVersion ?? this.proposal.base.expectedVersion; body.requestId = this.requestKey(body);
    const result = await service.adopt(this.proposal.id, body); if (!this.valid(g, token)) return; this.receipt = result.receipt; this.onAdopted();
   } else if (this.proposal !== null && action === 'reject') { await service.reject(this.proposal.id); if (!this.valid(g, token)) return; this.proposal.status = 'REJECTED'; this.selected = ''; }
  } catch (e) { if (!this.valid(g, token)) return; this.error = e instanceof ApiError ? e.message : '结果尚未确认，请重新读取原方案'; if (e instanceof ApiError && e.status === 409 && this.proposal !== null) this.proposal.stale = true; if (e instanceof ApiError && [401, 403, 404].includes(e.status)) this.expired(); }
  finally { if (g === this.generation) this.busy = false; }
 }
 build() {
  Column({ space: 10 }) {
   Button(this.open ? '收起本轮方案对比' : '对比本轮推进方案').height(44).fontSize(14).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).onClick(() => { this.open = !this.open; if (this.open && !this.loaded) { this.loaded = true; this.perform('latest'); } })
   if (this.open) {
    Text('保留原目标与成功条件，比较先核对依据与先整理草稿。采用只更新当前委托，不创建新任务或日历。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
    Text('这轮最多可投入几分钟').fontSize(13)
    TextInput({ text: this.available, placeholder: '请输入分钟数' }).type(InputType.Number).enabled(!this.busy && !this.disabled).onChange((v: string) => { this.available = v; })
    Text('你估计最小草稿需要几分钟').fontSize(13)
    TextInput({ text: this.estimate, placeholder: '请输入你的估计' }).type(InputType.Number).enabled(!this.busy && !this.disabled).onChange((v: string) => { this.estimate = v; })
    Row({ space: 8 }) { Toggle({ type: ToggleType.Switch, isOn: this.allowActions }).onChange((v: boolean) => { this.allowActions = v; }); Text('允许草稿方案提议行动；创建仍需逐项批准').fontSize(12).layoutWeight(1) }
    Row({ space: 8 }) { Toggle({ type: ToggleType.Switch, isOn: this.cloud }).onChange((v: boolean) => { this.cloud = v; }); Text('另请已授权云模型补充一轮定性权衡，占用原额度').fontSize(12).layoutWeight(1) }
    Button(this.proposal === null ? '生成对比预览' : '更新对比预览').enabled(!this.busy && !this.disabled && Number(this.available) > 0 && Number(this.estimate) > 0).onClick(() => { this.perform('create'); })
    if (this.proposal !== null) {
     Text(`原目标：${this.proposal.base.goal}`).fontSize(13)
     Text(`原成功条件保持不变 · 本轮上限 ${this.proposal.base.availableMinutes} 分钟 · 修订 ${this.proposal.revision}/3`).fontSize(12)
     if (this.proposal.stale || new Date(this.proposal.expiresAt).getTime() <= Date.now()) { Text('预览已陈旧，请更新对比；原选择保留。').fontSize(12).fontColor(PMColors.RISK) }
     ForEach(this.proposal.scenarios, (s: DecisionChoice) => {
      Column({ space: 6 }) {
       Row({ space: 8 }) { if (s.key !== 'BASELINE') { Radio({ value: s.key, group: this.missionId }).checked(this.selected === s.key).enabled(s.feasibility === 'READY' && !this.proposal!.stale && !this.disabled && !this.busy).onChange((v: boolean) => { if (v) this.selected = s.key; }) }
        Text(s.title).fontSize(15).fontWeight(FontWeight.Medium) }
       Text(`${s.minutes === null ? '时长未知' : s.minutes.toString() + ' 分钟'} · ${s.estimateSource}`).fontSize(12)
       Text(s.tradeoff).fontSize(13)
       Text(s.executionBoundary === 'READ_ANALYZE' ? '仅读取、分析和保存草稿' : '可提议行动，创建仍需批准').fontSize(12)
       ForEach(s.reasons, (r: string) => { Text(r).fontSize(12).fontColor(PMColors.RISK) })
       Text(s.modelTradeoff === undefined ? '规则对比，未使用模型权衡' : `模型补充：${s.modelTradeoff}`).fontSize(12).fontColor(PMColors.INK_SECONDARY)
      }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(this.selected === s.key ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE).borderRadius(12)
     }, (s: DecisionChoice) => s.key)
     Button('重新读取原方案').enabled(!this.busy).onClick(() => { this.perform('read'); })
     Button('采用到原委托').enabled(!this.busy && !this.disabled && this.selected !== '' && this.proposal.status === 'READY' && !this.proposal.stale && new Date(this.proposal.expiresAt).getTime() > Date.now()).onClick(() => { this.perform('adopt'); })
     Button('保留原计划，不采用').enabled(!this.busy && !this.disabled && this.proposal.status === 'READY').onClick(() => { this.perform('reject'); })
    }
    if (this.receipt !== null) { Text(`已采用到同一委托，计划修订为 ${this.receipt.planRevision}；原步骤、草稿和回执保留。`).fontSize(13).fontColor(PMColors.BRAND) }
    if (this.error !== '') { Text(this.error).fontSize(12).fontColor(PMColors.RISK) }
   }
  }.width('100%').alignItems(HorizontalAlign.Start)
 }
}
