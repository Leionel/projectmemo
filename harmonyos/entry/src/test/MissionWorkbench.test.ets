import { describe, it, expect } from '@ohos/hypium';
import { MissionWorkbench, OutcomeChallenge, OutcomeChallengeCommand, WorkbenchMaterial, workbenchOutput, workbenchSource, challengeQuestion } from '../main/ets/models/MissionWorkbench';

export default function missionWorkbenchTest() {
  describe('MissionWorkbench', () => {
    it('selects_exact_revision_and_falls_back_to_latest', 0, () => {
      const view = JSON.parse('{"outputs":[{"id":"new","revision":2},{"id":"old","revision":1}]}') as MissionWorkbench;
      expect(workbenchOutput(view, 'old')?.revision).assertEqual(1);
      expect(workbenchOutput(view, 'deleted')?.id).assertEqual('new');
    });
    it('source_binding_requires_id_and_frozen_hash', 0, () => {
      const view = JSON.parse('{"sources":[{"key":"capture:a@old","id":"capture:a","hash":"old"},{"key":"capture:a@new","id":"capture:a","hash":"new"}]}') as MissionWorkbench;
      expect(workbenchSource(view, 'capture:a@old')?.hash).assertEqual('old');
      expect(workbenchSource(view, 'capture:a@new')?.hash).assertEqual('new');
      expect(workbenchSource(view, 'capture:a') === undefined).assertTrue();
    });
    it('stale_and_stopped_challenges_have_no_answerable_question', 0, () => {
      const s = JSON.parse('{"status":"STALE","questions":[{"key":"hidden"}],"answers":[]}') as OutcomeChallenge;
      expect(challengeQuestion(s) === undefined).assertTrue();
      s.status = 'STOPPED'; expect(challengeQuestion(s) === undefined).assertTrue();
    });
    it('rehearsal_continues_same_session_at_next_round', 0, () => {
      const s = JSON.parse('{"id":"same","status":"ACTIVE","questions":[{"key":"evidence"},{"key":"unknown"}],"answers":[{"questionKey":"evidence"}]}') as OutcomeChallenge;
      expect(challengeQuestion(s)?.key).assertEqual('unknown');
      expect(s.id).assertEqual('same');
    });
    it('optional_challenge_fields_do_not_expand_wire_commands', 0, () => {
      const body = new OutcomeChallengeCommand(); body.requestId = 'retry-id'; body.action = 'HANDOFF';
      expect(JSON.stringify(body)).assertEqual('{"requestId":"retry-id","action":"HANDOFF"}');
      const material = new WorkbenchMaterial(); material.requestId = 'original'; material.text = '反馈仍待核对';
      expect(material.kind).assertEqual('FEEDBACK');
    });
  });
}
