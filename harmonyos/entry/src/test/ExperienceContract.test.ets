import { describe, it, expect } from '@ohos/hypium';
import { ExperienceSuggestion, MissionExperience, ExperienceListReply } from '../main/ets/models/Experience';
import { experienceStatusLabel, experienceSourceText, isInjectableExperience } from '../main/ets/common/ExperienceContract';

function suggestion(id: string, status: string, eligible: boolean, support: number, counter: number, sample: number): ExperienceSuggestion {
  return { id, kind: 'WORKFLOW', status, version: 1, title: 't', statement: 's', conditions: ['c'], unknownConditions: [],
    notApplicableWhen: [], toolVersions: {}, supportCount: support, counterCount: counter, sampleCount: sample,
    caseReferenceCount: 0, matchState: 'MATCH', eligibleForInjection: eligible, suppressed: null, originMissionId: null,
    revoked: status === 'REVOKED', counterExamples: [], modelDecision: null, userFeedback: null };
}

export default function experienceContractTest() {
  describe('experienceContract', () => {
    it('shadow_and_candidate_are_not_injected', 0, () => {
      const active = suggestion('e1', 'ACTIVE', true, 2, 0, 2);
      const shadow = suggestion('e2', 'SHADOW', false, 2, 0, 2);
      const candidate = suggestion('e3', 'CANDIDATE', false, 0, 0, 1);
      const revoked = suggestion('e4', 'REVOKED', false, 2, 0, 2);
      expect(experienceStatusLabel(active)).assertEqual('注入中·建议');
      expect(experienceStatusLabel(shadow)).assertEqual('影子观察·不注入');
      expect(experienceStatusLabel(candidate)).assertEqual('案例参考·不注入');
      expect(experienceStatusLabel(revoked)).assertEqual('已撤销（保留历史）');
      expect(isInjectableExperience(active)).assertTrue();
      expect(isInjectableExperience(shadow)).assertFalse();
      expect(isInjectableExperience(candidate)).assertFalse();
    });
    it('source_text_keeps_support_counter_and_case_separate', 0, () => {
      const item = suggestion('e1', 'ACTIVE', true, 3, 1, 3);
      expect(experienceSourceText(item)).assertEqual('来源：3 个样本（支持 3 / 反例 1 / 案例 0）；建议不改变权限。');
    });
    it('mission_experience_payload_is_optional_and_bounded', 0, () => {
      const experience: MissionExperience = { enabled: true, suggestions: [], note: '建议不改变权限；条件未知时不注入。' };
      expect(experience.enabled).assertTrue();
      expect(experience.suggestions.length).assertEqual(0);
      const disabled: MissionExperience = { enabled: false, suggestions: [], note: '项目经验复用当前未开启。' };
      expect(disabled.enabled).assertFalse();
      const reply: ExperienceListReply = { enabled: true, trajectory: null, experiences: [] };
      expect(reply.trajectory).assertNull();
    });
  });
}
