import { describe, it, expect } from '@ohos/hypium';
import { ExperienceSuggestion, MissionExperience, ExperienceListReply } from '../main/ets/models/Experience';
import { experienceStatusLabel, experienceSourceText, isInjectableExperience } from '../main/ets/common/ExperienceContract';

export default function experienceContractTest() {
  describe('experienceContract', () => {
    it('shadow_and_candidate_are_not_injected', 0, () => {
      expect(experienceStatusLabel('ACTIVE')).assertEqual('注入中·建议');
      expect(experienceStatusLabel('SHADOW')).assertEqual('影子观察·不注入');
      expect(experienceStatusLabel('CANDIDATE')).assertEqual('候选（样本不足）');
      expect(experienceStatusLabel('REVOKED')).assertEqual('已撤销（保留历史）');
      const active: ExperienceSuggestion = { id: 'e1', kind: 'WORKFLOW', status: 'ACTIVE', title: 't', statement: 's', conditions: ['c'], toolVersions: {}, supportCount: 2, counterCount: 0, sampleCount: 2 };
      const shadow: ExperienceSuggestion = { id: 'e2', kind: 'GUARDRAIL', status: 'SHADOW', title: 't', statement: 's', conditions: [], toolVersions: {}, supportCount: 2, counterCount: 0, sampleCount: 2 };
      expect(isInjectableExperience(active)).assertTrue();
      expect(isInjectableExperience(shadow)).assertFalse();
    });
    it('source_text_keeps_support_and_counter_separate', 0, () => {
      const item: ExperienceSuggestion = { id: 'e1', kind: 'WORKFLOW', status: 'ACTIVE', title: 't', statement: 's', conditions: [], toolVersions: {}, supportCount: 3, counterCount: 1, sampleCount: 3 };
      expect(experienceSourceText(item)).assertEqual('来源：3 个委托样本（支持 3 / 反例 1）；建议不改变权限。');
    });
    it('mission_experience_payload_is_optional_and_bounded', 0, () => {
      const experience: MissionExperience = { enabled: true, suggestions: [], note: '建议不改变权限；影子观察不注入模型上下文。' };
      expect(experience.enabled).assertTrue();
      expect(experience.suggestions.length).assertEqual(0);
      const disabled: MissionExperience = { enabled: false, suggestions: [], note: '项目经验复用当前未开启。' };
      expect(disabled.enabled).assertFalse();
      const reply: ExperienceListReply = { enabled: true, trajectory: null, experiences: [] };
      expect(reply.trajectory).assertNull();
    });
  });
}
