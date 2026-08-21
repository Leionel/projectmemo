import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { ApiError } from '../models/Project';
import { Intervention, ProposedAction } from '../models/Intervention';
import { InterventionService } from '../services/InterventionService';

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
  @State showSnoozeOptions: boolean = false;
  @State dismissReason: string = '';
  @State isSubmitting: boolean = false;
  @State operationError: string = '';

  private interventionService: InterventionService = new InterventionService();

  aboutToAppear(): void {
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    if (params === undefined || params === null) {
      this.routeError = '页面参数缺失';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    this.interventionId = params['interventionId'] ?? '';
    if (this.projectId === '' || this.interventionId === '') {
      this.routeError = '页面参数缺失';
      return;
    }
    this.loadIntervention();
  }

  private async loadIntervention(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.notFound = false;
    try {
      const list: Intervention[] = await this.interventionService.list(this.projectId);
      let found: Intervention | undefined = undefined;
      for (const item of list) {
        if (item.id === this.interventionId) {
          found = item;
          break;
        }
      }
      if (found === undefined) {
        this.notFound = true;
        return;
      }
      this.intervention = found;
      this.actionIndex = 0;
    } catch (e) {
      if (e instanceof ApiError) {
        this.errorMessage = e.message;
      } else {
        this.errorMessage = '未知错误';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private isOpenStatus(): boolean {
    return this.intervention.status === 'OPEN';
  }

  private triggerTypeLabel(triggerType: string): string {
    if (triggerType === 'DEADLINE_NEAR') {
      return '截止日期逼近';
    }
    if (triggerType === 'RISK_UNHANDLED') {
      return '风险尚未处理';
    }
    if (triggerType === 'PROJECT_STALE') {
      return '项目出现停滞';
    }
    if (triggerType === 'EXPERIMENT_GAP') {
      return '论文与实验存在缺口';
    }
    if (triggerType === 'MATERIAL_GAP') {
      return '参赛材料存在缺口';
    }
    return triggerType;
  }

  private statusLabel(status: string): string {
    if (status === 'OPEN') {
      return '待处理';
    }
    if (status === 'ACCEPTED') {
      return '已接受';
    }
    if (status === 'SNOOZED') {
      return '稍后提醒';
    }
    if (status === 'DISMISSED') {
      return '已忽略';
    }
    if (status === 'RESOLVED') {
      return '已解决';
    }
    return status;
  }

  private async acceptIntervention(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }
    this.isSubmitting = true;
    this.operationError = '';
    try {
      await this.interventionService.accept(this.projectId, this.interventionId, this.actionIndex);
      promptAction.showToast({ message: '已创建行动' });
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        this.operationError = e.message;
      } else {
        this.operationError = '未知错误';
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
      promptAction.showToast({ message: '已设置稍后提醒' });
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        this.operationError = e.message;
      } else {
        this.operationError = '未知错误';
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
      promptAction.showToast({ message: '已忽略' });
      router.back();
    } catch (e) {
      if (e instanceof ApiError) {
        this.operationError = e.message;
      } else {
        this.operationError = '未知错误';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  build() {
    Column() {
      Row() {
        Text('返回')
          .fontSize(16)
          .fontColor('#007DFF')
          .onClick(() => {
            router.back();
          })
        Text('干预详情')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .margin({ left: 16 })
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 12, bottom: 12 })

      if (this.routeError !== '') {
        Column() {
          Text(this.routeError)
            .fontSize(16)
            .fontColor('#E84026')
            .margin({ bottom: 16 })
          Button('返回')
            .fontSize(14)
            .onClick(() => {
              router.back();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.isLoading) {
        Column() {
          LoadingProgress()
            .width(48)
            .height(48)
            .color('#007DFF')
          Text('加载中...')
            .fontSize(14)
            .fontColor('#999999')
            .margin({ top: 12 })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.notFound) {
        Column() {
          Text('未找到该干预')
            .fontSize(16)
            .fontColor('#E84026')
            .margin({ bottom: 16 })
          Button('返回')
            .fontSize(14)
            .onClick(() => {
              router.back();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else if (this.errorMessage !== '') {
        Column() {
          Text(this.errorMessage)
            .fontSize(16)
            .fontColor('#E84026')
            .textAlign(TextAlign.Center)
            .margin({ bottom: 16 })
          Button('重试')
            .fontSize(14)
            .onClick(() => {
              this.loadIntervention();
            })
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
        .padding({ left: 32, right: 32 })
      } else {
        Scroll() {
          Column() {
            Text(`当前状态：${this.statusLabel(this.intervention.status)}`)
              .fontSize(14)
              .fontColor(this.isOpenStatus() ? '#007DFF' : '#999999')
              .width('100%')

            Column() {
              Text('What · 发生了什么')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
              Text(this.intervention.title)
                .fontSize(18)
                .fontWeight(FontWeight.Medium)
                .margin({ top: 8 })
              Text(this.intervention.content)
                .fontSize(14)
                .fontColor('#666666')
                .margin({ top: 4 })
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 12 })

            Column() {
              Text('Why · 为什么提醒你')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
              Text(`触发类型：${this.triggerTypeLabel(this.intervention.triggerType)}`)
                .fontSize(14)
                .fontColor('#666666')
                .margin({ top: 8 })
              Text(`状态：${this.statusLabel(this.intervention.status)}`)
                .fontSize(14)
                .fontColor('#666666')
                .margin({ top: 4 })
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 12 })

            Column() {
              Text('Evidence · 依据')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
              Text(this.intervention.evidence.rule)
                .fontSize(14)
                .fontColor('#666666')
                .margin({ top: 8 })
              ForEach(this.intervention.evidence.facts, (fact: string) => {
                Text(`• ${fact}`)
                  .fontSize(14)
                  .fontColor('#666666')
                  .margin({ top: 4 })
              }, (fact: string, index: number) => `${index}`)
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 12 })

            Column() {
              Text('Suggested Action · 建议行动')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
              if (this.intervention.proposedActions.length === 0) {
                Text('暂无建议行动')
                  .fontSize(14)
                  .fontColor('#999999')
                  .margin({ top: 8 })
              } else {
                ForEach(this.intervention.proposedActions, (action: ProposedAction, index: number) => {
                  Column() {
                    Row() {
                      Text(action.label)
                        .fontSize(12)
                        .fontColor('#007DFF')
                      if (this.actionIndex === index) {
                        Text('已选中')
                          .fontSize(12)
                          .fontColor('#007DFF')
                          .margin({ left: 8 })
                      }
                    }
                    .width('100%')
                    Text(action.title)
                      .fontSize(15)
                      .fontWeight(FontWeight.Medium)
                      .margin({ top: 4 })
                    if (action.description !== null && action.description !== undefined && action.description !== '') {
                      Text(action.description)
                        .fontSize(13)
                        .fontColor('#666666')
                        .margin({ top: 4 })
                    }
                  }
                  .width('100%')
                  .padding(12)
                  .borderRadius(8)
                  .border({
                    width: this.actionIndex === index ? 2 : 1,
                    color: this.actionIndex === index ? '#007DFF' : '#EEEEEE'
                  })
                  .margin({ top: 8 })
                  .alignItems(HorizontalAlign.Start)
                  .onClick(() => {
                    if (this.intervention.proposedActions.length > 1 && this.isOpenStatus()) {
                      this.actionIndex = index;
                    }
                  })
                }, (action: ProposedAction, index: number) => `${index}-${action.title}`)
              }
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 12 })

            Column() {
              Text('Human Decision · 你的决定')
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
              if (!this.isOpenStatus()) {
                Text('该干预已处理，操作已禁用')
                  .fontSize(13)
                  .fontColor('#999999')
                  .margin({ top: 8 })
              }
              if (this.isOpenStatus() && this.showSnoozeOptions) {
                Row() {
                  Button('1 小时后')
                    .fontSize(12)
                    .enabled(!this.isSubmitting)
                    .onClick(() => {
                      this.snoozeIntervention(1);
                    })
                  Button('明天')
                    .fontSize(12)
                    .margin({ left: 8 })
                    .enabled(!this.isSubmitting)
                    .onClick(() => {
                      this.snoozeIntervention(24);
                    })
                  Button('三天后')
                    .fontSize(12)
                    .margin({ left: 8 })
                    .enabled(!this.isSubmitting)
                    .onClick(() => {
                      this.snoozeIntervention(72);
                    })
                }
                .margin({ top: 12 })
              }
              if (this.isOpenStatus()) {
                TextArea({ text: this.dismissReason, placeholder: '忽略原因（可选，选择忽略时提交）' })
                  .onChange((value: string) => {
                    this.dismissReason = value;
                  })
                  .fontSize(14)
                  .height(72)
                  .margin({ top: 12 })
              }
              Row() {
                Button('接受建议')
                  .fontSize(14)
                  .enabled(this.isOpenStatus() && !this.isSubmitting
                    && this.intervention.proposedActions.length > 0)
                  .onClick(() => {
                    this.acceptIntervention();
                  })
                Button('稍后提醒')
                  .fontSize(14)
                  .margin({ left: 8 })
                  .enabled(this.isOpenStatus() && !this.isSubmitting)
                  .onClick(() => {
                    this.showSnoozeOptions = !this.showSnoozeOptions;
                  })
                Button('忽略')
                  .fontSize(14)
                  .margin({ left: 8 })
                  .enabled(this.isOpenStatus() && !this.isSubmitting)
                  .onClick(() => {
                    this.dismissIntervention();
                  })
              }
              .margin({ top: 12 })
              if (this.operationError !== '') {
                Text(this.operationError)
                  .fontSize(14)
                  .fontColor('#E84026')
                  .margin({ top: 8 })
              }
            }
            .width('100%')
            .padding(16)
            .backgroundColor('#FFFFFF')
            .borderRadius(12)
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 12 })
          }
          .padding({ left: 16, right: 16, bottom: 24 })
        }
        .width('100%')
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F5F5')
  }
}
