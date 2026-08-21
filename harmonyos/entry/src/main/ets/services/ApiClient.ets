import http from '@ohos.net.http';
import { Constants } from '../common/Constants';
import { ApiError } from '../models/Project';
import { isSuccessCode, isNoContent, parseApiError } from '../common/ApiContract';

export class ApiClient {
  private baseUrl: string = Constants.BASE_URL;

  async get<T>(path: string): Promise<T> {
    const httpRequest = http.createHttp();
    try {
      const response: http.HttpResponse = await httpRequest.request(
        `${this.baseUrl}${path}`,
        {
          method: http.RequestMethod.GET,
          header: {
            'Content-Type': 'application/json',
          },
          expectDataType: http.HttpDataType.STRING,
          connectTimeout: 10000,
          readTimeout: 10000,
        }
      );
      if (isSuccessCode('GET', response.responseCode)) {
        const result: string = response.result as string;
        return JSON.parse(result) as T;
      } else {
        const errBody: string = response.result as string;
        throw parseApiError(errBody, response.responseCode);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
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
        header: {
          'Content-Type': 'application/json',
        },
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 10000,
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
        throw parseApiError(errBody, response.responseCode);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
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
        // RequestMethod 枚举不含 PATCH，使用 customMethod 发送 PATCH 请求
        customMethod: 'PATCH',
        header: {
          'Content-Type': 'application/json',
        },
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000,
        readTimeout: 10000,
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
        // 204 No Content：响应体为空，跳过 JSON.parse，直接返回 undefined
        return undefined as T;
      } else {
        const errBody: string = response.result as string;
        throw parseApiError(errBody, response.responseCode);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        throw e;
      }
      throw new ApiError('NETWORK_ERROR', '网络连接失败，请检查网络设置');
    } finally {
      httpRequest.destroy();
    }
  }
}
