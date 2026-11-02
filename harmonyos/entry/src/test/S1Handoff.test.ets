import { describe, it, expect } from '@ohos/hypium';
import {
  MissionWidgetSnapshot, handoffIntentExpired, missionHandoffParams, visibleMissionWidget,
  widgetAttentionLabel, widgetSyncLabel
} from '../main/ets/common/MissionWidgetContract';

export default function s1HandoffContractTest() {
  describe('s1HandoffContract', () => {
    it('card_opens_the_original_question_not_a_similar_task', 0, () => {
      const snapshot = new MissionWidgetSnapshot();
      snapshot.ownerId = 'owner-1'; snapshot.projectId = 'project-1'; snapshot.missionId = 'mission-1';
      snapshot.questionId = 'question-1'; snapshot.approvalId = ''; snapshot.missionVersion = 7;
      snapshot.expiresAt = 2000;
      expect(visibleMissionWidget(snapshot, 'owner-1', 'project-1', 1000)).assertTrue();
      expect(visibleMissionWidget(snapshot, 'other-owner', 'project-1', 1000)).assertFalse();
      expect(visibleMissionWidget(snapshot, 'owner-1', 'other-project', 1000)).assertFalse();
      expect(visibleMissionWidget(snapshot, 'owner-1', 'project-1', 2000)).assertFalse();
      const params = missionHandoffParams(snapshot);
      expect(params.projectId).assertEqual('project-1');
      expect(params.missionId).assertEqual('mission-1');
      expect(params.questionId).assertEqual('question-1');
      expect(params.missionVersion).assertEqual('7');
      expect(params.approvalId).assertEqual('');
      expect(params.sourceId).assertEqual('');
    });
    it('attention_label_keeps_waiting_and_failure_apart', 0, () => {
      const snapshot = new MissionWidgetSnapshot();
      snapshot.status = 'WAITING_INPUT'; snapshot.questionId = 'q1'; snapshot.waitingFor = 'USER'; snapshot.expiresAt = 999999999;
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('有一项问题等你补充');
      snapshot.questionId = ''; snapshot.approvalId = 'a1';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('有一项提案等你决定');
      snapshot.approvalId = '';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('等你回应');
      snapshot.waitingFor = '';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('等待下一次检查');
      snapshot.status = 'PAUSED';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('已暂停，保留原记录');
      snapshot.status = 'RUNNING'; snapshot.nextCheckAt = '2026-11-03T00:00:00Z';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('正在跟进原委托');
      snapshot.status = 'READY';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('尚未到检查时间');
      snapshot.expiresAt = 500;
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('缓存已过期，打开后重新核对');
    });
    it('sync_and_observation_are_different_facts', 0, () => {
      const snapshot = new MissionWidgetSnapshot();
      expect(widgetSyncLabel(snapshot)).assertEqual('尚未同步');
      snapshot.updatedAt = '11/2 10:00';
      expect(widgetSyncLabel(snapshot)).assertEqual('上次同步 11/2 10:00');
      snapshot.observedAt = '11/2 09:30';
      expect(widgetSyncLabel(snapshot)).assertEqual('上次观察 11/2 09:30');
    });
    it('stale_queued_intent_does_not_open_old_question', 0, () => {
      expect(handoffIntentExpired(0, 1000)).assertTrue();
      expect(handoffIntentExpired(999, 1000)).assertTrue();
      expect(handoffIntentExpired(1001, 1000)).assertFalse();
    });
  });
}

