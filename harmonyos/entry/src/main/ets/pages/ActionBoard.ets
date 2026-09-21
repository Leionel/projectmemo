import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { ApiError } from '../models/Project';
import { ActionCreateInput, ActionItem, FeasibilityAssessment, FeasibilityDependency } from '../models/Action';
import { ActionFeasibilityEditor } from '../components/ActionFeasibilityEditor';
import { ActionService } from '../services/ActionService';
import { ReentryService, SchedulePreviewBody, ScheduleConfirmBody, ScheduleSlotBody, CalendarSyncBody, CalendarRevokeBody } from '../services/ReentryService';
import { ScheduleBlock, ScheduleCalendarEntry, SchedulePlan, ScheduleSkipReason } from '../models/Reentry';
import { CalendarSyncService, CalendarOption, CalendarConflict } from '../services/CalendarSyncService';
import { ReminderService } from '../services/ReminderService';
import { ReminderCompletionOption } from '../models/Reminder';
import { ActionReminderBlock } from '../components/ActionReminderBlock';
import { DeviceIdentity } from '../common/DeviceIdentity';
import { common } from '@kit.AbilityKit';
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
  @State highlightActionId: string = '';
  @State showFeasibility: boolean = false;
  @State showFeasibilityEditor: boolean = false;
  @State feasibilityFor: FeasibilityAssessment = new FeasibilityAssessment();
  @State isLoadingFeasibility: boolean = false;
  @State isCreatingDepTask: boolean = false;

  // ---- R2 可执行安排：只安排当前 READY 的行动 ----
  private reentryService: ReentryService = new ReentryService();
  @State showSchedulePlanner: boolean = false;
  @State schedulePlan: SchedulePlan | null = null;
  @State schedulePreview: SchedulePlan | null = null;
  @State scheduleStartTime: string = '19:00';
  @State scheduleEndTime: string = '22:00';
  @State scheduleDays: string = '7';
  @State scheduleBusy: string = '';
  @State scheduleMessage: string = '';
  @State scheduleError: string = '';

  // ---- R2 系统日历同步：授权 → 选择日历 → 冲突预览 → 用户确认写入 → 可撤销 ----
  @State calendarStage: string = '';
  @State calendarOptions: CalendarOption[] = [];
  @State calendarChoice: string = '';
  @State calendarConflicts: CalendarConflict[] = [];
  @State calendarBusy: string = '';
  @State calendarMessage: string = '';
  @State calendarError: string = '';
  // 单条待办的日历提醒（与批量排程的日历同步共用同一套状态语义）
  @State reminderAvailable: boolean = false;
  @State reminderForActionId: string = '';
  @State completionQuestion: string = '';
  @State completionOptions: ReminderCompletionOption[] = [];
  @State completionDisposition: string = 'KEEP';
  @State reminderNotice: string = '';

  private scheduleSlotInstant(dayOffset: number, time: string): string {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    const parts = time.split(':');
    if (parts.length >= 2) {
      const hours = Number(parts[0]);
      const minutes = Number(parts[1]);
      if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
        date.setHours(hours, minutes, 0, 0);
      }
    }
    return date.toISOString();
  }

  private async loadCurrentSchedule(): Promise<void> {
    try {
      const response = await this.reentryService.getCurrentSchedule(this.projectId);
      this.schedulePlan = response.plan;
    } catch (e) {
      this.schedulePlan = null;
    }
  }

  private async generateSchedulePreview(): Promise<void> {
    if (this.scheduleBusy !== '') {
      return;
    }
    this.scheduleBusy = 'preview';
    this.scheduleError = '';
    this.scheduleMessage = '';
    try {
      const days = Number(this.scheduleDays);
      const total = Number.isNaN(days) ? 7 : Math.min(7, Math.max(1, Math.round(days)));
      const slots: ScheduleSlotBody[] = [];
      for (let i = 1; i <= total; i++) {
        const slot = new ScheduleSlotBody();
        slot.start = this.scheduleSlotInstant(i, this.scheduleStartTime);
        slot.end = this.scheduleSlotInstant(i, this.scheduleEndTime);
        if (new Date(slot.end).getTime() > new Date(slot.start).getTime()) {
          slots.push(slot);
        }
      }
      if (slots.length === 0) {
        this.scheduleError = '可用时间区间无效：结束时间必须晚于开始时间。';
        return;
      }
      const body = new SchedulePreviewBody();
      body.requestId = `sched-${Date.now()}-${Math.floor(Math.random() * 100000000)}`;
      body.rangeStart = slots[0].start;
      body.rangeEnd = slots[slots.length - 1].end;
      body.slots = slots;
      const plan = await this.reentryService.previewSchedule(this.projectId, body);
      this.schedulePreview = plan;
    } catch (e) {
      this.scheduleError = e instanceof ApiError ? e.message : '生成排程预览失败';
    } finally {
      this.scheduleBusy = '';
    }
  }

  private async confirmSchedule(): Promise<void> {
    const preview = this.schedulePreview;
    if (this.scheduleBusy !== '' || preview === null) {
      return;
    }
    this.scheduleBusy = 'confirm';
    this.scheduleError = '';
    try {
      const body = new ScheduleConfirmBody();
      body.requestId = preview.requestId;
      body.expectedVersion = preview.version;
      await this.reentryService.confirmSchedule(this.projectId, preview.id, body);
      this.schedulePreview = null;
      this.showSchedulePlanner = false;
      this.scheduleMessage = '未来安排已确认';
      await this.loadCurrentSchedule();
    } catch (e) {
      this.scheduleError = e instanceof ApiError ? e.message : '确认安排失败';
    } finally {
      this.scheduleBusy = '';
    }
  }

  private scheduleTimeLabel(iso: string): string {
    const date = new Date(iso);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${date.getMonth() + 1}/${date.getDate()} ${hours}:${minutes}`;
  }

  private scheduleReasonLabel(code: string): string {
    if (code === 'MISSING_ESTIMATE') return '先填写预计用时';
    if (code === 'BLOCKED') return '还有事情需要先完成';
    if (code === 'UNKNOWN') return '暂时无法确认能否开始';
    if (code === 'DONE_OR_CANCELLED') return '已经结束，不再安排';
    if (code === 'NO_CAPACITY') return '空闲时间放不下';
    if (code === 'CROSS_PROJECT_CONFLICT') return '和其他项目的安排冲突';
    if (code === 'VERSION_CHANGED') return '待办刚刚发生了变化';
    if (code === 'ALREADY_SCHEDULED') return '已经安排过了';
    return '这次暂未安排';
  }

  /** 未安排原因按固定顺序分组，保证每个行动都能看懂为什么没被排入 */
  private reasonOrder(): string[] {
    return ['MISSING_ESTIMATE', 'BLOCKED', 'UNKNOWN', 'DONE_OR_CANCELLED', 'NO_CAPACITY', 'CROSS_PROJECT_CONFLICT', 'VERSION_CHANGED', 'ALREADY_SCHEDULED'];
  }

  private unscheduledByCode(code: string): ScheduleSkipReason[] {
    const preview = this.schedulePreview;
    if (preview === null) {
      return [];
    }
    return preview.unscheduled.filter((item: ScheduleSkipReason) => item.reasonCode === code);
  }

  private calendarStatusLabel(status: string): string {
    if (status === 'SYNCED') return '已写入系统日历';
    if (status === 'FAILED') return '系统日历写入失败，仅应用内有效';
    if (status === 'REVOKED') return '已从系统日历撤销';
    if (status === 'PENDING') return '日历写入中';
    return '';
  }

  private async openCalendarFlow(): Promise<void> {
    const plan = this.schedulePlan;
    if (plan === null || this.calendarBusy !== '') {
      return;
    }
    this.calendarBusy = 'inspect';
    this.calendarError = '';
    this.calendarMessage = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const capability = await CalendarSyncService.inspect(context);
      if (!capability.supported) {
        // 设备不支持：如实说明并回退应用内排程
        this.calendarError = `${capability.reason}，已保留应用内安排`;
        return;
      }
      if (!capability.granted) {
        const permission = await CalendarSyncService.requestPermission(context);
        if (!permission.granted) {
          this.calendarError = permission.reason !== '' ? permission.reason : '未获得日历权限，已保留应用内安排';
          return;
        }
      }
      this.calendarOptions = await CalendarSyncService.listCalendars(context);
      this.calendarChoice = this.calendarOptions.length > 0 ? this.calendarOptions[0].id : '';
      this.calendarStage = 'calendars';
    } catch (e) {
      this.calendarError = e instanceof ApiError ? e.message : '日历能力不可用，已保留应用内安排';
    } finally {
      this.calendarBusy = '';
    }
  }

  private async previewCalendarWrite(): Promise<void> {
    const plan = this.schedulePlan;
    if (plan === null || this.calendarBusy !== '') {
      return;
    }
    this.calendarBusy = 'preview';
    this.calendarError = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const pending = plan.blocks.filter((block: ScheduleBlock) => block.calendar.status !== 'SYNCED');
      this.calendarConflicts = await CalendarSyncService.findConflicts(context, this.calendarChoice, pending);
      this.calendarStage = 'confirm';
    } catch (e) {
      this.calendarError = e instanceof ApiError ? e.message : '冲突检查失败，未写入任何日程';
    } finally {
      this.calendarBusy = '';
    }
  }

  private async writeCalendar(): Promise<void> {
    const plan = this.schedulePlan;
    if (plan === null || this.calendarBusy !== '') {
      return;
    }
    this.calendarBusy = 'write';
    this.calendarError = '';
    const context = getContext(this) as common.UIAbilityContext;
    const pending = plan.blocks.filter((block: ScheduleBlock) => block.calendar.status !== 'SYNCED');
    let entries: ScheduleCalendarEntry[] = [];
    try {
      entries = await CalendarSyncService.writeBlocks(context, this.calendarChoice, pending);
      const body = new CalendarSyncBody();
      body.entries = entries;
      const updated = await this.reentryService.reportCalendarSync(this.projectId, plan.id, body);
      this.schedulePlan = updated;
      this.calendarStage = '';
      const failed = entries.filter((entry: ScheduleCalendarEntry) => entry.status === 'FAILED').length;
      this.calendarMessage = failed === 0
        ? `已写入 ${entries.length} 条系统日历日程`
        : `${entries.length - failed} 条写入成功，${failed} 条失败；应用内安排仍然有效`;
    } catch (e) {
      const written = entries.filter((entry: ScheduleCalendarEntry) => entry.status === 'SYNCED').length;
      let rollbackMessage = '';
      if (written > 0) {
        const rolledBack = await CalendarSyncService.rollbackWrites(context, pending, entries);
        rollbackMessage = rolledBack === written
          ? '；已撤销本次新建的系统日程'
          : '；部分日程未能自动撤销，请在系统日历中检查“忆程·”事件';
      }
      const reason = e instanceof ApiError ? e.message : '日历写入失败，应用内安排不受影响';
      this.calendarError = `${reason}${rollbackMessage}`;
    } finally {
      this.calendarBusy = '';
    }
  }

  private async revokeCalendar(): Promise<void> {
    const plan = this.schedulePlan;
    if (plan === null || this.calendarBusy !== '') {
      return;
    }
    this.calendarBusy = 'revoke';
    this.calendarError = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const synced = plan.blocks.filter((block: ScheduleBlock) => block.calendar.status === 'SYNCED');
      const calendarId = synced.length > 0 && synced[0].calendar.calendarId !== null ? synced[0].calendar.calendarId! : this.calendarChoice;
      const revokedIds = await CalendarSyncService.revokeBlocks(context, calendarId, synced);
      const body = new CalendarRevokeBody();
      body.blockIds = revokedIds;
      const updated = await this.reentryService.revokeCalendarSync(this.projectId, plan.id, body);
      this.schedulePlan = updated;
      this.calendarMessage = revokedIds.length > 0 ? `已从系统日历撤销 ${revokedIds.length} 条日程` : '没有需要撤销的日程';
    } catch (e) {
      this.calendarError = e instanceof ApiError ? e.message : '撤销失败，请稍后重试';
    } finally {
      this.calendarBusy = '';
    }
  }

  private hasSyncedBlocks(): boolean {
    const plan = this.schedulePlan;
    if (plan === null) {
      return false;
    }
    return plan.blocks.some((block: ScheduleBlock) => block.calendar.status === 'SYNCED');
  }

  private hasUnsyncedBlocks(): boolean {
    const plan = this.schedulePlan;
    if (plan === null) {
      return false;
    }
    return plan.blocks.some((block: ScheduleBlock) => block.calendar.status !== 'SYNCED');
  }

  @Builder
  ScheduleSection() {
    Column() {
      Row() {
        Column() {
          Text('把待办放进日程')
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_TERTIARY)
          Text('安排接下来几天')
            .fontSize(PMFontSize.SECTION_TITLE)
            .fontWeight(FontWeight.Bold)
            .fontColor(PMColors.INK_PRIMARY)
            .margin({ top: 2 })
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Text(this.showSchedulePlanner ? '收起设置' : '设置时间')
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.BRAND)
          .padding({ left: 10, right: 10, top: 6, bottom: 6 })
          .backgroundColor(PMColors.BRAND_LIGHT)
          .borderRadius(PMRadius.MD)
          .onClick(() => {
            this.showSchedulePlanner = !this.showSchedulePlanner;
            this.schedulePreview = null;
          })
      }
      .width('100%')
      .alignItems(VerticalAlign.Center)

      if (this.scheduleMessage !== '') {
        Text(this.scheduleMessage)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.SUCCESS)
          .margin({ top: 6 })
      }
      if (this.scheduleError !== '') {
        Text(this.scheduleError)
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.RISK)
          .margin({ top: 6 })
      }

      if (this.schedulePlan !== null && this.schedulePlan!.blocks.length > 0) {
        Text('已经安排好的时间')
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.INK_PRIMARY)
          .margin({ top: 8 })
        ForEach(this.schedulePlan!.blocks, (block: ScheduleBlock) => {
          Column() {
            Text(`${block.actionTitle !== '' ? block.actionTitle : '行动'} · ${this.scheduleTimeLabel(block.start)}`)
              .fontSize(PMFontSize.SECONDARY)
              .fontColor(PMColors.INK_SECONDARY)
              .margin({ top: 4 })
            if (this.calendarStatusLabel(block.calendar.status) !== '') {
              Text(this.calendarStatusLabel(block.calendar.status))
                .fontSize(PMFontSize.CAPTION)
                .fontColor(block.calendar.status === 'FAILED' ? PMColors.WARNING : PMColors.SUCCESS)
                .margin({ top: 2 })
            }
            if (block.calendar.status === 'FAILED' && block.calendar.error !== null) {
              Text(block.calendar.error!)
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }, (block: ScheduleBlock) => block.id ?? '')

        // 系统日历同步：只在用户确认后写入，且只管理自己创建的事件
        if (this.calendarMessage !== '') {
          Text(this.calendarMessage)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.SUCCESS)
            .margin({ top: 6 })
        }
        if (this.calendarError !== '') {
          Text(this.calendarError)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.WARNING)
            .margin({ top: 6 })
        }
        Row({ space: 8 }) {
          if (this.hasUnsyncedBlocks()) {
            Button(this.calendarBusy !== '' ? '处理中…' : '添加到手机日历')
              .buttonStyle(ButtonStyleMode.NORMAL)
              .fontSize(PMFontSize.CAPTION)
              .enabled(this.calendarBusy === '')
              .onClick(() => {
                this.openCalendarFlow();
              })
          }
          if (this.hasSyncedBlocks()) {
            Button('从手机日历移除')
              .buttonStyle(ButtonStyleMode.NORMAL)
              .fontSize(PMFontSize.CAPTION)
              .enabled(this.calendarBusy === '')
              .onClick(() => {
                this.revokeCalendar();
              })
          }
        }
        .width('100%')
        .justifyContent(FlexAlign.Start)
        .margin({ top: 8 })

        if (this.calendarStage === 'calendars') {
          Column() {
            Text('选择保存位置。忆程不会修改你原有的日程。')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
            ForEach(this.calendarOptions, (option: CalendarOption) => {
              Row() {
                Radio({ value: option.id, group: 'calendarChoice' })
                  .checked(this.calendarChoice === option.id)
                  .onChange((checked: boolean) => {
                    if (checked) {
                      this.calendarChoice = option.id;
                    }
                  })
                Text(option.label)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.INK_PRIMARY)
                  .margin({ left: 6 })
              }
              .width('100%')
              .margin({ top: 4 })
            }, (option: CalendarOption) => option.id)
            Button('看看是否撞时间')
              .buttonStyle(ButtonStyleMode.EMPHASIZED)
              .fontSize(PMFontSize.CAPTION)
              .margin({ top: 8 })
              .onClick(() => {
                this.previewCalendarWrite();
              })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .margin({ top: 8 })
        }

        if (this.calendarStage === 'confirm') {
          Column() {
            if (this.calendarConflicts.length > 0) {
              Text('这些时间和已有日程重叠。忆程不会覆盖原来的日程，请确认后再继续：')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.WARNING)
              ForEach(this.calendarConflicts, (conflict: CalendarConflict) => {
                Text(`· ${conflict.actionTitle} 与「${conflict.existingTitle}」重叠（${this.scheduleTimeLabel(conflict.start)}）`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                  .margin({ top: 2 })
              }, (conflict: CalendarConflict) => `${conflict.blockId}-${conflict.existingTitle}`)
            } else {
              Text('没有发现时间冲突，可以放心添加。')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
            }
            Row({ space: 8 }) {
              Button('先不写')
                .buttonStyle(ButtonStyleMode.NORMAL)
                .fontSize(PMFontSize.CAPTION)
                .onClick(() => {
                  this.calendarStage = '';
                })
              Button(this.calendarBusy === 'write' ? '添加中…' : '确认添加')
                .buttonStyle(ButtonStyleMode.EMPHASIZED)
                .fontSize(PMFontSize.CAPTION)
                .enabled(this.calendarBusy === '')
                .onClick(() => {
                  this.writeCalendar();
                })
            }
            .margin({ top: 8 })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .margin({ top: 8 })
        }
      }

      if (this.showSchedulePlanner && this.schedulePreview === null) {
        Column() {
          Text('我每天有空的时间')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
          Row({ space: 8 }) {
            Text('从').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
            TextInput({ text: this.scheduleStartTime })
              .onChange((value: string) => {
                this.scheduleStartTime = value;
              })
              .width(92)
              .height(40)
              .accessibilityText('每天空闲时间的开始时刻')
            Text('到').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
            TextInput({ text: this.scheduleEndTime })
              .onChange((value: string) => {
                this.scheduleEndTime = value;
              })
              .width(92)
              .height(40)
              .accessibilityText('每天空闲时间的结束时刻')
          }
          .width('100%')
          .margin({ top: 4 })

          Row({ space: 8 }) {
            Text('连续安排').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
            TextInput({ text: this.scheduleDays })
              .onChange((value: string) => {
                this.scheduleDays = value;
              })
              .width(64)
              .height(40)
              .accessibilityText('要安排的天数')
            Text('天').fontSize(PMFontSize.SECONDARY).fontColor(PMColors.INK_SECONDARY)
          }
          .width('100%')
          .margin({ top: 6 })

          Button(this.scheduleBusy === 'preview' ? '正在安排…' : '看看怎么安排')
            .buttonStyle(ButtonStyleMode.EMPHASIZED)
            .fontSize(PMFontSize.BUTTON)
            .height(44)
            .width('100%')
            .enabled(this.scheduleBusy === '')
            .margin({ top: 10 })
            .onClick(() => {
              this.generateSchedulePreview();
            })
        }
        .width('100%')
        .margin({ top: 10 })
        .alignItems(HorizontalAlign.Start)

        Text('只会安排能够开始、并且已经填写预计用时的待办。你确认前不会保存，也不会写入手机日历。')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: 4 })
      }

      if (this.schedulePreview !== null) {
        Text(`安排建议（${this.schedulePreview!.blocks.length} 项）`)
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Bold)
          .fontColor(PMColors.SUCCESS)
          .margin({ top: 8 })
        ForEach(this.schedulePreview!.blocks, (block: ScheduleBlock) => {
          Text(`· ${block.actionTitle !== '' ? block.actionTitle : '行动'} · ${this.scheduleTimeLabel(block.start)}`)
            .fontSize(PMFontSize.SECONDARY)
            .fontColor(PMColors.INK_SECONDARY)
            .margin({ top: 4 })
        }, (block: ScheduleBlock) => block.id ?? '')
        ForEach(this.reasonOrder(), (code: string) => {
          if (this.unscheduledByCode(code).length > 0) {
            Column() {
              Text(`${this.scheduleReasonLabel(code)}（${this.unscheduledByCode(code).length}）`)
                .fontSize(PMFontSize.CAPTION)
                .fontWeight(FontWeight.Bold)
                .fontColor(PMColors.INK_PRIMARY)
              ForEach(this.unscheduledByCode(code), (item: ScheduleSkipReason) => {
                Text(`· ${item.actionTitle !== '' ? item.actionTitle : '行动'}：${item.message}`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_TERTIARY)
                  .margin({ top: 2 })
              }, (item: ScheduleSkipReason) => `${item.actionId}-${item.reasonCode}`)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .margin({ top: 8 })
          }
        }, (code: string) => code)
        Row({ space: 8 }) {
          Button('修改空闲时间')
            .buttonStyle(ButtonStyleMode.NORMAL)
            .fontSize(PMFontSize.SECONDARY)
            .onClick(() => {
              this.schedulePreview = null;
            })
          Button(this.scheduleBusy === 'confirm' ? '保存中…' : '保存这个安排')
            .buttonStyle(ButtonStyleMode.EMPHASIZED)
            .fontSize(PMFontSize.SECONDARY)
            .enabled(this.scheduleBusy === '' && this.schedulePreview !== null && this.schedulePreview!.blocks.length > 0)
            .onClick(() => {
              this.confirmSchedule();
            })
        }
        .width('100%')
        .justifyContent(FlexAlign.End)
        .margin({ top: 10 })
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({ width: 1, color: PMColors.BORDER })
    .margin({ top: PMSpacing.MD })
  }

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
  private reminderService: ReminderService = new ReminderService();

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

  private feasibilityTitle(): string {
    if (this.feasibilityFor.feasibility === 'BLOCKED') return '还有事情需要先完成';
    if (this.feasibilityFor.feasibility === 'UNKNOWN') return '暂时无法确认能否开始';
    if (this.feasibilityFor.estimateMinutes === null) return '可以开始，还缺预计用时';
    return '可以开始，也可以安排时间';
  }

  private feasibilitySummary(): string {
    if (this.feasibilityFor.feasibility === 'BLOCKED') return '先完成下面标出的前置事项，再回来安排这个待办。';
    if (this.feasibilityFor.feasibility === 'UNKNOWN') return '有些前置事项的状态还不明确，确认后再安排会更稳妥。';
    if (this.feasibilityFor.estimateMinutes === null) return '没有发现必须先完成的事项。填写大约需要多少分钟后，就能把它放进日程。';
    return `没有发现必须先完成的事项，预计需要 ${this.feasibilityFor.estimateMinutes} 分钟。`;
  }

  private dependencyStateLabel(state: string): string {
    if (state === 'MET') return '已满足';
    if (state === 'UNMET') return '未完成';
    if (state === 'MISSING') return '已找不到';
    return '待确认';
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
    this.highlightActionId = params['actionId'] ?? '';
    this.loadActions();
    this.loadCurrentSchedule();
    this.probeReminder();
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
    let found = false;
    for (const action of actions) {
      if (action.id === this.highlightActionId) {
        found = true;
      }
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
    if (this.highlightActionId !== '' && !found) {
      promptAction.showToast({ message: '来源行动不存在或已删除' });
      this.highlightActionId = '';
    }
  }

  /** 开关关闭时不显示提醒入口：不让用户点下去才看到模糊错误 */
  private async probeReminder(): Promise<void> {
    try {
      this.reminderAvailable = await this.reminderService.isAvailable(this.projectId);
    } catch {
      this.reminderAvailable = false;
    }
  }

  /**
   * 打开完成回执。若这条待办在设备日历里还有未来的日程，
   * 在同一个弹层里先问「保留还是移除」，不叠加第二个弹窗。
   */
  private async openCompleteDialog(actionId: string): Promise<void> {
    this.completingActionId = actionId;
    this.resultText = '';
    this.dialogError = '';
    this.completionQuestion = '';
    this.completionOptions = [];
    this.completionDisposition = 'KEEP';
    this.reminderNotice = '';
    if (!this.reminderAvailable) {
      return;
    }
    try {
      const state = await this.reminderService.load(this.projectId, actionId);
      const prompt = state.completionPrompt;
      if (prompt !== null && prompt.required) {
        this.completionQuestion = prompt.question;
        this.completionOptions = prompt.options;
      }
    } catch {
      // 读取提醒状态失败不阻塞完成流程：仍可正常填写回执
    }
  }

  private closeCompleteDialog(): void {
    if (this.isSubmitting) {
      return;
    }
    this.completingActionId = '';
    this.resultText = '';
    this.dialogError = '';
    this.completionQuestion = '';
    this.completionOptions = [];
    this.reminderNotice = '';
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
    const actionId = this.completingActionId;
    try {
      if (this.completionOptions.length > 0) {
        // 用户已经选择如何处理未来提醒：完成回执先落库，设备删除随后补偿执行
        const response = await this.actionService.completeWithReminder(this.projectId, actionId, trimmed,
          this.completionDisposition, DeviceIdentity.getConsumerKey());
        const outcome = response.reminderOutcome;
        if (outcome !== null && outcome.devicePlan.length > 0) {
          const context = getContext(this) as common.UIAbilityContext;
          // 用结构化清理结果：只有 DELETED / 已查询确认不存在才会说「设备日程已删除」
          const cleanup = await this.reminderService.applyDevicePlanDetailed(context, outcome.devicePlan);
          this.reminderNotice = cleanup.confirmed
            ? `设备日历里的自有日程已确认清理（${cleanup.deleted + cleanup.alreadyMissing} 条）。`
            : `${cleanup.message}如果反复失败，请到系统日历检查「忆程·」事件。`;
        } else if (outcome !== null && outcome.compensation.needed) {
          this.reminderNotice = outcome.compensation.message;
        }
      } else {
        await this.actionService.complete(this.projectId, actionId, trimmed);
      }
      this.completingActionId = '';
      this.resultText = '';
      this.completionQuestion = '';
      this.completionOptions = [];
      promptAction.showToast({ message: this.reminderNotice !== ''
        ? `已完成行动并写入项目记忆。${this.reminderNotice}`
        : '已完成行动并写入项目记忆' });
      this.reminderNotice = '';
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

          Button(this.isLoadingFeasibility ? '检查中…' : '看看能否安排')
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

      // 日历提醒：入口只在功能开启时出现，状态区分「计划时间」与「设备日历事件」
      if (this.reminderAvailable && (action.status === 'TODO' || action.status === 'DOING')) {
        Button(this.reminderForActionId === action.id ? '收起提醒设置' : '日历提醒')
          .fontSize(PMFontSize.BUTTON)
          .fontColor(PMColors.INK_PRIMARY)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .border({ width: 1, color: PMColors.BORDER })
          .borderRadius(PMRadius.SM)
          .height(48)
          .margin({ top: PMSpacing.SM })
          .onClick(() => {
            this.reminderForActionId = this.reminderForActionId === action.id ? '' : action.id;
          })
      }

      if (this.reminderAvailable && this.reminderForActionId === action.id) {
        ActionReminderBlock({
          projectId: this.projectId,
          actionId: action.id,
          actionTitle: action.title,
          reminderEnabled: this.reminderAvailable,
          onClose: () => {
            this.reminderForActionId = '';
          },
          onChanged: () => {
            this.loadActions();
          }
        })
      }
    }
    .width('100%')
    .padding(PMSpacing.LG)
    .backgroundColor(PMColors.SURFACE)
    .borderRadius(PMRadius.LG)
    .border({
      width: this.highlightActionId === action.id ? 2 : 1,
      color: this.highlightActionId === action.id ? PMColors.BRAND : PMColors.BORDER
    })
    .shadow({ radius: 6, color: 'rgba(0, 0, 0, 0.03)', offsetX: 0, offsetY: 1 })
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack() {
      Column() {
        PMAppBar({
          title: '行动安排',
          subtitle: '排程与系统日历',
          backLabel: '项目',
          backDescription: '返回项目待办',
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

          // R2 可执行安排：预览并确认未来 7 天的应用内时段
          this.ScheduleSection()

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
            const actionId = this.feasibilityFor.actionId;
            this.showFeasibilityEditor = false;
            this.openFeasibility(actionId);
          },
          onClose: () => {
            const actionId = this.feasibilityFor.actionId;
            this.showFeasibilityEditor = false;
            this.openFeasibility(actionId);
          }
        })
      }

      // 可行性评估弹窗（F1）
      if (this.showFeasibility && !this.showFeasibilityEditor) {
        Column() {
          Column() {
            Row() {
              Text('这个待办能安排吗？')
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

            Text(this.feasibilityTitle())
              .fontSize(PMFontSize.SECTION_TITLE)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.feasibilityColor())
              .margin({ top: PMSpacing.SM })

            Text(this.feasibilitySummary())
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

            Text(this.feasibilityFor.estimateMinutes !== null ? `预计用时：${this.feasibilityFor.estimateMinutes} 分钟` : '还没有填写预计用时')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_TERTIARY)
              .margin({ top: PMSpacing.XS })

            ForEach(this.feasibilityFor.dependencies, (dep: FeasibilityDependency) => {
              Row() {
                Text(dep.hard ? '必须先完成' : '参考事项')
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(dep.hard ? PMColors.RISK : PMColors.INK_TERTIARY)
                Column() {
                  Text(dep.targetTitle !== null ? dep.targetTitle : dep.note)
                    .fontSize(PMFontSize.CAPTION)
                    .fontColor(PMColors.INK_PRIMARY)
                  Text(`${this.dependencyStateLabel(dep.state)} · ${dep.note}`)
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
              Text('没有需要先完成的事项。实际完成时间仍可能受临时情况影响。')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(18)
                .margin({ top: PMSpacing.SM })
            }

            Button(this.feasibilityFor.estimateMinutes === null ? '填写预计用时' : '修改前置事项或用时')
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

            if (this.completionOptions.length > 0) {
              Column() {
                Text('设备日历提醒')
                  .fontSize(PMFontSize.CAPTION)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.WARNING)
                Text(this.completionQuestion)
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.INK_PRIMARY)
                  .lineHeight(18)
                  .margin({ top: 2 })
                ForEach(this.completionOptions, (option: ReminderCompletionOption) => {
                  Row() {
                    Radio({ value: option.value, group: 'reminder-disposition' })
                      .checked(this.completionDisposition === option.value)
                      .onChange((isChecked: boolean) => {
                        if (isChecked) {
                          this.completionDisposition = option.value;
                        }
                      })
                    Text(option.label)
                      .fontSize(PMFontSize.SECONDARY)
                      .fontColor(PMColors.INK_SECONDARY)
                      .margin({ left: PMSpacing.SM })
                  }
                  .width('100%')
                  .margin({ top: PMSpacing.XS })
                }, (option: ReminderCompletionOption) => option.value)
              }
              .width('100%')
              .padding(PMSpacing.SM)
              .backgroundColor(PMColors.WARNING_LIGHT)
              .borderRadius(PMRadius.SM)
              .alignItems(HorizontalAlign.Start)
              .margin({ top: PMSpacing.MD })
            }

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
