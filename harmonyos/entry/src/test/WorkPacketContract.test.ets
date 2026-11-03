import { describe, it, expect } from '@ohos/hypium';
import {
  ReadbackDeltaView, WorkPacketView,
  authorityLine, basisSummary, blockerLabel, currentUseLabel, doneSummary, materialBodyNote, nextSummary,
  observationLine, parseWorkPacket, readbackDelta, snapshotLine, stopSummary
} from '../main/ets/models/WorkPacket';
import {
  CANCELLED_READBACK, LEGACY_READBACK, OBSERVATION_NO_CHANGE_READBACK, STOP_REQUESTED_READBACK,
  SUPPRESSED_SOURCE_PACKET, UNKNOWN_READBACK, VERSION_ADVANCED_PACKET, WAITING_APPROVAL_READBACK
} from './WorkPacketFixtures';

function readback(json: string): ReadbackDeltaView {
  return readbackDelta(JSON.parse(json) as Object);
}

function packet(json: string): WorkPacketView | null {
  return parseWorkPacket(JSON.parse(json) as Object);
}

/**
 * final-a-workpacket-v1 客户端合同：
 * 真实服务端 JSON → 显式 null / 缺失 / 未知枚举 / 旧后端无 workPacket 必须分开保留；
 * 缺字段不得显示为允许、成功、0 或“记录已删除”。
 */
export default function workPacketContractTest() {
  describe('workPacketContract', () => {
    it('waiting_approval_packet_keeps_single_primary_action_and_blockers', 0, () => {
      const delta = readback(WAITING_APPROVAL_READBACK);
      expect(delta.legacyServer).assertFalse();
      const view = delta.workPacket;
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.contractCompatible).assertTrue();
      expect(view.identity.missionVersion !== null).assertTrue();
      expect(view.next.primaryAction.present).assertTrue();
      expect(view.next.primaryAction.kind).assertEqual('REVIEW_APPROVAL');
      expect(view.next.primaryAction.kindKnown).assertTrue();
      expect(view.next.primaryAction.label).assertEqual('审阅待批准提案');
      expect(view.next.primaryAction.targetPresent).assertTrue();
      expect(view.next.primaryAction.targetKind).assertEqual('APPROVAL');
      expect(view.next.primaryAction.targetId !== '').assertTrue();
      expect(view.next.waitingOnKnown).assertTrue();
      expect(view.next.waitingOn).assertEqual('USER_APPROVAL');
      expect(view.blockers.length).assertEqual(2);
      expect(view.blockers[0].kindKnown).assertTrue();
      expect(view.stopped.terminalPresent).assertFalse();
      expect(view.stopped.unsettledPresent).assertFalse();
      expect(view.stopped.phase).assertEqual('WAITING_APPROVAL');
      expect(view.done.steps.length).assertEqual(1);
      expect(doneSummary(view.done).includes('最近 1 项执行记录')).assertTrue();
      expect(authorityLine(view.authority).includes('不是执行授权')).assertTrue();
      expect(authorityLine(view.authority).includes('心跳不等于成功观察')).assertTrue();
      expect(snapshotLine(view)).assertEqual('快照：同一只读事务内读取');
      expect(nextSummary(view.next).includes('等你审阅提案')).assertTrue();
    });
    it('unknown_effect_and_unknown_phase_are_not_success', 0, () => {
      const delta = readback(UNKNOWN_READBACK);
      const view = delta.workPacket;
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.stopped.phase).assertEqual('UNKNOWN');
      expect(view.stopped.unsettledPresent).assertTrue();
      expect(stopSummary(view.stopped).includes('未结算')).assertTrue();
      expect(stopSummary(view.stopped).includes('原状态待核对')).assertTrue();
      expect(view.next.primaryAction.kind).assertEqual('RECHECK_AUTHORITY');
      let hasUnknownBlock = false;
      for (const blocker of view.blockers) {
        if (blocker.kind === 'UNKNOWN_EFFECT') { hasUnknownBlock = true; }
      }
      expect(hasUnknownBlock).assertTrue();
      expect(observationLine(delta.observation).includes('最近成功观察')).assertFalse();
      expect(observationLine(delta.observation).includes('旧服务未提供观察时间')).assertFalse();
    });
    it('cancelled_terminal_is_not_rendered_as_success', 0, () => {
      const delta = readback(CANCELLED_READBACK);
      const view = delta.workPacket;
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.stopped.phase).assertEqual('COMPLETED');
      expect(view.stopped.terminalPresent).assertTrue();
      expect(view.stopped.terminalStatus).assertEqual('CANCELLED');
      expect(stopSummary(view.stopped).includes('已取消（不是成功）')).assertTrue();
      expect(view.next.primaryAction.kind).assertEqual('VIEW_RESULT');
    });
    it('in_flight_stop_request_stays_unsettled', 0, () => {
      const delta = readback(STOP_REQUESTED_READBACK);
      const view = delta.workPacket;
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.stopped.stopRequestKnown).assertTrue();
      expect(view.stopped.stopStateKnown).assertTrue();
      expect(view.stopped.stopState).assertEqual('PAUSE_REQUESTED');
      expect(view.stopped.stopSettled === false).assertTrue();
      expect(stopSummary(view.stopped).includes('尚未结算')).assertTrue();
      expect(view.next.primaryAction.kind).assertEqual('CHECK_STOP_SETTLEMENT');
    });
    it('read_time_and_successful_observation_are_separate', 0, () => {
      const delta = readback(OBSERVATION_NO_CHANGE_READBACK);
      expect(delta.readAtKnown).assertTrue();
      const view = delta.workPacket;
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.observations.present).assertTrue();
      expect(view.observations.state).assertEqual('OBSERVED');
      expect(view.observations.lastSuccessfulAtKnown).assertTrue();
      expect(view.observations.lastSuccessfulAt !== null).assertTrue();
      expect(view.observations.lastNoNewInformationKnown).assertTrue();
      expect(view.observations.lastNoNewInformationAt !== null).assertTrue();
      expect(delta.readAt !== (view.observations.lastSuccessfulAt ?? '')).assertTrue();
      expect(observationLine(view.observations).includes('最近成功观察')).assertTrue();
      expect(observationLine(view.observations).includes('无新变化')).assertTrue();
    });
    it('legacy_server_without_work_packet_falls_back_and_keeps_readback', 0, () => {
      const delta = readback(LEGACY_READBACK);
      expect(delta.workPacket === null).assertTrue();
      expect(delta.legacyServer).assertTrue();
      expect(delta.materialsPresent).assertTrue();
      expect(delta.observation.present).assertFalse();
      expect(observationLine(delta.observation).includes('旧服务未提供观察时间')).assertTrue();
    });
    it('source_current_use_suppressed_is_not_available_or_independent', 0, () => {
      const view = packet(SUPPRESSED_SOURCE_PACKET);
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.contractCompatible).assertTrue();
      expect(view.materials.present).assertTrue();
      expect(view.materials.items.length).assertEqual(1);
      const item = view.materials.items[0];
      expect(item.currentUse.known).assertTrue();
      expect(item.currentUse.stateKnown).assertTrue();
      expect(item.currentUse.state).assertEqual('SUPPRESSED');
      expect(item.currentUse.independentEvidence).assertFalse();
      expect(currentUseLabel(item).includes('当前不可作为依据')).assertTrue();
      expect(basisSummary(view.materials, false).includes('当前停用 1')).assertTrue();
      expect(basisSummary(view.materials, false).includes('独立支持')).assertFalse();
      expect(view.blockers.length).assertEqual(1);
      expect(blockerLabel(view.blockers[0].kind)).assertEqual('来源');
    });
    it('version_advanced_snapshot_blocks_reusing_old_requires', 0, () => {
      const view = packet(VERSION_ADVANCED_PACKET);
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.snapshotConsistencyKnown).assertTrue();
      expect(view.snapshotConsistency).assertEqual('VERSION_ADVANCED');
      expect(snapshotLine(view).includes('版本已推进')).assertTrue();
      expect(view.next.primaryAction.requiresKnown).assertTrue();
      expect(view.next.primaryAction.requiresMissionVersion !== null).assertTrue();
    });
    it('explicit_null_observation_is_known_none_not_missing', 0, () => {
      const delta = readback('{"observation":{"state":"OBSERVED","lastSuccessfulAt":null}}');
      expect(delta.observation.present).assertTrue();
      expect(delta.observation.lastSuccessfulAtKnown).assertTrue();
      expect(delta.observation.lastSuccessfulAt === null).assertTrue();
      expect(observationLine(delta.observation).includes('服务端未提供最近成功观察时间')).assertTrue();
    });
    it('missing_observation_block_stays_unknown_not_not_observed', 0, () => {
      const delta = readback('{"workPacket":{"schemaVersion":1,"contractVersion":"final-a-workpacket-v1"}}');
      expect(delta.observation.present).assertFalse();
      expect(observationLine(delta.observation).includes('旧服务未提供观察时间')).assertTrue();
      const view = delta.workPacket;
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.contractCompatible).assertTrue();
      expect(view.stopped.phase).assertEqual('');
      expect(view.next.present).assertFalse();
      expect(nextSummary(view.next).includes('旧服务未提供')).assertTrue();
    });
    it('unknown_primary_action_kind_is_not_mapped_to_none_or_success', 0, () => {
      const mutated = WAITING_APPROVAL_READBACK.replace('"REVIEW_APPROVAL"', '"FUTURE_APPROVAL_REVIEW"');
      const delta = readback(mutated);
      const view = delta.workPacket;
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.next.primaryAction.kindKnown).assertFalse();
      expect(view.next.primaryAction.kind).assertEqual('UNKNOWN_ACTION');
      expect(view.next.primaryAction.rawKind).assertEqual('FUTURE_APPROVAL_REVIEW');
      expect(nextSummary(view.next).includes('新的主动作类型')).assertTrue();
    });
    it('future_schema_version_is_not_interpreted', 0, () => {
      const view = packet('{"schemaVersion":2,"contractVersion":"final-a-workpacket-v1"}');
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.contractCompatible).assertFalse();
      expect(view.schemaVersion).assertEqual(2);
    });
    it('unavailable_material_without_excerpt_keeps_history_facts', 0, () => {
      const view = packet('{"schemaVersion":1,"contractVersion":"final-a-workpacket-v1","basis":{"materialUses":{"schemaVersion":1,"questionId":null,"items":[{"sourcePointer":{"id":"capture:abc","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"title":"项目记录","availability":"UNAVAILABLE","facts":[{"kind":"BOUND","refId":"step-1"},{"kind":"OUTPUT_REFERENCE","refId":"output-1","revision":1}],"excerpt":null}],"coverage":{"eventLimit":80,"eventsTruncated":false}}},"next":{"waitingOn":"USER_INPUT","primaryAction":{"kind":"ANSWER_QUESTION","label":"补充资料","target":{"kind":"QUESTION","id":"q-1","version":null}}},"blockers":[]}');
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      expect(view.materials.present).assertTrue();
      const item = view.materials.items[0];
      expect(item.currentUse.known).assertFalse();
      expect(item.excerptKnown).assertTrue();
      expect(item.excerpt === null).assertTrue();
      expect(item.availability).assertEqual('UNAVAILABLE');
      expect(item.facts.length).assertEqual(2);
      expect(currentUseLabel(item).includes('旧服务未提供')).assertTrue();
      expect(materialBodyNote(item).includes('不是记录被删除')).assertTrue();
    });
    it('failed_last_observation_never_reads_as_success', 0, () => {
      const delta = readback('{"observation":{"state":"FAILED_LAST","lastSuccessfulAt":"2026-11-01T08:00:00.000Z","lastFailedAt":"2026-11-02T08:00:00.000Z"}}');
      expect(observationLine(delta.observation).includes('最近观察失败')).assertTrue();
      expect(observationLine(delta.observation).includes('上次成功')).assertTrue();
      expect(observationLine(delta.observation).includes('最近成功观察')).assertFalse();
    });
    it('malformed_work_packet_does_not_crash_or_fabricate', 0, () => {
      const delta = readback('{"workPacket":"not-an-object"}');
      expect(delta.workPacket === null).assertTrue();
      expect(delta.legacyServer).assertTrue();
      const dropped = readback('{"workPacket":null}');
      expect(dropped.workPacket === null).assertTrue();
      expect(dropped.legacyServer).assertTrue();
      expect(blockerLabel('FUTURE_BLOCKER')).assertEqual('其他阻断');
    });
    it('unknown_current_use_state_is_unknown_not_allowed', 0, () => {
      const view = packet('{"schemaVersion":1,"contractVersion":"final-a-workpacket-v1","basis":{"materialUses":{"schemaVersion":1,"items":[{"sourcePointer":{"id":"capture:abc","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"title":"项目记录","availability":"CURRENT","revisionAvailability":"CURRENT","currentUse":{"state":"FUTURE_STATE","independentEvidence":false}}],"coverage":{}}}}');
      expect(view !== null).assertTrue();
      if (view === null) { return; }
      const item = view.materials.items[0];
      expect(item.currentUse.known).assertTrue();
      expect(item.currentUse.stateKnown).assertFalse();
      expect(currentUseLabel(item).includes('当前许可未知')).assertTrue();
      expect(basisSummary(view.materials, false).includes('当前许可未知 1')).assertTrue();
    });
  });
}
