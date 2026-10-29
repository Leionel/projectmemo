import { describe, it, expect } from '@ohos/hypium';
import { FocusEntry, GlobalFocusReply } from '../main/ets/models/GlobalFocus';
import { focusPrimary, focusEntryKind, focusDeadlineConflict } from '../main/ets/common/GlobalFocusPresentation';

function entry(id: string, status: string): FocusEntry {
  return { id: id, status: status, projectId: 'project', projectTitle: '测试项目', title: id,
    detail: '', activity: '', activityAt: '', recordedAt: '', dueAt: '' };
}
export default function globalFocusPresentationTest() {
  describe('globalFocusPresentation', () => {
    it('user_approval_precedes_reminders_and_service_failures', 0, () => {
      const view = new GlobalFocusReply();
      view.waiting = [entry('paused', 'PAUSED'), entry('approval', 'WAITING_APPROVAL')];
      view.reminders = [entry('reminder', 'OPEN')];
      expect(focusPrimary(view)?.id).assertEqual('approval');
      expect(view.waiting.length).assertEqual(2);
    });
    it('service_failure_does_not_displace_an_actionable_reminder', 0, () => {
      const view = new GlobalFocusReply();
      view.waiting = [entry('paused', 'PAUSED')]; view.reminders = [entry('reminder', 'OPEN')];
      const selected = focusPrimary(view)!;
      expect(selected.id).assertEqual('reminder'); expect(focusEntryKind(view, selected)).assertEqual('reminder');
      expect(view.waiting[0].id).assertEqual('paused');
    });
    it('action_precedes_running_mission_but_preserves_failure_fallback', 0, () => {
      const view = new GlobalFocusReply(); view.waiting = [entry('paused', 'PAUSED')];
      view.running = [entry('running', 'RUNNING')]; view.actions = [entry('action', 'DOING')];
      expect(focusPrimary(view)?.id).assertEqual('action');
      view.actions = []; view.running = [];
      expect(focusPrimary(view)?.id).assertEqual('paused');
    });
    it('empty_workspace_has_no_invented_primary', 0, () => {
      expect(focusPrimary(new GlobalFocusReply()) === null).assertTrue();
    });
    it('past_deadline_reminder_conflicts_with_future_project_deadline', 0, () => {
      const reminder = entry('deadline', 'OPEN'); reminder.title = '截止日期已经过去';
      reminder.projectDeadline = '2026-11-16T00:00:00Z';
      expect(focusDeadlineConflict(reminder, Date.parse('2026-10-22T00:00:00Z'))).assertTrue();
      reminder.projectDeadline = '2026-10-01T00:00:00Z';
      expect(focusDeadlineConflict(reminder, Date.parse('2026-10-22T00:00:00Z'))).assertFalse();
    });
    it('missing_deadline_does_not_invent_a_conflict', 0, () => {
      const reminder = entry('deadline', 'OPEN'); reminder.title = '截止日期已经过去';
      expect(focusDeadlineConflict(reminder, Date.now())).assertFalse();
      reminder.projectDeadline = 'not-a-date';
      expect(focusDeadlineConflict(reminder, Date.now())).assertFalse();
    });
  });
}
