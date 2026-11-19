import http from '@ohos.net.http';
import { ApiClient } from './ApiClient';
import { ApiError } from '../models/Project';
import { SessionStore } from './SessionStore';
import { Constants } from '../common/Constants';
import { isSuccessCode, parseApiError } from '../common/ApiContract';
import { NativeMaterialExtract, NativeMaterialPreview, NativeMaterialPreviewBody } from '../models/NativeMaterial';

/** Native-only material transport; kept out of MissionService so contract tests do not load network kits. */
export class NativeMaterialService {
  private client: ApiClient = new ApiClient();
  private path(missionId: string): string { return `/api/missions/${encodeURIComponent(missionId)}`; }

  async preview(missionId: string, name: string, text: string): Promise<NativeMaterialPreview> {
    if (!SessionStore.isTokenValid()) { SessionStore.handleSessionExpired(); throw new ApiError('UNAUTHORIZED', '请先登录，再补材料', 401); }
    const body = new NativeMaterialPreviewBody(); body.name = name; body.text = text;
    return this.client.post<NativeMaterialPreview>(this.path(missionId) + '/materials/preview', body);
  }

  async extract(projectId: string, localPath: string, fileName: string, mimeType: string): Promise<NativeMaterialExtract> {
    const request = http.createHttp();
    try {
      const headers: Record<string, string> = { 'Content-Type': 'multipart/form-data' };
      const token = SessionStore.getToken();
      if (token !== '') headers['Authorization'] = `Bearer ${token}`;
      const response = await request.request(`${Constants.requireBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/material-extract`, {
        method: http.RequestMethod.POST, header: headers,
        multiFormDataList: [{ name: 'file', contentType: mimeType, remoteFileName: fileName, filePath: localPath }],
        expectDataType: http.HttpDataType.STRING, connectTimeout: 15000, readTimeout: 30000
      });
      const body = response.result as string;
      if (isSuccessCode('POST', response.responseCode)) return JSON.parse(body) as NativeMaterialExtract;
      if (response.responseCode === 401) { SessionStore.handleSessionExpired(); throw new ApiError('UNAUTHORIZED', '登录状态已失效，请重新登录', 401); }
      throw parseApiError(body, response.responseCode);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('MATERIAL_EXTRACT_FAILED', '文件解析失败，请检查格式或网络后重试');
    } finally { request.destroy(); }
  }
}
