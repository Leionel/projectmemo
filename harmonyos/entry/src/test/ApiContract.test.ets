import { describe, it, expect } from '@ohos/hypium';
import {
  buildAcceptBody,
  buildSnoozeBody,
  buildDismissBody,
  buildActionCompleteBody,
  buildActionStatusBody,
  buildCaptureBody,
  isSuccessCode,
  isNoContent,
  classifyHttpError,
  parseApiError,
  isValidActionStatus,
  isValidInterventionStatus,
  isValidInterventionTrigger,
  ACTION_STATUSES,
  INTERVENTION_STATUSES
} from '../main/ets/common/ApiContract';

export default function apiContractTest() {
  describe('apiContract', () => {

    // --- 请求体构造 ---
    it('accept_body_defaults', 0, () => {
      const body = buildAcceptBody(0);
      expect(body.status).assertEqual('ACCEPTED');
      expect(body.actionIndex).assertEqual(0);
    });

    it('accept_body_custom_index', 0, () => {
      const body = buildAcceptBody(2);
      expect(body.actionIndex).assertEqual(2);
    });

    it('snooze_body', 0, () => {
      const body = buildSnoozeBody('2026-08-22T09:00:00.000Z');
      expect(body.status).assertEqual('SNOOZED');
      expect(body.snoozedUntil).assertEqual('2026-08-22T09:00:00.000Z');
    });

    it('dismiss_body', 0, () => {
      const body = buildDismissBody('已知晓');
      expect(body.status).assertEqual('DISMISSED');
      expect(body.dismissReason).assertEqual('已知晓');
    });

    it('action_complete_body', 0, () => {
      const body = buildActionCompleteBody('完成了最小对照实验');
      expect(body.status).assertEqual('DONE');
      expect(body.resultText).assertEqual('完成了最小对照实验');
    });

    it('action_status_body', 0, () => {
      const body = buildActionStatusBody('DOING');
      expect(body.status).assertEqual('DOING');
    });

    it('capture_body_default_source', 0, () => {
      const body = buildCaptureBody('今天完成了数据清洗');
      expect(body.rawText).assertEqual('今天完成了数据清洗');
      expect(body.sourceType).assertEqual('manual');
    });

    // --- 请求体可被 JSON 序列化（Backend 期望 application/json） ---
    it('accept_body_serializes', 0, () => {
      const json = JSON.stringify(buildAcceptBody(1));
      expect(json).assertContain('"status":"ACCEPTED"');
      expect(json).assertContain('"actionIndex":1');
    });

    it('capture_body_serializes', 0, () => {
      const json = JSON.stringify(buildCaptureBody('测试记录'));
      expect(json).assertContain('"rawText":"测试记录"');
      expect(json).assertContain('"sourceType":"manual"');
    });

    // --- 成功状态码判定 ---
    it('success_get_200', 0, () => {
      expect(isSuccessCode('GET', 200)).assertTrue();
    });

    it('success_post_201', 0, () => {
      expect(isSuccessCode('POST', 201)).assertTrue();
    });

    it('success_patch_201', 0, () => {
      expect(isSuccessCode('PATCH', 201)).assertTrue();
    });

    it('success_get_rejects_201', 0, () => {
      expect(isSuccessCode('GET', 201)).assertFalse();
    });

    it('success_rejects_error_codes', 0, () => {
      expect(isSuccessCode('GET', 404)).assertFalse();
      expect(isSuccessCode('POST', 422)).assertFalse();
      expect(isSuccessCode('PATCH', 500)).assertFalse();
    });

    // 删除项目成功返回 204 无正文：不能按 JSON 成功解析，必须走 isNoContent。
    it('delete_success_is_no_content', 0, () => {
      expect(isSuccessCode('DELETE', 200)).assertTrue();
      expect(isSuccessCode('DELETE', 204)).assertFalse();
      expect(isNoContent(204)).assertTrue();
    });

    it('delete_404_is_project_not_found', 0, () => {
      // 越权与项目不存在统一 404，客户端不应把它当成"操作成功"或"服务端故障"。
      expect(classifyHttpError(404)).assertEqual('NOT_FOUND');
      expect(isSuccessCode('DELETE', 404)).assertFalse();
    });

    it('no_content_204', 0, () => {
      expect(isNoContent(204)).assertTrue();
      expect(isNoContent(200)).assertFalse();
    });

    // --- 错误映射 ---
    it('parse_api_error_with_code', 0, () => {
      // ArkTS 不允许匿名对象字面量，直接以 JSON 字符串构造后端错误响应
      const body = '{"error":{"code":"PROJECT_NOT_FOUND","message":"项目不存在"}}';
      const err = parseApiError(body, 404);
      expect(err.code).assertEqual('PROJECT_NOT_FOUND');
      expect(err.message).assertEqual('项目不存在');
    });

    it('parse_api_error_backend_validation', 0, () => {
      const body = '{"error":{"code":"INVALID_ACTION_RESULT","message":"请至少填写 5 个字的完成结果"}}';
      const err = parseApiError(body, 400);
      expect(err.code).assertEqual('INVALID_ACTION_RESULT');
    });

    it('parse_api_error_preserves_structured_service_error', 0, () => {
      const body = '{"error":{"code":"PROJECT_STATE_DISABLED","message":"项目状态功能当前已关闭"}}';
      const err = parseApiError(body, 503);
      expect(err.code).assertEqual('PROJECT_STATE_DISABLED');
      expect(err.message).assertEqual('项目状态功能当前已关闭');
    });

    it('parse_api_error_fallback_on_non_json', 0, () => {
      const err = parseApiError('<html>502</html>', 502);
      expect(err.code).assertEqual('HTTP_ERROR');
      expect(err.message).assertEqual('HTTP 502');
    });

    it('parse_api_error_fallback_on_missing_error', 0, () => {
      const err = parseApiError('{"foo":"bar"}', 500);
      expect(err.code).assertEqual('HTTP_ERROR');
      expect(err.message).assertEqual('HTTP 500');
    });

    // --- 状态枚举与后端一致 ---
    it('action_status_enum', 0, () => {
      expect(isValidActionStatus('TODO')).assertTrue();
      expect(isValidActionStatus('DOING')).assertTrue();
      expect(isValidActionStatus('DONE')).assertTrue();
      expect(isValidActionStatus('CANCELLED')).assertTrue();
      expect(isValidActionStatus('INVALID')).assertFalse();
      expect(ACTION_STATUSES.length).assertEqual(4);
    });

    it('intervention_status_enum', 0, () => {
      expect(isValidInterventionStatus('OPEN')).assertTrue();
      expect(isValidInterventionStatus('ACCEPTED')).assertTrue();
      expect(isValidInterventionStatus('SNOOZED')).assertTrue();
      expect(isValidInterventionStatus('DISMISSED')).assertTrue();
      expect(isValidInterventionStatus('RESOLVED')).assertTrue();
      expect(INTERVENTION_STATUSES.length).assertEqual(5);
    });

    it('intervention_trigger_enum', 0, () => {
      expect(isValidInterventionTrigger('DEADLINE_NEAR')).assertTrue();
      expect(isValidInterventionTrigger('RISK_UNHANDLED')).assertTrue();
      expect(isValidInterventionTrigger('PROJECT_STALE')).assertTrue();
      expect(isValidInterventionTrigger('EXPERIMENT_GAP')).assertTrue();
      expect(isValidInterventionTrigger('MATERIAL_GAP')).assertTrue();
      expect(isValidInterventionTrigger('NOT_A_TRIGGER')).assertFalse();
    });
  });
}
