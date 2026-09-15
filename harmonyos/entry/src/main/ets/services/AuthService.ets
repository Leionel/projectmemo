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

  /**
   * 退出登录：通知服务端撤销当前会话，并清除本地持久化凭证。
   */
  async logout(): Promise<void> {
    try {
      await this.client.post<Object>('/api/auth/logout', undefined);
    } catch {
      // 忽略网络错误，确保本地凭证无论如何都被清理
    } finally {
      await SessionStore.clearSession();
    }
  }

  /**
   * 获取当前已认证用户信息及被授权的项目列表。
   */
  async getMe(): Promise<MeResponse> {
    return await this.client.get<MeResponse>('/api/auth/me');
  }
}
