import { describe, it, expect } from '@ohos/hypium';
import { PersonalMemoryService } from '../main/ets/services/PersonalMemoryService';
import { missionSourceTarget } from '../main/ets/common/MissionSourceNavigation';

export default function missionRecoveryRegressionTest() {
  describe('MissionRecoveryRegression', () => {
    it('personal_memory_list_maps_nested_conditions_before_rendering', 0, () => {
      const raw = JSON.parse('{"items":[{"claimId":"claim-1","statement":"喜欢先做实验","conditions":{"topics":["科研"],"expiresAt":"2027-01-01"}}],"policy":{"useInContextEnabled":true}}') as Record<string, object>;
      const list = PersonalMemoryService.parseList(raw);
      expect(list.items.length).assertEqual(1);
      expect(list.items[0].topics.length).assertEqual(1);
      expect(list.items[0].topics[0]).assertEqual('科研');
      expect(list.items[0].expiresAt).assertEqual('2027-01-01');
      expect(list.policy?.useInContextEnabled).assertTrue();
    });
    it('missing_or_null_conditions_render_as_empty_topics', 0, () => {
      const raw = JSON.parse('{"items":[{"claimId":"old"},{"claimId":"deleted","conditions":null},{"conditions":{"topics":["竞赛",9,null]}}]}') as Record<string, object>;
      const list = PersonalMemoryService.parseList(raw);
      expect(list.items[0].topics.length).assertEqual(0);
      expect(list.items[1].topics.length).assertEqual(0);
      expect(list.items[2].topics.join('、')).assertEqual('竞赛');
      expect(PersonalMemoryService.parseList(JSON.parse('{}') as Record<string, object>).items.length).assertEqual(0);
    });
    it('draft_project_card_and_action_links_locate_original_objects', 0, () => {
      const project = missionSourceTarget('p1', 'm1', 'project:p1');
      const card = missionSourceTarget('p1', 'm1', 'card:card1');
      const action = missionSourceTarget('p1', 'm1', 'action:action1');
      expect(project?.url).assertEqual('pages/ProjectHome');
      expect(card?.params['projectId']).assertEqual('p1');
      expect(card?.params['tab']).assertEqual('memory');
      expect(card?.params['cardId']).assertEqual('card1');
      expect(action?.params['tab']).assertEqual('actions');
      expect(action?.params['actionId']).assertEqual('action1');
      expect(missionSourceTarget('p1', 'm1', 'project:other') === null).assertTrue();
      expect(missionSourceTarget('p1', 'm1', 'card:') === null).assertTrue();
    });
    it('draft_material_links_keep_source_specific_readers', 0, () => {
      expect(missionSourceTarget('p1', 'm1', 'capture:c1')?.params['captureId']).assertEqual('c1');
      expect(missionSourceTarget('p1', 'm1', 'attachment:a1')?.url).assertEqual('pages/AttachmentViewer');
      expect(missionSourceTarget('p1', 'm1', 'doc:d1')?.params['sourceId']).assertEqual('doc:d1');
      expect(missionSourceTarget('p1', 'm1', 'artifact:a2')?.params['artifactId']).assertEqual('a2');
      expect(missionSourceTarget('p1', '', 'doc:d1') === null).assertTrue();
    });
  });
}
