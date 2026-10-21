import { describe, it, expect } from '@ohos/hypium';
import { MissionConstraints, MissionEvent } from '../main/ets/models/Mission';
import { editableMissionConstraints, mergeMissionEvents, missionStatusLabel } from '../main/ets/common/MissionContract';
import { MissionWidgetSnapshot, visibleMissionWidget } from '../main/ets/common/MissionWidgetContract';
import { isSuccessCode } from '../main/ets/common/ApiContract';
export default function missionContractTest() {
  describe('missionContract', () => {
    it('accepted_is_not_completion', 0, () => {
      expect(isSuccessCode('POST', 202)).assertTrue(); expect(isSuccessCode('PATCH', 202)).assertTrue();
      expect(isSuccessCode('GET', 202)).assertFalse(); expect(missionStatusLabel('READY')).assertEqual('等待执行');
    });
    it('event_cursor_merge_is_ordered_and_idempotent', 0, () => {
      const first: MissionEvent = { id: 'e100', seq: 100, type: 'QUESTION', createdAt: '', payloadJson: new Object() };
      const second: MissionEvent = { id: 'e101', seq: 101, type: 'INPUT', createdAt: '', payloadJson: new Object() };
      const result = mergeMissionEvents([first], [second, first]);
      expect(result.length).assertEqual(2); expect(result[0].seq).assertEqual(100); expect(result[1].seq).assertEqual(101);
    });
    it('constraint_edit_keeps_user_denials_but_strips_server_consent', 0, () => {
      const value = new MissionConstraints(); value.llmContextApproved = true; value.rejectedActions = ['禁止上传私有实验'];
      const edited = editableMissionConstraints(value); edited.rejectedActions.push('禁止付费训练');
      expect(edited.llmContextApproved === undefined).assertTrue(); expect(value.rejectedActions.length).assertEqual(1);
    });
    it('widget_rejects_expired_other_owner_or_project', 0, () => {
      const snapshot = new MissionWidgetSnapshot(); snapshot.ownerId = 'user-a'; snapshot.projectId = 'project-a';
      snapshot.missionId = 'mission-a'; snapshot.expiresAt = 200;
      expect(visibleMissionWidget(snapshot, 'user-a', 'project-a', 100)).assertTrue();
      expect(visibleMissionWidget(snapshot, 'user-b', 'project-a', 100)).assertFalse();
      expect(visibleMissionWidget(snapshot, 'user-a', 'project-b', 100)).assertFalse();
      expect(visibleMissionWidget(snapshot, 'user-a', 'project-a', 200)).assertFalse();
    });
  });
}
