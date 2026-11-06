import { alertError } from '../common/ErrorAlert';
import { EvidenceReviewReceipt } from '../models/EvidenceFit';
import router from '@ohos.router';
import { MissionReadback, MissionReadTarget, ReadbackAdoption, ReadbackAction, ReadbackProgressClass } from '../models/MissionReadback';
import { MissionBlock } from '../models/Mission';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { failedReadState } from '../common/ReadState';
import { PMColors, PMSpacing, PMRadius, PMFontSize } from '../common/DesignTokens';
import {
  ReadbackDeltaView, WorkPacketActionView, WorkPacketMaterialFactView, WorkPacketMaterialView, WorkPacketView,
  currentUseLabel, materialBodyNote, observationLine, readbackDelta, shortPacketTime, captureSourceTarget
} from '../models/WorkPacket';
import { MissionWorkPacketView } from './MissionWorkPacketView';

@Component
export struct MissionReadbackView {
  @Prop @Watch('targetChanged') missionId: string = '';
  @Prop target: MissionReadTarget = new MissionReadTarget();
  @Prop @Watch('targetChanged') missionVersion: number = 0;
  @Prop @Watch('targetChanged') refreshKey: number = 0;
  @Prop @Watch('targetChanged') targetKey: string = '';
  /** 'packet' 只在概况页呈现工作摘要；'full' 保留原结果与回执读回。 */
  @Prop mode: string = 'full';
  /** 概况页已有内联主操作（补料/提案/继续）时，不重复第二个按钮。 */
  @Prop inlinePrimaryAction: boolean = false;
  onPrimaryAction: (action: WorkPacketActionView) => void = (action: WorkPacketActionView): void => {};
  @State showSection: string = '';
  @State expandedMaterial: string = '';
  private observedScope: string = '';
  @State data: MissionReadback | null = null;
  @State delta: ReadbackDeltaView = new ReadbackDeltaView();
  @State @Watch('alertError') error: string = '';
  private alertError(): void { alertError(this.error); }
  @State state: string = 'unavailable';
  private generation: number = 0;
  private expired: () => void = () => {
    this.generation++; this.data = null; this.delta = new ReadbackDeltaView(); this.state = 'unavailable'; this.error = '请重新登录后读取';
  };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.load(); }
  aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
  private targetChanged(): void {
    this.generation++;
    if (this.observedScope !== `${this.missionId}:${this.targetKey}`) {
      this.data = null; this.delta = new ReadbackDeltaView(); this.state = 'unavailable';
    }
    this.load();
  }
  private async load(): Promise<void> {
    const generation = ++this.generation; const token = SessionStore.getToken();
    try {
      const value = await new MissionService().readback(this.missionId, this.target);
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      this.observedScope = `${this.missionId}:${this.targetKey}`;
      this.data = value.readback;
      this.delta = readbackDelta(value.readback);
      this.state = 'fresh'; this.error = '';
    } catch (e) {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      const status = e instanceof ApiError ? e.status : 0;
      this.state = failedReadState(this.data !== null, status);
      if (this.state === 'unavailable') { this.data = null; this.delta = new ReadbackDeltaView(); }
      this.error = e instanceof ApiError ? e.message : '读回暂不可用';
    }
  }
  private hasPacket(): boolean { return this.delta.workPacket !== null; }
  private packetOrEmpty(): WorkPacketView { return this.delta.workPacket !== null ? this.delta.workPacket : new WorkPacketView(); }
  private actionDisabled(): boolean {
    if (this.state !== 'fresh') { return true; }
    const packet = this.delta.workPacket;
    return packet !== null && packet.snapshotConsistency === 'VERSION_ADVANCED';
  }
  private readAtLabel(): string {
    if (this.delta.readAtKnown) { return shortPacketTime(this.delta.readAt); }
    const observed = this.data !== null && typeof this.data.observedAt === 'string' ? this.data.observedAt : '';
    return observed !== '' ? shortPacketTime(observed) : '未知';
  }
  private versionLabel(): string {
    if (this.data === null || typeof this.data.missionVersion !== 'number') { return '未知'; }
    return `${this.data.missionVersion}`;
  }
  private shownMaterials(): WorkPacketMaterialView[] { return this.delta.materials; }
  private materialFactSummary(item: WorkPacketMaterialView): string {
    const adoption = item.facts.find((fact: WorkPacketMaterialFactView) => fact.kind === 'ARTIFACT_ADOPTION');
    if (adoption !== undefined) { return `已归入成果${adoption.revision !== null ? ' · 草稿版本 ' + adoption.revision : ''}`; }
    const output = item.facts.find((fact: WorkPacketMaterialFactView) => fact.kind === 'OUTPUT_REFERENCE');
    if (output !== undefined) { return `草稿版本 ${output.revision ?? '未知'} 中已引用`; }
    if (item.facts.some((fact: WorkPacketMaterialFactView) => fact.kind === 'CONTEXT_POINTER')) { return '已进入原委托来源索引，正文读取范围未记录'; }
    if (item.facts.some((fact: WorkPacketMaterialFactView) => fact.kind === 'BOUND')) { return '已绑定原委托，尚未找到后续引用'; }
    if (item.facts.some((fact: WorkPacketMaterialFactView) => fact.kind === 'ASSOCIATED')) { return '已关联原问题，尚未接续'; }
    if (item.facts.some((fact: WorkPacketMaterialFactView) => fact.kind === 'CANDIDATE')) { return '候选资料，等待核对'; }
    return '已保存，当前窗口未找到使用位置（不等于从未使用）';
  }
  private materialTone(item: WorkPacketMaterialView): string {
    const use = item.currentUse;
    if (use.known && !use.explicitNull && use.stateKnown) {
      if (use.state === 'SUPPRESSED') { return 'risk'; }
      if (use.state === 'ALLOWED') { return 'brand'; }
    }
    return 'warning';
  }
  private materialHistoryLine(item: WorkPacketMaterialView): string {
    const parts: string[] = [];
    if (item.revisionAvailabilityKnown) { parts.push(`原修订匹配 ${item.revisionAvailability}`); }
    else if (item.availabilityKnown) { parts.push(`原可用性 ${item.availability}`); }
    else { parts.push('原版本匹配未知'); }
    if (item.availabilityMeaningKnown) { parts.push('版本匹配不等于当前许可'); }
    return parts.join(' · ');
  }
  private excerptText(item: WorkPacketMaterialView): string { return item.excerpt !== null ? item.excerpt : ''; }
  private sourcePointerId(item: WorkPacketMaterialView): string { return item.sourceId; }
  private async openSource(item: WorkPacketMaterialView): Promise<void> {
    if (item.sourceId.startsWith('capture:')) {
      const target = captureSourceTarget(this.data?.projectId ?? '', item.sourceId);
      if (target === null) { this.error = '原记录定位信息不完整，请重新读取委托'; return; }
      router.pushUrl({ url: 'pages/ProjectHome', params: target });
      return;
    }
    if (item.sourceId.startsWith('attachment:')) {
      router.pushUrl({ url: 'pages/AttachmentViewer', params: { projectId: this.data?.projectId ?? '', attachmentId: item.sourceId.substring(11) } });
      return;
    }
    router.pushUrl({ url: 'pages/ConversationWebSource', params: { missionId: this.missionId, sourceId: item.sourceId } });
  }
  @Builder
  private SummaryRow(label: string, value: string, onToggle: () => void, open: boolean) {
    Row({ space: 8 }) {
      Text(label).fontSize(13).fontColor(PMColors.INK_SECONDARY).layoutWeight(1)
      if (open) { Text('收起 ⌃').fontSize(12).fontColor(PMColors.BRAND) }
      else { Text(value === '' ? '展开 ›' : `${value} 条 ›`).fontSize(12).fontColor(PMColors.BRAND) }
    }.width('100%').height(44).alignItems(VerticalAlign.Center)
      .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })
      .onClick(() => { onToggle(); })
      .accessibilityText(`${label}${value === '' ? '' : ` ${value} 条`}，${open ? '收起' : '展开查看'}`)
  }
  @Builder
  private MaterialRow(item: WorkPacketMaterialView) {
    Column({ space: 6 }) {
      Text(item.title !== '' ? item.title : '项目资料').fontSize(PMFontSize.SECONDARY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
      Text(this.materialFactSummary(item)).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
      Row({ space: 6 }) {
        Text(currentUseLabel(item)).fontSize(PMFontSize.CAPTION).fontColor(this.materialTone(item) === 'risk' ? PMColors.RISK : this.materialTone(item) === 'warning' ? PMColors.WARNING : PMColors.BRAND).layoutWeight(1)
      }.width('100%')
      Text(this.materialHistoryLine(item)).fontSize(10).fontColor(PMColors.INK_TERTIARY)
      if (item.excerptKnown && item.excerpt !== null && item.excerpt !== '') {
        Text(this.expandedMaterial === item.sourceHash ? '收起记录摘录 ⌃' : (this.materialTone(item) === 'brand' ? '查看原记录摘录 ⌄' : '查看历史摘录（非当前依据） ⌄'))
          .fontSize(12).fontColor(PMColors.BRAND)
          .onClick(() => { this.expandedMaterial = this.expandedMaterial === item.sourceHash ? '' : item.sourceHash; })
        if (this.expandedMaterial === item.sourceHash) {
          Text(this.excerptText(item)).fontSize(PMFontSize.SECONDARY).copyOption(CopyOptions.LocalDevice)
        }
      } else {
        Text(materialBodyNote(item)).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
      }
      if (item.sourceId.startsWith('attachment:') && item.currentUse.known && !item.currentUse.explicitNull && item.currentUse.stateKnown && item.currentUse.state === 'ALLOWED') {
        Text('查看附件原件 ›').fontSize(13).fontColor(PMColors.BRAND).height(36)
          .onClick(() => { this.openSource(item); })
      } else if (item.sourceId !== '') {
        Text('查看原对象（历史；不改变当前许可） ›').fontSize(13).fontColor(PMColors.INK_SECONDARY).height(36)
          .onClick(() => { this.openSource(item); })
      }
      ForEach(item.facts.filter((fact: WorkPacketMaterialFactView) => fact.kind === 'OUTPUT_REFERENCE'), (fact: WorkPacketMaterialFactView) => {
        Text(`查看草稿版本 ${fact.revision ?? '未知'}（历史引用） ›`).fontSize(13).fontColor(PMColors.BRAND).height(36)
          .onClick(() => { router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.data?.projectId ?? '', missionId: this.missionId, outputId: fact.refId, revision: `${fact.revision ?? ''}` } }); })
      }, (fact: WorkPacketMaterialFactView) => fact.refId)
    }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }
  build() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text(this.mode === 'packet' ? '当前工作摘要' : '结果与回执').fontSize(15).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
        Text('重新读取').fontSize(12).fontColor(PMColors.BRAND).height(36).onClick(() => { this.load(); })
          .accessibilityText('重新读取回执')
      }.width('100%')
      if (this.error !== '') { Text(`${this.error}${this.state === 'lastKnown' ? '；以下为上次读取的历史结果' : ''}`).fontSize(12).fontColor(PMColors.RISK) }
      if (this.data !== null) {
        if (typeof this.data.missionVersion === 'number' && this.data.missionVersion < this.missionVersion) { Text('委托版本已变化，正在重读；以下为上次结果').fontSize(12).fontColor(PMColors.INK_SECONDARY) }
        MissionWorkPacketView({
          hasPacket: this.hasPacket(),
          packet: this.packetOrEmpty(),
          observation: this.delta.observation,
          inlinePrimaryAction: this.inlinePrimaryAction,
          actionDisabled: this.actionDisabled(),
          readAtText: this.readAtLabel(),
          onPrimaryAction: (action: WorkPacketActionView): void => { this.onPrimaryAction(action); }
        })
        Text(`读取于 ${this.readAtLabel()} · 委托版本 ${this.versionLabel()}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
        Text(observationLine(this.delta.observation)).fontSize(11).fontColor(PMColors.INK_TERTIARY)
        if (this.mode === 'packet') {
          if (!this.hasPacket()) {
            Text('完整原委托读回（资料、草稿、回执与用量）仍在「进展」页，不受摘要缺失影响。').fontSize(12).fontColor(PMColors.INK_SECONDARY)
          }
        } else {
          if (this.data.selected.question !== null) { Text(`${this.data.selected.question.historical ? '历史问题（只读）' : '链接指向的问题'}：${this.data.selected.question.text}`).fontSize(13).lineHeight(20) }
          if (this.data.selected.approval !== null) { Text(`指定提案：${this.data.selected.approval.status}；批准需回到当前有效预览。`).fontSize(12).fontColor(PMColors.INK_SECONDARY) }
          if (this.data.selected.output !== null) {
            Text(`指定草稿版本 ${this.data.selected.output.revision}（只读）`).fontSize(13)
            ForEach(this.data.selected.output.contentJson.blocks, (b: MissionBlock) => { Text(b.text).fontSize(13).lineHeight(20) }, (b: MissionBlock) => b.blockId)
          }
          if (this.data.selected.receipt !== null) { Text(`归入回执 ${this.data.selected.receipt.id} · 草稿版本 ${this.data.selected.receipt.outputRevision}`).fontSize(12).fontColor(PMColors.INK_SECONDARY) }
          if (this.data.adoptions.length > 0) {
            this.SummaryRow('已归入成果', `${this.data.adoptions.length}`, (): void => { this.showSection = this.showSection === 'adoption' ? '' : 'adoption'; }, this.showSection === 'adoption')
            if (this.showSection === 'adoption') {
              ForEach(this.data.adoptions, (r: ReadbackAdoption) => {
                Column({ space: 4 }) {
                  Text(`已归入成果：${r.title}`).fontSize(13).fontColor(PMColors.INK_PRIMARY)
                  Text(`来自草稿 ${r.outputRevision} · 回执 ${r.receiptId}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
                  Text('阅读这份已归入成果 ›').fontSize(13).fontColor(PMColors.BRAND).height(36)
                    .onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', artifactId: r.artifactId } }); })
                }.width('100%').alignItems(HorizontalAlign.Start).padding(10)
                  .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
              }, (r: ReadbackAdoption) => r.receiptId)
            }
          }
          if (this.data.actionReceipts.length > 0) {
            this.SummaryRow('行动回执', `${this.data.actionReceipts.length}`, (): void => { this.showSection = this.showSection === 'action' ? '' : 'action'; }, this.showSection === 'action')
            if (this.showSection === 'action') {
              ForEach(this.data.actionReceipts, (a: ReadbackAction) => {
                Column({ space: 4 }) {
                  Text(`${a.isSimulated ? '演示情境 · ' : ''}${a.title}`).fontSize(13).fontColor(PMColors.INK_PRIMARY)
                  Text(a.status === 'DONE' && a.resultCardId !== null ? '已填写行动完成回执' : a.status === 'DONE' ? '已标记完成，未找到复盘回执' : '尚未填写完成回执').fontSize(12).fontColor(PMColors.INK_SECONDARY)
                  if (a.resultCardId !== null) {
                    Text('查看复盘记录 ›').fontSize(13).fontColor(PMColors.BRAND).height(36)
                      .onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', tab: 'memory', cardId: a.resultCardId ?? '' } }); })
                  }
                }.width('100%').alignItems(HorizontalAlign.Start).padding(10)
                  .backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
              }, (a: ReadbackAction) => a.id)
            }
          }
          if (this.data.reviewProgress !== undefined && this.data.reviewProgress.classes.length > 0) {
            this.SummaryRow('进展依据', `${this.data.reviewProgress.classes.length}`, (): void => { this.showSection = this.showSection === 'progress' ? '' : 'progress'; }, this.showSection === 'progress')
            if (this.showSection === 'progress') {
              ForEach(this.data.reviewProgress.classes, (item: ReadbackProgressClass) => {
                Column({ space: 2 }) {
                  Text(`${item.label}：${item.count}`).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_PRIMARY)
                  Text(item.note).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
                }.width('100%').alignItems(HorizontalAlign.Start).padding(8)
              }, (item: ReadbackProgressClass) => item.key)
              Text('这是原步骤、草稿核对、行动与回执的投影；工具成功或用户说完成都不等于现实目标已达成。')
                .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
            }
          }
          if (this.data.resourceUsage !== undefined) {
            this.SummaryRow('本次用量', '', (): void => { this.showSection = this.showSection === 'usage' ? '' : 'usage'; }, this.showSection === 'usage')
            if (this.showSection === 'usage') {
              Text(this.data.resourceUsage.summary).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_PRIMARY)
              Text(`已记录输入 ${this.data.resourceUsage.inputTokens ?? '待核对'} token · 输出 ${this.data.resourceUsage.outputTokens ?? '待核对'} token`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
              Text(this.data.resourceUsage.coverageNote).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
              Text(this.data.resourceUsage.costNote).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_PRIMARY)
              if (this.data.callCoverage !== undefined) {
                Text(this.data.callCoverage.summary).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_PRIMARY)
                ForEach(this.data.callCoverage.notes, (note: string) => {
                  Text(note).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
                }, (note: string, index: number) => `call-note-${index}`)
                Text(this.data.callCoverage.inspected.truncated
                  ? `已检查最近 ${this.data.callCoverage.inspected.limit} 条回执，计数是下界，不是完整账单。`
                  : '已核对当前委托已返回的调用回执；费用仍未知。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
              }
            }
          }
          if (this.data.evidenceReviews && this.data.evidenceReviews!.items.length > 0) {
            ForEach(this.data.evidenceReviews!.items, (review: EvidenceReviewReceipt) => {
              Column({ space: PMSpacing.SM }) {
                Text(review.fitStatus === 'FIT' ? '条件对应' : review.fitStatus === 'NOT_FIT' ? '观察条件不符' : '仍有未决项').fontSize(PMFontSize.BODY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
                Text(review.review.mode === 'ANSWERING_EVIDENCE' ? '用于回答本次测量' : review.review.mode === 'BACKGROUND_ONLY' ? '仅作背景，继续等待' : '保留未知作条件分析').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
                Text(review.review.note).fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
                Text('用户核对 · 结果真实性仍待验证').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
              }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD)
            }, (review: EvidenceReviewReceipt) => review.eventId)
          }
          if (this.delta.materialsPresent && this.shownMaterials().length > 0) {
            this.SummaryRow('这份资料用在哪里', `${this.shownMaterials().length}`, (): void => { this.showSection = this.showSection === 'material' ? '' : 'material'; }, this.showSection === 'material')
            if (this.showSection === 'material') {
              ForEach(this.shownMaterials(), (item: WorkPacketMaterialView) => {
                this.MaterialRow(item)
              }, (item: WorkPacketMaterialView) => `${item.sourceId}:${item.sourceHash}`)
              Text('仅展示直接来源与有限历史；当前许可、历史留痕与独立支持是不同事实，引用不表示结论已核验。')
                .fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
            }
          } else if (this.delta.materialsPresent) {
            Text('有界窗口未返回资料使用记录；不等于从未使用。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
          if (this.data.sourceConversation !== null) {
            Text('返回来源对话 ›').fontSize(13).fontColor(PMColors.BRAND).height(40)
              .onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', sourceRunId: this.data?.sourceConversation?.sourceRunId ?? '', openCopilot: '1' } }); })
          }
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(12)
  }
}
