import router from '@ohos.router';
import { ExperienceSuggestion, ExperienceActionBody, ExperienceCounterExample } from '../models/Experience';
import { ExperienceService } from '../services/ExperienceService';
import { experienceStatusLabel, experienceMatchLabel, experienceSourceText, experienceUnknownText } from '../common/ExperienceContract';
import { PMColors } from '../common/DesignTokens';

// P3-A / CT-8 项目内经验：委托详情就近展示条件、匹配结果、未知/反例与原结果入口。
// 条件 MATCH + ACTIVE 才注入；建议不改变权限；撤销保留历史使用记录。
@Component
export struct ExperiencePanel {
  @Prop projectId: string = '';
  @Prop missionId: string = '';
  @Prop suggestions: ExperienceSuggestion[] = [];
  @State busy: boolean = false;
  @State error: string = '';
  onChanged: () => void = (): void => {};
  private service: ExperienceService = new ExperienceService();
  private keys: Record<string, string> = {};

  private requestKey(id: string, action: string): string {
    const key: string = `${id}:${action}`;
    if (this.keys[key] === undefined) {
      this.keys[key] = `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return this.keys[key];
  }

  private async act(item: ExperienceSuggestion, action: string, disposition?: string): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    this.error = '';
    try {
      const body: ExperienceActionBody = new ExperienceActionBody();
      body.action = action;
      body.requestId = this.requestKey(item.id, action + (disposition ?? ''));
      body.expectedVersion = item.version;
      if (disposition !== undefined) {
        body.disposition = disposition;
        body.missionId = this.missionId;
      }
      await this.service.act(this.projectId, item.id, body);
      this.onChanged();
    } catch (e) {
      this.error = e instanceof Error ? e.message : '操作失败，请稍后重试';
    } finally {
      this.busy = false;
    }
  }

  build() {
    if (this.suggestions.length > 0) {
      Column({ space: 8 }) {
        Text('项目经验（本项目内）').fontSize(14).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        ForEach(this.suggestions, (item: ExperienceSuggestion) => {
          Column({ space: 4 }) {
            Row({ space: 6 }) {
              Text(item.title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
              Text(experienceStatusLabel(item)).fontSize(11).fontColor(PMColors.INK_SECONDARY)
            }.width('100%')
            if (item.conditions.length > 0) {
              Text(`适用：${item.conditions.join('；')} · ${experienceMatchLabel(item)}`).fontSize(12).fontColor(PMColors.INK_TERTIARY)
            }
            if (experienceUnknownText(item) !== '') {
              Text(experienceUnknownText(item)).fontSize(12).fontColor(PMColors.INK_TERTIARY)
            }
            Text(item.statement).fontSize(12).fontColor(PMColors.INK_SECONDARY).lineHeight(18)
            Text(experienceSourceText(item)).fontSize(11).fontColor(PMColors.INK_TERTIARY)
            if (item.counterExamples.length > 0) {
              Text(`反例：${item.counterExamples.map((c: ExperienceCounterExample) => c.reason ?? c.missionId ?? '已知负结果').join('；')}`)
                .fontSize(11).fontColor(PMColors.INK_TERTIARY)
            }
            if (item.originMissionId !== null) {
              Button('回原结果核对', { type: ButtonType.Normal }).height(44).fontSize(12).backgroundColor(Color.Transparent)
                .fontColor(PMColors.BRAND).padding({ left: 0, right: 8 })
                .onClick(() => { router.pushUrl({ url: 'pages/MissionDetail', params: { projectId: this.projectId, missionId: item.originMissionId } }); })
            }
            if (item.status === 'ACTIVE') {
              Button('停用此经验').fontSize(12).backgroundColor(PMColors.SURFACE).fontColor(PMColors.BRAND)
                .enabled(!this.busy).onClick(() => { this.act(item, 'REVOKE'); })
            } else if (item.status === 'SHADOW') {
              Button('激活为建议').fontSize(12).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND)
                .enabled(!this.busy).onClick(() => { this.act(item, 'ACTIVATE'); })
            }
            if (this.missionId !== '' && item.eligibleForInjection) {
              Row({ space: 8 }) {
                Button('这次采用了', { type: ButtonType.Normal }).height(44).fontSize(12).backgroundColor(PMColors.SURFACE).fontColor(PMColors.BRAND)
                  .enabled(!this.busy).onClick(() => { this.act(item, 'FEEDBACK', 'ADOPT'); })
                Button('不适用于本次', { type: ButtonType.Normal }).height(44).fontSize(12).backgroundColor(PMColors.SURFACE).fontColor(PMColors.INK_SECONDARY)
                  .enabled(!this.busy).onClick(() => { this.act(item, 'FEEDBACK', 'NOT_APPLICABLE'); })
              }
            }
            if (item.modelDecision !== null) {
              Text(`模型本次判断：${item.modelDecision.disposition ?? '已记录'}`).fontSize(11).fontColor(PMColors.INK_TERTIARY)
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(10).borderRadius(10)
            .backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER_SUBTLE })
        }, (item: ExperienceSuggestion) => item.id + ':' + item.version)
        if (this.error !== '') { Text(this.error).fontSize(12).fontColor(PMColors.RISK) }
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
}
