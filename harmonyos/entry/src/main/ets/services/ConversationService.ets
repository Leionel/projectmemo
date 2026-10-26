import { ApiClient } from './ApiClient';
import { ConversationWork, ConversationWorkRef, ConversationWorkInput, ConversationScenarioInput, ConversationWorkReply, ConversationMaterialAssessment } from '../models/ConversationWork';
import { ConversationCapabilities, ConversationListReply, ConversationCreated, ConversationCreateInput,
  ConversationView, ConversationTurnInput, ConversationTurnReply, ConversationConfirmInput, ConversationConfirmReply,
  FocusPreferenceInput, FocusPreferenceReply } from '../models/Conversation';
export class ConversationService {
  private client: ApiClient = new ApiClient();
  async capabilities(): Promise<ConversationCapabilities> { return this.client.get<ConversationCapabilities>('/api/conversations/capabilities'); }
  async list(projectId: string = ''): Promise<ConversationListReply> {
    return this.client.get<ConversationListReply>(`/api/conversations${projectId !== '' ? '?projectId=' + encodeURIComponent(projectId) : ''}`);
  }
  async create(input: ConversationCreateInput): Promise<ConversationCreated> { return this.client.post<ConversationCreated>('/api/conversations', input); }
  async read(id: string, beforeSeq: number = 0): Promise<ConversationView> { return this.client.get<ConversationView>(`/api/conversations/${id}${beforeSeq > 0 ? '?beforeSeq=' + beforeSeq : ''}`); }
  async ask(id: string, input: ConversationTurnInput): Promise<ConversationTurnReply> { return this.client.post<ConversationTurnReply>(`/api/conversations/${id}/turns`, input); }
  async confirm(id: string, executionId: string, input: ConversationConfirmInput): Promise<ConversationConfirmReply> {
    return this.client.post<ConversationConfirmReply>(`/api/conversations/${id}/proposals/${executionId}/confirm`, input);
  }
  async previewResume(id: string, missionId: string): Promise<ConversationConfirmReply> { return this.client.post<ConversationConfirmReply>(`/api/conversations/${id}/missions/${missionId}/resume-preview`, undefined); }
  async preference(projectId: string): Promise<FocusPreferenceReply> { return this.client.get<FocusPreferenceReply>(`/api/workspace/focus/preferences/${projectId}`); }
  async savePreference(projectId: string, input: FocusPreferenceInput): Promise<FocusPreferenceReply> { return this.client.patch<FocusPreferenceReply>(`/api/workspace/focus/preferences/${projectId}`, input); }
  async work(id: string, ref: ConversationWorkRef): Promise<ConversationWork> { return this.client.get<ConversationWork>(`/api/conversations/${id}/work?kind=${ref.kind}&id=${encodeURIComponent(ref.id)}&projectId=${encodeURIComponent(ref.projectId)}`); }
  async previewWork(id: string, input: ConversationWorkInput): Promise<ConversationWorkReply> { return this.client.post<ConversationWorkReply>(`/api/conversations/${id}/work`, input); }
  async compareScenarios(id: string, input: ConversationScenarioInput): Promise<ConversationWorkReply> { return this.client.post<ConversationWorkReply>(`/api/conversations/${id}/work/scenarios`, input); }
  async assessMaterials(id: string, input: ConversationWorkInput): Promise<ConversationMaterialAssessment> { return this.client.post<ConversationMaterialAssessment>(`/api/conversations/${id}/work/materials`, input); }
  async decline(id: string, executionId: string): Promise<ConversationWorkReply> { return this.client.post<ConversationWorkReply>(`/api/conversations/${id}/proposals/${executionId}/decline`, undefined); }
  async reconcile(id: string): Promise<ConversationWorkReply> { return this.client.post<ConversationWorkReply>(`/api/conversations/${id}/reconcile`, undefined); }
}
