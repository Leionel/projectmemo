import { ApiClient } from './ApiClient';
import {
  MeetingConfirmBody,
  MeetingConfirmResult,
  MeetingImpactPreview,
  MeetingPreviewInput
} from '../models/Meeting';

// 会议状态变化：预览绑定 proposalId+版本；确认只提交选择集合。
// 超时后应重试同一次确认以取回原执行结果，不新建提案重复写入。
export class MeetingService {
  private client: ApiClient;

  constructor(client?: ApiClient) {
    this.client = client ?? new ApiClient();
  }

  async preview(projectId: string, input: MeetingPreviewInput): Promise<MeetingImpactPreview> {
    return this.client.post<MeetingImpactPreview>(
      `/api/projects/${projectId}/meetings/impact-preview`,
      input
    );
  }

  async confirm(projectId: string, body: MeetingConfirmBody): Promise<MeetingConfirmResult> {
    return this.client.post<MeetingConfirmResult>(
      `/api/projects/${projectId}/meetings/confirm`,
      body
    );
  }
}
