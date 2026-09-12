import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { ApiError } from '../models/Project';
import { ActionCreateInput, ActionItem, FeasibilityAssessment, FeasibilityDependency } from '../models/Action';
import { ActionFeasibilityEditor } from '../components/ActionFeasibilityEditor';
import { ActionService } from '../services/ActionService';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMMaterial } from '../common/DesignTokens';
import { PMAppBar } from '../components/PMAppBar';
import { StatusBadge } from '../components/MetricBadge';
import { LoadingStateView, ErrorStateView, EmptyStateView } from '../components/AsyncStateView';
import { TextFormatters } from '../common/TextFormatters';

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
  @State showFeasibility: boolean = false;
  @State showFeasibilityEditor: boolean = false;
  @State feasibilityFor: FeasibilityAssessment = new FeasibilityAssessment();
  @State isLoadingFeasibility: boolean = false;
  @State isCreatingDepTask: boolean = false;

  private async openFeasibilityEditor(): Promise<void> {
    if (this.isLoadingFeasibility) {
      return;
    }
    this.isLoadingFeasibility = true;
    try {
      this.feasibilityFor = await this.actionService.getFeasibility(this.projectId, this.feasibilityFor.actionId);
      this.showFeasibilityEditor = true;
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '编辑器加载失败' });
    } finally {
      this.isLoadingFeasibility = false;
    }
  }

  // “先解决依赖”防重复：已有同名跟踪任务时不再重复创建
  private hasDependencyTask(): boolean {
    const all: ActionItem[] = [...this.doingActions, ...this.todoActions];
    for (let i = 0; i < all.length; i++) {
      if (all[i].title.startsWith('先解决依赖：')) {
        return true;
      }
    }
    return false;
  }

  private actionService: ActionService = new ActionService();

  // --- F1 行动可行性：以当前源状态评估，不缓存旧结论 ---
  private async openFeasibility(actionId: string): Promise<void> {
    if (this.isLoadingFeasibility) {
      return;
    }
    this.isLoadingFeasibility = true;
    try {
      this.feasibilityFor = await this.actionService.getFeasibility(this.projectId, actionId);
      this.showFeasibility = true;
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '可行性评估失败' });
    } finally {
      this.isLoadingFeasibility = false;
    }
  }

  private feasibilityColor(): ResourceColor {
    if (this.feasibilityFor.feasibility === 'READY') return PMColors.SUCCESS;
    if (this.feasibilityFor.feasibility === 'BLOCKED') return PMColors.RISK;
    return PMColors.EVIDENCE;
  }

  private firstUnmetNote(): string {
    for (let i = 0; i < this.feasibilityFor.dependencies.length; i++) {
      const dep = this.feasibilityFor.dependencies[i];
      if (dep.hard && (dep.state === 'UNMET' || dep.state === 'MISSING')) {
        return dep.targetTitle !== null ? dep.targetTitle : dep.note;
      }
    }
    return '';
  }

  private async createDependencyTask(): Promise<void> {
    if (this.isCreatingDepTask) {
      return;
    }
    const unmet = this.firstUnmetNote();
    if (unmet === '') {
      return;
    }
    if (this.hasDependencyTask()) {
      promptAction.showToast({ message: '已存在“先解决依赖”任务，未重复创建' });
      return;
    }
    this.isCreatingDepTask = true;
    try {
      const input = new ActionCreateInput();
      input.title = `先解决依赖：${unmet}`.substring(0, 60);
      input.description = `该任务因「${this.feasibilityFor.dependencies[0].note}」被判定为 BLOCKED，先解决此前置条件。`;
      input.priority = 1;
      await this.actionService.create(this.projectId, input);
      promptAction.showToast({ message: '已创建“先解决依赖”任务' });
      this.showFeasibility = false;
      await this.loadActions();
    } catch (e) {
      promptAction.showToast({ message: e instanceof ApiError ? e.message : '创建失败' });
    } finally {
      this.isCreatingDepTask = false;
    }
  }

  aboutToAppear(): void {
    const params: Record<string, string> | undefined = router.getParams() as Record<string, string>;
    if (params === undefined || params === null) {
      this.routeError = '页面参数缺失，无法定位待办看板';
      return;
    }
    this.projectId = params['projectId'] ?? '';
    if (this.projectId === '') {
      this.routeError = '页面参数缺失，项目ID无效';
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
        this.errorMessage = '无法加载待办列表，请检查网络';
      }
    } finally {
      this.isLoading = false;
    }
  }

  private groupActions(actions: ActionItem[]): void {
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
      promptAction.showToast({ message: '已完成行动并写入项目记忆' });
      await this.loadActions();
    } catch (e) {
      if (e instanceof ApiError) {
        this.dialogError = e.message;
      } else {
        this.dialogError = '提交失败';
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
      promptAction.showToast({ message: '已将行动标记为进行中' });
      await this.loadActions();
    } catch (e) {
      if (e instanceof ApiError) {
        promptAction.showToast({ message: e.message });
      } else {
        promptAction.showToast({ message: '状态更新失败' });
      }
    } finally {
      this.startingActionId = '';
    }
  }

  @Builder
  private actionCard(action: ActionItem) {
    Column() {
      // 顶行：状态与优先级
      Row() {
        StatusBadge({ status: action.status })
        if (action.status !== 'DONE') {
          Text(TextFormatters.priorityToChinese(action.priority))
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
        }
      }
      .width('100%')
      .justifyContent(FlexAlign.SpaceBetween)

      // 标题
      Text(TextFormatters.readableText(action.title, '行动标题无法读取，请重新录入。'))
        .fontSize(PMFontSize.SECTION_TITLE)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .maxLines(2)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .margin({ top: PMSpacing.SM })

      // 来源干预引用
      if (action.sourceIntervention !== null && action.sourceIntervention !== undefined
        && action.sourceIntervention.title !== '') {
        Row() {
          Text('来源提醒: ')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          Text(TextFormatters.readableText(action.sourceIntervention.title, '提醒来源无法读取'))
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.EVIDENCE)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
        }
        .padding({ top: PMSpacing.XS })
      }

      // 已完成行动的结果陈述
      if (action.status === 'DONE' && action.resultText !== undefined && action.resultText !== '') {
        Column() {
          Text('完成记录')
            .fontSize(PMFontSize.CAPTION)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SUCCESS)
          Text(TextFormatters.readableText(action.resultText, '完成回执文本无法读取，请重新补充。'))
            .fontSize(PMFontSize.BODY)
            .fontColor(PMColors.INK_PRIMARY)
            .lineHeight(20)
            .margin({ top: 2 })
        }
        .width('100%')
        .padding(PMSpacing.SM)
        .backgroundColor(PMColors.SUCCESS_LIGHT)
        .borderRadius(PMRadius.SM)
        .alignItems(HorizontalAlign.Start)
        .margin({ top: PMSpacing.SM })
      }

      // 复盘记忆卡片深链
      if (action.resultCard !== null && action.resultCard !== undefined && action.resultCard.title !== '') {
        Row() {
          Text('✓ 已写入项目记忆')
            .fontSize(PMFontSize.SECONDARY)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.MEMORY)
        }
        .width('100%')
        .padding({ top: PMSpacing.SM })
      }

      // 操作按钮行
      if (action.status === 'TODO' || action.status === 'DOING') {
        Row() {
          if (action.status === 'TODO') {
            Button(this.startingActionId === action.id ? '启动中...' : '开始行动')
              .fontSize(PMFontSize.BUTTON)
              .fontColor(PMColors.INK_PRIMARY)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .border({ width: 1, color: PMColors.BORDER })
              .borderRadius(PMRadius.SM)
              .height(48)
              .enabled(this.startingActionId === '')
              .onClick(() => {
                this.startAction(action.id);
              })
          }

          Button(this.isLoadingFeasibility ? '评估中…' : '查可行性')
            .fontSize(PMFontSize.BUTTON)
            .fontColor(PMColors.INK_PRIMARY)
            .backgroundColor(PMColors.SURFACE_SUBTLE)
            .border({ width: 1, color: PMColors.BORDER })
            .borderRadius(PMRadius.SM)
            .height(48)
            .enabled(!this.isLoadingFeasibility)
            .onClick(() => {
              this.openFeasibility(action.id);
            })

          Button('完成并写回执')
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .borderRadius(PMRadius.SM)
            .height(48)
            .margin({ left: PMSpacing.SM })
            .onClick(() => {
              this.openCompleteDialog(action.id);
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.End)
        .margin({ top: PMSpacing.MD })
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.MD)
    .border({ width: 1, color: PMColors.BORDER })
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack() {
      Column() {
        PMAppBar({
          title: '待办',
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
          LoadingStateView({ message: '加载待办行动...' })
        } else if (this.errorMessage !== '') {
          ErrorStateView({
            message: this.errorMessage,
            onRetry: () => {
              this.loadActions();
            }
          })
        } else if (this.doingActions.length === 0 && this.todoActions.length === 0 && this.doneActions.length === 0) {
          EmptyStateView({
            title: '暂无待办行动',
            description: '当前项目没有待执行或已完成的行动，去提醒依据创建行动',
            actionText: '返回工作台',
            onAction: () => {
              router.back();
            }
          })
        } else {
          // 轻量概览状态条
          Row() {
            Row() {
              Text('进行中')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
              Text(` ${this.doingActions.length}`)
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.BRAND)
            }
            .margin({ right: PMSpacing.LG })

            Row() {
              Text('待开始')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
              Text(` ${this.todoActions.length}`)
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
            }
            .margin({ right: PMSpacing.LG })

            Row() {
              Text('已完成')
                .fontSize(PMFontSize.SECONDARY)
                .fontColor(PMColors.INK_TERTIARY)
              Text(` ${this.doneActions.length}`)
                .fontSize(PMFontSize.BODY)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SUCCESS)
            }
          }
          .width('100%')
          .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.SM })
          .backgroundColor(PMColors.SURFACE)
          .border({ width: { bottom: 1 }, color: PMColors.BORDER_SUBTLE })

          List({ space: PMSpacing.MD }) {
            // 进行中
            if (this.doingActions.length > 0) {
              ForEach(this.doingActions, (action: ActionItem) => {
                ListItem() {
                  this.actionCard(action)
                }
              }, (action: ActionItem) => action.id)
            }

            // 待开始
            if (this.todoActions.length > 0) {
              ForEach(this.todoActions, (action: ActionItem) => {
                ListItem() {
                  this.actionCard(action)
                }
              }, (action: ActionItem) => action.id)
            }

            // 已完成
            if (this.doneActions.length > 0) {
              ForEach(this.doneActions, (action: ActionItem) => {
                ListItem() {
                  this.actionCard(action)
                }
              }, (action: ActionItem) => action.id)
            }
          }
          .width('100%')
          .layoutWeight(1)
          .padding({ left: PMSpacing.LG, right: PMSpacing.LG, top: PMSpacing.MD, bottom: PMSpacing.LG })
        }
      }
      .width('100%')
      .height('100%')

      // 可行性编辑器（E4）
      if (this.showFeasibilityEditor) {
        ActionFeasibilityEditor({
          projectId: this.projectId,
          actionId: this.feasibilityFor.actionId,
          assessment: this.feasibilityFor,
          onSaved: () => {
            this.showFeasibilityEditor = false;
            this.openFeasibilityEditor();
          },
          onClose: () => {
            this.showFeasibilityEditor = false;
            this.openFeasibilityEditor();
          }
        })
      }

      // 可行性评估弹窗（F1）
      if (this.showFeasibility && !this.showFeasibilityEditor) {
        Column() {
          Column() {
            Row() {
              Text('行动可行性')
                .fontSize(PMFontSize.PAGE_TITLE)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.INK_PRIMARY)
              Button('✕')
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.INK_TERTIARY)
                .backgroundColor('transparent')
                .onClick(() => {
                  this.showFeasibility = false;
                })
            }
            .width('100%')
            .justifyContent(FlexAlign.SpaceBetween)

            Text(`${this.feasibilityFor.feasibility === 'READY' ? '✓ 可开始' : this.feasibilityFor.feasibility === 'BLOCKED' ? '! 受阻' : '? 无法确认'}`)
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.feasibilityColor())
              .margin({ top: PMSpacing.SM })

            Text(this.feasibilityFor.summary)
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(20)
              .margin({ top: PMSpacing.XS })

            if (this.feasibilityFor.overdue) {
              Text('! 截止时间已过')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.RISK)
                .margin({ top: PMSpacing.XS })
            }

            Text(`估时：${this.feasibilityFor.estimateMinutes !== null ? `${this.feasibilityFor.estimateMinutes} 分钟（用户填写）` : '未估算'}`)
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: PMSpacing.XS })

            ForEach(this.feasibilityFor.dependencies, (dep: FeasibilityDependency) => {
              Row() {
                Text(dep.hard ? '硬依赖' : '参考')
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(dep.hard ? PMColors.RISK : PMColors.INK_TERTIARY)
                Column() {
                  Text(dep.targetTitle !== null ? dep.targetTitle : dep.note)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_PRIMARY)
                  Text(`${dep.state} · ${dep.note}`)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_TERTIARY)
                    .margin({ top: 2 })
                }
                .alignItems(HorizontalAlign.Start)
                .layoutWeight(1)
                .margin({ left: PMSpacing.SM })
              }
              .width('100%')
              .alignItems(VerticalAlign.Top)
              .padding({ top: PMSpacing.SM })
            }, (dep: FeasibilityDependency) => dep.requirementId)

            if (this.feasibilityFor.dependencies.length === 0) {
              Text('尚未声明任何依赖。READY 只表示已声明的硬依赖满足，不保证现实一定按时完成。')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(18)
                .margin({ top: PMSpacing.SM })
            }

            Button('编辑依赖 / 估时')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.BRAND)
              .backgroundColor(PMColors.BRAND_LIGHT)
              .border({ width: 1, color: PMColors.BRAND })
              .borderRadius(PMRadius.SM)
              .height(44)
              .width('100%')
              .margin({ top: PMSpacing.SM })
              .onClick(() => {
                this.openFeasibilityEditor();
              })

            if (this.feasibilityFor.feasibility === 'BLOCKED' && this.firstUnmetNote() !== '') {
              Button(this.isCreatingDepTask ? '创建中…' : '创建“先解决依赖”任务')
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(PMColors.BRAND)
                .borderRadius(PMRadius.SM)
                .height(48)
                .width('100%')
                .enabled(!this.isCreatingDepTask)
                .margin({ top: PMSpacing.MD })
                .onClick(() => {
                  this.createDependencyTask();
                })
            }
          }
          .width('92%')
          .padding(PMSpacing.XL)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .justifyContent(FlexAlign.Center)
      }

      // 完成行动弹窗
      if (this.completingActionId !== '') {
        Column() {
          Column() {
            Text('完成行动并写入项目记忆')
              .fontSize(PMFontSize.PAGE_TITLE)
              .fontWeight(FontWeight.Medium)
              .fontColor(PMColors.INK_PRIMARY)

            Text('请总结完成事实与交付物（系统将自动写入记忆并闭环提醒，至少 5 个字）：')
              .fontSize(PMFontSize.BODY)
              .fontColor(PMColors.INK_SECONDARY)
              .lineHeight(20)
              .margin({ top: PMSpacing.SM })

            TextArea({
              text: this.resultText,
              placeholder: '例如：已完成最小消融对照实验并更新测试表格...'
            })
              .onChange((value: string) => {
                this.resultText = value;
              })
              .fontSize(PMFontSize.BODY)
              .height(100)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .borderRadius(PMRadius.SM)
              .border({ width: 1, color: PMColors.BORDER })
              .margin({ top: PMSpacing.MD })

            if (this.dialogError !== '') {
              Text(this.dialogError)
                .fontSize(PMFontSize.BODY)
                .fontColor(PMColors.RISK)
                .margin({ top: PMSpacing.XS })
            }

            Row() {
              Button('取消')
                .fontSize(PMFontSize.BUTTON)
                .fontColor(PMColors.INK_SECONDARY)
                .backgroundColor(PMColors.SURFACE_SUBTLE)
                .borderRadius(PMRadius.SM)
                .height(48)
                .enabled(!this.isSubmitting)
                .onClick(() => {
                  this.closeCompleteDialog();
                })

              Button(this.isSubmitting ? '提交中...' : '确认完成')
                .fontSize(PMFontSize.BUTTON)
                .fontWeight(FontWeight.Medium)
                .fontColor(PMColors.SURFACE)
                .backgroundColor(this.resultText.trim().length >= 5 && !this.isSubmitting ? PMColors.BRAND : PMColors.INK_MUTED)
                .borderRadius(PMRadius.SM)
                .height(48)
                .margin({ left: PMSpacing.MD })
                .enabled(this.resultText.trim().length >= 5 && !this.isSubmitting)
                .onClick(() => {
                  this.submitComplete();
                })
            }
            .margin({ top: PMSpacing.LG })
            .width('100%')
            .justifyContent(FlexAlign.End)
          }
          .width('100%')
          .padding(PMSpacing.LG)
          .backgroundColor(PMColors.SURFACE)
          .borderRadius(PMRadius.LG)
          .border({ width: 1, color: PMColors.BORDER })
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .height('100%')
        .backgroundColor(PMColors.SCRIM)
        .backgroundBlurStyle(PMMaterial.SCRIM, PMMaterial.OPTIONS)
        .padding({ left: PMSpacing.XL, right: PMSpacing.XL })
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(PMColors.BACKGROUND)
  }
}
