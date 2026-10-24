import router from '@ohos.router';
import { MissionReadback, MissionReadTarget, ReadbackAdoption, ReadbackAction } from '../models/MissionReadback';
import { MissionBlock } from '../models/Mission';
import { MissionService } from '../services/MissionService';
import { SessionStore } from '../services/SessionStore';
import { ApiError } from '../models/Project';
import { failedReadState } from '../common/ReadState';
import { PMColors } from '../common/DesignTokens';
@Component
export struct MissionReadbackView {
  @Prop @Watch('targetChanged') missionId: string = '';
  @Prop target: MissionReadTarget = new MissionReadTarget();
  @State data: MissionReadback | null = null;
  @State error: string = '';
  @State state: string = 'unavailable';
  private generation: number = 0;
  private expired: () => void = () => { this.generation++; this.data = null; this.state = 'unavailable'; this.error = '请重新登录后读取'; };
  aboutToAppear(): void { SessionStore.onSessionExpired(this.expired); this.load(); }
  aboutToDisappear(): void { this.generation++; SessionStore.offSessionExpired(this.expired); }
  private targetChanged(): void { this.generation++; this.data = null; this.state = 'unavailable'; this.load(); }
  private async load(): Promise<void> {
    const generation = ++this.generation; const token = SessionStore.getToken();
    try {
      const value = await new MissionService().readback(this.missionId, this.target);
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      this.data = value.readback; this.state = 'fresh'; this.error = '';
    } catch (e) {
      if (generation !== this.generation || token !== SessionStore.getToken()) return;
      const status = e instanceof ApiError ? e.status : 0;
      this.state = failedReadState(this.data !== null, status);
      if (this.state === 'unavailable') this.data = null;
      this.error = e instanceof ApiError ? e.message : '读回暂不可用';
    }
  }
  build() {
    Column({ space: 8 }) {
      Text('原任务与完成回执').fontSize(15).fontWeight(FontWeight.Medium)
      if (this.error !== '') { Text(`${this.error}${this.state === 'lastKnown' ? '；以下为上次读取的历史结果' : ''}`).fontSize(12).fontColor(PMColors.RISK) }
      Button('重新读取回执').onClick(() => this.load()).height(36).fontSize(12)
      if (this.data !== null) {
        Text(`读取于 ${this.data.observedAt} · 委托版本 ${this.data.missionVersion}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
        if (this.data.sourceConversation !== null) {
          Button('返回来源对话 →').onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', sourceRunId: this.data?.sourceConversation?.sourceRunId ?? '', openCopilot: '1' } }); })
        }
        if (this.data.selected.question !== null) { Text(`${this.data.selected.question.historical ? '历史问题（只读）' : '链接指向的问题'}：${this.data.selected.question.text}`).fontSize(13) }
        if (this.data.selected.approval !== null) { Text(`指定提案：${this.data.selected.approval.status}；批准需回到当前有效预览。`).fontSize(12) }
        if (this.data.selected.output !== null) {
          Text(`指定草稿版本 ${this.data.selected.output.revision}（只读）`).fontSize(13)
          ForEach(this.data.selected.output.contentJson.blocks, (b: MissionBlock) => { Text(b.text).fontSize(13) }, (b: MissionBlock) => b.blockId)
        }
        if (this.data.selected.receipt !== null) { Text(`归入回执 ${this.data.selected.receipt.id} · 草稿版本 ${this.data.selected.receipt.outputRevision}`).fontSize(12) }
        ForEach(this.data.adoptions, (r: ReadbackAdoption) => { Text(`已归入成果：${r.title} · ${r.artifactCreatedAt}（来自草稿 ${r.outputRevision}；回执 ${r.receiptId}）`).fontSize(12)
          Button('阅读这份已归入成果 →').onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', artifactId: r.artifactId } }); })
        }, (r: ReadbackAdoption) => r.receiptId)
        ForEach(this.data.actionReceipts, (a: ReadbackAction) => {
          Text(`${a.isSimulated ? '演示情境 · ' : ''}${a.title}：${a.status === 'DONE' && a.resultCardId !== null ? '已填写行动完成回执' : a.status === 'DONE' ? '已标记完成，未找到复盘回执' : '尚未填写完成回执'}`).fontSize(12)
          if (a.resultCardId !== null) { Button('查看复盘记录 →').onClick(() => { router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: this.data?.projectId ?? '', tab: 'memory', cardId: a.resultCardId ?? '' } }); }) }
        }, (a: ReadbackAction) => a.id)
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(12)
  }
}
