import { ApiClient } from './ApiClient';
import { Attachment } from '../models/Attachment';
import { AttachmentRevisionsResponse } from '../models/Artifact';
import http from '@ohos.net.http';
import { Constants } from '../common/Constants';
import { ApiError } from '../models/Project';
import { isSuccessCode, parseApiError } from '../common/ApiContract';
import { SessionStore } from './SessionStore';
import { attachmentFilePath } from '../common/AttachmentPresentation';

export class AttachmentUploadResult {
  attachment: Attachment = new Attachment();
  isDuplicate: boolean = false;
}
export class AttachmentService {
  private client: ApiClient = new ApiClient();

  async list(projectId: string): Promise<Attachment[]> {
    return this.client.get<Attachment[]>(`/api/projects/${projectId}/attachments`);
  }

  // 原件与 JSON 接口使用同一会话，不将凭据拼入可分享的 URL。
  async original(projectId: string, attachmentId: string): Promise<ArrayBuffer> {
    const token = SessionStore.getToken();
    if (token === '') throw new ApiError('UNAUTHORIZED', '请重新登录后查看附件', 401);
    const request = http.createHttp();
    try {
      const response = await request.request(`${Constants.requireBaseUrl()}${attachmentFilePath(projectId, attachmentId)}`, {
        method: http.RequestMethod.GET,
        header: { 'Authorization': `Bearer ${token}` },
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        usingCache: false,
        maxLimit: 21 * 1024 * 1024,
        connectTimeout: 15000,
        readTimeout: 30000
      });
      if (SessionStore.getToken() !== token) throw new ApiError('SESSION_CHANGED', '登录状态已变化，请重新打开附件');
      if (response.responseCode === 401) {
        SessionStore.handleSessionExpired();
        throw new ApiError('UNAUTHORIZED', '登录状态已失效，请重新登录', 401);
      }
      if (response.responseCode === 403) throw new ApiError('FORBIDDEN', '当前账号无权查看这份附件', 403);
      if (response.responseCode === 404) throw new ApiError('NOT_FOUND', '附件原件不存在或已无法读取', 404);
      if (response.responseCode !== 200) throw new ApiError('ATTACHMENT_READ_FAILED', '原件读取失败，请稍后重试', response.responseCode);
      const data = response.result as ArrayBuffer;
      if (data.byteLength === 0 || data.byteLength > 20 * 1024 * 1024) throw new ApiError('INVALID_FILE_SIZE', '附件为空或超过可查看的大小（20 MB）');
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('ATTACHMENT_READ_FAILED', '原件读取失败，请检查网络后重试');
    } finally {
      request.destroy();
    }
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

  async correct(projectId: string, attachmentId: string, correctedText: string, expectedCurrentText?: string | null): Promise<AttachmentUploadResult> {
    const payload: Record<string, string | null> = {
      'correctedText': correctedText
    };
    if (expectedCurrentText !== undefined) {
      payload['expectedCurrentText'] = expectedCurrentText;
    }
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
