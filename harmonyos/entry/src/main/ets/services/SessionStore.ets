import preferences from '@ohos.data.preferences';
import { common } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { UserInfo } from '../models/Auth';

const TAG = 'SessionStore';
const DOMAIN = 0x0000;
const PREFS_NAME = 'projectmemo_auth_store';
const KEY_TOKEN = 'access_token';
const KEY_EXPIRES_AT = 'expires_at';
const KEY_USER_INFO = 'user_info';

type ExpiredCallback = () => void;

export class SessionStore {
  private static appContext: common.Context | undefined = undefined;
  private static cachedToken: string = '';
  private static cachedExpiresAt: string = '';
  private static cachedUser: UserInfo = new UserInfo();
  private static isHandlingExpired: boolean = false;
  private static expiredListeners: ExpiredCallback[] = [];

  static setContext(context: common.Context): void {
    SessionStore.appContext = context;
  }

  /**
   * 应用启动时从 Preferences 恢复持久化会话。
   * 返回 true 表示存在有效未过期的会话；返回 false 表示无会话或已过期。
   */
  static async restoreSession(context?: common.Context): Promise<boolean> {
    if (context !== undefined) {
      SessionStore.appContext = context;
    }
    const ctx = SessionStore.appContext;
    if (ctx === undefined) {
      // 无法获取上下文时依赖内存缓存
      return SessionStore.isTokenValid();
    }

    try {
      const store: preferences.Preferences = await preferences.getPreferences(ctx, PREFS_NAME);
      const tokenVal: preferences.ValueType = await store.get(KEY_TOKEN, '');
      const expiresVal: preferences.ValueType = await store.get(KEY_EXPIRES_AT, '');
      const userVal: preferences.ValueType = await store.get(KEY_USER_INFO, '');

      if (typeof tokenVal === 'string' && tokenVal.trim().length > 0) {
        SessionStore.cachedToken = tokenVal.trim();
      } else {
        SessionStore.cachedToken = '';
      }

      if (typeof expiresVal === 'string') {
        SessionStore.cachedExpiresAt = expiresVal.trim();
      }

      if (typeof userVal === 'string' && userVal.trim().length > 0) {
        try {
          const parsed = JSON.parse(userVal) as UserInfo;
          SessionStore.cachedUser = parsed;
        } catch {
          SessionStore.cachedUser = new UserInfo();
        }
      }

      const valid = SessionStore.isTokenValid();
      if (!valid && SessionStore.cachedToken !== '') {
        // 已过期，清理本地废弃会话
        await SessionStore.clearSession();
        return false;
      }

      return valid;
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to restore session from preferences: %{public}s', JSON.stringify(err));
      return SessionStore.isTokenValid();
    }
  }

  /**
   * 保存登录成功的会话凭证。
   */
  static async saveSession(token: string, expiresAt: string, user: UserInfo): Promise<void> {
    SessionStore.cachedToken = token.trim();
    SessionStore.cachedExpiresAt = expiresAt.trim();
    SessionStore.cachedUser = user;
    SessionStore.isHandlingExpired = false;

    const ctx = SessionStore.appContext;
    if (ctx === undefined) {
      return;
    }

    try {
      const store: preferences.Preferences = await preferences.getPreferences(ctx, PREFS_NAME);
      await store.put(KEY_TOKEN, SessionStore.cachedToken);
      await store.put(KEY_EXPIRES_AT, SessionStore.cachedExpiresAt);
      await store.put(KEY_USER_INFO, JSON.stringify(SessionStore.cachedUser));
      await store.flush();
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to save session to preferences: %{public}s', JSON.stringify(err));
    }
  }

  /**
   * 清除会话（退出登录或会话失效）。
   */
  static async clearSession(): Promise<void> {
    SessionStore.cachedToken = '';
    SessionStore.cachedExpiresAt = '';
    SessionStore.cachedUser = new UserInfo();

    const ctx = SessionStore.appContext;
    if (ctx === undefined) {
      return;
    }

    try {
      const store: preferences.Preferences = await preferences.getPreferences(ctx, PREFS_NAME);
      await store.delete(KEY_TOKEN);
      await store.delete(KEY_EXPIRES_AT);
      await store.delete(KEY_USER_INFO);
      await store.flush();
    } catch (err) {
      hilog.error(DOMAIN, TAG, 'Failed to clear session from preferences: %{public}s', JSON.stringify(err));
    }
  }

  static getToken(): string {
    return SessionStore.cachedToken;
  }

  static getExpiresAt(): string {
    return SessionStore.cachedExpiresAt;
  }

  static getUser(): UserInfo {
    return SessionStore.cachedUser;
  }

  /**
   * 判断 Token 是否存在且在有效期内。
   */
  static isTokenValid(): boolean {
    if (SessionStore.cachedToken === '' || SessionStore.cachedToken.length === 0) {
      return false;
    }
    if (SessionStore.cachedExpiresAt === '' || SessionStore.cachedExpiresAt.length === 0) {
      return true;
    }

    const exp = Date.parse(SessionStore.cachedExpiresAt);
    if (Number.isNaN(exp)) {
      return true;
    }

    return Date.now() < exp;
  }

  /**
   * 注册 401 会话失效监听器。
   */
  static onSessionExpired(listener: ExpiredCallback): void {
    SessionStore.expiredListeners.push(listener);
  }

  /**
   * 移除监听器。
   */
  static offSessionExpired(listener: ExpiredCallback): void {
    const idx = SessionStore.expiredListeners.indexOf(listener);
    if (idx !== -1) {
      SessionStore.expiredListeners.splice(idx, 1);
    }
  }

  /**
   * 触发会话失效：仅执行单次广播，清理会话并通知 UI 跳转。
   */
  static handleSessionExpired(): void {
    if (SessionStore.isHandlingExpired) {
      return;
    }
    SessionStore.isHandlingExpired = true;

    // 清空当前凭证
    void SessionStore.clearSession();

    // 通知所有观察者（如 Index 切换为未登录）
    for (let i = 0; i < SessionStore.expiredListeners.length; i++) {
      try {
        SessionStore.expiredListeners[i]();
      } catch (err) {
        hilog.error(DOMAIN, TAG, 'Error executing expired listener: %{public}s', JSON.stringify(err));
      }
    }
  }
}
