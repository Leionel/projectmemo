import { describe, it, expect } from '@ohos/hypium';
import {
  MissionWidgetSnapshot, handoffIntentExpired, missionHandoffRoute, visibleMissionWidget,
  widgetAttentionLabel, widgetSnapshotExpiry, widgetSyncLabel, widgetTimeText
} from '../main/ets/common/MissionWidgetContract';

// D2 纯函数回归：入口原对象身份接续、卡片 TTL/会话取较早值、观察/同步时间分离、
// 停止在途/UNKNOWN/取消等状态不被写成“已停止/已完成”。不依赖设备与后端。
export default function widgetHandoffTest() {
  describe('widgetHandoff', () => {
    it('valid_handoff_keeps_exact_question_and_approval_identity', 0, () => {
      const route = missionHandoffRoute('project-1', 'mission-1', 'question-1', 'approval-1',
        'source-1', 'output-1', 'receipt-1', '7', '60000', 1000);
      expect(route.projectId).assertEqual('project-1');
      expect(route.missionId).assertEqual('mission-1');
      expect(route.questionId).assertEqual('question-1');
      expect(route.approvalId).assertEqual('approval-1');
      expect(route.sourceId).assertEqual('source-1');
      expect(route.outputId).assertEqual('output-1');
      expect(route.receiptId).assertEqual('receipt-1');
      expect(route.missionVersion).assertEqual('7');
      expect(route.expired).assertFalse();
    });
    it('expired_handoff_keeps_mission_identity_but_not_old_question_entry', 0, () => {
      // 等于边界也视为过期：不打开旧问题/旧提案执行入口。
      const route = missionHandoffRoute('project-1', 'mission-1', 'question-1', 'approval-1',
        'source-1', 'output-1', 'receipt-1', '7', '1000', 1000);
      expect(route.expired).assertTrue();
      expect(route.projectId).assertEqual('project-1');
      expect(route.missionId).assertEqual('mission-1');
      expect(route.missionVersion).assertEqual('7');
      expect(route.questionId).assertEqual('');
      expect(route.approvalId).assertEqual('');
      expect(route.sourceId).assertEqual('');
      expect(route.outputId).assertEqual('');
      expect(route.receiptId).assertEqual('');
      const missing = missionHandoffRoute('project-1', 'mission-1', 'q', 'a', 's', 'o', 'r', '7', '', 1000);
      expect(missing.expired).assertTrue();
      expect(missing.questionId).assertEqual('');
    });
    it('card_ttl_and_session_expiry_take_the_earlier_boundary', 0, () => {
      // 5 分钟同步 TTL 与更晚的会话期限 → 取 5 分钟。
      expect(widgetSnapshotExpiry(1000, new Date(1000 + 600000).toISOString())).assertEqual(1000 + 300000);
      // 会话更早到期 → 取会话期限，卡片不能比登录有效期活得更久。
      expect(widgetSnapshotExpiry(1000, new Date(1000 + 90000).toISOString())).assertEqual(1000 + 90000);
      // 会话期限缺失/不可解析 → 不延长缓存（0 表示卡片不可用）。
      expect(widgetSnapshotExpiry(1000, '')).assertEqual(0);
      expect(widgetSnapshotExpiry(1000, 'not-a-time')).assertEqual(0);
    });
    it('stop_request_unknown_and_cancel_are_not_reported_as_finished', 0, () => {
      const snapshot = new MissionWidgetSnapshot();
      snapshot.expiresAt = 999999;
      snapshot.status = 'RUNNING'; snapshot.phase = 'RUNNING'; snapshot.reasonCode = 'STOP_REQUESTED_IN_FLIGHT';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('停止请求待结算，不会继续执行');
      snapshot.reasonCode = ''; snapshot.phase = 'UNKNOWN';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('状态待核对，打开后重新核对');
      snapshot.phase = 'UNAVAILABLE';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('状态暂不可用，打开后重新核对');
      snapshot.phase = ''; snapshot.status = 'CANCELLED';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('已取消，历史结果保留，不能视为成功');
      snapshot.status = 'OBSOLETE';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('依据已变化，未执行');
      snapshot.status = 'SKIPPED';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('已跳过，历史记录保留');
    });
    it('failure_and_success_use_fact_wording_not_optimistic_labels', 0, () => {
      const snapshot = new MissionWidgetSnapshot();
      snapshot.expiresAt = 999999;
      snapshot.status = 'FAILED';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('执行中断，保留原记录');
      snapshot.status = 'SUCCEEDED';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('委托条件已验收，可回看结果');
      snapshot.status = 'WAITING_APPROVAL'; snapshot.reasonCode = 'APPROVAL_EXPIRED';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('原提案已过期，请重新核对');
      snapshot.reasonCode = 'DAILY_BUDGET_WAITING';
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('额度已用完，等待下次检查');
    });
    it('expired_card_is_not_offered_as_current_content', 0, () => {
      const snapshot = new MissionWidgetSnapshot();
      snapshot.ownerId = 'owner-1'; snapshot.projectId = 'project-1'; snapshot.missionId = 'mission-1';
      snapshot.expiresAt = 1000;
      expect(visibleMissionWidget(snapshot, 'owner-1', 'project-1', 1000)).assertFalse();
      expect(widgetAttentionLabel(snapshot, 1000)).assertEqual('缓存已过期，打开后重新核对');
      expect(handoffIntentExpired(1000, 1000)).assertTrue();
    });
    it('observation_time_and_sync_time_never_stand_in_for_each_other', 0, () => {
      const snapshot = new MissionWidgetSnapshot();
      snapshot.updatedAt = '11月3日 14:00';
      expect(widgetSyncLabel(snapshot)).assertEqual('上次同步 11月3日 14:00');
      snapshot.observedAt = '11月3日 09:30';
      expect(widgetSyncLabel(snapshot)).assertEqual('上次观察 11月3日 09:30');
    });
    it('formats_iso_time_but_keeps_unparsable_existing_labels', 0, () => {
      expect(widgetTimeText('')).assertEqual('');
      expect(widgetTimeText('无法解析的时间')).assertEqual('无法解析的时间');
      const formatted = widgetTimeText('2026-11-03T06:30:00.000Z');
      expect(formatted.indexOf('月') > 0).assertTrue();
      expect(formatted.indexOf('日') > 0).assertTrue();
      // 已格式化的展示串再格式化一次仍原样返回，可作为写入幂等保护。
      expect(widgetTimeText(formatted)).assertEqual(formatted);
    });
  });
}
