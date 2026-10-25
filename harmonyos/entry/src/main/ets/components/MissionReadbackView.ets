import { EvidenceReviewReceipt } from '../models/EvidenceFit';
import { materialUseSummary } from '../common/MaterialUseContract';
import router from '@ohos.router';
import { MissionReadback, MissionReadTarget, ReadbackAdoption, ReadbackAction, ReadbackMaterial, ReadbackMaterialFact } from '../models/MissionReadback';
import { MissionBlock } from '../models/Mission';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { failedReadState } from '../common/ReadState';
import { PMColors, PMSpacing, PMRadius, PMFontSize } from '../common/DesignTokens';
@Component
export struct MissionReadbackView {
  @Prop @Watch('targetChanged') missionId: string = '';
  @Prop target: MissionReadTarget = new MissionReadTarget();
  @Prop @Watch('targetChanged') missionVersion: number = 0;
  @Prop @Watch('targetChanged') refreshKey: number = 0;
  @Prop @Watch('targetChanged') targetKey: string = '';
  @State showMaterials: boolean = false;
  @State expandedMaterial: string = '';
  private observedScope: string = '';
  @State data: MissionReadback | null = null;
  @State error: string = '';
  @State state: string = 'unavailable';
  private generation: number = 0;
  private expired: () => void = () => { this.generation++; this.data = null; this.state = 'unavailable'; this.error = '请重新登录后读取'; };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.load(); }
  aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
  private targetChanged(): void { this.generation++; if (this.observedScope !== `${this.missionId}:${this.targetKey}`) { this.data = null; this.state = 'unavailable'; } this.load(); }
  private async load(): Promise<void> {
    const generation = ++this.generation; const token = SessionStore.getToken();
    try {
      const value = await new MissionService().readback(this.missionId, this.target);
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      this.observedScope = `${this.missionId}:${this.targetKey}`;
      this.data = value.readback; this.state = 'fresh'; this.error = '';
    } catch (e) {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      const status = e instanceof ApiError ? e.status : 0;
      this.state = failedReadState(this.data !== null, status);
      if (this.state === 'unavailable') this.data = null;
      this.error = e instanceof ApiError ? e.message : '读回暂不可用';
    }
  }
  private materials(): ReadbackMaterial[] { return this.data?.materialUses?.items ?? []; }
  build() {
    Column({ space: 8 }) {
      Text('原任务与完成回执').fontSize(15).fontWeight(FontWeight.Medium)
      if (this.error !== '') { Text(`${this.error}${this.state === 'lastKnown' ? '；以下为上次读取的历史结果' : ''}`).fontSize(12).fontColor(PMColors.RISK) }
      Button('重新读取回执').onClick(() => this.load()).height(36).fontSize(12).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
      if (this.data !== null) {
        if (this.data.missionVersion < this.missionVersion) { Text('委托版本已变化，正在重读回执；以下为上次结果').fontSize(12).fontColor(PMColors.INK_SECONDARY) }
        Text(`读取于 ${this.data.observedAt} · 委托版本 ${this.data.missionVersion}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
        if (this.data.sourceConversation !== null) {
          Button('返回来源对话 →').onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', sourceRunId: this.data?.sourceConversation?.sourceRunId ?? '', openCopilot: '1' } }); }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
        }
        if (this.data.selected.question !== null) { Text(`${this.data.selected.question.historical ? '历史问题（只读）' : '链接指向的问题'}：${this.data.selected.question.text}`).fontSize(13) }
        if (this.data.selected.approval !== null) { Text(`指定提案：${this.data.selected.approval.status}；批准需回到当前有效预览。`).fontSize(12) }
        if (this.data.selected.output !== null) {
          Text(`指定草稿版本 ${this.data.selected.output.revision}（只读）`).fontSize(13)
          ForEach(this.data.selected.output.contentJson.blocks, (b: MissionBlock) => { Text(b.text).fontSize(13) }, (b: MissionBlock) => b.blockId)
        }
        if (this.data.selected.receipt !== null) { Text(`归入回执 ${this.data.selected.receipt.id} · 草稿版本 ${this.data.selected.receipt.outputRevision}`).fontSize(12) }
        ForEach(this.data.adoptions, (r: ReadbackAdoption) => { Text(`已归入成果：${r.title} · ${r.artifactCreatedAt}（来自草稿 ${r.outputRevision}；回执 ${r.receiptId}）`).fontSize(12)
          Button('阅读这份已归入成果 →').onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', artifactId: r.artifactId } }); }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
        }, (r: ReadbackAdoption) => r.receiptId)
        ForEach(this.data.actionReceipts, (a: ReadbackAction) => {
          Text(`${a.isSimulated ? '演示情境 · ' : ''}${a.title}：${a.status === 'DONE' && a.resultCardId !== null ? '已填写行动完成回执' : a.status === 'DONE' ? '已标记完成，未找到复盘回执' : '尚未填写完成回执'}`).fontSize(12)
          if (a.resultCardId !== null) { Button('查看复盘记录 →').onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', tab: 'memory', cardId: a.resultCardId ?? '' } }); }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 }) }
        }, (a: ReadbackAction) => a.id)
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
        if (this.materials().length > 0) {
          Button(this.showMaterials ? '收起资料使用位置' : `这份资料用在哪里 · ${this.materials().length}`).onClick(() => { this.showMaterials = !this.showMaterials; }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
          if (this.showMaterials) {
            ForEach(this.materials(), (item: ReadbackMaterial) => {
              Column({ space: 6 }) {
                Text(item.title).fontSize(PMFontSize.SECONDARY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
                Text(`${item.availability === 'CHANGED' ? '历史版本 · ' : ''}${materialUseSummary(item.facts)}`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
                if (item.availability === 'UNAVAILABLE') { Text('原资料暂不可访问，历史关联仍保留').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY) }
                if (item.excerpt !== null && item.excerpt !== '') {
                  Button(this.expandedMaterial === item.sourcePointer.hash ? '收起记录摘录' : '查看原记录摘录').onClick(() => { this.expandedMaterial = this.expandedMaterial === item.sourcePointer.hash ? '' : item.sourcePointer.hash; }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
                  if (this.expandedMaterial === item.sourcePointer.hash) { Text(item.excerpt).fontSize(PMFontSize.SECONDARY).copyOption(CopyOptions.LocalDevice) }
                }
                if (item.sourcePointer.id.startsWith('attachment:') && item.availability === 'CURRENT') {
                  Button('查看附件原件 →').onClick(() => { router.pushUrl({ url: 'pages/AttachmentViewer', params: { projectId: this.data?.projectId ?? '', attachmentId: item.sourcePointer.id.substring(11) } }); }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
                }
                ForEach(item.facts.filter((f: ReadbackMaterialFact) => f.kind === 'OUTPUT_REFERENCE'), (f: ReadbackMaterialFact) => {
                  Button(`查看草稿版本 ${f.revision} →`).onClick(() => { router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.data?.projectId ?? '', missionId: this.missionId, outputId: f.refId, revision: `${f.revision}` } }); }).type(ButtonType.Normal).borderRadius(PMRadius.BUTTON).fontSize(PMFontSize.BUTTON).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).constraintSize({ minHeight: 44 })
                }, (f: ReadbackMaterialFact) => f.refId)
              }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.MD).border({ width: 1, color: PMColors.BORDER_SUBTLE })
            }, (item: ReadbackMaterial) => `${item.sourcePointer.id}:${item.sourcePointer.hash}`)
            Text('仅展示直接来源与有限历史；引用不表示结论已核验').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_TERTIARY)
          }
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(12)
  }
}
