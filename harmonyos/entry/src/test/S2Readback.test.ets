import { describe, it, expect } from '@ohos/hypium';
import { MissionReadbackReply } from '../main/ets/models/MissionReadback';

export default function s2ReadbackContractTest() {
  describe('s2ReadbackContract', () => {
    it('server_classes_field_is_consumed_without_a_parallel_alias', 0, () => {
      const reply = JSON.parse('{"readback":{"reviewProgress":{"schemaVersion":1,"classes":[{"key":"userReported","label":"用户报告","count":1,"note":"用户复盘"}]}}}') as MissionReadbackReply;
      expect(reply.readback.reviewProgress!.classes.length).assertEqual(1);
      expect(reply.readback.reviewProgress!.classes[0].key).assertEqual('userReported');
    });
    it('known_tokens_do_not_become_a_known_price', 0, () => {
      const reply = JSON.parse('{"readback":{"resourceUsage":{"models":2,"inputTokens":120,"unknownCalls":1,"monetaryCost":null,"pricingState":"UNPRICED"}}}') as MissionReadbackReply;
      expect(reply.readback.resourceUsage!.inputTokens).assertEqual(120);
      expect(reply.readback.resourceUsage!.unknownCalls).assertEqual(1);
      expect(reply.readback.resourceUsage!.monetaryCost === null).assertTrue();
      expect(reply.readback.resourceUsage!.pricingState).assertEqual('UNPRICED');
    });
    it('old_backend_without_usage_remains_readable', 0, () => {
      const reply = JSON.parse('{"readback":{"missionId":"original-mission"}}') as MissionReadbackReply;
      expect(reply.readback.missionId).assertEqual('original-mission');
      expect(reply.readback.resourceUsage === undefined).assertTrue();
    });
  });
}
