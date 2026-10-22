import { FocusEntry, GlobalFocusReply } from '../models/GlobalFocus';

export function focusPrimary(view: GlobalFocusReply): FocusEntry | null {
  const needsUser = view.waiting.find((item: FocusEntry) => item.status === 'WAITING_INPUT' || item.status === 'WAITING_APPROVAL');
  return needsUser ?? view.reminders[0] ?? view.actions[0] ?? view.running[0] ?? view.waiting[0] ?? view.records[0] ?? null;
}

export function focusEntryKind(view: GlobalFocusReply, item: FocusEntry): string {
  if (view.waiting.some((entry: FocusEntry) => entry.id === item.id) || view.running.some((entry: FocusEntry) => entry.id === item.id)) return 'mission';
  if (view.reminders.some((entry: FocusEntry) => entry.id === item.id)) return 'reminder';
  if (view.actions.some((entry: FocusEntry) => entry.id === item.id)) return 'action';
  return 'record';
}

export function focusDeadlineConflict(item: FocusEntry, asOf: number): boolean {
  return deadlineReminderConflict(item.title, item.detail, item.projectDeadline ?? '', asOf);
}

export function deadlineReminderConflict(title: string, detail: string, deadline: string, asOf: number): boolean {
  const currentDeadline = new Date(deadline).getTime();
  return !isNaN(currentDeadline) && currentDeadline > asOf &&
    (title === '截止日期已经过去' || detail.includes('项目已经超过截止日期'));
}

export function focusStatusLabel(status: string): string {
    if (status === 'WAITING_INPUT') return '等待补充信息';
    if (status === 'WAITING_APPROVAL') return '等待你的批准';
    if (status === 'PAUSED') return '已暂停';
    if (status === 'FAILED') return '执行失败';
    if (status === 'RUNNING') return '正在执行';
    if (status === 'READY') return '等待执行';
    if (status === 'DOING') return '进行中';
    if (status === 'TODO') return '待开始';
    return '有效提醒';
  }

export function focusActionLabel(status: string, kind: string): string {
    if (kind === 'mission') {
      if (status === 'WAITING_INPUT') return '补充委托资料 →';
      if (status === 'WAITING_APPROVAL') return '审阅待批准提案 →';
      if (status === 'PAUSED') return '查看暂停原因 →';
      if (status === 'FAILED') return '查看失败原因 →';
      return '查看委托进展 →';
    }
    if (kind === 'action') return '打开行动 →';
    if (kind === 'reminder') return '查看提醒依据 →';
    return '查看资料与来源 →';
  }
