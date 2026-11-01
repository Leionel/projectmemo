import { ApiError } from '../models/Project';
import { HealthFinding, HealthGroup, HealthSeverityCopy, HealthUnavailableSection, ProjectHealthReport } from '../models/Health';
import { HealthService } from '../services/HealthService';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMButtonSize } from '../common/DesignTokens';

/**
 * 项目体检入口卡（工作台，不新增一级 Tab）。
 *
 * 遵循 oil-ui 与 frontend-design 减法原则：
 * - 紧凑头部：显示标题与「重新检查」操作；
 * - 核心指示：总待处理项大字指示与严重度分级；
 * - 主要问题内嵌操作：「去...：... →」直接承载动作，不再展示并列双大按钮；
 * - 次级展开：当存在多个问题时提供单一下拉折叠入口；
 * - 不可用说明折叠：默认单行折叠提示，点击展开受影响范围。
 *
 * 只读展示：卡内不提供任何写操作，避免把「看了一眼」当成已经处理。
 */
@Component
export struct HealthEntryCard {
  @Prop projectId: string = '';
  /** 卡片的可见开关；用 active 而不是 enabled，避免与 ArkUI 通用属性 enabled 冲突 */
  @Prop active: boolean = true;
  /** 主操作跳转：由工作台决定落到哪个既有入口 */
  onGoTarget: (kind: string, objectId: string, suggestedAction: string) => void = () => {};

  @State isLoading: boolean = true;
  @State report: ProjectHealthReport | null = null;
  @State errorMessage: string = '';
  @State showAll: boolean = false;
  @State showUnavailableDetails: boolean = false;
  /** 功能开关关闭时整卡隐藏：不让用户点下去才看到模糊错误 */
  @State hidden: boolean = false;

  private service: HealthService = new HealthService();

  aboutToAppear(): void {
    if (this.active) {
      this.load();
    }
  }

  private async load(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      this.report = await this.service.load(this.projectId);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PROJECT_HEALTH_DISABLED') {
        this.hidden = true;
        this.report = null;
        return;
      }
      this.errorMessage = e instanceof ApiError ? e.message : '项目体检暂时读不到，请检查网络';
    } finally {
      this.isLoading = false;
    }
  }

  private total(): number {
    return this.report !== null ? this.report.findings.length : 0;
  }

  private severityColor(severity: string): ResourceColor {
    if (severity === 'ACTION_REQUIRED') return PMColors.RISK;
    if (severity === 'ATTENTION') return PMColors.WARNING;
    return PMColors.INK_TERTIARY;
  }

  @Builder
  private findingRow(finding: HealthFinding, isPrimary: boolean = false) {
    Column() {
      Row() {
        Text(HealthSeverityCopy.label(finding.severity))
          .fontSize(10)
          .fontColor(PMColors.SURFACE)
          .padding({ left: 6, right: 6, top: 1, bottom: 1 })
          .backgroundColor(this.severityColor(finding.severity))
          .borderRadius(PMRadius.XS)
        Text(finding.title)
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .layoutWeight(1)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ left: PMSpacing.SM })
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)

      Text(finding.explanation)
        .fontSize(PMFontSize.CAPTION)
        .fontColor(PMColors.INK_SECONDARY)
        .lineHeight(18)
        .margin({ top: 4 })

      Row() {
        Text(`去${HealthSeverityCopy.targetLabel(finding.suggestedTarget.kind)}：${finding.suggestedAction} →`)
          .fontSize(PMFontSize.CAPTION)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.BRAND)
          .layoutWeight(1)
          .onClick(() => {
            this.onGoTarget(finding.suggestedTarget.kind, finding.suggestedTarget.id !== null ? finding.suggestedTarget.id : '', finding.suggestedAction);
          })
      }
      .width('100%')
      .margin({ top: 6 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(PMSpacing.SM)
    .backgroundColor(isPrimary ? PMColors.BRAND_LIGHT : PMColors.SURFACE_SUBTLE)
    .borderRadius(PMRadius.SM)
    .border(isPrimary ? { width: 1, color: PMColors.BORDER } : { width: 0, color: Color.Transparent })
    .margin({ top: PMSpacing.SM })
  }

  build() {
    if (this.active && !this.hidden) {
      Column() {
        Row() {
          Column() {
            Text('项目体检')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
            Text('检查项目当前问题')
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Bold)
              .fontColor(PMColors.INK_PRIMARY)
              .margin({ top: 2 })
          }
          .alignItems(HorizontalAlign.Start)
          .layoutWeight(1)

          Button('重新检查')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_SECONDARY)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .height(PMButtonSize.HEIGHT_SM)
            .borderRadius(PMRadius.SM)
            .enabled(!this.isLoading)
            .onClick(() => {
              this.load();
            })
        }
        .width('100%')

        if (this.isLoading) {
          Text('正在检查项目当前状态…')
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_SECONDARY)
            .margin({ top: PMSpacing.SM })
        }

        if (!this.isLoading && this.errorMessage !== '' && this.report === null) {
          Column() {
            Text(this.errorMessage)
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.RISK)
            Button('重试')
              .fontSize(PMFontSize.CAPTION)
              .height(PMButtonSize.HEIGHT_SM)
              .margin({ top: PMSpacing.SM })
              .onClick(() => {
                this.load();
              })
              .type(ButtonType.Normal)
              .borderRadius(PMRadius.BUTTON)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .constraintSize({ minHeight: 44 })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .margin({ top: PMSpacing.SM })
        }

        if (this.report !== null) {
          if (!this.isLoading && this.errorMessage !== '') {
            Text('本次体检未完成，下方为上次结果；状态可能已变化。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.WARNING)
              .margin({ top: PMSpacing.SM })
          }

          if (this.total() === 0) {
            Text(this.isLoading || this.errorMessage !== '' ? '上次体检未发现需立即处理的问题' : '当前没有需要立即处理的问题')
              .fontSize(PMFontSize.BODY)
              .fontColor(this.isLoading || this.errorMessage !== '' ? PMColors.INK_SECONDARY : PMColors.SUCCESS)
              .margin({ top: PMSpacing.SM })
          } else {
            Row() {
              Text(`${this.total()} 项待处理`)
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_PRIMARY)

              Blank()

              ForEach(this.report.groups, (group: HealthGroup) => {
                Text(`${HealthSeverityCopy.label(group.severity)} ${group.count}`)
                  .fontSize(10)
                  .fontColor(PMColors.INK_SECONDARY)
                  .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.XS)
                  .margin({ left: 4 })
              }, (group: HealthGroup) => group.severity)
            }
            .width('100%')
            .alignItems(VerticalAlign.Center)
            .margin({ top: PMSpacing.SM })

            if (this.report.primaryAction !== null) {
              this.findingRow(this.report.primaryAction, true)
            }

            if (this.otherFindings().length > 0) {
              Button(this.showAll ? '收起检查结果 ↑' : `查看全部检查结果 (${this.total()}) ↓`)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.BRAND)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .border({ width: 1, color: PMColors.BORDER })
                .borderRadius(PMRadius.SM)
                .height(36)
                .width('100%')
                .margin({ top: PMSpacing.SM })
                .onClick(() => {
                  this.showAll = !this.showAll;
                })

              if (this.showAll) {
                ForEach(this.otherFindings(), (finding: HealthFinding) => {
                  this.findingRow(finding, false)
                }, (finding: HealthFinding) => `${finding.findingCode}-${finding.objectId}`)
              }
            }
          }

          if (this.report.unavailable.length > 0) {
            Column() {
              Row() {
                Text(`${this.report.unavailable.length} 项检查暂不可用`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.WARNING)
                  .layoutWeight(1)

                Text(this.showUnavailableDetails ? '收起详情 ↑' : '查看详情 ↓')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.BRAND)
                  .onClick(() => {
                    this.showUnavailableDetails = !this.showUnavailableDetails;
                  })
              }
              .width('100%')

              if (this.showUnavailableDetails) {
                Column() {
                  ForEach(this.report.unavailable, (item: HealthUnavailableSection) => {
                    Text(item.message)
                      .fontSize(PMFontSize.CAPTION)
                      .fontColor(PMColors.WARNING)
                      .lineHeight(18)
                  }, (item: HealthUnavailableSection) => item.section)
                  Text('其余检查结果仍然有效，以上部分暂不可用。')
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .margin({ top: 2 })
                }
                .width('100%')
                .margin({ top: 6 })
                .alignItems(HorizontalAlign.Start)
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding(PMSpacing.SM)
            .backgroundColor(PMColors.WARNING_LIGHT)
            .borderRadius(PMRadius.SM)
            .margin({ top: PMSpacing.SM })
          }
        }
      }
      .width('100%')
      .padding(PMSpacing.LG)
      .backgroundColor(PMColors.SURFACE)
      .borderRadius(PMRadius.LG)
      .border({ width: 1, color: PMColors.BORDER })
      .alignItems(HorizontalAlign.Start)
      .margin({ top: PMSpacing.MD })
    }
  }

  private otherFindings(): HealthFinding[] {
    const report = this.report;
    if (report === null || report.primaryAction === null) {
      return report !== null ? report.findings : [];
    }
    const primary = report.primaryAction;
    return report.findings.filter((finding: HealthFinding) =>
      !(finding.findingCode === primary.findingCode && finding.objectId === primary.objectId));
  }
}
