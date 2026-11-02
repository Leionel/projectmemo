import { ApiClient } from './ApiClient';
import {
  IntakeAcceptedFields, IntakeConfirmPayload, IntakeConfirmReply, IntakeConsentReply, IntakeCreatePayload,
  IntakeDraftCreated, IntakeMaterialAdded, IntakeReadReply, IntakeRevisePayload, IntakeReviseReply,
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

  async addText(draftId: string, requestId: string, text: string): Promise<IntakeMaterialAdded> {
    const payload = new IntakeTextPayload();
    payload.requestId = requestId;
    payload.text = text;
    return this.client.post<IntakeMaterialAdded>(`/api/intake/${encodeURIComponent(draftId)}/materials`, payload);
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
