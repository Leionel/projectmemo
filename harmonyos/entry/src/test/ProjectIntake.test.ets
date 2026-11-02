import { describe, it, expect } from '@ohos/hypium';
import {
  IntakeAcceptedFields, IntakeMaterialSync, IntakeMaterialView, IntakePreview, IntakeSuggested,
  intakeCanConfirm, intakeEditableFields, intakeSyncSummary, intakeUnderstandingLabel
} from '../main/ets/models/ProjectIntake';

export default function projectIntakeContractTest() {
  describe('projectIntakeContract', () => {
    it('understanding_state_is_not_reported_as_done', 0, () => {
      expect(intakeUnderstandingLabel('READY')).assertEqual('已读懂，请核对');
      expect(intakeUnderstandingLabel('FAILED')).assertEqual('这次没能形成理解');
      expect(intakeUnderstandingLabel('MATERIAL_ONLY')).assertEqual('文件暂无可读文本');
      expect(intakeUnderstandingLabel('NONE')).assertEqual('材料已保存');
    });
    it('confirm_requires_an_open_draft_and_unexpired_preview', 0, () => {
      const now: number = 1700000000000;
      const future = new Date(now + 60000).toISOString();
      const past = new Date(now - 60000).toISOString();
      expect(intakeCanConfirm('PREVIEW_READY', future, now)).assertTrue();
      expect(intakeCanConfirm('DRAFT', future, now)).assertTrue();
      expect(intakeCanConfirm('PREVIEW_READY', past, now)).assertFalse();
      expect(intakeCanConfirm('CONFIRMED', future, now)).assertFalse();
      expect(intakeCanConfirm('WITHDRAWN', future, now)).assertFalse();
      expect(intakeCanConfirm('PREVIEW_READY', '', now)).assertFalse();
    });
    it('sync_summary_keeps_failures_visible', 0, () => {
      const empty: IntakeMaterialView[] = [];
      expect(intakeSyncSummary(empty)).assertEqual('还没有材料');
      const pending = new IntakeMaterialView();
      pending.id = 'm1';
      const synced = new IntakeMaterialView();
      synced.id = 'm2';
      const sync = new IntakeMaterialSync();
      sync.state = 'SYNCED';
      synced.sync = sync;
      expect(intakeSyncSummary([synced])).assertEqual('材料已全部进入项目（1/1）');
      const failed = new IntakeMaterialView();
      failed.id = 'm3';
      const bad = new IntakeMaterialSync();
      bad.state = 'FAILED';
      failed.sync = bad;
      expect(intakeSyncSummary([synced, failed])).assertEqual('已进入项目 1/2 份，1 份需要重试');
      expect(intakeSyncSummary([pending, failed])).assertEqual('已进入项目 0/2 份，1 份需要重试');
    });
    it('phone_only_edits_fields_the_user_accepts', 0, () => {
      const preview = new IntakePreview();
      const blank = intakeEditableFields(preview);
      expect(blank.title).assertEqual('');
      expect(blank.scenario).assertEqual('COURSE_DESIGN');

      const suggestedItem = new IntakeSuggested();
      suggestedItem.title = '课程原型';
      suggestedItem.description = '在旧平板上交付可演示原型';
      suggestedItem.goal = '先确认设备可用性';
      suggestedItem.scenario = 'COURSE_DESIGN';
      const suggested = new IntakePreview();
      suggested.suggested = suggestedItem;
      const draft = intakeEditableFields(suggested);
      expect(draft.title).assertEqual('课程原型');
      expect(draft.goal).assertEqual('先确认设备可用性');

      const acceptedItem = new IntakeAcceptedFields();
      acceptedItem.title = '用户改过的名字';
      acceptedItem.description = '用户写的描述';
      acceptedItem.goal = '用户确认的目标';
      acceptedItem.scenario = 'RESEARCH';
      acceptedItem.deadline = '2026-11-20';
      const accepted = new IntakePreview();
      accepted.accepted = acceptedItem;
      const chosen = intakeEditableFields(accepted);
      expect(chosen.title).assertEqual('用户改过的名字');
      expect(chosen.goal).assertEqual('用户确认的目标');
      expect(chosen.deadline).assertEqual('2026-11-20');
    });
  });
}
