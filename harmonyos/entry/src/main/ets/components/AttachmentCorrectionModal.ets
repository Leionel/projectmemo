import { PMColors, PMSpacing, PMFontSize, PMRadius, PMInteraction, PMMotion, PMMaterial } from '../common/DesignTokens';
import { Attachment } from '../models/Attachment';
import { AttachmentService } from '../services/AttachmentService';
import { ApiError } from '../models/Project';

@Component
export struct AttachmentCorrectionModal {
  @Prop projectId: string = '';
  @Prop attachment: Attachment = new Attachment();
  @State correctedText: string = '';
  @State isSubmitting: boolean = false;
  @State errorMsg: string = '';
  @State successMsg: string = '';

  private attachmentService: AttachmentService = new AttachmentService();
  onClose: () => void = () => {};
  onSuccess: () => void = () => {};

  aboutToAppear(): void {
    if (this.attachment.extractedText && this.attachment.extractedText !== '') {
      this.correctedText = this.attachment.extractedText;
    } else {
      this.correctedText = '';
    }
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
          Text(this.attachment.type === 'IMAGE' ? '📷' : '📄')
            .fontSize(20)
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
