import { ApiClient } from './ApiClient';
import { LoginInput, LoginResponse, MeResponse, AccountCapabilities, RegisterInput, RegisterResponse, AccountEmailInput, AccountMessage } from '../models/Auth';
import { ApiError } from '../models/Project';
import { SessionStore } from './SessionStore';

export class AuthService {
  private client: ApiClient = new ApiClient();

  /**
   * 提交用户名与密码进行身份认证。
   * 成功后自动将 Token、有效期及用户信息写入 SessionStore。
   */
  async login(input: LoginInput): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/login', input);
    if (response !== undefined && response.accessToken !== '' && response.expiresAt !== '' && response.user !== undefined && response.user.id !== '') {
      await SessionStore.saveSession(response.accessToken, response.expiresAt, response.user);
    } else {
      throw new ApiError('INVALID_LOGIN_RESPONSE', '登录未完成，请稍后重试', 502);
    }
    return response;
  }

  /** 服务端确认撤销后才清除本地凭证；失败时保留 Token 供用户重试。 */
  async logout(): Promise<void> {
    await this.client.post<Object>('/api/auth/logout', undefined);
    await SessionStore.clearSession();
  }

  /**
   * 获取当前已认证用户信息及被授权的项目列表。
   */
  async getMe(): Promise<MeResponse> {
    return await this.client.get<MeResponse>('/api/auth/me');
  }

  async capabilities(): Promise<AccountCapabilities> {
    return this.client.get<AccountCapabilities>('/api/auth/capabilities');
  }

  /** Registration never creates a local session; email verification comes first. */
  async register(input: RegisterInput): Promise<RegisterResponse> {
    return this.client.post<RegisterResponse>('/api/auth/register', input);
  }

  async resendVerification(input: AccountEmailInput): Promise<AccountMessage> {
    return this.client.post<AccountMessage>('/api/auth/resend-verification', input);
  }

  async requestPasswordReset(input: AccountEmailInput): Promise<AccountMessage> {
    return this.client.post<AccountMessage>('/api/auth/forgot-password', input);
  }
}
