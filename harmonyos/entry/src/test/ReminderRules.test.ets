import { describe, it, expect } from '@ohos/hypium';
import { ReminderStatusCopy, ReminderDeviceOp, ActionReminderState } from '../main/ets/models/Reminder';
import { HealthSeverityCopy, HealthFinding, HealthSuggestedTarget } from '../main/ets/models/Health';
import { buildActionCompleteBody } from '../main/ets/common/ApiContract';

/**
 * 提醒与体检的纯逻辑契约测试。
 * 这里固定的是「界面不能骗用户」的规则：没拿到事件编号就不能说已写入设备日历，
 * 只有记录过的事件编号才允许生成设备删除指令。
 */
export default function reminderRulesTest() {
  describe('reminderRules', () => {

    it('reminder_status_label_never_claims_synced_without_event', 0, () => {
      // 只有 SYNCED 才允许出现「已写入」的说法
      expect(ReminderStatusCopy.label('SYNCED').includes('已写入')).assertTrue();
      expect(ReminderStatusCopy.label('PLANNED').includes('已写入')).assertFalse();
      expect(ReminderStatusCopy.label('PENDING').includes('已写入')).assertFalse();
      expect(ReminderStatusCopy.label('FAILED').includes('已写入')).assertFalse();
      expect(ReminderStatusCopy.label('PERMISSION_DENIED').includes('已写入')).assertFalse();
      expect(ReminderStatusCopy.label('MISSING').includes('已写入')).assertFalse();
      expect(ReminderStatusCopy.label('UNSUPPORTED').includes('已写入')).assertFalse();
      expect(ReminderStatusCopy.label('REVOKED').includes('已写入')).assertFalse();
      expect(ReminderStatusCopy.label('NOT_SCHEDULED').includes('已写入')).assertFalse();
    });

    it('reminder_status_label_is_chinese_only', 0, () => {
      const statuses: string[] = ['NOT_SCHEDULED', 'PLANNED', 'PENDING', 'SYNCED', 'FAILED',
        'PERMISSION_DENIED', 'MISSING', 'UNSUPPORTED', 'REVOKED'];
      for (const status of statuses) {
        const label: string = ReminderStatusCopy.label(status);
        expect(label !== '').assertTrue();
        // 不把工程枚举直接暴露给用户
        expect(label === status).assertFalse();
      }
    });

    it('outstanding_device_event_only_for_synced_and_pending', 0, () => {
      expect(ReminderStatusCopy.hasOwnDeviceEvent('SYNCED')).assertTrue();
      expect(ReminderStatusCopy.hasOwnDeviceEvent('PENDING')).assertTrue();
      // 计划时间、失败与权限被拒都不代表设备上一定有事件
      expect(ReminderStatusCopy.hasOwnDeviceEvent('PLANNED')).assertFalse();
      expect(ReminderStatusCopy.hasOwnDeviceEvent('FAILED')).assertFalse();
      expect(ReminderStatusCopy.hasOwnDeviceEvent('PERMISSION_DENIED')).assertFalse();
      expect(ReminderStatusCopy.hasOwnDeviceEvent('MISSING')).assertFalse();
      expect(ReminderStatusCopy.hasOwnDeviceEvent('REVOKED')).assertFalse();
      expect(ReminderStatusCopy.hasOwnDeviceEvent('UNSUPPORTED')).assertFalse();
      expect(ReminderStatusCopy.hasOwnDeviceEvent('NOT_SCHEDULED')).assertFalse();
    });

    it('delete_operation_carries_own_event_and_time_window', 0, () => {
      // 撤销必须同时带上事件编号与时间窗，删除前才能做四重核对
      const op = new ReminderDeviceOp();
      op.kind = 'DELETE';
      op.reminderId = 'rem-1';
      op.eventId = 'evt-9';
      op.calendarId = 'cal-1';
      op.title = '忆程·整理实验数据';
      op.start = '2026-09-22T10:00:00.000Z';
      op.end = '2026-09-22T10:30:00.000Z';
      expect(op.kind).assertEqual('DELETE');
      expect(op.eventId).assertEqual('evt-9');
      expect(op.prefix).assertEqual('忆程·');
      expect(op.title.startsWith(op.prefix)).assertTrue();
      expect(op.start < op.end).assertTrue();
    });

    it('create_operation_reminds_at_event_start_with_30_minutes', 0, () => {
      const op = new ReminderDeviceOp();
      op.kind = 'CREATE';
      expect(op.durationMinutes).assertEqual(30);
      expect(op.reminderMinutesBeforeStart.length).assertEqual(1);
      expect(op.reminderMinutesBeforeStart[0]).assertEqual(0);
    });

    it('reminder_state_defaults_do_not_look_synced', 0, () => {
      const state = new ActionReminderState();
      expect(state.status).assertEqual('NOT_SCHEDULED');
      expect(state.reminder).assertNull();
      expect(state.canArrange).assertFalse();
      expect(state.requiresRevokeBeforeChange).assertFalse();
      expect(state.outstandingDeviceEvent).assertNull();
    });

    it('complete_body_omits_reminder_fields_when_not_asked', 0, () => {
      const plain = buildActionCompleteBody('已完成实验并写入记录');
      expect(plain.reminderDisposition).assertUndefined();
      expect(plain.deviceKey).assertUndefined();

      const withDisposition = buildActionCompleteBody('已完成实验并写入记录', 'REMOVE', 'device-1');
      expect(withDisposition.reminderDisposition).assertEqual('REMOVE');
      expect(withDisposition.deviceKey).assertEqual('device-1');
    });

    it('health_severity_labels_are_chinese_and_never_numeric_scores', 0, () => {
      expect(HealthSeverityCopy.label('ACTION_REQUIRED')).assertEqual('需要马上处理');
      expect(HealthSeverityCopy.label('ATTENTION')).assertEqual('需要留意');
      expect(HealthSeverityCopy.label('INFO')).assertEqual('供参考');
      expect(HealthSeverityCopy.label('ACTION_REQUIRED') === 'ACTION_REQUIRED').assertFalse();
    });

    it('health_finding_keeps_a_repair_entry', 0, () => {
      const finding = new HealthFinding();
      finding.findingCode = 'ACTION_BLOCKED';
      finding.severity = 'ACTION_REQUIRED';
      finding.suggestedAction = '补充前置依赖或先创建一个解阻待办';
      finding.suggestedTarget = new HealthSuggestedTarget();
      finding.suggestedTarget.kind = 'action';
      finding.suggestedTarget.id = 'act-1';
      expect(finding.suggestedAction !== '').assertTrue();
      expect(finding.suggestedTarget.kind).assertEqual('action');
      expect(HealthSeverityCopy.targetLabel(finding.suggestedTarget.kind)).assertEqual('待办');
    });

    it('health_target_label_covers_every_object_type', 0, () => {
      const kinds: string[] = ['episode', 'action', 'reminder', 'meeting', 'deliverable', 'state', 'attachment', 'card', 'memory'];
      for (const kind of kinds) {
        const label: string = HealthSeverityCopy.targetLabel(kind);
        expect(label !== '').assertTrue();
        expect(label === kind).assertFalse();
      }
    });
  });
}
