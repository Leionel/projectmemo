import http from '@ohos.net.http';
import { Constants } from '../common/Constants';
import { ApiError } from '../models/Project';

export class ApiClient {
  private baseUrl: string = Constants.BASE_URL;

  private parseApiError(errBody: string, statusCode: number): ApiError {
    let code: string = 'HTTP_ERROR';
    let message: string = `HTTP ${statusCode}`;
    try {
      const parsed: Record<string, Object> = JSON.parse(errBody) as Record<string, Object>;
      const errorObj: Record<string, string> = parsed['error'] as Record<string, string>;
      code = errorObj['code'] ?? 'HTTP_ERROR';
      message = errorObj['message'] ?? message;
    } catch (_e) {
      // ignore parse failure
    }
    return new ApiError(code, message);
  }

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
      if (response.responseCode === 200) {
        const result: string = response.result as string;
        return JSON.parse(result) as T;
      } else {
        const errBody: string = response.result as string;
        throw this.parseApiError(errBody, response.responseCode);
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
      if (response.responseCode === 200 || response.responseCode === 201) {
        const result: string = response.result as string;
        return JSON.parse(result) as T;
      } else {
        const errBody: string = response.result as string;
        throw this.parseApiError(errBody, response.responseCode);
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
