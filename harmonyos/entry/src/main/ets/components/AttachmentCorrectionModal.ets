import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction, PMMotion, PMMaterial } from '../common/DesignTokens';
import { Attachment } from '../models/Attachment';
import { AttachmentRevisionItem } from '../models/Artifact';
import { AttachmentService } from '../services/AttachmentService';
import { ApiError } from '../models/Project';
import { PaperclipIcon } from './PMIcons';

@Component
export struct AttachmentCorrectionModal {
  @Prop projectId: string = '';
  @Prop attachment: Attachment = new Attachment();
  @State correctedText: string = '';
  @State isSubmitting: boolean = false;
  @State errorMsg: string = '';
  @State successMsg: string = '';

  @State revisions: AttachmentRevisionItem[] = [];
  @State showRevisions: boolean = false;

  private attachmentService: AttachmentService = new AttachmentService();
  onClose: () => void = () => {};
  onSuccess: () => void = () => {};

  aboutToAppear(): void {
    if (this.attachment.extractedText && this.attachment.extractedText !== '') {
      this.correctedText = this.attachment.extractedText;
    } else {
      this.correctedText = '';
    }
    this.loadRevisions();
  }

  // 修订链：历次机器提取与人工校对文本原样可查，旧值不被覆盖
  private async loadRevisions(): Promise<void> {
    try {
      const response = await this.attachmentService.revisions(this.projectId, this.attachment.id);
      this.revisions = response.revisions;
    } catch (_e) {
      // 修订历史拉取失败不打断校对主流程
      this.revisions = [];
    }
  }

  private revisionSourceLabel(source: string): string {
    if (source === 'EXTRACTION') return '机器提取';
    if (source === 'EXTRACTION_RETRY') return '重新提取';
    return '人工校对';
  }

  private async submitCorrection(): Promise<void> {
    const text = this.correctedText.trim();
    if (text.length < 2) {
      this.errorMsg = '校对文本不能为空';
      return;
    }
    this.isSubmitting = true;
    this.errorMsg = '';
    this.successMsg = '';
    try {
      await this.attachmentService.correct(this.projectId, this.attachment.id, text);
      this.successMsg = '校对成功！已保存校对内容并生成项目记忆。';
      setTimeout(() => {
        this.onSuccess();
        this.onClose();
      }, 1000);
    } catch (e) {
      this.errorMsg = e instanceof ApiError ? e.message : (e instanceof Error ? e.message : '校对提交失败');
    } finally {
      this.isSubmitting = false;
    }
  }

  build() {
    Stack() {
      // 遮罩
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .backgroundBlurStyle(PMMaterial.SCRIM, PMMaterial.OPTIONS)
        .onClick(() => {
          if (!this.isSubmitting) {
            this.onClose();
          }
        })

      // 弹窗本体
      Column() {
        // 头部
        Row() {
          Text('附件证据校对')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.INK_PRIMARY)

          Text('✕')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .padding(PMSpacing.XS)
            .onClick(() => {
              if (!this.isSubmitting) {
                this.onClose();
              }
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .margin({ bottom: PMSpacing.MD })

        // 提示信息
        Text('当自动 OCR 或多模态提取存在偏差时，请人工录入真实数据。校对后的内容将作为项目事实存证。')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(18)
          .margin({ bottom: PMSpacing.MD })

        // 附件名与状态
        Row() {
          PaperclipIcon({ iconSize: 20, color: PMColors.BRAND })
            .margin({ right: PMSpacing.SM })

          Column() {
            Text(this.attachment.fileName)
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })

            Text(`当前识别状态：${this.attachment.extractionStatus === 'SUCCESS' ? '已提取文本' : '未提取/需修正'}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(this.attachment.extractionStatus === 'SUCCESS' ? PMColors.SUCCESS : PMColors.RISK)
              .margin({ top: 2 })
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .padding(PMSpacing.SM)
        .backgroundColor(PMColors.SURFACE_SUBTLE)
        .borderRadius(PMRadius.SM)
        .margin({ bottom: PMSpacing.SM })

        // 辅助操作
        Row() {
          Text('校对提示：')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)

          if (this.attachment.extractedText && this.attachment.extractedText !== '') {
            Button('还原识别文本')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .borderRadius(PMRadius.XS)
              .padding({ left: PMSpacing.SM, right: PMSpacing.SM, top: 4, bottom: 4 })
              .onClick(() => {
                this.correctedText = this.attachment.extractedText;
              })
          }
        }
        .width('100%')
        .margin({ bottom: PMSpacing.SM })

        // 编辑区
        TextArea({ text: this.correctedText, placeholder: '在此修正图片或PDF中提取的文字与实验数据…' })
          .fontSize(PMFontSize.BODY)
          .height(110)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.SM)
          .border({ width: 1, color: PMColors.BORDER })
          .onChange((v: string) => {
            this.correctedText = v;
          })

        // 提示
        if (this.errorMsg !== '') {
          Text(this.errorMsg)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.RISK)
            .margin({ top: PMSpacing.SM })
        }
        if (this.successMsg !== '') {
          Text(this.successMsg)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.SUCCESS)
            .margin({ top: PMSpacing.SM })
        }

        // 修订历史
        if (this.revisions.length > 0) {
          Column() {
            Row() {
              Text(`修订历史 (${this.revisions.length})`)
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_SECONDARY)
              Text(this.showRevisions ? '收起' : '展开查看前后文本')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.BRAND)
            }
            .width('100%')
            .justifyContent(FlexAlign.SpaceBetween)
            .margin({ top: PMSpacing.SM })
            .onClick(() => {
              this.showRevisions = !this.showRevisions;
            })

            if (this.showRevisions) {
              ForEach(this.revisions, (item: AttachmentRevisionItem) => {
                Column() {
                  Row() {
                    Text(`#${item.revisionIndex} · ${this.revisionSourceLabel(item.source)}`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_SECONDARY)
                    Text(item.createdAt.length >= 10 ? item.createdAt.substring(0, 10) : item.createdAt)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)
                  }
                  .width('100%')
                  .justifyContent(FlexAlign.SpaceBetween)

                  Text(item.text)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .lineHeight(16)
                    .maxLines(3)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .margin({ top: 2 })
                }
                .width('100%')
                .padding(PMSpacing.SM)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.XS)
                .margin({ top: PMSpacing.XS })
                .alignItems(HorizontalAlign.Start)
              }, (item: AttachmentRevisionItem) => `${item.revisionIndex}`)
            }
          }
          .width('100%')
          .padding(PMSpacing.SM)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.SM)
          .margin({ top: PMSpacing.SM })
          .alignItems(HorizontalAlign.Start)
        }

        // 确认按钮
        Button(this.isSubmitting ? '正在提交校对并入库…' : '保存校对并沉淀为记忆 →')
          .fontSize(PMFontSize.BUTTON)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.SURFACE)
          .backgroundColor(PMColors.BRAND)
          .borderRadius(PMRadius.SM)
          .height(48)
          .width('100%')
          .margin({ top: PMSpacing.LG })
          .enabled(!this.isSubmitting)
          .onClick(() => {
            this.submitCorrection();
          })
      }
      .width('92%')
      .padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG)
      .border({ width: 1, color: PMColors.BORDER })
      .shadow({ radius: 20, color: 'rgba(0, 0, 0, 0.15)', offsetX: 0, offsetY: 8 })
      .transition(TransitionEffect.OPACITY.combine(TransitionEffect.scale({ x: 0.95, y: 0.95 })).animation({ duration: PMMotion.LOCAL, curve: PMMotion.CURVE_CONTENT }))
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }
}
