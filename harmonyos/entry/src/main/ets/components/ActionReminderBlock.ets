import { common } from '@kit.AbilityKit';
import { ApiError } from '../models/Project';
import { ActionReminderState, DeviceCleanupSummary, ReminderDeviceOp, ReminderOutcome } from '../models/Reminder';
import { ReminderService } from '../services/ReminderService';
import { CalendarSyncService, CalendarCapability } from '../services/CalendarSyncService';
import { PMColors, PMSpacing, PMFontSize, PMRadius, PMButtonSize } from '../common/DesignTokens';

/**
 * 单条待办的日历提醒设置（内联展开，不使用嵌套弹窗）。
 *
 * 界面必须同时说清三件事，不能混为一谈：
 * 1. 忆程里的计划时间；
 * 2. 设备系统日历里是否真的有日程；
 * 3. 待办本身是否完成。
 *
 * 关于日历事件点击回到应用：当前 @ohos.calendarManager（本工程 SDK）
 * 只提供 EventService.type 的有限业务类型（MEETING/WATCHING/...），
 * 没有「点击日程打开指定应用」的正式 API。因此这里不承诺、也不伪造深链，
 * 需要进入待办时仍由用户从应用内打开。
 */
@Component
export struct ActionReminderBlock {
  @Prop projectId: string = '';
  @Prop actionId: string = '';
  @Prop actionTitle: string = '';
  @Prop reminderEnabled: boolean = false;
  onClose: () => void = () => {};
  onChanged: () => void = () => {};

  @State isLoading: boolean = true;
  @State state: ActionReminderState | null = null;
  @State errorMessage: string = '';
  @State message: string = '';
  @State busy: string = '';
  @State durationMinutes: number = 30;
  @State selectedDate: Date = ActionReminderBlock.defaultDate();
  @State selectedHour: number = ActionReminderBlock.defaultHour();
  @State selectedMinute: number = 0;
  @State showEditor: boolean = false;
  @State conflictTitles: string[] = [];
  @State needsConflictConfirm: boolean = false;
  @State capabilityNote: string = '';
  /** 一次保存意图一个 requestId：失败/超时重试沿用，成功或重新开编辑器才清空 */
  @State pendingRequestId: string = '';
  /** 一次撤销意图一个 requestId */
  @State pendingRevokeRequestId: string = '';
  /** 最近一次撤销后的设备清理结果；未确认时据此展示原因与重试按钮 */
  @State lastCleanup: DeviceCleanupSummary | null = null;

  private service: ReminderService = new ReminderService();

  private static defaultDate(): Date {
    return new Date(Date.now() + 2 * 60 * 60 * 1000);
  }

  private static defaultHour(): number {
    return new Date(Date.now() + 2 * 60 * 60 * 1000).getHours();
  }

  aboutToAppear(): void {
    if (this.reminderEnabled) {
      this.load();
    }
  }

  private async load(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.lastCleanup = null;
    try {
      const state = await this.service.load(this.projectId, this.actionId);
      this.state = state;
      this.durationMinutes = state.durationMinutes > 0 ? state.durationMinutes : 30;
      if (state.reminder !== null && state.reminder.reminderAt !== '') {
        const existing = new Date(state.reminder.reminderAt);
        this.selectedDate = existing;
        this.selectedHour = existing.getHours();
        this.selectedMinute = existing.getMinutes();
      }
    } catch (e) {
      this.errorMessage = e instanceof ApiError ? e.message : '提醒状态暂时读不到，请检查网络';
    } finally {
      this.isLoading = false;
    }
  }

  private plannedIso(): string {
    const picked = new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), this.selectedDate.getDate(),
      this.selectedHour, this.selectedMinute, 0, 0);
    return picked.toISOString();
  }

  private plannedPreview(): string {
    const pad = (value: number): string => value < 10 ? `0${value}` : `${value}`;
    return `${this.selectedDate.getFullYear()}-${pad(this.selectedDate.getMonth() + 1)}-${pad(this.selectedDate.getDate())} ${pad(this.selectedHour)}:${pad(this.selectedMinute)}`;
  }

  private pickDate(): void {
    DatePickerDialog.show({
      start: new Date(),
      end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      selected: this.selectedDate,
      onDateAccept: (value: Date) => {
        this.selectedDate = value;
      },
    });
  }

  private pickTime(): void {
    const selected = new Date(this.selectedDate.getFullYear(), this.selectedDate.getMonth(), this.selectedDate.getDate(),
      this.selectedHour, this.selectedMinute, 0, 0);
    TimePickerDialog.show({
      selected: selected,
      useMilitaryTime: true,
      onAccept: (value: TimePickerResult) => {
        this.selectedHour = value.hour;
        this.selectedMinute = value.minute;
      },
    });
  }

  /** 保存计划时间；一次意图一个 requestId，失败重试沿用，不显示假成功 */
  private async savePlanTime(): Promise<void> {
    if (this.busy !== '') {
      return;
    }
    const preview = this.plannedPreview();
    const iso = this.plannedIso();
    if (new Date(iso).getTime() - Date.now() < 60000) {
      this.errorMessage = '提醒时间需要晚于当前时间至少 1 分钟。';
      return;
    }
    // 一次用户意图一个 requestId：仅在尚未生成时新建，失败/超时重试沿用同一个
    if (this.pendingRequestId === '') {
      this.pendingRequestId = `reminder-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    }
    // 修改已有提醒时必须带上最新版本号，否则服务端返回 409/422
    const reminder = this.state !== null ? this.state.reminder : null;
    const expectedRevision = (reminder !== null && reminder.id !== '') ? reminder.revision : 0;
    this.busy = 'arrange';
    this.errorMessage = '';
    this.message = '';
    try {
      const mutation = await this.service.arrange(this.projectId, this.actionId, this.pendingRequestId, iso, this.durationMinutes, expectedRevision);
      this.pendingRequestId = '';
      this.message = mutation.replayed
        ? mutation.message
        : `计划时间已保存：${preview}。这是忆程里的时间，还没有写进设备日历。`;
      this.showEditor = false;
      this.needsConflictConfirm = false;
      this.conflictTitles = [];
      await this.load();
      this.onChanged();
      // 服务端要求先撤销才能改时间时，设备计划里的 DELETE 会先执行
      if (mutation.devicePlan.length > 0) {
        this.message = `${this.message} 接下来可以写入设备日历。`;
      }
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'REMINDER_REVISION_CHANGED' || e.code === 'REMINDER_EXPECTED_REVISION_REQUIRED')) {
        // 版本冲突：保留用户已填时间，重新拉取最新版本号，让用户再确认一次（不自动重试提交）
        await this.load();
        this.errorMessage = '提醒已被其他操作修改，已刷新，请再确认一次';
      } else {
        // 其它失败：保留 pendingRequestId 以便用户重试时用同一个意图编号
        this.errorMessage = e instanceof ApiError ? e.message : '保存计划时间失败，请重试';
      }
    } finally {
      this.busy = '';
    }
  }

  /** 写入设备日历：首次实际使用才申请权限；不支持或拒绝时如实回退 */
  private async writeToDevice(): Promise<void> {
    if (this.busy !== '') {
      return;
    }
    const reminder = this.state !== null ? this.state.reminder : null;
    if (reminder === null) {
      this.errorMessage = '请先保存计划时间，再写入设备日历。';
      return;
    }
    this.busy = 'device';
    this.errorMessage = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const outcome: ReminderOutcome = await this.service.writeToDevice(context, this.projectId, reminder.id,
        this.actionTitle, reminder.reminderAt, reminder.durationMinutes, this.needsConflictConfirm);
      this.message = outcome.message;
      this.conflictTitles = [];
      this.needsConflictConfirm = outcome.needsConflictConfirm;
      if (outcome.needsConflictConfirm) {
        this.conflictTitles = outcome.conflictTitles;
      }
      await this.load();
      this.onChanged();
    } catch (e) {
      this.errorMessage = e instanceof ApiError ? e.message : '设备日历操作没有完成，计划时间仍然保留';
    } finally {
      this.busy = '';
    }
  }

  private async revokeReminder(): Promise<void> {
    const reminder = this.state !== null ? this.state.reminder : null;
    if (reminder === null || this.busy !== '') {
      return;
    }
    if (this.pendingRevokeRequestId === '') {
      this.pendingRevokeRequestId = `revoke-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    }
    this.busy = 'revoke';
    this.errorMessage = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const outcome = await this.service.revokeAndRemove(context, this.projectId, reminder.id, this.pendingRevokeRequestId);
      this.pendingRevokeRequestId = '';
      this.message = outcome.message;
      this.needsConflictConfirm = false;
      this.conflictTitles = [];
      await this.load();
      // load 会刷新状态，因此在 load 之后再记录设备清理结果，避免被清空
      this.lastCleanup = outcome.cleanup;
      this.onChanged();
    } catch (e) {
      // 保留 pendingRevokeRequestId 以便重试时沿用同一意图编号
      this.errorMessage = e instanceof ApiError ? e.message : '撤销提醒失败，可以重试；重试只会删除忆程记录过的那条日程';
    } finally {
      this.busy = '';
    }
  }

  /** 设备清理未确认时，按服务端记录的日历事件编号重试删除设备日程 */
  private async retryDeviceCleanup(): Promise<void> {
    const reminder = this.state !== null ? this.state.reminder : null;
    if (reminder === null || this.busy !== '' || reminder.calendarEventId === null || reminder.calendarEventId === '') {
      return;
    }
    this.busy = 'retryCleanup';
    this.errorMessage = '';
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const op = new ReminderDeviceOp();
      op.kind = 'DELETE';
      op.reminderId = reminder.id;
      op.calendarId = reminder.calendarId;
      op.eventId = reminder.calendarEventId;
      op.title = `忆程·${this.actionTitle}`;
      op.prefix = '忆程·';
      op.start = reminder.reminderAt;
      op.end = new Date(new Date(reminder.reminderAt).getTime() + reminder.durationMinutes * 60000).toISOString();
      const summary = await this.service.applyDevicePlanDetailed(context, [op]);
      if (summary.confirmed) {
        await this.service.confirmCleanup(this.projectId, reminder.id, reminder.calendarEventId);
        this.message = `设备日历里的自有日程已确认清理（共 ${summary.deleted + summary.alreadyMissing} 条）。`;
      } else {
        this.message = summary.message !== '' ? summary.message : '设备日程仍未确认删除，请到系统日历检查「忆程·」事件。';
      }
      await this.load();
      // load 会刷新状态，因此在 load 之后再记录设备清理结果，避免被清空
      this.lastCleanup = summary;
      this.onChanged();
    } catch (e) {
      this.errorMessage = e instanceof ApiError ? e.message : '重试删除设备日程失败';
    } finally {
      this.busy = '';
    }
  }

  /** 设备不支持或权限被拒时给出可执行的下一步，而不是模糊错误 */
  private async checkCapability(): Promise<void> {
    try {
      const context = getContext(this) as common.UIAbilityContext;
      const capability: CalendarCapability = await CalendarSyncService.inspect(context);
      if (!capability.supported) {
        this.capabilityNote = `${capability.reason}：忆程只会保存项目内的计划时间。`;
      } else if (!capability.granted) {
        this.capabilityNote = '还没有日历权限，写入时会先询问你。';
      } else {
        this.capabilityNote = '日历权限已允许。';
      }
    } catch {
      this.capabilityNote = '';
    }
  }

  @Builder
  private statusRow() {
    Column() {
      Text('日历提醒')
        .fontSize(PMFontSize.CAPTION)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_TERTIARY)
      Text(this.state !== null && this.state.statusLabel !== '' ? this.state.statusLabel : '提醒状态未知')
        .fontSize(PMFontSize.BODY)
        .fontWeight(FontWeight.Medium)
        .fontColor(PMColors.INK_PRIMARY)
        .margin({ top: 2 })
      if (this.state !== null && this.state.statusDetail !== '') {
        Text(this.state.statusDetail)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_SECONDARY)
          .lineHeight(18)
          .margin({ top: 2 })
      }
      if (this.state !== null && this.state.reminder !== null && this.state.reminder.reminderAt !== '') {
        Text(`忆程里的计划时间：${this.state.reminder.reminderAt.substring(0, 10)} ${this.state.reminder.reminderAt.substring(11, 16)} · 持续 ${this.state.reminder.durationMinutes} 分钟`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: 2 })
      }
      if (this.state !== null && this.state.planBlock !== null) {
        Text(`已确认的排程时段：${this.state.planBlock.start.substring(0, 10)} ${this.state.planBlock.start.substring(11, 16)}（来自「安排未来 7 天」）`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_TERTIARY)
          .margin({ top: 2 })
      }
      if (this.state !== null && this.state.reminder !== null && this.state.reminder.error !== null && this.state.reminder.error !== '') {
        Text(`上次失败原因：${this.state.reminder.error}`)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.RISK)
          .margin({ top: 2 })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    if (this.reminderEnabled) {
      Column() {
      Row() {
        Text('日历提醒设置')
          .fontSize(PMFontSize.SECONDARY)
          .fontWeight(FontWeight.Medium)
          .fontColor(PMColors.INK_PRIMARY)
          .layoutWeight(1)
        Button('收起')
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_SECONDARY)
          .backgroundColor(PMColors.SURFACE_SUBTLE)
          .height(PMButtonSize.HEIGHT_SM)
          .borderRadius(PMRadius.SM)
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')

      if (this.isLoading) {
        Text('正在读取提醒状态…')
          .fontSize(PMFontSize.SECONDARY)
          .fontColor(PMColors.INK_SECONDARY)
          .margin({ top: PMSpacing.SM })
      }

      if (!this.isLoading && this.errorMessage !== '' && this.state === null) {
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

      if (this.state !== null) {
        this.statusRow()

        if (this.capabilityNote !== '') {
          Text(this.capabilityNote)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .margin({ top: PMSpacing.XS })
        }

        if (!this.state.canArrange) {
          Text(this.state.blockedReason !== null ? this.state.blockedReason : '这条待办当前不能安排提醒。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.WARNING)
            .lineHeight(18)
            .margin({ top: PMSpacing.SM })
        }

        if (this.state.canArrange && this.state.requiresRevokeBeforeChange) {
          Text('设备日历里仍有这条待办的日程。请先撤销并确认设备日程已清理，再修改时间。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.WARNING)
            .lineHeight(18)
            .margin({ top: PMSpacing.SM })
        }

        // 计划时间编辑区（内联展开）。设备事件未确认清理时不展示必然 409 的修改入口。
        if (this.state.canArrange && !this.state.requiresRevokeBeforeChange) {
          if (this.showEditor) {
            Column() {
              Row() {
                Button(this.plannedPreview().substring(0, 10))
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.INK_PRIMARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .height(44)
                  .layoutWeight(1)
                  .onClick(() => {
                    this.pickDate();
                  })
                Button(this.plannedPreview().substring(11, 16))
                  .fontSize(PMFontSize.SECONDARY)
                  .fontColor(PMColors.INK_PRIMARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .borderRadius(PMRadius.SM)
                  .height(44)
                  .margin({ left: PMSpacing.SM })
                  .onClick(() => {
                    this.pickTime();
                  })
              }
              .width('100%')
              .margin({ top: PMSpacing.SM })

              Row() {
                Text('持续')
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_SECONDARY)
                Button('−15')
                  .fontSize(PMFontSize.CAPTION)
                  .height(PMButtonSize.HEIGHT_SM)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .fontColor(PMColors.INK_PRIMARY)
                  .enabled(this.durationMinutes > 15)
                  .onClick(() => {
                    if (this.durationMinutes > 15) {
                      this.durationMinutes = this.durationMinutes - 15;
                    }
                  })
                Text(`${this.durationMinutes} 分钟`)
                  .fontSize(PMFontSize.CAPTION)
                  .fontColor(PMColors.INK_PRIMARY)
                  .margin({ left: PMSpacing.SM, right: PMSpacing.SM })
                Button('+15')
                  .fontSize(PMFontSize.CAPTION)
                  .height(PMButtonSize.HEIGHT_SM)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .fontColor(PMColors.INK_PRIMARY)
                  .enabled(this.durationMinutes < 240)
                  .onClick(() => {
                    if (this.durationMinutes < 240) {
                      this.durationMinutes = this.durationMinutes + 15;
                    }
                  })
              }
              .width('100%')
              .margin({ top: PMSpacing.SM })

              Text('默认持续 30 分钟，在事件开始时提醒；系统日历里的日程标题以「忆程·」开头，方便和你的其他日程区分。')
                .fontSize(PMFontSize.CAPTION)
                .fontColor(PMColors.INK_TERTIARY)
                .lineHeight(18)
                .margin({ top: PMSpacing.XS })

              Row() {
                Button(this.busy === 'arrange' ? '保存中…' : '保存计划时间')
                  .fontSize(PMFontSize.BUTTON)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(PMColors.SURFACE)
                  .backgroundColor(PMColors.BRAND)
                  .height(48)
                  .layoutWeight(1)
                  .enabled(this.busy === '')
                  .onClick(() => {
                    this.savePlanTime();
                  })
                Button('返回')
                  .fontSize(PMFontSize.BUTTON)
                  .fontColor(PMColors.INK_SECONDARY)
                  .backgroundColor(PMColors.SURFACE_SUBTLE)
                  .height(48)
                  .margin({ left: PMSpacing.SM })
                  .onClick(() => {
                    this.showEditor = false;
                  })
              }
              .width('100%')
              .margin({ top: PMSpacing.SM })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
          } else {
            Button(this.state.reminder !== null ? '修改提醒时间' : '设定提醒时间')
              .fontSize(PMFontSize.BUTTON)
              .fontColor(PMColors.INK_PRIMARY)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .border({ width: 1, color: PMColors.BORDER })
              .borderRadius(PMRadius.SM)
              .height(48)
              .margin({ top: PMSpacing.SM })
              .onClick(() => {
                this.showEditor = true;
                this.pendingRequestId = '';
                this.checkCapability();
              })
          }
        }

        // 设备日历操作
        if (this.state.reminder !== null && this.state.outstandingDeviceEvent === null
          && (this.state.reminder.syncStatus === 'PLANNED' || this.state.reminder.syncStatus === 'FAILED'
            || this.state.reminder.syncStatus === 'PERMISSION_DENIED' || this.state.reminder.syncStatus === 'MISSING')) {
          Button(this.busy === 'device'
            ? '正在写入…'
            : (this.needsConflictConfirm ? '仍然写入设备日历' : (this.state.reminder.syncStatus === 'PLANNED' ? '写入设备日历' : '重试写入设备日历')))
            .fontSize(PMFontSize.BUTTON)
            .fontWeight(FontWeight.Medium)
            .fontColor(PMColors.SURFACE)
            .backgroundColor(PMColors.BRAND)
            .height(48)
            .width('100%')
            .margin({ top: PMSpacing.SM })
            .enabled(this.busy === '')
            .onClick(() => {
              this.writeToDevice();
            })
        }

        if (this.conflictTitles.length > 0) {
          Text(`这个时段已有日程：${this.conflictTitles.join('、')}。忆程不会自动覆盖它们。`)
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.WARNING)
            .lineHeight(18)
            .margin({ top: PMSpacing.XS })
        }

        if (this.state.outstandingDeviceEvent !== null) {
          Row() {
            Text('设备日历里已有忆程创建的日程')
              .fontSize(PMFontSize.CAPTION)
              .fontColor(PMColors.INK_SECONDARY)
              .layoutWeight(1)
            Button(this.busy === 'revoke' || this.busy === 'retryCleanup'
              ? '处理中…'
              : (this.state.status === 'REVOKED' ? '重试删除设备日程' : '撤销提醒'))
              .fontSize(PMFontSize.BUTTON)
              .fontColor(PMColors.RISK)
              .backgroundColor(PMColors.SURFACE_SUBTLE)
              .border({ width: 1, color: PMColors.RISK_BORDER })
              .borderRadius(PMRadius.SM)
              .height(48)
              .enabled(this.busy === '')
              .onClick(() => {
                if (this.state !== null && this.state.status === 'REVOKED') {
                  this.retryDeviceCleanup();
                } else {
                  this.revokeReminder();
                }
              })
          }
          .width('100%')
          .margin({ top: PMSpacing.SM })
        }

        if (this.state.status === 'UNSUPPORTED' || this.state.status === 'PERMISSION_DENIED') {
          Text(this.state.status === 'UNSUPPORTED'
            ? '这台设备不支持系统日历，只有项目内的计划时间；不会有设备级提醒。'
            : '重新授权方式：系统设置 → 应用 → 忆程 → 权限 → 允许「日历」的读取与写入，然后回到这里重试写入。')
            .fontSize(PMFontSize.CAPTION)
            .fontColor(PMColors.INK_TERTIARY)
            .lineHeight(18)
            .margin({ top: PMSpacing.XS })
        }
      }

      if (this.message !== '') {
        Text(this.message)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(this.lastCleanup !== null && !this.lastCleanup.confirmed ? PMColors.WARNING : PMColors.SUCCESS)
          .lineHeight(18)
          .margin({ top: PMSpacing.SM })
      }
      if (this.errorMessage !== '' && this.state !== null) {
        Text(this.errorMessage)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.RISK)
          .lineHeight(18)
          .margin({ top: PMSpacing.SM })
      }
      if (this.state !== null && this.state.permissionPurpose !== '') {
        Text(this.state.permissionPurpose)
          .fontSize(PMFontSize.CAPTION)
          .fontColor(PMColors.INK_MUTED)
          .lineHeight(18)
          .margin({ top: PMSpacing.XS })
      }
    }
    .width('100%')
    .padding(PMSpacing.MD)
    .backgroundColor(PMColors.SURFACE_SUBTLE)
    .borderRadius(PMRadius.SM)
    .border({ width: 1, color: PMColors.BORDER_SUBTLE })
    .alignItems(HorizontalAlign.Start)
    .margin({ top: PMSpacing.SM })
    }
  }
}
