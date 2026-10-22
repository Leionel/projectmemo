import router from '@ohos.router';
import { focusStatusLabel, focusActionLabel } from '../common/GlobalFocusPresentation';
import { FocusEntry, GlobalFocusReply } from '../models/GlobalFocus';
import { GlobalFocusService } from '../services/GlobalFocusService';
import { ApiError } from '../models/Project';
import { LoadingStateView, ErrorStateView } from './AsyncStateView';
import { PMColors, PMSpacing, PMRadius, PMFontSize } from '../common/DesignTokens';

@Component
export struct GlobalFocusPanel {
  @Prop @Watch('refresh') refreshKey: number = 0;
  @State private view: GlobalFocusReply = new GlobalFocusReply();
  @State private busy: boolean = true;
  @State private errorText: string = '';
  @State private includeArchived: boolean = false;
  @State private expandedGroups: string[] = [];
  private generation: number = 0;
  private service: GlobalFocusService = new GlobalFocusService();

  aboutToAppear(): void { this.refresh(); }
  aboutToDisappear(): void { this.generation++; }
  private async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.busy = true; this.errorText = ''; this.view = new GlobalFocusReply();
    try {
      const reply = await this.service.read(this.includeArchived);
      if (generation !== this.generation) return;
      if (reply.schemaVersion !== 1) throw new Error('当前客户端尚不支持这份焦点摘要，请更新应用');
      this.view = reply;
    } catch (error) {
      if (generation !== this.generation) return;
      this.view = new GlobalFocusReply();
      this.errorText = error instanceof ApiError ? error.message : '焦点暂未加载，请检查网络后重试';
    } finally { if (generation === this.generation) this.busy = false; }
  }
  private displayTime(value: string): string {
    const date = new Date(value);
    if (isNaN(date.getTime())) return '时间待核对';
    return date.toLocaleString('zh-CN');
  }
  private empty(): boolean {
    return this.view.waiting.length + this.view.running.length + this.view.actions.length + this.view.reminders.length + this.view.records.length === 0;
  }
  private open(item: FocusEntry, kind: string): void {
    if (kind === 'mission') router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: item.projectId, missionId: item.id } });
    else if (kind === 'reminder') router.pushUrl({ url: 'pages/InterventionDetail', params: { projectId: item.projectId, interventionId: item.id } });
    else router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: item.projectId, tab: kind === 'action' ? 'actions' : 'memory', actionId: kind === 'action' ? item.id : '', cardId: kind === 'record' ? item.id : '' } });
  }
  @Builder
  private Group(title: string, items: FocusEntry[], kind: string) {
    if (items.length > 0) {
      Column() {
        Text(title).fontSize(PMFontSize.SECTION_TITLE).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).margin({ bottom: PMSpacing.SM })
        ForEach(this.expandedGroups.includes(title) ? items : items.slice(0, 3), (item: FocusEntry) => {
          Column() {
            Text(item.projectTitle).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
            if (kind !== 'record') {
              Text(focusStatusLabel(item.status)).fontSize(PMFontSize.CAPTION).fontColor(kind === 'mission' && item.status !== 'READY' && item.status !== 'RUNNING' ? PMColors.WARNING : PMColors.BRAND).margin({ top: 4 })
            }
            Text(item.title).fontSize(PMFontSize.SECONDARY).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).margin({ top: 4 })
            if (item.detail !== '') {
              Text(item.detail).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).margin({ top: 4 })
            }
            if (item.activity !== '') {
              Text(`${item.activity}${item.activityAt !== '' ? ' · ' + this.displayTime(item.activityAt) : ''}`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).margin({ top: 4 })
            }
            if (item.dueAt !== '') {
              Text(`截止：${this.displayTime(item.dueAt)}`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).margin({ top: 4 })
            }
            if (item.recordedAt !== '') {
              Text(`保存于：${this.displayTime(item.recordedAt)}`).fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).margin({ top: 4 })
            }
            Button(focusActionLabel(item.status, kind)).height(44).fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND).backgroundColor(PMColors.BRAND_LIGHT).borderRadius(PMRadius.XS).margin({ top: PMSpacing.XS }).onClick(() => { this.open(item, kind); })
          }.width('100%').alignItems(HorizontalAlign.Start).padding({ top: PMSpacing.SM, bottom: PMSpacing.SM }).border({ width: { top: 1 }, color: PMColors.BORDER_SUBTLE })
        }, (item: FocusEntry) => item.id)
        if (items.length > 3 && !this.expandedGroups.includes(title)) {
          Button(`展开本组其余 ${items.length - 3} 项`).height(44).fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE).onClick(() => { this.expandedGroups = [...this.expandedGroups, title]; })
        }
      }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.MD).backgroundColor(PMColors.SURFACE).borderRadius(PMRadius.SM).border({ width: 1, color: PMColors.BORDER }).margin({ bottom: PMSpacing.MD })
    }
  }
  build() {
    if (this.busy) { LoadingStateView({ message: '正在读取当前焦点…' }) }
    else if (this.errorText !== '') { ErrorStateView({ message: this.errorText, onRetry: () => { this.refresh(); } }) }
    else {
      Scroll() {
        Column() {
          Text('焦点').fontSize(PMFontSize.PAGE_TITLE).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          Text('先回应需要你的事，再继续正在推进的目标。').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY).margin({ top: PMSpacing.XS, bottom: PMSpacing.SM })
          Row() {
            Checkbox({ name: '包含归档项目' }).select(this.includeArchived).onChange((value: boolean) => { this.includeArchived = value; this.refresh(); }).accessibilityText('包含归档项目')
            Text('包含归档项目').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY)
            Blank()
            Button('刷新焦点').height(44).fontSize(PMFontSize.CAPTION).fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE).onClick(() => { this.refresh(); })
          }.width('100%').margin({ bottom: PMSpacing.SM })
          if (!this.view.missionEnabled) { Text('长期委托当前未开启，已有委托数据仍保留。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY).margin({ bottom: PMSpacing.SM }) }
          if (this.empty()) {
            Text('当前范围内没有待回应或推进中的事项。进入项目记录资料，或委托一个长期目标。').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
          }
          this.Group('需要回应的委托', this.view.waiting, 'mission')
          this.Group('正在推进的委托', this.view.running, 'mission')
          this.Group('需要处理的行动', this.view.actions, 'action')
          this.Group('有效提醒', this.view.reminders, 'reminder')
          this.Group('最近保存的资料', this.view.records, 'record')
          if (this.view.hasMore) { Text('每类最多读取 6 项，可进入所属项目查看全部。').fontSize(PMFontSize.CAPTION).fontColor(PMColors.INK_SECONDARY) }
        }.width('100%').alignItems(HorizontalAlign.Start).padding(PMSpacing.LG)
      }.width('100%').height('100%').scrollBar(BarState.Auto)
    }
  }
}
