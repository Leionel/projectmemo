import { describe, it, expect } from '@ohos/hypium';
import { SignalView, ConnectionView } from '../main/ets/models/RepoSignal';
import { ConnectionCreateBody, SignalActionBody } from '../main/ets/models/RepoSignal';

export default function repoSignalContractTest() {
  describe('repoSignalContract', () => {
    it('candidate_is_not_fact_until_adopted', 0, () => {
      const signal: SignalView = { id: 's1', connectionId: 'c1', kind: 'COMMITS', sha: 'a'.repeat(40), title: '提交', authorName: '作者',
        committedAt: null, url: 'https://github.com/x/y/commit/a', status: 'CANDIDATE', adoptedAt: null, adoptedCaptureId: null, linkedActionId: null };
      expect(signal.status === 'CANDIDATE').assertTrue();
      expect(signal.adoptedCaptureId).assertNull();
      const adopted: SignalView = { id: 's1', connectionId: 'c1', kind: 'COMMITS', sha: 'a'.repeat(40), title: '提交', authorName: '作者',
        committedAt: null, url: 'u', status: 'ADOPTED', adoptedAt: '2026-10-24T00:00:00Z', adoptedCaptureId: 'cap1', linkedActionId: null };
      expect(adopted.status === 'ADOPTED').assertTrue();
      expect(adopted.adoptedCaptureId).assertEqual('cap1');
    });
    it('connection_revoked_keeps_history', 0, () => {
      const connection: ConnectionView = { id: 'c1', repo: 'owner/repo', ref: 'main', status: 'REVOKED',
        lastFetchedAt: '2026-10-24T00:00:00Z', lastStatus: 'OK', lastError: null, revokedAt: '2026-10-24T01:00:00Z', revokedReason: 'USER_REVOKED',
        candidateCount: 0, adoptedCount: 2 };
      expect(connection.status === 'REVOKED').assertTrue();
      expect(connection.adoptedCount).assertEqual(2);
      expect(connection.candidateCount).assertEqual(0);
    });
    it('action_bodies_carry_request_ids', 0, () => {
      const create: ConnectionCreateBody = new ConnectionCreateBody();
      create.repo = 'Leionel/luojia-math-tutor-skill';
      create.ref = 'main';
      create.requestId = 'req-1';
      expect(create.repo.startsWith('Leionel/')).assertTrue();
      const act: SignalActionBody = new SignalActionBody();
      act.action = 'ADOPT';
      act.requestId = 'req-2';
      expect(act.action === 'ADOPT').assertTrue();
    });
  });
}
