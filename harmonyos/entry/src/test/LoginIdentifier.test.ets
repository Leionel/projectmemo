import { describe, it, expect } from '@ohos/hypium';
import { buildRegisterInput, loginIdentifierError, loginErrorMessage } from '../main/ets/common/AccountContract';

/**
 * Web/HarmonyOS 共用的登录标识合同（客户端侧）：
 * - 登录输入可同时承载用户名与已绑定邮箱，本地只做非空/长度预校验；
 * - 邮箱规范化与唯一性由服务端复用注册/验证/重置同一规则，客户端不引入别名合并；
 * - 未验证邮箱、限流、邮件服务不可用不能统一显示成“密码错误”。
 * 真实登录、限流、session 与项目权限由服务端测试覆盖（tests/loginIdentity.test.ts）。
 */
export default function loginIdentifierTest() {
  describe('loginIdentifier', () => {
    it('accepts_username_or_email_and_rejects_empty_or_overlong_identifier', 0, () => {
      expect(loginIdentifierError('')).assertEqual('请输入用户名或邮箱');
      expect(loginIdentifierError('   ')).assertEqual('请输入用户名或邮箱');
      expect(loginIdentifierError('user-1')).assertEqual('');
      expect(loginIdentifierError(' User.Name@Example.com ')).assertEqual('');
      expect(loginIdentifierError('a'.repeat(254))).assertEqual('');
      expect(loginIdentifierError('a'.repeat(255))).assertEqual('用户名或邮箱过长');
    });
    it('unverified_email_and_mail_unavailable_are_not_password_errors', 0, () => {
      expect(loginErrorMessage('AUTH_FAILED', '账号或密码错误')).assertEqual('账号或密码错误');
      expect(loginErrorMessage('EMAIL_NOT_VERIFIED', '请先验证注册邮箱；未收到邮件可以重新发送')).assertEqual('请先验证注册邮箱；未收到邮件可以重新发送');
      expect(loginErrorMessage('EMAIL_NOT_VERIFIED', '')).assertEqual('请先验证注册邮箱；未收到邮件可以重新发送');
      expect(loginErrorMessage('ACCOUNT_MAIL_UNAVAILABLE', '').indexOf('邮件服务暂时不可用') >= 0).assertTrue();
      expect(loginErrorMessage('LOGIN_RATE_LIMITED', '连续登录失败次数过多，请在 30 秒后再试')).assertEqual('连续登录失败次数过多，请在 30 秒后再试');
      expect(loginErrorMessage('LOGIN_RATE_LIMITED', '').indexOf('连续登录失败次数过多') >= 0).assertTrue();
    });
    it('keeps_server_message_for_unknown_errors_and_network_failure_generic', 0, () => {
      expect(loginErrorMessage('VALIDATION_ERROR', '请输入有效邮箱地址')).assertEqual('请输入有效邮箱地址');
      expect(loginErrorMessage('SOMETHING_NEW', '服务端说明')).assertEqual('服务端说明');
      expect(loginErrorMessage('', '')).assertEqual('请求未完成，请检查网络后重试');
      expect(loginErrorMessage('INVALID_LOGIN_RESPONSE', '登录未完成，请稍后重试')).assertEqual('登录未完成，请稍后重试');
    });
    it('registration_contract_still_lowercases_username_and_email', 0, () => {
      const input = buildRegisterInput(' User_1 ', ' User@Example.COM ', 'long-enough-password', 'long-enough-password');
      expect(input.username).assertEqual('user_1');
      expect(input.email).assertEqual('user@example.com');
    });
  });
}
