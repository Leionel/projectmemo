import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { ApiError } from '../models/Project';
import { Intervention, ProposedAction } from '../models/Intervention';
import { InterventionService } from '../services/InterventionService';
import { NotificationService } from '../services/NotificationService';
import { PMColors, PMSpacing, PMFontSize, PMRadius } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { SeverityBadge, StatusBadge } from '../components/MetricBadge';
import { EvidenceSpineView } from '../components/EvidenceSpineView';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import { TextFormatters } from '../common/TextFormatters';

@Entry
@Component
struct InterventionDetail {
  @State projectId: string = '';
  @State interventionId: string = '';
  @State intervention: Intervention = new Intervention();
  @State notFound: boolean = false;
  @State isLoading: boolean = false;
  @State errorMessage: string = '';
  @State routeError: string = '';
  @State actionIndex: number = 0;
  @State showDismissInput: boolean = false;
  @State dismissReason: string = '';
  @State isSubmitting: boolean = false;
  @State operationError: string = '';

  private interventionService: InterventionService = new InterventionService();
  private notificationService: NotificationService = new NotificationService();

  aboutToAppear(): void {
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    if (params === undefined || params === null) {
      this.routeError = '页面参数缺失，无法定位提醒记录';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    this.interventionId = params['interventionId'] ?? '';
    if (this.projectId === '' || this.interventionId === '') {
      this.routeError = '页面参数缺失，提醒记录ID无效';
      return;
    }
    this.loadIntervention();
  }

  private async loadIntervention(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.notFound = false;
    try {
      this.intervention = await this.interventionService.get(this.projectId, this.interventionId);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 404) {
          this.notFound = true;
        } else {
          this.errorMessage = e.message;
        }
      } else {
        this.errorMessage = '无法连接服务，请检查网络';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private isOpenStatus(): boolean {
    return this.intervention.status === 'OPEN';
  }

  private async acceptIntervention(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }
    this.isSubmitting = true;
    this.operationError = '';
    try {
      await this.interventionService.accept(this.projectId, this.interventionId, this.actionIndex);
      await this.notificationService.cancelInterventionNotification(this.interventionId, this.projectId);
      promptAction.showToast({ message: '已采纳建议并创建行动' });
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        this.operationError = e.message;
      } else {
        this.operationError = '创建行动失败，请稍后重试';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  private async snoozeIntervention(hours: number): Promise<void> {
    if (this.isSubmitting) {
      return;
    }
    this.isSubmitting = true;
    this.operationError = '';
    try {
      const until: string = new Date(Date.now() + hours * 3600000).toISOString();
      await this.interventionService.snooze(this.projectId, this.interventionId, until);
      await this.notificationService.scheduleInterventionNotification(
        this.intervention,
        this.projectId,
        new Date(until).getTime()
      );
      promptAction.showToast({ message: '已设置为明天提醒' });
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        this.operationError = e.message;
      } else {
        this.operationError = '稍后提醒设置失败';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  private async dismissIntervention(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }
    this.isSubmitting = true;
    this.operationError = '';
    try {
      await this.interventionService.dismiss(this.projectId, this.interventionId, this.dismissReason);
      await this.notificationService.cancelInterventionNotification(this.interventionId, this.projectId);
      promptAction.showToast({ message: '已忽略该提醒' });
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        this.operationError = e.message;
      } else {
        this.operationError = '忽略操作失败';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  build() {
    Column() {
      PMAppBar({
        title: '为什么提醒我',
        subtitle: '',
        backLabel: '项目',
        showBack: true
      })

      if (this.routeError !== '') {
        ErrorStateView({
          message: this.routeError,
          onRetry: () => {
            router.back();
          }
        })
      } else if (this.isLoading) {
        LoadingStateView({ message: '正在加载提醒依据...' })
      } else if (this.notFound) {
        EmptyStateView({
          title: '未找到提醒记录',
          description: '该提醒可能已被处理或已关闭',
          actionText: '返回上一页',
          onAction: () => {
            router.back();
          }
        })
      } else if (this.errorMessage !== '') {
        ErrorStateView({
          message: this.errorMessage,
          onRetry: () => {
            this.loadIntervention();
          }
        })
      } else {
        Scroll() {
          Column() {
            // 1. 当前判断 (Primary Judgement)
            Column() {
              Row() {
                SeverityBadge({ severity: this.intervention.severity })
                StatusBadge({ status: this.intervention.status })
              }
              .width('100%')
              .justifyContent(FlexAlign.SpaceBetween)

              Text(this.intervention.title)
                .fontSize(PMFontSize.PRIMARY_JUDGEMENT)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .lineHeight(26)
                .margin({ top: PMSpacing.MD })

              Text(this.intervention.content)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_SECONDARY)
                .lineHeight(22)
                .margin({ top: PMSpacing.SM })
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.MD)
            .border({ width: 1, color: PMColors.BORDER })

            // 2. 提醒依据 (Evidence Spine · 时间—来源—事实—判断)
            Column() {
              EvidenceSpineView({
                evidence: this.intervention.evidence,
                triggerType: this.intervention.triggerType,
                judgementTitle: this.intervention.title,
                judgementContent: this.intervention.content
              })
            }
            .width('100%')
            .margin({ top: PMSpacing.MD })

            // 3. 建议行动 (Suggested Action)
            Column() {
              Text('建议行动')
                .fontSize(PMFontSize.SECTION_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
                .margin({ bottom: PMSpacing.SM })

              if (this.intervention.proposedActions.length === 0) {
                Text('暂无预设行动建议')
                  .fontSize(PMFontSize.BODY)
                  .fontColor(PMColors.INK_TERTIARY)
                  .padding(PMSpacing.LG)
              } else {
                ForEach(this.intervention.proposedActions, (action: ProposedAction, index: number) => {
                  Column() {
                    Row() {
                      Row() {
                        Circle({ width: 14, height: 14 })
                          .fill(this.actionIndex === index ? PMColors.BRAND : PMColors.SURFACE)
                          .border({ width: 2, color: this.actionIndex === index ? PMColors.BRAND : PMColors.BORDER_STRONG })

                        Text(action.label !== '' ? action.label : `建议方案 ${index + 1}`)
                          .fontSize(PMFontSize.BODY)
                          .fontWeight(FontWeight.Medium)
                          .fontColor(this.actionIndex === index ? PMColors.BRAND : PMColors.INK_SECONDARY)
                          .margin({ left: PMSpacing.SM })
                      }

                      Text(TextFormatters.priorityToChinese(action.priority))
                        .fontSize(PMFontSize.CAPTION)
                        .fontColor(PMColors.INK_TERTIARY)
                    }
                    .width('100%')
                    .justifyContent(FlexAlign.SpaceBetween)

                    Text(action.title)
                      .fontSize(PMFontSize.SECTION_TITLE)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(PMColors.INK_PRIMARY)
                      .margin({ top: PMSpacing.SM })

                    if (action.description !== null && action.description !== undefined && action.description !== '') {
                      Text(action.description)
                        .fontSize(PMFontSize.BODY)
                        .fontColor(PMColors.INK_SECONDARY)
                        .lineHeight(20)
                        .margin({ top: PMSpacing.XS })
                    }
                  }
                  .width('100%')
                  .padding(PMSpacing.LG)
                  .backgroundColor(this.actionIndex === index ? PMColors.BRAND_LIGHT : PMColors.SURFACE)
                  .borderRadius(PMRadius.MD)
                  .border({
                    width: this.actionIndex === index ? 2 : 1,
                    color: this.actionIndex === index ? PMColors.BRAND : PMColors.BORDER
                  })
                  .margin({ bottom: PMSpacing.SM })
                  .alignItems(HorizontalAlign.Start)
                  .onClick(() => {
                    if (this.intervention.proposedActions.length > 1 && this.isOpenStatus()) {
                      this.actionIndex = index;
                    }
                  })
                }, (action: ProposedAction, index: number) => `action-${index}-${action.title}`)
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .margin({ top: PMSpacing.MD })

            // 4. 你的决定 (Human Decision)
            Column() {
              Row() {
                Text('你的决定')
                  .fontSize(PMFontSize.SECTION_TITLE)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.INK_PRIMARY)

                Text('主动介入，但不越权')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
              }
              .width('100%')
              .justifyContent(FlexAlign.SpaceBetween)

              if (!this.isOpenStatus()) {
                Row() {
                  Text('✓ 该提醒已处理闭环，状态已锁定')
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.SUCCESS)
                }
                .padding(PMSpacing.MD)
                .backgroundColor(PMColors.SUCCESS_LIGHT)
                .borderRadius(PMRadius.SM)
                .margin({ top: PMSpacing.MD })
              } else {
                // 忽略原因输入框（点击忽略或需要记录时展开）
                if (this.showDismissInput) {
                  Column() {
                    Text('忽略原因（可选）：')
                      .fontSize(PMFontSize.SECONDARY)
                      .fontColor(PMColors.INK_SECONDARY)
                      .margin({ bottom: PMSpacing.XS })

                    TextArea({
                      text: this.dismissReason,
                      placeholder: '可在此记录忽略原因（可选）...'
                    })
                      .onChange((value: string) => {
                        this.dismissReason = value;
                      })
                      .fontSize(PMFontSize.BODY)
                      .height(60)
                      .backgroundColor(PMColors.SURFACE_SUBTLE)
                      .borderRadius(PMRadius.SM)
                      .border({ width: 1, color: PMColors.BORDER })

                    Row() {
                      Button('取消')
                        .fontSize(PMFontSize.BODY)
                        .fontColor(PMColors.INK_SECONDARY)
                        .backgroundColor(PMColors.SURFACE)
                        .border({ width: 1, color: PMColors.BORDER })
                        .borderRadius(PMRadius.SM)
                        .onClick(() => {
                          this.showDismissInput = false;
                        })

                      Button('确认忽略')
                        .fontSize(PMFontSize.BODY)
                        .fontColor(PMColors.SURFACE)
                        .backgroundColor(PMColors.RISK)
                        .borderRadius(PMRadius.SM)
                        .margin({ left: PMSpacing.MD })
                        .onClick(() => {
                          this.dismissIntervention();
                        })
                    }
                    .width('100%')
                    .justifyContent(FlexAlign.End)
                    .margin({ top: PMSpacing.SM })
                  }
                  .width('100%')
                  .padding(PMSpacing.MD)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .margin({ top: PMSpacing.MD })
                }

                // 核心决策三大按钮：创建行动 / 明天提醒 / 忽略
                Row() {
                  Button(this.isSubmitting ? '处理中...' : '创建行动')
                    .fontSize(PMFontSize.BUTTON)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.SURFACE)
                    .backgroundColor(PMColors.BRAND)
                    .borderRadius(PMRadius.SM)
                    .layoutWeight(2)
                    .enabled(this.isOpenStatus() && !this.isSubmitting && this.intervention.proposedActions.length > 0)
                    .onClick(() => {
                      this.acceptIntervention();
                    })

                  Button('明天提醒')
                    .fontSize(PMFontSize.BUTTON)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.INK_PRIMARY)
                    .backgroundColor(PMColors.SURFACE_SUBTLE)
                    .border({ width: 1, color: PMColors.BORDER })
                    .borderRadius(PMRadius.SM)
                    .layoutWeight(1.2)
                    .margin({ left: PMSpacing.SM })
                    .enabled(this.isOpenStatus() && !this.isSubmitting)
                    .onClick(() => {
                      this.snoozeIntervention(24);
                    })

                  Button('忽略')
                    .fontSize(PMFontSize.BUTTON)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(PMColors.RISK)
                    .backgroundColor(PMColors.RISK_LIGHT)
                    .borderRadius(PMRadius.SM)
                    .layoutWeight(1)
                    .margin({ left: PMSpacing.SM })
                    .enabled(this.isOpenStatus() && !this.isSubmitting)
                    .onClick(() => {
                      if (!this.showDismissInput) {
                        this.showDismissInput = true;
                      } else {
                        this.dismissIntervention();
                      }
                    })
                }
                .width('100%')
                .margin({ top: PMSpacing.MD })

                Text('只有你确认后，忆程才会创建行动。')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
                  .margin({ top: PMSpacing.SM })

                if (this.operationError !== '') {
                  Text(this.operationError)
                    .fontSize(PMFontSize.BODY)
                    .fontColor(PMColors.RISK)
                    .margin({ top: PMSpacing.XS })
                }
              }
            }
            .width('100%')
            .padding(PMSpacing.LG)
            .backgroundColor(PMColors.SURFACE)
            .borderRadius(PMRadius.MD)
            .border({ width: 1, color: PMColors.BORDER })
            .alignItems(HorizontalAlign.Start)
            .margin({ top: PMSpacing.MD })
          }
          .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.XXL })
        }
        .width('100%')
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}
