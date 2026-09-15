import { describe, it, expect } from '@ohos/hypium';
import {
  buildLoginBody,
  buildAuthorizationHeader,
  isTokenExpired,
  classifyHttpError,
  parseApiError
} from '../main/ets/common/ApiContract';
import { SessionStore } from '../main/ets/services/SessionStore';
import { UserInfo } from '../main/ets/models/Auth';

export default function authContractTest() {
  describe('authContract', () => {

    // --- 1. 登录请求体契约 ---
    it('login_body_creation', 0, () => {
      const body = buildLoginBody('  contest-demo  ', 'demoPassword123');
      expect(body.username).assertEqual('contest-demo');
      expect(body.password).assertEqual('demoPassword123');
      expect(body.client).assertEqual('harmony');
    });

    // --- 2. Authorization Header 契约 ---
    it('auth_header_format', 0, () => {
      const header = buildAuthorizationHeader('a1b2c3d4e5f67890');
      expect(header).assertEqual('Bearer a1b2c3d4e5f67890');
    });

    it('auth_header_empty_token', 0, () => {
      const headerEmpty = buildAuthorizationHeader('');
      expect(headerEmpty).assertEqual('');
      const headerSpaces = buildAuthorizationHeader('   ');
      expect(headerSpaces).assertEqual('');
    });

    // --- 3. Token 有效期与过期判定 ---
    it('token_expiration_future', 0, () => {
      const future = new Date(Date.now() + 3600 * 1000).toISOString();
      expect(isTokenExpired(future)).assertFalse();
    });

    it('token_expiration_past', 0, () => {
      const past = new Date(Date.now() - 3600 * 1000).toISOString();
      expect(isTokenExpired(past)).assertTrue();
    });

    it('token_expiration_invalid_string', 0, () => {
      expect(isTokenExpired('')).assertFalse();
      expect(isTokenExpired('not-a-date')).assertFalse();
    });

    // --- 4. 状态码分类与错误映射 ---
    it('http_status_classification', 0, () => {
      expect(classifyHttpError(401)).assertEqual('UNAUTHORIZED');
      expect(classifyHttpError(403)).assertEqual('FORBIDDEN');
      expect(classifyHttpError(404)).assertEqual('NOT_FOUND');
      expect(classifyHttpError(408)).assertEqual('REQUEST_TIMEOUT');
      expect(classifyHttpError(429)).assertEqual('RATE_LIMITED');
      expect(classifyHttpError(500)).assertEqual('SERVER_ERROR');
      expect(classifyHttpError(503)).assertEqual('SERVER_ERROR');
    });

    it('auth_error_parsing', 0, () => {
      const errJson = '{"error":{"code":"AUTH_FAILED","message":"账号或密码错误"}}';
      const err = parseApiError(errJson, 401);
      expect(err.code).assertEqual('AUTH_FAILED');
      expect(err.message).assertEqual('账号或密码错误');
      expect(err.status).assertEqual(401);
    });

    // --- 5. SessionStore 状态机与 401 失效通知 ---
    it('session_store_save_and_read', 0, () => {
      const user = new UserInfo();
      user.id = 'user-001';
      user.username = 'contest-demo';
      user.displayName = '复赛演示账号';

      const exp = new Date(Date.now() + 86400 * 1000).toISOString();
      SessionStore.saveSession('token-abc-123', exp, user);

      expect(SessionStore.getToken()).assertEqual('token-abc-123');
      expect(SessionStore.getUser().username).assertEqual('contest-demo');
      expect(SessionStore.isTokenValid()).assertTrue();
    });

    it('session_store_clear', 0, () => {
      SessionStore.clearSession();
      expect(SessionStore.getToken()).assertEqual('');
      expect(SessionStore.isTokenValid()).assertFalse();
    });

    it('session_store_expired_broadcast', 0, () => {
      let expiredCount = 0;
      const callback = () => {
        expiredCount++;
      };

      SessionStore.onSessionExpired(callback);

      // 触发会话失效
      SessionStore.handleSessionExpired();
      expect(expiredCount).assertEqual(1);
      expect(SessionStore.getToken()).assertEqual('');

      // 重复触发应幂等，不无限重复调用
      SessionStore.handleSessionExpired();
      expect(expiredCount).assertEqual(1);

      SessionStore.offSessionExpired(callback);
    });
  });
}
