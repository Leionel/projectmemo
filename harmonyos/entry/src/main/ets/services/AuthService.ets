import { ApiClient } from './ApiClient';
import { LoginInput, LoginResponse, MeResponse } from '../models/Auth';
import { SessionStore } from './SessionStore';

export class AuthService {
  private client: ApiClient = new ApiClient();

  /**
   * 提交用户名与密码进行身份认证。
   * 成功后自动将 Token、有效期及用户信息写入 SessionStore。
   */
  async login(input: LoginInput): Promise<LoginResponse> {
    const response = await this.client.post<LoginResponse>('/api/auth/login', input);
    if (response !== undefined && response.accessToken !== '' && response.user !== undefined) {
      await SessionStore.saveSession(response.accessToken, response.expiresAt, response.user);
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
}
