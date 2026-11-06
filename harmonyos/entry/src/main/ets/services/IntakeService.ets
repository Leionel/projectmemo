import http from '@ohos.net.http';
import { ApiClient } from './ApiClient';
import { Constants } from '../common/Constants';
import { isSuccessCode, parseApiError } from '../common/ApiContract';
import { ApiError } from '../models/Project';
import { SessionStore } from './SessionStore';
import {
  IntakeAcceptedFields, IntakeConfirmPayload, IntakeConfirmReply, IntakeConsentReply, IntakeCreatePayload,
  IntakeDraftCreated, IntakeMaterialAdded, IntakeMaterialTextReply, IntakeReadReply, IntakeRevisePayload, IntakeReviseReply,
  IntakeSyncReply, IntakeTextPayload, IntakeUnderstandPayload
} from '../models/ProjectIntake';

/**
 * 项目前材料草稿的手机入口。
 *
 * 只调用原后端 `/api/intake*`：确认仍由服务端重算材料 hash、预览 hash 与修订，
 * 手机端禁用按钮不构成凭据。请求身份稳定：同一草稿的同一动作重试不会重建对象。
 */
export class IntakeService {
  private client: ApiClient = new ApiClient();

  async createDraft(requestId: string): Promise<IntakeDraftCreated> {
    const payload = new IntakeCreatePayload();
    payload.requestId = requestId;
    return this.client.post<IntakeDraftCreated>('/api/intake', payload);
  }

  async read(draftId: string): Promise<IntakeReadReply> {
    return this.client.get<IntakeReadReply>(`/api/intake/${encodeURIComponent(draftId)}`);
  }

  /** 原文核对：按页读取草稿正文；确认后由项目内深读承接。 */
  async materialText(draftId: string, materialId: string, offset: number): Promise<IntakeMaterialTextReply> {
    return this.client.get<IntakeMaterialTextReply>(
      `/api/intake/${encodeURIComponent(draftId)}/materials/${encodeURIComponent(materialId)}?offset=${offset}&limit=4000`);
  }

  async addText(draftId: string, requestId: string, text: string): Promise<IntakeMaterialAdded> {
    const payload = new IntakeTextPayload();
    payload.requestId = requestId;
    payload.text = text;
    return this.client.post<IntakeMaterialAdded>(`/api/intake/${encodeURIComponent(draftId)}/materials`, payload);
  }

  /** 图片识别在请求内完成，读超时留足；同一 requestId 重试复用原材料。 */
  async addFile(draftId: string, requestId: string, localPath: string, fileName: string, mimeType: string): Promise<IntakeMaterialAdded> {
    const request = http.createHttp();
    try {
      // 系统 http 只有在声明 multipart 时才发送 multiFormDataList；boundary 由系统补上。
      const headers: Record<string, string> = { 'Content-Type': 'multipart/form-data' };
      const token = SessionStore.getToken();
      if (token !== '') headers['Authorization'] = `Bearer ${token}`;
      const response = await request.request(`${Constants.requireBaseUrl()}/api/intake/${encodeURIComponent(draftId)}/materials/file`, {
        method: http.RequestMethod.POST, header: headers,
        multiFormDataList: [
          { name: 'requestId', contentType: 'text/plain', data: requestId },
          { name: 'file', contentType: mimeType, remoteFileName: fileName, filePath: localPath }
        ],
        expectDataType: http.HttpDataType.STRING, connectTimeout: 15000, readTimeout: 120000
      });
      const body = response.result as string;
      if (isSuccessCode('POST', response.responseCode)) return JSON.parse(body) as IntakeMaterialAdded;
      if (response.responseCode === 401) { SessionStore.handleSessionExpired(); throw new ApiError('UNAUTHORIZED', '登录状态已失效，请重新登录', 401); }
      throw parseApiError(body, response.responseCode);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('ATTACHMENT_UPLOAD_FAILED', '文件上传失败，请检查网络或文件格式');
    } finally {
      request.destroy();
    }
  }

  async consent(draftId: string): Promise<boolean> {
    const reply = await this.client.post<IntakeConsentReply>(`/api/intake/${encodeURIComponent(draftId)}/consent`, undefined);
    return reply.consent;
  }

  async understand(draftId: string, requestId: string): Promise<IntakeReadReply> {
    const payload = new IntakeUnderstandPayload();
    payload.requestId = requestId;
    return this.client.post<IntakeReadReply>(`/api/intake/${encodeURIComponent(draftId)}/understand`, payload, 60000);
  }

  async revise(draftId: string, requestId: string, text: string, expectedRevision: number): Promise<IntakeReviseReply> {
    const payload = new IntakeRevisePayload();
    payload.requestId = requestId;
    payload.text = text;
    payload.expectedRevision = expectedRevision;
    return this.client.post<IntakeReviseReply>(`/api/intake/${encodeURIComponent(draftId)}/revise`, payload);
  }

  async confirm(draftId: string, requestId: string, expectedRevision: number, previewHash: string,
    accepted: IntakeAcceptedFields): Promise<IntakeConfirmReply> {
    const payload = new IntakeConfirmPayload();
    payload.requestId = requestId;
    payload.expectedRevision = expectedRevision;
    payload.previewHash = previewHash;
    payload.accepted = accepted;
    return this.client.post<IntakeConfirmReply>(`/api/intake/${encodeURIComponent(draftId)}/confirm`, payload, 45000);
  }

  async sync(draftId: string): Promise<IntakeSyncReply> {
    return this.client.post<IntakeSyncReply>(`/api/intake/${encodeURIComponent(draftId)}/sync`, undefined, 60000);
  }

  async withdraw(draftId: string): Promise<void> {
    await this.client.delete<IntakeConsentReply>(`/api/intake/${encodeURIComponent(draftId)}`);
  }
}

