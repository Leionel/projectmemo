import http from '@ohos.net.http';
import { ApiClient } from './ApiClient';
import { Constants } from '../common/Constants';
import { ApiError } from '../models/Project';
import { isSuccessCode, parseApiError } from '../common/ApiContract';
import { SessionStore } from './SessionStore';
import { ConversationAttachmentUpload, ConversationAttachmentPromoteInput } from '../models/Conversation';

class DeleteReply { deleted: boolean = false; }
class PromoteReply { isDuplicate: boolean = false; cardId: string | null = null; }

/** “仅用于本次讨论”的附件：上传、移除、转为项目资料；与项目附件同一套会话鉴权与 multipart 上传。 */
export class ConversationAttachmentService {
  private client: ApiClient = new ApiClient();

  async upload(conversationId: string, fileUri: string, fileName: string, mimeType: string, projectId: string): Promise<ConversationAttachmentUpload> {
    const request = http.createHttp();
    try {
      // 系统 http 只有在声明 multipart 时才发送 multiFormDataList；boundary 由系统补上。
      const headers: Record<string, string> = { 'Content-Type': 'multipart/form-data' };
      const token = SessionStore.getToken();
      if (token !== '') { headers['Authorization'] = `Bearer ${token}`; }
      const fields: http.MultiFormData[] = [{ name: 'file', contentType: mimeType, remoteFileName: fileName, filePath: fileUri }];
      if (projectId !== '') { fields.push({ name: 'projectId', contentType: 'text/plain', data: projectId }); }
      const response = await request.request(`${Constants.requireBaseUrl()}/api/conversations/${conversationId}/attachments`, {
        method: http.RequestMethod.POST, header: headers, multiFormDataList: fields,
        expectDataType: http.HttpDataType.STRING, connectTimeout: 15000, readTimeout: 60000
      });
      const body = response.result as string;
      if (isSuccessCode('POST', response.responseCode)) { return JSON.parse(body) as ConversationAttachmentUpload; }
      if (response.responseCode === 401) { SessionStore.handleSessionExpired(); throw new ApiError('UNAUTHORIZED', '登录状态已失效，请重新登录', 401); }
      throw parseApiError(body, response.responseCode);
    } catch (error) {
      if (error instanceof ApiError) { throw error; }
      throw new ApiError('ATTACHMENT_UPLOAD_FAILED', '附件上传失败，请检查网络或文件格式');
    } finally { request.destroy(); }
  }

  async remove(conversationId: string, attachmentId: string): Promise<boolean> {
    return (await this.client.delete<DeleteReply>(`/api/conversations/${conversationId}/attachments/${attachmentId}`)).deleted;
  }

  async promote(conversationId: string, attachmentId: string, projectId: string): Promise<boolean> {
    const input = new ConversationAttachmentPromoteInput(); input.projectId = projectId;
    await this.client.post<PromoteReply>(`/api/conversations/${conversationId}/attachments/${attachmentId}/promote`, input, 60000);
    return true;
  }
}
