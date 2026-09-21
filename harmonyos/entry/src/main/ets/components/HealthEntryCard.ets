import { ApiError } from '../models/Project';
import { HealthFinding, HealthGroup, HealthSeverityCopy, HealthUnavailableSection, ProjectHealthReport } from '../models/Health';
import { HealthService } from '../services/HealthService';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMButtonSize } from '../common/DesignTokens';

/**
 * 项目体检入口卡（工作台，不新增一级 Tab）。
 *
 * - 没有问题：明确显示「当前没有需要立即处理的问题」；
 * - 有问题：显示最重要的问题与总数，主按钮「处理最重要的问题」；
 * - 次级入口「查看全部检查结果」在同一张卡内展开，不再开新页面。
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
  private findingRow(finding: HealthFinding) {
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
        Text(`去${HealthSeverityCopy.targetLabel(finding.suggestedTarget.kind)}：${finding.suggestedAction}`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.BRAND)
          .layoutWeight(1)
          .onClick(() => {
            this.onGoTarget(finding.suggestedTarget.kind, finding.suggestedTarget.id !== null ? finding.suggestedTarget.id : '', finding.suggestedAction);
          })
      }
      .width('100%')
      .margin({ top: 4 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(PMSpacing.SM)
    .backgroundColor(PMColors.SURFACE_SUBTLE)
    .borderRadius(PMRadius.SM)
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
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .margin({ top: PMSpacing.SM })
        }

        if (this.report !== null) {
          if (this.total() === 0) {
            Text('当前没有需要立即处理的问题')
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.SUCCESS)
              .margin({ top: PMSpacing.SM })
          } else {
            Row() {
              Text(`共 ${this.total()} 个待处理问题`)
                .fontSize(PMFontSize.SECONDARY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .layoutWeight(1)
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
            .margin({ top: PMSpacing.SM })

            if (this.report.primaryAction !== null) {
              this.findingRow(this.report.primaryAction)

              Row() {
                Button('处理最重要的问题')
                  .fontSize(PMFontSize.BUTTON)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.BRAND)
                  .borderRadius(PMRadius.SM)
                  .height(48)
                  .layoutWeight(1)
                  .onClick(() => {
                    const target = this.report!.primaryAction!.suggestedTarget;
                    this.onGoTarget(target.kind, target.id !== null ? target.id : '', this.report!.primaryAction!.suggestedAction);
                  })
                Button(this.showAll ? '收起检查结果' : '查看全部检查结果')
                  .fontSize(PMFontSize.BUTTON)
                  .fontColor(PMColors.INK_PRIMARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .border({ width: 1, color: PMColors.BORDER })
                  .borderRadius(PMRadius.SM)
                  .height(48)
                  .margin({ left: PMSpacing.SM })
                  .onClick(() => {
                    this.showAll = !this.showAll;
                  })
              }
              .width('100%')
              .margin({ top: PMSpacing.SM })
            }

            // 其余问题只在这个次级入口里展开，首页仍然只有一个主操作
            if (this.showAll) {
              ForEach(this.otherFindings(), (finding: HealthFinding) => {
                this.findingRow(finding)
              }, (finding: HealthFinding) => `${finding.findingCode}-${finding.objectId}`)
            }
          }

          if (this.report.unavailable.length > 0) {
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
