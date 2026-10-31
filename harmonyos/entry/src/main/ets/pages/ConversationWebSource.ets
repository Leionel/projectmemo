import { researchReadLevelLabel } from '../common/ResearchPresentation';
import router from '@ohos.router';
import { common } from '@kit.AbilityKit';
import { ConversationSource } from '../models/Conversation';
import { ApiClient } from '../services/ApiClient';
import { PMAppBar } from '../components/PMAppBar';
import { PMColors } from '../common/DesignTokens';
import { SessionStore } from '../services/SessionStore';

class SourceParams { conversationId: string = ''; turnId: string = ''; sourceId: string = ''; missionId: string = ''; }
interface SourceReply { source: ConversationSource; }

@Entry
@Component
struct ConversationWebSource {
  @State source: ConversationSource | null = null;
  @State error: string = '';
  private params: SourceParams = new SourceParams();
  private active: boolean = false;
  private client: ApiClient = new ApiClient();
  private onExpired: () => void = (): void => { this.source = null; this.error = '登录状态已失效'; };
  aboutToAppear(): void {
    this.params = router.getParams() as SourceParams; this.active = true;
    SessionStore.onSessionExpired(this.onExpired); this.load();
  }
  aboutToDisappear(): void { this.active = false; SessionStore.offSessionExpired(this.onExpired); this.source = null; }
  private async load(): Promise<void> {
    try {
      const result = await this.client.get<SourceReply>(this.params.missionId ? `/api/missions/${this.params.missionId}/sources/${encodeURIComponent(this.params.sourceId)}` : `/api/conversations/${this.params.conversationId}/turns/${this.params.turnId}/sources/${encodeURIComponent(this.params.sourceId)}`);
      if (this.active) { this.source = result.source; this.error = ''; }
    } catch { if (this.active) this.error = '原来源已不可访问，请返回讨论核对研究范围'; }
  }
  private async openOriginal(): Promise<void> {
    await this.load();
    if (this.source?.document && this.error === '') { router.pushUrl({ url: 'pages/AttachmentViewer', params: { projectId: this.source.projectId, attachmentId: this.source.document.attachmentId, physicalPage: this.source.document.pages[0] || 0 } }); return; }
    if (!this.source?.external || this.error !== '') return;
    try { const context = getContext(this) as common.UIAbilityContext;
      await context.startAbility({ action: 'ohos.want.action.viewData', uri: this.source.external.requestedUrl, entities: ['entity.system.browsable'] });
    } catch { this.error = '未能打开系统浏览器'; }
  }
  build() {
    Column() {
      PMAppBar({ title: '资料来源' })
      Scroll() {
        Column({ space: 16 }) {
          if (this.error !== '') { Text(this.error).fontSize(15).fontColor(PMColors.INK_SECONDARY) }
          if (this.source !== null) {
            Text(this.source!.title).fontSize(22).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
            if (this.source!.document) {
              Text((this.source!.document!.pages.length > 0 ? '原件物理第 ' + this.source!.document!.pages[0].toString() + ' 页' : '校对文本或目录') + ' · 读取于 ' + this.source!.document!.observedAt.slice(0, 10)).fontSize(12).fontColor(PMColors.INK_SECONDARY)
              if (this.source!.document!.kind === 'TABLE') { Text('表头、合并单元格和跨页关系需对照原页核对。').fontSize(13).fontColor(PMColors.INK_SECONDARY) }
            } else if (this.source!.calendar) {
              Text('飞书日历只读 · ' + (this.source!.calendar!.accountName || this.source!.calendar!.accountEmail) + ' · ' + this.source!.calendar!.calendarSummary).fontSize(12).fontColor(PMColors.INK_SECONDARY)
              Text(this.source!.calendar!.allDay ? (this.source!.calendar!.startDate ?? '') + ' 至 ' + (this.source!.calendar!.endDate ?? '') + '（全天）' : (this.source!.calendar!.startAt ?? '').slice(0, 16).replace('T', ' ') + ' → ' + (this.source!.calendar!.endAt ?? '').slice(0, 16).replace('T', ' ') + '（' + (this.source!.calendar!.timeZone ?? '未知时区') + '）').fontSize(13).fontColor(PMColors.INK_PRIMARY)
              Text(this.source!.calendar!.eventStatus + (this.source!.calendar!.recurrence ? ' · 重复规则' : '') + (this.source!.calendar!.isException ? ' · 重复例外' : '') + ' · ' + (this.source!.calendar!.window.complete ? '本次窗口已枚举' : '本次窗口未完整读取，不能当作全局无冲突')).fontSize(13).fontColor(PMColors.INK_SECONDARY)
            } else if (this.source!.external?.browser) {
              Text('网页渲染读取 · 快照 ' + this.source!.external!.browser!.observedAt.slice(0, 16).replace('T', ' ')).fontSize(12).fontColor(PMColors.INK_SECONDARY)
              Text(this.source!.external!.browser!.coverage.complete ? '已取得本次可见正文；页面请求 ' + this.source!.external!.browser!.coverage.requests.toString() + ' 次，拦截 ' + this.source!.external!.browser!.coverage.blockedRequests.toString() + ' 次。' : '仅取得部分可见正文：' + (this.source!.external!.browser!.failureMessage ?? '页面尚未加载完成') + '。').fontSize(13).fontColor(PMColors.INK_SECONDARY)
            } else { Text(researchReadLevelLabel(this.source!.external?.readLevel ?? '') + ' · 抓取于 ' + (this.source!.external?.fetchedAt.slice(0, 10) ?? '')).fontSize(12).fontColor(PMColors.INK_SECONDARY) }
            Text(this.source!.excerpt || '尚未取得可读正文').fontSize(16).lineHeight(27).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.LocalDevice)
            if (!this.source!.calendar) { Button(this.source!.document ? '打开原文件 ↗' : '打开原网页 ↗', { type: ButtonType.Normal }).height(48).fontSize(15).fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE_SUBTLE).onClick(() => { this.openOriginal(); }) }
          }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(20)
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').backgroundColor(PMColors.SURFACE)
  }
}
