import { ApiClient } from './ApiClient';
import {
  IntakeAcceptedFields, IntakeConfirmPayload, IntakeConfirmReply, IntakeConsentReply, IntakeDraftCreated, IntakeMaterialAdded,
  IntakeReadReply, IntakeReviseReply, IntakeSyncReply
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
    return this.client.post<IntakeDraftCreated>('/api/intake', { requestId: requestId });
  }

  async read(draftId: string): Promise<IntakeReadReply> {
    return this.client.get<IntakeReadReply>(`/api/intake/${encodeURIComponent(draftId)}`);
  }

  async addText(draftId: string, requestId: string, text: string): Promise<IntakeMaterialAdded> {
    return this.client.post<IntakeMaterialAdded>(`/api/intake/${encodeURIComponent(draftId)}/materials`,
      { requestId: requestId, text: text });
  }

  async consent(draftId: string): Promise<boolean> {
    const reply = await this.client.post<IntakeConsentReply>(`/api/intake/${encodeURIComponent(draftId)}/consent`, undefined);
    return reply.consent;
  }

  async understand(draftId: string, requestId: string): Promise<IntakeReadReply> {
    return this.client.post<IntakeReadReply>(`/api/intake/${encodeURIComponent(draftId)}/understand`,
      { requestId: requestId, processingConsent: true }, 60000);
  }

  async revise(draftId: string, requestId: string, text: string, expectedRevision: number): Promise<IntakeReviseReply> {
    return this.client.post<IntakeReviseReply>(`/api/intake/${encodeURIComponent(draftId)}/revise`,
      { requestId: requestId, text: text, expectedRevision: expectedRevision });
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
    await this.client.delete<Record<string, string>>(`/api/intake/${encodeURIComponent(draftId)}`);
  }
}

