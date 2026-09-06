import { PMColors, PMSpacing, PMFontSize, PMRadius, PMFontFamily } from '../common/DesignTokens';

export class InlineSpan {
  text: string = '';
  isBold: boolean = false;
  isItalic: boolean = false;
  isCode: boolean = false;
  isStrike: boolean = false;

  constructor(text: string, isBold: boolean = false, isItalic: boolean = false, isCode: boolean = false, isStrike: boolean = false) {
    this.text = text;
    this.isBold = isBold;
    this.isItalic = isItalic;
    this.isCode = isCode;
    this.isStrike = isStrike;
  }
}

export enum MarkdownBlockType {
  H1,
  H2,
  H3,
  H4,
  PARAGRAPH,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CODE_BLOCK,
  HR,
  EMPTY
}

export class MarkdownBlock {
  type: MarkdownBlockType = MarkdownBlockType.PARAGRAPH;
  content: string = '';
  listPrefix: string = '';
  codeLanguage: string = '';
}

@Component
export struct MarkdownView {
  @Prop content: string = '';

  private parseInline(text: string): InlineSpan[] {
    const result: InlineSpan[] = [];
    if (!text || text === '') {
      return result;
    }

    // 匹配 ***粗斜体***, **粗体**, *斜体*, ___粗斜体___, __粗体__, _斜体_, `代码`, ~~删除线~~
    const regex = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|___[^_]+___|__[^_]+__|_[^_]+_|`[^`]+`|~~[^~]+~~)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(text)) !== null) {
      const matchIndex = match.index;
      const matchStr = match[0];

      if (matchIndex > lastIndex) {
        result.push(new InlineSpan(text.substring(lastIndex, matchIndex)));
      }

      if (matchStr.startsWith('***') && matchStr.endsWith('***') && matchStr.length > 6) {
        result.push(new InlineSpan(matchStr.substring(3, matchStr.length - 3), true, true, false, false));
      } else if (matchStr.startsWith('**') && matchStr.endsWith('**') && matchStr.length > 4) {
        result.push(new InlineSpan(matchStr.substring(2, matchStr.length - 2), true, false, false, false));
      } else if (matchStr.startsWith('*') && matchStr.endsWith('*') && matchStr.length > 2) {
        result.push(new InlineSpan(matchStr.substring(1, matchStr.length - 1), false, true, false, false));
      } else if (matchStr.startsWith('___') && matchStr.endsWith('___') && matchStr.length > 6) {
        result.push(new InlineSpan(matchStr.substring(3, matchStr.length - 3), true, true, false, false));
      } else if (matchStr.startsWith('__') && matchStr.endsWith('__') && matchStr.length > 4) {
        result.push(new InlineSpan(matchStr.substring(2, matchStr.length - 2), true, false, false, false));
      } else if (matchStr.startsWith('_') && matchStr.endsWith('_') && matchStr.length > 2) {
        result.push(new InlineSpan(matchStr.substring(1, matchStr.length - 1), false, true, false, false));
      } else if (matchStr.startsWith('`') && matchStr.endsWith('`') && matchStr.length > 2) {
        result.push(new InlineSpan(matchStr.substring(1, matchStr.length - 1), false, false, true, false));
      } else if (matchStr.startsWith('~~') && matchStr.endsWith('~~') && matchStr.length > 4) {
        result.push(new InlineSpan(matchStr.substring(2, matchStr.length - 2), false, false, false, true));
      } else {
        result.push(new InlineSpan(matchStr));
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      result.push(new InlineSpan(text.substring(lastIndex)));
    }

    if (result.length === 0) {
      result.push(new InlineSpan(text));
    }

    return result;
  }

  private parseBlocks(): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    const lines = this.content.split('\n');
    let inCodeBlock = false;
    let codeBuffer: string[] = [];
    let codeLang = '';

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      // 代码块围栏判断
      if (trimmed.startsWith('```')) {
        if (inCodeBlock) {
          const block = new MarkdownBlock();
          block.type = MarkdownBlockType.CODE_BLOCK;
          block.content = codeBuffer.join('\n');
          block.codeLanguage = codeLang;
          blocks.push(block);

          inCodeBlock = false;
          codeBuffer = [];
          codeLang = '';
        } else {
          inCodeBlock = true;
          codeLang = trimmed.substring(3).trim();
          codeBuffer = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(rawLine);
        continue;
      }

      if (trimmed === '') {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.EMPTY;
        blocks.push(block);
        continue;
      }

      // 分割线
      if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.HR;
        blocks.push(block);
        continue;
      }

      // 标题
      if (trimmed.startsWith('# ')) {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.H1;
        block.content = trimmed.substring(2).trim();
        blocks.push(block);
        continue;
      }
      if (trimmed.startsWith('## ')) {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.H2;
        block.content = trimmed.substring(3).trim();
        blocks.push(block);
        continue;
      }
      if (trimmed.startsWith('### ')) {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.H3;
        block.content = trimmed.substring(4).trim();
        blocks.push(block);
        continue;
      }
      if (trimmed.startsWith('#### ')) {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.H4;
        block.content = trimmed.substring(5).trim();
        blocks.push(block);
        continue;
      }

      // 引用
      if (trimmed.startsWith('> ') || trimmed === '>') {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.QUOTE;
        block.content = trimmed.startsWith('> ') ? trimmed.substring(2) : '';
        blocks.push(block);
        continue;
      }

      // 无序列表
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('+ ')) {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.UNORDERED_LIST;
        block.content = trimmed.substring(2);
        blocks.push(block);
        continue;
      }

      // 有序列表
      const orderedMatch = trimmed.match(/^(\d+\.)\s+(.*)$/);
      if (orderedMatch && orderedMatch.length >= 3) {
        const block = new MarkdownBlock();
        block.type = MarkdownBlockType.ORDERED_LIST;
        block.listPrefix = orderedMatch[1];
        block.content = orderedMatch[2];
        blocks.push(block);
        continue;
      }

      // 普通段落
      const block = new MarkdownBlock();
      block.type = MarkdownBlockType.PARAGRAPH;
      block.content = trimmed;
      blocks.push(block);
    }

    if (inCodeBlock && codeBuffer.length > 0) {
      const block = new MarkdownBlock();
      block.type = MarkdownBlockType.CODE_BLOCK;
      block.content = codeBuffer.join('\n');
      block.codeLanguage = codeLang;
      blocks.push(block);
    }

    return blocks;
  }

  build() {
    Column() {
      ForEach(this.parseBlocks(), (block: MarkdownBlock, index: number) => {
        if (block.type === MarkdownBlockType.H1) {
          Text() {
            ForEach(this.parseInline(block.content), (span: InlineSpan, sIdx: number) => {
              Span(span.text)
                .fontSize(PMFontSize.PAGE_TITLE)
                .fontWeight(FontWeight.Bold)
                .fontFamily(PMFontFamily.SERIF_BLACK)
                .fontColor(PMColors.INK_PRIMARY)
            }, (span: InlineSpan, sIdx: number) => `h1-s-${sIdx}`)
          }
          .margin({ top: PMSpacing.LG, bottom: PMSpacing.SM })
        } else if (block.type === MarkdownBlockType.H2) {
          Text() {
            ForEach(this.parseInline(block.content), (span: InlineSpan, sIdx: number) => {
              Span(span.text)
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Bold)
                .fontFamily(PMFontFamily.SERIF)
                .fontColor(PMColors.INK_PRIMARY)
            }, (span: InlineSpan, sIdx: number) => `h2-s-${sIdx}`)
          }
          .margin({ top: PMSpacing.MD, bottom: PMSpacing.SM })
        } else if (block.type === MarkdownBlockType.H3) {
          Text() {
            ForEach(this.parseInline(block.content), (span: InlineSpan, sIdx: number) => {
              Span(span.text)
                .fontSize(PMFontSize.MD)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_PRIMARY)
            }, (span: InlineSpan, sIdx: number) => `h3-s-${sIdx}`)
          }
          .margin({ top: PMSpacing.SM, bottom: PMSpacing.XS })
        } else if (block.type === MarkdownBlockType.H4) {
          Text() {
            ForEach(this.parseInline(block.content), (span: InlineSpan, sIdx: number) => {
              Span(span.text)
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_PRIMARY)
            }, (span: InlineSpan, sIdx: number) => `h4-s-${sIdx}`)
          }
          .margin({ top: PMSpacing.XS, bottom: PMSpacing.XS })
        } else if (block.type === MarkdownBlockType.QUOTE) {
          Row() {
            Text() {
              ForEach(this.parseInline(block.content), (span: InlineSpan, sIdx: number) => {
                Span(span.text)
                  .fontSize(PMFontSize.BODY)
                  .fontWeight(span.isBold ? FontWeight.Bold : FontWeight.Regular)
                  .fontStyle(span.isItalic ? FontStyle.Italic : FontStyle.Normal)
                  .decoration(span.isStrike ? { type: TextDecorationType.LineThrough } : { type: TextDecorationType.None })
                  .fontColor(span.isCode ? PMColors.BRAND : PMColors.INK_SECONDARY)
              }, (span: InlineSpan, sIdx: number) => `quote-s-${sIdx}`)
            }
            .lineHeight(24)
            .layoutWeight(1)
          }
          .width('100%')
          .padding({ left: PMSpacing.MD, right: PMSpacing.MD, top: PMSpacing.SM, bottom: PMSpacing.SM })
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .border({ width: { left: 4 }, color: PMColors.BRAND })
          .borderRadius({ topRight: PMRadius.XS, bottomRight: PMRadius.XS })
          .margin({ top: PMSpacing.SM, bottom: PMSpacing.SM })
        } else if (block.type === MarkdownBlockType.UNORDERED_LIST) {
          Row() {
            Text('•')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.BRAND)
              .margin({ right: PMSpacing.SM, top: 1 })

            Text() {
              ForEach(this.parseInline(block.content), (span: InlineSpan, sIdx: number) => {
                Span(span.text)
                  .fontSize(PMFontSize.BODY)
                  .fontWeight(span.isBold ? FontWeight.Bold : FontWeight.Regular)
                  .fontStyle(span.isItalic ? FontStyle.Italic : FontStyle.Normal)
                  .decoration(span.isStrike ? { type: TextDecorationType.LineThrough } : { type: TextDecorationType.None })
                  .fontColor(span.isCode ? PMColors.BRAND : PMColors.INK_PRIMARY)
                  .fontFamily(span.isCode ? 'monospace' : undefined)
              }, (span: InlineSpan, sIdx: number) => `ul-s-${sIdx}`)
            }
            .lineHeight(24)
            .layoutWeight(1)
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)
          .margin({ top: PMSpacing.XS, bottom: PMSpacing.XS })
        } else if (block.type === MarkdownBlockType.ORDERED_LIST) {
          Row() {
            Text(block.listPrefix)
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.BRAND)
              .margin({ right: PMSpacing.SM, top: 1 })

            Text() {
              ForEach(this.parseInline(block.content), (span: InlineSpan, sIdx: number) => {
                Span(span.text)
                  .fontSize(PMFontSize.BODY)
                  .fontWeight(span.isBold ? FontWeight.Bold : FontWeight.Regular)
                  .fontStyle(span.isItalic ? FontStyle.Italic : FontStyle.Normal)
                  .decoration(span.isStrike ? { type: TextDecorationType.LineThrough } : { type: TextDecorationType.None })
                  .fontColor(span.isCode ? PMColors.BRAND : PMColors.INK_PRIMARY)
                  .fontFamily(span.isCode ? 'monospace' : undefined)
              }, (span: InlineSpan, sIdx: number) => `ol-s-${sIdx}`)
            }
            .lineHeight(24)
            .layoutWeight(1)
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)
          .margin({ top: PMSpacing.XS, bottom: PMSpacing.XS })
        } else if (block.type === MarkdownBlockType.CODE_BLOCK) {
          Column() {
            if (block.codeLanguage !== '') {
              Row() {
                Text(block.codeLanguage)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
              }
              .width('100%')
              .margin({ bottom: 4 })
            }

            Text(block.content)
              .fontSize(PMFontSize.CAPTION)
              .fontFamily('monospace')
              .fontColor(PMColors.INK_PRIMARY)
              .lineHeight(20)
          }
          .width('100%')
          .padding(PMSpacing.MD)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .border({ width: 1, color: PMColors.BORDER })
          .borderRadius(PMRadius.SM)
          .alignItems(HorizontalAlign.Start)
          .margin({ top: PMSpacing.SM, bottom: PMSpacing.SM })
        } else if (block.type === MarkdownBlockType.HR) {
          Divider()
            .color(PMColors.BORDER)
            .margin({ top: PMSpacing.MD, bottom: PMSpacing.MD })
        } else if (block.type === MarkdownBlockType.EMPTY) {
          Row().height(PMSpacing.SM)
        } else {
          Text() {
            ForEach(this.parseInline(block.content), (span: InlineSpan, sIdx: number) => {
              Span(span.text)
                .fontSize(PMFontSize.BODY)
                .fontWeight(span.isBold ? FontWeight.Bold : FontWeight.Regular)
                .fontStyle(span.isItalic ? FontStyle.Italic : FontStyle.Normal)
                .decoration(span.isStrike ? { type: TextDecorationType.LineThrough } : { type: TextDecorationType.None })
                .fontColor(span.isCode ? PMColors.BRAND : PMColors.INK_PRIMARY)
                .fontFamily(span.isCode ? 'monospace' : undefined)
            }, (span: InlineSpan, sIdx: number) => `p-s-${sIdx}`)
          }
          .lineHeight(24)
          .margin({ bottom: PMSpacing.XS })
        }
      }, (block: MarkdownBlock, index: number) => `block-${index}`)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
