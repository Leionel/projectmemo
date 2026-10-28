import { ConversationMessage } from '../models/Conversation';
import { ConversationResearchInfo, ResearchScopeInput, ResearchSummaryInput, ResearchSummaryReply, ResearchFacet, ResearchConflict } from '../models/ConversationResearch';
import { ConversationService } from '../services/ConversationService';
import { PMColors } from '../common/DesignTokens';

@Component
export struct ConversationResearchControl {
  @Prop conversationId: string = '';
  @Prop projectId: string = '';
  @Prop info: ConversationResearchInfo;
  @Prop disabled: boolean = false;
  onSaved: () => void = (): void => {};
  @State private open: boolean = false;
  @State private topic: string = '';
  @State private terms: string = '';
  @State private hosts: string = '';
  @State private error: string = '';
  @State private saving: boolean = false;
  private service: ConversationService = new ConversationService();
  private async save(enabled: boolean): Promise<void> {
    const input = new ResearchScopeInput(); input.expectedRevision = this.info.revision;
    input.projectId = this.projectId || this.info.projectId || '';
    input.scope.enabled = enabled; input.scope.topic = this.topic.trim(); input.scope.publicTerms = this.terms.split(/[,，\n]/).map((v: string) => v.trim()).filter((v: string) => v !== '');
    input.scope.allowedHosts = this.hosts.split(/[,，\n]/).map((v: string) => v.trim().toLowerCase()).filter((v: string) => v !== '');
    this.saving = true;
    try { await this.service.saveResearchScope(this.conversationId, input); this.open = false; this.onSaved(); }
    catch { this.error = '范围未保存，请核对公开主题、概念和当前项目'; }
    finally { this.saving = false; }
  }
  build() {
    Column({ space: 8 }) {
      Button(this.info.scope.enabled ? '联网研究 ✓' : '联网研究', { type: ButtonType.Normal }).height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent)
        .enabled(!this.disabled && !this.saving).onClick(() => { this.topic = this.info.scope.topic; this.terms = this.info.scope.publicTerms.join('，'); this.hosts = this.info.scope.allowedHosts.join('，'); this.open = !this.open; })
      if (this.open) {
        TextInput({ text: this.topic, placeholder: '公开研究主题' }).height(44).fontSize(14).onChange((v: string) => { this.topic = v; })
        TextInput({ text: this.terms, placeholder: '允许外发的公开概念，用逗号分隔' }).height(44).fontSize(14).onChange((v: string) => { this.terms = v; })
        TextInput({ text: this.hosts, placeholder: '限定域名（可选）' }).height(44).fontSize(14).onChange((v: string) => { this.hosts = v; })
        Text('搜索仅发送确认的公开范围。私聊和未公开实验值不作为搜索词。').fontSize(12).fontColor(PMColors.INK_SECONDARY)
        if (this.error !== '') { Text(this.error).fontSize(12).fontColor(PMColors.WARNING) }
        Row({ space: 12 }) {
          Button('确认范围', { type: ButtonType.Normal }).height(44).fontSize(13).backgroundColor(PMColors.BRAND).enabled(!this.saving && this.topic.trim() !== '' && this.terms.trim() !== '').onClick(() => { this.save(true); })
          if (this.info.scope.enabled) { Button('关闭联网', { type: ButtonType.Normal }).height(44).fontSize(13).backgroundColor(Color.Transparent).fontColor(PMColors.BRAND).onClick(() => { this.save(false); }) }
          Button('取消', { type: ButtonType.Normal }).height(44).fontSize(13).backgroundColor(Color.Transparent).fontColor(PMColors.INK_SECONDARY).onClick(() => { this.open = false; })
        }
      }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}

@Component
export struct ConversationResearchResult {
  @Prop message: ConversationMessage;
  @Prop conversationId: string = '';
  @Prop version: number = 1;
  @Prop disabled: boolean = false;
  onContinue: (value: string) => void = (_: string): void => {};
  @State private expanded: boolean = false;
  @State private draft: ResearchSummaryReply | null = null;
  @State private notice: string = '';
  private service: ConversationService = new ConversationService();
  private async summarize(confirm: boolean): Promise<void> {
    const input = new ResearchSummaryInput(); input.action = confirm ? 'CONFIRM' : 'PREVIEW'; input.expectedConversationVersion = this.version;
    if (confirm && this.draft) input.previewHash = this.draft.previewHash;
    try { const result = await this.service.researchSummary(this.conversationId, this.message.id, input);
      if (result.artifactId) { this.notice = '研究总结已归入项目，来源与适用条件已保留'; this.draft = null; } else this.draft = result;
    } catch { this.notice = '研究总结未保存，请核对原状态和研究范围'; }
  }
  build() {
    Column({ space: 8 }) {
      if (this.message.researchCoverage) {
        Button(this.expanded ? '收起研究覆盖 ⌃' : '调查覆盖与缺口 ⌄', { type: ButtonType.Normal }).height(44).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).onClick(() => { this.expanded = !this.expanded; })
        if (this.expanded) {
          ForEach(this.message.researchCoverage.facets, (facet: ResearchFacet) => {
            Column({ space: 5 }) {
              Text(facet.question).fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
              ForEach(facet.missing, (line: string) => { Text('待核对：' + line).fontSize(13).fontColor(PMColors.INK_SECONDARY) })
              ForEach(facet.conflicts, (conflict: ResearchConflict) => { Text('来源冲突：' + conflict.claim).fontSize(13).fontColor(PMColors.INK_SECONDARY) })
            }.width('100%').alignItems(HorizontalAlign.Start)
          }, (facet: ResearchFacet) => facet.id)
        }
      }
      Row({ space: 8 }) {
        Button('继续调查', { type: ButtonType.Normal }).fontSize(13).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.disabled).onClick(() => { this.onContinue('请依据这条回答的研究缺口继续调查；新信息可能改变建议时才联网。'); })
        Button('为什么这样建议', { type: ButtonType.Normal }).fontSize(13).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.disabled).onClick(() => { this.onContinue('请结合原来源解释推荐的适用条件与反面证据。'); })
      }
      Row({ space: 8 }) {
        Button('准备验证', { type: ButtonType.Normal }).fontSize(13).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.disabled).onClick(() => { this.onContinue('请把这条研究结论转成项目验证提案，沿用已有委托或行动，先预览供我确认。'); })
        Button('保存研究总结', { type: ButtonType.Normal }).fontSize(13).height(44).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.disabled).onClick(() => { this.summarize(false); })
      }
      if (this.draft) {
        Text('确认后项目成员可见；保留来源、适用条件与未知。').fontSize(12).fontColor(PMColors.INK_SECONDARY)
        Text(this.draft!.content).fontSize(14).lineHeight(23).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.LocalDevice)
        Row({ space: 12 }) {
          Button('确认归入项目', { type: ButtonType.Normal }).height(44).fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).enabled(!this.disabled).onClick(() => { this.summarize(true); })
          Button('取消', { type: ButtonType.Normal }).height(44).fontSize(13).fontColor(PMColors.INK_SECONDARY).backgroundColor(Color.Transparent).onClick(() => { this.draft = null; })
        }
      }
      if (this.notice !== '') { Text(this.notice).fontSize(13).fontColor(PMColors.INK_SECONDARY) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
