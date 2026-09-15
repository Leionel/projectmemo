import { ApiClient } from './ApiClient';
import { Attachment } from '../models/Attachment';
import { AttachmentRevisionsResponse } from '../models/Artifact';
import http from '@ohos.net.http';
import { Constants } from '../common/Constants';
import { ApiError } from '../models/Project';
import { isSuccessCode, parseApiError } from '../common/ApiContract';
import { SessionStore } from './SessionStore';

export class AttachmentUploadResult {
  attachment: Attachment = new Attachment();
  isDuplicate: boolean = false;
}
export class AttachmentService {
  private client: ApiClient = new ApiClient();

  async list(projectId: string): Promise<Attachment[]> {
    return this.client.get<Attachment[]>(`/api/projects/${projectId}/attachments`);
  }

  async upload(projectId: string, fileUri: string, fileName: string, mimeType: string): Promise<AttachmentUploadResult> {
    const request = http.createHttp();
    try {
      // multipart boundary 由系统生成，只补充会话头，不能设置 JSON Content-Type。
      const headers: Record<string, string> = {};
      const token = SessionStore.getToken();
      if (token !== '') {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const response = await request.request(`${Constants.requireBaseUrl()}/api/projects/${projectId}/attachments`, {
        method: http.RequestMethod.POST,
        header: headers,
        multiFormDataList: [{
          name: 'file',
          contentType: mimeType,
          remoteFileName: fileName,
          filePath: fileUri
        }],
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 30000
      });
      const responseBody = response.result as string;
      if (isSuccessCode('POST', response.responseCode)) {
        return JSON.parse(responseBody) as AttachmentUploadResult;
      }
      if (response.responseCode === 401) {
        SessionStore.handleSessionExpired();
        throw new ApiError('UNAUTHORIZED', '登录状态已失效，请重新登录', 401);
      }
      throw parseApiError(responseBody, response.responseCode);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('ATTACHMENT_UPLOAD_FAILED', '附件上传失败，请检查网络或文件格式');
    } finally {
      request.destroy();
    }
  }

  async retry(projectId: string, attachmentId: string): Promise<AttachmentUploadResult> {
    return this.client.post<AttachmentUploadResult>(
      `/api/projects/${projectId}/attachments/${attachmentId}/retry`,
      undefined
    );
  }

  async correct(projectId: string, attachmentId: string, correctedText: string): Promise<AttachmentUploadResult> {
    const payload: Record<string, string> = {
      'correctedText': correctedText
    };
    return this.client.post<AttachmentUploadResult>(
      `/api/projects/${projectId}/attachments/${attachmentId}/correct`,
      payload
    );
  }
  // 修订链：按 revisionIndex 返回历次提取/人工校对文本
  async revisions(projectId: string, attachmentId: string): Promise<AttachmentRevisionsResponse> {
    return this.client.get<AttachmentRevisionsResponse>(
      `/api/projects/${projectId}/attachments/${attachmentId}/revisions`
    );
  }

}
