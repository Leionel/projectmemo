import { PMColors, PMSpacing, PMFontSize, PMRadius, PMMotion, PMMaterial } from '../common/DesignTokens';
import { ArtifactAuditResponse, ArtifactAuditRecheckItem, ArtifactGenerationRef } from '../models/Artifact';
import { ApiError } from '../models/Project';
import { ArtifactService } from '../services/ArtifactService';

@Component
export struct ClaimAuditorDrawer {
  @Prop projectId: string = '';
  @Prop artifactId: string = '';
  @Prop artifactTitle: string = '';
  @State private isLoading: boolean = true;
  @State private errorMessage: string = '';
  @State private audit: ArtifactAuditResponse = new ArtifactAuditResponse();
  private artifactService: ArtifactService = new ArtifactService();
  onClose: () => void = () => {};

  aboutToAppear(): void {
    this.loadAudit();
  }

  private formatDay(value: string): string {
    return value !== '' && value.length >= 10 ? value.substring(0, 10) : '未知';
  }

  private async loadAudit(): Promise<void> {
    if (this.artifactId === '') {
      this.errorMessage = '当前成果尚未保存，无法审计';
      this.isLoading = false;
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    try {
      // 每次打开都重新核验：离线/接口失败时显示错误，绝不把缓存结果冒充最新核验
      const result = await this.artifactService.audit(this.projectId, this.artifactId);
      this.audit = result;
    } catch (e) {
      this.errorMessage = e instanceof ApiError ? e.message : '证据核验失败，请检查网络后重试';
    } finally {
      this.isLoading = false;
    }
  }

  private stateColor(supportState: string): ResourceColor {
    if (supportState === 'SUPPORTED') return PMColors.SUCCESS;
    if (supportState === 'SUPERSEDED' || supportState === 'REVOKED') return PMColors.RISK;
    if (supportState === 'CONFLICT' || supportState === 'PENDING') return PMColors.EVIDENCE;
    return PMColors.INK_SECONDARY;
  }

  private stateGlyph(supportState: string): string {
    if (supportState === 'SUPPORTED') return '✓';
    if (supportState === 'SUPERSEDED' || supportState === 'REVOKED') return '→';
    if (supportState === 'CONFLICT' || supportState === 'PENDING') return '？';
    return '·';
  }

  @Builder
  private recheckItem(item: ArtifactAuditRecheckItem) {
    Column() {
      Row() {
        // 状态使用后端结构化字段（statusLabel），文字+图标表达，不依赖颜色或标题关键词
        Text(`${this.stateGlyph(item.supportState)} ${item.statusLabel}`)
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.stateColor(item.supportState))
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.XS)
      }
      .width('100%')

      Text(item.titleSnapshot !== '' ? item.titleSnapshot : '（当时记录无标题）')
        .fontSize(PMFontSize.BODY)
        .fontWeight(FontWeight.Bold)
        .fontColor(PMColors.INK_PRIMARY)
        .margin({ top: PMSpacing.XS })

      if (item.summarySnapshot !== '') {
        Text(item.summarySnapshot)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(18)
          .margin({ top: 4 })
      }

      // 决策演化链：原决策 → 替代决策 → 确认时间 → 原因
      if (item.supersededByTitle !== null) {
        Column() {
          Text(`已被「${item.supersededByTitle}」取代`)
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.RISK)
          Text(`确认时间：${this.formatDay(item.supersededConfirmedAt ?? '')}`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: 2 })
          if (item.supersededReason !== null && item.supersededReason !== '') {
            Text(`原因：${item.supersededReason}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(18)
              .margin({ top: 2 })
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding(PMSpacing.SM)
        .backgroundColor(PMColors.RISK_LIGHT)
        .borderRadius(PMRadius.SM)
        .margin({ top: PMSpacing.SM })
      }
    }
    .width('100%')
    .padding(PMSpacing.MD)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.SM)
    .border({ width: 1, color: PMColors.BORDER })
    .margin({ bottom: PMSpacing.SM })
    .alignItems(HorizontalAlign.Start)
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
          this.onClose();
        })

      // 底部/居中上浮抽屉卡片
      Column() {
        // 顶栏
        Row() {
          Row() {
            Circle({ width: 8, height: 8 })
              .fill(PMColors.BRAND)
              .margin({ right: PMSpacing.SM })
            Text('证据透视镜 (Claim Auditor)')
              .fontSize(PMFontSize.TITLE)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_PRIMARY)
          }
          .alignItems(VerticalAlign.Center)

          Button('✕')
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_TERTIARY)
            .backgroundColor('transparent')
            .onClick(() => {
              this.onClose();
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .alignItems(VerticalAlign.Center)

        // 副标题：核验对象与两个时间口径说明
        Column() {
          Text(`核验成果：【${this.artifactTitle}】`)
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.BRAND)

          Text('口径一：生成时回执　·　口径二：当前重新检查')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: PMSpacing.XS })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .margin({ top: PMSpacing.XS, bottom: PMSpacing.MD })

        if (this.isLoading) {
          Column() {
            LoadingProgress()
              .width(28)
              .height(28)
              .color(PMColors.BRAND)
            Text('正在向时态账本重新核验…')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: PMSpacing.SM })
          }
          .width('100%')
          .padding(PMSpacing.XL)
          .alignItems(HorizontalAlign.Center)
        } else if (this.errorMessage !== '') {
          // 失败状态：如实报错并允许重试，不展示缓存数据
          Column() {
            Text('⚠ 核验失败')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.RISK)
            Text(this.errorMessage)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(18)
              .margin({ top: PMSpacing.SM })
            Button('重新核验')
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.SURFACE)
              .backgroundColor(PMColors.BRAND)
              .borderRadius(PMRadius.SM)
              .margin({ top: PMSpacing.MD })
              .onClick(() => {
                this.loadAudit();
              })
          }
          .width('100%')
          .padding(PMSpacing.XL)
          .alignItems(HorizontalAlign.Center)
        } else if (this.audit.untraceable) {
          Column() {
            Text('· 无法逐句回溯')
              .fontSize(PMFontSize.BODY)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_SECONDARY)
            Text(this.audit.message)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(18)
              .margin({ top: PMSpacing.SM })
          }
          .width('100%')
          .padding(PMSpacing.LG)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .borderRadius(PMRadius.SM)
          .alignItems(HorizontalAlign.Start)
        } else {
          Scroll() {
            Column() {
              // 确定性模板结论
              Text(this.audit.message)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_SECONDARY)
                .lineHeight(18)
                .padding(PMSpacing.SM)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .width('100%')

              Text(`口径二 · 当前重新检查（${this.formatDay(this.audit.recheckedAt)}）`)
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.BRAND)
                .margin({ top: PMSpacing.MD, bottom: PMSpacing.SM })

              ForEach(this.audit.recheck, (item: ArtifactAuditRecheckItem) => {
                this.recheckItem(item)
              }, (item: ArtifactAuditRecheckItem) => item.cardId)

              Text(`口径一 · 生成时回执（${this.formatDay(this.audit.generatedAt)}，共 ${this.audit.generationRefs.length} 项，此后不随知识库变化）`)
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_SECONDARY)
                .margin({ top: PMSpacing.SM, bottom: PMSpacing.SM })

              ForEach(this.audit.generationRefs, (ref: ArtifactGenerationRef) => {
                Row() {
                  Text('·')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .margin({ right: PMSpacing.SM })
                  Column() {
                    Text(ref.titleSnapshot !== '' ? ref.titleSnapshot : '（当时记录无标题）')
                      .fontSize(PMFontSize.CAPTION)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_SECONDARY)
                    Text(`观察于 ${this.formatDay(ref.observedAt)}`)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.INK_TERTIARY)
                      .margin({ top: 2 })
                  }
                  .alignItems(HorizontalAlign.Start)
                  .layoutWeight(1)
                }
                .width('100%')
                .alignItems(VerticalAlign.Top)
                .padding({ top: 2, bottom: 2 })
              }, (ref: ArtifactGenerationRef) => ref.cardId)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          }
          .scrollable(ScrollDirection.Vertical)
          .constraintSize({ maxHeight: '65%' })
        }
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
