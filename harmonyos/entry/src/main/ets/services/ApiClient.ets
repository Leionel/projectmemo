import http from '@ohos.net.http';
import { Constants } from '../common/Constants';
import { ApiError } from '../models/Project';
import { isSuccessCode, isNoContent, parseApiError } from '../common/ApiContract';
import { SessionStore } from './SessionStore';

export class ApiClient {
  private baseUrl: string = Constants.requireBaseUrl();

  private buildHeaders(path: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // 登录接口本身不附带旧 Token
    if (!path.startsWith('/api/auth/login')) {
      const token = SessionStore.getToken();
      if (token !== '' && token.length > 0) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  }

  private handleResponseError(path: string, responseCode: number, resultStr: string): never {
    if (responseCode === 401) {
      if (!path.startsWith('/api/auth/login')) {
        SessionStore.handleSessionExpired();
        throw new ApiError('UNAUTHORIZED', '登录状态已失效，请重新登录', 401);
      } else {
        throw new ApiError('AUTH_FAILED', '账号或密码错误', 401);
      }
    }
    if (responseCode === 403) {
      throw new ApiError('FORBIDDEN', '无权访问该项目或操作受限', 403);
    }
    if (responseCode === 429) {
      throw new ApiError('RATE_LIMITED', '操作过于频繁，请稍后再试', 429);
    }
    if (responseCode >= 500) {
      throw new ApiError('SERVER_ERROR', '服务端异常，请稍后重试', responseCode);
    }
    throw parseApiError(resultStr, responseCode);
  }

  async get<T>(path: string): Promise<T> {
    const httpRequest = http.createHttp();
    try {
      const response: http.HttpResponse = await httpRequest.request(
        `${this.baseUrl}${path}`,
        {
          method: http.RequestMethod.GET,
          header: this.buildHeaders(path),
          expectDataType: http.HttpDataType.STRING,
          connectTimeout: 10000,
          readTimeout: 30000,
        }
      );
      if (isSuccessCode('GET', response.responseCode)) {
        const result: string = response.result as string;
        return JSON.parse(result) as T;
      } else {
        const errBody: string = response.result as string;
        this.handleResponseError(path, response.responseCode, errBody);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      const errMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : '');
      if (errMsg.toLowerCase().includes('timeout') || errMsg.includes('timed out')) {
        throw new ApiError('REQUEST_TIMEOUT', '请求处理超时，请刷新查看是否已完成或重试', 408);
      }
      throw new ApiError('NETWORK_ERROR', '网络连接失败，请检查网络设置');
    } finally {
      httpRequest.destroy();
    }
  }

  async post<T>(path: string, body: Object | undefined): Promise<T> {
    const httpRequest = http.createHttp();
    try {
      const options: http.HttpRequestOptions = {
        method: http.RequestMethod.POST,
        header: this.buildHeaders(path),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 30000,
      };
      if (body !== undefined) {
        options.extraData = JSON.stringify(body);
      }
      const response: http.HttpResponse = await httpRequest.request(
        `${this.baseUrl}${path}`,
        options
      );
      if (isSuccessCode('POST', response.responseCode)) {
        const result: string = response.result as string;
        return JSON.parse(result) as T;
      } else {
        const errBody: string = response.result as string;
        this.handleResponseError(path, response.responseCode, errBody);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      const errMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : '');
      if (errMsg.toLowerCase().includes('timeout') || errMsg.includes('timed out')) {
        throw new ApiError('REQUEST_TIMEOUT', '请求处理超时，请刷新查看是否已完成或重试', 408);
      }
      throw new ApiError('NETWORK_ERROR', '网络连接失败，请检查网络设置');
    } finally {
      httpRequest.destroy();
    }
  }

  async patch<T>(path: string, body: Object | undefined): Promise<T> {
    const httpRequest = http.createHttp();
    try {
      const options: http.HttpRequestOptions = {
        customMethod: 'PATCH',
        header: this.buildHeaders(path),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 30000,
      };
      if (body !== undefined) {
        options.extraData = JSON.stringify(body);
      }
      const response: http.HttpResponse = await httpRequest.request(
        `${this.baseUrl}${path}`,
        options
      );
      if (isSuccessCode('PATCH', response.responseCode)) {
        const result: string = response.result as string;
        return JSON.parse(result) as T;
      } else if (isNoContent(response.responseCode)) {
        return undefined as T;
      } else {
        const errBody: string = response.result as string;
        this.handleResponseError(path, response.responseCode, errBody);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      const errMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : '');
      if (errMsg.toLowerCase().includes('timeout') || errMsg.includes('timed out')) {
        throw new ApiError('REQUEST_TIMEOUT', '请求处理超时，请刷新查看是否已完成或重试', 408);
      }
      throw new ApiError('NETWORK_ERROR', '网络连接失败，请检查网络设置');
    } finally {
      httpRequest.destroy();
    }
  }
}
