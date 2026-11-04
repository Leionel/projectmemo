import { describe, it, expect } from '@ohos/hypium';
import { WorkState } from '../main/ets/models/WorkState';
import { workTone, workStateLabel, stopRequestBadge, nextActorLabel, primaryActionTone } from '../main/ets/common/WorkStateBadge';

function state(phase: string, nextActor: string): WorkState {
  return { phase: phase, nextActor: nextActor, requiresUser: nextActor === 'USER', reasonCode: '', reasonText: '', actionLabel: '',
    originalRef: { kind: 'MISSION', id: 'm', version: 1 }, exactQuestionRef: null, exactApprovalRef: null,
    checkedAt: '2026-11-04T01:00:00.000Z', observedAt: null, nextCheckAt: null, nextBoundary: null, freshness: 'FRESH' };
}
export default function workStateBadgeTest() {
  describe('workStateBadge', () => {
    it('tone_follows_next_actor_like_web', 0, () => {
      expect(workTone(state('WAITING_USER', 'USER'))).assertEqual('user');
      expect(workTone(state('RUNNING', 'AGENT'))).assertEqual('agent');
      expect(workTone(state('PAUSED', 'USER'))).assertEqual('paused');
      expect(workTone(state('FAILED', 'SYSTEM'))).assertEqual('failed');
      expect(workTone(state('UNKNOWN', 'SYSTEM'))).assertEqual('system');
    });
    it('completed_needs_terminal_to_claim_success', 0, () => {
      const done = state('COMPLETED', 'NONE');
      expect(workTone(done)).assertEqual('cancelled');
      done.terminal = { status: 'SUCCEEDED' };
      expect(workStateLabel(done)).assertEqual('条件已验收');
      done.terminal = { status: 'CANCELLED' };
      expect(workStateLabel(done)).assertEqual('已取消（不是成功）');
    });
    it('unsettled_stop_request_is_a_second_badge', 0, () => {
      const running = state('RUNNING', 'SYSTEM');
      expect(stopRequestBadge(running)).assertEqual('');
      running.stopRequest = { state: 'PAUSE_REQUESTED', settled: false };
      expect(stopRequestBadge(running)).assertEqual('暂停请求待结算');
      running.stopRequest = { state: 'PAUSE_SETTLED', settled: true };
      expect(stopRequestBadge(running)).assertEqual('');
    });
    it('primary_button_and_actor_labels', 0, () => {
      expect(primaryActionTone(state('WAITING_APPROVAL', 'USER'))).assertEqual('solid');
      expect(primaryActionTone(state('RUNNING', 'AGENT'))).assertEqual('outline');
      expect(primaryActionTone(state('FAILED', 'SYSTEM'))).assertEqual('failed');
      expect(nextActorLabel('AGENT')).assertEqual('忆程');
      expect(nextActorLabel('UNKNOWN')).assertEqual('');
    });
  });
}
