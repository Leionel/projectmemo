import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { ApiError } from '../models/Project';
import { ActionItem } from '../models/Action';
import { ActionService } from '../services/ActionService';

@Entry
@Component
struct ActionBoard {
  @State projectId: string = '';
  @State doingActions: ActionItem[] = [];
  @State todoActions: ActionItem[] = [];
  @State doneActions: ActionItem[] = [];
  @State isLoading: boolean = false;
  @State errorMessage: string = '';
  @State routeError: string = '';
  @State completingActionId: string = '';
  @State resultText: string = '';
  @State isSubmitting: boolean = false;
  @State dialogError: string = '';
  @State startingActionId: string = '';

  private actionService: ActionService = new ActionService();

  aboutToAppear(): void {
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    if (params === undefined || params === null) {
      this.routeError = '页面参数缺失';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    if (this.projectId === '') {
      this.routeError = '页面参数缺失';
      return;
    }
    this.loadActions();
  }

  private async loadActions(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    try {
      const actions: ActionItem[] = await this.actionService.list(this.projectId);
      this.groupActions(actions);
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

  private groupActions(actions: ActionItem[]): void {
    // 仅展示层分组，保持后端返回顺序
    const doing: ActionItem[] = [];
    const todo: ActionItem[] = [];
    const done: ActionItem[] = [];
    for (const action of actions) {
      if (action.status === 'DOING') {
        doing.push(action);
      } else if (action.status === 'TODO') {
        todo.push(action);
      } else if (action.status === 'DONE') {
        done.push(action);
      }
    }
    this.doingActions = doing;
    this.todoActions = todo;
    this.doneActions = done;
  }

  private openCompleteDialog(actionId: string): void {
    this.completingActionId = actionId;
    this.resultText = '';
    this.dialogError = '';
  }

  private closeCompleteDialog(): void {
    if (this.isSubmitting) {
      return;
    }
    this.completingActionId = '';
    this.resultText = '';
    this.dialogError = '';
  }

  private async submitComplete(): Promise<void> {
    if (this.isSubmitting) {
      return;
    }
    const trimmed: string = this.resultText.trim();
    if (trimmed === '') {
      return;
    }
    this.isSubmitting = true;
    this.dialogError = '';
    try {
      await this.actionService.complete(this.projectId, this.completingActionId, trimmed);
      this.completingActionId = '';
      this.resultText = '';
      promptAction.showToast({ message: '已完成并生成复盘' });
      await this.loadActions();
    } catch (e) {
      if (e instanceof ApiError) {
        this.dialogError = e.message;
      } else {
        this.dialogError = '未知错误';
      }
    } finally {
      this.isSubmitting = false;
    }
  }

  private async startAction(actionId: string): Promise<void> {
    if (this.startingActionId !== '') {
      return;
    }
    this.startingActionId = actionId;
    try {
      await this.actionService.updateStatus(this.projectId, actionId, 'DOING');
      await this.loadActions();
    } catch (e) {
      if (e instanceof ApiError) {
        promptAction.showToast({ message: e.message });
      } else {
        promptAction.showToast({ message: '未知错误' });
      }
    } finally {
      this.startingActionId = '';
    }
  }

  @Builder
  private actionCard(action: ActionItem) {
    Column() {
      Row() {
        Text(action.title)
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(`P${action.priority}`)
          .fontSize(12)
          .fontColor('#999999')
      }
      .width('100%')
      // 后端对无来源/无复盘的关联返回 null，ArkTS 下 null !== undefined，
      // 必须同时排除 null 和 undefined，否则渲染空行动会崩溃（jscrash）。
      if (action.sourceIntervention !== null && action.sourceIntervention !== undefined
        && action.sourceIntervention.title !== '') {
        Text(`来自：${action.sourceIntervention.title}`)
          .fontSize(12)
          .fontColor('#999999')
          .margin({ top: 4 })
      }
      if (action.status === 'DONE' && action.resultText !== undefined && action.resultText !== '') {
        Text(action.resultText)
          .fontSize(14)
          .fontColor('#666666')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .margin({ top: 4 })
      }
      if (action.resultCard !== null && action.resultCard !== undefined && action.resultCard.title !== '') {
        Text(`复盘：${action.resultCard.title}`)
          .fontSize(14)
          .fontColor('#007DFF')
          .margin({ top: 4 })
      }
      if (action.status === 'TODO' || action.status === 'DOING') {
        Row() {
          if (action.status === 'TODO') {
            Button(this.startingActionId === action.id ? '开始中...' : '开始')
              .fontSize(12)
              .enabled(this.startingActionId === '')
              .onClick(() => {
                this.startAction(action.id);
              })
          }
          Button('完成')
            .fontSize(12)
            .margin({ left: action.status === 'TODO' ? 8 : 0 })
            .onClick(() => {
              this.openCompleteDialog(action.id);
            })
        }
        .margin({ top: 8 })
      }
    }
    .width('100%')
    .padding(16)
    .backgroundColor('#FFFFFF')
    .borderRadius(12)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack() {
      Column() {
        Row() {
          Text('返回')
            .fontSize(16)
            .fontColor('#007DFF')
            .onClick(() => {
              router.back();
            })
          Text('行动看板')
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
                this.loadActions();
              })
          }
          .width('100%')
          .layoutWeight(1)
          .justifyContent(FlexAlign.Center)
          .padding({ left: 32, right: 32 })
        } else if (this.doingActions.length === 0 && this.todoActions.length === 0
          && this.doneActions.length === 0) {
          Column() {
            Text('暂无行动')
              .fontSize(16)
              .fontColor('#999999')
          }
          .width('100%')
          .layoutWeight(1)
          .justifyContent(FlexAlign.Center)
        } else {
          List({ space: 12 }) {
            ListItem() {
              Text(`进行中（${this.doingActions.length}）`)
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor('#666666')
            }
            ForEach(this.doingActions, (action: ActionItem) => {
              ListItem() {
                this.actionCard(action)
              }
            }, (action: ActionItem) => action.id)

            ListItem() {
              Text(`待开始（${this.todoActions.length}）`)
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor('#666666')
                .margin({ top: 12 })
            }
            ForEach(this.todoActions, (action: ActionItem) => {
              ListItem() {
                this.actionCard(action)
              }
            }, (action: ActionItem) => action.id)

            ListItem() {
              Text(`已完成（${this.doneActions.length}）`)
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor('#666666')
                .margin({ top: 12 })
            }
            ForEach(this.doneActions, (action: ActionItem) => {
              ListItem() {
                this.actionCard(action)
              }
            }, (action: ActionItem) => action.id)
          }
          .width('100%')
          .layoutWeight(1)
          .padding({ left: 16, right: 16, bottom: 16 })
        }
      }
      .width('100%')
      .height('100%')

      if (this.completingActionId !== '') {
        Column() {
          Column() {
            Text('完成行动')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
            Text('请填写完成结果（至少 5 个字）')
              .fontSize(12)
              .fontColor('#999999')
              .margin({ top: 4 })
            TextArea({ text: this.resultText, placeholder: '完成结果（必填，至少 5 个字）' })
              .onChange((value: string) => {
                this.resultText = value;
              })
              .fontSize(14)
              .height(96)
              .margin({ top: 12 })
            if (this.dialogError !== '') {
              Text(this.dialogError)
                .fontSize(14)
                .fontColor('#E84026')
                .margin({ top: 8 })
            }
            Row() {
              Button('取消')
                .fontSize(14)
                .enabled(!this.isSubmitting)
                .onClick(() => {
                  this.closeCompleteDialog();
                })
              Button(this.isSubmitting ? '提交中...' : '提交')
                .fontSize(14)
                .margin({ left: 12 })
                .enabled(this.resultText.trim() !== '' && !this.isSubmitting)
                .onClick(() => {
                  this.submitComplete();
                })
            }
            .margin({ top: 12 })
            .width('100%')
            .justifyContent(FlexAlign.End)
          }
          .width('100%')
          .padding(16)
          .backgroundColor('#FFFFFF')
          .borderRadius(12)
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0, 0, 0, 0.5)')
        .padding({ left: 24, right: 24 })
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#F5F5F5')
  }
}
