import { researchReadLevelLabel } from '../common/ResearchPresentation';
import router from '@ohos.router';
import { common } from '@kit.AbilityKit';
import { ConversationSource } from '../models/Conversation';
import { ApiClient } from '../services/ApiClient';
import { PMAppBar } from '../components/PMAppBar';
import { PMColors } from '../common/DesignTokens';
import { SessionStore } from '../services/SessionStore';

class SourceParams { conversationId: string = ''; turnId: string = ''; sourceId: string = ''; }
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
      const result = await this.client.get<SourceReply>(`/api/conversations/${this.params.conversationId}/turns/${this.params.turnId}/sources/${encodeURIComponent(this.params.sourceId)}`);
      if (this.active) { this.source = result.source; this.error = ''; }
    } catch { if (this.active) this.error = '原来源已不可访问，请返回讨论核对研究范围'; }
  }
  private async openOriginal(): Promise<void> {
    await this.load();
    if (!this.source?.external || this.error !== '') return;
    try { const context = getContext(this) as common.UIAbilityContext;
      await context.startAbility({ action: 'ohos.want.action.viewData', uri: this.source.external.requestedUrl, entities: ['entity.system.browsable'] });
    } catch { this.error = '未能打开系统浏览器'; }
  }
  build() {
    Column() {
      PMAppBar({ title: '网页来源' })
      Scroll() {
        Column({ space: 16 }) {
          if (this.error !== '') { Text(this.error).fontSize(15).fontColor(PMColors.INK_SECONDARY) }
          if (this.source !== null) {
            Text(this.source!.title).fontSize(22).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
            Text(researchReadLevelLabel(this.source!.external?.readLevel ?? '') + ' · 抓取于 ' + (this.source!.external?.fetchedAt.slice(0, 10) ?? '')).fontSize(12).fontColor(PMColors.INK_SECONDARY)
            Text(this.source!.excerpt || '尚未取得可读正文').fontSize(16).lineHeight(27).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.LocalDevice)
            Button('打开原网页 ↗', { type: ButtonType.Normal }).height(48).fontSize(15).fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE_SUBTLE).onClick(() => { this.openOriginal(); })
          }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(20)
      }.layoutWeight(1).width('100%')
    }.width('100%').height('100%').backgroundColor(PMColors.SURFACE)
  }
}
