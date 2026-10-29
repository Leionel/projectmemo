import { ExperienceSuggestion } from '../models/Experience';
import { ExperienceService } from '../services/ExperienceService';
import { ExperienceActionBody } from '../models/Experience';
import { experienceStatusLabel, experienceSourceText } from '../common/ExperienceContract';
import { PMColors } from '../common/DesignTokens';

// P3-A 项目内经验：委托详情就近展示适用条件、来源样本与停用入口。
// 建议不改变权限；SHADOW 只观察不注入；停用保留历史使用记录。
@Component
export struct ExperiencePanel {
  @Prop projectId: string = '';
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

  private async act(id: string, action: string): Promise<void> {
    if (this.busy) { return; }
    this.busy = true;
    this.error = '';
    try {
      const body: ExperienceActionBody = new ExperienceActionBody();
      body.action = action;
      body.requestId = this.requestKey(id, action);
      await this.service.act(this.projectId, id, body);
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
              Text(experienceStatusLabel(item.status)).fontSize(11).fontColor(PMColors.INK_SECONDARY)
            }.width('100%')
            if (item.conditions.length > 0) {
              Text(`适用：${item.conditions.join('；')}`).fontSize(12).fontColor(PMColors.INK_TERTIARY)
            }
            Text(item.statement).fontSize(12).fontColor(PMColors.INK_SECONDARY).lineHeight(18)
            Text(experienceSourceText(item))
              .fontSize(11).fontColor(PMColors.INK_TERTIARY)
            if (item.status === 'ACTIVE') {
              Button('停用此经验').fontSize(12).backgroundColor(PMColors.SURFACE).fontColor(PMColors.BRAND)
                .enabled(!this.busy).onClick(() => { this.act(item.id, 'REVOKE'); })
            } else if (item.status === 'SHADOW') {
              Button('激活为建议').fontSize(12).backgroundColor(PMColors.BRAND_LIGHT).fontColor(PMColors.BRAND)
                .enabled(!this.busy).onClick(() => { this.act(item.id, 'ACTIVATE'); })
            }
          }.width('100%').alignItems(HorizontalAlign.Start).padding(10).borderRadius(10)
            .backgroundColor(PMColors.SURFACE).border({ width: 1, color: PMColors.BORDER_SUBTLE })
        }, (item: ExperienceSuggestion) => item.id)
        if (this.error !== '') { Text(this.error).fontSize(12).fontColor(PMColors.RISK) }
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
}
