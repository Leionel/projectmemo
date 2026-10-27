import { agentStateLabel, receiptDetail } from '../common/AgentPresentationContract';
import { AgentPresentation, HydratedBlock, AllowedAction, RichTextNode, ExperienceInlineText, EvidenceLink, GoalCriterion, ExperienceCandidate, InvestigationStep, ExperienceTimelineEvent, ExperienceChoice } from '../models/AgentExperience';
import { ConversationFileGuide } from '../models/Conversation';
import { ConversationFileGuides } from './ConversationFileGuides';
import { ConversationDraftStore, ConversationDraft } from '../services/ConversationDraftStore';
import { PMColors } from '../common/DesignTokens';

@Component
struct AgentRichText {
  @Prop nodes: RichTextNode[] = [];
  @Builder private Spans(spans: ExperienceInlineText[]) {
    Text() {
      ForEach(spans, (s: ExperienceInlineText) => {
        Span(s.text).fontWeight(s.kind === 'strong' ? FontWeight.Bold : FontWeight.Normal)
          .fontStyle(s.kind === 'emphasis' ? FontStyle.Italic : FontStyle.Normal).fontFamily(s.kind === 'code' ? 'monospace' : 'HarmonyOS Sans')
      })
    }.fontSize(16).lineHeight(27).fontColor(PMColors.INK_PRIMARY).width('100%').copyOption(CopyOptions.InApp)
  }
  build() {
    Column({ space: 10 }) {
      ForEach(this.nodes, (node: RichTextNode) => {
        if (node.type === 'paragraph') { this.Spans(node.spans ?? []) }
        else if (node.type === 'heading') { Text((node.spans ?? []).map((s: ExperienceInlineText): string => s.text).join('')).fontSize(node.level === 2 ? 19 : 17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).width('100%') }
        else if (node.type === 'list') {
          Column({ space: 8 }) {
            ForEach(node.items ?? [], (items: ExperienceInlineText[], index: number) => {
              Row({ space: 10 }) { Text(node.ordered ? `${index + 1}.` : '·').fontColor(PMColors.BRAND); this.Spans(items) }.alignItems(VerticalAlign.Top).width('100%')
            })
          }.padding({ left: 8 }).width('100%')
        } else if (node.type === 'code') { Text(node.text ?? '').fontFamily('monospace').fontSize(14).lineHeight(23).fontColor(PMColors.INK_PRIMARY).padding(12).width('100%').backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(8).copyOption(CopyOptions.InApp) }
        else if (node.type === 'table') {
          Scroll() {
            Column() {
              Row() { ForEach(node.headers ?? [], (s: string) => { Text(s).fontSize(14).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).width(160).padding(10) }) }.backgroundColor(PMColors.SURFACE_SUBTLE)
              ForEach(node.rows ?? [], (row: string[]) => { Row() { ForEach(row, (s: string) => { Text(s).fontSize(14).lineHeight(22).fontColor(PMColors.INK_SECONDARY).width(160).padding(10) }) }.alignItems(VerticalAlign.Top) })
            }
          }.scrollable(ScrollDirection.Horizontal).width('100%').accessibilityText('回答中的对照表，可横向滚动')
        } else { Text(node.text ?? '').fontSize(16).fontColor(PMColors.INK_PRIMARY) }
      })
    }.alignItems(HorizontalAlign.Start).width('100%')
  }
}
@Component
struct AgentSemanticBlock {
  @Prop block: HydratedBlock = { blockKey: '', semanticType: '', emphasis: 'supporting', fallbackText: '', refs: [], actionBindingIds: [] };
  @Prop actions: AllowedAction[] = [];
  @Prop conversationId: string = '';
  @Prop messageId: string = '';
  @Prop busy: boolean = false;
  onAction: (action: AllowedAction, answer: string) => void = (): void => {};
  @State private expanded: boolean = false;
  @State private answer: string = '';
  @State private selected: string = '';
  private draftKey(): string { return this.block.draftKey ?? `${this.conversationId}:${this.messageId}:${this.block.blockKey}`; }
  aboutToAppear(): void { const draft = ConversationDraftStore.read(this.draftKey()); this.answer = draft.answer; this.selected = draft.selected[0] ?? ''; this.expanded = this.block.emphasis === 'primary' && this.block.semanticType === 'evidence'; }
  private save(): void { const draft = new ConversationDraft(); draft.answer = this.answer; draft.selected = this.selected === '' ? [] : [this.selected]; ConversationDraftStore.save(this.draftKey(), draft); }
  @Builder private Controls() {
    Flex({ wrap: FlexWrap.Wrap }) {
      ForEach(this.actions.filter((a: AllowedAction) => !a.frozen?.candidateId || a.frozen.candidateId === this.selected), (a: AllowedAction) => {
        Column({ space: 4 }) {
          Button({ type: ButtonType.Normal }) { Text(a.label).fontSize(14).fontWeight(FontWeight.Medium).textAlign(TextAlign.Center).padding({ left: 14, right: 14, top: 12, bottom: 12 }) }
            .constraintSize({ minHeight: 44 }).fontColor(a.actionKind === 'CONFIRM' ? PMColors.SURFACE : PMColors.BRAND)
            .backgroundColor(a.actionKind === 'CONFIRM' ? PMColors.BRAND : PMColors.SURFACE_SUBTLE).borderRadius(10)
            .enabled(!this.busy && a.enabled && (a.actionKind !== 'ASK' || this.block.semanticType !== 'question' || this.answer.trim() !== ''))
            .accessibilityText(a.label).accessibilityDescription(a.disabledReason ?? '').margin({ right: 8, top: 6 })
            .onClick(() => { this.onAction(a, this.block.semanticType === 'question' ? this.answer.trim() : ''); })
          if (!a.enabled && a.disabledReason) { Text(a.disabledReason).fontSize(12).fontColor(PMColors.INK_TERTIARY) }
        }.alignItems(HorizontalAlign.Start)
      }, (a: AllowedAction) => a.bindingId)
    }.width('100%')
  }
  build() {
    Column({ space: 10 }) {
      if (this.block.semanticType === 'prose') { AgentRichText({ nodes: this.block.content ?? [] }) }
      else if (this.block.semanticType === 'goal_gap' && this.block.goalGap) {
        Text('离目标还差什么').fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        if (this.block.goalGap.criteria.length !== 1 || this.block.goalGap.criteria[0].requirement !== this.block.goalGap.goalQuote) {
          Text(this.block.goalGap.goalQuote).fontSize(13).lineHeight(22).fontColor(PMColors.INK_TERTIARY)
        }
        ForEach(this.block.goalGap.criteria, (c: GoalCriterion) => {
          Column({ space: 4 }) {
            Text(c.requirement).fontSize(15).lineHeight(24).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
            Text(agentStateLabel(c.state)).fontSize(12).fontColor(c.state === 'BLOCKED' ? PMColors.RISK : PMColors.BRAND)
            Text(c.explanation).fontSize(14).lineHeight(23).fontColor(PMColors.INK_SECONDARY)
          }.alignItems(HorizontalAlign.Start).width('100%').padding({ bottom: 6 })
        }, (c: GoalCriterion) => c.id)
        if (this.block.goalGap.nextInformationNeed) { Text('接下来要明确：' + this.block.goalGap.nextInformationNeed).fontSize(14).lineHeight(23).fontColor(PMColors.BRAND) }
        this.Controls()
      } else if (this.block.semanticType === 'approval' || this.block.semanticType === 'receipt') {
        Column({ space: 10 }) {
          Text(agentStateLabel(this.block.state ?? 'UNKNOWN')).fontSize(13).fontColor(PMColors.BRAND)
          Text(this.block.fallbackText.split('\n')[0]).fontSize(16).lineHeight(26).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
          if (this.block.fallbackText.includes('\n')) { Text(this.block.fallbackText.split('\n').slice(1).join('\n')).fontSize(14).lineHeight(23).fontColor(PMColors.INK_SECONDARY) }
          if (this.block.semanticType === 'receipt') { Text(receiptDetail(this.block.state ?? 'UNKNOWN', this.block.verification ?? 'NOT_CHECKED')).fontSize(13).lineHeight(22).fontColor(PMColors.INK_SECONDARY) }
          this.Controls()
        }.padding(16).width('100%').alignItems(HorizontalAlign.Start).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(12).border({ width: 1, color: PMColors.BORDER_SUBTLE })
      } else if (this.block.semanticType === 'evidence' || this.block.semanticType === 'investigation') {
        Button(this.block.fallbackText + (this.expanded ? '  ⌃' : '  ⌄'), { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).fontSize(14).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 6 }).onClick(() => { this.expanded = !this.expanded; })
        if (this.expanded) {
          ForEach(this.block.evidence ?? [], (e: EvidenceLink) => {
            Column({ space: 6 }) { Text(e.quote).fontSize(15).lineHeight(25).fontColor(PMColors.INK_PRIMARY).copyOption(CopyOptions.InApp); Text(e.claim).fontSize(13).lineHeight(22).fontColor(PMColors.INK_SECONDARY); if (e.relation === 'CONTRADICTS') { Text('这条记录与目标条件存在冲突').fontSize(13).fontColor(PMColors.RISK) } }.alignItems(HorizontalAlign.Start).width('100%').padding(12).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10)
          })
          ForEach(this.block.steps ?? [], (s: InvestigationStep) => { Text((s.status === 'SUCCEEDED' ? '✓ ' : '· ') + (s.decision.informationNeed ?? '核对资料') + '\n' + (s.status === 'SUCCEEDED' ? '已读取原资料' : s.failureReason ?? '正在核对')).fontSize(14).lineHeight(24).fontColor(PMColors.INK_SECONDARY) }, (s: InvestigationStep) => s.id)
          this.Controls()
        }
      } else if (this.block.semanticType === 'question') {
        Text(this.block.question ?? this.block.fallbackText).fontSize(16).lineHeight(27).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY)
        ForEach(this.block.choices ?? [], (c: ExperienceChoice) => { Button(c.label, { type: ButtonType.Normal }).constraintSize({ minHeight: 44 }).fontSize(14).fontColor(PMColors.BRAND).backgroundColor(PMColors.SURFACE_SUBTLE).enabled(!this.busy).onClick(() => { this.answer = c.label; this.save(); }) })
        TextArea({ text: this.answer, placeholder: '补充关键条件，接着讨论…' }).height(100).fontSize(16).maxLength(3000).backgroundColor(PMColors.SURFACE_SUBTLE).fontColor(PMColors.INK_PRIMARY).enabled(!this.busy && this.actions.some((a: AllowedAction) => a.enabled)).accessibilityText(this.block.question ?? '补充条件').onChange((value: string) => { this.answer = value; this.save(); })
        this.Controls()
      } else if (this.block.semanticType === 'comparison') {
        Text('下一步的取舍').fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        ForEach(this.block.candidates ?? [], (c: ExperienceCandidate) => {
          Button({ type: ButtonType.Normal }) {
            Column({ space: 6 }) { Text((this.selected === c.id ? '✓ ' : '') + c.title).fontSize(15).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY); Text(c.tradeoff).fontSize(14).lineHeight(23).fontColor(PMColors.INK_SECONDARY); if (c.expectedObservation) { Text('要明确：' + c.expectedObservation).fontSize(13).lineHeight(22).fontColor(PMColors.BRAND) } if (this.selected === c.id) { Text(c.stopCondition).fontSize(13).lineHeight(22).fontColor(PMColors.INK_SECONDARY) } }.alignItems(HorizontalAlign.Start).width('100%').padding(14)
          }.backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).width('100%').enabled(!this.busy && c.feasibility === 'READY').accessibilitySelected(this.selected === c.id).onClick(() => { this.selected = c.id; this.save(); })
        }, (c: ExperienceCandidate) => c.id)
        this.Controls()
      } else if (this.block.semanticType === 'change') {
        Text(this.block.disposition === 'KEEP_PLAN' ? '保留当前计划' : this.block.fallbackText).fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY)
        Text(this.block.goalQuote ?? '').fontSize(13).lineHeight(22).fontColor(PMColors.INK_TERTIARY)
        Text(this.block.relevance ?? this.block.fallbackText).fontSize(16).lineHeight(27).fontColor(PMColors.INK_PRIMARY)
        ForEach(this.block.unknowns ?? [], (s: string) => { Text(s).fontSize(14).lineHeight(23).fontColor(PMColors.INK_SECONDARY) }); this.Controls()
      } else if (this.block.semanticType === 'timeline') {
        ForEach(this.block.events ?? [], (e: ExperienceTimelineEvent) => { Column({ space: 4 }) { Text(e.occurredAt.slice(0, 10)).fontSize(12).fontColor(PMColors.INK_TERTIARY); Text(e.summary).fontSize(15).lineHeight(25).fontColor(PMColors.INK_PRIMARY) }.alignItems(HorizontalAlign.Start).width('100%') }, (e: ExperienceTimelineEvent) => e.ref.id)
      } else { Text(this.block.fallbackText).fontSize(16).lineHeight(27).fontColor(PMColors.INK_PRIMARY) }
    }.width('100%').alignItems(HorizontalAlign.Start).id('agent-block-' + this.block.blockKey).accessibilityGroup(this.block.semanticType === 'receipt')
  }
}
@Component
export struct AgentMessageBlocks {
  @Prop presentation: AgentPresentation = { schemaVersion: 1, blocks: [], allowedActions: [] };
  @Prop files: ConversationFileGuide[] = [];
  @Prop conversationId: string = '';
  @Prop messageId: string = '';
  @Prop busy: boolean = false;
  onAction: (action: AllowedAction, answer: string) => void = (): void => {};
  build() {
    Column({ space: 18 }) {
      ForEach(this.presentation.blocks, (block: HydratedBlock, index: number) => {
        AgentSemanticBlock({ block: this.presentation.blocks[index], conversationId: this.conversationId, messageId: this.messageId, busy: this.busy,
          actions: this.presentation.allowedActions.filter((a: AllowedAction) => this.presentation.blocks[index].actionBindingIds.includes(a.bindingId)), onAction: this.onAction })
      }, (block: HydratedBlock) => block.blockKey)
      if (this.files.length > 0) { ConversationFileGuides({ files: this.files, conversationId: this.conversationId }) }
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
