import { researchReadLevelLabel } from '../common/ResearchPresentation';
import router from '@ohos.router';
import { ConversationFileGuide, ConversationSource } from '../models/Conversation';
import { PMColors } from '../common/DesignTokens';
import { ConversationToolButton } from './ConversationToolButton';

export function openConversationFile(file: ConversationFileGuide, conversationId: string): void {
  if (file.missing) { return; }
  if (file.document) {
    router.pushUrl({ url: 'pages/ConversationWebSource', params: { conversationId: file.document.conversationId || conversationId, turnId: file.document.turnId || '', sourceId: file.sourceId.split('/').pop() || '', missionId: file.document.missionId || '' } });
  } else if (file.kind === 'WEB' && file.external) {
    router.pushUrl({ url: 'pages/ConversationWebSource', params: { conversationId: file.external.conversationId, turnId: file.external.turnId, sourceId: file.entityId } });
  } else if (file.kind === 'ATTACHMENT') {
    router.pushUrl({ url: 'pages/AttachmentViewer', params: { projectId: file.projectId, attachmentId: file.entityId, conversationId: conversationId } });
  } else {
    router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: file.projectId, tab: file.kind === 'ARTIFACT' ? 'artifacts' : 'memory', conversationId: conversationId } });
  }
}

function sourceKindLabel(kind: string): string {
  if (kind === 'WEB') { return '网页引用'; }
  if (kind === 'CALENDAR') { return '日历来源'; }
  if (kind === 'ATTACHMENT') { return '文档与附件'; }
  if (kind === 'ARTIFACT') { return '项目成果'; }
  return '项目记录';
}

function extraKindLabel(source: ConversationSource): string {
  if (source.calendar !== undefined) { return '日历来源'; }
  if (source.external !== undefined) { return '网页引用'; }
  if (source.document !== undefined) { return '文档与附件'; }
  return '项目记录';
}

function openLabel(file: ConversationFileGuide): string {
  if (file.document) { return '查看原页与引用'; }
  if (file.kind === 'WEB') { return '查看网页来源'; }
  if (file.kind === 'CALENDAR') { return '查看日历来源'; }
  if (file.kind === 'ATTACHMENT') { return '打开原文件'; }
  if (file.kind === 'ARTIFACT') { return '查看原成果'; }
  return '查看项目资料';
}

const KIND_GROUPS: string[] = ['文档与附件', '网页引用', '日历来源', '项目记录', '项目成果'];

/** fileGuides 之外的观察记录；按 sourceId 去重后并入同一资料面板。 */
interface SourceEntry { kind: string; title: string; meta: string; body: string; warning: string; link: string; sourceId: string; open: () => void; }

@Component
export struct ConversationAnswer {
  @Prop content: string = '';
  @Prop files: ConversationFileGuide[] = [];
  @Prop conversationId: string = '';
  @Prop rightAligned: boolean = false;
  private guide(part: string): ConversationFileGuide | undefined {
    const match = /^【(\d+)】$/.exec(part);
    return match ? this.files.find((f: ConversationFileGuide) => f.number === Number(match[1]) && !f.missing) : undefined;
  }
  build() {
    // 不锁 width('100%')：短消息按内容收拢，长文本撑满后自然换行。
    Text() {
      ForEach(this.content.split(/(【\d+】)/g), (part: string) => {
        Span(part).fontColor(this.guide(part) ? PMColors.BRAND : PMColors.INK_PRIMARY).onClick(() => {
          const file = this.guide(part); if (file) { openConversationFile(file, this.conversationId); }
        })
      })
    }.fontSize(16).lineHeight(26).constraintSize({ maxWidth: '100%' })
      .textAlign(this.rightAligned ? TextAlign.End : TextAlign.Start).copyOption(CopyOptions.LocalDevice)
  }
}

/**
 * 回答下方的唯一资料入口：正文之后只保留一个「引用资料 N」，
 * 全部来源（含 fileGuides 之外的观察记录）进入独立底部弹层，按类型分组。
 */
@Component
export struct ConversationFileGuides {
  @Prop files: ConversationFileGuide[] = [];
  @Prop sources: ConversationSource[] = [];
  @Prop conversationId: string = '';
  @State sheetOpen: boolean = false;
  private entries(): SourceEntry[] {
    const rows: SourceEntry[] = [];
    for (const file of this.files) {
      const meta: string[] = [];
      meta.push((file.quote ? '引用' : '读取') + (file.readScope === 'SUMMARY' ? '摘要' : '片段'));
      if (file.external) { meta.push(researchReadLevelLabel(file.external.readLevel) + ' · 抓取于 ' + file.external.fetchedAt.slice(0, 10) + (file.external.truncated ? ' · 已截断' : '')); }
      if (file.document) { meta.push((file.document.pages.length > 0 ? '原件物理第 ' + file.document.pages[0].toString() + ' 页' : '目录或校对文本') + (file.document.kind === 'TABLE' ? ' · 表头待核对' : '')); }
      rows.push({
        kind: sourceKindLabel(file.kind),
        title: '【' + file.number + '】' + file.title,
        meta: meta.join(' · '),
        body: file.quote ?? file.excerpt,
        warning: file.stale ? '引用后已有修订，保留当时读取的片段。' : file.missing ? '原资料已不可用，保留历史片段。' : file.archived ? '资料已归档，归档不改变引用时的事实状态。' : '',
        link: file.missing ? '' : openLabel(file),
        sourceId: file.sourceId,
        open: (): void => { openConversationFile(file, this.conversationId); }
      });
    }
    const known = new Set<string>(this.files.map((f: ConversationFileGuide): string => f.sourceId));
    for (const source of this.sources) {
      if (known.has(source.sourceId)) { continue; }
      rows.push({
        kind: extraKindLabel(source),
        title: source.title,
        meta: source.temporalState + ' · ' + source.observedAt.slice(0, 16).replace('T', ' '),
        body: source.excerpt,
        warning: '',
        link: '',
        sourceId: source.sourceId,
        open: (): void => {}
      });
    }
    return rows;
  }
  private count(): number { return this.entries().length; }
  private group(kind: string): SourceEntry[] { return this.entries().filter((e: SourceEntry): boolean => e.kind === kind); }
  @Builder
  private EntryRow(row: SourceEntry) {
    Column({ space: 6 }) {
      Row({ space: 8 }) {
        Text(row.title).fontSize(14).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
        if (row.warning !== '') { Text('已修订').fontSize(11).fontColor(PMColors.WARNING) }
      }.width('100%')
      if (row.meta !== '') { Text(row.meta).fontSize(11).lineHeight(17).fontColor(PMColors.INK_TERTIARY) }
      if (row.warning !== '') { Text(row.warning).fontSize(12).lineHeight(18).fontColor(PMColors.WARNING) }
      if (row.body !== '') { Text(row.body).fontSize(13).lineHeight(20).fontColor(PMColors.INK_SECONDARY).copyOption(CopyOptions.LocalDevice) }
      if (row.link !== '') {
        Button(row.link, { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
          .fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
          .onClick(() => { row.open(); })
      }
    }.width('100%').alignItems(HorizontalAlign.Start).padding(12)
      .backgroundColor(PMColors.SURFACE).borderRadius(10).border({ width: 1, color: PMColors.BORDER_SUBTLE })
  }
  @Builder
  private GroupSection(title: string, kind: string) {
    if (this.group(kind).length > 0) {
      Column({ space: 8 }) {
        Text(title).fontSize(13).fontWeight(FontWeight.Medium).fontColor(PMColors.INK_SECONDARY)
        ForEach(this.group(kind), (row: SourceEntry) => { this.EntryRow(row) }, (row: SourceEntry) => row.sourceId)
      }.width('100%').alignItems(HorizontalAlign.Start)
    }
  }
  @Builder
  private SheetBody() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        Text('本次回答的资料').fontSize(17).fontWeight(FontWeight.Bold).fontColor(PMColors.INK_PRIMARY).layoutWeight(1)
        Button('完成', { type: ButtonType.Normal }).constraintSize({ minHeight: 40 }).fontSize(13)
          .fontColor(PMColors.INK_SECONDARY).backgroundColor(PMColors.SURFACE_SUBTLE).borderRadius(10).padding({ left: 14, right: 14 })
          .onClick(() => { this.sheetOpen = false; })
      }.width('100%')
      Scroll() {
        Column({ space: 14 }) {
          ForEach(KIND_GROUPS, (kind: string) => { this.GroupSection(kind, kind) }, (kind: string) => kind)
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ bottom: 12 })
      }.width('100%').constraintSize({ maxHeight: 560 }).scrollBar(BarState.Auto).align(Alignment.Top)
    }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 18, right: 18, top: 14, bottom: 10 })
  }
  build() {
    Column() {
      if (this.files.length > 0 || this.sources.length > 0) {
        ConversationToolButton({ icon: $r('sys.symbol.doc_text_on_doc_text'), label: '查看引用资料', count: this.count(),
          onAction: () => { this.sheetOpen = true; } })
      }
    }
    .bindSheet($$this.sheetOpen, this.SheetBody(), {
      height: SheetSize.FIT_CONTENT,
      dragBar: true,
      showClose: false
    })
  }
}
