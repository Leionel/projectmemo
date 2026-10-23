import { EvidenceAssessment, evidenceAssessmentText } from '../main/ets/models/Copilot';
import { describe, it, expect } from '@ohos/hypium';
import { MissionConstraints, MissionEvent } from '../main/ets/models/Mission';
import { editableMissionConstraints, mergeMissionEvents, missionStatusLabel, missionCompletionFacts, missionErrorPhaseLabel } from '../main/ets/common/MissionContract';
import { MissionWidgetSnapshot, visibleMissionWidget } from '../main/ets/common/MissionWidgetContract';
import { isSuccessCode } from '../main/ets/common/ApiContract';
export default function missionContractTest() {
  describe('missionContract', () => {
    it('evidence_axes_do_not_promote_unknown_to_fact', 0, () => {
      const value = new EvidenceAssessment();
      value.citationAdmissibility = 'ADMITTED';
      expect(evidenceAssessmentText(value)).assertEqual('引用可用 · 时态未知 · 语义尚未核验 · 项目记录');
      value.temporalState = 'SUPERSEDED';
      value.semanticVerdict = 'ENTAILS';
      expect(evidenceAssessmentText(value)).assertEqual('引用可用 · 历史记录 · 原文支持此句 · 项目记录');
    });
    it('accepted_is_not_completion', 0, () => {
      expect(isSuccessCode('POST', 202)).assertTrue(); expect(isSuccessCode('PATCH', 202)).assertTrue();
      expect(isSuccessCode('GET', 202)).assertFalse(); expect(missionStatusLabel('READY')).assertEqual('等待执行');
    });
    it('criteria_draft_adoption_and_reality_remain_separate', 0, () => {
      const facts = missionCompletionFacts('SUCCEEDED', { criteriaPassed: true, criteriaCheckedAt: null,
        draftVerification: 'NEEDS_REVIEW', adoptionCount: 1, latestArtifactId: 'artifact-fixture', realityOutcome: 'NOT_INFERRED' });
      expect(facts.length).assertEqual(4);
      expect(facts[0].value).assertEqual('已通过本委托设定的条件');
      expect(facts[1].value).assertEqual('待审阅，尚未整体核验');
      expect(facts[2].value).assertEqual('已确认归入 1 份项目成果');
      expect(facts[3].value).assertEqual('未从委托状态推断，以实际行动回执为准');
    });
    it('legacy_completion_and_optional_error_phase_are_compatible', 0, () => {
      expect(missionCompletionFacts('SUCCEEDED')[2].value).assertEqual('采纳回执待读取');
      expect(missionErrorPhaseLabel('TOOL')).assertEqual('工具执行');
      expect(missionErrorPhaseLabel()).assertEqual('执行阶段未记录');
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
