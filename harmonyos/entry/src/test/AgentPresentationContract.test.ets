import { describe, it, expect } from '@ohos/hypium';
import { AgentPresentation } from '../main/ets/models/AgentExperience';
import { supportsAgentPresentation, agentStateLabel, receiptDetail } from '../main/ets/common/AgentPresentationContract';
export default function agentPresentationContractTest() {
  describe('AgentPresentationContract', () => {
    it('unknown_top_level_version_uses_old_message', 0, () => {
      const future: AgentPresentation = { schemaVersion: 2, blocks: [], allowedActions: [] };
      const current: AgentPresentation = { schemaVersion: 1, blocks: [], allowedActions: [] };
      expect(supportsAgentPresentation(future)).assertFalse();
      expect(supportsAgentPresentation(undefined)).assertFalse();
      expect(supportsAgentPresentation(current)).assertTrue();
    });
    it('creation_and_report_are_not_execution_or_verification', 0, () => {
      expect(agentStateLabel('CREATED')).assertEqual('行动已创建');
      expect(receiptDetail('CREATED', 'NOT_CHECKED')).assertEqual('等待执行，目标条件尚未验收');
      expect(receiptDetail('SUCCEEDED', 'REPORTED')).assertEqual('按原任务记录显示');
      expect(agentStateLabel('REPORTED')).assertEqual('记录已报告');
    });
    it('unknown_state_has_a_readable_label', 0, () => {
      expect(agentStateLabel('FUTURE_INTERNAL_STATE')).assertEqual('状态待核对');
      expect(agentStateLabel('UNKNOWN')).assertEqual('待明确');
    });
  });
}
