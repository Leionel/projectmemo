import router from '@ohos.router';
import { ConversationFileGuide } from '../models/Conversation';
import { PMColors } from '../common/DesignTokens';

export function openConversationFile(file: ConversationFileGuide, conversationId: string): void {
  if (file.missing) return;
  if (file.kind === 'ATTACHMENT') {
    router.pushUrl({ url: 'pages/AttachmentViewer', params: { projectId: file.projectId, attachmentId: file.entityId, conversationId: conversationId } });
  } else {
    router.pushUrl({ url: 'pages/ProjectHome', params: { projectId: file.projectId, tab: file.kind === 'ARTIFACT' ? 'artifacts' : 'memory', conversationId: conversationId } });
  }
}

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
    Text() {
      ForEach(this.content.split(/(【\d+】)/g), (part: string) => {
        Span(part).fontColor(this.guide(part) ? PMColors.BRAND : PMColors.INK_PRIMARY).onClick(() => {
          const file = this.guide(part); if (file) openConversationFile(file, this.conversationId);
        })
      })
    }.fontSize(15).lineHeight(24).width('100%').textAlign(this.rightAligned ? TextAlign.End : TextAlign.Start).copyOption(CopyOptions.LocalDevice)
  }
}

@Component
export struct ConversationFileGuides {
  @Prop files: ConversationFileGuide[] = [];
  @Prop conversationId: string = '';
  @State private expanded: string = '';
  build() {
    Column({ space: 6 }) {
      ForEach(this.files, (file: ConversationFileGuide) => {
        Column({ space: 8 }) {
          Row({ space: 8 }) {
            Button('【' + file.number + '】' + file.title, { type: ButtonType.Normal })
              .fontSize(13).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).height(44).layoutWeight(1)
              .labelStyle({ maxLines: 1, overflow: TextOverflow.Ellipsis }).padding({ left: 0, right: 4 })
              .onClick(() => { this.expanded = this.expanded === file.sourceId ? '' : file.sourceId; })
            Text((file.quote ? '引用' : '读取') + (file.readScope === 'SUMMARY' ? '摘要' : '片段')).fontSize(11).fontColor(PMColors.INK_TERTIARY)
          }.width('100%')
          if (this.expanded === file.sourceId) {
            if (file.stale) { Text('引用后已有修订，下方保留当时读取的片段。').fontSize(12).fontColor(PMColors.WARNING) }
            if (file.missing) { Text('原资料已不可用，保留历史片段。').fontSize(12).fontColor(PMColors.INK_SECONDARY) }
            if (file.archived) { Text('资料已归档').fontSize(12).fontColor(PMColors.INK_SECONDARY) }
            Text(file.quote ?? file.excerpt).fontSize(13).lineHeight(21).fontColor(PMColors.INK_SECONDARY).copyOption(CopyOptions.LocalDevice)
            if (!file.missing) {
              Button(file.kind === 'ATTACHMENT' ? '打开原文件 ↗' : file.kind === 'ARTIFACT' ? '查看原成果 ↗' : '查看项目资料 ↗', { type: ButtonType.Normal })
                .height(44).fontSize(12).fontColor(PMColors.BRAND).backgroundColor(Color.Transparent).padding({ left: 0, right: 8 })
                .onClick(() => { openConversationFile(file, this.conversationId); })
            }
          }
        }.width('100%').alignItems(HorizontalAlign.Start).padding({ left: 10, right: 10 })
          .backgroundColor(PMColors.SURFACE).borderRadius(10).border({ width: 1, color: PMColors.BORDER_SUBTLE })
      }, (file: ConversationFileGuide) => file.sourceId)
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
