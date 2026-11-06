import { alertError } from '../common/ErrorAlert';
import router from '@ohos.router';
import util from '@ohos.util';
import { ApiError } from '../models/Project';
import { ConversationService } from '../services/ConversationService';
import { SessionStore } from '../services/SessionStore';
import { ConversationCreateInput, ConversationListItem } from '../models/Conversation';
import { ConversationDraftStore } from '../services/ConversationDraftStore';
import { PMAppBar } from '../components/PMAppBar';
import { PMButton } from '../components/PMReferencePrimitives';
import { PMColors } from '../common/DesignTokens';

/**
 * 独立历史讨论页：替代原顶部 220vp 内嵌滚动，长列表在这里整页滚动。
 * 服务端列表接口没有标题检索能力，搜索只对已加载列表做本地筛选，不伪装全量搜索。
 */
@Entry
@Component
struct ConversationHistory {
  @State private sessions: ConversationListItem[] = [];
  @State private filter: string = '';
  @State private currentId: string = '';
  @State private loading: boolean = false;
  @State @Watch('alertError') private error: string = '';
  private alertError(): void { alertError(this.error); }
  @State private creating: boolean = false;
  private service: ConversationService = new ConversationService();
  private originProjectId: string = '';
  aboutToAppear(): void {
    try { ConversationDraftStore.bind(getContext(this), SessionStore.getUser().id); } catch { /* 历史页不依赖草稿存储 */ }
    const params = router.getParams() as Record<string, string>;
    this.currentId = params?.['conversationId'] ?? '';
    this.originProjectId = params?.['projectId'] ?? '';
    this.load();
  }
  private backToConversation(id: string): void {
    router.back({ url: 'pages/FocusConversation', params: { switchConversationId: id } });
  }
  private async load(): Promise<void> {
    this.loading = true; this.error = '';
    try {
      const list = await this.service.list(this.originProjectId);
      this.sessions = list.conversations;
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '历史讨论暂不可读';
    } finally { this.loading = false; }
  }
  private async createNew(): Promise<void> {
    if (this.creating || this.loading) { return; }
    this.creating = true; this.error = '';
    try {
      const input = new ConversationCreateInput(); input.requestId = util.generateRandomUUID();
      if (this.originProjectId !== '') { input.scope = 'PROJECT'; input.projectId = this.originProjectId; }
      const c = await this.service.create(input);
      router.back({ url: 'pages/FocusConversation', params: { switchConversationId: c.id } });
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : '创建讨论失败';
    } finally { this.creating = false; }
  }
  private filtered(): ConversationListItem[] {
    const kw = this.filter.trim();
    const sorted = this.sessions.slice().sort((a: ConversationListItem, b: ConversationListItem): number =>
      Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''));
    if (kw === '') { return sorted; }
    return sorted.filter((s: ConversationListItem): boolean => s.title.includes(kw));
  }
  private scopeLabel(item: ConversationListItem): string {
    if (item.scope === 'PROJECT') { return '项目讨论'; }
    return '跨项目';
  }
  private timeLabel(item: ConversationListItem): string {
    const at = item.updatedAt ?? '';
    if (at === '') { return ''; }
    return '最近活动 ' + at.slice(0, 16).replace('T', ' ');
  }
  build() {
    Column() {
      PMAppBar({ title: '历史讨论', subtitle: this.originProjectId !== '' ? '当前项目' : '全部授权项目', showBack: true, backLabel: '对话',
        rightActionText: '新讨论', onRightTextAction: (): void => { this.createNew(); } })
      Column({ space: 10 }) {
        TextInput({ text: this.filter, placeholder: '筛选已加载的讨论标题' }).height(44).fontSize(14)
          .backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
          .accessibilityText('筛选历史讨论')
          .onChange((v: string) => { this.filter = v; })
        if (this.error !== '') {
          Column({ space: 8 }) {
            Text(this.error).fontSize(13).fontColor(PMColors.RISK)
            PMButton({ label: '重新读取', secondary: true, disabled: this.loading, onAction: (): void => { this.load(); } })
          }.width('100%').alignItems(HorizontalAlign.Start).padding(14).backgroundColor(PMColors.SURFACE).borderRadius(14)
            .border({ width: 1, color: PMColors.BORDER_SUBTLE })
        }
        if (this.loading && this.sessions.length === 0) {
          Text('正在读取历史讨论…').fontSize(13).fontColor(PMColors.INK_SECONDARY).width('100%').padding(14)
        }
        if (!this.loading && this.sessions.length === 0 && this.error === '') {
          Text('还没有历史讨论，发起第一条对话后会出现在这里。').fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY).width('100%').padding(14)
        }
        Scroll() {
          Column({ space: 8 }) {
            ForEach(this.filtered(), (item: ConversationListItem) => {
              Column({ space: 4 }) {
                Row({ space: 8 }) {
                  Text(item.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
                    .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(1)
                  if (item.id === this.currentId) { Text('当前讨论').fontSize(11).fontColor(PMColors.BRAND) }
                }.width('100%')
                Text(this.scopeLabel(item) + (this.timeLabel(item) !== '' ? ' · ' + this.timeLabel(item) : '')).fontSize(11).fontColor(PMColors.INK_TERTIARY)
              }.width('100%').alignItems(HorizontalAlign.Start).padding(14)
                .backgroundColor(item.id === this.currentId ? PMColors.BRAND_LIGHT : PMColors.SURFACE)
                .borderRadius(12).border({ width: 1, color: item.id === this.currentId ? PMColors.BRAND : PMColors.BORDER_SUBTLE })
                .clickEffect({ level: ClickEffectLevel.LIGHT, scale: 0.98 })
                .accessibilityText(item.title + '，' + this.scopeLabel(item) + (item.id === this.currentId ? '，当前讨论' : ''))
                .onClick(() => { this.backToConversation(item.id); })
            }, (item: ConversationListItem) => item.id)
            if (this.filtered().length !== this.sessions.length) {
              Text('仅筛选已加载的 ' + this.sessions.length + ' 条讨论，不支持全量搜索。').fontSize(11).fontColor(PMColors.INK_TERTIARY).width('100%').padding({ top: 4 })
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ bottom: 24 })
        }.layoutWeight(1).width('100%').scrollBar(BarState.Auto).align(Alignment.Top)
      }.layoutWeight(1).width('100%').padding({ left: 16, right: 16, top: 10, bottom: 16 })
    }.width('100%').height('100%').backgroundColor(PMColors.SURFACE)
  }
}
